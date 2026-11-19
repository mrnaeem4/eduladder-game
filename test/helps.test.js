const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const E = require(path.join('..', 'shared', 'engine'));

const PLAYERS = [
  { id: 'p1', slot: 1, name: 'A' },
  { id: 'p2', slot: 2, name: 'B' },
  { id: 'p3', slot: 3, name: 'C' },
];

function questions(count) {
  return Array.from({ length: count }, (_, i) => ({
    question: `Soal ${i + 1}`,
    options: ['a', 'b', 'c', 'd'],
    correctAnswer: 'A',
    clue: `Petunjuk ${i + 1}`,
    reward: 4,
    penalty: 3,
    duration: 30,
  }));
}

function run(state, handler) {
  const steps = [];
  handler(steps);
  steps.forEach((item) => {
    if (typeof item.apply === 'function') item.apply(state);
  });
  return steps;
}

function started(playerCount) {
  const state = E.createGameState(PLAYERS.slice(0, playerCount), questions(40), { shuffle: false });
  run(state, (steps) => E.handleStart(state, steps));
  return state;
}

/* Menyelesaikan giliran pemain aktif dengan jawaban benar. */
function answerCorrect(state) {
  const owner = state.turnForId;
  run(state, (steps) => E.handleAnswer(state, owner, 'A', false, steps));
  return owner;
}

test('semua bantuan hanya bisa dipakai pemilik giliran', () => {
  const keys = ['throwQuestion', 'clue', 'shield', 'changeQuestion', 'doubleMove', 'penawar'];
  keys.forEach((key) => {
    const state = started(3);
    const steps = [];
    E.handleUseHelp(state, 'p2', key, steps);
    assert.strictEqual(steps.length, 0, `${key} tidak boleh dipakai pemain non-aktif`);
  });
});

test('kuota bantuan terpisah per pemain', () => {
  const state = started(3);
  const p2Before = JSON.stringify(state.helps.p2);
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'doubleMove', steps));
  assert.strictEqual(JSON.stringify(state.helps.p2), p2Before);
  assert.strictEqual(state.helps.p1.doubleMove, E.DEFAULT_HELPS().doubleMove - 1);
});

test('shield menahan hukuman pemilik dan tidak melindungi pemain lain', () => {
  const state = started(3);
  state.positions.p1 = 5;
  state.positions.p2 = 5;
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'shield', steps));
  run(state, (steps) => E.handleAnswer(state, 'p1', 'B', false, steps));
  assert.strictEqual(state.positions.p1, 5, 'shield menahan hukuman pemilik');
  assert.strictEqual(Boolean(state.shields.p1), false, 'shield terpakai');

  /* Aktifkan lagi lalu pastikan pemain berikutnya tetap kena hukuman. */
  state.shields.p1 = true;
  run(state, (steps) => E.handleContinue(state, 'p2', steps));
  run(state, (steps) => E.handleAnswer(state, 'p2', 'B', false, steps));
  assert.strictEqual(state.positions.p2, 2, 'shield pemain lain tidak menahan hukuman p2');
  assert.strictEqual(Boolean(state.shields.p1), true, 'shield pemain lain tetap utuh');
});

test('shield menyerap serangan senjata dan habis', () => {
  const state = started(3);
  state.positions.p1 = 20;
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'shield', steps));
  /* Aku aktifkan shield p1, lalu p2 menyerang sebelum menjawab. */
  run(state, (steps) => E.handleAnswer(state, 'p1', 'A', false, steps));
  state.phase = 'answering';
  state.turnForId = 'p2';
  state.currentId = 'p2';
  state.question = state.deck[state.deckIndex];
  state.deckIndex += 1;
  state.deadline = Date.now() + 60000;
  state.arms.p2 = [{ uid: 'w1', key: 'bomb' }];
  const before = state.positions.p1;
  run(state, (steps) => E.handleFireWeapon(state, 'p2', 'w1', 'p1', steps));
  assert.strictEqual(state.positions.p1, before, 'posisi tidak berubah setelah bom');
  assert.strictEqual(Boolean(state.shields.p1), false, 'shield habis');
});

test('shield kedaluwarsa tepat di awal giliran pemilik berikutnya', () => {
  const state = started(3);
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'shield', steps));
  assert.strictEqual(Boolean(state.shields.p1), true);
  answerCorrect(state); // p1 selesai
  assert.strictEqual(Boolean(state.shields.p1), true, 'masih ada selama giliran pemain lain');
  run(state, (steps) => E.handleContinue(state, 'p2', steps));
  answerCorrect(state); // p2
  run(state, (steps) => E.handleContinue(state, 'p3', steps));
  answerCorrect(state); // p3
  assert.strictEqual(state.handoff && state.handoff.playerId, 'p1');
  assert.strictEqual(Boolean(state.shields.p1), false, 'hilang saat giliran p1 dimulai');
});

test('penawar hanya menahan hukuman pemilik', () => {
  const state = started(3);
  state.positions.p1 = 5;
  state.positions.p2 = 6;
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'penawar', steps));
  run(state, (steps) => E.handleAnswer(state, 'p1', 'B', false, steps));
  assert.strictEqual(state.positions.p1, 5);
  assert.strictEqual(state.penawarId, null);

  state.penawarId = 'p1';
  run(state, (steps) => E.handleContinue(state, 'p2', steps));
  run(state, (steps) => E.handleAnswer(state, 'p2', 'B', false, steps));
  assert.strictEqual(state.positions.p2, 3, 'penawar pemain lain tidak berlaku');
});

test('double move hanya menggandakan langkah pemilik', () => {
  const state = started(3);
  state.positions.p2 = 10;
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'doubleMove', steps));
  answerCorrect(state);
  assert.strictEqual(state.positions.p1, 9, 'reward 4 x 2 = 8 langkah');
  run(state, (steps) => E.handleContinue(state, 'p2', steps));
  assert.strictEqual(state.doubleId, null);
  run(state, (steps) => E.handleAnswer(state, 'p2', 'A', false, steps));
  assert.strictEqual(state.positions.p2, 14, 'p2 hanya maju 4 langkah');
});

test('ganti soal hanya mengubah soal aktif pemilik', () => {
  const state = started(3);
  const before = state.question.id;
  const p2Clue = state.helps.p2.changeQuestion;
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'changeQuestion', steps));
  assert.notStrictEqual(state.question.id, before);
  assert.strictEqual(state.clueRevealed, false);
  assert.strictEqual(state.helps.p1.changeQuestion, 0);
  assert.strictEqual(state.helps.p2.changeQuestion, p2Clue);
});

test('soal lemparan: rotasi lanjut dari penerima, bukan pelempar', () => {
  const two = started(2);
  run(two, (steps) => E.handleUseHelp(two, 'p1', 'throwQuestion', steps));
  run(two, (steps) => E.handleContinue(two, 'p2', steps));
  run(two, (steps) => E.handleAnswer(two, 'p2', 'A', false, steps));
  assert.strictEqual(two.handoff && two.handoff.playerId, 'p1', '2 pemain: kembali ke pelempar');

  const three = started(3);
  run(three, (steps) => E.handleUseHelp(three, 'p1', 'throwQuestion', steps));
  run(three, (steps) => E.handleContinue(three, 'p2', steps));
  run(three, (steps) => E.handleAnswer(three, 'p2', 'A', false, steps));
  assert.strictEqual(three.handoff && three.handoff.playerId, 'p3', '3 pemain: lanjut ke pemain berikutnya');
});

test('penerima soal lemparan tetap bisa memakai bantuan selain lempar', () => {
  const state = started(3);
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'throwQuestion', steps));
  run(state, (steps) => E.handleContinue(state, 'p2', steps));
  assert.strictEqual(state.turnForId, 'p2');
  const clueSteps = [];
  E.handleUseHelp(state, 'p2', 'clue', clueSteps);
  assert.ok(clueSteps.length > 0, 'penerima boleh memakai Clue');
  const throwSteps = [];
  E.handleUseHelp(state, 'p2', 'throwQuestion', throwSteps);
  assert.strictEqual(throwSteps.length, 0, 'soal tidak boleh dilempar ulang');
});

test('sisihkan 2 menghapus dua opsi salah dan mengurangi kuota', () => {
  const state = started(3);
  const before = state.helps.p1.eliminateTwo;
  assert.ok(before > 0);
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'eliminateTwo', steps));
  assert.strictEqual(state.eliminated.length, 2);
  assert.strictEqual(state.eliminatedBy, 'p1');
  state.eliminated.forEach((letter) => assert.notStrictEqual(letter, state.question.correctAnswer));
  assert.strictEqual(new Set(state.eliminated).size, 2, 'dua huruf berbeda');
  assert.strictEqual(state.helps.p1.eliminateTwo, before - 1);
  assert.deepStrictEqual(E.publicSnapshot(state).eliminated.slice().sort(), state.eliminated.slice().sort());
});

test('sisihkan 2 hanya untuk pemilik giliran dan kuota', () => {
  const state = started(3);
  const other = [];
  E.handleUseHelp(state, 'p2', 'eliminateTwo', other);
  assert.strictEqual(other.length, 0, 'pemain lain ditolak');
  state.helps.p1.eliminateTwo = 0;
  const empty = [];
  E.handleUseHelp(state, 'p1', 'eliminateTwo', empty);
  assert.strictEqual(empty.length, 0, 'kuota habis ditolak');
});

test('sisihkan 2 ditolak saat fase bukan answering', () => {
  const state = started(3);
  state.phase = 'handoff';
  const steps = [];
  E.handleUseHelp(state, 'p1', 'eliminateTwo', steps);
  assert.strictEqual(steps.length, 0);
});

test('sisihkan 2 direset saat soal baru dimulai', () => {
  const state = started(3);
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'eliminateTwo', steps));
  assert.strictEqual(state.eliminated.length, 2);
  run(state, (steps) => E.handleAnswer(state, 'p1', 'A', false, steps));
  run(state, (steps) => E.handleContinue(state, 'p2', steps));
  assert.deepStrictEqual(state.eliminated, []);
  assert.strictEqual(state.eliminatedBy, null);
});

test('sisihkan 2 direset saat ganti soal', () => {
  const state = started(3);
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'eliminateTwo', steps));
  assert.strictEqual(state.eliminated.length, 2);
  run(state, (steps) => E.handleUseHelp(state, 'p1', 'changeQuestion', steps));
  assert.deepStrictEqual(state.eliminated, []);
});

test('kuota default bantuan memuat Sisihkan 2 dengan nilai 2', () => {
  assert.strictEqual(E.DEFAULT_HELPS().eliminateTwo, 2);
  const help = E.HELPS.find((item) => item.key === 'eliminateTwo');
  assert.ok(help);
  assert.strictEqual(help.group, 'help');
  assert.strictEqual(E.sanitizeHelpQuotas({}, E.DEFAULT_HELPS()).eliminateTwo, 2);
});
