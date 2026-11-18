'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSteps(room, steps) {
  if (!Array.isArray(steps) || !steps.length) {
    if (typeof room.finishRun === 'function') room.finishRun();
    else room.onStepsDone();
    return;
  }

  room.runToken += 1;
  const token = room.runToken;
  room.clearDeadline();

  for (const item of steps) {
    if (room.runToken !== token) return;
    const current = item || {};
    try {
      if (typeof current.apply === 'function') current.apply(room.state);
    } catch (error) {
      console.error('[game-loop] apply gagal:', error);
    }
    room.state.seq += 1;
    room.broadcastSnapshot();
    room.broadcastEvents(current.events || []);
    room.emitQuestion();
    if (typeof room.persistLiveState === 'function') room.persistLiveState();
    if (current.delayMs > 0 && !room.instant) await sleep(current.delayMs);
  }

  if (room.runToken !== token) return;
  if (typeof room.finishRun === 'function') room.finishRun();
  else room.onStepsDone();
}

module.exports = { runSteps, sleep };
