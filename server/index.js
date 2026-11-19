'use strict';

/* Muat .env paling awal, sebelum modul lain membaca process.env.
   Tanpa `override`: env dari CI/PaaS tetap menang atas isi file. */
require('dotenv').config();

const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const E = require('../shared/engine');
const db = require('./db');
const store = require('./room-store');
const security = require('./security');
const { RoomManager } = require('./rooms');
const { buildAnswersCsv, answerFileName } = require('./answers-csv');
const { loadConfig, assertConfig } = require('./config');

const ROOT = path.join(__dirname, '..');
const loaded = loadConfig(process.env);
const config = assertConfig(loaded);
const PORT = config.port;
const HOST = config.host;
const ADMIN_PASSWORD = config.adminPassword;

security.configure({
  sessionHours: config.sessionHours,
  loginMaxAttempts: config.loginMaxAttempts,
  loginWindowSeconds: config.loginWindowSeconds,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.corsOrigin } });
const manager = new RoomManager({ graceMs: config.disconnectGraceSeconds * 1000 });

app.use(express.json({ limit: config.jsonLimit }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: config.csvLimit }));

app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.use('/client', express.static(path.join(ROOT, 'client')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));

function sendApp(req, res) {
  res.sendFile(path.join(ROOT, 'index.html'));
}
app.get('/', sendApp);
app.get('/join', sendApp);
app.get('/admin', sendApp);

function bearer(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function requireAdmin(req, res, next) {
  if (!security.isValidAdminSession(bearer(req))) {
    return res.status(401).json({ error: 'unauthorized', message: 'Sesi admin tidak valid. Silakan login.' });
  }
  return next();
}

function lanAddresses() {
  const result = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address);
    });
  });
  return result;
}

function fail(res, status, code, message, extra) {
  return res.status(status).json({ error: code, message, ...(extra || {}) });
}

/* ------------------------------------------------------------------ */
/* Auth admin                                                          */
/* ------------------------------------------------------------------ */

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!security.loginAllowed(ip)) {
    return fail(res, 429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi dalam satu menit.');
  }
  const password = (req.body && req.body.password) || '';
  if (!security.safeEqualText(password, ADMIN_PASSWORD)) {
    security.noteLoginFailure(ip);
    return fail(res, 401, 'bad_password', 'Password admin salah.');
  }
  security.resetLoginAttempts(ip);
  const session = security.issueAdminSession();
  return res.json({ token: session.token, expiresAt: session.expiresAt });
});

app.post('/api/admin/logout', (req, res) => {
  security.revokeAdminSession(bearer(req));
  return res.json({ ok: true });
});

app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ ok: true }));

/* ------------------------------------------------------------------ */
/* Bank soal                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/banks', requireAdmin, (req, res) => {
  try {
    return res.json({ banks: db.listBanks() });
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'db', 'Gagal membaca bank soal.');
  }
});

app.get('/api/banks/:id', requireAdmin, (req, res) => {
  try {
    const bank = db.getBank(req.params.id);
    if (!bank) return fail(res, 404, 'not_found', 'Bank soal tidak ditemukan.');
    return res.json({ bank: { ...bank, questions: db.loadQuestions(bank.id) } });
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'db', 'Gagal membaca bank soal.');
  }
});

/* Impor CSV atau buat bank kosong. */
app.post('/api/banks', requireAdmin, (req, res) => {
  const body = req.body || {};
  const name = typeof body === 'object' ? body.name : '';
  if (!body.csv && !body.empty) {
    return fail(res, 400, 'empty', 'Kirim file CSV atau tandai bank kosong.');
  }
  try {
    if (body.empty && !body.csv) {
      return res.status(201).json({ bank: db.createEmptyBank(name), errors: [] });
    }
    const csv = body.csv;
    if (Buffer.byteLength(csv, 'utf8') > 1024 * 1024) {
      return fail(res, 413, 'too_large', 'Ukuran CSV maksimal 1 MB.');
    }
    const parsed = E.parseCsv(csv);
    if (!parsed.questions.length) {
      return fail(res, 400, 'invalid', 'Tidak ada soal valid.', { errors: parsed.errors });
    }
    /* Normalisasi lewat engine agar data yang disimpan identik dengan yang
       dimuat/dimainkan (batas panjang teks, validasi URL, clamp angka). */
    const questions = parsed.questions.map((question, index) => {
      const normalized = E.normalizeQuestion(question, index);
      if ((question.questionImage || '').trim() && normalized.questionImage !== (question.questionImage || '').trim()) {
        parsed.errors.push(`Soal ${index + 1}: URL gambar soal tidak valid.`);
      }
      question.options.forEach((option, i) => {
        const raw = option && typeof option === 'object' ? String(option.imageUrl || '').trim() : '';
        if (raw && normalized.options[i].imageUrl !== raw) parsed.errors.push(`Soal ${index + 1}: URL gambar pilihan ${'ABCD'[i]} tidak valid.`);
      });
      return normalized;
    });
    const bank = db.saveBank({ name, questions, errors: parsed.errors });
    return res.status(201).json({ bank, errors: parsed.errors });
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'db', 'Gagal menyimpan bank soal.');
  }
});

/* Ganti seluruh isi bank: tambah, edit, hapus, urutkan sekaligus. */
app.put('/api/banks/:id', requireAdmin, (req, res) => {
  const body = req.body || {};
  try {
    const existing = db.getBank(req.params.id);
    if (!existing) return fail(res, 404, 'not_found', 'Bank soal tidak ditemukan.');
    if (!Array.isArray(body.questions)) return fail(res, 400, 'invalid', 'Daftar soal tidak valid.');
    const errors = E.validateQuestions(body.questions);
    if (errors.length) return fail(res, 400, 'invalid', errors[0], { errors });
    const questions = body.questions.map((question, index) => E.normalizeQuestion(question, index));
    const updated = db.updateBank(existing.id, { name: body.name, questions, errors: [] });
    return res.json({ bank: updated, errors: [] });
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'db', 'Gagal menyimpan bank soal.');
  }
});

app.delete('/api/banks/:id', requireAdmin, (req, res) => {
  try {
    if (!db.deleteBank(req.params.id)) return fail(res, 404, 'not_found', 'Bank soal tidak ditemukan.');
    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'db', 'Gagal menghapus bank.');
  }
});

/* ------------------------------------------------------------------ */
/* Room                                                                */
/* ------------------------------------------------------------------ */

function roomSummary(room) {
  return {
    code: room.code,
    bankName: room.bankName,
    phase: room.state ? room.state.phase : 'lobby',
    players: room.players.map((item) => ({
      id: item.id,
      slot: item.slot,
      char: item.char || 1,
      name: item.name,
      connected: Boolean(item.connected),
      status: item.status || 'active',
    })),
    bankCount: room.questions.length,
    config: {
      shuffle: room.config.shuffle !== false,
      helpQuotas: E.sanitizeHelpQuotas(room.config.helpQuotas, E.DEFAULT_HELPS()),
      maxPlayers: E.sanitizeMaxPlayers(room.config.maxPlayers),
      allowLateJoin: room.config.allowLateJoin !== false,
    },
  };
}

app.get('/api/rooms', requireAdmin, (req, res) => {
  try {
    const persisted = store.listRooms();
    const live = new Map();
    manager.rooms.forEach((room) => live.set(room.code, room));
    const merged = persisted.map((entry) => {
      const room = live.get(entry.code);
      return room
        ? { ...entry, phase: room.state ? room.state.phase : 'lobby', playerCount: room.players.length, live: true }
        : { ...entry, phase: entry.status, live: false };
    });
    return res.json({ rooms: merged });
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'db', 'Gagal membaca daftar room.');
  }
});

app.post('/api/rooms', requireAdmin, (req, res) => {
  const body = req.body || {};
  try {
    const bank = db.getBank(body.bankId);
    if (!bank) return fail(res, 404, 'bank_not_found', 'Bank soal tidak ditemukan.');
    const questions = db.loadQuestions(body.bankId);
    if (questions.length < E.MIN_QUESTIONS) {
      return fail(res, 400, 'need_questions', `Bank butuh minimal ${E.MIN_QUESTIONS} soal.`);
    }
    const config = body.config || {};
    const room = manager.createRoom({
      bankId: bank.id,
      bankName: bank.name,
      questions,
      shuffle: config.shuffle !== false,
      helpQuotas: E.sanitizeHelpQuotas(config.helpQuotas, E.DEFAULT_HELPS()),
      maxPlayers: E.sanitizeMaxPlayers(config.maxPlayers),
      allowLateJoin: config.allowLateJoin !== false,
    });
    room.setIo(io);
    return res.status(201).json({ code: room.code, bankName: bank.name, bankCount: questions.length });
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'db', 'Gagal membuat room.');
  }
});

app.get('/api/rooms/:code', (req, res) => {
  const room = manager.get(req.params.code);
  if (room) return res.json(roomSummary(room));
  const record = store.loadRoom(req.params.code);
  if (!record) return fail(res, 404, 'not_found', 'Room tidak ditemukan.');
  return res.json({
    code: record.code,
    bankName: record.bankName,
    phase: record.status,
    players: record.players.map((item) => ({ slot: item.slot, char: item.char || 1, name: item.name, connected: false })),
    bankCount: record.questions.length,
    config: {
      shuffle: record.config.shuffle !== false,
      helpQuotas: E.sanitizeHelpQuotas(record.config.helpQuotas, E.DEFAULT_HELPS()),
      maxPlayers: E.sanitizeMaxPlayers(record.config.maxPlayers),
      allowLateJoin: record.config.allowLateJoin !== false,
    },
    persisted: true,
  });
});

app.delete('/api/rooms/:code', requireAdmin, (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const room = manager.get(code);
  if (room) {
    if (room.io) room.io.to(code).emit('room:closed', { reason: 'deleted', code });
    if (room.io) room.io.socketsLeave(code);
    room.clearDeadline();
    manager.remove(room);
  }
  const removed = store.deleteRoom(code);
  if (!room && !removed) return fail(res, 404, 'not_found', 'Room tidak ditemukan.');
  return res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Riwayat                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/history', requireAdmin, (req, res) => {
  try {
    return res.json({ history: store.listHistory(req.query.limit) });
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'db', 'Gagal membaca riwayat.');
  }
});

app.get('/api/history/:id', requireAdmin, (req, res) => {
  const entry = store.getHistory(req.params.id);
  if (!entry) return fail(res, 404, 'not_found', 'Riwayat tidak ditemukan.');
  return res.json({ entry });
});

/* Unduh jawaban pemain untuk satu pertandingan (CSV, 1 baris per jawaban). */
app.get('/api/history/:id/answers', requireAdmin, (req, res) => {
  const entry = store.getHistory(req.params.id);
  if (!entry) return fail(res, 404, 'not_found', 'Riwayat tidak ditemukan.');
  let rows = db.listAnswersForMatch(Number(entry.id));
  if (!rows.length && entry.roomCode) {
    rows = db.listAnswersForRoomMatch(entry.roomCode, entry.startedAt || '');
  }
  const csv = buildAnswersCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${answerFileName(entry.roomCode, entry.finishedAt)}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(csv);
});

app.delete('/api/history/:id', requireAdmin, (req, res) => {
  if (!store.deleteHistory(req.params.id)) return fail(res, 404, 'not_found', 'Riwayat tidak ditemukan.');
  return res.json({ ok: true });
});

/* Konfigurasi publik untuk klien (QR/link join). Tanpa rahasia. */
app.get('/api/config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ publicUrl: config.publicUrl || null });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, rooms: manager.size(), port: PORT, addresses: lanAddresses() });
});

/* ------------------------------------------------------------------ */
/* Socket.IO                                                           */
/* ------------------------------------------------------------------ */

function roomFor(socket) {
  if (!socket.roomCode) return null;
  /* Room selesai bisa sudah dilepas dari memori; muat ulang dari SQLite agar
     aksi admin seperti "Main Lagi" tetap bekerja. */
  return manager.get(socket.roomCode) || manager.ensure(socket.roomCode);
}

const MESSAGES = {
  not_found: 'Room tidak ditemukan. Periksa kembali kode room.',
  kicked: 'Kamu dikeluarkan dari room ini.',
  name_required: 'Isi nama terlebih dahulu.',
  not_member: 'Sesi room tidak ditemukan. Coba masuk ulang.',
  need_players: 'Butuh minimal 2 pemain untuk memulai.',
  need_questions: 'Jumlah soal di bank belum mencukupi.',
  already_started: 'Permainan sudah berjalan.',
  bad_phase: 'Aksi tidak tersedia pada fase ini.',
  not_your_turn: 'Bukan giliranmu.',
  not_owner: 'Aksi ini bukan milikmu.',
  unavailable: 'Bantuan tidak bisa dipakai sekarang.',
  invalid: 'Aksi tidak sah.',
  busy: 'Tunggu animasi serangan selesai.',
  not_admin: 'Hanya admin yang boleh melakukan ini.',
  not_found_player: 'Pemain tidak ditemukan.',
  unauthorized: 'Sesi admin tidak valid. Silakan login ulang.',
};

function handleError(socket, code) {
  socket.emit('room:error', { code, message: MESSAGES[code] || 'Terjadi kesalahan.' });
}

function joinRoom(socket, payload) {
  const data = payload || {};
  const room = manager.ensure(data.roomCode);
  if (!room) return handleError(socket, 'not_found');

  if (socket.roomCode && socket.identity) {
    const previous = manager.get(socket.roomCode);
    if (previous) previous.detach(socket);
  }

  let identity = null;
  let notice = null;

  if (data.asAdmin) {
    if (!security.isValidAdminSession(data.adminSession)) return handleError(socket, 'unauthorized');
    identity = { role: 'admin', key: 'admin', token: data.adminSession };
  } else {
    const member = room.reconnectMember(data.token || null, data.name);
    if (member && !member.error) {
      identity = member;
      if (member.back) notice = 'Kamu kembali bermain.';
    } else {
      const joined = room.joinPlayer(data.name, data.slot, data.token || null);
      if (joined.error) return handleError(socket, joined.error);
      if (joined.spectator) {
        identity = { role: 'spectator', key: joined.spectator.token, token: joined.spectator.token };
        notice = 'Kamu bergabung sebagai penonton.';
      } else {
        identity = { role: 'player', key: joined.player.id, token: joined.token };
        socket.emit('room:token', { token: joined.token, playerId: joined.player.id, roomCode: room.code });
      }
    }
  }

  room.attach(socket, identity);
  socket.join(room.code);
  room.sendStateTo(socket);
  room.broadcastSnapshot();
  room.emitQuestion();
  socket.emit('room:joined', { code: room.code, role: identity.role, token: identity.token });
  if (notice) socket.emit('room:notice', { message: notice });
  return undefined;
}

io.on('connection', (socket) => {
  socket.on('room:join', (payload) => joinRoom(socket, payload));

  socket.on('room:leave', () => {
    const room = roomFor(socket);
    if (room) room.detach(socket);
    socket.leave(socket.roomCode || '');
    socket.roomCode = null;
    socket.identity = null;
  });

  const playerAction = (handler) => {
    const room = roomFor(socket);
    if (!room || !socket.identity || socket.identity.role !== 'player') return;
    /* Pemain yang sudah dikeluarkan tidak boleh lagi mengirim aksi. */
    const player = room.playerById(socket.identity.key);
    if (!player || player.kicked) return handleError(socket, 'kicked');
    handler(room, socket.identity.key);
  };

  const adminAction = (handler) => {
    const room = roomFor(socket);
    if (!room || !socket.identity || socket.identity.role !== 'admin') return handleError(socket, 'not_admin');
    if (!security.isValidAdminSession(socket.identity.token)) return handleError(socket, 'unauthorized');
    handler(room);
  };

  socket.on('game:answer', (payload) => {
    playerAction((room, playerId) => {
      const letter = payload && ['A', 'B', 'C', 'D'].includes(payload.letter) ? payload.letter : null;
      if (!letter) return;
      const result = room.answer(playerId, letter, false);
      if (result.error) handleError(socket, result.error);
    });
  });

  socket.on('game:useHelp', (payload) => {
    playerAction((room, playerId) => {
      if (!payload || !payload.key) return;
      const result = room.useHelp(playerId, payload.key);
      if (result.error) handleError(socket, result.error);
    });
  });

  socket.on('game:fireWeapon', (payload) => {
    playerAction((room, playerId) => {
      const data = payload || {};
      const result = room.fireWeapon(playerId, data.uid, data.targetId);
      if (result.error) handleError(socket, result.error);
    });
  });

  socket.on('game:continue', () => {
    playerAction((room, playerId) => {
      const result = room.continueTurn(playerId, false);
      if (result.error) handleError(socket, result.error);
    });
  });

  socket.on('lobby:setCharacter', (payload) => {
    playerAction((room, playerId) => {
      const result = room.setCharacter(playerId, payload && payload.charId);
      if (result.error) handleError(socket, result.error);
    });
  });

  socket.on('lobby:react', (payload) => {
    playerAction((room, playerId) => {
      const result = room.react(playerId, payload && payload.key);
      if (result.error && result.error !== 'rate_limited') handleError(socket, result.error);
    });
  });

  socket.on('admin:start', () => {
    adminAction((room) => {
      const result = room.start();
      if (result.error) handleError(socket, result.error);
    });
  });

  socket.on('admin:forceContinue', () => {
    adminAction((room) => {
      if (room.state && room.state.phase === 'handoff' && room.state.handoff) {
        const result = room.continueTurn(room.state.handoff.playerId, true);
        if (result.error) handleError(socket, result.error);
      } else if (room.state && room.state.phase === 'bonus' && room.state.snakeLadder) {
        room.answer(room.state.snakeLadder.playerId, null, true);
      }
    });
  });

  socket.on('admin:kick', (payload) => {
    adminAction((room) => {
      const result = room.kick(payload && payload.playerId);
      if (result.error) handleError(socket, result.error);
    });
  });

  socket.on('admin:endGame', () => {
    /* Sesi ditutup, jadi soket tidak lagi terikat room setelah ini. */
    const room = roomFor(socket);
    if (!room || !socket.identity || socket.identity.role !== 'admin') return handleError(socket, 'not_admin');
    if (!security.isValidAdminSession(socket.identity.token)) return handleError(socket, 'unauthorized');
    const result = room.endGame();
    if (result.error) return handleError(socket, result.error);
    socket.roomCode = null;
    return undefined;
  });

  socket.on('admin:replay', () => {
    adminAction((room) => {
      const result = room.replay();
      if (result.error) handleError(socket, result.error);
    });
  });

  socket.on('admin:updateConfig', (payload) => {
    adminAction((room) => {
      const result = room.updateConfig(payload);
      if (result.error) handleError(socket, result.error);
    });
  });

  socket.on('disconnect', () => {
    const room = manager.get(socket.roomCode) || (socket.roomCode ? manager.ensure(socket.roomCode) : null);
    if (!room) return;
    /* Sesi yang sudah ditutup admin tidak lagi menunggu siapa pun. */
    if (room.closed) return;
    room.detach(socket);
  });
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

/* Password admin sudah divalidasi oleh assertConfig() di atas. */
db.open();
manager.restoreAll(io);

server.listen(PORT, HOST, () => {
  const addresses = lanAddresses();
  const publicUrl = config.publicUrl ? config.publicUrl.replace(/\/+$/, '') : '';
  console.log('');
  console.log('  EduLadder Battle — server online');
  console.log(`  Lokal   : http://localhost:${PORT}/`);
  addresses.forEach((ip) => console.log(`  Jaringan: http://${ip}:${PORT}/`));
  console.log(`  Admin   : http://localhost:${PORT}/admin`);
  if (publicUrl) console.log(`  Publik  : ${publicUrl}/`);
  console.log(`  Room aktif dipulihkan: ${manager.size()}`);
  console.log('');
});

module.exports = { app, server, io, manager };
