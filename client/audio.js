/* Mesin audio klien: BGM + efek suara dari assets/sound + sintetis Web Audio. */
window.AudioKit = (function () {
  const SOUND_BASE = '/assets/sound/';
  const SOUND_FILES = {
    ladder: `${SOUND_BASE}fluteup.mp3`,
    snake: `${SOUND_BASE}flutedown.mp3`,
    bomb: `${SOUND_BASE}boom.mp3`,
    magnet: `${SOUND_BASE}magnet.mp3`,
  };
  const BGM_SRC = `${SOUND_BASE}bgm_main.mp3`;
  const BGM_VOLUME = 0.32;
  const SFX_VOLUME = 0.85;

  const SFX_RECIPES = {
    portal: { type: 'sine', start: 0.05, from: 520, to: 880, dur: 0.18, gain: 0.28, repeat: 2 },
    trap: { type: 'square', start: 0.02, from: 420, to: 180, dur: 0.16, gain: 0.22 },
    block: { type: 'triangle', start: 0.01, from: 220, to: 120, dur: 0.22, gain: 0.3 },
    correct: { type: 'sine', start: 0.04, from: 520, to: 980, dur: 0.22, gain: 0.26 },
    wrong: { type: 'square', start: 0.03, from: 260, to: 110, dur: 0.26, gain: 0.24 },
    click: { type: 'triangle', start: 0.01, from: 520, to: 620, dur: 0.06, gain: 0.14 },
  };

  let engine = null;

  function getEngine() {
    if (!engine) engine = createEngine();
    return engine;
  }

  function playSfx(ctx, kind) {
    if (!ctx) return;
    const recipe = SFX_RECIPES[kind];
    if (!recipe) return;
    const now = ctx.currentTime;
    const repeats = recipe.repeat || 1;
    for (let i = 0; i < repeats; i++) {
      const at = now + i * (recipe.dur + 0.05);
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(recipe.gain, at + recipe.start);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + recipe.start + recipe.dur);
      const osc = ctx.createOscillator();
      osc.type = recipe.type;
      osc.frequency.setValueAtTime(recipe.from, at);
      osc.frequency.exponentialRampToValueAtTime(recipe.to, at + recipe.dur);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + recipe.dur);
    }
  }

  function createEngine() {
    let ctx = null;
    let bgm = null;
    let fadeTimer = null;
    const pools = {};

    const getCtx = () => {
      if (!ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        try {
          ctx = new Ctor();
        } catch (error) {
          return null;
        }
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
      return ctx;
    };

    const poolFor = (key) => {
      if (!SOUND_FILES[key]) return null;
      if (!pools[key]) {
        pools[key] = [0, 1].map(() => {
          const el = new Audio(SOUND_FILES[key]);
          el.preload = 'auto';
          el.volume = SFX_VOLUME;
          return el;
        });
      }
      return pools[key];
    };

    const prime = () => {
      Object.keys(SOUND_FILES).forEach((key) => {
        const pool = poolFor(key);
        if (pool) pool.forEach((el) => { try { el.load(); } catch (error) { /* abaikan */ } });
      });
    };

    const playFile = (key) => {
      const pool = poolFor(key);
      if (!pool) return false;
      const el = pool.find((item) => item.paused || item.ended) || pool[0];
      try {
        el.currentTime = 0;
        el.volume = SFX_VOLUME;
        const playing = el.play();
        if (playing && playing.catch) playing.catch(() => {});
        return true;
      } catch (error) {
        return false;
      }
    };

    const fadeTo = (target, step, done) => {
      if (fadeTimer) clearInterval(fadeTimer);
      fadeTimer = setInterval(() => {
        if (!bgm) {
          clearInterval(fadeTimer);
          fadeTimer = null;
          return;
        }
        const delta = target - bgm.volume;
        if (Math.abs(delta) <= step) {
          bgm.volume = target;
          clearInterval(fadeTimer);
          fadeTimer = null;
          if (done) done();
          return;
        }
        bgm.volume += Math.sign(delta) * step;
      }, 70);
    };

    const startBgm = () => {
      try {
        if (!bgm) {
          bgm = new Audio(BGM_SRC);
          bgm.loop = true;
          bgm.preload = 'auto';
          bgm.volume = 0;
        }
        if (bgm.paused) {
          const playing = bgm.play();
          if (playing && playing.catch) playing.catch(() => {});
        }
        if (bgm.volume >= BGM_VOLUME - 0.01 && !fadeTimer) return;
        fadeTo(BGM_VOLUME, 0.02);
      } catch (error) {
        /* abaikan */
      }
    };

    const stopBgm = () => {
      if (!bgm) return;
      fadeTo(0, 0.05, () => {
        if (!bgm) return;
        try {
          bgm.pause();
          bgm.currentTime = 0;
        } catch (error) {
          /* abaikan */
        }
      });
    };

    const dispose = () => {
      if (fadeTimer) {
        clearInterval(fadeTimer);
        fadeTimer = null;
      }
      if (bgm) {
        try { bgm.pause(); } catch (error) { /* abaikan */ }
        bgm = null;
      }
      Object.keys(pools).forEach((key) => {
        pools[key].forEach((el) => { try { el.pause(); } catch (error) { /* abaikan */ } });
        delete pools[key];
      });
      if (ctx && ctx.close) {
        try { ctx.close(); } catch (error) { /* abaikan */ }
      }
      ctx = null;
    };

    return { getCtx, playFile, startBgm, stopBgm, prime, dispose };
  }

  function sfx(kind, enabled) {
    if (enabled === false) return;
    try {
      const e = getEngine();
      if (e.playFile(kind)) return;
      const ctx = e.getCtx();
      if (ctx) playSfx(ctx, kind);
    } catch (error) {
      /* abaikan */
    }
  }

  return { getEngine, sfx, prime: () => getEngine().prime(), startBgm: () => getEngine().startBgm(), stopBgm: () => getEngine().stopBgm(), dispose: () => { if (engine) engine.dispose(); engine = null; } };
})();
