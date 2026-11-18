'use strict';

const E = require('../shared/engine');

const ANSWER_CSV_HEADER = [
  'Room',
  'Waktu',
  'Jenis',
  'Pertanyaan',
  'Pemain',
  'Slot',
  'Karakter',
  'Jawaban',
  'Teks Jawaban',
  'Kunci',
  'Benar',
  'Timeout',
  'Delta Langkah',
];

const KIND_LABELS = { utama: 'Soal utama', tangga: 'Bonus tangga', ular: 'Bonus ular' };

/* Cegah formula injection di Excel/LibreOffice: sel yang diawali karakter
   aktif diberi apostrof sebelum di-escape. */
function neutralize(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /^[=+@]/.test(text) || /^-\D/.test(text) || text === '-' ? `'${text}` : text;
}

function escapeCell(value) {
  const text = neutralize(value);
  if (/[;"\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/* Waktu lokal server (bukan UTC) agar mudah dibaca guru saat membuka CSV. */
function formatMoment(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildAnswersCsv(rows) {
  const lines = [ANSWER_CSV_HEADER.map(escapeCell).join(';')];
  (rows || []).forEach((row) => {
    const character = E.characterStyle(row.char || row.playerSlot || 1);
    lines.push(
      [
        row.roomCode,
        formatMoment(row.createdAt),
        KIND_LABELS[row.kind] || KIND_LABELS.utama,
        row.question,
        row.playerName,
        row.playerSlot,
        character.name,
        row.picked || '',
        row.pickedText || '',
        row.correctAnswer || '',
        row.isCorrect ? 'Ya' : 'Tidak',
        row.timedOut ? 'Ya' : 'Tidak',
        row.delta,
      ]
        .map(escapeCell)
        .join(';')
    );
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function answerFileName(code, finishedAt) {
  const date = finishedAt ? new Date(finishedAt) : new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const room = String(code || 'ROOM').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ROOM';
  return `jawaban-${room}-${stamp}.csv`;
}

module.exports = { buildAnswersCsv, answerFileName, ANSWER_CSV_HEADER, escapeCell };
