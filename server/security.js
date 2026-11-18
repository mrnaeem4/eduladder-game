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

/* Sesi admin global (in-memory). Satu password untuk semua aksi admin.
   Default di bawah sama dengan perilaku sebelum konfigurasi .env. */
const adminSessions = new Map();
const MAX_SESSIONS = 200;

const limits = {
  sessionTtlMs: 12 * 60 * 60 * 1000,
  maxAttempts: 5,
  windowMs: 60 * 1000,
};

/* Dipanggil sekali dari server/index.js setelah konfigurasi divalidasi.
   Bila tidak dipanggil (mis. test yang me-require modul ini langsung),
   nilai default dipertahankan. */
function configure(options) {
  const opts = options || {};
  const hours = Number(opts.sessionHours);
  const attempts = Number(opts.loginMaxAttempts);
  const seconds = Number(opts.loginWindowSeconds);
  if (Number.isFinite(hours) && hours > 0) limits.sessionTtlMs = hours * 60 * 60 * 1000;
  if (Number.isInteger(attempts) && attempts >= 1) limits.maxAttempts = attempts;
  if (Number.isInteger(seconds) && seconds >= 1) limits.windowMs = seconds * 1000;
  return { ...limits };
}

function issueAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  if (adminSessions.size >= MAX_SESSIONS) pruneExpired();
  const expiresAt = Date.now() + limits.sessionTtlMs;
  adminSessions.set(token, expiresAt);
  return { token, expiresAt };
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
const MAX_ATTEMPT_KEYS = 1000;

function loginAllowed(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    if (attempts.size >= MAX_ATTEMPT_KEYS) pruneExpired();
    attempts.set(key, { count: 0, resetAt: now + limits.windowMs });
    return true;
  }
  return entry.count < limits.maxAttempts;
}

function noteLoginFailure(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) attempts.set(key, { count: 1, resetAt: now + limits.windowMs });
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
  configure,
  limits,
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
