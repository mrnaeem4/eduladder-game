const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const E = require(path.join('..', 'shared', 'engine'));

/* Countdown: deadline dibuat server, angka dihitung klien dengan offset jam. */

test('remainingSeconds menghitung sisa detik dari deadline', () => {
  assert.strictEqual(E.remainingSeconds(20000, 20, 0, 0, 5000), 15);
  assert.strictEqual(E.remainingSeconds(20000, 20, 0, 0, 0), 20);
});

test('offset jam server dikoreksi sebelum menghitung sisa', () => {
  /* Jam klien 3 menit di belakang server (offset 180000 ms). Deadline server
     20000 ms terlihat "masih 195 detik" bila jam tidak dikoreksi. */
  const deadline = 20000;
  const clientNow = 5000;
  const clientWall = clientNow - 180000;
  assert.strictEqual(Math.ceil((deadline - clientWall) / 1000), 195);
  /* Dengan offset, jam klien diproyeksikan ke jam server. */
  const projected = clientWall + 180000;
  assert.strictEqual(E.remainingSeconds(deadline, 20, 0, 0, projected), 15);
  /* Tanpa koreksi, batas atas durasi soal tetap menahan angka. */
  assert.strictEqual(E.remainingSeconds(deadline, 20, 0, 0, clientWall), 20);
});

test('remainingSeconds tidak pernah melebihi durasi soal', () => {
  /* Jam klien 10 menit di belakang server: hasil mentah 600 detik. */
  assert.strictEqual(E.remainingSeconds(600000, 15, 0, 0, 0), 15);
  assert.strictEqual(E.remainingSeconds(600000, 10, 0, 0, 0), 10);
});

test('remainingSeconds berhenti di nol setelah deadline lewat', () => {
  assert.strictEqual(E.remainingSeconds(1000, 15, 0, 0, 1400), 0);
  assert.strictEqual(E.remainingSeconds(1000, 15, 0, 0, 5000), 0);
});

test('safety pad hanya memperpanjang selama deadline belum lewat', () => {
  const deadline = 10000;
  assert.strictEqual(E.remainingSeconds(deadline, 15, 0, 0, 9750), 1);
  assert.strictEqual(E.remainingSeconds(deadline, 15, 0, 250, 9750), 1);
  /* Sesudah deadline tetap 0 walau pad aktif. */
  assert.strictEqual(E.remainingSeconds(deadline, 15, 0, 250, 10000), 0);
});

test('tanpa deadline tidak ada countdown', () => {
  assert.strictEqual(E.remainingSeconds(null, 15, 0, 0, 0), null);
});

test('setiap deadline yang dibuat engine punya deadlineSetAt dan durasi <= soal', () => {
  const players = [
    { id: 'p1', slot: 1, name: 'A' },
    { id: 'p2', slot: 2, name: 'B' },
  ];
  const questions = Array.from({ length: 6 }, (_, i) => ({
    question: `Soal ${i + 1}`,
    options: ['a', 'b', 'c', 'd'],
    correctAnswer: 'A',
    reward: 4,
    penalty: 3,
    duration: 30,
  }));
  const state = E.createGameState(players, questions, { shuffle: false });
  const steps = [];
  E.handleStart(state, steps);
  steps.forEach((item) => item.apply(state));
  assert.ok(state.deadline > Date.now());
  assert.ok(state.deadlineSetAt > 0);
  assert.strictEqual(E.publicSnapshot(state).deadlineSetAt, state.deadlineSetAt, 'deadlineSetAt ikut di snapshot');
  const remaining = E.remainingSeconds(state.deadline, 30, 0, 250, Date.now());
  assert.ok(remaining <= 30 && remaining >= 29);
});
