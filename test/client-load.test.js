const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const babel = require('@babel/standalone');

const E = require(path.join('..', 'shared', 'engine'));

/*
 * Regresi: semua <script type="text/babel"> di index.html berjalan di scope
 * global yang SAMA. Tanpa isolasi, `const { useState } = React;` di berkas
 * kedua melempar "Identifier 'useState' has already been declared" dan
 * aplikasi gagal dirender.
 */

function makeBrowserContext() {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.React = {
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    createElement: () => null,
  };
  sandbox.ReactDOM = { createRoot: () => ({ render: () => {} }) };
  sandbox.document = {
    getElementById: () => ({}),
    createElement: () => ({ style: {}, appendChild() {}, click() {} }),
    body: { appendChild() {}, removeChild() {} },
  };
  sandbox.GameEngine = E;
  sandbox.QRCode = function QRCode() {};
  sandbox.io = () => ({ on: () => {}, emit: () => {}, off: () => {}, connect: () => {}, disconnect: () => {} });
  sandbox.Net = { loadPref: () => true, savePref: () => {}, loadAdminSession: () => null, currentRoomFromUrl: () => '' };
  sandbox.AudioKit = { prime: () => {}, sfx: () => {}, startBgm: () => {}, stopBgm: () => {} };
  vm.createContext(sandbox);
  return sandbox;
}

/* Urutan mengikuti index.html. */
const SCRIPTS = [
  'assets/js/board3d.js',
  'assets/js/podium3d.js',
  'client/net.js',
  'client/audio.js',
  'client/dialog.js',
  'client/components.jsx',
  'client/guide.jsx',
  'client/bootstrap.jsx',
  'client/screens.jsx',
  'client/admin.jsx',
  'client/lobby.jsx',
  'client/game.jsx',
  'client/app.jsx',
];

function evalScript(context, name) {
  const file = path.join(__dirname, '..', name);
  const source = fs.readFileSync(file, 'utf8');
  const code = name.endsWith('.jsx')
    ? babel.transform(source, { presets: ['react'], sourceType: 'script' }).code
    : source;
  /* Berkas JS murni (board3d/podium3d) hanya mendaftarkan global dan tidak
     menyentuh DOM saat dimuat; Three.js tidak diperlukan untuk itu. */
  new vm.Script(code, { filename: name }).runInContext(context);
}

test('semua skrip klien dapat dimuat di satu scope global (tanpa redeclaration)', () => {
  const context = makeBrowserContext();
  const errors = [];
  SCRIPTS.forEach((name) => {
    try {
      evalScript(context, name);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  });
  assert.deepStrictEqual(errors, [], errors.join('\n'));
});

test('global lintas berkas tersedia setelah semua skrip dimuat', () => {
  const context = makeBrowserContext();
  SCRIPTS.forEach((name) => evalScript(context, name));
  ['UI', 'Screens', 'AdminDashboard', 'LobbyScreen', 'GameScreen', 'Net', 'AudioKit', 'Board3D', 'Podium3D'].forEach((key) => {
    assert.ok(context[key], `window.${key} harus terdefinisi`);
  });
  ['Modal', 'Toasts', 'MainQuestionOverlay', 'BonusOverlay', 'downloadTemplate', 'useCountdown', 'ActionPanel', 'PodiumStage', 'OverlayAnswerGrid', 'GuideModal', 'guideSections'].forEach((key) => {
    assert.ok(context.UI[key], `window.UI.${key} harus terdefinisi`);
  });
});

test('tidak ada binding top-level yang bocor ke window', () => {
  const context = makeBrowserContext();
  SCRIPTS.forEach((name) => evalScript(context, name));
  /* Net & AudioKit memang global publik dari client/net.js & audio.js. */
  ['useState', 'useRef', 'GE', 'HELP_TABS', 'SCRIPTS', 'PODIUM_HEIGHTS', 'MODEL_BUILDERS', 'REACTIONS', 'ActionPanel', 'PodiumStage', 'buildGuideSections', 'GuideModal', 'GUIDE_SECTIONS', 'HELP_TONES', 'SECTION_TONES'].forEach((key) => {
    assert.strictEqual(context[key], undefined, `${key} tidak boleh menjadi global`);
  });
});
