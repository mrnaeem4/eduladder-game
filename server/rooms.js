'use strict';

const E = require('../shared/engine');
const security = require('./security');
const store = require('./room-store');
const { runSteps } = require('./game-loop');

/* Reaksi lobi: kunci valid, throttle per pemain, dan TTL callout. */
const REACTION_KEYS = ['thumbs', 'clap', 'party', 'wow', 'fire', 'heart'];
const REACTION_COOLDOWN_MS = 2000;
const REACTION_TTL_MS = 4000;

class Room {
  constructor(opts) {
    this.code = opts.code;
    this.bankId = opts.bankId || null;
    this.bankName = opts.bankName || 'Bank soal';
    this.questions = opts.questions || [];
    const config = opts.config || {};
    this.config = {
      shuffle: config.shuffle !== false,
      helpQuotas: E.sanitizeHelpQuotas(config.helpQuotas, E.DEFAULT_HELPS()),
      maxPlayers: E.sanitizeMaxPlayers(config.maxPlayers),
      allowLateJoin: config.allowLateJoin !== false,
    };
    this.players = opts.players || [];
    this.spectators = [];
    this.sockets = new Map();
    this.tokens = new Map();
    this.state = opts.state || null;
    this.runToken = 0;
    this.io = null;
    this.timer = null;
    this.graceTimers = new Map();
    this.reactions = [];
    this.lastReactionAt = new Map();
    this.closed = false;
    this.graceMs = typeof opts.graceMs === 'number' ? Math.max(0, opts.graceMs) : 10000;
    this.lateJoinAllowance = Math.max(0, Number(opts.lateJoinAllowance) || 0);
    this.lateJoined = 0;
    this.startedAt = opts.startedAt || 0;
    this.lastActivity = Date.now();
    this.persist = opts.persist !== false;
    this.status = opts.status || (this.state ? this.state.phase : 'lobby');
    this.intent = null;
    (this.players || []).forEach((player) => {
      player.connected = false;
      if (!player.status) player.status = player.resting ? 'resting' : 'active';
      if (player.token) this.tokens.set(player.token, player.id);
    });
  }

  setIo(io) {
    this.io = io;
  }

  /* ---------------- reaksi lobi (ephemeral) ---------------- */

  react(playerId, key) {
    if (!REACTION_KEYS.includes(key)) return { error: 'invalid' };
    if (!this.identityOfPlayer(playerId)) return { error: 'not_member' };
    if (this.state && this.state.phase !== 'lobby') return { error: 'bad_phase' };
    const now = Date.now();
    const last = this.lastReactionAt.get(playerId) || 0;
    if (now - last < REACTION_COOLDOWN_MS) return { error: 'rate_limited' };
    this.lastReactionAt.set(playerId, now);
    const reaction = { id: `${now}-${Math.floor(Math.random() * 1000)}`, playerId, key, at: now };
    this.reactions.push(reaction);
    /* TTL 4 detik + maksimal 50 antrean agar memori tetap kecil. */
    this.reactions = this.reactions.filter((item) => now - item.at < REACTION_TTL_MS).slice(-50);
    if (this.io) {
      this.sockets.forEach((socketId) => this.io.to(socketId).emit('lobby:reaction', reaction));
    }
    return { ok: true, reaction };
  }

  identityOfPlayer(id) {
    return this.playerById(id) || null;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  /* ---------------- persistensi ---------------- */

  initStorage() {
    if (!this.persist) return;
    try {
      store.insertRoom(this);
      store.savePlayers(this);
      if (this.state) store.saveState(this, this.state);
    } catch (error) {
      console.error('[room] gagal menyimpan room:', error);
    }
  }

  persistPlayers() {
    if (!this.persist) return;
    try {
      store.savePlayers(this);
    } catch (error) {
      console.error('[room] gagal menyimpan pemain:', error);
    }
  }

  /* Ditulis setelah setiap langkah fase. Tulis state stabil (fase yang
     menunggu input pemain) segera, dan tunda penulisan fase animasi singkat
     agar tidak ada penulisan SQLite sinkron di setiap langkah animasi.
     Fase animasi selalu disertai checkpoint, jadi kehilangan tulis terakhir
     tetap pulih dengan benar. */
  persistLiveState(force) {
    if (!this.persist || !this.state) return;
    const stable = ['answering', 'bonus', 'handoff', 'finished', 'lobby'].includes(this.state.phase);
    if (!force && !stable) return;
    try {
      store.saveState(this, this.state);
      if (this.state.phase === 'finished') this.onFinished();
    } catch (error) {
      console.error('[room] gagal menyimpan state:', error);
    }
  }

  onFinished() {
    if (this.finishedAt) return;
    this.finishedAt = Date.now();
    this.status = 'finished';
    if (!this.persist) return;
    try {
      store.setStatus(this, 'finished');
      /* Satu pertandingan = satu baris riwayat: room yang sudah selesai dan
         dibuka ulang pasca-restart tidak boleh mengarsipkan lagi. */
      if (store.matchCount(this.code, this.startedAt) === 0) store.archiveMatch(this);
    } catch (error) {
      console.error('[room] gagal mengarsipkan hasil:', error);
    }
    /* Lepas dari memori setelah diarsipkan; room tetap bisa dibuka lagi dari
       SQLite lewat RoomManager.ensure(). */
    if (this.manager) this.manager.scheduleEvict(this);
  }

  /* ---------------- anggota ---------------- */

  playerById(id) {
    return this.players.find((item) => item.id === id) || null;
  }

  playerBySlot(slot) {
    return this.players.find((item) => item.slot === slot) || null;
  }

  playerByToken(token) {
    if (!token) return null;
    return this.players.find((item) => item.token === token) || null;
  }

  freeSlot() {
    const maxPlayers = E.sanitizeMaxPlayers(this.config && this.config.maxPlayers);
    for (let slot = 1; slot <= maxPlayers; slot += 1) {
      if (!this.playerBySlot(slot)) return slot;
    }
    return null;
  }

  isPlaying() {
    return Boolean(this.state) && !['lobby', 'finished'].includes(this.state.phase);
  }

  attach(socket, identity) {
    socket.identity = identity;
    socket.roomCode = this.code;
    if (identity.role === 'admin') this.sockets.set('admin', socket.id);
    else this.sockets.set(identity.key, socket.id);
  }

  detach(socket) {
    const identity = socket.identity;
    if (!identity) return;
    if (identity.role === 'admin') {
      if (this.sockets.get('admin') === socket.id) this.sockets.delete('admin');
    } else {
      if (this.sockets.get(identity.key) === socket.id) this.sockets.delete(identity.key);
      if (identity.role === 'player') {
        const player = this.playerById(identity.key);
        if (player) {
          player.connected = false;
          /* Pemain yang keluar saat masih di lobi langsung dilepas; saat
             permainan berjalan dia mendapat masa tenggang untuk reconnect,
             setelah itu dinyatakan istirahat dan gilirannya dilewati. */
          if (!this.isPlaying()) {
            this.players = this.players.filter((item) => item.id !== player.id);
            this.tokens.delete(player.token);
            this.persistPlayers();
          } else if (player.status !== 'resting') {
            this.scheduleGrace(player.id);
          }
        }
      } else if (identity.role === 'spectator') {
        this.spectators = this.spectators.filter((item) => item.token !== identity.token);
        this.tokens.delete(identity.token);
      }
    }
    this.touch();
    this.broadcastSnapshot();
    /* Room selesai tanpa klien tersisa: lepas dari memori. Data tetap di
       SQLite dan bisa dimuat lagi lewat RoomManager.ensure(). */
    if (this.status === 'finished' && this.sockets.size === 0 && this.manager) {
      this.manager.remove(this);
    }
  }

  /* ---------------- masa tenggang terputus ---------------- */

  scheduleGrace(playerId) {
    this.clearGrace(playerId);
    if (!playerId) return;
    if (this.graceMs <= 0) {
      const player = this.playerById(playerId);
      if (player) player.restingSince = Date.now();
      this.playerLeft(playerId);
      return;
    }
    const timer = setTimeout(() => {
      this.graceTimers.delete(playerId);
      this.playerLeft(playerId);
    }, this.graceMs);
    if (timer.unref) timer.unref();
    this.graceTimers.set(playerId, timer);
  }

  clearGrace(playerId) {
    const timer = this.graceTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(playerId);
  }

  /* Pemain melewati masa tenggang: tandai istirahat dan alihkan giliran bila
     soal sedang miliknya. Tidak ada hukuman. */
  playerLeft(playerId) {
    const player = this.playerById(playerId);
    if (!player) return { error: 'not_found' };
    if (player.kicked) return { error: 'kicked' };
    /* Sudah reconnect sebelum timer berbunyi. */
    if (this.sockets.has(playerId)) return { error: 'connected' };
    if (!this.state || !this.isPlaying()) return { error: 'bad_phase' };
    if (player.status === 'resting') return { error: 'already_resting' };

    player.status = 'resting';
    player.restingSince = Date.now();
    this.persistPlayers();
    const steps = [];
    E.handlePlayerLeft(this.state, playerId, steps);
    if (steps.length) this.run(steps, { type: 'player-left', playerId });
    else this.broadcastSnapshot();
    return { ok: true };
  }

  /* Kembalikan pemain dari istirahat (reconnect). */
  restorePlayer(player) {
    if (!player) return false;
    this.clearGrace(player.id);
    player.connected = true;
    player.restingSince = 0;
    if (player.status !== 'resting') {
      player.status = 'active';
      return false;
    }
    player.status = 'active';
    this.persistPlayers();
    if (this.state && this.isPlaying()) {
      const steps = [];
      E.handlePlayerBack(this.state, player.id, steps);
      if (steps.length) {
        this.run(steps, { type: 'player-back', playerId: player.id });
        return true;
      }
    }
    return true;
  }

  joinPlayer(name, slot, token, requestedChar) {
    const restored = this.playerByToken(token);
    if (restored) {
      if (restored.kicked) return { error: 'kicked' };
      restored.connected = true;
      if (name) restored.name = security.sanitizeName(name) || restored.name;
      if (!restored.char) restored.char = E.assignCharacter(this.players, requestedChar);
      /* Reconnect dari status istirahat: aktif lagi tanpa denda. */
      const back = this.restorePlayer(restored);
      return { player: restored, token: restored.token, back };
    }

    const maxPlayers = E.sanitizeMaxPlayers(this.config && this.config.maxPlayers);
    if (this.players.length >= maxPlayers) {
      return { spectator: this.joinSpectator(name) };
    }

    if (this.isPlaying()) {
      /* Join di tengah permainan hanya bila room mengizinkannya dan jatah
         late-join room masih tersisa (diatur saat room dibuat). */
      if (this.config.allowLateJoin === false) return { spectator: this.joinSpectator(name) };
      if (this.lateJoined >= this.lateJoinAllowance) return { spectator: this.joinSpectator(name) };
      const safeName = security.sanitizeName(name);
      if (!safeName) return { error: 'name_required' };
      const target = this.freeSlot();
      if (!target) return { spectator: this.joinSpectator(name) };
      const player = {
        id: `p${target}`,
        slot: target,
        char: E.assignCharacter(this.players, requestedChar),
        name: safeName,
        token: security.randomToken(),
        connected: true,
        kicked: false,
        status: 'active',
        restingSince: 0,
        joinedMidGame: true,
      };
      this.players.push(player);
      this.players.sort((a, b) => a.slot - b.slot);
      this.tokens.set(player.token, player.id);
      this.lateJoined += 1;
      this.touch();
      this.persistPlayers();
      const steps = [];
      E.addLatePlayer(this.state, player, steps);
      if (steps.length) this.run(steps, { type: 'late-join', playerId: player.id });
      else this.broadcastSnapshot();
      return { player, token: player.token, lateJoin: true };
    }

    let target = Number(slot);
    if (!Number.isInteger(target) || target < 1 || target > maxPlayers || this.playerBySlot(target)) {
      target = this.freeSlot();
    }
    const safeName = security.sanitizeName(name);
    if (!safeName) return { error: 'name_required' };
    if (!target) return { spectator: this.joinSpectator(name) };

    const player = {
      id: `p${target}`,
      slot: target,
      char: E.assignCharacter(this.players, requestedChar),
      name: safeName,
      token: security.randomToken(),
      connected: true,
      kicked: false,
      status: 'active',
      restingSince: 0,
    };
    this.players.push(player);
    this.players.sort((a, b) => a.slot - b.slot);
    this.tokens.set(player.token, player.id);
    this.touch();
    this.persistPlayers();
    return { player, token: player.token };
  }

  /* Ganti karakter di lobi. Ditolak setelah permainan berjalan. */
  setCharacter(playerId, charId) {
    if (this.state && this.state.phase !== 'lobby') return { error: 'bad_phase' };
    const player = this.playerById(playerId);
    if (!player) return { error: 'not_found_player' };
    const id = parseInt(charId, 10);
    if (!Number.isInteger(id) || id < 1 || id > E.CHARACTERS.length) return { error: 'invalid' };
    player.char = id;
    this.touch();
    this.persistPlayers();
    this.broadcastSnapshot();
    return { ok: true };
  }

  joinSpectator(name) {
    const spectator = { token: security.randomToken(), name: security.sanitizeName(name) || `Penonton ${this.spectators.length + 1}`, connected: true };
    this.spectators.push(spectator);
    this.tokens.set(spectator.token, `spec:${spectator.token}`);
    return spectator;
  }

  reconnectMember(token, name) {
    if (!token) return { error: 'not_member' };
    const owner = this.tokens.get(token);
    if (!owner) return { error: 'not_member' };
    if (owner.startsWith('spec:')) {
      const spectator = this.spectators.find((item) => item.token === token);
      if (!spectator) return { error: 'not_member' };
      spectator.connected = true;
      return { role: 'spectator', key: spectator.token, token };
    }
    const player = this.playerById(owner);
    if (!player) return { error: 'not_member' };
    if (player.kicked) return { error: 'kicked' };
    player.connected = true;
    if (name) player.name = security.sanitizeName(name) || player.name;
    const back = this.restorePlayer(player);
    return { role: 'player', key: player.id, token, back };
  }

  updateConfig(patch) {
    if (!patch || typeof patch !== 'object') return { error: 'invalid' };
    if (this.isPlaying()) return { error: 'already_started' };
    const next = { ...this.config };
    if (typeof patch.shuffle === 'boolean') next.shuffle = patch.shuffle;
    if (patch.helpQuotas) next.helpQuotas = E.sanitizeHelpQuotas(patch.helpQuotas, next.helpQuotas || E.DEFAULT_HELPS());
    if (typeof patch.maxPlayers !== 'undefined') next.maxPlayers = E.sanitizeMaxPlayers(patch.maxPlayers);
    /* allowLateJoin hanya diset saat room dibuat; di sini nilainya dipertahankan. */
    this.config = next;
    if (this.persist) store.insertRoom(this);
    this.broadcastSnapshot();
    return { ok: true };
  }

  /* ---------------- snapshot ---------------- */

  snapshotFor(viewer, sharedPublic) {
    const identity = viewer || { role: 'spectator' };
    const base = {
      code: this.code,
      bankName: this.bankName,
      bankCount: this.questions.length,
      canEditConfig: !this.isPlaying(),
      /* Jam server untuk koreksi countdown (lihat Net.trackServerNow). */
      serverNow: Date.now(),
      config: {
        shuffle: this.config.shuffle !== false,
        helpQuotas: E.sanitizeHelpQuotas(this.config.helpQuotas, E.DEFAULT_HELPS()),
        maxPlayers: E.sanitizeMaxPlayers(this.config.maxPlayers),
        allowLateJoin: this.config.allowLateJoin !== false,
      },
      players: this.players.map((item) => ({
        id: item.id,
        slot: item.slot,
        char: item.char || 1,
        name: item.name,
        connected: Boolean(item.connected),
        status: item.status || (item.resting ? 'resting' : 'active'),
        joinedMidGame: Boolean(item.joinedMidGame),
      })),
      restingIds: this.players.filter((item) => item.status === 'resting').map((item) => item.id),
      spectators: this.spectators.map((item) => ({ name: item.name, connected: Boolean(item.connected) })),
      you: {
        role: identity.role,
        key: identity.key || null,
        char: identity.role === 'player' ? (this.playerById(identity.key) || {}).char || 1 : null,
      },
      phase: this.state ? this.state.phase : 'lobby',
      state: null,
    };
    if (!this.state) return base;

    /* publicSnapshot deep-clones helps/arms; hitung sekali per broadcast lalu
       pakai ulang untuk semua penerima (hanya `you` yang berbeda per klien). */
    let pub = sharedPublic;
    if (!pub) {
      pub = E.publicSnapshot(this.state);
      pub.gameSeconds = this.startedAt ? Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)) : 0;
      pub.roomCode = this.code;
    }
    return { ...base, state: pub };
  }

  broadcastSnapshot() {
    if (!this.io) return;
    const shared = this.state ? E.publicSnapshot(this.state) : null;
    if (shared) {
      shared.gameSeconds = this.startedAt ? Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)) : 0;
      shared.roomCode = this.code;
    }
    this.sockets.forEach((socketId, key) => {
      const identity = key === 'admin' ? { role: 'admin', key: 'admin' } : this.identityOf(key);
      this.io.to(socketId).emit('room:snapshot', this.snapshotFor(identity, shared));
    });
  }

  identityOf(key) {
    if (this.playerById(key)) return { role: 'player', key };
    if (this.spectators.some((item) => item.token === key)) return { role: 'spectator', key };
    return { role: 'spectator' };
  }

  broadcastEvents(events) {
    if (!this.io || !Array.isArray(events) || !events.length) return;
    const payload = events.map((item) => ({ ...item, code: this.code }));
    this.sockets.forEach((socketId) => this.io.to(socketId).emit('game:events', payload));
  }

  activeQuestionInfo() {
    if (!this.state) return null;
    if (this.state.phase === 'bonus' && this.state.snakeLadder && this.state.snakeLadder.question) {
      return { ownerId: this.state.snakeLadder.playerId, question: this.state.snakeLadder.question, deadline: this.state.deadline, bonus: true };
    }
    if (this.state.question && (this.state.phase === 'answering' || this.state.phase === 'resolving')) {
      return { ownerId: this.state.turnForId, question: this.state.question, deadline: this.state.deadline, bonus: false };
    }
    return null;
  }

  questionPayload() {
    const info = this.activeQuestionInfo();
    if (!info) return null;
    const clueRevealed = Boolean(this.state.clueRevealed);
    return {
      question: E.redactQuestion(info.question),
      deadline: info.deadline,
      serverNow: Date.now(),
      bonus: Boolean(info.bonus),
      correct: this.state.revealed ? info.question.correctAnswer : null,
      picked: this.state.revealed ? this.state.picked : null,
      ownerId: info.ownerId,
      clueRevealed,
      /* Clue hanya dikirim setelah bantuan Clue dipakai. */
      clue: clueRevealed ? info.question.clue || '' : null,
      from: this.state.snakeLadder && info.bonus ? { from: this.state.snakeLadder.from, to: this.state.snakeLadder.to, type: this.state.snakeLadder.type } : null,
    };
  }

  emitQuestion() {
    if (!this.io || !this.state) return;
    const payload = this.questionPayload();
    /* Semua klien menerima event yang sama bentuknya: pemilik soal (dan
       admin) mendapat payload, yang lain mendapat `question: null` agar
       overlay soal lama tidak tertinggal di layar mereka. */
    this.sockets.forEach((socketId, key) => {
      const identity = key === 'admin' ? { role: 'admin', key: 'admin' } : this.identityOf(key);
      const isOwner = payload && identity.role === 'player' && identity.key === payload.ownerId;
      const isAdmin = identity.role === 'admin';
      const body = payload && (isOwner || isAdmin)
        ? payload
        : { question: null, ownerId: payload ? payload.ownerId : null, phase: this.state.phase };
      this.io.to(socketId).emit('question', body);
    });
  }

  sendStateTo(socket) {
    if (!socket) return;
    socket.emit('room:snapshot', this.snapshotFor(socket.identity));
    const payload = this.questionPayload();
    const isOwner = payload && socket.identity && payload.ownerId === socket.identity.key;
    const isAdmin = socket.identity && socket.identity.role === 'admin';
    if (payload && (isOwner || isAdmin)) socket.emit('question', payload);
    else socket.emit('question', { question: null, ownerId: payload ? payload.ownerId : null, phase: this.state ? this.state.phase : 'lobby' });
  }

  /* ---------------- clock ---------------- */

  clearDeadline() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  scheduleDeadline() {
    this.clearDeadline();
    if (!this.state || !this.state.deadline) return;
    const remaining = Math.max(0, this.state.deadline - Date.now()) + E.ANSWER_GRACE_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onDeadline();
    }, remaining);
    if (this.timer.unref) this.timer.unref();
  }

  onDeadline() {
    if (!this.state) return;
    const phase = this.state.phase;
    if (phase === 'answering') {
      this.answer(this.state.turnForId, null, true);
    } else if (phase === 'bonus' && this.state.snakeLadder) {
      const steps = [];
      const ownerId = this.state.snakeLadder.playerId;
      E.handleBonusAnswer(this.state, ownerId, false, steps);
      this.recordAnswerEvent(ownerId, null, true, true);
      this.run(steps, { type: 'bonus-timeout', playerId: ownerId });
    }
  }

  /* ---------------- runner ---------------- */

  run(steps, intent) {
    if (!Array.isArray(steps) || !steps.length) return;
    this.touch();
    this.clearDeadline();
    this.intent = intent || null;
    if (intent && this.persist) {
      try {
        store.saveCheckpoint(this, this.state, intent);
      } catch (error) {
        console.error('[room] gagal menyimpan checkpoint:', error);
      }
    }
    runSteps(this, steps).catch((error) => console.error('[room] fase gagal:', error));
  }

  /* Dipanggil game-loop saat semua langkah selesai. */
  finishRun() {
    this.intent = null;
    if (this.persist) {
      try {
        store.clearCheckpoint(this);
      } catch (error) {
        console.error('[room] gagal membersihkan checkpoint:', error);
      }
    }
    this.onStepsDone();
  }

  onStepsDone() {
    if (!this.state) return;
    if (this.state.phase === 'answering' || this.state.phase === 'bonus') this.scheduleDeadline();
    else this.clearDeadline();
    this.state.seq += 1;
    this.broadcastSnapshot();
    this.emitQuestion();
    /* Akhir fase: paksa simpan walau fase transien, agar tidak ada progres
       yang hilang bila server berhenti sebelum fase stabil berikutnya. */
    this.persistLiveState(true);
  }

  /* ---------------- intent ---------------- */

  start() {
    if (this.isPlaying()) return { error: 'already_started' };
    if (this.players.length < 2) return { error: 'need_players' };
    const minimum = Math.max(E.MIN_QUESTIONS, this.players.length);
    if (this.questions.length < minimum) return { error: 'need_questions' };

    const roster = this.players.map((item) => ({
      id: item.id,
      slot: item.slot,
      char: item.char || 1,
      name: item.name,
      resting: item.status === 'resting',
    }));
    this.state = E.createGameState(roster, this.questions, {
      roomCode: this.code,
      shuffle: this.config.shuffle !== false,
      helpQuotas: this.config.helpQuotas,
    });
    this.startedAt = Date.now();
    this.finishedAt = 0;
    this.lateJoined = 0;
    this.status = 'playing';
    if (this.persist) store.setStatus(this, 'playing');

    const steps = [];
    E.handleStart(this.state, steps);
    this.run(steps, { type: 'start' });
    return { ok: true };
  }

  answer(playerId, letter, timedOut) {
    if (!this.state) return { error: 'no_game' };
    /* Soal dijeda selama animasi serangan. */
    if (this.state.attackFx) return { error: 'busy' };
    if (this.state.phase === 'bonus') {
      if (!this.state.snakeLadder || this.state.snakeLadder.playerId !== playerId) return { error: 'not_owner' };
      const correct = Boolean(this.state.snakeLadder.question) && letter === this.state.snakeLadder.question.correctAnswer;
      const steps = [];
      E.handleBonusAnswer(this.state, playerId, correct, steps);
      if (!steps.length) return { error: 'invalid' };
      this.recordAnswerEvent(playerId, letter, timedOut, true);
      this.run(steps, { type: 'bonus-answer', playerId, letter });
      return { ok: true, correct };
    }
    if (this.state.phase !== 'answering') return { error: 'bad_phase' };
    if (this.state.turnForId !== playerId) return { error: 'not_your_turn' };
    const steps = [];
    E.handleAnswer(this.state, playerId, letter, Boolean(timedOut), steps);
    if (!steps.length) return { error: 'invalid' };
    this.recordAnswerEvent(playerId, letter, timedOut, false);
    this.run(steps, { type: 'answer', playerId, letter, timedOut: Boolean(timedOut) });
    return { ok: true };
  }

  /* Simpan satu jawaban ke DB. Dipanggil sebelum langkah permainan berjalan,
     jadi state masih mencerminkan kondisi saat pemain menjawab. */
  recordAnswerEvent(playerId, letter, timedOut, bonus) {
    if (!this.persist || !this.state) return;
    const state = this.state;
    const player = this.playerById(playerId);
    if (!player) return;
    const picked = letter === undefined ? null : letter;
    let kind = 'utama';
    let question = state.question;
    if (bonus) {
      kind = state.snakeLadder && state.snakeLadder.type === 'ladder' ? 'tangga' : 'ular';
      question = state.snakeLadder ? state.snakeLadder.question : null;
    }
    if (!question) return;

    const options = (question.options || []).map((option) => (option && typeof option === 'object' ? String(option.text || '') : String(option === undefined || option === null ? '' : option)));
    const index = picked && ['A', 'B', 'C', 'D'].includes(picked) ? picked.charCodeAt(0) - 65 : -1;
    const pickedText = index >= 0 ? options[index] || '' : '';
    const isCorrect = Boolean(picked) && picked === question.correctAnswer;
    const isTimedOut = Boolean(timedOut);

    let delta = 0;
    let tone = 'neutral';
    if (bonus) {
      delta = 0;
      tone = 'neutral';
    } else if (isCorrect) {
      if (!state.locked[playerId]) {
        delta = state.doubleId === playerId ? question.reward * 2 : question.reward;
        tone = 'good';
      }
    } else if (state.penawarId !== playerId && !state.shields[playerId]) {
      delta = -question.penalty;
      tone = 'bad';
    }

    try {
      store.recordAnswer(this, {
        seq: state.seq,
        kind,
        questionId: question.id || null,
        question: question.question || '',
        picked,
        pickedText,
        correctAnswer: question.correctAnswer || '',
        isCorrect,
        timedOut: isTimedOut,
        delta,
        tone,
        playerId: player.id,
        playerSlot: player.slot,
        playerName: player.name,
        char: player.char || 1,
      });
    } catch (error) {
      console.error('[room] gagal menyimpan jawaban:', error);
    }
  }

  useHelp(playerId, key) {
    if (!this.state || this.state.phase !== 'answering') return { error: 'bad_phase' };
    if (this.state.attackFx) return { error: 'busy' };
    if (this.state.turnForId !== playerId) return { error: 'not_your_turn' };
    const steps = [];
    E.handleUseHelp(this.state, playerId, key, steps);
    if (!steps.length) return { error: 'unavailable' };
    this.run(steps, { type: 'help', playerId, key });
    return { ok: true };
  }

  fireWeapon(playerId, uid, targetId) {
    if (!this.state || this.state.phase !== 'answering') return { error: 'bad_phase' };
    if (this.state.attackFx) return { error: 'busy' };
    if (this.state.currentId !== playerId) return { error: 'not_your_turn' };
    const steps = [];
    E.handleFireWeapon(this.state, playerId, uid, targetId, steps);
    if (!steps.length) return { error: 'invalid' };
    this.run(steps, { type: 'weapon', playerId, uid, targetId });
    return { ok: true };
  }

  continueTurn(playerId, force) {
    if (!this.state || this.state.phase !== 'handoff' || !this.state.handoff) return { error: 'bad_phase' };
    const owner = this.state.handoff.playerId;
    if (!force && playerId !== owner) return { error: 'not_owner' };
    const steps = [];
    E.handleContinue(this.state, owner, steps);
    if (!steps.length) return { error: 'invalid' };
    this.run(steps, { type: 'continue', playerId: owner });
    return { ok: true };
  }

  kick(playerId) {
    const player = this.playerById(playerId);
    if (!player) return { error: 'not_found' };
    player.kicked = true;
    player.connected = false;
    const socketId = this.sockets.get(playerId);
    if (socketId && this.io) {
      const target = this.io.sockets.sockets.get(socketId);
      /* Putuskan soket agar klien yang dikeluarkan tidak bisa lagi mengirim
         aksi permainan (socket identity tetap tersimpan sampai disconnect). */
      if (target) {
        target.emit('room:closed', { reason: 'kicked', code: this.code });
        target.disconnect(true);
      } else {
        this.io.to(socketId).emit('room:closed', { reason: 'kicked', code: this.code });
      }
      this.sockets.delete(playerId);
    }
    if (!this.isPlaying()) {
      this.players = this.players.filter((item) => item.id !== playerId);
      this.tokens.delete(player.token);
      this.persistPlayers();
      this.broadcastSnapshot();
      return { ok: true };
    }
    this.clearGrace(playerId);
    player.status = 'left';
    this.persistPlayers();
    /* Soal milik pemain yang dikeluarkan dialihkan tanpa hukuman; pemain
       penonton giliran tetap diproses lewat alur sebelumnya. */
    if (this.state.phase === 'answering' && this.state.turnForId === playerId) {
      const steps = [];
      E.handlePlayerLeft(this.state, playerId, steps);
      this.run(steps, { type: 'player-left', playerId });
      return { ok: true };
    }
    if (this.state.phase === 'handoff' && this.state.handoff && this.state.handoff.playerId === playerId) {
      const steps = [];
      E.handleContinue(this.state, playerId, steps);
      this.run(steps, { type: 'continue', playerId });
      return { ok: true };
    }
    this.broadcastSnapshot();
    return { ok: true };
  }

  /* Akhiri sesi: selesaikan permainan (bila masih berjalan) lalu tutup room.
     Room tetap tersimpan di SQLite dengan status 'finished' sehingga admin
     bisa melihatnya di daftar room, tetapi semua klien keluar dari sesi. */
  closeSession() {
    this.closed = true;
    this.graceTimers.forEach((timer) => clearTimeout(timer));
    this.graceTimers.clear();
    this.reactions = [];
    if (this.state && this.state.phase !== 'finished') {
      this.clearDeadline();
      this.state.phase = 'finished';
      this.state.winner = null;
      this.state.winnerReason = 'Permainan diakhiri oleh admin.';
      this.state.handoff = null;
      this.state.question = null;
      this.state.snakeLadder = null;
      this.state.deadline = null;
      this.state.clueRevealed = false;
      this.state.seq += 1;
      this.onFinished();
      this.broadcastSnapshot();
    } else if (this.state) {
      this.onFinished();
    }

    const code = this.code;
    if (this.manager) this.manager.unscheduleEvict(this);
    if (this.io) {
      this.io.to(code).emit('room:closed', { reason: 'closed', code });
      this.io.socketsLeave(code);
    }
    this.sockets.clear();
    this.tokens.clear();
    this.spectators = [];
    this.players.forEach((player) => { player.connected = false; });
    this.status = 'finished';
    if (this.manager) this.manager.remove(this);
    return { ok: true };
  }

  endGame() {
    return this.closeSession();
  }

  replay() {
    this.clearDeadline();
    this.graceTimers.forEach((timer) => clearTimeout(timer));
    this.graceTimers.clear();
    this.reactions = [];
    this.lastReactionAt.clear();
    this.lateJoined = 0;
    this.state = null;
    this.startedAt = 0;
    this.finishedAt = 0;
    this.status = 'lobby';
    this.intent = null;
    this.players.forEach((item) => {
      item.kicked = false;
      item.connected = this.sockets.has(item.id);
      item.status = 'active';
      item.restingSince = 0;
    });
    if (this.persist) {
      store.resetForLobby(this);
      this.persistPlayers();
    }
    this.broadcastSnapshot();
    this.broadcastEvents([{ type: 'toast', tone: 'info', message: 'Room kembali ke lobi untuk permainan baru.' }]);
    return { ok: true };
  }

  /* ---------------- pemulihan ---------------- */

  resumeAfterRestart() {
    /* Crash antara saveCheckpoint dan persist state pertama: state belum ada
       di DB, tetapi checkpoint + intent valid. Pakai checkpoint itu agar
       permainan yang baru dimulai tidak hilang. */
    if (!this.state && this.pendingCheckpoint) {
      this.state = this.pendingCheckpoint;
      if (!this.pendingIntent) this.pendingCheckpoint = null;
    }
    if (!this.state) return;
    const phase = this.state.phase;

    /* Ada intent yang belum selesai: rollback ke checkpoint lalu jalankan
       ulang. Ini menangani crash di fase animasi maupun di tengah satu
       langkah (mis. senjata sudah terpakai tetapi efeknya belum). */
    if (this.pendingCheckpoint && this.pendingIntent) {
      const checkpoint = this.pendingCheckpoint;
      const intent = this.pendingIntent;
      this.pendingCheckpoint = null;
      this.pendingIntent = null;
      this.state = checkpoint;
      const steps = [];
      if (intent.type === 'answer') E.handleAnswer(this.state, intent.playerId, intent.letter === undefined ? null : intent.letter, Boolean(intent.timedOut), steps);
      else if (intent.type === 'bonus-answer' || intent.type === 'bonus-timeout') E.handleBonusAnswer(this.state, intent.playerId, false, steps);
      else if (intent.type === 'start') E.handleStart(this.state, steps);
      else if (intent.type === 'weapon') E.handleFireWeapon(this.state, intent.playerId, intent.uid, intent.targetId, steps);
      else if (intent.type === 'help') E.handleUseHelp(this.state, intent.playerId, intent.key, steps);
      else if (intent.type === 'continue' || intent.type === 'kick-continue') E.handleContinue(this.state, intent.playerId, steps);
      else if (intent.type === 'player-left') E.handlePlayerLeft(this.state, intent.playerId, steps);
      else if (intent.type === 'player-back') E.handlePlayerBack(this.state, intent.playerId, steps);
      else if (intent.type === 'late-join') {
        const player = this.playerById(intent.playerId);
        if (player) E.addLatePlayer(this.state, player, steps);
      }
      if (steps.length) {
        this.run(steps, intent);
        return;
      }
      this.pendingCheckpoint = null;
    }

    if (phase === 'finished') {
      /* onFinished idempoten: cek riwayat agar tidak menulis arsip ganda
         setelah room dibuka kembali pasca-restart. */
      this.onFinished();
      this.broadcastSnapshot();
      return;
    }
    if (phase === 'lobby') {
      this.broadcastSnapshot();
      return;
    }

    /* Fase transien tanpa checkpoint tidak bisa dilanjutkan dengan aman:
       kembalikan ke lobi agar admin bisa memulai ulang. */
    if (phase === 'countdown' || phase === 'resolving') {
      if (this.persist) store.saveState(this, null);
      this.state = null;
      this.status = 'lobby';
      if (this.persist) store.setStatus(this, 'lobby');
      this.broadcastSnapshot();
      return;
    }

    if (phase === 'answering' || phase === 'bonus') {
      const question = this.state.snakeLadder && this.state.snakeLadder.question ? this.state.snakeLadder.question : this.state.question;
      const duration = question ? question.duration : 15;
      if (!this.state.deadline || this.state.deadline < Date.now()) {
        this.state.deadline = Date.now() + duration * 1000;
        this.state.deadlineSetAt = Date.now();
      }
      /* Pemain yang tidak tersambung setelah restart diberi masa tenggang baru
         agar sempat memuat ulang halaman. */
      this.state.players.forEach((item) => {
        if (item.resting) return;
        if (this.sockets.has(item.id)) return;
        const player = this.playerById(item.id);
        if (player && player.status !== 'resting') this.scheduleGrace(item.id);
      });
      this.scheduleDeadline();
    }

    this.broadcastSnapshot();
    this.emitQuestion();
  }
}

class RoomManager {
  constructor(options) {
    const opts = options || {};
    this.rooms = new Map();
    this.evictTimers = new Map();
    this.persist = opts.persist !== false;
    /* Masa tenggang pemain terputus (ms). Dapat diubah lewat configure(). */
    this.graceMs = typeof opts.graceMs === 'number' ? Math.max(0, opts.graceMs) : 10000;
  }

  configure(options) {
    const opts = options || {};
    const grace = Number(opts.disconnectGraceSeconds);
    if (Number.isFinite(grace) && grace >= 0) this.graceMs = Math.round(grace * 1000);
    this.rooms.forEach((room) => { room.graceMs = this.graceMs; });
    return { graceMs: this.graceMs };
  }

  createRoom(opts) {
    let code = security.randomRoomCode(6);
    const taken = (candidate) => this.rooms.has(candidate) || Boolean(store.loadRoom(candidate));
    while (taken(code)) code = security.randomRoomCode(6);
    const room = new Room({
      code,
      bankId: opts.bankId,
      bankName: opts.bankName,
      questions: opts.questions,
      config: {
        shuffle: opts.shuffle !== false,
        helpQuotas: E.sanitizeHelpQuotas(opts.helpQuotas, E.DEFAULT_HELPS()),
        maxPlayers: E.sanitizeMaxPlayers(opts.maxPlayers),
        allowLateJoin: opts.allowLateJoin !== false,
      },
      graceMs: this.graceMs,
      lateJoinAllowance: typeof opts.lateJoinAllowance === 'number' ? opts.lateJoinAllowance : E.sanitizeMaxPlayers(opts.maxPlayers),
      persist: this.persist,
    });
    room.manager = this;
    this.rooms.set(code, room);
    room.initStorage();
    return room;
  }

  get(code) {
    if (!code) return null;
    return this.rooms.get(String(code).toUpperCase()) || null;
  }

  /* Bangun ulang Room dari DB bila belum ada di memori (mis. setelah restart). */
  ensure(code) {
    const existing = this.get(code);
    if (existing) return existing;
    if (!this.persist) return null;
    const record = store.loadRoom(code);
    if (!record) return null;
    const room = new Room({
      code: record.code,
      bankId: record.bankId,
      bankName: record.bankName,
      questions: record.questions,
      config: record.config,
      players: record.players.filter((item) => !item.kicked),
      state: record.state,
      startedAt: record.startedAt,
      graceMs: this.graceMs,
      persist: this.persist,
    });
    room.manager = this;
    room.pendingIntent = record.pendingIntent;
    room.pendingCheckpoint = record.pendingCheckpoint;
    room.finishedAt = record.finishedAt || 0;
    room.setIo(this.io);
    this.rooms.set(room.code, room);
    try {
      room.resumeAfterRestart();
    } catch (error) {
      console.error('[room] gagal memulihkan', room.code, error);
    }
    return room;
  }

  /* Room selesai dilepas dari memori setelah ada kesempatan klien menerima
     snapshot terakhir; data tetap di SQLite dan bisa dimuat lagi. */
  scheduleEvict(room) {
    if (!this.persist) return;
    const timer = setTimeout(() => {
      this.evictTimers.delete(room.code);
      if (this.rooms.get(room.code) !== room) return;
      /* Jangan lepas room selama masih ada klien (mis. layar pemenang). */
      if (room.sockets.size === 0) this.rooms.delete(room.code);
    }, 60000);
    if (timer.unref) timer.unref();
    this.evictTimers.set(room.code, timer);
  }

  unscheduleEvict(room) {
    if (!this.evictTimers) return;
    const timer = this.evictTimers.get(room.code);
    if (timer) clearTimeout(timer);
    this.evictTimers.delete(room.code);
  }

  remove(room) {
    this.rooms.delete(room.code);
  }

  setIo(io) {
    this.io = io;
    this.rooms.forEach((room) => room.setIo(io));
  }

  /* Muat semua room persistent yang belum selesai saat server start. */
  restoreAll(io) {
    this.setIo(io);
    if (!this.persist) return [];
    const restored = [];
    store.listRooms().forEach((entry) => {
      if (entry.status === 'finished') return;
      if (this.rooms.has(entry.code)) return;
      const room = this.ensure(entry.code);
      if (room) restored.push(room);
    });
    return restored;
  }

  size() {
    return this.rooms.size;
  }
}

module.exports = { Room, RoomManager, REACTION_KEYS };
