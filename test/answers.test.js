const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const E = require(path.join('..', 'shared', 'engine'));

const dbFile = path.join(os.tmpdir(), `eduladder-answers-${process.pid}.db`);
try { fs.unlinkSync(dbFile); } catch (error) { /* ignore */ }
process.env.EDULADDER_DB = dbFile;

const db = require(path.join('..', 'server', 'db'));
const store = require(path.join('..', 'server', 'room-store'));
const { RoomManager } = require(path.join('..', 'server', 'rooms'));
const { buildAnswersCsv } = require(path.join('..', 'server', 'answers-csv'));

function questions(count) {
  return Array.from({ length: count }, (_, i) => ({
    question: `Soal ${i + 1}`,
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    correctAnswer: 'A',
    clue: `Petunjuk ${i + 1}`,
    reward: 4,
    penalty: 3,
    duration: 30,
  }));
}

function newRoom(manager) {
  const owner = manager || new RoomManager();
  const room = owner.createRoom({ bankId: 'b', bankName: 'Jawaban', questions: questions(12), shuffle: false });
  room.joinPlayer('Satu', null, null);
  room.joinPlayer('Dua', null, null);
  room.instant = true;
  room.start();
  return room;
}

function rowsFor(room) {
  return db.listAnswersForRoomMatch(room.code, new Date(room.startedAt).toISOString());
}

function bonusInfo(type) {
  return {
    type,
    playerId: 'p1',
    from: 3,
    to: type === 'ladder' ? 18 : 10,
    question: {
      id: 'bonus1',
      question: 'Soal bonus?',
      options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
      correctAnswer: 'B',
      clue: '',
      reward: 4,
      penalty: 3,
      duration: 30,
    },
  };
}

test('jawaban benar tercatat: utama, teks pilihan, delta reward', () => {
  db.open();
  const room = newRoom();
  const result = room.answer('p1', 'A', false);
  assert.strictEqual(result.ok, true);

  const rows = rowsFor(room);
  assert.strictEqual(rows.length, 1, 'satu baris per jawaban');
  const row = rows[0];
  assert.strictEqual(row.kind, 'utama');
  assert.strictEqual(row.picked, 'A');
  assert.strictEqual(row.pickedText, 'a');
  assert.strictEqual(row.correctAnswer, 'A');
  assert.strictEqual(row.isCorrect, true);
  assert.strictEqual(row.timedOut, false);
  assert.strictEqual(row.delta, 4);
  assert.strictEqual(row.tone, 'good');
  assert.strictEqual(row.playerName, 'Satu');
  assert.strictEqual(row.playerSlot, 1);
  assert.strictEqual(row.matchId, null);
});

test('Shield dan Penawar menahan hukuman: delta 0 netral', () => {
  const shieldRoom = newRoom();
  assert.strictEqual(shieldRoom.useHelp('p1', 'shield').ok, true);
  shieldRoom.answer('p1', 'B', false);
  const shielded = rowsFor(shieldRoom)[0];
  assert.strictEqual(shielded.isCorrect, false);
  assert.strictEqual(shielded.delta, 0);
  assert.strictEqual(shielded.tone, 'neutral');

  const penawarRoom = newRoom();
  assert.strictEqual(penawarRoom.useHelp('p1', 'penawar').ok, true);
  penawarRoom.answer('p1', 'B', false);
  const penawar = rowsFor(penawarRoom)[0];
  assert.strictEqual(penawar.delta, 0);
  assert.strictEqual(penawar.tone, 'neutral');
});

test('timeout utama tercatat dengan penalty', () => {
  const room = newRoom();
  const result = room.answer('p1', null, true);
  assert.strictEqual(result.ok, true);
  const row = rowsFor(room)[0];
  assert.strictEqual(row.timedOut, true);
  assert.strictEqual(row.picked, null);
  assert.strictEqual(row.isCorrect, false);
  assert.strictEqual(row.delta, -3);
  assert.strictEqual(row.tone, 'bad');
});

test('soal bonus tangga/ular tercatat tanpa delta', () => {
  const room = newRoom();
  room.state.phase = 'bonus';
  room.state.snakeLadder = bonusInfo('ladder');
  room.state.deadline = Date.now() + 5000;
  room.answer('p1', 'B', false);
  const row = rowsFor(room)[0];
  assert.strictEqual(row.kind, 'tangga');
  assert.strictEqual(row.isCorrect, true);
  assert.strictEqual(row.delta, 0);
  assert.strictEqual(row.tone, 'neutral');

  const timeoutRoom = newRoom();
  timeoutRoom.state.phase = 'bonus';
  timeoutRoom.state.snakeLadder = bonusInfo('snake');
  timeoutRoom.state.deadline = Date.now() + 5000;
  timeoutRoom.onDeadline();
  const timeoutRow = rowsFor(timeoutRoom)[0];
  assert.strictEqual(timeoutRow.kind, 'ular');
  assert.strictEqual(timeoutRow.timedOut, true);
  assert.strictEqual(timeoutRow.picked, null);
  assert.strictEqual(timeoutRow.delta, 0);
});

test('arsip menautkan jawaban ke match_id dan CSV memuat data', () => {
  const room = newRoom();
  room.answer('p1', 'A', false);
  room.state.phase = 'finished';
  room.state.winner = 'p1';
  room.state.winnerReason = 'tes jawaban';

  const matchId = store.archiveMatch(room);
  const rows = db.listAnswersForMatch(matchId);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].matchId, matchId);

  const csv = buildAnswersCsv(rows);
  assert.ok(csv.startsWith('\uFEFF'), 'BOM UTF-8');
  assert.ok(csv.includes('Room;Waktu;Jenis;Pertanyaan;Pemain;Slot;Karakter;Jawaban;Teks Jawaban;Kunci;Benar;Timeout;Delta Langkah'));
  assert.ok(csv.includes('Soal utama'));
  assert.ok(csv.includes(room.code));
  assert.ok(csv.includes('Ya'));

  assert.strictEqual(store.deleteHistory(matchId), true);
  assert.strictEqual(db.listAnswersForMatch(matchId).length, 0, 'hapus riwayat ikut menghapus jawaban');
});

test('insert ganda dengan kunci sama diperlakukan idempoten', () => {
  const room = newRoom();
  const row = {
    roomCode: room.code,
    startedAt: new Date(room.startedAt).toISOString(),
    seq: 4242,
    kind: 'utama',
    questionId: 'q1',
    question: 'Q',
    picked: 'A',
    pickedText: 'a',
    correctAnswer: 'A',
    isCorrect: true,
    timedOut: false,
    delta: 4,
    tone: 'good',
    playerId: 'p1',
    playerSlot: 1,
    playerName: 'Satu',
    char: 1,
  };
  assert.strictEqual(db.insertAnswer(row), true);
  assert.strictEqual(db.insertAnswer(row), false, 'baris duplikat diabaikan');
  const rows = rowsFor(room).filter((item) => item.seq === 4242);
  assert.strictEqual(rows.length, 1);
});

test('hapus room membuang jawaban yang belum diarsipkan', () => {
  const room = newRoom();
  room.answer('p1', 'A', false);
  const startedIso = new Date(room.startedAt).toISOString();
  assert.ok(rowsFor(room).length > 0);
  assert.strictEqual(store.deleteRoom(room.code), true);
  assert.strictEqual(db.listAnswersForRoomMatch(room.code, startedIso).length, 0);
});

test('CSV meng-escape pemisah/kutip dan mencegah formula injection', () => {
  const csv = buildAnswersCsv([
    {
      roomCode: 'AB;12',
      createdAt: '2026-11-18T10:00:00.000Z',
      kind: 'utama',
      question: '=SUM(1)',
      playerName: 'Ani "A"',
      playerSlot: 2,
      char: 2,
      picked: 'B',
      pickedText: 'b',
      correctAnswer: 'A',
      isCorrect: false,
      timedOut: false,
      delta: -3,
    },
  ]);
  assert.ok(csv.includes('"AB;12"'), 'pemisah dibungkus kutip');
  assert.ok(csv.includes('"Ani ""A"""'), 'kutip digandakan');
  assert.ok(csv.includes("'=SUM(1)"), 'formula diberi apostrof');
  assert.ok(csv.includes('Tidak'));
  assert.ok(csv.includes(E.characterStyle(2).name));
});
