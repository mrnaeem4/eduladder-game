const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const E = require(path.join('..', 'shared', 'engine'));

function tempDb(name) {
  return path.join(os.tmpdir(), `eduladder-test-${name}-${process.pid}.db`);
}

test('normalizeQuestion mengonversi opsi lama menjadi objek', () => {
  const q = E.normalizeQuestion({ question: 'Q', options: ['a', 'b', 'c', 'd'], correctAnswer: 'b' });
  assert.deepStrictEqual(q.options[0], { text: 'a', imageUrl: '' });
  assert.strictEqual(q.correctAnswer, 'B');
});

test('normalizeQuestion mempertahankan gambar valid dan membuang yang tidak valid', () => {
  const q = E.normalizeQuestion({
    question: 'Q',
    questionImage: 'https://contoh.id/gambar.png',
    options: [
      { text: 'a', imageUrl: 'https://contoh.id/a.png' },
      { text: 'b', imageUrl: 'javascript:alert(1)' },
      { text: 'c' },
      { text: 'd' },
    ],
    correctAnswer: 'A',
  });
  assert.strictEqual(q.questionImage, 'https://contoh.id/gambar.png');
  assert.strictEqual(q.options[0].imageUrl, 'https://contoh.id/a.png');
  assert.strictEqual(q.options[1].imageUrl, '');
});

test('isValidImageUrl hanya menerima http/https atau kosong', () => {
  assert.strictEqual(E.isValidImageUrl(''), true);
  assert.strictEqual(E.isValidImageUrl('https://x.test/a.png'), true);
  assert.strictEqual(E.isValidImageUrl('http://x.test/a.png'), true);
  assert.strictEqual(E.isValidImageUrl('javascript:alert(1)'), false);
  assert.strictEqual(E.isValidImageUrl('ftp://x.test/a.png'), false);
  assert.strictEqual(E.isValidImageUrl('https://x.test/a b.png'), false);
});

test('parseCsv membaca kolom gambar opsional', () => {
  const csv = [
    'Pertanyaan;A;B;C;D;Jawaban;Clue;Reward;Penalty;Durasi;Gambar Soal;Gambar A;Gambar B;Gambar C;Gambar D',
    'Soal?;a;b;c;d;B;clue;5;3;15;https://x.test/q.png;https://x.test/a.png;;;',
    'Tanpa gambar?;a;b;c;d;A;clue;5;3;15;;;;;',
  ].join('\n');
  const { questions, errors } = E.parseCsv(csv);
  assert.strictEqual(questions.length, 2);
  assert.strictEqual(questions[0].questionImage, 'https://x.test/q.png');
  assert.deepStrictEqual(questions[0].options[0], { text: 'a', imageUrl: 'https://x.test/a.png' });
  assert.deepStrictEqual(questions[1].options[0], { text: 'a', imageUrl: '' });
  assert.deepStrictEqual(errors, []);
});

test('parseCsv melaporkan URL gambar tidak valid', () => {
  const csv = [
    'Pertanyaan;A;B;C;D;Jawaban;Clue;Reward;Penalty;Durasi;Gambar Soal;Gambar A;Gambar B;Gambar C;Gambar D',
    'Soal?;a;b;c;d;A;clue;5;3;15;ftp://x/q.png;;;;',
  ].join('\n');
  const { errors } = E.parseCsv(csv);
  assert.ok(errors.some((message) => /gambar soal/i.test(message)));
});

test('sanitizeHelpQuotas membatasi ke enam key dan nilai bilangan bulat >= 0', () => {
  const quotas = E.sanitizeHelpQuotas({ clue: 0, penawar: '3', doubleMove: -5, asing: 9 });
  assert.strictEqual(quotas.clue, 0);
  assert.strictEqual(quotas.penawar, 3);
  assert.strictEqual(quotas.doubleMove, 2);
  assert.strictEqual(quotas.asing, undefined);
  assert.deepStrictEqual(Object.keys(quotas).sort(), Object.keys(E.DEFAULT_HELPS()).sort());
});

test('createGameState memakai kuota bantuan room', () => {
  const players = [
    { id: 'p1', slot: 1, name: 'A' },
    { id: 'p2', slot: 2, name: 'B' },
  ];
  const state = E.createGameState(players, [], { helpQuotas: { clue: 0, penawar: 4 } });
  assert.strictEqual(state.helps.p1.clue, 0);
  assert.strictEqual(state.helps.p1.penawar, 4);
  assert.strictEqual(state.helpPreset.clue, 0);
});

test('redactQuestion tidak membocorkan kunci dan membawa gambar', () => {
  const question = E.normalizeQuestion({
    question: 'Q',
    questionImage: 'https://x.test/q.png',
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    correctAnswer: 'C',
  }, 0);
  const redacted = E.redactQuestion(question);
  assert.strictEqual(redacted.correctAnswer, undefined);
  assert.strictEqual(redacted.questionImage, 'https://x.test/q.png');
  assert.strictEqual(redacted.options[1].text, 'b');
});

test('persistensi bank soal: newline dan tab pada teks bertahan', () => {
  const dbPath = tempDb('text');
  try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
  process.env.EDULADDER_DB = dbPath;
  const db = require(path.join('..', 'server', 'db'));
  db.open();
  const source = E.normalizeQuestion({
    question: 'Kode:\n\tprint(1)\n\tprint(2)',
    options: [{ text: '1\n2' }, { text: '\t3' }, { text: 'c' }, { text: 'd' }],
    correctAnswer: 'A',
    clue: 'pakai\nindentasi\ttab',
  }, 0);
  const bank = db.saveBank({ name: 'Kode', questions: [source], errors: [] });
  const loaded = db.loadQuestions(bank.id)[0];
  assert.strictEqual(loaded.question, source.question);
  assert.strictEqual(loaded.options[0].text, '1\n2');
  assert.strictEqual(loaded.options[1].text, '\t3');
  assert.strictEqual(loaded.clue, 'pakai\nindentasi\ttab');
  db.close();
});

test('persistensi bank soal: gambar bertahan setelah disimpan', () => {  const dbPath = tempDb('bank');
  try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
  process.env.EDULADDER_DB = dbPath;
  const db = require(path.join('..', 'server', 'db'));
  db.open();

  const bank = db.saveBank({
    name: 'Test',
    questions: [E.normalizeQuestion({
      question: 'Q',
      questionImage: 'https://x.test/q.png',
      options: [
        { text: 'a', imageUrl: 'https://x.test/a.png' },
        { text: 'b' },
        { text: 'c' },
        { text: 'd' },
      ],
      correctAnswer: 'A',
    }, 0)],
    errors: [],
  });
  const loaded = db.loadQuestions(bank.id);
  assert.strictEqual(loaded[0].questionImage, 'https://x.test/q.png');
  assert.strictEqual(loaded[0].options[0].imageUrl, 'https://x.test/a.png');

  const updated = db.updateBank(bank.id, {
    name: 'Test 2',
    questions: [E.normalizeQuestion({ question: 'Q2', options: ['a', 'b', 'c', 'd'], correctAnswer: 'D' }, 0)],
    errors: [],
  });
  assert.strictEqual(updated.count, 1);
  assert.strictEqual(db.loadQuestions(bank.id)[0].question, 'Q2');
  db.close();
});

test('persistensi room + riwayat + pemulihan checkpoint', () => {
  const dbPath = tempDb('room');
  try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
  process.env.EDULADDER_DB = dbPath;

  const db = require(path.join('..', 'server', 'db'));
  const store = require(path.join('..', 'server', 'room-store'));
  const { RoomManager } = require(path.join('..', 'server', 'rooms'));
  db.open();

  const questions = Array.from({ length: 12 }, (_, i) => ({
    question: `Q${i + 1}`,
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    correctAnswer: 'A',
    clue: '',
    reward: 4,
    penalty: 3,
    duration: 30,
  }));

  const manager = new RoomManager();
  const room = manager.createRoom({ bankId: 'b', bankName: 'Restore', questions });
  room.joinPlayer('Satu', 1, null);
  room.joinPlayer('Dua', 2, null);
  room.instant = true;
  room.start();
  const code = room.code;

  const roster = room.players.map((p) => ({ id: p.id, slot: p.slot, name: p.name }));
  room.state = E.createGameState(roster, questions, { roomCode: code });
  room.state.phase = 'answering';
  room.state.question = room.state.deck[0];
  room.state.deckIndex = 1;
  room.state.turnForId = 'p1';
  const checkpoint = JSON.parse(JSON.stringify(room.state));
  store.saveCheckpoint(room, checkpoint, { type: 'answer', playerId: 'p1', letter: 'A', timedOut: false });
  room.state.phase = 'resolving';
  room.state.positions = { p1: 5, p2: 1 };
  store.saveState(room, room.state);

  const record = store.loadRoom(code);
  assert.ok(record, 'room tersimpan');
  assert.strictEqual(record.players.length, 2);
  assert.ok(record.pendingCheckpoint, 'checkpoint tersimpan');
  assert.strictEqual(record.pendingIntent.type, 'answer');

  const manager2 = new RoomManager();
  manager2.restoreAll(null);
  const restored = manager2.get(code);
  assert.ok(restored, 'room dipulihkan');
  restored.instant = true;
  assert.ok(['resolving', 'answering', 'bonus', 'handoff', 'finished'].includes(restored.state.phase));

  room.state.phase = 'finished';
  room.state.winner = 'p1';
  room.state.winnerReason = 'tes';
  room.startedAt = Date.now() - 120000;
  store.archiveMatch(room);
  assert.strictEqual(store.listHistory().length, 1);
  assert.strictEqual(store.deleteRoom(code), true);
  assert.strictEqual(store.listHistory().length, 1, 'riwayat tetap setelah room dihapus');
  db.close();
});

test('pengarsipan pertandingan idempoten (tidak dobel setelah dibuka ulang)', () => {
  const dbPath = tempDb('idem');
  try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
  process.env.EDULADDER_DB = dbPath;

  const db = require(path.join('..', 'server', 'db'));
  const store = require(path.join('..', 'server', 'room-store'));
  const { RoomManager } = require(path.join('..', 'server', 'rooms'));
  db.open();

  const questions = Array.from({ length: 8 }, (_, i) => ({
    question: `Q${i + 1}`,
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    correctAnswer: 'A',
    clue: '',
    reward: 4,
    penalty: 3,
    duration: 30,
  }));

  const manager = new RoomManager();
  const room = manager.createRoom({ bankId: 'b', bankName: 'Idem', questions });
  room.joinPlayer('Satu', 1, null);
  room.joinPlayer('Dua', 2, null);
  room.instant = true;
  room.start();
  room.startedAt = Date.now() - 60000;
  room.state.phase = 'finished';
  room.state.winner = 'p1';
  room.onFinished();
  room.onFinished();
  assert.strictEqual(store.listHistory().length, 1, 'onFinished ganda tidak menulis dua arsip');

  /* Simulasikan buka ulang pasca-restart: room dimuat lagi lalu onFinished. */
  const manager2 = new RoomManager();
  const reopened = manager2.ensure(room.code);
  reopened.onFinished();
  assert.strictEqual(store.listHistory().length, 1, 'reopen tidak menduplikasi arsip');
  db.close();
});

test('replay mengosongkan timestamp dan runtime room', () => {
  const dbPath = tempDb('replay');
  try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
  process.env.EDULADDER_DB = dbPath;

  const db = require(path.join('..', 'server', 'db'));
  const store = require(path.join('..', 'server', 'room-store'));
  const { RoomManager } = require(path.join('..', 'server', 'rooms'));
  db.open();

  const questions = Array.from({ length: 8 }, (_, i) => ({
    question: `Q${i + 1}`,
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    correctAnswer: 'A',
    clue: '',
    reward: 4,
    penalty: 3,
    duration: 30,
  }));

  const manager = new RoomManager();
  const room = manager.createRoom({ bankId: 'b', bankName: 'Replay', questions });
  room.joinPlayer('Satu', 1, null);
  room.joinPlayer('Dua', 2, null);
  room.instant = true;
  room.start();
  room.state.phase = 'finished';
  room.state.winner = 'p1';
  room.onFinished();
  room.replay();

  const record = store.loadRoom(room.code);
  assert.strictEqual(record.status, 'lobby');
  assert.strictEqual(record.startedAt, 0, 'started_at dibersihkan');
  assert.strictEqual(record.finishedAt, 0, 'finished_at dibersihkan');
  assert.strictEqual(record.state, null, 'state runtime dihapus');
  assert.strictEqual(store.listHistory().length, 1, 'riwayat lama tetap ada');
  db.close();
});
