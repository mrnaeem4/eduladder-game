const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const E = require(path.join('..', 'shared', 'engine'));
const db = require(path.join('..', 'server', 'db'));
const store = require(path.join('..', 'server', 'room-store'));
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

function tempDb(name) {
  const file = path.join(os.tmpdir(), `eduladder-char-${name}-${process.pid}.db`);
  try { fs.unlinkSync(file); } catch (error) { /* ignore */ }
  return file;
}

test('room maxPlayers membatasi pemain dan sisanya menjadi penonton', () => {
  const manager = new RoomManager({ persist: false });
  const room = manager.createRoom({ bankId: 'b', bankName: 'Batas', questions: questions(8), maxPlayers: 3 });
  assert.strictEqual(room.config.maxPlayers, 3);

  const satu = room.joinPlayer('Satu', null, null);
  const dua = room.joinPlayer('Dua', null, null);
  const tiga = room.joinPlayer('Tiga', null, null);
  assert.ok(satu.player && dua.player && tiga.player);
  assert.deepStrictEqual(room.players.map((player) => player.slot), [1, 2, 3]);

  const empat = room.joinPlayer('Empat', null, null);
  assert.ok(empat.spectator, 'pemain ke-(max+1) menjadi penonton');
  assert.strictEqual(room.players.length, 3);
});

test('lobby:setCharacter hanya di lobi, tersimpan, dan bertahan saat reconnect', () => {
  const file = tempDb('lobby');
  process.env.EDULADDER_DB = file;
  db.open();

  const manager = new RoomManager();
  const room = manager.createRoom({ bankId: 'b', bankName: 'Karakter', questions: questions(10), maxPlayers: 5 });
  const satu = room.joinPlayer('Satu', null, null);
  const dua = room.joinPlayer('Dua', null, null);

  assert.strictEqual(room.setCharacter(satu.player.id, 7).ok, true);
  assert.strictEqual(room.playerById(satu.player.id).char, 7);
  assert.strictEqual(room.setCharacter(satu.player.id, 0).error, 'invalid');
  assert.strictEqual(room.setCharacter('p99', 3).error, 'not_found_player');

  const record = store.loadRoom(room.code);
  assert.strictEqual(record.config.maxPlayers, 5);
  assert.strictEqual(record.players.find((player) => player.id === satu.player.id).char, 7);

  /* Reconnect memakai token yang sama → karakter tidak berubah. */
  const reconnected = room.reconnectMember(satu.token, 'Satu');
  assert.strictEqual(reconnected.role, 'player');
  assert.strictEqual(room.playerById(satu.player.id).char, 7);

  /* Restart: room dimuat ulang dari SQLite membawa char + maxPlayers. */
  const manager2 = new RoomManager();
  const restored = manager2.ensure(room.code);
  assert.ok(restored, 'room dipulihkan');
  assert.strictEqual(restored.config.maxPlayers, 5);
  assert.strictEqual(restored.playerById(satu.player.id).char, 7);

  /* Setelah permainan berjalan, karakter tidak bisa diubah. */
  const playing = new RoomManager({ persist: false });
  const live = playing.createRoom({ bankId: 'b', bankName: 'Jalan', questions: questions(10) });
  const a = live.joinPlayer('A', null, null);
  live.joinPlayer('B', null, null);
  live.instant = true;
  live.start();
  assert.strictEqual(live.setCharacter(a.player.id, 4).error, 'bad_phase');

  db.close();
});

test('config lama tanpa maxPlayers memakai default 4', () => {
  const file = tempDb('default');
  process.env.EDULADDER_DB = file;
  const handle = db.open();

  const manager = new RoomManager();
  const room = manager.createRoom({ bankId: 'b', bankName: 'Lama', questions: questions(6) });
  handle.prepare('UPDATE rooms SET config = ? WHERE code = ?').run(JSON.stringify({ shuffle: true }), room.code);

  const record = store.loadRoom(room.code);
  assert.strictEqual(record.config.maxPlayers, 4);
  assert.strictEqual(E.sanitizeMaxPlayers(undefined), 4);
  db.close();
});
