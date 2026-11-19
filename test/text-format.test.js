const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const E = require(path.join('..', 'shared', 'engine'));

/* Soal berisi kode: penanda \n dan \t pada impor CSV serta teks mentah
   dipertahankan sampai ditampilkan. */

const HEADER = 'Pertanyaan;A;B;C;D;Jawaban;Clue;Reward;Penalty;Durasi';
const SP = String.fromCharCode(92); // backslash

test('decodeEscapes menerjemahkan \\n dan \\t menjadi karakter kontrol', () => {
  assert.strictEqual(E.decodeEscapes(`a${SP}nb`), 'a\nb');
  assert.strictEqual(E.decodeEscapes(`a${SP}tb`), 'a\tb');
  assert.strictEqual(E.decodeEscapes(`a${SP}rb`), 'a\rb');
  assert.strictEqual(E.decodeEscapes(`x${SP}ny${SP}t`).length, 4);
});

test('decodeEscapes mempertahankan escape ganda sebagai teks literal', () => {
  assert.strictEqual(E.decodeEscapes(`a${SP}${SP}nb`), `a${SP}nb`);
  assert.strictEqual(E.decodeEscapes(`a${SP}${SP}tb`), `a${SP}tb`);
});

test('decodeEscapes mengubah <br> dan newline Windows menjadi baris baru', () => {
  assert.strictEqual(E.decodeEscapes('x<br>y'), 'x\ny');
  assert.strictEqual(E.decodeEscapes('x<BR/>y'), 'x\ny');
  assert.strictEqual(E.decodeEscapes('x<br />y'), 'x\ny');
  assert.strictEqual(E.decodeEscapes('x\r\ny\rz'), 'x\ny\nz');
});

test('parseCsv menerjemahkan \\n dan \\t pada soal, opsi, dan clue', () => {
  const csv = [
    HEADER,
    `Kode:${SP}n${SP}tprint(1);1;2;3;4;A;Indentasi ${SP}t dengan tab;4;3;30`,
  ].join('\n');
  const { questions, errors } = E.parseCsv(csv);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(questions.length, 1);
  assert.strictEqual(questions[0].question, 'Kode:\n\tprint(1)');
  assert.strictEqual(questions[0].clue, 'Indentasi \t dengan tab');
});

test('parseCsv membaca sel ber-quote yang memuat newline sungguhan', () => {
  const csv = [
    HEADER,
    '"Baris 1\nBaris 2";a;b;c;d;B;"clue\nbaris";4;3;30',
    'Soal berikutnya;a;b;c;d;A;clue;4;3;30',
  ].join('\n');
  const { questions, errors } = E.parseCsv(csv);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(questions.length, 2);
  assert.strictEqual(questions[0].question, 'Baris 1\nBaris 2');
  assert.strictEqual(questions[0].clue, 'clue\nbaris');
  assert.strictEqual(questions[1].question, 'Soal berikutnya');
});

test('parseCsv mempertahankan ; dan "" di dalam sel ber-quote', () => {
  const csv = [
    HEADER,
    '"Pilih ""A; B""?";x;y;z;w;A;c;4;3;30',
  ].join('\n');
  const { questions, errors } = E.parseCsv(csv);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(questions[0].question, 'Pilih "A; B"?');
});

test('normalizeQuestion mempertahankan newline dan tab di tengah teks', () => {
  const q = E.normalizeQuestion({
    question: 'kode:\n\tprint(1)',
    options: [{ text: 'a\nb' }, { text: '\tc' }, { text: 'd' }, { text: 'e' }],
    correctAnswer: 'A',
    clue: 'x\ty',
  }, 0);
  assert.strictEqual(q.question, 'kode:\n\tprint(1)');
  assert.strictEqual(q.options[0].text, 'a\nb');
  assert.strictEqual(q.options[1].text, '\tc');
  assert.strictEqual(q.clue, 'x\ty');
  /* Tetap dibawa ke snapshot untuk klien. */
  const snapshot = E.publicSnapshot(E.createGameState([{ id: 'p1', slot: 1, name: 'A' }], [q], { shuffle: false }));
  assert.strictEqual(snapshot.players.length, 1);
  assert.strictEqual(E.redactQuestion(q).question, 'kode:\n\tprint(1)');
});

test('URL gambar dengan newline tetap ditolak', () => {
  assert.strictEqual(E.isValidImageUrl('https://x.test/a\nb.png'), false);
  const csv = [
    HEADER.replace('Durasi', 'Durasi;Gambar Soal'),
    '"Soal";a;b;c;d;A;c;4;3;30;"https://x.test/q\n.png"',
  ].join('\n');
  const { errors } = E.parseCsv(csv);
  assert.ok(errors.length > 0, 'gambar soal harus dilaporkan tidak valid');
  /* Escape \\n pada URL tidak diterjemahkan menjadi URL valid. */
  const escaped = E.parseCsv([HEADER.replace('Durasi', 'Durasi;Gambar Soal'), `Soal;a;b;c;d;A;c;4;3;30;https://x.test/${SP}nq.png`].join('\n'));
  assert.notStrictEqual(escaped.questions[0].questionImage, 'https://x.test/\nq.png');
  assert.strictEqual(E.isValidImageUrl('https://x.test/\nq.png'), false);
});

test('template CSV bawaan memuat contoh kode dan terbaca tanpa error', () => {
  const parsed = E.parseCsv([E.CSV_HEADER, ...E.CSV_SAMPLE_ROWS].join('\r\n'));
  assert.deepStrictEqual(parsed.errors, []);
  assert.strictEqual(parsed.questions.length, E.CSV_SAMPLE_ROWS.length);
  const code = parsed.questions.find((q) => q.question.includes('print(i)'));
  assert.ok(code, 'contoh kode ada');
  assert.ok(code.question.includes('\n\t'));
});
