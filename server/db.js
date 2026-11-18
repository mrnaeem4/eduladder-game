'use strict';

const fs = require('fs');
const path = require('path');
const E = require('../shared/engine');

const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_DB_FILE = path.join(DATA_DIR, 'eduladder.db');

let db = null;
let openedPath = null;

/* Dibaca saat open() dipanggil, bukan saat modul dimuat, agar EDULADDER_DB
   dan pemakaian ulang file berbeda (mis. antar test) berlaku. */
function databaseFile() {
  return process.env.EDULADDER_DB || DEFAULT_DB_FILE;
}

function open() {
  const target = databaseFile();
  if (db && openedPath === target) return db;
  if (db) {
    db.close();
    db = null;
  }
  openedPath = target;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // node:sqlite masih berstatus eksperimental pada Node 22; peringatannya
  // tidak perlu mengotori log server.
  const originalEmit = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const text = typeof warning === 'string' ? warning : warning && warning.message;
    if (text && /SQLite is an experimental feature/i.test(text)) return;
    return originalEmit.call(process, warning, ...rest);
  };
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } finally {
    process.emitWarning = originalEmit;
  }

  db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function tableColumns(handle, table) {
  return handle.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function migrate(handle) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS banks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      errors TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
  `);
  handle.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      bank_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      question TEXT NOT NULL,
      question_image TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      clue TEXT NOT NULL DEFAULT '',
      reward INTEGER NOT NULL,
      penalty INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      PRIMARY KEY (bank_id, ordinal),
      FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE
    );
  `);
  if (!tableColumns(handle, 'questions').includes('question_image')) {
    handle.exec("ALTER TABLE questions ADD COLUMN question_image TEXT NOT NULL DEFAULT ''");
  }

  handle.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      bank_id TEXT,
      bank_name TEXT NOT NULL,
      status TEXT NOT NULL,
      config TEXT NOT NULL,
      questions TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
  `);
  handle.exec(`
    CREATE TABLE IF NOT EXISTS room_players (
      room_code TEXT NOT NULL,
      player_id TEXT NOT NULL,
      slot INTEGER NOT NULL,
      char INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      kicked INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_code, player_id),
      FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
    );
  `);
  /* Migrasi room lama: kolom char ditambahkan bila belum ada. */
  if (!tableColumns(handle, 'room_players').includes('char')) {
    handle.exec('ALTER TABLE room_players ADD COLUMN char INTEGER NOT NULL DEFAULT 1');
  }
  handle.exec(`
    CREATE TABLE IF NOT EXISTS room_runtime (
      room_code TEXT PRIMARY KEY,
      state TEXT,
      checkpoint TEXT,
      pending_intent TEXT,
      seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
    );
  `);
  handle.exec(`
    CREATE TABLE IF NOT EXISTS match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      players TEXT NOT NULL,
      ranking TEXT NOT NULL,
      winner TEXT,
      reason TEXT,
      duration_seconds INTEGER,
      help_config TEXT,
      started_at TEXT,
      finished_at TEXT NOT NULL
    );
  `);
  handle.exec(`
    CREATE TABLE IF NOT EXISTS player_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER REFERENCES match_history(id) ON DELETE CASCADE,
      room_code TEXT NOT NULL,
      started_at TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      question_id TEXT,
      question TEXT NOT NULL,
      picked TEXT,
      picked_text TEXT NOT NULL DEFAULT '',
      correct_answer TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      timed_out INTEGER NOT NULL DEFAULT 0,
      delta INTEGER NOT NULL DEFAULT 0,
      tone TEXT NOT NULL DEFAULT 'neutral',
      player_id TEXT NOT NULL,
      player_slot INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      char INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  handle.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_player_answers_unique
      ON player_answers(room_code, started_at, seq, player_id, kind);
  `);
  handle.exec('CREATE INDEX IF NOT EXISTS idx_player_answers_match ON player_answers(match_id)');
}

function nowIso() {
  return new Date().toISOString();
}

function newBankId() {
  return `bank_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* ------------------------------------------------------------------ */
/* Bank soal                                                           */
/* ------------------------------------------------------------------ */

function serializeOptions(options) {
  const list = Array.isArray(options) ? options : [];
  return JSON.stringify(
    [0, 1, 2, 3].map((i) => {
      const option = list[i];
      if (option && typeof option === 'object') return { text: String(option.text || ''), imageUrl: String(option.imageUrl || '') };
      return { text: String(option === undefined || option === null ? '' : option), imageUrl: '' };
    })
  );
}

function saveBank({ name, questions, errors }) {
  const handle = open();
  const id = newBankId();
  const now = nowIso();
  const label = (typeof name === 'string' && name.trim().slice(0, 60)) || `Bank ${now.slice(0, 16).replace('T', ' ')}`;

  handle.exec('BEGIN');
  try {
    handle
      .prepare('INSERT INTO banks (id, name, count, errors, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, label, questions.length, JSON.stringify((errors || []).slice(0, 50)), now);
    insertQuestions(handle, id, questions);
    handle.exec('COMMIT');
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }

  return { id, name: label, count: questions.length, createdAt: now, errors: errors || [] };
}

function insertQuestions(handle, bankId, questions) {
  const insert = handle.prepare(
    `INSERT INTO questions (bank_id, ordinal, question, question_image, options, correct_answer, clue, reward, penalty, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  questions.forEach((raw, index) => {
    /* Satu sumber normalisasi (engine) agar apa yang disimpan sama dengan
       apa yang dimuat dan dimainkan. */
    const question = E.normalizeQuestion(raw, index);
    insert.run(
      bankId,
      index,
      question.question,
      question.questionImage,
      serializeOptions(question.options),
      question.correctAnswer,
      question.clue || '',
      question.reward,
      question.penalty,
      question.duration
    );
  });
}

/* Mengganti seluruh isi bank (tambah/edit/hapus/urutkan sekaligus). */
function updateBank(id, { name, questions, errors }) {
  const handle = open();
  const existing = handle.prepare('SELECT id FROM banks WHERE id = ?').get(id);
  if (!existing) return null;
  const now = nowIso();
  const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : null;

  handle.exec('BEGIN');
  try {
    if (label) handle.prepare('UPDATE banks SET name = ? WHERE id = ?').run(label, id);
    handle.prepare('UPDATE banks SET count = ?, errors = ? WHERE id = ?').run(
      questions.length,
      JSON.stringify((errors || []).slice(0, 50)),
      id
    );
    handle.prepare('DELETE FROM questions WHERE bank_id = ?').run(id);
    insertQuestions(handle, id, questions);
    handle.exec('COMMIT');
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
  return getBank(id);
}

function createEmptyBank(name) {
  const handle = open();
  const id = newBankId();
  const now = nowIso();
  const label = (typeof name === 'string' && name.trim().slice(0, 60)) || `Bank ${now.slice(0, 16).replace('T', ' ')}`;
  handle.prepare('INSERT INTO banks (id, name, count, errors, created_at) VALUES (?, ?, 0, ?, ?)').run(id, label, '[]', now);
  return { id, name: label, count: 0, createdAt: now, errors: [] };
}

function listBanks() {
  const handle = open();
  const rows = handle.prepare('SELECT id, name, count, created_at FROM banks ORDER BY created_at DESC').all();
  return rows.map((row) => ({ id: row.id, name: row.name, count: row.count, createdAt: row.created_at }));
}

function getBank(id) {
  const handle = open();
  const row = handle.prepare('SELECT id, name, count, errors, created_at FROM banks WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    count: row.count,
    createdAt: row.created_at,
    errors: safeParse(row.errors, []),
  };
}

function loadQuestions(bankId) {
  const handle = open();
  const rows = handle
    .prepare(
      `SELECT ordinal, question, question_image, options, correct_answer, clue, reward, penalty, duration
       FROM questions WHERE bank_id = ? ORDER BY ordinal ASC`
    )
    .all(bankId);
  return rows.map((row) => {
    const options = safeParse(row.options, []);
    return {
      id: `q${row.ordinal + 1}`,
      question: row.question,
      questionImage: row.question_image || '',
      options: [0, 1, 2, 3].map((i) => {
        const option = options[i];
        if (option && typeof option === 'object') return { text: String(option.text || ''), imageUrl: String(option.imageUrl || '') };
        return { text: String(option === undefined || option === null ? '' : option), imageUrl: '' };
      }),
      correctAnswer: row.correct_answer,
      clue: row.clue,
      reward: row.reward,
      penalty: row.penalty,
      duration: row.duration,
      used: false,
    };
  });
}

function deleteBank(id) {
  const handle = open();
  const result = handle.prepare('DELETE FROM banks WHERE id = ?').run(id);
  return result.changes > 0;
}

/* ------------------------------------------------------------------ */
/* Room persistent                                                     */
/* ------------------------------------------------------------------ */

function insertRoom({ code, bankId, bankName, config, questions, status, createdAt }) {
  const handle = open();
  const now = createdAt || nowIso();
  handle
    .prepare(
      `INSERT INTO rooms (code, bank_id, bank_name, status, config, questions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(code, bankId || null, bankName, status || 'lobby', JSON.stringify(config || {}), JSON.stringify(questions || []), now, now);
  handle
    .prepare('INSERT INTO room_runtime (room_code, state, checkpoint, pending_intent, seq, updated_at) VALUES (?, NULL, NULL, NULL, 0, ?)')
    .run(code, now);
}

function getRoom(code) {
  const handle = open();
  const row = handle.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
  if (!row) return null;
  return {
    code: row.code,
    bankId: row.bank_id,
    bankName: row.bank_name,
    status: row.status,
    config: safeParse(row.config, {}),
    questions: safeParse(row.questions, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function getRoomRuntime(code) {
  const handle = open();
  const row = handle.prepare('SELECT * FROM room_runtime WHERE room_code = ?').get(code);
  if (!row) return null;
  return {
    state: safeParse(row.state, null),
    checkpoint: safeParse(row.checkpoint, null),
    pendingIntent: safeParse(row.pending_intent, null),
    seq: row.seq,
  };
}

function listRooms(status) {
  const handle = open();
  const rows = status
    ? handle.prepare('SELECT code, bank_name, status, created_at, updated_at FROM rooms WHERE status = ? ORDER BY updated_at DESC').all(status)
    : handle.prepare('SELECT code, bank_name, status, created_at, updated_at FROM rooms ORDER BY updated_at DESC').all();
  return rows.map((row) => ({
    code: row.code,
    bankName: row.bank_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    players: countPlayers(row.code),
  }));
}

function countPlayers(code) {
  const handle = open();
  const row = handle.prepare('SELECT COUNT(*) AS total FROM room_players WHERE room_code = ?').get(code);
  return row ? row.total : 0;
}

function setRoomStatus(code, status, when) {
  const handle = open();
  const stamp = when || nowIso();
  if (status === 'playing') {
    handle.prepare('UPDATE rooms SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE code = ?').run(status, stamp, stamp, code);
  } else if (status === 'finished') {
    handle.prepare('UPDATE rooms SET status = ?, finished_at = ?, updated_at = ? WHERE code = ?').run(status, stamp, stamp, code);
  } else {
    handle.prepare('UPDATE rooms SET status = ?, updated_at = ? WHERE code = ?').run(status, stamp, code);
  }
}

function updateRoomConfig(code, config) {
  const handle = open();
  handle.prepare('UPDATE rooms SET config = ?, updated_at = ? WHERE code = ?').run(JSON.stringify(config || {}), nowIso(), code);
}

function saveRuntime(code, patch) {
  const handle = open();
  const fields = [];
  const values = [];
  ['state', 'checkpoint', 'pending_intent'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      fields.push(`${key} = ?`);
      values.push(patch[key] === null || patch[key] === undefined ? null : JSON.stringify(patch[key]));
    }
  });
  if (Object.prototype.hasOwnProperty.call(patch, 'seq')) {
    fields.push('seq = ?');
    values.push(patch.seq);
  }
  fields.push('updated_at = ?');
  values.push(nowIso());
  values.push(code);
  handle.prepare(`UPDATE room_runtime SET ${fields.join(', ')} WHERE room_code = ?`).run(...values);
}

function upsertPlayers(code, players) {
  const handle = open();
  const stamp = nowIso();
  handle.prepare('DELETE FROM room_players WHERE room_code = ?').run(code);
  const insert = handle.prepare(
    'INSERT INTO room_players (room_code, player_id, slot, char, name, token, kicked, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  (players || []).forEach((player) => {
    insert.run(
      code,
      player.id,
      player.slot,
      Number(player.char) || 1,
      player.name,
      player.token,
      player.kicked ? 1 : 0,
      stamp
    );
  });
}

function listPlayers(code) {
  const handle = open();
  const rows = handle.prepare('SELECT player_id, slot, char, name, token, kicked FROM room_players WHERE room_code = ? ORDER BY slot ASC').all(code);
  return rows.map((row) => ({
    id: row.player_id,
    slot: row.slot,
    char: row.char || 1,
    name: row.name,
    token: row.token,
    kicked: Boolean(row.kicked),
  }));
}

function deleteRoom(code) {
  const handle = open();
  const result = handle.prepare('DELETE FROM rooms WHERE code = ?').run(code);
  return result.changes > 0;
}

/* ------------------------------------------------------------------ */
/* Riwayat pertandingan                                                */
/* ------------------------------------------------------------------ */

function saveMatch(entry) {
  const handle = open();
  const stamp = nowIso();
  const result = handle
    .prepare(
      `INSERT INTO match_history (room_code, bank_name, players, ranking, winner, reason, duration_seconds, help_config, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.roomCode,
      entry.bankName,
      JSON.stringify(entry.players || []),
      JSON.stringify(entry.ranking || []),
      entry.winner || null,
      entry.reason || '',
      entry.durationSeconds || 0,
      JSON.stringify(entry.helpConfig || {}),
      entry.startedAt || null,
      stamp
    );
  return Number(result.lastInsertRowid);
}

function listHistory() {
  const handle = open();
  const rows = handle.prepare('SELECT * FROM match_history ORDER BY id DESC').all();
  return rows.map(mapHistory);
}

function getHistory(id) {
  const handle = open();
  const row = handle.prepare('SELECT * FROM match_history WHERE id = ?').get(id);
  return row ? mapHistory(row) : null;
}

function deleteHistory(id) {
  const handle = open();
  const result = handle.prepare('DELETE FROM match_history WHERE id = ?').run(id);
  return result.changes > 0;
}

function mapHistory(row) {
  return {
    id: row.id,
    roomCode: row.room_code,
    bankName: row.bank_name,
    players: safeParse(row.players, []),
    ranking: safeParse(row.ranking, []),
    winner: row.winner,
    reason: row.reason,
    durationSeconds: row.duration_seconds,
    helpConfig: safeParse(row.help_config, {}),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function historyCountFor(roomCode) {
  const handle = open();
  const row = handle.prepare('SELECT COUNT(*) AS total FROM match_history WHERE room_code = ?').get(roomCode);
  return row ? row.total : 0;
}

/* ------------------------------------------------------------------ */
/* Jawaban pemain                                                      */
/* ------------------------------------------------------------------ */

function insertAnswer(row) {
  const handle = open();
  const result = handle
    .prepare(
      `INSERT OR IGNORE INTO player_answers
       (match_id, room_code, started_at, seq, kind, question_id, question, picked, picked_text,
        correct_answer, is_correct, timed_out, delta, tone, player_id, player_slot, player_name, char, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.matchId === undefined || row.matchId === null ? null : row.matchId,
      row.roomCode,
      row.startedAt,
      Number(row.seq) || 0,
      row.kind || 'utama',
      row.questionId || null,
      row.question || '',
      row.picked || null,
      row.pickedText || '',
      row.correctAnswer || '',
      row.isCorrect ? 1 : 0,
      row.timedOut ? 1 : 0,
      Number(row.delta) || 0,
      row.tone || 'neutral',
      row.playerId,
      Number(row.playerSlot) || 1,
      row.playerName || '',
      Number(row.char) || 1,
      row.createdAt || new Date().toISOString()
    );
  return Number(result.changes) > 0;
}

function mapAnswer(row) {
  return {
    id: row.id,
    matchId: row.match_id,
    roomCode: row.room_code,
    startedAt: row.started_at,
    seq: row.seq,
    kind: row.kind,
    questionId: row.question_id,
    question: row.question,
    picked: row.picked,
    pickedText: row.picked_text,
    correctAnswer: row.correct_answer,
    isCorrect: Boolean(row.is_correct),
    timedOut: Boolean(row.timed_out),
    delta: row.delta,
    tone: row.tone,
    playerId: row.player_id,
    playerSlot: row.player_slot,
    playerName: row.player_name,
    char: row.char || 1,
    createdAt: row.created_at,
  };
}

function listAnswersForMatch(matchId) {
  const handle = open();
  const rows = handle.prepare('SELECT * FROM player_answers WHERE match_id = ? ORDER BY id ASC').all(matchId);
  return rows.map(mapAnswer);
}

function listAnswersForRoomMatch(roomCode, startedAt) {
  const handle = open();
  const rows = handle
    .prepare('SELECT * FROM player_answers WHERE room_code = ? AND started_at = ? ORDER BY id ASC')
    .all(String(roomCode || '').toUpperCase(), String(startedAt || ''));
  return rows.map(mapAnswer);
}

function backfillAnswerMatch(matchId, roomCode, startedAt) {
  const handle = open();
  const result = handle
    .prepare('UPDATE player_answers SET match_id = ? WHERE room_code = ? AND started_at = ? AND match_id IS NULL')
    .run(matchId, String(roomCode || '').toUpperCase(), String(startedAt || ''));
  return Number(result.changes) || 0;
}

/* Baris jawaban yang belum masuk arsip (pertandingan dibatalkan). */
function deleteAnswersForRoom(roomCode) {
  const handle = open();
  const result = handle.prepare('DELETE FROM player_answers WHERE room_code = ? AND match_id IS NULL').run(
    String(roomCode || '').toUpperCase()
  );
  return Number(result.changes) || 0;
}

function deleteAnswersForMatch(matchId) {
  const handle = open();
  const result = handle.prepare('DELETE FROM player_answers WHERE match_id = ?').run(matchId);
  return Number(result.changes) || 0;
}

/* ------------------------------------------------------------------ */

function safeParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  get DB_FILE() {
    return databaseFile();
  },
  open,
  close,
  saveBank,
  createEmptyBank,
  updateBank,
  listBanks,
  getBank,
  loadQuestions,
  deleteBank,
  insertRoom,
  getRoom,
  getRoomRuntime,
  listRooms,
  setRoomStatus,
  updateRoomConfig,
  saveRuntime,
  upsertPlayers,
  listPlayers,
  deleteRoom,
  saveMatch,
  listHistory,
  getHistory,
  deleteHistory,
  historyCountFor,
  insertAnswer,
  listAnswersForMatch,
  listAnswersForRoomMatch,
  backfillAnswerMatch,
  deleteAnswersForRoom,
  deleteAnswersForMatch,
};
