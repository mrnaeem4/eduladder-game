const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const E = require(path.join('..', 'shared', 'engine'));
const { RoomManager } = require(path.join('..', 'server', 'rooms'));

function makeQuestions(count) {
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

function fakeIo(events) {
  return {
    to() {
      return { emit: (event) => events.push(event) };
    },
    socketsLeave() {},
    sockets: { sockets: new Map() },
  };
}

function playingRoom() {
  const manager = new RoomManager({ persist: false });
  const room = manager.createRoom({ bankId: 'b', bankName: 'Uji', questions: makeQuestions(8) });
  const events = [];
  room.setIo(fakeIo(events));
  room.joinPlayer('Satu', 1, null);
  room.joinPlayer('Dua', 2, null);
  room.instant = true;
  room.start();
  return { room, events };
}

test('permainan selesai tidak mengirim room:closed (popup pemenang tetap tampil)', () => {
  const { room, events } = playingRoom();
  room.state.phase = 'finished';
  room.state.winner = 'p1';
  room.state.winnerReason = 'tes';
  events.length = 0;
  room.onStepsDone();
  assert.strictEqual(events.includes('room:closed'), false);
  assert.strictEqual(room.state.phase, 'finished');
});

test('mencapai kotak 100 menetapkan pemenang dan tidak menutup room', () => {
  const { room, events } = playingRoom();
  room.state.phase = 'answering';
  room.state.turnForId = 'p1';
  room.state.currentId = 'p1';
  room.state.positions.p1 = 98;
  room.state.question = room.state.deck[room.state.deckIndex];
  room.state.deckIndex += 1;

  const steps = [];
  E.handleAnswer(room.state, 'p1', 'A', false, steps);
  room.runToken = 0;
  steps.forEach((item) => {
    if (typeof item.apply === 'function') item.apply(room.state);
  });
  room.state.seq += 1;
  events.length = 0;
  room.broadcastSnapshot();
  room.persistLiveState(true);

  assert.strictEqual(room.state.positions.p1, E.WIN_POSITION);
  assert.strictEqual(room.state.winner, 'p1');
  assert.strictEqual(room.state.phase, 'finished');
  assert.strictEqual(events.includes('room:closed'), false);
});

test('replay dari fase selesai mengembalikan room ke lobi', () => {
  const { room } = playingRoom();
  room.state.phase = 'finished';
  room.state.winner = 'p1';
  room.replay();
  assert.strictEqual(room.state, null);
  assert.strictEqual(room.status, 'lobby');
});
