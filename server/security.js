'use strict';

const crypto = require('crypto');

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomRoomCode(length) {
  const size = length || 6;
  const bytes = crypto.randomBytes(size);
  let code = '';
  for (let i = 0; i < size; i += 1) {
    code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return code;
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const expected = parts[2];
  try {
    const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const a = Buffer.from(derived, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (error) {
    return false;
  }
}

/* Bandingkan dalam waktu konstan tanpa membocorkan panjang lewat early return:
   kedua input di-hash ke digest panjang-tetap lebih dulu. */
function safeEqualText(a, b) {
  const left = crypto.createHash('sha256').update(String(a === undefined || a === null ? '' : a)).digest();
  const right = crypto.createHash('sha256').update(String(b === undefined || b === null ? '' : b)).digest();
  return crypto.timingSafeEqual(left, right);
}

/* Sesi admin global (in-memory). Satu password untuk semua aksi admin. */
const adminSessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;

function issueAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  if (adminSessions.size >= MAX_SESSIONS) pruneExpired();
  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  return { token, expiresAt: Date.now() + SESSION_TTL_MS };
}

function pruneExpired() {
  const now = Date.now();
  adminSessions.forEach((expires, token) => {
    if (expires < now) adminSessions.delete(token);
  });
  attempts.forEach((entry, key) => {
    if (!entry || entry.resetAt < now) attempts.delete(key);
  });
}

function isValidAdminSession(token) {
  if (!token) return false;
  const expires = adminSessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function revokeAdminSession(token) {
  return adminSessions.delete(token);
}

/* Rate limit percobaan login per IP. */
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPT_KEYS = 1000;

function loginAllowed(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    if (attempts.size >= MAX_ATTEMPT_KEYS) pruneExpired();
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return true;
  }
  return entry.count < MAX_ATTEMPTS;
}

function noteLoginFailure(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

function resetLoginAttempts(ip) {
  attempts.delete(String(ip || 'unknown'));
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 18);
}

module.exports = {
  ROOM_ALPHABET,
  randomRoomCode,
  randomToken,
  hashPassword,
  verifyPassword,
  safeEqualText,
  issueAdminSession,
  isValidAdminSession,
  revokeAdminSession,
  loginAllowed,
  noteLoginFailure,
  resetLoginAttempts,
  sanitizeName,
};
