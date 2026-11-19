const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const E = require(path.join('..', 'shared', 'engine'));
const { RoomManager } = require(path.join('..', 'server', 'rooms'));

function questions(count) {
  return Array.from({ length: count }, (_, i) => ({
    question: `Soal ${i + 1}`,
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    correctAnswer: 'A',
    clue: '',
    reward: 4,
    penalty: 3,
    duration: 30,
  }));
}

function fakeIo() {
  return {
    to() {
      return { emit() {} };
    },
    socketsLeave() {},
    sockets: { sockets: new Map() },
  };
}

function playingRoom() {
  const manager = new RoomManager({ persist: false });
  const room = manager.createRoom({ bankId: 'b', bankName: 'Uji', questions: questions(30) });
  room.setIo(fakeIo());
  room.joinPlayer('Satu', 1, null);
  room.joinPlayer('Dua', 2, null);
  room.instant = true;
  room.start();
  room.state.phase = 'answering';
  room.state.turnForId = 'p1';
  room.state.currentId = 'p1';
  room.state.question = room.state.deck[room.state.deckIndex];
  room.state.deckIndex += 1;
  room.state.deadline = Date.now() + 30000;
  room.state.deadlineSetAt = Date.now();
  room.state.arms.p1 = [{ uid: 'w1', key: 'bomb' }];
  /* Tahan fase: langkah hit sesudahnya tidak langsung jalan saat instan. */
  room.instant = false;
  return { room };
}

test('serangan menggeser deadline tepat FX_PAUSE_MS dan mengisi attackFx', () => {
  const { room } = playingRoom();
  const before = room.state.deadline;
  room.fireWeapon('p1', 'w1', 'p2');
  /* Langkah pertama berjalan sinkron di runSteps(). */
  assert.strictEqual(room.state.deadline, before + E.FX_PAUSE_MS);
  assert.ok(room.state.attackFx, 'attackFx terisi');
  assert.strictEqual(room.state.attackFx.actorId, 'p1');
  assert.strictEqual(room.state.attackFx.targetId, 'p2');
  assert.strictEqual(room.state.attackFx.weapon, 'bomb');
  const pub = E.publicSnapshot(room.state);
  assert.strictEqual(pub.attackFx.actorId, 'p1');
  assert.strictEqual(pub.attackFx.until, undefined, 'until tidak dikirim ke klien');
  room.runToken += 1;
  room.clearDeadline();
});

test('jawaban dan bantuan ditolak selama attackFx', () => {
  const { room } = playingRoom();
  room.fireWeapon('p1', 'w1', 'p2');
  assert.deepStrictEqual(room.answer('p1', 'A', false), { error: 'busy' });
  assert.deepStrictEqual(room.useHelp('p1', 'clue'), { error: 'busy' });
  assert.deepStrictEqual(room.fireWeapon('p1', 'w1', 'p2'), { error: 'busy' });
  room.runToken += 1;
  room.clearDeadline();
});

test('attackFx dibersihkan setelah langkah serangan selesai', async () => {
  const { room } = playingRoom();
  room.instant = true;
  room.fireWeapon('p1', 'w1', 'p2');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(room.state.attackFx, null);
  assert.strictEqual(room.state.phase, 'answering');
  room.clearDeadline();
});

test('selama attackFx engine menolak bantuan dan serangan kedua', () => {
  const state = E.createGameState(
    [{ id: 'p1', slot: 1, name: 'A' }, { id: 'p2', slot: 2, name: 'B' }],
    questions(10),
    { shuffle: false }
  );
  const steps = [];
  E.handleStart(state, steps);
  steps.forEach((item) => item.apply(state));
  state.phase = 'answering';
  state.turnForId = 'p1';
  state.currentId = 'p1';
  state.arms.p1 = [{ uid: 'w1', key: 'bomb' }, { uid: 'w2', key: 'magnet' }];
  const fired = [];
  E.handleFireWeapon(state, 'p1', 'w1', 'p2', fired);
  fired[0].apply(state);
  assert.ok(state.attackFx);
  const help = [];
  E.handleUseHelp(state, 'p1', 'clue', help);
  assert.strictEqual(help.length, 0);
  const second = [];
  E.handleFireWeapon(state, 'p1', 'w2', 'p2', second);
  assert.strictEqual(second.length, 0);
});
