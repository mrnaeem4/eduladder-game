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

function playingRoom(options) {
  const opts = options || {};
  const manager = new RoomManager({ persist: false, graceMs: 10000 });
  const room = manager.createRoom({
    bankId: 'b',
    bankName: 'Uji',
    questions: questions(30),
    maxPlayers: 4,
    allowLateJoin: opts.allowLateJoin !== false,
    lateJoinAllowance: 2,
  });
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
  return { manager, room };
}

test('snapshot memuat status pemain, allowLateJoin, dan serverNow', () => {
  const { room } = playingRoom();
  const snap = room.snapshotFor({ role: 'admin', key: 'admin' });
  assert.strictEqual(typeof snap.serverNow, 'number');
  assert.strictEqual(snap.config.allowLateJoin, true);
  assert.deepStrictEqual(snap.restingIds, []);
  snap.players.forEach((player) => assert.ok(['active', 'resting', 'left'].includes(player.status)));
  const payload = room.questionPayload();
  assert.strictEqual(typeof payload.serverNow, 'number');
});

test('joinPlayer saat permainan berjalan: allowLateJoin=false menjadi penonton', () => {
  const { room } = playingRoom({ allowLateJoin: false });
  const result = room.joinPlayer('Tiga', 3, null);
  assert.ok(result.spectator, 'masuk sebagai penonton');
  assert.strictEqual(room.players.length, 2);
});

test('joinPlayer saat permainan berjalan: allowLateJoin=true menjadi pemain baru di kotak 1', () => {
  const { room } = playingRoom();
  const result = room.joinPlayer('Tiga', 3, null);
  assert.ok(result.player, 'masuk sebagai pemain');
  assert.strictEqual(result.lateJoin, true);
  assert.strictEqual(result.player.slot, 3);
  assert.strictEqual(room.state.positions.p3, 1);
  assert.strictEqual(room.state.players.length, 3);
  assert.strictEqual(room.state.players.find((p) => p.id === 'p3').resting, false);
  assert.ok(room.snapshotFor(null).players.some((p) => p.id === 'p3'));
});

test('jatah late join habis: pemain berikutnya menjadi penonton', () => {
  const { room } = playingRoom();
  assert.ok(room.joinPlayer('Tiga', 3, null).player);
  assert.ok(room.joinPlayer('Empat', 4, null).player);
  const extra = room.joinPlayer('Lima', null, null);
  assert.ok(extra.spectator);
});

test('room penuh saat berjalan: menjadi penonton walau allowLateJoin aktif', () => {
  const { room } = playingRoom();
  room.joinPlayer('Tiga', 3, null);
  room.joinPlayer('Empat', 4, null);
  const result = room.joinPlayer('Lima', 5, null);
  assert.ok(result.spectator);
  assert.strictEqual(room.players.length, 4);
});

test('detach sebelum masa tenggang tidak mengubah giliran', () => {
  const { room } = playingRoom();
  const socket = { id: 'sock-p1', identity: { role: 'player', key: 'p1', token: room.playerById('p1').token } };
  room.attach(socket, socket.identity);
  room.detach(socket);
  assert.strictEqual(room.state.turnForId, 'p1');
  assert.strictEqual(room.playerById('p1').status, 'active');
  assert.strictEqual(room.playerById('p1').connected, false);
  assert.ok(room.graceTimers.has('p1'));
  room.clearGrace('p1');
});

test('setelah masa tenggang pemain istirahat dan soal dialihkan', () => {
  const { room } = playingRoom();
  const socket = { id: 'sock-p1', identity: { role: 'player', key: 'p1', token: room.playerById('p1').token } };
  room.attach(socket, socket.identity);
  room.detach(socket);
  room.clearGrace('p1');
  room.playerLeft('p1');
  assert.strictEqual(room.playerById('p1').status, 'resting');
  assert.strictEqual(room.state.phase, 'handoff');
  assert.strictEqual(room.state.handoff.playerId, 'p2');
  assert.strictEqual(room.state.players.find((p) => p.id === 'p1').resting, true);
  assert.deepStrictEqual(room.snapshotFor(null).restingIds, ['p1']);
});

test('reconnect menghapus status istirahat', () => {
  const { room } = playingRoom();
  const token = room.playerById('p1').token;
  const socket = { id: 'sock-p1', identity: { role: 'player', key: 'p1', token } };
  room.attach(socket, socket.identity);
  room.detach(socket);
  room.clearGrace('p1');
  room.playerLeft('p1');
  const member = room.reconnectMember(token, 'Satu');
  assert.strictEqual(member.error, undefined);
  assert.strictEqual(member.back, true);
  assert.strictEqual(room.playerById('p1').status, 'active');
  assert.strictEqual(room.state.players.find((p) => p.id === 'p1').resting, false);
});

test('masa tenggang 0 langsung membuat pemain istirahat', () => {
  const manager = new RoomManager({ persist: false, graceMs: 0 });
  const room = manager.createRoom({ bankId: 'b', bankName: 'Uji', questions: questions(10), maxPlayers: 4 });
  room.setIo(fakeIo());
  room.joinPlayer('Satu', 1, null);
  room.joinPlayer('Dua', 2, null);
  room.instant = true;
  room.start();
  room.state.phase = 'answering';
  room.state.turnForId = 'p1';
  room.state.currentId = 'p1';
  const socket = { id: 'sock-p1', identity: { role: 'player', key: 'p1', token: room.playerById('p1').token } };
  room.attach(socket, socket.identity);
  room.detach(socket);
  assert.strictEqual(room.playerById('p1').status, 'resting');
});

test('kick pemain pemilik soal mengalihkan tanpa hukuman', () => {
  const { room } = playingRoom();
  room.state.positions.p1 = 20;
  room.kick('p1');
  assert.strictEqual(room.state.positions.p1, 20);
  assert.strictEqual(room.state.handoff.playerId, 'p2');
});

test('reaksi lobi: validasi kunci, fase, dan throttle', () => {
  const manager = new RoomManager({ persist: false });
  const room = manager.createRoom({ bankId: 'b', bankName: 'Uji', questions: questions(10) });
  room.setIo(fakeIo());
  room.joinPlayer('Satu', 1, null);
  assert.deepStrictEqual(room.react('p1', 'nope'), { error: 'invalid' });
  assert.strictEqual(room.react('p1', 'party').ok, true);
  assert.deepStrictEqual(room.react('p1', 'clap'), { error: 'rate_limited' });
  assert.deepStrictEqual(room.react('p9', 'clap'), { error: 'not_member' });
  room.state = E.createGameState([{ id: 'p1', slot: 1, char: 1, name: 'Satu' }, { id: 'p2', slot: 2, char: 2, name: 'Dua' }], questions(10));
  room.state.phase = 'answering';
  room.lastReactionAt.clear();
  assert.deepStrictEqual(room.react('p1', 'party'), { error: 'bad_phase' });
});

test('replay mengaktifkan lagi pemain yang istirahat', () => {
  const { room } = playingRoom();
  room.kick('p1');
  room.playerById('p2').status = 'resting';
  room.replay();
  assert.strictEqual(room.playerById('p1').status, 'active');
  assert.strictEqual(room.playerById('p2').status, 'active');
  assert.strictEqual(room.playerById('p1').kicked, false);
});
