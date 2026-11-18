'use strict';

/*
 * Konfigurasi server dari environment / file .env.
 *
 * Modul ini murni (tidak membaca process.env sendiri) agar bisa diuji.
 * `server/index.js` memanggil loadConfig() lalu assertConfig() sebelum
 * modul lain dipakai, sehingga konfigurasi salah langsung menghentikan
 * server alih-alih berjalan dengan nilai mengejutkan.
 */

const DEFAULTS = {
  port: 3000,
  host: '0.0.0.0',
  corsOrigin: '*',
  sessionHours: 12,
  loginMaxAttempts: 5,
  loginWindowSeconds: 60,
  jsonLimit: '2mb',
  csvLimit: '1mb',
};

const MAX_SESSION_HOURS = 24 * 7;
const BYTE_LIMIT_PATTERN = /^(\d+(?:\.\d+)?)(kb|mb)$/i;

function clean(env, key) {
  const value = env ? env[key] : undefined;
  return value === undefined || value === null ? '' : String(value).trim();
}

/* Integer ketat: tolak kosong, desimal, dan notasi aneh. */
function toInt(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return null;
  if (!/^-?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/* Angka positif boleh desimal (mis. 0.5 jam untuk uji coba). */
function toPositiveNumber(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizePublicUrl(value) {
  const text = String(value || '').trim();
  if (!text) return { value: '', error: null };
  let url;
  try {
    url = new URL(text);
  } catch (error) {
    return { value: '', error: 'harus URL lengkap, mis. http://192.168.1.10:3000' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { value: '', error: 'skema harus http:// atau https://' };
  }
  if (url.search || url.hash) {
    return { value: '', error: 'tidak boleh memuat query atau fragmen' };
  }
  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return { value: `${url.origin}${pathname}`, error: null };
}

/* "*" atau daftar origin dipisah koma. Origin harus http(s) tanpa path. */
function parseCorsOrigin(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return { origin: DEFAULTS.corsOrigin, list: null, error: null };
  if (text === '*') return { origin: '*', list: null, error: null };
  const entries = text.split(',').map((item) => item.trim()).filter(Boolean);
  if (!entries.length) return { origin: DEFAULTS.corsOrigin, list: null, error: null };
  const origins = [];
  for (const entry of entries) {
    let url;
    try {
      url = new URL(entry);
    } catch (error) {
      return { origin: null, list: null, error: `origin tidak valid: ${entry}` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { origin: null, list: null, error: `origin harus http(s): ${entry}` };
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      return { origin: null, list: null, error: `origin tanpa path/query: ${entry}` };
    }
    origins.push(url.origin);
  }
  return { origin: origins, list: origins, error: null };
}

function parseByteLimit(value, fallback) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return { limit: fallback, error: null };
  if (!BYTE_LIMIT_PATTERN.test(text)) {
    return { limit: fallback, error: 'format harus angka + kb/mb, mis. 2mb' };
  }
  return { limit: text.toLowerCase(), error: null };
}

/*
 * loadConfig(env) → { config, errors }.
 * `config` selalu berisi nilai default yang sudah dinormalkan, sehingga
 * pemanggil bisa menampilkan ringkasan meski ada error.
 */
function loadConfig(env) {
  const source = env || {};
  const errors = [];
  const config = {
    port: DEFAULTS.port,
    host: DEFAULTS.host,
    adminPassword: '',
    dbPath: clean(source, 'EDULADDER_DB'),
    corsOrigin: DEFAULTS.corsOrigin,
    corsOrigins: null,
    sessionHours: DEFAULTS.sessionHours,
    loginMaxAttempts: DEFAULTS.loginMaxAttempts,
    loginWindowSeconds: DEFAULTS.loginWindowSeconds,
    publicUrl: '',
    jsonLimit: DEFAULTS.jsonLimit,
    csvLimit: DEFAULTS.csvLimit,
  };

  /* PORT */
  const rawPort = clean(source, 'PORT');
  if (rawPort) {
    const port = toInt(rawPort);
    if (port === null || port < 1 || port > 65535) {
      errors.push('PORT: harus bilangan bulat 1-65535');
    } else if (port === 0) {
      errors.push('PORT: 0 tidak diizinkan');
    } else {
      config.port = port;
    }
  }

  /* HOST */
  const rawHost = clean(source, 'HOST');
  if (rawHost) {
    if (/\s/.test(rawHost)) errors.push('HOST: tidak boleh memuat spasi');
    else config.host = rawHost;
  }

  /* Password admin wajib. */
  const password = clean(source, 'EDULADDER_ADMIN_PASSWORD');
  if (!password) {
    errors.push('EDULADDER_ADMIN_PASSWORD: wajib diisi (lihat .env.example)');
  } else {
    config.adminPassword = password;
  }

  /* CORS */
  const cors = parseCorsOrigin(clean(source, 'EDULADDER_CORS_ORIGIN'));
  if (cors.error) errors.push(`EDULADDER_CORS_ORIGIN: ${cors.error}`);
  else {
    config.corsOrigin = cors.origin;
    config.corsOrigins = cors.list;
  }

  /* TTL sesi admin (jam). */
  const rawHours = clean(source, 'EDULADDER_SESSION_HOURS');
  if (rawHours) {
    const hours = toPositiveNumber(rawHours);
    if (hours === null || hours > MAX_SESSION_HOURS) {
      errors.push(`EDULADDER_SESSION_HOURS: harus angka > 0 dan <= ${MAX_SESSION_HOURS}`);
    } else {
      config.sessionHours = hours;
    }
  }

  /* Rate limit login. */
  const rawAttempts = clean(source, 'EDULADDER_LOGIN_MAX_ATTEMPTS');
  if (rawAttempts) {
    const attempts = toInt(rawAttempts);
    if (attempts === null || attempts < 1) errors.push('EDULADDER_LOGIN_MAX_ATTEMPTS: harus bilangan bulat >= 1');
    else config.loginMaxAttempts = attempts;
  }

  const rawWindow = clean(source, 'EDULADDER_LOGIN_WINDOW_SECONDS');
  if (rawWindow) {
    const seconds = toInt(rawWindow);
    if (seconds === null || seconds < 1) errors.push('EDULADDER_LOGIN_WINDOW_SECONDS: harus bilangan bulat >= 1');
    else config.loginWindowSeconds = seconds;
  }

  /* URL publik untuk QR/link join. */
  const publicUrl = normalizePublicUrl(clean(source, 'EDULADDER_PUBLIC_URL'));
  if (publicUrl.error) errors.push(`EDULADDER_PUBLIC_URL: ${publicUrl.error}`);
  else config.publicUrl = publicUrl.value;

  /* Batas ukuran body. */
  const json = parseByteLimit(clean(source, 'EDULADDER_JSON_LIMIT'), DEFAULTS.jsonLimit);
  if (json.error) errors.push(`EDULADDER_JSON_LIMIT: ${json.error}`);
  else config.jsonLimit = json.limit;

  const csv = parseByteLimit(clean(source, 'EDULADDER_CSV_LIMIT'), DEFAULTS.csvLimit);
  if (csv.error) errors.push(`EDULADDER_CSV_LIMIT: ${csv.error}`);
  else config.csvLimit = csv.limit;

  return { config, errors };
}

/* Tampilkan masalah lalu hentikan proses. Dipisah agar mudah diuji. */
function formatConfigErrors(errors) {
  const lines = ['', '  [BERHENTI] Konfigurasi .env bermasalah:'];
  errors.forEach((message) => lines.push(`    - ${message}`));
  lines.push('');
  lines.push('  Salin .env.example menjadi .env lalu isi nilainya:');
  lines.push('    PowerShell: Copy-Item .env.example .env');
  lines.push('    Git Bash  : cp .env.example .env');
  lines.push('');
  return lines.join('\n');
}

function assertConfig(loaded) {
  const { config, errors } = loaded || {};
  if (errors && errors.length) {
    console.error(formatConfigErrors(errors));
    process.exit(1);
  }
  return config;
}

module.exports = {
  DEFAULTS,
  MAX_SESSION_HOURS,
  loadConfig,
  formatConfigErrors,
  assertConfig,
  parseCorsOrigin,
  parseByteLimit,
  normalizePublicUrl,
  toInt,
  toPositiveNumber,
};
