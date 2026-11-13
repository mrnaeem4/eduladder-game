const { useState, useEffect, useRef, useMemo, useCallback } = React;

const MIN_QUESTIONS = 3;
const WIN_POSITION = 100;
const BOARD_SIZE = 10;
const STEP_DELAY = 220;
const RESOLVE_DELAY = 1250;
const FEEDBACK_DELAY = 950;
const HOP_DELAY = 900;

/* Peta bebas rantai: kaki tangga bukan ekor ular, puncak tangga bukan
   kepala ular, dan tidak ada endpoint ganda. */
const LADDERS = { 3: 18, 7: 64, 24: 43, 41: 62, 59: 80, 77: 96 };
const SNAKES = { 99: 68, 90: 55, 74: 49, 52: 30, 28: 10 };

/* Kotak senjata tidak boleh bertabrakan dengan ujung ular/tangga agar
   mendarat di satu kotak tidak memicu dua kejadian sekaligus. */
const WEAPON_CELLS = [8, 15, 34, 45, 70, 85];

/* Jenis senjata diacak sekali per sesi (setelah deck dibangun) sehingga
   kotak yang sama selalu memberi senjata yang sama sepanjang permainan. */
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

function weaponOf(key) {
  return WEAPON_BY_KEY[key] || WEAPONS[0];
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

const DEFAULT_HELPS = () => ({
  throwQuestion: 2,
  clue: 1,
  shield: 1,
  changeQuestion: 1,
  doubleMove: 2,
  penawar: 1,
});

/* Slot tetap: warna dan bentuk karakter tidak berubah walau pemain lain
   dihapus (mis. daftar p1, p3, p4 tetap kuning dan hijau). */
const PLAYER_SLOTS = [
  { slot: 1, form: 'robot', color: '#2563eb', light: '#60a5fa', deep: '#1e3a8a', soft: '#dbeafe', glow: 'rgba(37, 99, 235, 0.4)' },
  { slot: 2, form: 'creature', color: '#e11d48', light: '#fb7185', deep: '#881337', soft: '#ffe4e6', glow: 'rgba(225, 29, 72, 0.4)' },
  { slot: 3, form: 'rocket', color: '#f59e0b', light: '#fbbf24', deep: '#92400e', soft: '#fef3c7', glow: 'rgba(245, 158, 11, 0.4)' },
  { slot: 4, form: 'star', color: '#059669', light: '#34d399', deep: '#065f46', soft: '#d1fae5', glow: 'rgba(5, 150, 105, 0.4)' },
];

const MAX_PLAYERS = PLAYER_SLOTS.length;

function slotStyle(slot) {
  return PLAYER_SLOTS.find((item) => item.slot === slot) || PLAYER_SLOTS[0];
}

function makePlayer(slot, name) {
  const safeName = typeof name === 'string' ? name.slice(0, 18) : '';
  return { id: `p${slot}`, slot, name: safeName || `Pemain ${slot}` };
}

const DEFAULT_PLAYERS = [makePlayer(1), makePlayer(2)];

function nextPlayerId(players, id) {
  if (!Array.isArray(players) || !players.length) return id;
  const index = players.findIndex((player) => player.id === id);
  return players[(index + 1) % players.length].id;
}

function themeVars(playerOrSlot) {
  const style = typeof playerOrSlot === 'number' ? slotStyle(playerOrSlot) : slotStyle(playerOrSlot && playerOrSlot.slot);
  return {
    '--team': style.color,
    '--team-light': style.light,
    '--team-deep': style.deep,
    '--team-soft': style.soft,
    '--team-glow': style.glow,
  };
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

function normalizePlayers(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const list = [];
  raw.forEach((item) => {
    if (!item) return;
    const slot = Number(item.slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_PLAYERS || seen.has(slot)) return;
    seen.add(slot);
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 18) : '';
    list.push(makePlayer(slot, name));
  });
  return list.length >= 2 ? list : null;
}

const HELPS = [
  {
    key: 'throwQuestion',
    cls: 'throw',
    group: 'help',
    icon: 'fa-solid fa-arrow-right-arrow-left',
    label: 'Lempar Soal',
    short: 'Pemain berikutnya',
    desc: 'Lemparkan soal ini ke pemain berikutnya agar dia yang menjawab.',
  },
  {
    key: 'clue',
    cls: 'clue',
    group: 'help',
    icon: 'fa-solid fa-lightbulb',
    label: 'Clue',
    short: 'Petunjuk',
    desc: 'Buka petunjuk untuk soal yang sedang aktif.',
  },
  {
    key: 'shield',
    cls: 'shield',
    group: 'defense',
    icon: 'fa-solid fa-shield-halved',
    label: 'Shield',
    short: 'Perisai',
    desc: 'Serap satu serangan senjata lawan atau satu hukuman; bertahan sampai giliranmu berikutnya.',
  },
  {
    key: 'changeQuestion',
    cls: 'change',
    group: 'help',
    icon: 'fa-solid fa-rotate',
    label: 'Ganti Soal',
    short: 'Tukar',
    desc: 'Tukar soal aktif dengan soal berikutnya dari bank soal.',
  },
  {
    key: 'doubleMove',
    cls: 'double',
    group: 'help',
    icon: 'fa-solid fa-bolt',
    label: 'Double Move',
    short: '2× maju',
    desc: 'Jika jawaban benar, langkah maju menjadi dua kali lipat.',
  },
  {
    key: 'penawar',
    cls: 'penawar',
    group: 'defense',
    icon: 'fa-solid fa-prescription-bottle-medical',
    label: 'Penawar',
    short: 'Salah tidak mundur',
    desc: 'Batalkan hukuman mundur dari jawaban salah atau waktu habis pada giliran ini.',
  },
];

const CSV_HEADER =
  'Pertanyaan;Pilihan A;Pilihan B;Pilihan C;Pilihan D;Jawaban Benar (A/B/C/D);Clue;Reward (langkah maju);Penalty (langkah mundur);Durasi (detik)';

const CSV_SAMPLE_ROWS = [
  'Berapa hasil dari 2 + 2?;2;3;4;5;C;Operasi penjumlahan dasar;5;3;15',
  'Apa ibu kota Indonesia?;Bandung;Jakarta;Surabaya;Medan;B;Kota terbesar di Indonesia;4;2;10',
  'Siapa presiden pertama Indonesia?;Soeharto;Soekarno;Habibie;Megawati;B;Proklamator kemerdekaan;6;3;20',
  'Berapa hasil dari 5 x 3?;10;15;20;25;B;Perkalian dasar;5;3;15',
  'Planet terdekat dengan matahari?;Venus;Mars;Merkurius;Bumi;C;Planet pertama dari matahari;4;2;12',
  'Berapa jumlah provinsi di Indonesia?;34;35;36;37;A;Jumlah provinsi terbaru;5;3;15',
  'Siapa penemu lampu pijar?;Edison;Einstein;Newton;Tesla;A;Penemu asal Amerika;5;3;15',
  '1 + 1 = ?;1;2;3;4;B;Penjumlahan paling dasar;3;2;10',
  'Ibu kota Provinsi Jawa Barat?;Bandung;Jakarta;Semarang;Surabaya;A;Dijuluki kota kembang;4;2;10',
  'Hewan tercepat di darat?;Singa;Cheetah;Harimau;Kuda;B;Kucing besar berbintik;5;3;15',
];

const pad = (value) => value.toString().padStart(2, '0');
const formatTime = (seconds) => `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds % 60))}`;
const sumHelps = (bag) => Object.values(bag).reduce((sum, value) => sum + value, 0);

/* Bag dari luar (state lama, sesi tersimpan, atau prop) bisa kehilangan key
   bantuan baru seperti penawar. Normalisasi menjamin setiap key numerik agar
   tombol tidak pernah menghitung NaN. */
const normalizeBag = (bag) => {
  const base = DEFAULT_HELPS();
  if (!bag || typeof bag !== 'object') return base;
  Object.keys(base).forEach((key) => {
    const value = Number(bag[key]);
    base[key] = Number.isFinite(value) && value >= 0 ? value : base[key];
  });
  return base;
};

const rowCases = (row, col) => (row % 2 === 1 ? row * BOARD_SIZE + (BOARD_SIZE - col) : row * BOARD_SIZE + col + 1);

/* ------------------------------------------------------------------ */
/* Audio sintetis (Web Audio, tanpa file aset)                         */
/* ------------------------------------------------------------------ */

const SFX_RECIPES = {
  bomb: { type: 'noise', start: 0.14, from: 620, to: 70, dur: 0.38, gain: 0.5 },
  magnet: { type: 'sine', start: 0.1, from: 240, to: 660, dur: 0.32, gain: 0.32 },
  portal: { type: 'sine', start: 0.05, from: 520, to: 880, dur: 0.18, gain: 0.28, repeat: 2 },
  trap: { type: 'square', start: 0.02, from: 420, to: 180, dur: 0.16, gain: 0.22 },
  block: { type: 'triangle', start: 0.01, from: 220, to: 120, dur: 0.22, gain: 0.3 },
};

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

    if (recipe.type === 'noise') {
      const length = Math.floor(ctx.sampleRate * recipe.dur);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let s = 0; s < length; s++) data[s] = (Math.random() * 2 - 1) * (1 - s / length);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(recipe.from, at);
      filter.frequency.exponentialRampToValueAtTime(recipe.to, at + recipe.dur);
      source.connect(filter);
      filter.connect(gain);
      source.start(at);
      source.stop(at + recipe.dur);
    } else {
      const osc = ctx.createOscillator();
      osc.type = recipe.type;
      osc.frequency.setValueAtTime(recipe.from, at);
      osc.frequency.exponentialRampToValueAtTime(recipe.to, at + recipe.dur);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + recipe.dur);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Senjata papan                                                       */
/* ------------------------------------------------------------------ */

function pickRandomWeapon() {
  return WEAPONS[Math.floor(Math.random() * WEAPONS.length)];
}

/* Jenis senjata per kotak, diacak sekali lalu dipakai sepanjang sesi. */
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

/* Target sah: semua lawan (tanpa batas jarak), kecuali Portal yang hanya
   boleh ke lawan di depan agar penyerang tidak menurunkan posisinya sendiri. */
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

/* Ambil satu bantuan acak dari kuota lawan. Mengembalikan baki baru dan
   key yang terambil (null bila lawan tidak punya sisa bantuan). */
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

function parseCsv(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let lines = normalized.split('\n').filter((line) => line.trim().length > 0);
  const errors = [];
  const questions = [];
  let rowNumber = 1;

  if (lines.length && /pertanyaan/i.test(lines[0]) && /jawaban/i.test(lines[0])) {
    lines = lines.slice(1);
  }

  lines.forEach((line) => {
    rowNumber += 1;
    const parts = splitDelimited(line, ';');
    const questionText = (parts[0] || '').trim();

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

    questions.push({
      id: `q${questions.length + 1}`,
      question: questionText,
      options: [
        (parts[1] || 'Pilihan A').trim(),
        (parts[2] || 'Pilihan B').trim(),
        (parts[3] || 'Pilihan C').trim(),
        (parts[4] || 'Pilihan D').trim(),
      ],
      correctAnswer,
      clue: (parts[6] || 'Tidak ada clue').trim(),
      reward: parseRange(parts[7], 5, 1, 12),
      penalty: parseRange(parts[8], 3, 1, 10),
      duration: parseRange(parts[9], 15, 5, 180),
      used: false,
    });
  });

  return { questions, errors };
}

const downloadTemplate = () => {
  const content = [CSV_HEADER, ...CSV_SAMPLE_ROWS].join('\r\n');
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'template_soal_eduladder.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

/* ------------------------------------------------------------------ */
/* Shared UI                                                           */
/* ------------------------------------------------------------------ */

function Modal({ open, onClose, labelledBy, narrow, children, closable = true }) {
  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (closable && event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        {closable && (
          <button className="modal-close" onClick={onClose} aria-label="Tutup dialog">
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Toasts({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-layer" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone} ${toast.leaving ? 'leaving' : ''}`}>
          <i className={toast.icon} aria-hidden="true"></i>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

function ResultFlash({ flash }) {
  if (!flash) return null;
  return (
    <div className={`flash ${flash.tone}`} aria-hidden="true">
      <div className="flash-inner">
        <i className={flash.tone === 'good' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'}></i>
        <span>{flash.text}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

function centerOf(cell, svgW, svgH) {
  const col = (cell - 1) % BOARD_SIZE;
  const rowFromBottom = Math.floor((cell - 1) / BOARD_SIZE);
  const rowFromTop = BOARD_SIZE - 1 - rowFromBottom;
  const visualCol = rowFromBottom % 2 === 0 ? col : BOARD_SIZE - 1 - col;
  const cellW = svgW / BOARD_SIZE;
  const cellH = svgH / BOARD_SIZE;
  return { x: cellW * (visualCol + 0.5), y: cellH * (rowFromTop + 0.5) };
}

function ladderGraphic(from, to, svgW, svgH) {
  const a = centerOf(from, svgW, svgH);
  const b = centerOf(to, svgW, svgH);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const unit = svgW / BOARD_SIZE;
  const half = unit * 0.16;

  const rungs = [];
  const count = Math.max(3, Math.round(length / (unit / 2.2)));
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    rungs.push(
      <line
        key={i}
        x1={cx + nx * half}
        y1={cy + ny * half}
        x2={cx - nx * half}
        y2={cy - ny * half}
        stroke="#ca8a04"
        strokeWidth={unit * 0.06}
        strokeLinecap="round"
      />
    );
  }

  return (
    <g key={`ladder-${from}`}>
      <line x1={a.x + nx * half} y1={a.y + ny * half} x2={b.x + nx * half} y2={b.y + ny * half} stroke="#a16207" strokeWidth={unit * 0.08} strokeLinecap="round" />
      <line x1={a.x - nx * half} y1={a.y - ny * half} x2={b.x - nx * half} y2={b.y - ny * half} stroke="#a16207" strokeWidth={unit * 0.08} strokeLinecap="round" />
      {rungs}
      <circle cx={b.x} cy={b.y} r={unit * 0.13} fill="#22c55e" stroke="#fff" strokeWidth={unit * 0.03} />
    </g>
  );
}

function snakeGraphic(head, tail, svgW, svgH, index) {
  const a = centerOf(head, svgW, svgH);
  const b = centerOf(tail, svgW, svgH);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const unit = svgW / BOARD_SIZE;
  const amplitude = Math.min(length * 0.14, unit * 0.8);
  const segments = 28;
  const points = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const wave = Math.sin(t * Math.PI * 3) * amplitude * Math.sin(t * Math.PI);
    points.push({
      x: a.x + dx * t + nx * wave,
      y: a.y + dy * t + ny * wave,
    });
  }

  const path = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const color = index % 2 === 0 ? '#be123c' : '#7e22ce';
  const width = unit * 0.17;

  return (
    <g key={`snake-${head}`}>
      <path d={path} fill="none" stroke="rgba(69,10,10,0.22)" strokeWidth={width + unit * 0.06} strokeLinecap="round" />
      <path d={path} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
      <path
        d={path}
        fill="none"
        stroke="rgba(255,255,255,0.38)"
        strokeWidth={width * 0.26}
        strokeLinecap="round"
        strokeDasharray={`${width * 0.45} ${width * 1.7}`}
      />
      <circle cx={a.x} cy={a.y} r={unit * 0.3} fill="#fb7185" stroke="#fff" strokeWidth={unit * 0.055} />
      <circle cx={a.x - unit * 0.1} cy={a.y - unit * 0.07} r={unit * 0.055} fill="#450a0a" />
      <circle cx={a.x + unit * 0.11} cy={a.y - unit * 0.05} r={unit * 0.055} fill="#450a0a" />
      <path
        d={`M${a.x - unit * 0.11} ${a.y + unit * 0.13} l${unit * 0.22} 0`}
        stroke="#450a0a"
        strokeWidth={unit * 0.04}
        strokeLinecap="round"
      />
      <circle cx={b.x} cy={b.y} r={unit * 0.09} fill={color} stroke="#fff" strokeWidth={unit * 0.025} />
    </g>
  );
}

const BOARD_CELLS = (() => {
  const list = [];
  for (let row = BOARD_SIZE - 1; row >= 0; row--) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const num = rowCases(row, col);
      list.push({
        num,
        dark: (row + col) % 2 === 1,
        ladder: Boolean(LADDERS[num]),
        snake: Boolean(SNAKES[num]),
        arm: WEAPON_CELLS.includes(num),
      });
    }
  }
  return list;
})();

function Board({ players, positions, targetCell, movingId, weaponFor }) {
  return (
    <div className="board-stage">
      <div className="board-surface">
        {BOARD_CELLS.map((cell) => {
          const weapon = cell.arm && weaponFor ? weaponOf(weaponFor(cell.num)) : null;
          return (
            <div
              key={cell.num}
              className={[
                'cell',
                cell.dark ? 'dark' : '',
                cell.ladder ? 'ladder-cell' : '',
                cell.snake ? 'snake-cell' : '',
                cell.arm ? 'arm-cell' : '',
                cell.num === WIN_POSITION ? 'finish' : '',
                cell.num === 1 ? 'start' : '',
                targetCell === cell.num ? 'is-target' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="cell-num">{cell.num}</span>
              {cell.num === WIN_POSITION && <i className="fa-solid fa-trophy cell-icon" aria-hidden="true"></i>}
              {cell.ladder && <i className="fa-solid fa-stairs cell-icon" aria-hidden="true"></i>}
              {cell.snake && <i className="fa-solid fa-staff-snake cell-icon" aria-hidden="true"></i>}
              {cell.arm && (
                <i
                  className={`${weapon ? weapon.icon : 'fa-solid fa-crosshairs'} cell-icon arm-icon`}
                  title={weapon ? `Kotak senjata: ${weapon.label}` : 'Kotak senjata'}
                  aria-hidden="true"
                ></i>
              )}

              {(() => {
                const occupants = players.filter((player) => positions[player.id] === cell.num);
                if (!occupants.length) return null;
                return (
                  <div className={`tokens ${occupants.length > 1 ? 'shared' : ''} count-${occupants.length}`}>
                    {occupants.map((player) => (
                      <div
                        key={player.id}
                        className={`token ${movingId === player.id ? 'moving' : ''}`}
                        style={themeVars(player)}
                        title={playerNameOf(player)}
                      >
                        {player.slot}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <svg className="board-svg" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">
        {Object.keys(LADDERS).map((from) => ladderGraphic(Number(from), LADDERS[from], 1000, 1000))}
        {Object.keys(SNAKES).map((head, index) => snakeGraphic(Number(head), SNAKES[head], 1000, 1000, index))}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3D scene                                                             */
/* ------------------------------------------------------------------ */

const detectWebGL = () => {
  if (!window.Board3D) {
    return { ok: false, reason: 'board3d.js gagal dimuat' };
  }
  if (!window.THREE) {
    return { ok: false, reason: 'Three.js gagal dimuat dari CDN' };
  }
  try {
    if (typeof window.Board3D.supported === 'function') return window.Board3D.supported();
    return { ok: Boolean(window.Board3D), reason: '' };
  } catch (error) {
    return { ok: false, reason: `Deteksi WebGL gagal: ${error && error.message ? error.message : error}` };
  }
};

function Scene3D({ boardRef, players, positions, onError, onReady }) {
  const mountRef = useRef(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const fail = (reason, error) => {
      console.warn(`Papan 3D tidak tersedia: ${reason}`, error || '');
      if (onErrorRef.current) onErrorRef.current(reason);
    };
    if (!window.Board3D) {
      fail('board3d.js gagal dimuat');
      return undefined;
    }
    if (!window.THREE) {
      fail('Three.js gagal dimuat dari CDN');
      return undefined;
    }
    let board = null;
    try {
      board = new window.Board3D(mount, {
        ladders: LADDERS,
        snakes: SNAKES,
        weaponCells: WEAPON_CELLS,
        players: players.map((player) => ({ ...player, name: playerNameOf(player) })),
        positions,
        onError: (error) => {
          const message = error && error.message ? error.message : 'Konteks WebGL bermasalah';
          if (onErrorRef.current) onErrorRef.current(message);
        },
      });
      boardRef.current = board;
      if (onReadyRef.current) onReadyRef.current(board);
    } catch (error) {
      fail(error && error.message ? error.message : 'Papan 3D gagal dibuat', error);
    }
    return () => {
      if (board) board.dispose();
      if (boardRef.current === board) boardRef.current = null;
    };
    // Papan dibuat sekali per sesi permainan; daftar pemain terkunci saat bermain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="scene-mount" ref={mountRef} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/* Question overlay                                                    */
/* ------------------------------------------------------------------ */

function OverlayAnswerGrid({ question, picked, showAnswer, onAnswer }) {
  return (
    <div className="overlay-answers" role="group" aria-label="Pilihan jawaban">
      {question.options.map((option, index) => {
        const letter = String.fromCharCode(65 + index);
        const isCorrect = letter === question.correctAnswer;
        const isPicked = picked === letter;
        let stateClass = '';
        let verdictIcon = null;

        if (showAnswer) {
          if (isPicked && isCorrect) {
            stateClass = 'picked-correct';
            verdictIcon = <i className="fa-solid fa-circle-check verdict" aria-hidden="true"></i>;
          } else if (isPicked) {
            stateClass = 'picked-wrong';
            verdictIcon = <i className="fa-solid fa-circle-xmark verdict" aria-hidden="true"></i>;
          } else if (isCorrect) {
            stateClass = 'revealed-correct';
            verdictIcon = <i className="fa-solid fa-circle-check verdict" style={{ color: '#15803d' }} aria-hidden="true"></i>;
          } else {
            stateClass = 'dimmed';
          }
        }

        return (
          <button
            key={letter}
            type="button"
            className={`answer overlay-answer ${stateClass}`}
            onClick={() => onAnswer(letter)}
            disabled={showAnswer}
            aria-label={`Pilihan ${letter}: ${option}`}
          >
            <span className="letter">{letter}</span>
            <span className="answer-text">{option}</span>
            {verdictIcon}
          </button>
        );
      })}
    </div>
  );
}

const HELP_TABS = [
  { key: 'help', label: 'Bantuan', icon: 'fa-solid fa-wand-magic-sparkles' },
  { key: 'defense', label: 'Pertahanan', icon: 'fa-solid fa-shield-halved' },
];

function HelpsRow({
  ownerLabel,
  helps,
  onUseHelp,
  helpBlocked,
  helpActive,
  helpDescription,
  tab,
  onTabChange,
}) {
  const groupHelps = HELPS.filter((help) => help.group === tab);
  /* Hitung per grup tab, bukan grup tab yang sedang aktif, agar badge tiap
     tab menampilkan kuotanya sendiri. */
  const groupCount = (groupKey) =>
    HELPS.filter((help) => help.group === groupKey).reduce((sum, help) => sum + (helps[help.key] || 0), 0);

  return (
    <div className="overlay-helps">
      <div className="overlay-helps-head">
        <h3>
          <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Bantuan {ownerLabel}
        </h3>
        <span className="pill neutral">
          <i className="fa-solid fa-layer-group" aria-hidden="true"></i>
          {sumHelps(helps)} tersisa
        </span>
      </div>
      <div className="helps-tabs" role="tablist" aria-label="Jenis bantuan">
        {HELP_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`helps-tab-${item.key}`}
            aria-selected={tab === item.key}
            aria-controls={`helps-panel-${item.key}`}
            className={`help-tab ${tab === item.key ? 'active' : ''}`}
            onClick={() => onTabChange(item.key)}
          >
            <i className={item.icon} aria-hidden="true"></i>
            {item.label}
            <span className="help-tab-count">{groupCount(item.key)}</span>
          </button>
        ))}
      </div>
      <div
        className={`helps-grid overlay-helps-grid ${tab === 'defense' ? 'defense' : ''}`}
        role="tabpanel"
        id={`helps-panel-${tab}`}
        aria-labelledby={`helps-tab-${tab}`}
        aria-label={`Bantuan ${tab === 'defense' ? 'pertahanan' : 'utama'}`}
      >
        {groupHelps.map((help) => (
          <button
            key={help.key}
            type="button"
            className={`help-btn ${help.cls} ${helpActive(help.key) ? 'active' : ''}`}
            onClick={() => onUseHelp(help.key)}
            disabled={helpBlocked(help.key)}
            aria-label={`${help.label}: ${help.short}. Sisa ${helps[help.key]}.`}
            aria-pressed={helpActive(help.key)}
            title={help.desc}
          >
            <span className={`help-count ${helps[help.key] === 0 ? 'zero' : ''}`}>{helps[help.key]}</span>
            <i className={help.icon} aria-hidden="true"></i>
            {help.label}
          </button>
        ))}
      </div>
      <p className="help-desc">{helpDescription}</p>
    </div>
  );
}

function ArmBay({ slots, active, canUse, fired, onPick, variant }) {
  const items = [0, 1].map((index) => slots[index] || null);
  /* Slot kosong hanya berguna sebagai indikator kapasitas di panel overlay.
     Di kartu skor HUD, baki kosong cukup disembunyikan. */
  if (!slots.length && variant !== 'panel') return null;
  return (
    <div className={`arm-bay ${active ? 'active' : ''} ${variant === 'panel' ? 'panel' : ''}`} aria-label="Baki senjata">
      {items.map((slot, index) => {
        const weapon = slot ? weaponOf(slot.key) : null;
        const usable = Boolean(slot) && active && canUse && !fired;
        return (
          <button
            key={slot ? slot.uid : `empty-${index}`}
            type="button"
            className={`arm-slot ${weapon ? 'filled' : 'empty'} ${usable ? 'usable' : ''}`}
            style={weapon ? { '--arm-tone': weapon.tone, '--arm-soft': weapon.soft, '--arm-line': weapon.line } : undefined}
            onClick={() => (usable ? onPick(slot) : null)}
            disabled={!usable}
            aria-label={
              weapon
                ? `${weapon.label}${usable ? ', tekan untuk memilih lawan' : fired ? ', sudah menyerang giliran ini' : ''}`
                : `Slot senjata ${index + 1} kosong`
            }
            title={
              weapon
                ? `${weapon.label} — ${usable ? 'pilih lawan' : fired ? 'sudah menyerang' : 'bukan giliranmu'}`
                : 'Slot kosong'
            }
          >
            <i className={weapon ? weapon.icon : 'fa-regular fa-square'} aria-hidden="true"></i>
            {weapon && <span className="arm-slot-label">{weapon.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

function ArmTargetModal({ request, actorName, describeEffect, onConfirm, onClose }) {
  if (!request) return null;
  const weapon = weaponOf(request.slot.key);
  const anyValid = request.targets.some((item) => item.valid);

  return (
    <Modal open onClose={onClose} labelledBy="arm-title" narrow>
      <div className="arm-modal-icon" style={{ background: weapon.soft, color: weapon.tone }}>
        <i className={weapon.icon} aria-hidden="true"></i>
      </div>
      <h2 id="arm-title">Lepas {weapon.label}?</h2>
      <p className="lead">
        {actorName} memilih lawan untuk dikenai {weapon.label}. Satu serangan per giliran.
      </p>
      <div className="arm-targets" role="list">
        {request.targets.map((item) => (
          <button
            key={item.player.id}
            type="button"
            role="listitem"
            className="arm-target"
            style={themeVars(item.player)}
            disabled={!item.valid}
            onClick={() => onConfirm(item.player.id)}
          >
            <span className="avatar" aria-hidden="true">{item.player.slot}</span>
            <span className="grow">
              <span className="arm-target-name">{playerNameOf(item.player)}</span>
              <span className="arm-target-sub">
                Kotak {item.cell}
                {item.valid ? '' : ' · di belakangmu, Portal tidak bisa'}
              </span>
              {item.valid && describeEffect && (
                <span className="arm-target-delta">{describeEffect(item)}</span>
              )}
            </span>
            <i className={`fa-solid ${item.valid ? 'fa-arrow-right' : 'fa-ban'} arm-target-go`} aria-hidden="true"></i>
          </button>
        ))}
      </div>
      {!anyValid && (
        <p className="overlay-note">Tidak ada target sah. Pilih senjata lain atau simpan untuk giliran berikutnya.</p>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          Batal
        </button>
      </div>
    </Modal>
  );
}

function ArmPickModal({ pick, onPick, onCancel }) {
  if (!pick) return null;
  const weapon = weaponOf(pick.slot.key);
  return (
    <Modal open onClose={onCancel} labelledBy="armpick-title" narrow>
      <div className="arm-modal-icon" style={{ background: weapon.soft, color: weapon.tone }}>
        <i className={weapon.icon} aria-hidden="true"></i>
      </div>
      <h2 id="armpick-title">Baki senjata penuh</h2>
      <p className="lead">Kamu baru mendapat {weapon.label}. Pilih slot yang diganti, atau lepaskan senjata baru ini.</p>
      <div className="arm-pick-list">
        {(pick.slots || []).map((slot, index) => {
          const existing = weaponOf(slot.key);
          return (
            <button key={slot.uid || index} type="button" className="arm-pick" onClick={() => onPick(index)}>
              <span className="arm-pick-icon" style={{ background: existing.soft, color: existing.tone }}>
                <i className={existing.icon} aria-hidden="true"></i>
              </span>
              <span className="grow">
                <span className="arm-target-name">Slot {index + 1}: {existing.label}</span>
                <span className="arm-target-sub">Ganti dengan {weapon.label}</span>
              </span>
              <i className="fa-solid fa-rotate arm-target-go" aria-hidden="true"></i>
            </button>
          );
        })}
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
          Lepaskan senjata baru
        </button>
      </div>
    </Modal>
  );
}

function StartCountdown({ count, teamName }) {
  return (
    <div
      className="start-countdown"
      role="status"
      aria-live="assertive"
      aria-label={`Permainan dimulai dalam ${count} detik`}
    >
      <div className="start-countdown-inner">
        <span className="start-kicker">
          <i className="fa-solid fa-flag-checkered" aria-hidden="true"></i> Bersiap!
        </span>
        <span key={count} className="start-number" aria-hidden="true">{count}</span>
        <span className="start-team">Giliran {teamName} · mulai dari kotak 1</span>
        <div className="start-progress" aria-hidden="true">
          <span key={`bar-${count}`}></span>
        </div>
      </div>
    </div>
  );
}

function MainQuestionOverlay({
  question,
  answeringId,
  activeId,
  players,
  seconds,
  showClue,
  picked,
  showAnswer,
  reward,
  penaltyBlocked,
  penawarBlocked,
  onAnswer,
  helps,
  onUseHelp,
  helpBlocked,
  helpActive,
  helpDescription,
  helpsTab,
  onHelpsTabChange,
  armSlots,
  showArms,
  canUseArms,
  armsFired,
  onPickArm,
  positions,
  bankLeft,
}) {
  const answeringPlayer = players.find((player) => player.id === answeringId) || players[0];
  const activeBag = normalizeBag(helps[activeId]);

  return (
    <div className="overlay-root" role="dialog" aria-modal="true" aria-label="Soal aktif">
      <div className="overlay-card">
        <section className="overlay-main" aria-label="Kartu soal">
          <div className="overlay-head">
            <span className="q-team-chip" style={themeVars(answeringPlayer)}>
              <i className="fa-solid fa-user" aria-hidden="true"></i>
              {playerNameOf(answeringPlayer)}
            </span>
            <span className={`pill ${showAnswer ? 'neutral' : 'brand'}`}>
              <i className={`fa-solid ${showAnswer ? 'fa-flag-checkered' : 'fa-hand-pointer'}`} aria-hidden="true"></i>
              {showAnswer ? 'Jawaban dibuka' : 'Pilih satu jawaban'}
            </span>
            <span className="grow"></span>
            <Countdown seconds={seconds} limit={question.duration} theme={themeVars(answeringPlayer)} />
          </div>

          <h2 className="overlay-question">{question.question}</h2>
          {showClue && (
            <div className="clue-box overlay-clue">
              <i className="fa-solid fa-lightbulb" aria-hidden="true"></i>
              <span>{question.clue}</span>
            </div>
          )}

          <OverlayAnswerGrid question={question} picked={picked} showAnswer={showAnswer} onAnswer={onAnswer} />

          <div className="overlay-foot">
            <span className={`pill ${reward.double ? 'warn' : 'good'}`}>
              <i className="fa-solid fa-arrow-up-right-dots" aria-hidden="true"></i>
              Benar: maju {reward.text}
            </span>
            <span className={`pill ${penaltyBlocked || penawarBlocked ? 'neutral' : 'bad'}`}>
              <i className={`fa-solid ${penaltyBlocked ? 'fa-shield-halved' : 'fa-arrow-down-right'}`} aria-hidden="true"></i>
              {penaltyBlocked
                ? 'Salah: dilindungi shield'
                : penawarBlocked
                  ? 'Salah: ditahan penawar'
                  : `Salah: mundur ${question.penalty}`}
            </span>
          </div>
        </section>

        <aside className="overlay-side" aria-label="Status permainan">
          <div className="overlay-side-card">
            <h3>Skor Saat Ini</h3>
            {players.map((player) => (
              <div
                key={player.id}
                className={`overlay-score-row ${activeId === player.id ? 'active' : ''}`}
                style={themeVars(player)}
              >
                <span className="avatar" aria-hidden="true">{player.slot}</span>
                <span className="overlay-score-name">{playerNameOf(player)}</span>
                <span className="overlay-score-pos">{positions[player.id]}<small>/100</small></span>
              </div>
            ))}
          </div>

          <div className="overlay-side-card">
            <h3>Bank Soal</h3>
            <p className="overlay-bank">
              <i className="fa-solid fa-database" aria-hidden="true"></i>
              {bankLeft} soal tersisa
            </p>
          </div>

          <div className="overlay-side-card arm-side-card">
            <div className="arm-side-head">
              <h3>Senjata</h3>
              {showArms && (
                <span className="pill neutral">
                  <i className="fa-solid fa-crosshairs" aria-hidden="true"></i>
                  {armSlots.length}/{ARMS_CAPACITY}
                </span>
              )}
            </div>
            {showArms ? (
              <>
                <ArmBay
                  slots={armSlots}
                  active
                  canUse={canUseArms}
                  fired={armsFired}
                  onPick={onPickArm}
                  variant="panel"
                />
                <p className="overlay-note">
                  {armsFired
                    ? 'Senjata sudah dilepas giliran ini.'
                    : armSlots.length
                      ? 'Lepas senjata sebelum menjawab. Satu serangan per giliran.'
                      : 'Mendarat di kotak senjata untuk mengisi baki.'}
                </p>
              </>
            ) : (
              <p className="overlay-note">
                Soal ini dilempar ke {playerNameOf(answeringPlayer)}. Serangan hanya bisa dilepas pada giliran sendiri.
              </p>
            )}
          </div>

            <HelpsRow
              ownerLabel={playerNameOf(answeringPlayer)}
              helps={activeBag}
              onUseHelp={onUseHelp}
              helpBlocked={helpBlocked}
              helpActive={helpActive}
              helpDescription={helpDescription}
              tab={helpsTab}
              onTabChange={onHelpsTabChange}
            />
        </aside>
      </div>
    </div>
  );
}

function BonusOverlay({ info, fallbackQuestion, players, onResolve, bankLeft }) {
  const [picked, setPicked] = useState(null);
  const [seconds, setSeconds] = useState(null);
  const question = info.question || fallbackQuestion || null;
  const player = players.find((item) => item.id === info.playerId) || players[0];

  useEffect(() => {
    setPicked(null);
    if (!question) return undefined;
    setSeconds(question.duration);
    const id = setInterval(() => {
      setSeconds((value) => {
        if (value <= 1) {
          clearInterval(id);
          setPicked((current) => (current === null ? 'TIMEOUT' : current));
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [info, question]);

  useEffect(() => {
    if (!question) return undefined;
    const onKey = (event) => {
      if (picked !== null) {
        if (event.key === 'Enter') {
          event.preventDefault();
          onResolve(picked === question.correctAnswer);
        }
        return;
      }
      const digit = ['1', '2', '3', '4'].indexOf(event.key);
      const lower = event.key.toLowerCase();
      let letter = null;
      if (digit >= 0) letter = ['A', 'B', 'C', 'D'][digit];
      else if (['a', 'b', 'c', 'd'].includes(lower)) letter = lower.toUpperCase();
      if (letter) {
        event.preventDefault();
        setPicked(letter);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [question, picked, onResolve]);

  if (!question) {
    return (
      <div className="overlay-root" role="dialog" aria-modal="true" aria-label="Bank soal habis">
        <div className="overlay-card bonus narrow">
          <section className="overlay-main">
            <div className={`overlay-icon ${info.type === 'ladder' ? 'ladder' : 'snake'}`}>
              <i className={`fa-solid ${info.type === 'ladder' ? 'fa-stairs' : 'fa-staff-snake'}`} aria-hidden="true"></i>
            </div>
            <h2 className="overlay-question">Bank soal tambahan habis</h2>
            <p className="overlay-lead">
              Tidak ada soal tersisa untuk uji {info.type === 'ladder' ? 'tangga bonus' : 'ular'}. Permainan lanjut tanpa uji
              tambahan.
            </p>
            <div className="overlay-actions">
              <button className="btn btn-primary" onClick={() => onResolve(false)}>
                <i className="fa-solid fa-forward" aria-hidden="true"></i>
                Lanjut Permainan
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const answered = picked !== null;
  const isCorrect = picked === question.correctAnswer;
  const isLadder = info.type === 'ladder';

  return (
    <div className="overlay-root" role="dialog" aria-modal="true" aria-label={isLadder ? 'Tangga bonus' : 'Soal penyelamat ular'}>
      <div className={`overlay-card bonus ${info.type}`}>
        <section className="overlay-main" aria-label="Kartu soal bonus">
          <div className="overlay-head">
            <span className={`overlay-kicker ${info.type}`}>
              <i className={`fa-solid ${isLadder ? 'fa-stairs' : 'fa-staff-snake'}`} aria-hidden="true"></i>
              {isLadder ? 'Tangga Bonus' : 'Soal Penyelamat Ular'}
            </span>
            <span className="q-team-chip" style={themeVars(player)}>
              <i className="fa-solid fa-user" aria-hidden="true"></i>
              {playerNameOf(player)}
            </span>
            <span className="grow"></span>
            <Countdown seconds={seconds === null ? 0 : seconds} limit={question.duration} theme={themeVars(player)} />
          </div>

          <h2 className="overlay-question">{question.question}</h2>
          <p className="overlay-lead">
            {isLadder
              ? `Berhenti di kotak ${info.from}. Jawab benar untuk naik ke kotak ${info.to}.`
              : `Berhenti di kepala ular kotak ${info.from}. Jawab benar untuk bertahan, salah turun ke kotak ${info.to}.`}
          </p>

          <OverlayAnswerGrid question={question} picked={picked} showAnswer={answered} onAnswer={(letter) => { if (!answered) setPicked(letter); }} />

          {answered ? (
            <div className="overlay-actions">
              <button className={`btn ${isCorrect ? 'btn-success' : 'btn-danger-solid'}`} onClick={() => onResolve(isCorrect)}>
                <i className={`fa-solid ${isCorrect ? 'fa-circle-check' : 'fa-circle-xmark'}`} aria-hidden="true"></i>
                {isCorrect ? 'Hebat! Lanjutkan' : 'Lihat akibatnya'}
              </button>
            </div>
          ) : (
            <p className="overlay-note">
              <i className="fa-solid fa-hand-pointer" aria-hidden="true"></i> Pilih satu jawaban sebelum waktu habis.
            </p>
          )}
        </section>

        <aside className="overlay-side" aria-label="Status bonus">
          <div className="overlay-side-card">
            <h3>{isLadder ? 'Naik Tangga' : 'Gigitan Ular'}</h3>
            <p className="overlay-bank">
              <i className={`fa-solid ${isLadder ? 'fa-arrow-up' : 'fa-arrow-down'}`} aria-hidden="true"></i>
              Kotak {info.from} → {info.to}
            </p>
            <p className="overlay-note">
              {isLadder ? 'Benar: naik. Salah: tetap di kotak asal.' : 'Benar: bertahan. Salah: turun ke ekor ular.'}
            </p>
          </div>
          <div className="overlay-side-card">
            <h3>Bank Soal</h3>
            <p className="overlay-bank">
              <i className="fa-solid fa-database" aria-hidden="true"></i> {bankLeft} soal tersisa
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Question panel                                                      */
/* ------------------------------------------------------------------ */

function Countdown({ seconds, limit, theme }) {
  const size = 100;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const ratio = limit > 0 ? Math.max(0, Math.min(1, seconds / limit)) : 0;
  const stateClass = seconds <= 3 ? 'critical' : seconds <= 5 ? 'warn' : '';

  return (
    <div className={`countdown ${stateClass}`} style={theme} role="timer" aria-label={`Sisa waktu ${seconds} detik`}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="track" cx={size / 2} cy={size / 2} r={radius} />
        <circle
          className="progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <div className="countdown-label">
        <strong>{seconds}</strong>
        <span>DETIK</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Setup screen                                                        */
/* ------------------------------------------------------------------ */

function SetupScreen({
  questions,
  csvErrors,
  onUpload,
  onDragState,
  dragover,
  onClearData,
  players,
  onPlayerNameChange,
  onAddPlayer,
  onRemovePlayer,
  shuffle,
  onShuffleChange,
  loading,
  onStart,
  onConfirmClear,
  onCancelClear,
  confirmClear,
  notify,
}) {
  const fileInput = useRef(null);
  const loaded = questions.length;
  const minQuestions = Math.max(MIN_QUESTIONS, players.length);
  const ready = loaded >= minQuestions;
  const progress = Math.min(100, Math.round((loaded / minQuestions) * 100));
  const playersFilled = players.length >= 2 && players.every((player) => player.name.trim().length > 0);
  const canStart = ready && playersFilled && !loading;
  const nextSlot = PLAYER_SLOTS.find((slot) => !players.some((player) => player.slot === slot.slot));

  const checks = [
    { ok: loaded > 0, label: loaded > 0 ? `${loaded} soal berhasil dimuat` : 'Unggah bank soal (CSV)' },
    { ok: ready, label: ready ? 'Jumlah soal memenuhi syarat' : `Butuh minimal ${minQuestions} soal` },
    { ok: playersFilled, label: playersFilled ? 'Nama semua pemain sudah diisi' : 'Isi nama semua pemain' },
  ];

  return (
    <>
      <div className="setup">
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <h1 id="hero-title">
              EduLadder <em>Battle</em>
            </h1>
            <p>
              Game ular tangga edukatif untuk 2–4 pemain. Jawab soal, gunakan bantuan strategi, dan rebut kotak 100
              lebih dulu dari pemain lain.
            </p>
            <div className="hero-actions">
              <button className="btn btn-primary btn-xl" onClick={onStart} disabled={!canStart}>
                <i className={`fa-solid ${canStart ? 'fa-play' : 'fa-lock'}`} aria-hidden="true"></i>
                Mulai Permainan
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  downloadTemplate();
                  notify('Template soal diunduh.', 'good', 'fa-solid fa-file-arrow-down');
                }}
              >
                <i className="fa-solid fa-file-arrow-down" aria-hidden="true"></i>
                Template CSV
              </button>
              <span className="hero-hint">
                <i className={`fa-solid ${canStart ? 'fa-circle-check' : 'fa-circle-info'}`} aria-hidden="true"></i>
                {canStart
                  ? 'Siap dimainkan sekarang'
                  : !ready
                    ? `Butuh ${Math.max(0, minQuestions - loaded)} soal lagi`
                    : 'Lengkapi nama pemain'}
              </span>
            </div>
          </div>

          <aside className="hero-checklist" aria-label="Kesiapan permainan">
            <h2>Kesiapan</h2>
            {checks.map((check) => (
              <div key={check.label} className={`check-row ${check.ok ? 'ok' : ''}`}>
                <span className="mark" aria-hidden="true">
                  <i className={`fa-solid ${check.ok ? 'fa-check' : 'fa-minus'}`}></i>
                </span>
                <span>{check.label}</span>
              </div>
            ))}
            <div className="meter">
              <span style={{ width: `${progress}%` }}></span>
            </div>
            <p className="meter-label">
              {loaded} soal dimuat · syarat minimal {minQuestions} untuk {players.length} pemain
            </p>
          </aside>
        </section>

        <div className="setup-grid">
          <div className="setup-col">
            <section className="panel" aria-labelledby="import-title">
              <div className="panel-head">
                <h2 className="panel-title" id="import-title">
                  <i className="fa-solid fa-file-csv" aria-hidden="true"></i>
                  Bank Soal
                </h2>
                <span className="grow"></span>
                <span className={`pill ${csvErrors.length ? 'warn' : loaded ? 'good' : 'neutral'}`}>
                  <i className={`fa-solid ${csvErrors.length ? 'fa-triangle-exclamation' : 'fa-database'}`} aria-hidden="true"></i>
                  {loaded} soal
                </span>
              </div>

              <div
                className={`dropzone ${dragover ? 'dragover' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  onDragState(true);
                }}
                onDragLeave={() => onDragState(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  onDragState(false);
                  const file = event.dataTransfer.files && event.dataTransfer.files[0];
                  if (file) onUpload(file);
                }}
              >
                <div className="dropzone-icon">
                  <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`} aria-hidden="true"></i>
                </div>
                <h3>{loading ? 'Membaca file...' : 'Tarik file CSV ke sini'}</h3>
                <p>Kolom dipisah titik koma (;). Gunakan template agar urutan kolom sesuai.</p>
                <div className="drawer-actions">
                  <button className="btn btn-info" onClick={() => fileInput.current && fileInput.current.click()} disabled={loading}>
                    <i className="fa-solid fa-upload" aria-hidden="true"></i>
                    Pilih File CSV
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      downloadTemplate();
                      notify('Template soal diunduh.', 'good', 'fa-solid fa-file-arrow-down');
                    }}
                  >
                    <i className="fa-solid fa-download" aria-hidden="true"></i>
                    Unduh Template
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files && event.target.files[0];
                    if (file) onUpload(file);
                    event.target.value = '';
                  }}
                  disabled={loading}
                  aria-label="Pilih file CSV bank soal"
                />
              </div>

              {csvErrors.length > 0 && (
                <div className="stack" style={{ marginTop: '0.9rem', gap: '0.4rem' }}>
                  {csvErrors.slice(0, 5).map((error) => (
                    <span key={error} className="pill bad" style={{ justifyContent: 'flex-start' }}>
                      <i className="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                      {error}
                    </span>
                  ))}
                  {csvErrors.length > 5 && <span className="panel-sub">...dan {csvErrors.length - 5} galat lainnya.</span>}
                </div>
              )}

              {loaded > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <div className="preview-ok">
                    <i className="fa-solid fa-circle-check" aria-hidden="true"></i>
                    Pratinjau {Math.min(loaded, 50)} soal pertama
                  </div>
                  <div className="table-scroll">
                    <table className="q-table">
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col">Pertanyaan</th>
                          <th scope="col">Kunci</th>
                          <th scope="col">Maju</th>
                          <th scope="col">Mundur</th>
                          <th scope="col">Detik</th>
                        </tr>
                      </thead>
                      <tbody>
                        {questions.slice(0, 50).map((question, index) => (
                          <tr key={question.id}>
                            <td>{index + 1}</td>
                            <td className="q-text">{question.question}</td>
                            <td>
                              <span className="tag">{question.correctAnswer}</span>
                            </td>
                            <td>+{question.reward}</td>
                            <td>-{question.penalty}</td>
                            <td>{question.duration}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section className="panel" aria-labelledby="rules-title">
              <div className="panel-head">
                <h2 className="panel-title" id="rules-title">
                  <i className="fa-solid fa-list-check" aria-hidden="true"></i>
                  Aturan Singkat
                </h2>
              </div>
              <div className="rules-grid">
                <div className="rule-card tone-amber">
                  <span className="rule-icon"><i className="fa-solid fa-trophy" aria-hidden="true"></i></span>
                  <div>
                    <strong>Rebut kotak 100</strong>
                    <p>Pemain pertama yang mencapai kotak 100 menjadi pemenang.</p>
                  </div>
                </div>
                <div className="rule-card">
                  <span className="rule-icon"><i className="fa-solid fa-circle-question" aria-hidden="true"></i></span>
                  <div>
                    <strong>Jawab dengan benar</strong>
                    <p>Benar maju, salah mundur. Waktu habis dihitung sebagai jawaban salah.</p>
                  </div>
                </div>
                <div className="rule-card tone-green">
                  <span className="rule-icon"><i className="fa-solid fa-stairs" aria-hidden="true"></i></span>
                  <div>
                    <strong>Tangga bonus</strong>
                    <p>Berhenti di kaki tangga memunculkan soal bonus untuk naik.</p>
                  </div>
                </div>
                <div className="rule-card tone-red">
                  <span className="rule-icon"><i className="fa-solid fa-staff-snake" aria-hidden="true"></i></span>
                  <div>
                    <strong>Ular menghadang</strong>
                    <p>Berhenti di kepala ular memunculkan soal penyelamat agar tidak turun.</p>
                  </div>
                </div>
                <div className="rule-card tone-blue">
                  <span className="rule-icon"><i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i></span>
                  <div>
                    <strong>6 bantuan</strong>
                    <p>6 bantuan dalam 2 tab: Bantuan &amp; Pertahanan.</p>
                  </div>
                </div>
                <div className="rule-card tone-purple">
                  <span className="rule-icon"><i className="fa-solid fa-bomb" aria-hidden="true"></i></span>
                  <div>
                    <strong>Senjata papan</strong>
                    <p>Mendarat di kotak senjata memberi Bom, Magnet, Portal, atau Perangkap. Satu serangan per giliran.</p>
                  </div>
                </div>
                <div className="rule-card">
                  <span className="rule-icon"><i className="fa-solid fa-flag-checkered" aria-hidden="true"></i></span>
                  <div>
                    <strong>Akhir permainan</strong>
                    <p>Berakhir saat ada yang mencapai 100 atau seluruh soal habis.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="setup-col">
            <section className="panel" aria-labelledby="teams-title">
              <div className="panel-head">
                <h2 className="panel-title" id="teams-title">
                  <i className="fa-solid fa-users-rectangle" aria-hidden="true"></i>
                  Peserta
                </h2>
              </div>
              <div className="setup-players">
                {players.map((player, index) => (
                  <div className="player-row" key={player.id} style={themeVars(player)}>
                    <span className="player-badge" aria-hidden="true">{player.slot}</span>
                    <div className="field">
                      <label htmlFor={`player-name-${player.id}`}>Pemain {index + 1}</label>
                      <input
                        id={`player-name-${player.id}`}
                        value={player.name}
                        onChange={(event) => onPlayerNameChange(player.id, event.target.value)}
                        maxLength={18}
                        placeholder={`Pemain ${player.slot}`}
                      />
                    </div>
                    <button
                      type="button"
                      className="icon-btn player-remove"
                      onClick={() => onRemovePlayer(player.id)}
                      disabled={players.length <= 2}
                      aria-label={`Hapus ${playerNameOf(player)}`}
                      title={players.length <= 2 ? 'Minimal 2 pemain' : 'Hapus pemain'}
                    >
                      <i className="fa-solid fa-user-minus" aria-hidden="true"></i>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost btn-block add-player"
                  onClick={onAddPlayer}
                  disabled={!nextSlot}
                >
                  <i className="fa-solid fa-user-plus" aria-hidden="true"></i>
                  {nextSlot ? `Tambah Pemain (slot ${nextSlot.slot})` : 'Maksimal 4 pemain'}
                </button>
              </div>

              <div style={{ marginTop: '0.9rem' }}>
                <div className="switch-row">
                  <div className="switch-text">
                    <strong>Acak urutan soal</strong>
                    <span>Soal dimainkan dalam urutan acak setiap permainan.</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shuffle}
                    aria-label="Acak urutan soal"
                    className="switch"
                    onClick={() => onShuffleChange(!shuffle)}
                  ></button>
                </div>
                <button className="btn btn-primary btn-block" style={{ marginTop: '1rem' }} onClick={onStart} disabled={!canStart}>
                  <i className="fa-solid fa-play" aria-hidden="true"></i>
                  Mulai Permainan
                </button>
                {!canStart && (
                  <p className="panel-sub" style={{ marginTop: '0.55rem', textAlign: 'center' }}>
                    {!ready
                      ? `Unggah minimal ${minQuestions} soal untuk ${players.length} pemain.`
                      : 'Isi nama setiap pemain terlebih dahulu.'}
                  </p>
                )}
              </div>
            </section>

            <section className="panel" aria-labelledby="help-title">
              <div className="panel-head">
                <h2 className="panel-title" id="help-title">
                  <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
                  Bantuan
                </h2>
              </div>
              <div className="stack" style={{ gap: '0.55rem' }}>
                {HELPS.map((help) => (
                  <div key={help.key} style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
                    <span
                      className="swatch"
                      style={{ width: '2.1rem', height: '2.1rem', background: 'var(--brand-soft)', color: 'var(--brand-deep)', flex: '0 0 auto' }}
                    >
                      <i className={help.icon} aria-hidden="true"></i>
                    </span>
                    <div>
                      <strong style={{ fontSize: '0.88rem' }}>{help.label}</strong>
                      <p className="panel-sub" style={{ lineHeight: 1.35 }}>{help.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel" aria-labelledby="weapon-title">
              <div className="panel-head">
                <h2 className="panel-title" id="weapon-title">
                  <i className="fa-solid fa-bomb" aria-hidden="true"></i>
                  Senjata Papan
                </h2>
                <span className="grow"></span>
                <span className="pill brand">
                  <i className="fa-solid fa-layer-group" aria-hidden="true"></i>
                  {ARMS_CAPACITY} slot
                </span>
              </div>
              <p className="panel-sub" style={{ marginBottom: '0.6rem' }}>
                Kotak {WEAPON_CELLS.join(', ')} memberi senjata. Lepas sebelum menjawab, satu serangan per giliran.
              </p>
              <div className="stack" style={{ gap: '0.55rem' }}>
                {WEAPONS.map((weapon) => (
                  <div key={weapon.key} style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
                    <span
                      className="swatch arm-swatch"
                      style={{ width: '2.1rem', height: '2.1rem', background: weapon.soft, color: weapon.tone, flex: '0 0 auto' }}
                    >
                      <i className={weapon.icon} aria-hidden="true"></i>
                    </span>
                    <div>
                      <strong style={{ fontSize: '0.88rem' }}>{weapon.label}</strong>
                      <p className="panel-sub" style={{ lineHeight: 1.35 }}>{WEAPON_DESCRIPTIONS[weapon.key]}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel" aria-labelledby="data-title">
              <div className="panel-head">
                <h2 className="panel-title" id="data-title">
                  <i className="fa-solid fa-database" aria-hidden="true"></i>
                  Data Lokal
                </h2>
              </div>
              <div className="danger-zone">
                <p>Soal dan daftar pemain tersimpan pada sesi browser ini. Menghapus data akan mengosongkannya.</p>
                <button className="btn btn-ghost danger btn-sm" onClick={onClearData}>
                  <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                  Hapus Data
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      <Modal open={confirmClear} onClose={onCancelClear} labelledBy="clear-title" narrow>
        <div className="modal-icon snake-tone">
          <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
        </div>
        <h2 id="clear-title">Hapus semua data?</h2>
        <p className="lead">Bank soal dan daftar pemain akan dihapus dari sesi ini. Tindakan ini tidak bisa dibatalkan.</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancelClear}>
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
            Batal
          </button>
          <button className="btn btn-danger-solid" onClick={onConfirmClear}>
            <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
            Ya, hapus
          </button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Main game                                                           */
/* ------------------------------------------------------------------ */

function SnakesLaddersGame() {
  const [gameState, setGameState] = useState('setup');
  const [questions, setQuestions] = useState([]);
  const [csvErrors, setCsvErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [players, setPlayers] = useState(DEFAULT_PLAYERS);
  const [shuffle, setShuffle] = useState(true);

  const [positions, setPositions] = useState(() => playerMap(DEFAULT_PLAYERS, 1));
  const [currentId, setCurrentId] = useState(DEFAULT_PLAYERS[0].id);
  const [helps, setHelps] = useState(() => playerMap(DEFAULT_PLAYERS, DEFAULT_HELPS));
  const [questionThrown, setQuestionThrown] = useState(false);
  const [shields, setShields] = useState({});
  const [penawarId, setPenawarId] = useState(null);
  const [doubleId, setDoubleId] = useState(null);
  const [showClue, setShowClue] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [questionLeft, setQuestionLeft] = useState(0);
  const [gameSeconds, setGameSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [movingId, setMovingId] = useState(null);
  const [targetCell, setTargetCell] = useState(null);
  const [snakeLadder, setSnakeLadder] = useState(null);
  const [winner, setWinner] = useState(null);
  const [winnerReason, setWinnerReason] = useState('');
  const [showWinner, setShowWinner] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [flash, setFlash] = useState(null);
  const [selectedHelp, setSelectedHelp] = useState(null);
  const [helpsTab, setHelpsTab] = useState('help');
  const [arms, setArms] = useState(() => playerMap(DEFAULT_PLAYERS, () => []));
  const [locked, setLocked] = useState({});
  const [armedTurn, setArmedTurn] = useState(null);
  const [armTarget, setArmTarget] = useState(null);
  const [armPick, setArmPick] = useState(null);
  const [soundOn, setSoundOn] = useState(true);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [sceneFailReason, setSceneFailReason] = useState('');
  const [startCount, setStartCount] = useState(0);

  const deckRef = useRef([]);
  const deckIndexRef = useRef(0);
  const lastQuestionRef = useRef(null);
  const timersRef = useRef(new Set());
  const gameIntervalRef = useRef(null);
  const questionIntervalRef = useRef(null);
  const toastIdRef = useRef(0);
  const stateRef = useRef({});
  const answerRef = useRef(null);
  /* id pemilik soal yang sedang terbuka: ditetapkan saat soal muncul dan
     tidak berubah sampai soal berikutnya (bukan hasil recompute live). */
  const questionOwnerRef = useRef(null);
  const finishedRef = useRef(false);
  const board3dRef = useRef(null);
  const posRef = useRef(playerMap(DEFAULT_PLAYERS, 1));
  const playersRef = useRef(players);
  playersRef.current = players;
  const armsRef = useRef(arms);
  armsRef.current = arms;
  const pendingArmsRef = useRef(null);
  const firingRef = useRef(false);
  const flowRef = useRef(0);
  const sessionWeaponsRef = useRef({});
  const audioRef = useRef(null);
  const soundOnRef = useRef(true);
  const webglCheck = useMemo(detectWebGL, []);
  const webglReason = sceneFailed ? (sceneFailReason || 'Papan 3D gagal dibuat') : webglCheck.reason;
  const use3d = webglCheck.ok && !sceneFailed;

  const activeId = questionThrown ? nextPlayerId(players, currentId) : currentId;
  questionOwnerRef.current = activeId;
  const playerName = (id) => {
    const player = players.find((item) => item.id === id);
    return player ? playerNameOf(player) : 'Pemain';
  };
  const currentPlayer = players.find((player) => player.id === currentId) || players[0];
  const activePlayer = players.find((player) => player.id === activeId) || players[0];

  stateRef.current = {
    players,
    positions,
    currentId,
    activeId,
    questions,
    gameState,
    activeQuestion,
    revealed,
    questionThrown,
    helps,
    shields,
    penawarId,
    doubleId,
    arms,
    locked,
    armedTurn,
    busy,
  };

  /* ---------------- timers ---------------- */

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current.clear();
    if (gameIntervalRef.current) {
      clearInterval(gameIntervalRef.current);
      gameIntervalRef.current = null;
    }
    if (questionIntervalRef.current) {
      clearInterval(questionIntervalRef.current);
      questionIntervalRef.current = null;
    }
  }, []);

  const later = useCallback((fn, delay) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (finishedRef.current) return;
      fn();
    }, delay);
    timersRef.current.add(id);
    return id;
  }, []);

  const sleep = useCallback(
    (delay) =>
      new Promise((resolve) => {
        const id = setTimeout(() => {
          timersRef.current.delete(id);
          resolve();
        }, delay);
        timersRef.current.add(id);
      }),
    []
  );

  useEffect(() => clearAllTimers, [clearAllTimers]);

  /* ---------------- toast & flash ---------------- */

  const showToast = useCallback(
    (message, tone = 'info', icon) => {
      const id = ++toastIdRef.current;
      const icons = {
        good: 'fa-solid fa-circle-check',
        bad: 'fa-solid fa-circle-xmark',
        info: 'fa-solid fa-circle-info',
        warn: 'fa-solid fa-triangle-exclamation',
      };
      setToasts((prev) => [...prev.slice(-2), { id, message, tone, icon: icon || icons[tone] || icons.info }]);
      later(() => {
        setToasts((prev) => prev.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
      }, 2200);
      later(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, 2500);
    },
    [later]
  );

  const showFlash = useCallback(
    (tone, text) => {
      const id = Date.now() + Math.random();
      setFlash({ id, tone, text });
      later(() => setFlash((current) => (current && current.id === id ? null : current)), 1500);
    },
    [later]
  );

  /* ---------------- audio ---------------- */

  soundOnRef.current = soundOn;

  const ensureAudio = useCallback(() => {
    if (!soundOnRef.current) return null;
    try {
      if (!audioRef.current) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        audioRef.current = new Ctor();
      }
      if (audioRef.current.state === 'suspended' && audioRef.current.resume) {
        audioRef.current.resume().catch(() => {});
      }
      return audioRef.current;
    } catch (error) {
      return null;
    }
  }, []);

  const sfx = useCallback(
    (kind) => {
      const ctx = ensureAudio();
      if (!ctx) return;
      try {
        playSfx(ctx, kind);
      } catch (error) {
        /* Audio tidak boleh menghentikan permainan. */
      }
    },
    [ensureAudio]
  );

  useEffect(
    () => () => {
      if (audioRef.current && audioRef.current.close) {
        try {
          audioRef.current.close();
        } catch (error) {
          /* abaikan */
        }
      }
      audioRef.current = null;
    },
    []
  );

  /* ---------------- persistence ---------------- */

  useEffect(() => {
    try {
      const savedQuestions = sessionStorage.getItem('eduladder_questions');
      const savedPlayers = sessionStorage.getItem('eduladder_players');
      const savedTeams = sessionStorage.getItem('eduladder_teams');
      const savedShuffle = sessionStorage.getItem('eduladder_shuffle');
      if (savedQuestions) {
        const parsed = JSON.parse(savedQuestions);
        if (Array.isArray(parsed)) setQuestions(parsed);
      }

      let restored = null;
      if (savedPlayers) restored = normalizePlayers(JSON.parse(savedPlayers));
      if (!restored && savedTeams) {
        const legacy = JSON.parse(savedTeams);
        if (legacy && typeof legacy.A === 'string' && typeof legacy.B === 'string') {
          restored = [makePlayer(1, legacy.A), makePlayer(2, legacy.B)];
        }
      }
      if (restored) setPlayers(restored);

      if (savedShuffle !== null) setShuffle(savedShuffle === 'true');
      const savedSound = sessionStorage.getItem('eduladder_sound');
      if (savedSound !== null) setSoundOn(savedSound !== 'false');
    } catch (error) {
      console.warn('Gagal memuat data sesi:', error);
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem('eduladder_questions', JSON.stringify(questions));
      sessionStorage.setItem('eduladder_players', JSON.stringify(players));
      sessionStorage.setItem('eduladder_shuffle', String(shuffle));
      sessionStorage.setItem('eduladder_sound', String(soundOn));
    } catch (error) {
      console.warn('Gagal menyimpan data sesi:', error);
    }
  }, [questions, players, shuffle, soundOn]);

  useEffect(() => {
    document.body.classList.toggle('is-playing', gameState === 'playing' || gameState === 'starting');
    return () => document.body.classList.remove('is-playing');
  }, [gameState]);

  /* ---------------- papan 3D: pause & fokus ---------------- */

  /* Efek yang bergantung pada Board3D hidup harus dipanggil ulang setelah
     board selesai dibuat. Papan dibuat di effect anak (Scene3D), yang berjalan
     sebelum effect induk pada render pertama, sehingga ref masih null. */
  const syncEffects = useCallback(() => {
    const board = board3dRef.current;
    if (!board || !board.setEffects) return;
    const status = {};
    const push = (id, kind) => {
      if (!id) return;
      status[id] = [...(status[id] || []), kind];
    };
    push(penawarId, 'penawar');
    Object.keys(shields || {}).forEach((id) => {
      if (shields[id]) push(id, 'shield');
    });
    Object.keys(locked || {}).forEach((id) => {
      if (locked[id]) push(id, 'locked');
    });
    board.setEffects(status);
  }, [shields, penawarId, locked]);

  const handleBoardReady = useCallback(
    (board) => {
      if (!board) return;
      board.setPositions(stateRef.current.positions || posRef.current);
      if (gameState === 'playing' || gameState === 'starting') board.focusTurn(activeId);
      if (questionOpen || snakeLadder) board.pause();
      syncEffects();
    },
    [activeId, gameState, questionOpen, snakeLadder, syncEffects]
  );

  useEffect(() => {
    const board = board3dRef.current;
    if (!board) return;
    /* Saat serangan sedang dianimasikan, overlay soal kita tutup sementara.
       Jangan pause papan, atau animasi strike tidak akan pernah selesai. */
    if (firingRef.current) {
      board.resume();
      return;
    }
    if (questionOpen || snakeLadder) board.pause();
    else board.resume();
  }, [questionOpen, snakeLadder, gameState]);

  useEffect(() => {
    const board = board3dRef.current;
    if (!board) return;
    if (gameState === 'playing' || gameState === 'starting') board.focusTurn(activeId);
  }, [activeId, gameState, snakeLadder]);

  useEffect(() => {
    const board = board3dRef.current;
    if (!board || !board.highlightCell) return;
    board.highlightCell(targetCell);
  }, [targetCell, gameState]);

  /* Lencana pertahanan melayang di atas karakter pemain aktif. */
  useEffect(() => {
    if (!board3dRef.current) return;
    syncEffects();
  }, [shields, penawarId, locked, gameState, syncEffects]);

  /* ---------------- clocks ---------------- */

  useEffect(() => {
    if (gameState !== 'playing') return undefined;
    gameIntervalRef.current = setInterval(() => setGameSeconds((value) => value + 1), 1000);
    return () => {
      if (gameIntervalRef.current) {
        clearInterval(gameIntervalRef.current);
        gameIntervalRef.current = null;
      }
    };
  }, [gameState]);

  useEffect(() => {
    if (questionIntervalRef.current) {
      clearInterval(questionIntervalRef.current);
      questionIntervalRef.current = null;
    }

    if (gameState !== 'playing' || !activeQuestion || revealed || busy || questionLeft <= 0) {
      return undefined;
    }
    /* Modal pilih lawan / pilih slot menahan waktu soal agar pemain tidak
       dihukum karena membaca daftar target. */
    if (armTarget || armPick) {
      return undefined;
    }

    questionIntervalRef.current = setInterval(() => {
      setQuestionLeft((value) => {
        if (value <= 1) {
          if (questionIntervalRef.current) {
            clearInterval(questionIntervalRef.current);
            questionIntervalRef.current = null;
          }
          if (answerRef.current) answerRef.current(null, true);
          return 0;
        }
        return value - 1;
      });
    }, 1000);

    return () => {
      if (questionIntervalRef.current) {
        clearInterval(questionIntervalRef.current);
        questionIntervalRef.current = null;
      }
    };
  }, [gameState, activeQuestion, revealed, busy, questionLeft, armTarget, armPick]);

  /* ---------------- CSV ---------------- */

  const readFile = (file) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      showToast('Format file harus CSV.', 'bad');
      return;
    }
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const result = parseCsv(String(event.target.result || ''));
        if (!result.questions.length) {
          setCsvErrors(result.errors.length ? result.errors : ['Tidak ada soal valid yang terbaca.']);
          showToast('File CSV tidak berisi soal valid.', 'bad');
          return;
        }
        setQuestions(result.questions);
        setCsvErrors(result.errors);
        showToast(
          `${result.questions.length} soal dimuat${result.errors.length ? `, ${result.errors.length} baris dilewati` : ''}.`,
          result.errors.length ? 'warn' : 'good'
        );
      } catch (error) {
        console.error(error);
        showToast('Gagal membaca file CSV.', 'bad');
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => {
      showToast('File tidak dapat dibaca.', 'bad');
      setLoading(false);
    };
    reader.readAsText(file);
  };

  const clearData = () => {
    try {
      sessionStorage.removeItem('eduladder_questions');
      sessionStorage.removeItem('eduladder_players');
      sessionStorage.removeItem('eduladder_teams');
      sessionStorage.removeItem('eduladder_shuffle');
    } catch (error) {
      console.warn(error);
    }
    setQuestions([]);
    setCsvErrors([]);
    setPlayers(DEFAULT_PLAYERS.map((player) => ({ ...player })));
    setConfirmClear(false);
    showToast('Semua data lokal telah dihapus.', 'good');
  };

  /* ---------------- deck ---------------- */

  const buildDeck = (source) => {
    const list = source.map((question) => ({ ...question, used: false }));
    if (shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    return list;
  };

  const takeQuestion = () => {
    if (deckIndexRef.current >= deckRef.current.length) return null;
    const item = deckRef.current[deckIndexRef.current];
    deckIndexRef.current += 1;
    lastQuestionRef.current = { ...item, used: true };
    return { ...item, used: true };
  };

  const rescueQuestion = () => {
    const next = takeQuestion();
    if (next) return next;
    const fallback = lastQuestionRef.current;
    if (!fallback) return null;
    return { ...fallback, options: [...fallback.options], used: true };
  };

  const bankLeft = () => Math.max(0, deckRef.current.length - deckIndexRef.current);

  /* ---------------- ending ---------------- */

  const finish = () => {
    if (finishedRef.current) return false;
    finishedRef.current = true;
    clearAllTimers();
    setBusy(true);
    setActiveQuestion(null);
    setQuestionOpen(false);
    setMovingId(null);
    setGameState('finished');
    return true;
  };

  const buildRanking = () => {
    const { players: list, positions: pos, helps: bag } = stateRef.current;
    return (list || [])
      .map((player) => ({
        id: player.id,
        slot: player.slot,
        name: playerNameOf(player),
        pos: pos[player.id] || 1,
        helps: sumHelps(normalizeBag(bag[player.id])),
      }))
      .sort((a, b) => b.pos - a.pos || b.helps - a.helps || a.slot - b.slot);
  };

  const finishByPosition = (id) => {
    if (!finish()) return;
    const player = (stateRef.current.players || []).find((item) => item.id === id);
    setWinner(id);
    setWinnerReason(`${player ? playerNameOf(player) : 'Pemain'} berhasil mencapai kotak ${WIN_POSITION} lebih dulu.`);
    if (board3dRef.current && board3dRef.current.celebrate) board3dRef.current.celebrate(id);
    setShowWinner(true);
  };

  const finishByQuestions = () => {
    const ranking = buildRanking();
    if (!finish()) return;

    const top = ranking[0];
    const runnerUp = ranking[1];
    if (!top) {
      setWinner('Seri');
      setWinnerReason('Seluruh soal habis tanpa peringkat yang bisa dihitung.');
      setShowWinner(true);
      return;
    }

    const tiedEntries = ranking.filter((entry) => entry.pos === top.pos && entry.helps === top.helps);
    const tied = tiedEntries.length > 1;
    const result = tied ? 'Seri' : top.id;
    let reason = `Seluruh soal habis. ${top.name} unggul di kotak ${top.pos}.`;

    if (tied) {
      reason = `Seluruh soal habis. ${tiedEntries
        .map((entry) => entry.name)
        .join(', ')} sama pada kotak ${top.pos} dan sisa bantuan ${top.helps}.`;
    } else if (runnerUp && top.pos === runnerUp.pos) {
      reason = `Posisi sama di kotak ${top.pos}. ${top.name} unggul sisa bantuan (${top.helps} banding ${runnerUp.helps}).`;
    }

    setWinner(result);
    setWinnerReason(reason);
    setShowWinner(true);
  };

  /* ---------------- hitung mundur pembuka ---------------- */

  useEffect(() => {
    if (gameState !== 'starting') return undefined;
    let count = 5;
    setStartCount(count);
    const id = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setStartCount(count);
        return;
      }
      clearInterval(id);
      setStartCount(0);
      if (finishedRef.current) return;
      setGameState('playing');
      const first = takeQuestion();
      if (!first) {
        finishByQuestions();
        return;
      }
      setActiveQuestion(first);
      setQuestionLeft(first.duration);
      setQuestionOpen(true);
    }, 1000);
    return () => clearInterval(id);
    // Efek hanya dipicu saat masuk mode "starting"; helper memakai ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  /* ---------------- turn flow ---------------- */

  const nextTurn = () => {
    if (finishedRef.current) return;
    /* Efek kunci habis bersama giliran pemain yang terkena. Giliran yang
       selesai adalah currentId sebelum digeser. */
    const finishingId = stateRef.current.currentId;
    const nextId = nextPlayerId(playersRef.current, stateRef.current.currentId);
    flowRef.current += 1;
    setCurrentId(nextId);
    setQuestionThrown(false);
    /* Shield bertahan sampai awal giliran pemiliknya berikutnya, sehingga
       masih bisa menyerap serangan senjata pada giliran lawan di antaranya. */
    setShields((prev) => {
      if (!prev[nextId]) return prev;
      const next = { ...prev };
      delete next[nextId];
      return next;
    });
    setPenawarId(null);
    setDoubleId(null);
    setArmedTurn(null);
    setArmTarget(null);
    if (finishingId) {
      setLocked((prev) => {
        if (!prev[finishingId]) return prev;
        const next = { ...prev };
        delete next[finishingId];
        return next;
      });
    }
    setShowClue(false);
    setSelectedHelp(null);
    setHelpsTab('help');
    setPicked(null);
    setRevealed(false);
    setBusy(false);
    setActiveQuestion(null);
    setQuestionOpen(false);
    setMovingId(null);
    setTargetCell(null);
    if (board3dRef.current && board3dRef.current.highlightCell) board3dRef.current.highlightCell(null);

    later(() => {
      if (finishedRef.current) return;
      const next = takeQuestion();
      if (!next) {
        finishByQuestions();
        return;
      }
      setActiveQuestion(next);
      setQuestionLeft(next.duration);
      setQuestionOpen(true);
    }, 450);
  };

  const startGame = () => {
    if (BOARD_ERRORS.length) {
      showToast(`Peta papan tidak valid: ${BOARD_ERRORS[0]}`, 'bad');
      return;
    }
    if (players.length < 2 || !players.every((player) => player.name.trim().length > 0)) {
      showToast('Isi nama minimal 2 pemain untuk memulai.', 'warn');
      return;
    }
    const minimum = Math.max(MIN_QUESTIONS, players.length);
    if (questions.length < minimum) {
      showToast(`Minimal ${minimum} soal untuk ${players.length} pemain.`, 'warn');
      return;
    }
    clearAllTimers();
    finishedRef.current = false;
    flowRef.current += 1;
    deckRef.current = buildDeck(questions);
    deckIndexRef.current = 0;
    /* Jenis senjata dikunci sekali per sesi agar kotak yang sama selalu
       memberi senjata yang sama sampai permainan berakhir. */
    sessionWeaponsRef.current = rollSessionWeapons();

    const startPositions = playerMap(players, 1);
    const firstId = players[0].id;
    posRef.current = startPositions;
    setPositions(startPositions);
    if (board3dRef.current) {
      board3dRef.current.setPositions(startPositions);
      board3dRef.current.highlightCell(null);
      board3dRef.current.focusTurn(firstId);
    }
    setCurrentId(firstId);
    setHelps(playerMap(players, DEFAULT_HELPS));
    setArms(playerMap(players, () => []));
    armsRef.current = playerMap(players, () => []);
    setLocked({});
    setArmedTurn(null);
    setArmTarget(null);
    setArmPick(null);
    pendingArmsRef.current = null;
    setQuestionThrown(false);
    setShields({});
    setPenawarId(null);
    setDoubleId(null);
    setShowClue(false);
    setActiveQuestion(null);
    setQuestionOpen(false);
    setPicked(null);
    setRevealed(false);
    setQuestionLeft(0);
    setGameSeconds(0);
    setBusy(false);
    setMovingId(null);
    setTargetCell(null);
    setSnakeLadder(null);
    setWinner(null);
    setWinnerReason('');
    setShowWinner(false);
    setSelectedHelp(null);
    setHelpsTab('help');
    setStartCount(5);
    setGameState('starting');
  };

  /* ---------------- movement ---------------- */

  const applyPosition = (playerId, cell) => {
    posRef.current = { ...posRef.current, [playerId]: cell };
    setPositions(posRef.current);
  };

  const animateMove = async (token, playerId, steps, options = {}) => {
    const total = Math.abs(steps);
    const direction = steps >= 0 ? 1 : -1;
    setBusy(true);
    setMovingId(playerId);

    let cursor = posRef.current[playerId];
    const path = [];
    for (let i = 0; i < total; i++) {
      let next = cursor + direction;
      if (next < 1) next = 1;
      if (next > WIN_POSITION) next = WIN_POSITION;
      path.push(next);
      cursor = next;
      if (next === 1 || next === WIN_POSITION) break;
    }

    const board = board3dRef.current;
    if (board) {
      if (board.resume) board.resume();
      await board.hop(playerId, path, { shield: Boolean(options.shield) });
    } else {
      for (let i = 0; i < path.length; i++) {
        if (flowRef.current !== token) return cursor;
        applyPosition(playerId, path[i]);
        setTargetCell(path[i]);
        await sleep(STEP_DELAY);
      }
    }

    if (flowRef.current !== token) return cursor;
    applyPosition(playerId, cursor);
    setTargetCell(path.length ? path[path.length - 1] : posRef.current[playerId]);
    return cursor;
  };

  const slideTo = async (playerId, cell, type) => {
    setMovingId(playerId);
    const board = board3dRef.current;
    const from = posRef.current[playerId];
    if (board) {
      if (board.resume) board.resume();
      await board.slide(playerId, from, cell, type);
    } else {
      await sleep(750);
    }
    applyPosition(playerId, cell);
    setMovingId(null);
    setTargetCell(cell);
  };

  const openRescue = (type, playerId, cell, to) => {
    setQuestionOpen(false);
    setSnakeLadder({ type, playerId, from: cell, to, question: rescueQuestion() });
    setTargetCell(to);
    setBusy(false);
  };

  /* Baki senjata. `pendingArmsRef` (dideklarasikan bersama ref lain) menahan
     permintaan penggantian slot agar modal dapat dibatalkan tanpa kehilangan
     senjata yang baru didapat. */
  const giveWeapon = useCallback(
    (playerId, weaponKey) => {
      const slot = { uid: `a${Date.now()}${Math.floor(Math.random() * 1000)}`, key: weaponKey };
      const current = armsRef.current[playerId] || [];
      const roster = playersRef.current || [];
      const owner = roster.find((item) => item.id === playerId);
      const label = owner ? playerNameOf(owner) : 'Pemain';
      if (current.length < ARMS_CAPACITY) {
        armsRef.current = { ...armsRef.current, [playerId]: [...current, slot] };
        setArms(armsRef.current);
        const weapon = weaponOf(weaponKey);
        showToast(`${label} mendapat senjata ${weapon.label}.`, 'info', weapon.icon);
        return;
      }
      pendingArmsRef.current = { playerId, slot };
      setArmPick({ playerId, slot, slots: current.slice() });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const resolveArmPick = (slotIndex) => {
    const pending = pendingArmsRef.current;
    setArmPick(null);
    pendingArmsRef.current = null;
    if (!pending) return;
    if (slotIndex === null || slotIndex === undefined) {
      showToast('Senjata baru dilepas karena baki penuh.', 'warn');
      return;
    }
    const current = armsRef.current[pending.playerId] || [];
    const next = current.slice();
    next[slotIndex] = pending.slot;
    armsRef.current = { ...armsRef.current, [pending.playerId]: next };
    setArms(armsRef.current);
    const weapon = weaponOf(pending.slot.key);
    showToast(`Baki ${playerName(pending.playerId)} diganti dengan ${weapon.label}.`, 'info', weapon.icon);
  };

  const grantWeapon = (playerId, cell) => {
    const key = sessionWeaponsRef.current[cell];
    if (!key) return;
    giveWeapon(playerId, key);
  };

  const land = async (token, playerId, cell, direction, shield) => {
    setMovingId(null);

    if (cell >= WIN_POSITION) {
      setTargetCell(WIN_POSITION);
      finishByPosition(playerId);
      return;
    }

    /* Kotak senjata hanya memberi hadiah saat maju, agar jawaban salah yang
       membuat pemain mundur tidak berubah menjadi keuntungan. */
    const tookWeapon = direction > 0 && WEAPON_CELLS.includes(cell);
    if (tookWeapon) {
      grantWeapon(playerId, cell);
      setTargetCell(cell);
    }

    if (direction > 0 && LADDERS[cell]) {
      openRescue('ladder', playerId, cell, LADDERS[cell]);
      return;
    }

    if (SNAKES[cell]) {
      if (shield) {
        showToast('Shield aktif: gigitan ular dibatalkan!', 'good', 'fa-solid fa-shield-halved');
        showFlash('good', 'SHIELD!');
        setShields((prev) => {
          if (!prev[playerId]) return prev;
          const next = { ...prev };
          delete next[playerId];
          return next;
        });
        await sleep(HOP_DELAY);
        if (flowRef.current !== token) return;
        nextTurn();
        return;
      }
      openRescue('snake', playerId, cell, SNAKES[cell]);
      return;
    }

    await sleep(tookWeapon ? HOP_DELAY + 300 : HOP_DELAY);
    if (flowRef.current !== token) return;
    nextTurn();
  };

  const rescueState = (playerId, cell) => {
    if (cell >= WIN_POSITION) {
      setTargetCell(WIN_POSITION);
      finishByPosition(playerId);
      return true;
    }
    if (LADDERS[cell]) {
      openRescue('ladder', playerId, cell, LADDERS[cell]);
      return true;
    }
    if (SNAKES[cell]) {
      openRescue('snake', playerId, cell, SNAKES[cell]);
      return true;
    }
    return false;
  };

  const resolveSnakeLadder = async (isCorrect) => {
    const info = snakeLadder;
    if (!info) return;
    const token = flowRef.current;
    setSnakeLadder(null);
    setBusy(true);

    if (info.type === 'ladder') {
      if (isCorrect) {
        showFlash('good', 'NAIK TANGGA!');
        showToast(`${playerName(info.playerId)} naik tangga ke kotak ${info.to}!`, 'good', 'fa-solid fa-stairs');
        await slideTo(info.playerId, info.to, 'ladder');
        if (flowRef.current !== token) return;
        if (rescueState(info.playerId, info.to)) return;
        nextTurn();
      } else {
        showFlash('bad', 'TETAP DI TANGGA');
        showToast(`Jawaban salah. ${playerName(info.playerId)} tetap di kotak ${info.from}.`, 'warn');
        await sleep(HOP_DELAY);
        if (flowRef.current !== token) return;
        nextTurn();
      }
      return;
    }

    if (isCorrect) {
      showFlash('good', 'SELAMAT!');
      showToast(`Jawaban benar! ${playerName(info.playerId)} lolos dari ular.`, 'good', 'fa-solid fa-shield-halved');
      await sleep(HOP_DELAY);
      if (flowRef.current !== token) return;
      nextTurn();
    } else {
      showFlash('bad', 'DIMAKAN ULAR');
      showToast(`${playerName(info.playerId)} turun ke kotak ${info.to}.`, 'bad', 'fa-solid fa-staff-snake');
      await slideTo(info.playerId, info.to, 'snake');
      if (flowRef.current !== token) return;
      if (rescueState(info.playerId, info.to)) return;
      nextTurn();
    }
  };

  /* ---------------- senjata: memilih target & melepas ---------------- */

  const canFireNow = () =>
    gameState === 'playing' &&
    !busy &&
    !revealed &&
    !snakeLadder &&
    !winner &&
    !finishedRef.current &&
    armedTurn === null &&
    questionOwnerRef.current === currentId;

  const openArmPicker = (slot) => {
    if (!canFireNow()) {
      showToast('Serangan hanya bisa dilepas sekali di awal giliranmu.', 'warn');
      return;
    }
    const actorId = currentId;
    const targets = pointableTargets(slot.key, actorId, players, posRef.current);
    if (!targets.length) {
      showToast('Belum ada lawan di permainan.', 'warn');
      return;
    }
    const validCount = targets.filter((item) => item.valid).length;
    if (!validCount) {
      showToast(
        slot.key === 'portal'
          ? 'Portal butuh lawan di depanmu. Lawan masih di belakang.'
          : 'Tidak ada target yang sah.',
        'warn'
      );
      return;
    }
    ensureAudio();
    setArmTarget({ slot, actorId, targets });
  };

  const closeArmPicker = () => setArmTarget(null);

  /* Ringkasan hasil untuk dibaca pemain sebelum konfirmasi. */
  const describeArmEffect = (slot, entry) => {
    const from = entry.cell;
    if (slot.key === 'bomb') return `Kotak ${from} → mundur ${BOMB_STEPS.join('/')} langkah`;
    if (slot.key === 'magnet') return `Kotak ${from} → mundur ${MAGNET_STEPS} langkah`;
    if (slot.key === 'portal') return `Kotak ${from} ⇄ kotak ${posRef.current[currentId] || 1}`;
    return 'Kehilangan 1 bantuan acak';
  };

  const fireWeapon = async (targetId) => {
    const request = armTarget;
    if (!request) return;
    const entry = request.targets.find((item) => item.player.id === targetId);
    if (!entry || !entry.valid) {
      showToast('Target ini tidak bisa dipilih.', 'warn');
      return;
    }
    if (!canFireNow()) {
      setArmTarget(null);
      return;
    }

    const actorId = request.actorId;
    const slot = request.slot;
    const weapon = weaponOf(slot.key);
    const targetIdSafe = targetId;

    ensureAudio();
    setArmTarget(null);
    flowRef.current += 1;
    const token = flowRef.current;
    firingRef.current = true;
    try {
      setArmedTurn({ playerId: actorId, key: slot.key });

      /* Buang kartu dari baki segera agar tidak bisa dipakai dua kali. */
      armsRef.current = {
        ...armsRef.current,
        [actorId]: (armsRef.current[actorId] || []).filter((item) => item.uid !== slot.uid),
      };
      setArms(armsRef.current);

      const board = board3dRef.current;
      const remaining = questionLeft;
      const hadQuestion = Boolean(activeQuestion) && questionOpen;
      if (hadQuestion) {
        setQuestionOpen(false);
        if (questionIntervalRef.current) {
          clearInterval(questionIntervalRef.current);
          questionIntervalRef.current = null;
        }
      }

      setBusy(true);
      setMovingId(targetIdSafe);
      if (board && board.resume) board.resume();

      const shielded = Boolean(shields[targetIdSafe]);
      try {
        if (board && typeof board.strike === 'function') {
          await board.strike(actorId, targetIdSafe, shielded ? 'block' : slot.key);
        } else {
          await sleep(400);
        }
      } catch (error) {
        /* Visual tidak boleh menghentikan aturan. */
      }

      if (flowRef.current !== token) return;

      if (shielded) {
        setShields((prev) => {
          if (!prev[targetIdSafe]) return prev;
          const next = { ...prev };
          delete next[targetIdSafe];
          return next;
        });
        sfx('block');
        showFlash('good', 'DITAHAN SHIELD');
        showToast(
          `Shield ${playerName(targetIdSafe)} menyerap ${weapon.label}. Serangan batal.`,
          'good',
          'fa-solid fa-shield-halved'
        );
      } else {
        sfx(slot.key);
        if (slot.key === 'bomb' || slot.key === 'magnet') {
          const steps = slot.key === 'bomb' ? bombSteps() : MAGNET_STEPS;
          const from = posRef.current[targetIdSafe];
          const target = Math.max(1, from - steps);
          const back = from - target;
          if (board && typeof board.slide === 'function') {
            await board.slide(targetIdSafe, from, target, 'snake');
            if (flowRef.current !== token) return;
          } else {
            await sleep(500);
            if (flowRef.current !== token) return;
          }
          const next = { ...posRef.current, [targetIdSafe]: target };
          posRef.current = next;
          setPositions(next);
          setLocked((prev) => ({ ...prev, [targetIdSafe]: true }));
          showFlash('bad', `${weapon.label.toUpperCase()}!`);
          showToast(
            `${playerName(actorId)} melepas ${weapon.label}: ${playerName(targetIdSafe)} mundur ${back} kotak ke ${target}.`,
            'warn',
            weapon.icon
          );
          setTargetCell(target);
        } else if (slot.key === 'portal') {
          const actorCell = posRef.current[actorId];
          const targetCell = posRef.current[targetIdSafe];
          const swapped = { ...posRef.current, [actorId]: targetCell, [targetIdSafe]: actorCell };
          posRef.current = swapped;
          setPositions(swapped);
          if (board) board.setPositions(swapped);
          showFlash('good', 'PORTAL!');
          showToast(
            `${playerName(actorId)} bertukar posisi dengan ${playerName(targetIdSafe)}: ${actorCell} ⇄ ${targetCell}.`,
            'info',
            weapon.icon
          );
          setTargetCell(targetCell);
        } else {
          const sweep = sweepRandomHelpId(targetIdSafe, helps);
          setLocked((prev) => ({ ...prev, [targetIdSafe]: true }));
          setTargetCell(posRef.current[targetIdSafe]);
          if (sweep.takenKey) {
            const item = HELPS.find((help) => help.key === sweep.takenKey);
            setHelps((prev) => ({ ...prev, [targetIdSafe]: sweep.bag }));
            showFlash('warn', 'TERPERANGKAP');
            showToast(
              `${playerName(actorId)} memasang perangkap: ${playerName(targetIdSafe)} kehilangan ${item ? item.label : 'satu bantuan'}.`,
              'warn',
              weapon.icon
            );
          } else {
            showFlash('warn', 'TERPERANGKAP');
            showToast(
              `${playerName(actorId)} memasang perangkap: ${playerName(targetIdSafe)} terkunci (bantuan sudah habis).`,
              'warn',
              weapon.icon
            );
          }
        }
      }

      await sleep(650);
      if (flowRef.current !== token) return;

      setMovingId(null);
      setTargetCell(null);
      if (board && board.highlightCell) board.highlightCell(null);
      setBusy(false);

      if (hadQuestion && activeQuestion) {
        setQuestionLeft(Math.max(1, remaining));
        setQuestionOpen(true);
      }
    } finally {
      firingRef.current = false;
    }
  };

  /* ---------------- answer ---------------- */

  const resolveAnswer = (letter, timedOut = false) => {
    if (answerRef.current) answerRef.current(letter, timedOut);
  };

  answerRef.current = (letter, timedOut) => {
    const {
      activeQuestion: question,
      revealed: alreadyRevealed,
      busy: isBusy,
      shields: shieldMap,
      penawarId: penawared,
      doubleId: doubled,
      players: roster,
      currentId: turnId,
      questionThrown: thrown,
      locked: lockedMap,
    } = stateRef.current;
    if (!question || alreadyRevealed || isBusy || finishedRef.current) return;

    const playerId = thrown ? nextPlayerId(roster, turnId) : turnId;
    const isCorrect = letter !== null && letter === question.correctAnswer;
    const hasShield = Boolean(shieldMap && shieldMap[playerId]);
    const hasPenawar = penawared === playerId;
    const hasDouble = doubled === playerId;
    const isLocked = Boolean(lockedMap && lockedMap[playerId]);

    if (questionIntervalRef.current) {
      clearInterval(questionIntervalRef.current);
      questionIntervalRef.current = null;
    }

    setRevealed(true);
    setPicked(letter);
    setBusy(true);
    setQuestionLeft(0);

    // Tutup overlay setelah feedback singkat, papan terlihat lagi.
    later(() => setQuestionOpen(false), FEEDBACK_DELAY);

    const runMove = async (steps) => {
      const token = flowRef.current;
      await animateMove(token, playerId, steps);
      if (flowRef.current !== token) return;
      await land(token, playerId, posRef.current[playerId], steps >= 0 ? 1 : -1, false);
    };

    if (isCorrect) {
      /* Efek kunci hanya memblokir langkah maju dari jawaban benar; soal
         bonus tangga dan uji ular tidak tersentuh. */
      if (isLocked) {
        if (hasDouble) setDoubleId(null);
        showFlash('warn', 'TERKUNCI');
        showToast(
          `${playerName(playerId)} benar, tetapi terkunci: tidak maju pada giliran ini.`,
          'warn',
          'fa-solid fa-lock'
        );
        later(() => nextTurn(), RESOLVE_DELAY);
        return;
      }
      const steps = hasDouble ? question.reward * 2 : question.reward;
      showFlash('good', hasDouble ? 'BENAR! DOUBLE MOVE' : 'BENAR!');
      showToast(
        hasDouble
          ? `Benar! Double Move aktif: ${playerName(playerId)} maju ${steps} langkah.`
          : `Benar! ${playerName(playerId)} maju ${steps} langkah.`,
        'good'
      );
      if (hasDouble) setDoubleId(null);
      later(() => runMove(steps), RESOLVE_DELAY);
      return;
    }

    showFlash('bad', timedOut ? 'WAKTU HABIS' : 'SALAH');
    // questionThrown sengaja dibiarkan sampai nextTurn() agar panel bantuan
    // tetap milik pemain yang menjawab selama jendela umpan balik.

    // Penawar diperiksa lebih dulu: ia menyerap hukuman soal, sedangkan
    // Shield menahan gigitan ular yang muncul setelah gerakan. Urutan ini
    // mencegah Shield hangus tanpa menahan apa pun saat keduanya aktif.
    if (hasPenawar) {
      setPenawarId(null);
      showFlash('good', 'PENAWAR!');
      showToast(
        timedOut
          ? `Waktu habis, tetapi Penawar menahan ${playerName(playerId)} di tempat.`
          : `Salah, tetapi Penawar menahan ${playerName(playerId)} di tempat.`,
        'good',
        'fa-solid fa-prescription-bottle-medical'
      );
      later(() => nextTurn(), RESOLVE_DELAY + 300);
      return;
    }

    if (hasShield) {
      setShields((prev) => {
        if (!prev[playerId]) return prev;
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
      showToast(`Shield melindungi ${playerName(playerId)} dari hukuman.`, 'good', 'fa-solid fa-shield-halved');
      later(() => nextTurn(), RESOLVE_DELAY + 300);
      return;
    }

    const penalty = question.penalty;
    showToast(
      timedOut
        ? `Waktu habis! ${playerName(playerId)} mundur ${penalty} langkah.`
        : `Salah! ${playerName(playerId)} mundur ${penalty} langkah.`,
      'bad'
    );
    later(() => runMove(-penalty), RESOLVE_DELAY);
  };

  /* ---------------- helps ---------------- */

  const useHelp = (helpKey) => {
    if (!activeQuestion || revealed || busy || questionOwnerRef.current !== activeId) return;
    const playerId = activeId;
    const bag = normalizeBag(helps[playerId]);
    const remaining = bag[helpKey];

    if (remaining <= 0) {
      showToast('Kuota bantuan ini sudah habis.', 'warn');
      return;
    }

    const spend = () =>
      setHelps((prev) => {
        const current = normalizeBag(prev[playerId]);
        return { ...prev, [playerId]: { ...current, [helpKey]: current[helpKey] - 1 } };
      });

    if (helpKey === 'throwQuestion') {
      if (questionThrown) {
        showToast('Soal ini sudah dilempar ke pemain berikutnya.', 'warn');
        return;
      }
      const targetId = nextPlayerId(players, currentId);
      spend();
      setQuestionThrown(true);
      setSelectedHelp('throwQuestion');
      showToast(`Soal dilempar ke ${playerName(targetId)}!`, 'info', 'fa-solid fa-arrow-right-arrow-left');
      return;
    }

    if (helpKey === 'clue') {
      spend();
      setShowClue(true);
      setSelectedHelp('clue');
      showToast('Clue dibuka untuk soal ini.', 'info', 'fa-solid fa-lightbulb');
      return;
    }

    if (helpKey === 'shield') {
      spend();
      setShields((prev) => ({ ...prev, [playerId]: true }));
      setSelectedHelp('shield');
      showToast(`Shield aktif untuk ${playerName(playerId)}.`, 'info', 'fa-solid fa-shield-halved');
      return;
    }

    if (helpKey === 'changeQuestion') {
      const next = takeQuestion();
      if (!next) {
        showToast('Tidak ada soal pengganti tersisa.', 'warn');
        return;
      }
      spend();
      setActiveQuestion(next);
      setQuestionLeft(next.duration);
      setPicked(null);
      setRevealed(false);
      setSelectedHelp('changeQuestion');
      showToast('Soal diganti dengan soal baru.', 'info', 'fa-solid fa-rotate');
      return;
    }

    if (helpKey === 'doubleMove') {
      spend();
      setDoubleId(playerId);
      setSelectedHelp('doubleMove');
      showToast('Double Move siap: jawaban benar bernilai dua kali.', 'info', 'fa-solid fa-bolt');
      return;
    }

    if (helpKey === 'penawar') {
      spend();
      setPenawarId(playerId);
      setSelectedHelp('penawar');
      showToast('Penawar siap: jawaban salah tidak mengurangi langkah.', 'info', 'fa-solid fa-prescription-bottle-medical');
    }
  };

  /* ---------------- reset ---------------- */

  const resetGame = () => {
    clearAllTimers();
    finishedRef.current = false;
    flowRef.current += 1;
    deckRef.current = [];
    deckIndexRef.current = 0;
    setGameState('setup');
    const resetPositions = playerMap(players, 1);
    posRef.current = resetPositions;
    setPositions(resetPositions);
    if (board3dRef.current) {
      board3dRef.current.setPositions(resetPositions);
      board3dRef.current.highlightCell(null);
    }
    setHelps(playerMap(players, DEFAULT_HELPS));
    setArms(playerMap(players, () => []));
    armsRef.current = playerMap(players, () => []);
    setLocked({});
    setArmedTurn(null);
    setArmTarget(null);
    setArmPick(null);
    pendingArmsRef.current = null;
    setCurrentId(players[0].id);
    setGameSeconds(0);
    setWinner(null);
    setWinnerReason('');
    setShowWinner(false);
    setActiveQuestion(null);
    setQuestionOpen(false);
    setStartCount(0);
    setPicked(null);
    setRevealed(false);
    setQuestionLeft(0);
    setSnakeLadder(null);
    setBusy(false);
    setMovingId(null);
    setTargetCell(null);
    setQuestionThrown(false);
    setShields({});
    setPenawarId(null);
    setDoubleId(null);
    setSelectedHelp(null);
    setHelpsTab('help');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  };

  /* ---------------- keyboard & focus ---------------- */

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (confirmClear) {
          setConfirmClear(false);
          return;
        }
        if (armPick) {
          resolveArmPick(null);
          return;
        }
        if (armTarget) {
          setArmTarget(null);
          return;
        }
        if (snakeLadder) return;
        if (showWinner) setShowWinner(false);
        return;
      }

      if (armTarget || armPick) return;
      if (gameState !== 'playing' || busy || !activeQuestion || revealed) return;
      if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;

      const digit = ['1', '2', '3', '4'].indexOf(event.key);
      if (digit >= 0) {
        event.preventDefault();
        resolveAnswer(['A', 'B', 'C', 'D'][digit]);
        return;
      }
      const lower = event.key.toLowerCase();
      if (['a', 'b', 'c', 'd'].includes(lower)) {
        event.preventDefault();
        resolveAnswer(lower.toUpperCase());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState, busy, activeQuestion, revealed, confirmClear, snakeLadder, showWinner, resolveAnswer, armTarget, armPick]);

  useEffect(() => {
    if (!(questionOpen || snakeLadder || showWinner || confirmClear || armTarget || armPick)) return undefined;
    const previous = document.activeElement;
    const dialog = document.querySelector('.overlay-card, .modal');
    if (dialog) {
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      dialog.focus();
    }
    return () => {
      if (previous && previous.focus) previous.focus();
    };
  }, [questionOpen, snakeLadder, showWinner, confirmClear, armTarget, armPick]);

  /* ---------------- derived ---------------- */

  const rewardInfo = useMemo(() => {
    if (!activeQuestion) return { text: '0', double: false };
    const doubled = doubleId === activeId;
    return {
      text: doubled ? `${activeQuestion.reward} × 2` : String(activeQuestion.reward),
      double: doubled,
    };
  }, [activeQuestion, doubleId, activeId]);

  /* Pemilik soal terkunci (questionOwnerRef) agar pengecekan bantuan selalu
     sama dengan pemain yang kartunya sedang tampil. */
  const helpBlocked = (key) => {
    if (!activeQuestion || revealed || busy) return true;
    const ownerId = questionOwnerRef.current;
    const bag = normalizeBag(helps[ownerId]);
    if (bag[key] <= 0) return true;
    if (key === 'throwQuestion') return questionThrown;
    if (key === 'clue') return showClue;
    if (key === 'shield') return Boolean(shields[ownerId]);
    if (key === 'penawar') return penawarId === ownerId;
    if (key === 'doubleMove') return doubleId === ownerId;
    return false;
  };

  const helpActive = (key) => {
    const ownerId = questionOwnerRef.current;
    if (key === 'clue') return showClue;
    if (key === 'shield') return Boolean(shields[ownerId]);
    if (key === 'penawar') return penawarId === ownerId;
    if (key === 'doubleMove') return doubleId === ownerId;
    if (key === 'throwQuestion') return questionThrown;
    return false;
  };

  const helpDescription = selectedHelp
    ? HELPS.find((item) => item.key === selectedHelp).desc
    : helpsTab === 'defense'
      ? 'Pertahanan melindungi pemain. Shield menyerap satu serangan atau hukuman, Penawar menahan hukuman soal.'
      : 'Sentuh kartu bantuan untuk memakainya. Kuota tampil di pojok kartu.';

  const ranking = players
    .map((player) => ({
      id: player.id,
      slot: player.slot,
      name: playerNameOf(player),
      pos: positions[player.id] || 1,
      helps: sumHelps(normalizeBag(helps[player.id])),
    }))
    .sort((a, b) => b.pos - a.pos || b.helps - a.helps || a.slot - b.slot);

  const renamePlayer = (id, value) => {
    setPlayers((prev) => prev.map((player) => (player.id === id ? { ...player, name: value.slice(0, 18) } : player)));
  };

  const addPlayer = () => {
    setPlayers((prev) => {
      if (prev.length >= MAX_PLAYERS) return prev;
      const free = PLAYER_SLOTS.find((slot) => !prev.some((player) => player.slot === slot.slot));
      return free ? [...prev, makePlayer(free.slot)] : prev;
    });
  };

  const removePlayer = (id) => {
    setPlayers((prev) => (prev.length <= 2 ? prev : prev.filter((player) => player.id !== id)));
  };

  /* ---------------- render ---------------- */

  if (gameState === 'setup') {
    return (
      <>
        <Toasts toasts={toasts} />
        <ResultFlash flash={flash} />
        <div className="app">
          <SetupScreen
            questions={questions}
            csvErrors={csvErrors}
            onUpload={readFile}
            onDragState={setDragover}
            dragover={dragover}
            onClearData={() => setConfirmClear(true)}
            players={players}
            onPlayerNameChange={renamePlayer}
            onAddPlayer={addPlayer}
            onRemovePlayer={removePlayer}
            shuffle={shuffle}
            onShuffleChange={setShuffle}
            loading={loading}
            onStart={startGame}
            onConfirmClear={clearData}
            onCancelClear={() => setConfirmClear(false)}
            confirmClear={confirmClear}
            notify={showToast}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Toasts toasts={toasts} />
      <ResultFlash flash={flash} />

      <div className="play3d">
        {use3d ? (
          <Scene3D
            boardRef={board3dRef}
            players={players}
            positions={positions}
            onError={(reason) => {
              setSceneFailReason(typeof reason === 'string' ? reason : 'Papan 3D gagal dibuat');
              setSceneFailed(true);
            }}
            onReady={handleBoardReady}
          />
        ) : (
          <div className="board-fallback">
            <div className="fallback-note" role="status">
              <i className="fa-solid fa-circle-info" aria-hidden="true"></i>
              Mode 3D tidak tersedia; menampilkan papan 2D.
              {webglReason && <span className="fallback-reason"> Alasan: {webglReason}</span>}
            </div>
            <div className="board-wrap">
              <Board
                players={players}
                positions={positions}
                targetCell={targetCell}
                movingId={movingId}
                weaponFor={(cell) => sessionWeaponsRef.current[cell]}
              />
            </div>
          </div>
        )}

        <div className="hud">
        <header className="hud-top">
          <div className="brand hud-brand">
            <span className="brand-mark" aria-hidden="true">
              <i className="fa-solid fa-dice-five"></i>
            </span>
            <div className="grow">
              <h1 className="brand-title">EduLadder Battle</h1>
              <p className="brand-sub">
                Kotak 100 · {Math.max(0, deckRef.current.length - deckIndexRef.current - (activeQuestion && gameState === 'playing' ? 1 : 0))} soal tersisa di bank
              </p>
            </div>
          </div>

          <div className="turn-banner" style={themeVars(activePlayer)} role="status" aria-live="polite">
            <i className={`fa-solid ${questionThrown ? 'fa-arrow-right-arrow-left' : 'fa-bullseye'}`} aria-hidden="true"></i>
            <div>
              <div className="turn-label">{questionThrown ? 'Soal dilempar ke' : 'Giliran'}</div>
              <div className="turn-name">{playerNameOf(activePlayer)}</div>
            </div>
            {questionThrown && (
              <span className="turn-note">
                <i className="fa-solid fa-user" aria-hidden="true"></i> {playerNameOf(currentPlayer)}
              </span>
            )}
          </div>

          <div className="row" style={{ gap: '0.6rem' }}>
            <div className={`clock ${activeQuestion && questionLeft <= 5 && !revealed ? 'danger' : ''}`}>
              <i className="fa-regular fa-hourglass-half" aria-hidden="true"></i>
              <div className="clock-text">
                <div className="clock-label">Soal</div>
                <div className="clock-value">{activeQuestion ? `${questionLeft}s` : '--'}</div>
              </div>
            </div>
            <div className="clock">
              <i className="fa-regular fa-clock" aria-hidden="true"></i>
              <div className="clock-text">
                <div className="clock-label">Total</div>
                <div className="clock-value">{formatTime(gameSeconds)}</div>
              </div>
            </div>
            <button
              className="icon-btn"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                if (next) ensureAudio();
              }}
              aria-label={soundOn ? 'Matikan suara' : 'Nyalakan suara'}
              aria-pressed={!soundOn}
              title={soundOn ? 'Matikan suara' : 'Nyalakan suara'}
            >
              <i className={`fa-solid ${soundOn ? 'fa-volume-high' : 'fa-volume-xmark'}`} aria-hidden="true"></i>
            </button>
            <button className="icon-btn" onClick={toggleFullscreen} aria-label="Layar penuh">
              <i className="fa-solid fa-expand" aria-hidden="true"></i>
            </button>
            <button className="icon-btn" onClick={resetGame} aria-label="Hentikan permainan dan kembali ke pengaturan">
              <i className="fa-solid fa-house" aria-hidden="true"></i>
            </button>
          </div>
        </header>

        <div className={`hud-teams ${players.length > 2 ? 'many' : ''}`}>
          {players.map((player) => (
            <div
              key={player.id}
              className={`score-card ${currentId === player.id ? 'active' : ''}`}
              style={themeVars(player)}
            >
              <span className="avatar" aria-hidden="true">{player.slot}</span>
              <div className="grow">
                <div className="score-name-row">
                  <span className="score-name">{playerNameOf(player)}</span>
                  {shields[player.id] && (
                    <span className="score-badge shield" title="Shield aktif" aria-label="Shield aktif">
                      <i className="fa-solid fa-shield-halved" aria-hidden="true"></i>
                    </span>
                  )}
                  {penawarId === player.id && (
                    <span className="score-badge penawar" title="Penawar aktif" aria-label="Penawar aktif">
                      <i className="fa-solid fa-prescription-bottle-medical" aria-hidden="true"></i>
                    </span>
                  )}
                  {locked[player.id] && (
                    <span className="score-badge locked" title="Terkunci: tidak bisa maju" aria-label="Terkunci">
                      <i className="fa-solid fa-lock" aria-hidden="true"></i>
                    </span>
                  )}
                </div>
                <div className="score-pos">
                  {positions[player.id]}
                  <small>/100</small>
                </div>
                {(arms[player.id] || []).length > 0 && (
                  <ArmBay
                    slots={arms[player.id] || []}
                    active={currentId === player.id}
                    canUse={canFireNow()}
                    fired={Boolean(armedTurn)}
                    onPick={openArmPicker}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="hud-legend board-legend">
          <span className="legend-item">
            <span className="swatch ladder-swatch"><i className="fa-solid fa-stairs" aria-hidden="true"></i></span>
            Tangga naik
          </span>
          <span className="legend-item">
            <span className="swatch snake-swatch"><i className="fa-solid fa-staff-snake" aria-hidden="true"></i></span>
            Ular turun
          </span>
          <span className="legend-item">
            <span className="swatch arm-swatch"><i className="fa-solid fa-crosshairs" aria-hidden="true"></i></span>
            Kotak senjata
          </span>
          <span className="legend-item">
            <span className="swatch finish-swatch"><i className="fa-solid fa-trophy" aria-hidden="true"></i></span>
            Kotak 100
          </span>
        </div>
        </div>
      </div>

      {gameState === 'starting' && <StartCountdown count={startCount} teamName={playerNameOf(players[0])} />}

      {questionOpen && activeQuestion && (
        <MainQuestionOverlay
          question={activeQuestion}
          answeringId={activeId}
          activeId={activeId}
          players={players}
          seconds={questionLeft}
          showClue={showClue}
          picked={picked}
          showAnswer={revealed}
          reward={rewardInfo}
          penaltyBlocked={Boolean(shields[activeId])}
          penawarBlocked={penawarId === activeId}
          onAnswer={resolveAnswer}
          helps={helps}
          onUseHelp={useHelp}
          helpBlocked={helpBlocked}
          helpActive={helpActive}
          helpDescription={helpDescription}
          helpsTab={helpsTab}
          onHelpsTabChange={setHelpsTab}
          armSlots={arms[currentId] || []}
          showArms={!questionThrown}
          canUseArms={canFireNow()}
          armsFired={Boolean(armedTurn)}
          onPickArm={openArmPicker}
          positions={positions}
          bankLeft={bankLeft()}
        />
      )}

      {armTarget && (
        <ArmTargetModal
          request={armTarget}
          actorName={playerName(armTarget.actorId)}
          describeEffect={(entry) => describeArmEffect(armTarget.slot, entry)}
          onConfirm={fireWeapon}
          onClose={closeArmPicker}
        />
      )}

      {armPick && (
        <ArmPickModal
          pick={armPick}
          onPick={(index) => resolveArmPick(index)}
          onCancel={() => resolveArmPick(null)}
        />
      )}

      {snakeLadder && (
        <BonusOverlay
          key={`${snakeLadder.type}-${snakeLadder.from}-${snakeLadder.to}`}
          info={snakeLadder}
          fallbackQuestion={lastQuestionRef.current}
          players={players}
          onResolve={resolveSnakeLadder}
          bankLeft={bankLeft()}
        />
      )}

      {gameState === 'finished' && !showWinner && (
        <div className="finished-banner">
          <button className="btn btn-primary btn-xl" onClick={() => setShowWinner(true)}>
            <i className="fa-solid fa-trophy" aria-hidden="true"></i>
            Lihat Hasil
          </button>
        </div>
      )}

      <Modal open={showWinner} onClose={() => setShowWinner(false)} labelledBy="winner-title">
        <Confetti active={showWinner} />
        <div className="modal-icon gold">
          <i className={`fa-solid ${winner === 'Seri' ? 'fa-handshake' : 'fa-trophy'}`} aria-hidden="true"></i>
        </div>
        <h2 id="winner-title">
          {winner === 'Seri'
            ? 'Permainan Seri!'
            : winner
              ? `${playerName(winner)} Menang!`
              : 'Permainan Selesai'}
        </h2>
        <p className="lead">{winnerReason}</p>
        <div className="final-ranking" aria-label="Peringkat akhir">
          {ranking.map((entry, index) => {
            const top = ranking[0];
            const tied = winner === 'Seri' && top && entry.pos === top.pos && entry.helps === top.helps;
            const isWinner = winner === entry.id || tied;
            return (
              <div
                key={entry.id}
                className={`ranking-row ${isWinner ? 'is-winner' : ''}`}
                style={themeVars({ slot: entry.slot })}
              >
                <span className="rank-num" aria-hidden="true">{index + 1}</span>
                <span className="avatar" aria-hidden="true">{entry.slot}</span>
                <div className="grow">
                  <div className="ranking-name">{entry.name}</div>
                  <div className="ranking-sub">Kotak {entry.pos} · sisa bantuan {entry.helps}</div>
                </div>
                {isWinner && <i className="fa-solid fa-crown ranking-crown" aria-hidden="true"></i>}
              </div>
            );
          })}
        </div>
        <p className="panel-sub" style={{ marginBottom: '1.3rem' }}>
          <i className="fa-regular fa-clock" aria-hidden="true"></i> Durasi permainan {formatTime(gameSeconds)}
        </p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={startGame}>
            <i className="fa-solid fa-rotate-right" aria-hidden="true"></i>
            Main Lagi
          </button>
          <button className="btn btn-ghost" onClick={resetGame}>
            <i className="fa-solid fa-sliders" aria-hidden="true"></i>
            Ubah Soal & Pemain
          </button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Confetti                                                            */
/* ------------------------------------------------------------------ */

function Confetti({ active }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    const colors = ['#fbbf24', '#f43f5e', '#22c55e', '#3b82f6', '#a855f7', '#f97316'];
    const pieces = Array.from({ length: 130 }).map(() => ({
      x: Math.random() * width,
      y: -20 - Math.random() * height,
      size: 6 + Math.random() * 9,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 1.6 + Math.random() * 2.8,
      drift: -1.2 + Math.random() * 2.4,
      rotation: Math.random() * Math.PI,
      spin: -0.08 + Math.random() * 0.16,
    }));

    let frame = 0;
    const start = performance.now();

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    const draw = (now) => {
      ctx.clearRect(0, 0, width, height);
      pieces.forEach((piece) => {
        piece.y += piece.speed;
        piece.x += piece.drift;
        piece.rotation += piece.spin;
        if (piece.y > height + 20) {
          piece.y = -20;
          piece.x = Math.random() * width;
        }
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rotation);
        ctx.fillStyle = piece.color;
        ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        ctx.restore();
      });
      if (now - start < 6500) {
        frame = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [active]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true"></canvas>;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<SnakesLaddersGame />);
