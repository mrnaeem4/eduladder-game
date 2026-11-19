  /* Terjemahkan penanda teks multi-baris pada soal/opsi/clue:
     \\n \\t \\r (escape satu backslash) menjadi karakter kontrol, sedangkan
     \\\\n \\\\t \\\\r (dua backslash) tetap menjadi teks literal "\\n" dst.
     <br>, <br/>, dan <br /> diperlakukan sebagai baris baru. Bukan untuk URL. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GameEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Konstanta permainan                                                 */
  /* ------------------------------------------------------------------ */

  const MIN_QUESTIONS = 3;
  const WIN_POSITION = 100;
  const BOARD_SIZE = 10;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 25;
  const DEFAULT_MAX_PLAYERS = 4;

  const RESOLVE_DELAY = 1250;
  const FEEDBACK_DELAY = 950;
  const HOP_DELAY = 900;
  const LADDER_SLIDE_MS = 2000;
  const SNAKE_SLIDE_MS = 2000;
  const SLIDE_HOLD_MS = 3000;
  const LAND_PROMPT_HOLD_MS = 1200;
  const STRIKE_MS = 900;
  /* Jeda soal selama animasi serangan: durasi langkah attack + hit/flash.
     Deadline digeser sebesar ini agar timer lanjut dari sisa waktu. */
  const FX_PAUSE_MS = 1400;
  const START_COUNT = 5;
  const START_STEP_MS = 1000;
  const ANSWER_GRACE_MS = 400;

  const LADDERS = { 3: 18, 7: 64, 24: 43, 41: 62, 59: 80, 77: 96 };
  const SNAKES = { 99: 68, 90: 55, 74: 49, 52: 30, 28: 10 };
  const WEAPON_CELLS = [8, 15, 34, 45, 70, 85];

  const WEAPONS = [
    { key: 'bomb', label: 'Bom', icon: 'fa-solid fa-bomb', tone: '#b45309', soft: '#fff7ed', line: '#fed7aa' },
    { key: 'magnet', label: 'Magnet', icon: 'fa-solid fa-magnet', tone: '#b91c1c', soft: '#fef2f2', line: '#fecaca' },
    { key: 'portal', label: 'Portal', icon: 'fa-solid fa-circle-nodes', tone: '#6d28d9', soft: '#f5f3ff', line: '#ddd6fe' },
    { key: 'trap', label: 'Perangkap', icon: 'fa-solid fa-spider', tone: '#0f766e', soft: '#f0fdfa', line: '#99f6e4' },
  ];

  const WEAPON_BY_KEY = WEAPONS.reduce((map, weapon) => {
    map[weapon.key] = weapon;
    return map;
  }, {});

  const WEAPON_DESCRIPTIONS = {
    bomb: 'Lawan mundur 6, 8, atau 10 kotak (acak) dan tidak bisa maju pada gilirannya.',
    magnet: 'Menarik lawan mundur 3 kotak dan mengunci langkah majunya satu giliran.',
    portal: 'Bertukar posisi dengan lawan di depanmu. Tidak memberi efek kunci.',
    trap: 'Lawan kehilangan 1 bantuan acak dan tidak bisa maju pada gilirannya.',
  };

  const ARMS_CAPACITY = 2;
  const BOMB_STEPS = [6, 8, 10];
  const MAGNET_STEPS = 3;

  const DEFAULT_HELPS = () => ({
    throwQuestion: 2,
    clue: 1,
    shield: 1,
    changeQuestion: 1,
    doubleMove: 2,
    penawar: 1,
    eliminateTwo: 2,
  });

  /* Sepuluh karakter = 10 palet warna yang dipetakan bergiliran ke empat
     bentuk 3D yang ada. Karakter boleh dipakai beberapa pemain sekaligus;
     pembeda di papan/HUD adalah warna + nomor urut. */
  const CHARACTERS = [
    { id: 1, name: 'Robot Biru', form: 'robot', color: '#2563eb', light: '#60a5fa', deep: '#1e3a8a', soft: '#dbeafe', glow: 'rgba(37, 99, 235, 0.4)', emoji: '🤖' },
    { id: 2, name: 'Naga Merah', form: 'creature', color: '#e11d48', light: '#fb7185', deep: '#881337', soft: '#ffe4e6', glow: 'rgba(225, 29, 72, 0.4)', emoji: '🐲' },
    { id: 3, name: 'Roket Oranye', form: 'rocket', color: '#f59e0b', light: '#fbbf24', deep: '#92400e', soft: '#fef3c7', glow: 'rgba(245, 158, 11, 0.4)', emoji: '🚀' },
    { id: 4, name: 'Bintang Hijau', form: 'star', color: '#059669', light: '#34d399', deep: '#065f46', soft: '#d1fae5', glow: 'rgba(5, 150, 105, 0.4)', emoji: '⭐' },
    { id: 5, name: 'Robot Ungu', form: 'robot', color: '#7c3aed', light: '#a78bfa', deep: '#4c1d95', soft: '#ede9fe', glow: 'rgba(124, 58, 237, 0.4)', emoji: '🤖' },
    { id: 6, name: 'Monster Pink', form: 'creature', color: '#db2777', light: '#f472b6', deep: '#831843', soft: '#fce7f3', glow: 'rgba(219, 39, 119, 0.4)', emoji: '👾' },
    { id: 7, name: 'Roket Cyan', form: 'rocket', color: '#0891b2', light: '#22d3ee', deep: '#164e63', soft: '#cffafe', glow: 'rgba(8, 145, 178, 0.4)', emoji: '🚀' },
    { id: 8, name: 'Bintang Merah', form: 'star', color: '#dc2626', light: '#f87171', deep: '#7f1d1d', soft: '#fee2e2', glow: 'rgba(220, 38, 38, 0.4)', emoji: '⭐' },
    { id: 9, name: 'Robot Limau', form: 'robot', color: '#65a30d', light: '#a3e635', deep: '#365314', soft: '#ecfccb', glow: 'rgba(101, 163, 13, 0.4)', emoji: '🤖' },
    { id: 10, name: 'Monster Cokelat', form: 'creature', color: '#b45309', light: '#f59e0b', deep: '#78350f', soft: '#fef3c7', glow: 'rgba(180, 83, 9, 0.4)', emoji: '👾' },
  ];

  /* Alias lama: PLAYER_SLOTS tetap tersedia agar kode klien/lama tidak putus. */
  const PLAYER_SLOTS = CHARACTERS.map((character) => ({ ...character, slot: character.id }));

  const HELPS = [
    { key: 'throwQuestion', cls: 'throw', group: 'help', icon: 'fa-solid fa-arrow-right-arrow-left', label: 'Lempar Soal', short: 'Pemain berikutnya', desc: 'Lemparkan soal ini ke pemain berikutnya agar dia yang menjawab.' },
    { key: 'clue', cls: 'clue', group: 'help', icon: 'fa-solid fa-lightbulb', label: 'Clue', short: 'Petunjuk', desc: 'Buka petunjuk untuk soal yang sedang aktif.' },
    { key: 'shield', cls: 'shield', group: 'defense', icon: 'fa-solid fa-shield-halved', label: 'Shield', short: 'Perisai', desc: 'Serap satu serangan senjata lawan atau satu hukuman; bertahan sampai giliranmu berikutnya.' },
    { key: 'changeQuestion', cls: 'change', group: 'help', icon: 'fa-solid fa-rotate', label: 'Ganti Soal', short: 'Tukar', desc: 'Tukar soal aktif dengan soal berikutnya dari bank soal.' },
    { key: 'doubleMove', cls: 'double', group: 'help', icon: 'fa-solid fa-bolt', label: 'Double Move', short: '2x maju', desc: 'Jika jawaban benar, langkah maju menjadi dua kali lipat.' },
    { key: 'penawar', cls: 'penawar', group: 'defense', icon: 'fa-solid fa-prescription-bottle-medical', label: 'Penawar', short: 'Salah tidak mundur', desc: 'Batalkan hukuman mundur dari jawaban salah atau waktu habis pada giliran ini.' },
    { key: 'eliminateTwo', cls: 'eliminate', group: 'help', icon: 'fa-solid fa-scissors', label: 'Sisihkan 2', short: 'Hapus 2 salah', desc: 'Tutup dua pilihan yang salah secara acak.' },
  ];

  const CSV_HEADER =
    'Pertanyaan;Pilihan A;Pilihan B;Pilihan C;Pilihan D;Jawaban Benar (A/B/C/D);Clue;Reward (langkah maju);Penalty (langkah mundur);Durasi (detik);Gambar Soal (URL);Gambar A (URL);Gambar B (URL);Gambar C (URL);Gambar D (URL)';

  const CSV_SAMPLE_ROWS = [
    'Berapa hasil dari 2 + 2?;2;3;4;5;C;Operasi penjumlahan dasar;5;3;15',
    'Apa ibu kota Indonesia?;Bandung;Jakarta;Surabaya;Medan;B;Kota terbesar di Indonesia;4;2;10',
    'Siapa presiden pertama Indonesia?;Soeharto;Soekarno;Habibie;Megawati;B;Proklamator kemerdekaan;6;3;20',
    'Berapa hasil dari 5 x 3?;10;15;20;25;B;Perkalian dasar;5;3;15',
    'Planet terdekat dengan matahari?;Venus;Mars;Merkurius;Bumi;C;Planet pertama dari matahari;4;2;12',
    'Apa keluaran kode ini? Tulis jawaban tanpa spasi.\\nfor i in range(2):\\n\\tprint(i);0 1;0 0;1 2;1 1;A;Gunakan \\\\t untuk indentasi tab;4;2;20',
  ];

  /* ------------------------------------------------------------------ */
  /* Helper murni                                                        */
  /* ------------------------------------------------------------------ */

  function decodeEscapes(text) {
    let out = String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n');
    out = out.replace(/<br\s*\/?>/gi, '\n');
    out = out.replace(/\\\\([ntr])/gi, '\u0000$1');
    out = out.replace(/\\([ntr])/gi, (match, code) => {
      const lower = code.toLowerCase();
      if (lower === 'n') return '\n';
      if (lower === 't') return '\t';
      return '\r';
    });
    out = out.replace(/\u0000([ntr])/gi, '\\$1');
    return out;
  }

  function splitRecords(text) {
    const source = String(text === undefined || text === null ? '' : text);
    const records = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"') {
        if (quoted && source[i + 1] === '"') {
          current += '""';
          i++;
          continue;
        }
        quoted = !quoted;
        current += ch;
      } else if (ch === '\n' && !quoted) {
        records.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    records.push(current);
    return records.filter((record) => record.trim().length > 0);
  }


  const pad = (value) => value.toString().padStart(2, '0');
  const formatTime = (seconds) => `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds % 60))}`;
  const sumHelps = (bag) => Object.values(normalizeBag(bag)).reduce((sum, value) => sum + value, 0);

  function weaponOf(key) {
    return WEAPON_BY_KEY[key] || WEAPONS[0];
  }

  function characterStyle(id) {
    return CHARACTERS.find((item) => item.id === id) || CHARACTERS[0];
  }

  /* Nama lama dipertahankan; kini id = nomor karakter 1..10. */
  const slotStyle = characterStyle;

  function charIdOf(playerOrId) {
    if (playerOrId && typeof playerOrId === 'object') {
      const char = Number(playerOrId.char);
      if (Number.isInteger(char) && char >= 1 && char <= CHARACTERS.length) return char;
      const slot = Number(playerOrId.slot);
      if (Number.isInteger(slot) && slot >= 1 && slot <= CHARACTERS.length) return slot;
      return 1;
    }
    const id = Number(playerOrId);
    return Number.isInteger(id) && id >= 1 && id <= CHARACTERS.length ? id : 1;
  }

  function themeVars(playerOrId) {
    const style = characterStyle(charIdOf(playerOrId));
    return {
      '--team': style.color,
      '--team-light': style.light,
      '--team-deep': style.deep,
      '--team-soft': style.soft,
      '--team-glow': style.glow,
    };
  }

  /* Batas maksimal pemain per room: integer 2..25, default 4. */
  function sanitizeMaxPlayers(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_MAX_PLAYERS;
    return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, parsed));
  }

  /* Pilih karakter: pakai permintaan bila valid; jika tidak, pilih karakter
     yang paling sedikit dipakai (duplikat tetap diizinkan). */
  function assignCharacter(players, requested) {
    const list = Array.isArray(players) ? players : [];
    const asked = parseInt(requested, 10);
    if (Number.isInteger(asked) && asked >= 1 && asked <= CHARACTERS.length) return asked;
    const usage = {};
    CHARACTERS.forEach((character) => { usage[character.id] = 0; });
    list.forEach((player) => {
      const id = charIdOf(player && player.char);
      if (usage[id] !== undefined) usage[id] += 1;
    });
    let best = CHARACTERS[0].id;
    CHARACTERS.forEach((character) => {
      if (usage[character.id] < usage[best]) best = character.id;
    });
    return best;
  }

  function playerNameOf(player) {
    return (player && player.name && player.name.trim()) || `Pemain ${player ? player.slot : ''}`.trim();
  }

  function playerMap(players, value) {
    return (players || []).reduce((map, player) => {
      map[player.id] = typeof value === 'function' ? value(player) : value;
      return map;
    }, {});
  }

  function nextPlayerId(players, id) {
    if (!Array.isArray(players) || !players.length) return id;
    const index = players.findIndex((player) => player.id === id);
    /* Pemain istirahat (terputus melewati masa tenggang) dilewati; bila
       semua istirahat, giliran tetap pada pemain yang sama. */
    for (let step = 1; step <= players.length; step += 1) {
      const candidate = players[(index + step) % players.length];
      if (!candidate.resting) return candidate.id;
    }
    return players[(index + 1) % players.length].id;
  }

  function activePlayerIds(players) {
    const list = (players || []).filter((player) => !player.resting);
    return list.length ? list.map((player) => player.id) : (players || []).map((player) => player.id);
  }

  /* Sisa detik countdown dari deadline server dihitung terhadap jam klien yang
     sudah dikoreksi offset (serverNow - Date.now()). Selalu 0..limit. */
  function remainingSeconds(deadline, limit, offsetMs, safetyPadMs, nowMs) {
    if (!deadline) return null;
    const now = (typeof nowMs === 'number' ? nowMs : Date.now()) + (Number(offsetMs) || 0);
    const pad = Number(safetyPadMs) || 0;
    /* Pad hanya memperpanjang tampilan saat deadline masih di depan. */
    const left = deadline - now;
    const raw = left > 0 ? Math.ceil((left + pad) / 1000) : 0;
    const max = Number(limit) > 0 ? Math.floor(Number(limit)) : Infinity;
    return Math.max(0, Math.min(max, raw));
  }

  function normalizeBag(bag) {
    const base = DEFAULT_HELPS();
    if (!bag || typeof bag !== 'object') return base;
    Object.keys(base).forEach((key) => {
      const value = Number(bag[key]);
      base[key] = Number.isFinite(value) && value >= 0 ? value : base[key];
    });
    return base;
  }

  /* Kuota bantuan per room: enam key wajib, integer >= 0 (0 = nonaktif). */
  function sanitizeHelpQuotas(raw, fallback) {
    const base = normalizeBag(fallback || DEFAULT_HELPS());
    if (!raw || typeof raw !== 'object') return base;
    Object.keys(base).forEach((key) => {
      const value = Number(raw[key]);
      base[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : base[key];
    });
    return base;
  }

  /* URL gambar: kosong boleh; selain itu harus http/https, tanpa spasi. */
  function isValidImageUrl(url) {
    if (url === null || url === undefined) return false;
    const text = String(url).trim();
    if (!text) return true;
    if (text.length > 2048) return false;
    if (/[\s<>"']/.test(text)) return false;
    return /^https?:\/\/[^\s]+$/i.test(text);
  }

  const MAX_TEXT = { question: 1000, option: 500, clue: 300 };

  /* Normalisasi soal dari format lama (opsi string) atau baru (opsi objek). */
  function normalizeQuestion(raw, index) {
    const item = raw || {};
    const options = Array.isArray(item.options) ? item.options : [];
    const normalizedOptions = [0, 1, 2, 3].map((i) => {
      const option = options[i];
      if (option && typeof option === 'object') {
        return {
          text: String(option.text || '').slice(0, MAX_TEXT.option),
          imageUrl: isValidImageUrl(option.imageUrl) && String(option.imageUrl || '').trim() ? String(option.imageUrl).trim() : '',
        };
      }
      return { text: String(option === undefined || option === null ? '' : option).slice(0, MAX_TEXT.option), imageUrl: '' };
    });
    const correct = String(item.correctAnswer || '').trim().toUpperCase();
    return {
      id: item.id || `q${(index || 0) + 1}`,
      question: String(item.question || '').slice(0, MAX_TEXT.question),
      questionImage: isValidImageUrl(item.questionImage) && String(item.questionImage || '').trim() ? String(item.questionImage).trim() : '',
      options: normalizedOptions,
      correctAnswer: ['A', 'B', 'C', 'D'].includes(correct) ? correct : 'A',
      clue: String(item.clue === undefined || item.clue === null ? '' : item.clue).slice(0, MAX_TEXT.clue),
      reward: clampInt(item.reward, 5, 1, 12),
      penalty: clampInt(item.penalty, 3, 1, 10),
      duration: clampInt(item.duration, 15, 5, 180),
    };
  }

  function clampInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  /* Validasi bank soal untuk penyimpanan GUI; mengembalikan daftar error. */
  function validateQuestions(questions) {
    const errors = [];
    if (!Array.isArray(questions) || !questions.length) {
      errors.push('Bank soal harus memiliki minimal satu soal.');
      return errors;
    }
    questions.forEach((raw, index) => {
      const number = index + 1;
      const question = normalizeQuestion(raw, index);
      if (!question.question) errors.push(`Soal ${number}: pertanyaan wajib diisi.`);
      if (question.options.some((option) => !option.text && !option.imageUrl)) {
        errors.push(`Soal ${number}: setiap pilihan butuh teks atau gambar.`);
      }
      if (!isValidImageUrl(raw && raw.questionImage ? raw.questionImage : '')) errors.push(`Soal ${number}: URL gambar soal tidak valid.`);
      question.options.forEach((option, i) => {
        if (!isValidImageUrl(option.imageUrl) && option.imageUrl) errors.push(`Soal ${number}: URL gambar pilihan ${'ABCD'[i]} tidak valid.`);
      });
    });
    return errors;
  }

  function rowCases(row, col) {
    return row % 2 === 1 ? row * BOARD_SIZE + (BOARD_SIZE - col) : row * BOARD_SIZE + col + 1;
  }

  function validateBoard(ladders, snakes, weaponCells) {
    const errors = [];
    const laddersIn = ladders || {};
    const snakesIn = snakes || {};
    const feet = Object.keys(laddersIn).map(Number);
    const tops = Object.values(laddersIn);
    const heads = Object.keys(snakesIn).map(Number);
    const tails = Object.values(snakesIn);
    const endpoints = [...feet, ...tops, ...heads, ...tails];

    const seen = new Map();
    endpoints.forEach((cell) => {
      if (seen.has(cell)) errors.push(`Kotak ${cell} dipakai lebih dari satu ujung ular/tangga.`);
      else seen.set(cell, true);
    });

    const overlap = (a, b, label) => {
      const setB = new Set(b);
      a.forEach((cell) => {
        if (setB.has(cell)) errors.push(label.replace('{cell}', cell));
      });
    };

    overlap(feet, tails, 'Kotak {cell} adalah kaki tangga sekaligus ekor ular (rantai).');
    overlap(tops, heads, 'Kotak {cell} adalah puncak tangga sekaligus kepala ular.');
    overlap(feet, heads, 'Kotak {cell} adalah kaki tangga sekaligus kepala ular.');
    overlap(tops, tails, 'Kotak {cell} adalah puncak tangga sekaligus ekor ular.');

    endpoints.forEach((cell) => {
      if (cell < 1 || cell > WIN_POSITION) errors.push(`Kotak ${cell} berada di luar papan 1-100.`);
    });

    if (Array.isArray(weaponCells)) {
      const seenWeapon = new Set();
      weaponCells.forEach((cell) => {
        if (cell < 1 || cell > WIN_POSITION) errors.push(`Kotak senjata ${cell} berada di luar papan 1-100.`);
        if (seenWeapon.has(cell)) errors.push(`Kotak senjata ${cell} dipakai lebih dari sekali.`);
        seenWeapon.add(cell);
        if (seen.has(cell)) errors.push(`Kotak senjata ${cell} bertabrakan dengan ujung ular atau tangga.`);
      });
    }

    return errors;
  }

  const BOARD_ERRORS = validateBoard(LADDERS, SNAKES, WEAPON_CELLS);

  function pickRandomWeapon() {
    return WEAPONS[Math.floor(Math.random() * WEAPONS.length)];
  }

  function rollSessionWeapons() {
    const map = {};
    WEAPON_CELLS.forEach((cell) => {
      map[cell] = pickRandomWeapon().key;
    });
    return map;
  }

  function bombSteps() {
    return BOMB_STEPS[Math.floor(Math.random() * BOMB_STEPS.length)];
  }

  function pointableTargets(weaponKey, actorId, players, positions) {
    const list = players || [];
    const pos = positions || {};
    const actorPos = pos[actorId] || 1;
    return list
      .filter((player) => player.id !== actorId)
      .map((player) => ({
        player,
        cell: pos[player.id] || 1,
        valid: weaponKey === 'portal' ? (pos[player.id] || 1) > actorPos : true,
      }));
  }

  function sweepRandomHelpId(targetId, helps) {
    const bag = normalizeBag(helps[targetId]);
    const available = Object.keys(bag).filter((key) => bag[key] > 0);
    if (!available.length) return { bag, takenKey: null };
    const takenKey = available[Math.floor(Math.random() * available.length)];
    return { bag: { ...bag, [takenKey]: bag[takenKey] - 1 }, takenKey };
  }

  /* ------------------------------------------------------------------ */
  /* CSV                                                                 */
  /* ------------------------------------------------------------------ */

  function splitDelimited(line, delimiter) {
    const fields = [];
    let current = '';
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delimiter) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  /* Terjemahkan penanda teks multi-baris pada soal/opsi/clue:
     \n \t \r (escape satu backslash) menjadi karakter kontrol, sedangkan
     \\n \\t \\r (dua backslash) tetap menjadi teks literal "\n" dst.
     <br>, <br/> dan <br /> diperlakukan sebagai baris baru. Bukan untuk URL. */

  /* Pisahkan CSV menjadi record. Newline di dalam sel ber-quote adalah isi
     field (Excel "wrap text"), sehingga satu soal boleh menempati beberapa
     baris fisik. Record kosong dilewati. */

  function parseCsv(text) {
    const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    let lines = splitRecords(normalized);
    const errors = [];
    const questions = [];
    let rowNumber = 1;

    if (lines.length && /pertanyaan/i.test(lines[0]) && /jawaban/i.test(lines[0])) {
      lines = lines.slice(1);
    }

    lines.forEach((line) => {
      rowNumber += 1;
      const parts = splitDelimited(line, ';');
      const textField = (value) => decodeEscapes(value).trim();
      const questionText = textField(parts[0] || '');
      if (!questionText) return;

      const correctAnswer = (parts[5] || '').trim().toUpperCase();
      if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
        errors.push(`Baris ${rowNumber}: kolom jawaban harus A, B, C, atau D.`);
        return;
      }

      const parseRange = (value, fallback, min, max) => {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.min(max, parsed));
      };

      const imageFields = [parts[10], parts[11], parts[12], parts[13], parts[14]];
      imageFields.forEach((value, index) => {
        if (value && value.trim() && !isValidImageUrl(value.trim())) {
          errors.push(`Baris ${rowNumber}: ${index === 0 ? 'gambar soal' : `gambar pilihan ${'ABCD'[index - 1]}`} harus URL http/https.`);
        }
      });

      questions.push({
        question: questionText,
        questionImage: isValidImageUrl((parts[10] || '').trim()) ? (parts[10] || '').trim() : '',
        options: [
          { text: textField(parts[1] || 'Pilihan A'), imageUrl: isValidImageUrl((parts[11] || '').trim()) ? (parts[11] || '').trim() : '' },
          { text: textField(parts[2] || 'Pilihan B'), imageUrl: isValidImageUrl((parts[12] || '').trim()) ? (parts[12] || '').trim() : '' },
          { text: textField(parts[3] || 'Pilihan C'), imageUrl: isValidImageUrl((parts[13] || '').trim()) ? (parts[13] || '').trim() : '' },
          { text: textField(parts[4] || 'Pilihan D'), imageUrl: isValidImageUrl((parts[14] || '').trim()) ? (parts[14] || '').trim() : '' },
        ],
        correctAnswer,
        clue: textField(parts[6] || 'Tidak ada clue'),
        reward: parseRange(parts[7], 5, 1, 12),
        penalty: parseRange(parts[8], 3, 1, 10),
        duration: parseRange(parts[9], 15, 5, 180),
      });
    });

    return { questions, errors };
  }

  function buildDeck(source, shuffle) {
    const list = (source || []).map((question, index) => normalizeQuestion({ ...question, id: question.id || `q${index + 1}` }, index));
    if (shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    return list;
  }

  /* ------------------------------------------------------------------ */
  /* State game                                                          */
  /* ------------------------------------------------------------------ */

  function createGameState(players, questions, options) {
    const opts = options || {};
    const deck = buildDeck(questions, opts.shuffle !== false);
    const preset = sanitizeHelpQuotas(opts.helpQuotas, DEFAULT_HELPS());
    return {
      roomCode: opts.roomCode || '',
      players: players.map((player) => ({ ...player })),
      positions: playerMap(players, 1),
      helpPreset: preset,
      helps: playerMap(players, () => ({ ...preset })),
      arms: playerMap(players, () => []),
      locked: {},
      shields: {},
      penawarId: null,
      doubleId: null,
      eliminated: [],
      eliminatedBy: null,
      attackFx: null,
      deadlineSetAt: null,
      currentId: players[0].id,
      turnForId: players[0].id,
      armedTurn: null,
      phase: 'lobby',
      deck,
      deckIndex: 0,
      lastQuestion: null,
      question: null,
      questionThrown: false,
      deadline: null,
      picked: null,
      revealed: false,
      snakeLadder: null,
      sessionWeapons: {},
      handoff: null,
      startCount: 0,
      gameSeconds: 0,
      winner: null,
      winnerReason: '',
      finished: false,
      seq: 0,
    };
  }

  function bankLeft(state) {
    return Math.max(0, state.deck.length - state.deckIndex);
  }

  /* Payload soal untuk klien. Clue TIDAK ikut dikirim: kalau ikut, pemain bisa
     membacanya dari frame socket tanpa memakai bantuan Clue. Clue baru dikirim
     terpisah setelah clueRevealed. */
  function redactQuestion(question) {
    if (!question) return null;
    return {
      id: question.id,
      question: question.question,
      questionImage: question.questionImage || '',
      options: (question.options || []).map((option) => {
        if (option && typeof option === 'object') return { text: option.text || '', imageUrl: option.imageUrl || '' };
        return { text: String(option || ''), imageUrl: '' };
      }),
      reward: question.reward,
      penalty: question.penalty,
      duration: question.duration,
    };
  }

  function publicSnapshot(state) {
    return {
      roomCode: state.roomCode,
      phase: state.phase,
      players: state.players.map((player) => ({ ...player })),
      positions: { ...state.positions },
      helps: JSON.parse(JSON.stringify(state.helps)),
      helpPreset: state.helpPreset ? { ...state.helpPreset } : null,
      arms: JSON.parse(JSON.stringify(state.arms)),
      locked: { ...state.locked },
      shields: { ...state.shields },
      penawarId: state.penawarId,
      doubleId: state.doubleId,
      currentId: state.currentId,
      turnForId: state.turnForId,
      armedTurn: state.armedTurn || null,
      questionThrown: state.questionThrown,
      questionId: state.question ? state.question.id : null,
      deadline: state.deadline,
      deadlineSetAt: state.deadlineSetAt || null,
      eliminated: Array.isArray(state.eliminated) ? [...state.eliminated] : [],
      eliminatedBy: state.eliminatedBy || null,
      attackFx: state.attackFx
        ? { actorId: state.attackFx.actorId, targetId: state.attackFx.targetId, weapon: state.attackFx.weapon, shielded: Boolean(state.attackFx.shielded) }
        : null,
      picked: state.picked,
      revealed: state.revealed,
      snakeLadder: state.snakeLadder
        ? { type: state.snakeLadder.type, playerId: state.snakeLadder.playerId, from: state.snakeLadder.from, to: state.snakeLadder.to }
        : null,
      handoff: state.handoff,
      startCount: state.startCount,
      gameSeconds: state.gameSeconds,
      winner: state.winner,
      winnerReason: state.winnerReason,
      ranking: buildRanking(state),
      bankLeft: bankLeft(state),
      sessionWeapons: { ...state.sessionWeapons },
      seq: state.seq,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Step helpers                                                        */
  /* ------------------------------------------------------------------ */

  /* Step = { delayMs, events:[], apply(state) }. Server menjalankan
     apply(), menyiarkan snapshot+events, lalu menunggu delayMs. */
  function step(apply, delayMs, events) {
    return { apply: apply || (() => {}), delayMs: delayMs || 0, events: events || [] };
  }

  function moveDelay(path) {
    return Math.max(600, path.length * 300 + 350);
  }

  function buildPath(from, steps) {
    const total = Math.abs(steps);
    const direction = steps >= 0 ? 1 : -1;
    let cursor = from;
    const path = [];
    for (let i = 0; i < total; i++) {
      let next = cursor + direction;
      if (next < 1) next = 1;
      if (next > WIN_POSITION) next = WIN_POSITION;
      path.push(next);
      cursor = next;
      if (next === 1 || next === WIN_POSITION) break;
    }
    return path;
  }

  function drawQuestion(state) {
    if (state.deckIndex >= state.deck.length) return null;
    const item = state.deck[state.deckIndex];
    state.deckIndex += 1;
    state.lastQuestion = { ...item };
    return { ...item };
  }

  function rescueQuestion(state) {
    const next = drawQuestion(state);
    if (next) return next;
    if (!state.lastQuestion) return null;
    return { ...state.lastQuestion, options: [...state.lastQuestion.options] };
  }

  function finish(state, winner, reason) {
    state.finished = true;
    state.phase = 'finished';
    state.question = null;
    state.deadline = null;
    state.handoff = null;
    state.winner = winner;
    state.winnerReason = reason;
  }

  function buildRanking(state) {
    return state.players
      .map((player) => ({
        id: player.id,
        slot: player.slot,
        name: playerNameOf(player),
        pos: state.positions[player.id] || 1,
        helps: sumHelps(state.helps[player.id]),
        resting: Boolean(player.resting),
      }))
      .sort((a, b) => b.pos - a.pos || b.helps - a.helps || a.slot - b.slot);
  }

  function finishByQuestions(state, steps) {
    const ranking = buildRanking(state);
    const top = ranking[0];
    if (!top) {
      steps.push(step((s) => finish(s, 'Seri', 'Seluruh soal habis tanpa peringkat yang bisa dihitung.'), 0, []));
      return;
    }
    const tiedEntries = ranking.filter((entry) => entry.pos === top.pos && entry.helps === top.helps);
    const tied = tiedEntries.length > 1;
    const result = tied ? 'Seri' : top.id;
    let reason = `Seluruh soal habis. ${top.name} unggul di kotak ${top.pos}.`;
    if (tied) {
      reason = `Seluruh soal habis. ${tiedEntries.map((entry) => entry.name).join(', ')} sama pada kotak ${top.pos} dan sisa bantuan ${top.helps}.`;
    }
    steps.push(step((s) => finish(s, result, reason), 0, [{ type: 'sfx', kind: 'correct' }]));
  }

  function finishByPosition(state, steps, playerId) {
    const player = state.players.find((item) => item.id === playerId);
    const reason = `${player ? playerNameOf(player) : 'Pemain'} berhasil mencapai kotak ${WIN_POSITION} lebih dulu.`;
    steps.push(
      step(
        (s) => {
          s.positions[playerId] = WIN_POSITION;
          finish(s, playerId, reason);
        },
        0,
        [{ type: 'celebrate', playerId }, { type: 'sfx', kind: 'correct' }]
      )
    );
  }

  /* Siapkan langkah bonus tangga/ular atau lanjut giliran. */
  function landSteps(state, steps, playerId, cell, direction, shieldUsed) {
    if (cell >= WIN_POSITION) {
      finishByPosition(state, steps, playerId);
      return;
    }

    const tookWeapon = direction > 0 && WEAPON_CELLS.includes(cell);
    if (tookWeapon) {
      const key = state.sessionWeapons[cell];
      if (key) {
        const current = state.arms[playerId] || [];
        const slot = { uid: `a${Date.now()}${Math.floor(Math.random() * 1000)}`, key };
        if (current.length < ARMS_CAPACITY) {
          steps.push(
            step(
              (s) => {
                s.arms[playerId] = [...(s.arms[playerId] || []), slot];
              },
              0,
              [{ type: 'weaponGive', playerId, key }, { type: 'sfx', kind: 'click' }]
            )
          );
        } else {
          steps.push(
            step(() => {}, 0, [
              { type: 'toast', tone: 'warn', icon: weaponOf(key).icon, message: `Baki senjata penuh: ${weaponOf(key).label} baru dilepas.` },
            ])
          );
        }
      }
    }

    if (direction > 0 && LADDERS[cell]) {
      if (state.deckIndex >= state.deck.length && !state.lastQuestion) {
        nextTurnSteps(state, steps, 'answer');
        return;
      }
      steps.push(
        step(
          (s) => {
            const q = rescueQuestion(s);
            s.snakeLadder = { type: 'ladder', playerId, from: cell, to: LADDERS[cell], question: q };
            s.phase = 'bonus';
            s.deadline = q ? Date.now() + q.duration * 1000 : null;
            s.deadlineSetAt = q ? Date.now() : null;
            s.picked = null;
            s.revealed = false;
          },
          LAND_PROMPT_HOLD_MS,
          [{ type: 'sfx', kind: 'ladder' }, { type: 'bonusOpen', playerId, bonusType: 'ladder', from: cell, to: LADDERS[cell] }]
        )
      );
      return;
    }

    if (SNAKES[cell]) {
      if (shieldUsed) {
        steps.push(
          step(
            (s) => {
              delete s.shields[playerId];
            },
            HOP_DELAY,
            [{ type: 'flash', tone: 'good', text: 'SHIELD!' }, { type: 'toast', tone: 'good', icon: 'fa-solid fa-shield-halved', message: 'Shield aktif: gigitan ular dibatalkan!' }]
          )
        );
        nextTurnSteps(state, steps, 'answer');
        return;
      }
      if (state.deckIndex >= state.deck.length && !state.lastQuestion) {
        nextTurnSteps(state, steps, 'answer');
        return;
      }
      steps.push(
        step(
          (s) => {
            const q = rescueQuestion(s);
            s.snakeLadder = { type: 'snake', playerId, from: cell, to: SNAKES[cell], question: q };
            s.phase = 'bonus';
            s.deadline = q ? Date.now() + q.duration * 1000 : null;
            s.deadlineSetAt = q ? Date.now() : null;
            s.picked = null;
            s.revealed = false;
          },
          LAND_PROMPT_HOLD_MS,
          [{ type: 'sfx', kind: 'snake' }, { type: 'bonusOpen', playerId, bonusType: 'snake', from: cell, to: SNAKES[cell] }]
        )
      );
      return;
    }

    nextTurnSteps(state, steps, 'answer', tookWeapon ? HOP_DELAY + 300 : HOP_DELAY);
  }

  function nextTurnSteps(state, steps, reason, delayMs) {
    steps.push(
      step(
        (s) => {
          /* Rotasi dihitung dari pemain yang barusan menjawab (turnForId),
             bukan currentId: pada soal yang dilempar keduanya berbeda. */
          const finishingId = s.turnForId || s.currentId;
          const nextId = nextPlayerId(s.players, finishingId);
          s.currentId = nextId;
          s.turnForId = nextId;
          s.questionThrown = false;
          /* Clue hanya berlaku untuk soal yang sedang dijawab pemiliknya;
             jangan terbawa ke giliran pemain berikutnya. */
          s.clueRevealed = false;
          if (s.shields[nextId]) delete s.shields[nextId];
          s.penawarId = null;
          s.doubleId = null;
          s.armedTurn = null;
          s.eliminated = [];
          s.eliminatedBy = null;
          s.attackFx = null;
          if (finishingId && s.locked[finishingId]) delete s.locked[finishingId];
          s.question = null;
          s.picked = null;
          s.revealed = false;
          s.deadline = null;
          s.snakeLadder = null;
          s.phase = 'handoff';
          s.handoff = { playerId: nextId, mode: 'next', reason };
        },
        delayMs || 0,
        []
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Handler intent                                                      */
  /* ------------------------------------------------------------------ */

  function handleStart(state, steps) {
    state.finished = false;
    state.phase = 'countdown';
    state.startCount = START_COUNT;
    state.gameSeconds = 0;
    state.sessionWeapons = rollSessionWeapons();
    state.positions = playerMap(state.players, 1);
    const preset = sanitizeHelpQuotas(state.helpPreset, DEFAULT_HELPS());
    state.helpPreset = preset;
    state.helps = playerMap(state.players, () => ({ ...preset }));
    state.arms = playerMap(state.players, () => []);
    state.locked = {};
    state.shields = {};
    state.penawarId = null;
    state.doubleId = null;
    state.currentId = state.players[0].id;
    state.turnForId = state.players[0].id;
    state.handoff = null;
    state.winner = null;
    state.winnerReason = '';
    state.questionThrown = false;
    state.snakeLadder = null;
    state.picked = null;
    state.revealed = false;
    state.clueRevealed = false;
    state.eliminated = [];
    state.eliminatedBy = null;
    state.attackFx = null;
    state.deadline = null;
    state.deadlineSetAt = null;

    /* Pemain yang masih istirahat saat permainan dimulai tetap dijeda sampai
       dia kembali. */
    const firstId = (state.players.find((player) => !player.resting) || state.players[0]).id;
    state.currentId = firstId;
    state.turnForId = firstId;

    for (let count = START_COUNT; count >= 1; count--) {
      steps.push(
        step(
          (s) => {
            s.startCount = count;
          },
          START_STEP_MS,
          [{ type: 'countdown', value: count }]
        )
      );
    }

    steps.push(
      step(
        (s) => {
          s.startCount = 0;
          const first = drawQuestion(s);
          if (!first) return;
          s.phase = 'answering';
          s.question = first;
          s.turnForId = s.currentId;
          s.questionThrown = false;
          s.deadline = Date.now() + first.duration * 1000;
          s.deadlineSetAt = Date.now();
          s.picked = null;
          s.revealed = false;
        },
        0,
        [{ type: 'questionOpen', playerId: state.currentId }]
      )
    );

    steps.push(
      step(
        (s) => {
          if (!s.question && !s.finished) {
            const list = [];
            finishByQuestions(s, list);
            list.forEach((inner) => inner.apply(s));
          }
        },
        0,
        []
      )
    );
  }

  function handleContinue(state, playerId, steps) {
    const handoff = state.handoff;
    if (!handoff) return;
    const mode = handoff.mode;
    steps.push(
      step(
        (s) => {
          s.handoff = null;
          s.turnForId = handoff.playerId;
          s.questionThrown = mode === 'ready';
          s.picked = null;
          s.revealed = false;
          s.eliminated = [];
          s.eliminatedBy = null;
          s.attackFx = null;
          /* Soal baru / soal yang dilempar: clue mulai tertutup lagi. */
          s.clueRevealed = false;
          s.phase = 'answering';
          if (mode !== 'ready') {
            const next = drawQuestion(s);
            s.question = next;
            s.deadline = next ? Date.now() + next.duration * 1000 : null;
            s.deadlineSetAt = next ? Date.now() : null;
            if (!next) {
              const list = [];
              finishByQuestions(s, list);
              list.forEach((inner) => inner.apply(s));
            }
          } else if (s.question) {
            s.deadline = Date.now() + s.question.duration * 1000;
            s.deadlineSetAt = Date.now();
          }
        },
        0,
        [{ type: 'sfx', kind: 'click' }, { type: 'questionOpen', playerId: handoff.playerId }]
      )
    );
  }

  function handleAnswer(state, playerId, letter, timedOut, steps) {
    const question = state.question;
    if (!question || state.revealed || state.phase !== 'answering') return;
    const isCorrect = letter !== null && letter === question.correctAnswer;
    const hasShield = Boolean(state.shields[playerId]);
    const hasPenawar = state.penawarId === playerId;
    const hasDouble = state.doubleId === playerId;
    const isLocked = Boolean(state.locked[playerId]);

    /* Angka melayang saat reveal: reward/penalty yang benar-benar diterapkan.
       Ditahan Shield/Penawar atau kena kunci → 0 netral. */
    let scorePop = { delta: 0, tone: 'neutral' };
    if (isCorrect) {
      if (!isLocked) scorePop = { delta: hasDouble ? question.reward * 2 : question.reward, tone: 'good' };
    } else if (!hasPenawar && !hasShield) {
      scorePop = { delta: -question.penalty, tone: 'bad' };
    }

    steps.push(
      step(
        (s) => {
          s.revealed = true;
          s.picked = letter;
          s.deadline = null;
          s.deadlineSetAt = null;
          s.attackFx = null;
          s.eliminated = [];
          s.eliminatedBy = null;
          s.phase = 'resolving';
        },
        FEEDBACK_DELAY,
        [
          { type: 'reveal', picked: letter, correct: question.correctAnswer },
          { type: 'scorePop', playerId, delta: scorePop.delta, tone: scorePop.tone },
          { type: 'sfx', kind: isCorrect ? 'correct' : 'wrong' },
          { type: 'flash', tone: isCorrect ? 'good' : 'bad', text: isCorrect ? (hasDouble ? 'BENAR! DOUBLE MOVE' : 'BENAR!') : timedOut ? 'WAKTU HABIS' : 'SALAH' },
        ]
      )
    );

    if (isCorrect) {
      if (isLocked) {
        steps.push(
          step((s) => {
            s.doubleId = null;
          }, 0, [{ type: 'toast', tone: 'warn', icon: 'fa-solid fa-lock', message: 'Benar, tetapi terkunci: tidak maju pada giliran ini.' }])
        );
        nextTurnSteps(state, steps, 'locked', RESOLVE_DELAY);
        return;
      }
      const stepsCount = hasDouble ? question.reward * 2 : question.reward;
      const from = state.positions[playerId];
      const path = buildPath(from, stepsCount);
      const target = path.length ? path[path.length - 1] : from;
      steps.push(
        step(
          (s) => {
            if (hasDouble) s.doubleId = null;
            s.positions[playerId] = target;
          },
          moveDelay(path),
          [
            { type: 'move', playerId, path, kind: 'hop', from },
            { type: 'toast', tone: 'good', message: `Benar! ${playerNameOf(findPlayer(state, playerId))} maju ${stepsCount} langkah.` },
          ]
        )
      );
      landSteps(state, steps, playerId, target, 1, false);
      return;
    }

    if (hasPenawar) {
      steps.push(
        step((s) => {
          s.penawarId = null;
        }, 0, [
          { type: 'flash', tone: 'good', text: 'PENAWAR!' },
          { type: 'toast', tone: 'good', icon: 'fa-solid fa-prescription-bottle-medical', message: timedOut ? 'Waktu habis, tetapi Penawar menahan pemain di tempat.' : 'Salah, tetapi Penawar menahan pemain di tempat.' },
        ])
      );
      nextTurnSteps(state, steps, 'penawar', RESOLVE_DELAY + 300);
      return;
    }

    if (hasShield) {
      steps.push(
        step((s) => {
          delete s.shields[playerId];
        }, 0, [{ type: 'toast', tone: 'good', icon: 'fa-solid fa-shield-halved', message: 'Shield melindungi pemain dari hukuman.' }])
      );
      nextTurnSteps(state, steps, 'shield', RESOLVE_DELAY + 300);
      return;
    }

    const penalty = question.penalty;
    const from = state.positions[playerId];
    const path = buildPath(from, -penalty);
    const target = path.length ? path[path.length - 1] : from;
    steps.push(
      step(
        (s) => {
          s.positions[playerId] = target;
        },
        moveDelay(path),
        [
          { type: 'move', playerId, path, kind: 'hop', from },
          { type: 'toast', tone: 'bad', message: timedOut ? `Waktu habis! Pemain mundur ${penalty} langkah.` : `Salah! Pemain mundur ${penalty} langkah.` },
        ]
      )
    );
    landSteps(state, steps, playerId, target, -1, false);
  }

  function findPlayer(state, id) {
    return state.players.find((player) => player.id === id);
  }

  function handleUseHelp(state, playerId, key, steps) {
    if (state.phase !== 'answering' || !state.question || state.revealed) return;
    if (state.turnForId !== playerId) return;
    /* Selama animasi serangan, soal dijeda: tidak ada bantuan. */
    if (state.attackFx) return;
    const bag = normalizeBag(state.helps[playerId]);
    if (bag[key] <= 0) return;

    if (key === 'throwQuestion') {
      if (state.questionThrown) return;
      const targetId = nextPlayerId(state.players, state.currentId);
      steps.push(
        step(
          (s) => {
            s.helps[playerId] = { ...bag, throwQuestion: bag.throwQuestion - 1 };
            s.questionThrown = true;
            s.turnForId = targetId;
            s.deadline = null;
            s.phase = 'handoff';
            s.handoff = { playerId: targetId, mode: 'ready', reason: 'thrown' };
          },
          0,
          [{ type: 'toast', tone: 'info', icon: 'fa-solid fa-arrow-right-arrow-left', message: 'Soal dilempar ke pemain berikutnya. Timer mulai setelah dia siap.' }]
        )
      );
      return;
    }

    if (key === 'clue') {
      steps.push(
        step(
          (s) => {
            s.helps[playerId] = { ...bag, clue: bag.clue - 1 };
            s.clueRevealed = true;
          },
          0,
          [{ type: 'clue', playerId }, { type: 'sfx', kind: 'click' }]
        )
      );
      return;
    }

    if (key === 'changeQuestion') {
      steps.push(
        step(
          (s) => {
            const next = drawQuestion(s);
            if (!next) return;
            s.helps[playerId] = { ...normalizeBag(s.helps[playerId]), changeQuestion: Math.max(0, bag.changeQuestion - 1) };
            s.question = next;
            s.picked = null;
            s.revealed = false;
            s.clueRevealed = false;
            s.eliminated = [];
            s.eliminatedBy = null;
            s.deadline = Date.now() + next.duration * 1000;
            s.deadlineSetAt = Date.now();
          },
          0,
          [{ type: 'questionChanged' }, { type: 'sfx', kind: 'click' }]
        )
      );
      return;
    }

    if (key === 'doubleMove') {
      steps.push(
        step(
          (s) => {
            s.helps[playerId] = { ...bag, doubleMove: bag.doubleMove - 1 };
            s.doubleId = playerId;
          },
          0,
          [{ type: 'toast', tone: 'info', icon: 'fa-solid fa-bolt', message: 'Double Move siap: jawaban benar bernilai dua kali.' }]
        )
      );
      return;
    }

    if (key === 'shield') {
      steps.push(
        step(
          (s) => {
            s.helps[playerId] = { ...bag, shield: bag.shield - 1 };
            s.shields[playerId] = true;
          },
          0,
          [{ type: 'toast', tone: 'info', icon: 'fa-solid fa-shield-halved', message: 'Shield aktif.' }]
        )
      );
      return;
    }

    if (key === 'penawar') {
      steps.push(
        step(
          (s) => {
            s.helps[playerId] = { ...bag, penawar: bag.penawar - 1 };
            s.penawarId = playerId;
          },
          0,
          [{ type: 'toast', tone: 'info', icon: 'fa-solid fa-prescription-bottle-medical', message: 'Penawar siap: jawaban salah tidak mengurangi langkah.' }]
        )
      );
      return;
    }

    if (key === 'eliminateTwo') {
      /* Butuh minimal tiga opsi terisi agar dua opsi salah bisa disisihkan. */
      const options = (state.question.options || []).filter((option) => {
        if (option && typeof option === 'object') return Boolean(option.text || option.imageUrl);
        return Boolean(String(option || '').trim());
      });
      if (options.length < 3) return;
      const wrong = ['A', 'B', 'C', 'D']
        .slice(0, options.length)
        .filter((letter) => letter !== state.question.correctAnswer);
      if (wrong.length < 2) return;
      const letters = [];
      while (letters.length < 2) {
        const pick = wrong[Math.floor(Math.random() * wrong.length)];
        if (!letters.includes(pick)) letters.push(pick);
      }
      letters.sort();
      steps.push(
        step(
          (s) => {
            s.helps[playerId] = { ...bag, eliminateTwo: bag.eliminateTwo - 1 };
            s.eliminated = letters;
            s.eliminatedBy = playerId;
          },
          0,
          [{ type: 'eliminate', playerId, letters }, { type: 'sfx', kind: 'click' }]
        )
      );
    }
  }

  function handleFireWeapon(state, playerId, uid, targetId, steps) {
    if (state.phase !== 'answering' || state.revealed) return;
    if (state.currentId !== playerId || state.turnForId !== playerId) return;
    if (state.armedTurn === playerId) return;
    /* Satu efek serangan pada satu waktu. */
    if (state.attackFx) return;
    const slots = state.arms[playerId] || [];
    const slot = slots.find((item) => item.uid === uid);
    if (!slot) return;
    const targets = pointableTargets(slot.key, playerId, state.players, state.positions);
    const entry = targets.find((item) => item.player.id === targetId);
    if (!entry || !entry.valid) return;

    const weapon = weaponOf(slot.key);
    const shielded = Boolean(state.shields[targetId]);
    const from = state.positions[targetId];

    steps.push(
      step(
        (s) => {
          s.arms[playerId] = (s.arms[playerId] || []).filter((item) => item.uid !== uid);
          s.armedTurn = playerId;
          /* Soal dijeda selama efek: sisa waktu tetap, timer lanjut setelah
             snapshot berikutnya membersihkan attackFx. */
          if (s.deadline) {
            s.deadline += FX_PAUSE_MS;
            s.deadlineSetAt = Date.now();
          }
          s.attackFx = { actorId: playerId, targetId, weapon: slot.key, shielded, until: Date.now() + FX_PAUSE_MS };
        },
        STRIKE_MS,
        [
          { type: 'attack', actorId: playerId, targetId, weapon: slot.key, shielded },
          { type: 'sfx', kind: shielded ? 'block' : slot.key },
        ]
      )
    );

    if (shielded) {
      steps.push(
        step(
          (s) => {
            delete s.shields[targetId];
            s.attackFx = null;
          },
          300,
          [{ type: 'flash', tone: 'good', text: 'DITAHAN SHIELD' }, { type: 'toast', tone: 'good', icon: 'fa-solid fa-shield-halved', message: `Shield menyerap ${weapon.label}. Serangan batal.` }]
        )
      );
      return;
    }

    if (slot.key === 'bomb' || slot.key === 'magnet') {
      const stepsCount = slot.key === 'bomb' ? bombSteps() : MAGNET_STEPS;
      const target = Math.max(1, from - stepsCount);
      const back = from - target;
      steps.push(
        step(
          (s) => {
            s.positions[targetId] = target;
            s.locked[targetId] = true;
            s.attackFx = null;
          },
          900,
          [
            { type: 'hit', targetId, from, to: target },
            { type: 'flash', tone: 'bad', text: `${weapon.label.toUpperCase()}!` },
            { type: 'toast', tone: 'warn', icon: weapon.icon, message: `${weapon.label}: lawan mundur ${back} kotak ke ${target}.` },
          ]
        )
      );
      return;
    }

    if (slot.key === 'portal') {
      const actorCell = state.positions[playerId];
      steps.push(
        step(
          (s) => {
            s.positions[playerId] = from;
            s.positions[targetId] = actorCell;
            s.attackFx = null;
          },
          0,
          [
            { type: 'portal', actorId: playerId, targetId, actorCell, targetCell: from },
            { type: 'flash', tone: 'good', text: 'PORTAL!' },
            { type: 'toast', tone: 'info', icon: weapon.icon, message: `Portal: bertukar posisi ${actorCell} <-> ${from}.` },
          ]
        )
      );
      return;
    }

    const sweep = sweepRandomHelpId(targetId, state.helps);
    steps.push(
      step(
        (s) => {
          s.locked[targetId] = true;
          s.helps[targetId] = sweep.bag;
          s.attackFx = null;
        },
        0,
        [
          { type: 'flash', tone: 'warn', text: 'TERPERANGKAP' },
          { type: 'toast', tone: 'warn', icon: weapon.icon, message: sweep.takenKey ? 'Perangkap: lawan kehilangan 1 bantuan.' : 'Perangkap: lawan terkunci.' },
        ]
      )
    );
  }

  function handleBonusAnswer(state, playerId, isCorrect, steps) {
    const info = state.snakeLadder;
    if (!info || info.playerId !== playerId) return;
    if (state.attackFx) return;

    steps.push(
      step(
        (s) => {
          s.snakeLadder = null;
          s.phase = 'resolving';
          s.deadline = null;
          s.revealed = true;
          s.picked = isCorrect ? 'CORRECT' : 'WRONG';
        },
        0,
        [{ type: 'bonusReveal', correct: isCorrect }]
      )
    );

    if (info.type === 'ladder') {
      if (isCorrect) {
        steps.push(
          step(
            (s) => {
              s.positions[playerId] = info.to;
            },
            LADDER_SLIDE_MS + SLIDE_HOLD_MS,
            [
              { type: 'slide', playerId, from: info.from, to: info.to, slideType: 'ladder' },
              { type: 'flash', tone: 'good', text: 'NAIK TANGGA!' },
              { type: 'toast', tone: 'good', icon: 'fa-solid fa-stairs', message: `Naik tangga ke kotak ${info.to}!` },
            ]
          )
        );
        rescueAfterSlide(state, steps, playerId, info.to);
      } else {
        steps.push(step(() => {}, HOP_DELAY, [{ type: 'flash', tone: 'bad', text: 'TETAP DI TANGGA' }]));
        nextTurnSteps(state, steps, 'answer');
      }
      return;
    }

    if (isCorrect) {
      steps.push(
        step(() => {}, HOP_DELAY, [
          { type: 'flash', tone: 'good', text: 'SELAMAT!' },
          { type: 'toast', tone: 'good', icon: 'fa-solid fa-shield-halved', message: 'Jawaban benar! Lolos dari ular.' },
        ])
      );
      nextTurnSteps(state, steps, 'snake');
      return;
    }

    steps.push(
      step(
        (s) => {
          s.positions[playerId] = info.to;
        },
        SNAKE_SLIDE_MS + SLIDE_HOLD_MS,
        [
          { type: 'slide', playerId, from: info.from, to: info.to, slideType: 'snake' },
          { type: 'flash', tone: 'bad', text: 'DIMAKAN ULAR' },
          { type: 'toast', tone: 'bad', icon: 'fa-solid fa-staff-snake', message: `Turun ke kotak ${info.to}.` },
        ]
      )
    );
    rescueAfterSlide(state, steps, playerId, info.to);
  }

  function rescueAfterSlide(state, steps, playerId, cell) {
    if (cell >= WIN_POSITION) {
      finishByPosition(state, steps, playerId);
      return;
    }
    if (state.deckIndex >= state.deck.length && !state.lastQuestion) {
      nextTurnSteps(state, steps, 'answer');
      return;
    }
    if (LADDERS[cell]) {
      steps.push(
        step(
          (s) => {
            const q = rescueQuestion(s);
            s.snakeLadder = { type: 'ladder', playerId, from: cell, to: LADDERS[cell], question: q };
            s.phase = 'bonus';
            s.deadline = q ? Date.now() + q.duration * 1000 : null;
            s.deadlineSetAt = q ? Date.now() : null;
            s.revealed = false;
            s.picked = null;
          },
          LAND_PROMPT_HOLD_MS,
          [{ type: 'bonusOpen', playerId, bonusType: 'ladder', from: cell, to: LADDERS[cell] }]
        )
      );
      return;
    }
    if (SNAKES[cell]) {
      steps.push(
        step(
          (s) => {
            const q = rescueQuestion(s);
            s.snakeLadder = { type: 'snake', playerId, from: cell, to: SNAKES[cell], question: q };
            s.phase = 'bonus';
            s.deadline = q ? Date.now() + q.duration * 1000 : null;
            s.deadlineSetAt = q ? Date.now() : null;
            s.revealed = false;
            s.picked = null;
          },
          LAND_PROMPT_HOLD_MS,
          [{ type: 'bonusOpen', playerId, bonusType: 'snake', from: cell, to: SNAKES[cell] }]
        )
      );
      return;
    }
    nextTurnSteps(state, steps, 'answer');
  }

  /* ------------------------------------------------------------------ */
  /* Pemain keluar / bergabung di tengah permainan                       */
  /* ------------------------------------------------------------------ */

  function markResting(state, playerId, resting) {
    const player = findPlayer(state, playerId);
    if (player) player.resting = Boolean(resting);
    return player;
  }

  /* Pemain berhenti bermain (terputus melewati masa tenggang). Bila dia
     pemilik giliran/soal, soal dialihkan ke pemain aktif berikutnya tanpa
     hukuman; aturan lain (shield, kunci) tetap berlaku untuk orang lain. */
  function handlePlayerLeft(state, playerId, steps) {
    const player = findPlayer(state, playerId);
    if (!player) return;
    const phase = state.phase;
    const ownerOfTurn = state.turnForId === playerId || state.currentId === playerId;
    const handoffOwner = state.handoff && state.handoff.playerId === playerId;

    if (phase === 'handoff' && handoffOwner) {
      steps.push(
        step(
          (s) => {
            markResting(s, playerId, true);
            const nextId = nextPlayerId(s.players, playerId);
            s.handoff = { playerId: nextId, mode: 'next', reason: 'next' };
          },
          0,
          [{ type: 'toast', tone: 'warn', icon: 'fa-solid fa-person-walking-arrow-right', message: `${playerNameOf(player)} keluar dari permainan. Giliran dialihkan.` }]
        )
      );
      return;
    }

    if ((phase === 'answering' || phase === 'bonus') && ownerOfTurn) {
      steps.push(
        step(
          (s) => {
            markResting(s, playerId, true);
            const nextId = nextPlayerId(s.players, playerId);
            s.currentId = nextId;
            s.turnForId = nextId;
            s.questionThrown = false;
            s.clueRevealed = false;
            s.penawarId = null;
            s.doubleId = null;
            s.armedTurn = null;
            s.eliminated = [];
            s.eliminatedBy = null;
            s.attackFx = null;
            if (s.locked[playerId]) delete s.locked[playerId];
            s.question = null;
            s.picked = null;
            s.revealed = false;
            s.deadline = null;
            s.deadlineSetAt = null;
            s.snakeLadder = null;
            s.phase = 'handoff';
            s.handoff = { playerId: nextId, mode: 'next', reason: 'left' };
          },
          0,
          [{ type: 'toast', tone: 'warn', icon: 'fa-solid fa-person-walking-arrow-right', message: `${playerNameOf(player)} keluar dari permainan. Soal dialihkan.` }]
        )
      );
      return;
    }

    steps.push(
      step(
        (s) => {
          markResting(s, playerId, true);
        },
        0,
        [{ type: 'toast', tone: 'warn', icon: 'fa-solid fa-bed', message: `${playerNameOf(player)} istirahat; gilirannya dilewati.` }]
      )
    );
  }

  /* Pemain yang kembali dari istirahat. */
  function handlePlayerBack(state, playerId, steps) {
    const player = findPlayer(state, playerId);
    if (!player) return;
    if (!player.resting) return;
    steps.push(
      step(
        (s) => {
          markResting(s, playerId, false);
        },
        0,
        [{ type: 'toast', tone: 'good', icon: 'fa-solid fa-user-check', message: `${playerNameOf(player)} kembali bermain.` }]
      )
    );
  }

  /* Pemain baru yang bergabung saat permainan berjalan: mulai dari kotak 1,
     bantuan sesuai preset, baki senjata kosong. Giliran mengikuti posisinya
     di array pemain (slot terakhir) pada putaran berikutnya. */
  function addLatePlayer(state, player, steps) {
    if (!player || !player.id) return;
    if (findPlayer(state, player.id)) return;
    const entry = {
      id: player.id,
      slot: player.slot,
      char: player.char || 1,
      name: playerNameOf(player),
      resting: false,
    };
    steps.push(
      step(
        (s) => {
          const list = s.players.filter((item) => item.id !== entry.id);
          list.push({ ...entry });
          list.sort((a, b) => a.slot - b.slot);
          s.players = list;
          s.positions[entry.id] = 1;
          s.helps[entry.id] = { ...sanitizeHelpQuotas(s.helpPreset, DEFAULT_HELPS()) };
          s.arms[entry.id] = [];
        },
        0,
        [{ type: 'toast', tone: 'info', icon: 'fa-solid fa-user-plus', message: `${entry.name} bergabung di tengah permainan.` }]
      )
    );
  }

  return {
    MIN_QUESTIONS,
    WIN_POSITION,
    BOARD_SIZE,
    MIN_PLAYERS,
    MAX_PLAYERS,
    DEFAULT_MAX_PLAYERS,
    RESOLVE_DELAY,
    FEEDBACK_DELAY,
    HOP_DELAY,
    FX_PAUSE_MS,
    LADDER_SLIDE_MS,
    SNAKE_SLIDE_MS,
    SLIDE_HOLD_MS,
    LAND_PROMPT_HOLD_MS,
    START_COUNT,
    START_STEP_MS,
    ANSWER_GRACE_MS,
    LADDERS,
    SNAKES,
    WEAPON_CELLS,
    WEAPONS,
    WEAPON_BY_KEY,
    WEAPON_DESCRIPTIONS,
    ARMS_CAPACITY,
    BOMB_STEPS,
    MAGNET_STEPS,
    DEFAULT_HELPS,
    CHARACTERS,
    PLAYER_SLOTS,
    HELPS,
    CSV_HEADER,
    CSV_SAMPLE_ROWS,
    BOARD_ERRORS,
    pad,
    formatTime,
    sumHelps,
    weaponOf,
    characterStyle,
    slotStyle,
    themeVars,
    sanitizeMaxPlayers,
    assignCharacter,
    playerNameOf,
    playerMap,
    nextPlayerId,
    activePlayerIds,
    remainingSeconds,
    normalizeBag,
    sanitizeHelpQuotas,
    isValidImageUrl,
    decodeEscapes,
    splitRecords,
    normalizeQuestion,
    validateQuestions,
    rowCases,
    validateBoard,
    pickRandomWeapon,
    rollSessionWeapons,
    bombSteps,
    pointableTargets,
    sweepRandomHelpId,
    splitDelimited,
    parseCsv,
    buildDeck,
    buildRanking,
    createGameState,
    bankLeft,
    redactQuestion,
    publicSnapshot,
    handleStart,
    handleContinue,
    handleAnswer,
    handleUseHelp,
    handleFireWeapon,
    handleBonusAnswer,
    handlePlayerLeft,
    handlePlayerBack,
    addLatePlayer,
  };
});
