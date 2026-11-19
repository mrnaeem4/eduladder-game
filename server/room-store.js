'use strict';

/*
 * Persistensi room ke SQLite.
 *
 * Room hidup di memori untuk kecepatan; modul ini menulis salinan ke tabel
 * rooms / room_players / room_runtime agar room bisa dipulihkan setelah
 * server restart, dan mengarsipkan hasil akhir ke match_history.
 */

const db = require('./db');
const E = require('../shared/engine');

function serialize(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function parse(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function insertRoom(room) {
  const handle = db.open();
  const now = new Date().toISOString();
  handle
    .prepare(
      `INSERT INTO rooms (code, bank_id, bank_name, status, config, questions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET bank_name = excluded.bank_name,
         config = excluded.config, questions = excluded.questions, updated_at = excluded.updated_at`
    )
    .run(
      room.code,
      room.bankId || null,
      room.bankName || 'Bank soal',
      room.status || 'lobby',
      serialize({
        shuffle: room.config ? room.config.shuffle !== false : true,
        helpQuotas: room.config ? room.config.helpQuotas : null,
        maxPlayers: E.sanitizeMaxPlayers(room.config ? room.config.maxPlayers : null),
        allowLateJoin: room.config ? room.config.allowLateJoin !== false : true,
      }),
      serialize(room.questions || []),
      now,
      now
    );
  handle
    .prepare(
      `INSERT INTO room_runtime (room_code, state, checkpoint, pending_intent, seq, updated_at)
       VALUES (?, NULL, NULL, NULL, 0, ?)
       ON CONFLICT(room_code) DO NOTHING`
    )
    .run(room.code, now);
}

function savePlayers(room) {
  const handle = db.open();
  const now = new Date().toISOString();
  handle.exec('BEGIN');
  try {
    handle.prepare('DELETE FROM room_players WHERE room_code = ?').run(room.code);
    const insert = handle.prepare(
      `INSERT INTO room_players (room_code, player_id, slot, char, name, token, kicked, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    (room.players || []).forEach((player) => {
      insert.run(
        room.code,
        player.id,
        player.slot,
        Number(player.char) || 1,
        player.name,
        player.token,
        player.kicked ? 1 : 0,
        now
      );
    });
    handle.prepare('UPDATE rooms SET updated_at = ? WHERE code = ?').run(now, room.code);
    handle.exec('COMMIT');
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
}

function setStatus(room, status) {
  const handle = db.open();
  const now = new Date().toISOString();
  if (status === 'playing') {
    handle
      .prepare('UPDATE rooms SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE code = ?')
      .run(status, now, now, room.code);
  } else if (status === 'finished') {
    handle
      .prepare('UPDATE rooms SET status = ?, finished_at = COALESCE(finished_at, ?), updated_at = ? WHERE code = ?')
      .run(status, now, now, room.code);
  } else {
    handle.prepare('UPDATE rooms SET status = ?, updated_at = ? WHERE code = ?').run(status, now, room.code);
  }
}

function saveState(room, state) {
  const handle = db.open();
  handle
    .prepare('UPDATE room_runtime SET state = ?, seq = ?, updated_at = ? WHERE room_code = ?')
    .run(state ? serialize(state) : null, state && state.seq ? state.seq : 0, new Date().toISOString(), room.code);
}

function saveCheckpoint(room, state, intent) {
  const handle = db.open();
  handle
    .prepare('UPDATE room_runtime SET checkpoint = ?, pending_intent = ?, updated_at = ? WHERE room_code = ?')
    .run(serialize(state), intent ? serialize(intent) : null, new Date().toISOString(), room.code);
}

function clearCheckpoint(room) {
  const handle = db.open();
  handle.prepare('UPDATE room_runtime SET checkpoint = NULL, pending_intent = NULL WHERE room_code = ?').run(room.code);
}

/* Kembalikan room ke lobi: status, runtime, dan timestamp dibersihkan agar
   pertandingan berikutnya menghitung durasi dari nol. */
function resetForLobby(room) {
  const handle = db.open();
  const now = new Date().toISOString();
  handle
    .prepare('UPDATE rooms SET status = ?, started_at = NULL, finished_at = NULL, updated_at = ? WHERE code = ?')
    .run('lobby', now, room.code);
  handle
    .prepare('UPDATE room_runtime SET state = NULL, checkpoint = NULL, pending_intent = NULL, seq = 0, updated_at = ? WHERE room_code = ?')
    .run(now, room.code);
}

function archiveMatch(room) {
  if (!room.state) return null;
  const handle = db.open();
  const state = room.state;
  /* Peringkat memakai logika engine agar tie-break dan hitungan bantuan
     selalu sama dengan yang ditampilkan di klien. */
  const ranking = E.buildRanking(state);

  const duration = room.startedAt ? Math.max(0, Math.round((Date.now() - room.startedAt) / 1000)) : 0;
  const startedIso = room.startedAt ? new Date(room.startedAt).toISOString() : null;
  const info = handle
    .prepare(
      `INSERT INTO match_history
       (room_code, bank_name, players, ranking, winner, reason, duration_seconds, help_config, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      room.code,
      room.bankName || 'Bank soal',
      serialize((state.players || []).map((player) => ({ slot: player.slot, name: player.name }))),
      serialize(ranking),
      state.winner || null,
      state.winnerReason || '',
      duration,
      serialize(room.config ? room.config.helpQuotas : null),
      startedIso,
      new Date().toISOString()
    );
  const matchId = Number(info.lastInsertRowid);
  /* Tautkan jawaban yang tercatat saat bermain ke arsip pertandingan ini. */
  if (startedIso) db.backfillAnswerMatch(matchId, room.code, startedIso);
  return matchId;
}

/* Catat satu jawaban (utama atau bonus) selagi permainan berjalan.
   Ditulis sinkron sebelum langkah permainan dijalankan. */
function recordAnswer(room, info) {
  if (!room.startedAt) return false;
  return db.insertAnswer({
    matchId: null,
    roomCode: room.code,
    startedAt: new Date(room.startedAt).toISOString(),
    seq: info.seq,
    kind: info.kind,
    questionId: info.questionId,
    question: info.question,
    picked: info.picked,
    pickedText: info.pickedText,
    correctAnswer: info.correctAnswer,
    isCorrect: info.isCorrect,
    timedOut: info.timedOut,
    delta: info.delta,
    tone: info.tone,
    playerId: info.playerId,
    playerSlot: info.playerSlot,
    playerName: info.playerName,
    char: info.char,
    createdAt: new Date().toISOString(),
  });
}

function listHistory(limit) {
  const handle = db.open();
  const rows = handle
    .prepare('SELECT * FROM match_history ORDER BY id DESC LIMIT ?')
    .all(Math.max(1, Math.min(200, Number(limit) || 50)));
  return rows.map(mapHistory);
}

function getHistory(id) {
  const handle = db.open();
  const row = handle.prepare('SELECT * FROM match_history WHERE id = ?').get(id);
  return row ? mapHistory(row) : null;
}

function mapHistory(row) {
  return {
    id: row.id,
    roomCode: row.room_code,
    bankName: row.bank_name,
    players: parse(row.players, []),
    ranking: parse(row.ranking, []),
    winner: row.winner,
    reason: row.reason,
    durationSeconds: row.duration_seconds,
    helpConfig: parse(row.help_config, null),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function deleteHistory(id) {
  const handle = db.open();
  /* ON DELETE CASCADE sudah membersihkan jawaban; hapus eksplisit agar tetap
     benar bila foreign_keys nonaktif di koneksi tertentu. */
  db.deleteAnswersForMatch(id);
  return Number(handle.prepare('DELETE FROM match_history WHERE id = ?').run(id).changes) > 0;
}

/* Jumlah arsip untuk satu pertandingan (room + waktu mulai), dipakai untuk
   membuat pengarsipan idempoten setelah restart. */
function matchCount(code, startedAt) {
  const handle = db.open();
  const stamp = startedAt ? new Date(startedAt).toISOString() : '';
  const row = stamp
    ? handle.prepare('SELECT COUNT(*) AS total FROM match_history WHERE room_code = ? AND started_at = ?').get(code, stamp)
    : handle.prepare('SELECT COUNT(*) AS total FROM match_history WHERE room_code = ?').get(code);
  return row ? row.total : 0;
}

function listRooms() {
  const handle = db.open();
  const rows = handle.prepare('SELECT * FROM rooms ORDER BY created_at DESC').all();
  return rows.map((row) => {
    const players = handle.prepare('SELECT name, slot, char FROM room_players WHERE room_code = ? AND kicked = 0 ORDER BY slot').all(row.code);
    const questions = parse(row.questions, []);
    const config = parse(row.config, {});
    return {
      code: row.code,
      bankId: row.bank_id,
      bankName: row.bank_name,
      status: row.status,
      shuffle: config.shuffle !== false,
      maxPlayers: E.sanitizeMaxPlayers(config.maxPlayers),
      allowLateJoin: config.allowLateJoin !== false,
      questionCount: questions.length,
      playerCount: players.length,
      players: players.map((item) => ({ name: item.name, slot: item.slot, char: item.char || 1 })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  });
}

function loadRoom(code) {
  const handle = db.open();
  const row = handle.prepare('SELECT * FROM rooms WHERE code = ?').get(String(code || '').toUpperCase());
  if (!row) return null;
  const players = handle.prepare('SELECT * FROM room_players WHERE room_code = ? ORDER BY slot').all(row.code);
  const runtime = handle.prepare('SELECT * FROM room_runtime WHERE room_code = ?').get(row.code);
  const config = parse(row.config, {});
  return {
    code: row.code,
    bankId: row.bank_id,
    bankName: row.bank_name,
    status: row.status,
    config: {
      shuffle: config.shuffle !== false,
      helpQuotas: config.helpQuotas || null,
      maxPlayers: E.sanitizeMaxPlayers(config.maxPlayers),
      allowLateJoin: config.allowLateJoin !== false,
    },
    questions: parse(row.questions, []),
    /* Status/istirahat pemain hanya berlaku di memori: setelah restart semua
       pemain mendapat masa tenggang baru untuk reconnect. */
    players: players.map((player) => ({
      id: player.player_id,
      slot: player.slot,
      char: player.char || 1,
      name: player.name,
      token: player.token,
      kicked: Boolean(player.kicked),
      connected: false,
      status: 'active',
      restingSince: 0,
    })),
    state: runtime ? parse(runtime.state, null) : null,
    pendingCheckpoint: runtime ? parse(runtime.checkpoint, null) : null,
    pendingIntent: runtime ? parse(runtime.pending_intent, null) : null,
    startedAt: row.started_at ? Date.parse(row.started_at) : 0,
    finishedAt: row.finished_at ? Date.parse(row.finished_at) : 0,
  };
}

function deleteRoom(code) {
  const handle = db.open();
  const normalized = String(code || '').toUpperCase();
  /* Jawaban pertandingan yang tidak pernah diarsipkan tidak punya induk;
     bersihkan sebelum room dihapus agar tidak menjadi baris yatim. */
  db.deleteAnswersForRoom(normalized);
  return Number(handle.prepare('DELETE FROM rooms WHERE code = ?').run(normalized).changes) > 0;
}

module.exports = {
  insertRoom,
  savePlayers,
  saveState,
  saveCheckpoint,
  clearCheckpoint,
  resetForLobby,
  setStatus,
  archiveMatch,
  recordAnswer,
  matchCount,
  listHistory,
  getHistory,
  deleteHistory,
  listRooms,
  loadRoom,
  deleteRoom,
};
