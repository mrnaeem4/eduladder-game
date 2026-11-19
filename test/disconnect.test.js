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
    reward: 4,
    penalty: 3,
    duration: 30,
  }));
}

function run(state, handler) {
  const steps = [];
  handler(steps);
  steps.forEach((item) => item.apply(state));
  return steps;
}

function started(count) {
  const state = E.createGameState(PLAYERS.slice(0, count || 3), questions(40), { shuffle: false });
  run(state, (steps) => E.handleStart(state, steps));
  return state;
}

test('nextPlayerId melewati pemain istirahat', () => {
  const players = [
    { id: 'p1', slot: 1 },
    { id: 'p2', slot: 2, resting: true },
    { id: 'p3', slot: 3 },
  ];
  assert.strictEqual(E.nextPlayerId(players, 'p1'), 'p3');
  assert.strictEqual(E.nextPlayerId(players, 'p3'), 'p1');
});

test('nextPlayerId kembali ke pemain sendiri bila semua istirahat', () => {
  const players = [
    { id: 'p1', slot: 1, resting: true },
    { id: 'p2', slot: 2, resting: true },
  ];
  assert.strictEqual(E.nextPlayerId(players, 'p1'), 'p2');
  assert.strictEqual(E.nextPlayerId(players, 'p2'), 'p1');
});

test('handlePlayerLeft saat menjawab mengalihkan soal tanpa hukuman', () => {
  const state = started(3);
  state.positions.p1 = 10;
  const before = state.positions.p1;
  run(state, (steps) => E.handlePlayerLeft(state, 'p1', steps));
  assert.strictEqual(state.players.find((p) => p.id === 'p1').resting, true);
  assert.strictEqual(state.positions.p1, before, 'tidak ada hukuman mundur');
  assert.strictEqual(state.phase, 'handoff');
  assert.strictEqual(state.handoff.playerId, 'p2');
  assert.strictEqual(state.handoff.reason, 'left');
  assert.strictEqual(state.question, null);
  assert.strictEqual(state.deadline, null);
});

test('handlePlayerLeft melewati pemain istirahat berikutnya', () => {
  const state = started(3);
  state.players.find((p) => p.id === 'p2').resting = true;
  run(state, (steps) => E.handlePlayerLeft(state, 'p1', steps));
  assert.strictEqual(state.handoff.playerId, 'p3');
});

test('handlePlayerLeft pada fase handoff memajukan handoff', () => {
  const state = started(3);
  state.phase = 'handoff';
  state.handoff = { playerId: 'p2', mode: 'next', reason: 'answer' };
  run(state, (steps) => E.handlePlayerLeft(state, 'p2', steps));
  assert.strictEqual(state.handoff.playerId, 'p3');
  assert.strictEqual(state.players.find((p) => p.id === 'p2').resting, true);
});

test('handlePlayerBack mengaktifkan pemain lagi', () => {
  const state = started(3);
  run(state, (steps) => E.handlePlayerLeft(state, 'p1', steps));
  run(state, (steps) => E.handlePlayerBack(state, 'p1', steps));
  assert.strictEqual(state.players.find((p) => p.id === 'p1').resting, false);
});

test('handleStart melewati pemain istirahat untuk giliran pertama', () => {
  const roster = [
    { id: 'p1', slot: 1, name: 'A', resting: true },
    { id: 'p2', slot: 2, name: 'B' },
  ];
  const state = E.createGameState(roster, questions(10), { shuffle: false });
  run(state, (steps) => E.handleStart(state, steps));
  assert.strictEqual(state.currentId, 'p2');
  assert.strictEqual(state.turnForId, 'p2');
});

test('ranking menandai pemain istirahat dan tetap menampilkan posisinya', () => {
  const state = started(3);
  state.positions.p1 = 40;
  run(state, (steps) => E.handlePlayerLeft(state, 'p1', steps));
  const ranking = E.buildRanking(state);
  const entry = ranking.find((item) => item.id === 'p1');
  assert.ok(entry);
  assert.strictEqual(entry.pos, 40);
  assert.strictEqual(entry.resting, true);
});

test('addLatePlayer menambah pemain di giliran berikutnya', () => {
  const state = started(2);
  run(state, (steps) => E.addLatePlayer(state, { id: 'p3', slot: 3, char: 4, name: 'Cici' }, steps));
  assert.strictEqual(state.players.length, 3);
  assert.strictEqual(state.positions.p3, 1);
  assert.deepStrictEqual(state.helps.p3, E.DEFAULT_HELPS());
  assert.deepStrictEqual(state.arms.p3, []);
  assert.strictEqual(E.nextPlayerId(state.players, 'p2'), 'p3');
  assert.strictEqual(E.nextPlayerId(state.players, 'p3'), 'p1');
  assert.ok(E.publicSnapshot(state).players.some((item) => item.id === 'p3'));
});
