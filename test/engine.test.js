const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const E = require(path.join('..', 'shared', 'engine'));
const { runSimulation, makeQuestions } = require(path.join('..', 'server', 'scripts', 'simulate'));

test('parseCsv membaca soal valid dan melaporkan baris rusak', () => {
  const csv = [
    'Pertanyaan;Pilihan A;Pilihan B;Pilihan C;Pilihan D;Jawaban Benar;Clue;Reward;Penalty;Durasi',
    'Apa 2+2?;2;3;4;5;C;jumlah;5;3;15',
    'Rusak;1;2;3;4;Z;tidak valid;5;3;15',
  ].join('\n');
  const result = parseSafe(csv);
  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].correctAnswer, 'C');
  assert.strictEqual(result.errors.length, 1);
});

function parseSafe(csv) {
  return E.parseCsv(csv);
}

test('validateBoard menerima peta bawaan', () => {
  assert.deepStrictEqual(E.BOARD_ERRORS, []);
});

test('buildDeck menghormati shuffle dan panjang', () => {
  const deck = E.buildDeck(makeQuestions(10), false);
  assert.strictEqual(deck.length, 10);
  assert.strictEqual(deck[0].question, 'Soal 1');
});

test('redactQuestion tidak mengirim clue maupun kunci jawaban', () => {
  const question = E.normalizeQuestion({
    question: 'Q',
    clue: 'RAHASIA',
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    correctAnswer: 'C',
  }, 0);
  const redacted = E.redactQuestion(question);
  assert.strictEqual('clue' in redacted, false, 'clue tidak boleh ikut');
  assert.strictEqual(redacted.correctAnswer, undefined);
});

test('publicSnapshot menyertakan peringkat dari engine', () => {
  const players = [
    { id: 'p1', slot: 1, name: 'A' },
    { id: 'p2', slot: 2, name: 'B' },
  ];
  const state = E.createGameState(players, makeQuestions(6), {});
  state.positions = { p1: 12, p2: 30 };
  const ranking = E.publicSnapshot(state).ranking;
  assert.deepStrictEqual(ranking.map((row) => row.id), ['p2', 'p1']);
  assert.strictEqual(ranking[0].pos, 30);
});

function runSteps(state, handler) {
  const steps = [];
  handler(steps);
  steps.forEach((item) => {
    if (typeof item.apply === 'function') item.apply(state);
  });
  return steps;
}

test('clue tidak terbawa ke giliran pemain berikutnya', () => {
  const players = [
    { id: 'p1', slot: 1, name: 'A' },
    { id: 'p2', slot: 2, name: 'B' },
  ];
  const state = E.createGameState(players, makeQuestions(12), {});
  runSteps(state, (steps) => E.handleStart(state, steps));
  assert.strictEqual(state.phase, 'answering');
  assert.strictEqual(state.turnForId, 'p1');
  assert.strictEqual(state.clueRevealed, false);

  const p2ClueBefore = state.helps.p2.clue;
  runSteps(state, (steps) => E.handleUseHelp(state, 'p1', 'clue', steps));
  assert.strictEqual(state.clueRevealed, true);
  assert.strictEqual(state.helps.p1.clue, 0, 'kuota clue pemakai berkurang');
  assert.strictEqual(state.helps.p2.clue, p2ClueBefore, 'kuota clue pemain lain tidak tersentuh');

  const answer = state.question.correctAnswer;
  runSteps(state, (steps) => E.handleAnswer(state, 'p1', answer, false, steps));
  assert.strictEqual(state.phase, 'handoff');
  assert.strictEqual(state.clueRevealed, false, 'clue tertutup saat giliran berakhir');

  runSteps(state, (steps) => E.handleContinue(state, 'p2', steps));
  assert.strictEqual(state.turnForId, 'p2');
  assert.strictEqual(state.clueRevealed, false, 'clue tidak boleh terbawa ke giliran berikutnya');
  assert.ok(state.question, 'soal baru tersedia');

  /* Pemain 2 tetap bisa memakai Clue miliknya sendiri. */
  const helpSteps = [];
  E.handleUseHelp(state, 'p2', 'clue', helpSteps);
  assert.ok(helpSteps.length > 0, 'Clue pemain 2 tetap bisa dipakai');
});

test('clue tertutup lagi setelah bantuan ganti soal', () => {
  const players = [
    { id: 'p1', slot: 1, name: 'A' },
    { id: 'p2', slot: 2, name: 'B' },
  ];
  const state = E.createGameState(players, makeQuestions(12), {});
  runSteps(state, (steps) => E.handleStart(state, steps));
  runSteps(state, (steps) => E.handleUseHelp(state, 'p1', 'clue', steps));
  assert.strictEqual(state.clueRevealed, true);
  runSteps(state, (steps) => E.handleUseHelp(state, 'p1', 'changeQuestion', steps));
  assert.strictEqual(state.clueRevealed, false);
});

test('sanitizeMaxPlayers membatasi 2..25 dengan default 4', () => {
  assert.strictEqual(E.sanitizeMaxPlayers(undefined), 4);
  assert.strictEqual(E.sanitizeMaxPlayers('abc'), 4);
  assert.strictEqual(E.sanitizeMaxPlayers(0), 2);
  assert.strictEqual(E.sanitizeMaxPlayers(99), 25);
  assert.strictEqual(E.sanitizeMaxPlayers('12'), 12);
});

test('assignCharacter memakai permintaan valid atau karakter paling sedikit dipakai', () => {
  assert.strictEqual(E.assignCharacter([], 7), 7);
  assert.strictEqual(E.assignCharacter([], 99), 1);
  assert.strictEqual(E.assignCharacter([{ char: 1 }, { char: 1 }, { char: 2 }]), 3);
  /* Duplikat tetap diizinkan bila diminta. */
  assert.strictEqual(E.assignCharacter([{ char: 4 }], 4), 4);
  assert.strictEqual(E.CHARACTERS.length, 10);
});

test('themeVars mengikuti karakter, bukan nomor slot', () => {
  const style = E.themeVars({ slot: 1, char: 5 });
  assert.strictEqual(style['--team'], E.characterStyle(5).color);
  assert.notStrictEqual(style['--team'], E.characterStyle(1).color);
});

function answerEvents(state, handler) {
  const steps = [];
  handler(steps);
  const events = [];
  steps.forEach((item) => {
    if (typeof item.apply === 'function') item.apply(state);
    (item.events || []).forEach((event) => events.push(event));
  });
  return events;
}

function freshStarted() {
  const players = [
    { id: 'p1', slot: 1, char: 1, name: 'A' },
    { id: 'p2', slot: 2, char: 2, name: 'B' },
  ];
  const state = E.createGameState(players, makeQuestions(20), { shuffle: false });
  answerEvents(state, (steps) => E.handleStart(state, steps));
  return state;
}

function scorePopOf(events) {
  return events.find((event) => event && event.type === 'scorePop');
}

test('scorePop: jawaban benar memberi delta reward hijau', () => {
  const state = freshStarted();
  const events = answerEvents(state, (steps) => E.handleAnswer(state, 'p1', state.question.correctAnswer, false, steps));
  const pop = scorePopOf(events);
  assert.strictEqual(pop.delta, state.deck[0].reward);
  assert.strictEqual(pop.tone, 'good');
});

test('scorePop: Double Move menggandakan reward', () => {
  const state = freshStarted();
  answerEvents(state, (steps) => E.handleUseHelp(state, 'p1', 'doubleMove', steps));
  const events = answerEvents(state, (steps) => E.handleAnswer(state, 'p1', state.question.correctAnswer, false, steps));
  const pop = scorePopOf(events);
  assert.strictEqual(pop.delta, state.deck[0].reward * 2);
  assert.strictEqual(pop.tone, 'good');
});

test('scorePop: jawaban salah dan timeout memberi delta penalty merah', () => {
  const wrongState = freshStarted();
  const wrong = scorePopOf(answerEvents(wrongState, (steps) => E.handleAnswer(wrongState, 'p1', 'B', false, steps)));
  assert.strictEqual(wrong.delta, -wrongState.deck[0].penalty);
  assert.strictEqual(wrong.tone, 'bad');

  const timeoutState = freshStarted();
  const timeout = scorePopOf(answerEvents(timeoutState, (steps) => E.handleAnswer(timeoutState, 'p1', null, true, steps)));
  assert.strictEqual(timeout.delta, -timeoutState.deck[0].penalty);
  assert.strictEqual(timeout.tone, 'bad');
});

test('scorePop: Shield/Penawar/locked memberi delta 0 netral', () => {
  const shieldState = freshStarted();
  answerEvents(shieldState, (steps) => E.handleUseHelp(shieldState, 'p1', 'shield', steps));
  const shielded = scorePopOf(answerEvents(shieldState, (steps) => E.handleAnswer(shieldState, 'p1', 'B', false, steps)));
  assert.strictEqual(shielded.delta, 0);
  assert.strictEqual(shielded.tone, 'neutral');

  const penawarState = freshStarted();
  answerEvents(penawarState, (steps) => E.handleUseHelp(penawarState, 'p1', 'penawar', steps));
  const penawar = scorePopOf(answerEvents(penawarState, (steps) => E.handleAnswer(penawarState, 'p1', 'B', false, steps)));
  assert.strictEqual(penawar.delta, 0);
  assert.strictEqual(penawar.tone, 'neutral');

  const lockedState = freshStarted();
  lockedState.locked.p1 = true;
  const locked = scorePopOf(answerEvents(lockedState, (steps) => E.handleAnswer(lockedState, 'p1', lockedState.question.correctAnswer, false, steps)));
  assert.strictEqual(locked.delta, 0);
  assert.strictEqual(locked.tone, 'neutral');
});

for (const count of [2, 3, 4]) {
  test(`simulasi permainan penuh dengan ${count} pemain selesai`, () => {
    const result = runSimulation(count, 60);
    assert.strictEqual(result.phase, 'finished');
    assert.ok(result.winner);
  });
}
