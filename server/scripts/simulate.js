'use strict';

/* Simulasi headless satu permainan penuh melalui Room + engine.
 * Tanpa menyentuh database: RoomManager({persist:false}).
 * Dipakai sebagai regresi cepat: node server/scripts/simulate.js
 */

const os = require('os');
const path = require('path');

const E = require(path.join('..', '..', 'shared', 'engine'));
const { RoomManager } = require(path.join('..', 'rooms'));

function makeQuestions(count) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    list.push({
      question: `Soal ${i + 1}`,
      options: [{ text: 'A?' }, { text: 'B?' }, { text: 'C?' }, { text: 'D?' }],
      correctAnswer: 'A',
      clue: `Petunjuk ${i + 1}`,
      reward: 4,
      penalty: 3,
      duration: 5,
    });
  }
  return list;
}

function runSimulation(playerCount, questionCount) {
  const manager = new RoomManager({ persist: false });
  const room = manager.createRoom({
    bankId: 'sim',
    bankName: 'Simulasi',
    questions: makeQuestions(questionCount),
  });
  room.instant = true;
  room.io = null;

  const players = [];
  for (let slot = 1; slot <= playerCount; slot += 1) {
    const result = room.joinPlayer(`Pemain ${slot}`, slot, null);
    if (!result.player) throw new Error(`gagal menambah pemain ${slot}: ${result.error}`);
    players.push(result.player);
  }

  const startResult = room.start();
  if (!startResult.ok) throw new Error(`start gagal: ${startResult.error}`);

  let guard = 0;
  const events = [];
  const originalBroadcast = room.broadcastEvents.bind(room);
  room.broadcastEvents = (list) => {
    (list || []).forEach((item) => events.push(item));
    originalBroadcast(list);
  };

  while (room.state && room.state.phase !== 'finished' && guard < 4000) {
    guard += 1;
    const state = room.state;
    if (state.phase === 'answering') {
      const owner = state.turnForId;
      const question = state.question;
      if (!question) throw new Error('fase answering tanpa soal');
      const letter = state.picked === 'X' ? 'B' : question.correctAnswer;
      const outcome = room.answer(owner, letter, false);
      if (outcome.error) throw new Error(`answer error: ${outcome.error}`);
    } else if (state.phase === 'bonus') {
      const owner = state.snakeLadder ? state.snakeLadder.playerId : state.turnForId;
      const question = state.snakeLadder && state.snakeLadder.question;
      const outcome = room.answer(owner, question ? question.correctAnswer : null, false);
      if (outcome.error) throw new Error(`bonus error: ${outcome.error}`);
    } else if (state.phase === 'handoff') {
      const owner = state.handoff ? state.handoff.playerId : state.turnForId;
      const outcome = room.continueTurn(owner, true);
      if (outcome.error) throw new Error(`continue error: ${outcome.error}`);
    } else {
      throw new Error(`fase tak terduga: ${state.phase}`);
    }
  }

  if (guard >= 4000) throw new Error('simulasi tidak selesai (loop?)');

  return {
    players: players.length,
    phase: room.state.phase,
    winner: room.state.winner,
    bankLeft: E.bankLeft(room.state),
    events: events.length,
  };
}

function main() {
  const playerCount = Number(process.argv[2]) || 3;
  const questionCount = Number(process.argv[3]) || 40;
  const result = runSimulation(playerCount, questionCount);
  console.log(`Simulasi selesai: ${playerCount} pemain, ${questionCount} soal.`);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Simulasi gagal:', error.message);
    process.exitCode = 1;
  }
}

module.exports = { runSimulation, makeQuestions, os };
