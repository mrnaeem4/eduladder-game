const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { RoomManager } = require(path.join('..', 'server', 'rooms'));

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

function fakeIo() {
  const calls = [];
  return {
    calls,
    to(target) {
      return {
        emit(event, payload) {
          calls.push({ target, event, payload });
        },
      };
    },
    socketsLeave(code) {
      calls.push({ target: code, event: 'socketsLeave' });
    },
    sockets: { sockets: new Map() },
  };
}

function playingRoom() {
  const manager = new RoomManager({ persist: false });
  const room = manager.createRoom({ bankId: 'b', bankName: 'Uji', questions: questions(20) });
  const io = fakeIo();
  room.setIo(io);
  room.joinPlayer('Satu', 1, null);
  room.joinPlayer('Dua', 2, null);
  room.instant = true;
  room.start();
  room.sockets.set('p1', 'sock-p1');
  room.sockets.set('p2', 'sock-p2');
  room.sockets.set('admin', 'sock-admin');
  room.state.phase = 'answering';
  room.state.turnForId = 'p1';
  room.state.currentId = 'p1';
  room.state.question = room.state.deck[room.state.deckIndex];
  room.state.deckIndex += 1;
  room.state.deadline = Date.now() + 30000;
  io.calls.length = 0;
  return { manager, room, io };
}

test('payload soal hanya dikirim ke pemilik; pemain lain menerima null', () => {
  const { room, io } = playingRoom();
  room.emitQuestion();
  const toP1 = io.calls.find((c) => c.target === 'sock-p1' && c.event === 'question');
  const toP2 = io.calls.find((c) => c.target === 'sock-p2' && c.event === 'question');
  const toAdmin = io.calls.find((c) => c.target === 'sock-admin' && c.event === 'question');
  assert.ok(toP1 && toP1.payload.question, 'pemilik menerima soal');
  assert.strictEqual(toP2.payload.question, null, 'pemain lain menerima null');
  assert.ok(toAdmin && toAdmin.payload.question, 'admin menerima soal untuk layar besar');
});

test('saat giliran berpindah, pemilik lama menerima question null', () => {
  const { room, io } = playingRoom();
  room.emitQuestion();
  assert.ok(io.calls.find((c) => c.target === 'sock-p1' && c.event === 'question').payload.question);

  /* Pindah giliran ke p2 dan kirim ulang. */
  io.calls.length = 0;
  room.state.turnForId = 'p2';
  room.state.currentId = 'p2';
  room.state.question = room.state.deck[room.state.deckIndex];
  room.state.deckIndex += 1;
  room.emitQuestion();

  const toP1 = io.calls.find((c) => c.target === 'sock-p1' && c.event === 'question');
  const toP2 = io.calls.find((c) => c.target === 'sock-p2' && c.event === 'question');
  assert.strictEqual(toP1.payload.question, null, 'soal lama dibersihkan di layar pemilik lama');
  assert.ok(toP2.payload.question, 'pemilik baru menerima soal');
});

test('menutup sesi mengirim room:closed dan melepas room', () => {
  const { manager, room, io } = playingRoom();
  room.closeSession();
  const closed = io.calls.find((c) => c.event === 'room:closed');
  assert.ok(closed, 'room:closed terkirim');
  assert.strictEqual(closed.payload.reason, 'closed');
  assert.ok(io.calls.some((c) => c.event === 'socketsLeave'), 'klien dikeluarkan dari room');
  assert.strictEqual(manager.get(room.code), null, 'room dilepas dari memori');
  assert.strictEqual(room.state.phase, 'finished');
});
