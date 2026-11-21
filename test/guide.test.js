const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const babel = require('@babel/standalone');

const E = require(path.join('..', 'shared', 'engine'));

/* Panduan lobi harus mengikuti konstanta engine: bantuan, senjata, dan papan
   diambil dari satu sumber agar teks tidak basi saat konten berubah. */

function loadGuide() {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const created = [];
  sandbox.React = {
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useMemo: (fn) => fn(),
    createElement: (type, props, ...children) => {
      const node = { type, props, children };
      created.push(node);
      return node;
    },
  };
  sandbox.GameEngine = E;
  sandbox.UI = { Modal: function Modal() {} };
  sandbox.__created = created;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', 'client', 'guide.jsx');
  const code = babel.transform(fs.readFileSync(file, 'utf8'), { presets: ['react'], sourceType: 'script' }).code;
  new vm.Script(code, { filename: 'client/guide.jsx' }).runInContext(sandbox);
  return sandbox;
}

function sectionOf(sections, key) {
  return sections.find((section) => section.key === key);
}

test('guideSections memuat semua bagian dengan urutan tetap', () => {
  const { UI } = loadGuide();
  const sections = UI.guideSections({});
  assert.strictEqual(
    Array.from(sections, (section) => section.key).join(','),
    'mulai,giliran,jawaban,papan,bantuan,senjata,status,selama,selesai'
  );
  sections.forEach((section) => {
    assert.ok(section.title, `${section.key} punya judul`);
    assert.ok(section.icon, `${section.key} punya ikon`);
    assert.ok(Array.isArray(section.items) && section.items.length > 0, `${section.key} punya butir`);
  });
});

test('bagian bantuan menampilkan semua HELPS dengan kuota room', () => {
  const { UI } = loadGuide();
  const quotas = { ...E.DEFAULT_HELPS(), clue: 0, throwQuestion: 3 };
  const help = sectionOf(UI.guideSections({ quotas }), 'bantuan');
  assert.deepStrictEqual(help.items.map((item) => item.label), E.HELPS.map((item) => item.label));
  assert.strictEqual(help.items.length, E.HELPS.length);
  help.items.forEach((item) => {
    assert.ok(item.text, `${item.label} punya deskripsi`);
    assert.ok(item.icon, `${item.label} punya ikon`);
  });
  const clue = help.items.find((item) => item.label === 'Clue');
  const thrower = help.items.find((item) => item.label === 'Lempar Soal');
  assert.strictEqual(clue.badge, 'nonaktif');
  assert.strictEqual(thrower.badge, '×3');
});

test('kuota default dipakai bila room tidak mengirim helpQuotas', () => {
  const { UI } = loadGuide();
  const help = sectionOf(UI.guideSections({}), 'bantuan');
  E.HELPS.forEach((def) => {
    const item = help.items.find((entry) => entry.label === def.label);
    assert.strictEqual(item.badge, `×${E.DEFAULT_HELPS()[def.key]}`);
  });
  /* Nilai tak dikenal diabaikan, nilai 0 tetap berarti nonaktif. */
  const override = sectionOf(UI.guideSections({ quotas: { clue: -5 } }), 'bantuan');
  const clue = override.items.find((item) => item.label === 'Clue');
  assert.strictEqual(clue.badge, `×${E.DEFAULT_HELPS().clue}`);
});

test('bagian senjata memuat semua WEAPONS dan deskripsi engine', () => {
  const { UI } = loadGuide();
  const weapons = sectionOf(UI.guideSections({}), 'senjata');
  assert.deepStrictEqual(weapons.items.map((item) => item.label), E.WEAPONS.map((item) => item.label));
  weapons.items.forEach((item, index) => {
    const def = E.WEAPONS[index];
    assert.strictEqual(item.text, E.WEAPON_DESCRIPTIONS[def.key]);
    assert.strictEqual(item.dot, def.tone);
  });
  assert.ok(weapons.intro.includes(String(E.ARMS_CAPACITY)), 'menyebut kapasitas slot');
});

test('bagian papan mencantumkan tangga, ular, kotak senjata, dan target menang', () => {
  const { UI } = loadGuide();
  const board = sectionOf(UI.guideSections({}), 'papan');
  const text = board.items.map((item) => `${item.label} ${item.text}`).join('\n');
  Object.entries(E.LADDERS).forEach(([from, to]) => {
    assert.ok(text.includes(`${from} → ${to}`), `tangga ${from}-${to}`);
  });
  Object.entries(E.SNAKES).forEach(([from, to]) => {
    assert.ok(text.includes(`${from} → ${to}`), `ular ${from}-${to}`);
  });
  E.WEAPON_CELLS.forEach((cell) => {
    assert.ok(text.includes(String(cell)), `kotak senjata ${cell}`);
  });
  assert.ok(text.includes(String(E.WIN_POSITION)), 'kotak menang');
});

test('baris join saat berjalan mengikuti allowLateJoin', () => {
  const { UI } = loadGuide();
  const withJoin = sectionOf(UI.guideSections({ allowLateJoin: true }), 'mulai');
  const withoutJoin = sectionOf(UI.guideSections({ allowLateJoin: false }), 'mulai');
  const joinLabels = (start) => start.items.map((item) => item.label);
  assert.ok(joinLabels(withJoin).includes('Join saat berjalan'));
  assert.ok(joinLabels(withoutJoin).includes('Join saat berjalan'));
  const textOf = (start) => start.items.map((item) => item.text).join(' ');
  assert.ok(/mengizinkan/i.test(textOf(withJoin)));
  assert.ok(/tidak mengizinkan/i.test(textOf(withoutJoin)));
});

test('komponen GuideModal dapat dirender tanpa error dan memakai UI.Modal', () => {
  const sandbox = loadGuide();
  const tree = sandbox.UI.GuideModal({ open: true, onClose() {}, quotas: { clue: 0 }, allowLateJoin: true });
  assert.strictEqual(tree.type, sandbox.UI.Modal, 'memakai window.UI.Modal');
  const nodes = sandbox.__created;
  const heading = nodes.find((node) => node.type === 'h2' && node.props && node.props.id === 'guide-title');
  assert.ok(heading, 'judul dialog memakai id guide-title');
  /* Semua section tampil: 9 judul h3 + judul bantuan di engine. */
  const titles = nodes
    .filter((node) => node.type === 'h3')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''));
  assert.strictEqual(titles.length, 9);
  assert.ok(titles.some((text) => text.includes('Bantuan')));
  /* Tombol Tutup memanggil onClose. */
  let closed = false;
  sandbox.UI.GuideModal({ open: true, onClose: () => { closed = true; }, quotas: null });
  const closeBtn = sandbox.__created.filter((node) => node.type === 'button').pop();
  closeBtn.props.onClick();
  assert.strictEqual(closed, true);
});

test('tidak ada binding top-level panduan yang bocor ke window', () => {
  const sandbox = loadGuide();
  ['buildGuideSections', 'GuideModal', 'GUIDE_SECTIONS', 'HELP_TONES', 'SECTION_TONES', 'SECTION_ICONS'].forEach((key) => {
    assert.strictEqual(sandbox[key], undefined, `${key} tidak boleh global`);
  });
  assert.strictEqual(typeof sandbox.UI.GuideModal, 'function');
  assert.strictEqual(typeof sandbox.UI.guideSections, 'function');
});