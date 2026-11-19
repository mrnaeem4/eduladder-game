/* Kontrak JSX editor soal: Enter = baris baru, Tab/Shift+Tab = indentasi. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const babel = require('@babel/standalone');

const source = fs.readFileSync(path.join(__dirname, '..', 'client', 'admin.jsx'), 'utf8');

test('editor soal memakai textarea multi-baris dengan penanganan Tab', () => {
  assert.ok(/rows=\{4\}/.test(source), 'textarea soal minimal 4 baris');
  assert.ok(/onKeyDown=\{onTextKeyDown\}/.test(source), 'textarea memakai onTextKeyDown');
  assert.ok(/event\.key !== 'Tab'/.test(source), 'hanya menangani tombol Tab');
  assert.ok(/pendingCaret\.current = start \+ 1/.test(source), 'kursor maju satu setelah Tab');
  assert.ok(/event\.shiftKey/.test(source), 'Shift+Tab mengurangi indentasi');
});

test('editor soal dapat dimuat Babel tanpa sintaks baru yang ditolak', () => {
  assert.doesNotThrow(() => babel.transform(source, { presets: ['react'], sourceType: 'script' }));
});
