const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  loadConfig,
  formatConfigErrors,
  parseCorsOrigin,
  parseByteLimit,
  normalizePublicUrl,
  toInt,
  DEFAULTS,
} = require(path.join('..', 'server', 'config'));

const BASE = { EDULADDER_ADMIN_PASSWORD: 'rahasia' };

function load(overrides) {
  return loadConfig({ ...BASE, ...(overrides || {}) });
}

test('loadConfig memakai default saat hanya password diisi', () => {
  const { config, errors } = load();
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(config.port, DEFAULTS.port);
  assert.strictEqual(config.host, DEFAULTS.host);
  assert.strictEqual(config.corsOrigin, '*');
  assert.strictEqual(config.sessionHours, 12);
  assert.strictEqual(config.loginMaxAttempts, 5);
  assert.strictEqual(config.loginWindowSeconds, 60);
  assert.strictEqual(config.publicUrl, '');
  assert.strictEqual(config.jsonLimit, '2mb');
  assert.strictEqual(config.csvLimit, '1mb');
  assert.strictEqual(config.adminPassword, 'rahasia');
});

test('password admin wajib dan spasi saja dianggap kosong', () => {
  assert.ok(loadConfig({}).errors.some((m) => /EDULADDER_ADMIN_PASSWORD/.test(m)));
  assert.ok(loadConfig({ EDULADDER_ADMIN_PASSWORD: '   ' }).errors.some((m) => /EDULADDER_ADMIN_PASSWORD/.test(m)));
});

test('PORT harus integer 1-65535', () => {
  for (const value of ['abc', '70000', '0', '-1', '12.5']) {
    const { errors } = load({ PORT: value });
    assert.ok(errors.some((m) => /^PORT:/.test(m)), `PORT=${value} harus ditolak`);
  }
  const { config, errors } = load({ PORT: '8080' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(config.port, 8080);
});

test('HOST menolak spasi dan menerima alamat biasa', () => {
  assert.ok(load({ HOST: '0.0.0.0 local' }).errors.some((m) => /^HOST:/.test(m)));
  assert.strictEqual(load({ HOST: '127.0.0.1' }).config.host, '127.0.0.1');
});

test('EDULADDER_SESSION_HOURS dibatasi 0 < jam <= 168', () => {
  for (const value of ['0', '-2', 'abc', '168.5', '999']) {
    assert.ok(load({ EDULADDER_SESSION_HOURS: value }).errors.some((m) => /SESSION_HOURS/.test(m)), value);
  }
  const { config, errors } = load({ EDULADDER_SESSION_HOURS: '168' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(config.sessionHours, 168);
  assert.strictEqual(load({ EDULADDER_SESSION_HOURS: '0.5' }).config.sessionHours, 0.5);
});

test('rate limit login harus bilangan bulat >= 1', () => {
  for (const value of ['0', '-1', 'abc', '2.5']) {
    assert.ok(load({ EDULADDER_LOGIN_MAX_ATTEMPTS: value }).errors.some((m) => /LOGIN_MAX_ATTEMPTS/.test(m)), value);
    assert.ok(load({ EDULADDER_LOGIN_WINDOW_SECONDS: value }).errors.some((m) => /LOGIN_WINDOW_SECONDS/.test(m)), value);
  }
  const { config, errors } = load({ EDULADDER_LOGIN_MAX_ATTEMPTS: '3', EDULADDER_LOGIN_WINDOW_SECONDS: '120' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(config.loginMaxAttempts, 3);
  assert.strictEqual(config.loginWindowSeconds, 120);
});

test('EDULADDER_CORS_ORIGIN menerima * atau daftar origin http(s)', () => {
  const star = load({ EDULADDER_CORS_ORIGIN: '*' });
  assert.deepStrictEqual(star.errors, []);
  assert.strictEqual(star.config.corsOrigin, '*');

  const list = load({ EDULADDER_CORS_ORIGIN: 'https://a.example, http://b.example:8080' });
  assert.deepStrictEqual(list.errors, []);
  assert.deepStrictEqual(list.config.corsOrigin, ['https://a.example', 'http://b.example:8080']);

  for (const value of ['javascript:alert(1)', 'ftp://a.example', 'https://a.example/path', 'bukan-url']) {
    assert.ok(load({ EDULADDER_CORS_ORIGIN: value }).errors.some((m) => /CORS_ORIGIN/.test(m)), value);
  }
});

test('EDULADDER_PUBLIC_URL kosong atau URL http(s) tanpa query', () => {
  assert.strictEqual(load({ EDULADDER_PUBLIC_URL: '' }).config.publicUrl, '');
  assert.strictEqual(load({ EDULADDER_PUBLIC_URL: 'http://192.168.1.10:3000/' }).config.publicUrl, 'http://192.168.1.10:3000');
  assert.strictEqual(load({ EDULADDER_PUBLIC_URL: 'https://contoh.id/sub/' }).config.publicUrl, 'https://contoh.id/sub');
  for (const value of ['192.168.1.10:3000', 'ftp://a.example', 'http://a.example/?x=1', 'http://a.example/#x']) {
    assert.ok(load({ EDULADDER_PUBLIC_URL: value }).errors.some((m) => /PUBLIC_URL/.test(m)), value);
  }
});

test('batas upload harus angka + kb/mb', () => {
  const { config, errors } = load({ EDULADDER_JSON_LIMIT: '3MB', EDULADDER_CSV_LIMIT: '512kb' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(config.jsonLimit, '3mb');
  assert.strictEqual(config.csvLimit, '512kb');
  assert.ok(load({ EDULADDER_JSON_LIMIT: 'abc' }).errors.some((m) => /JSON_LIMIT/.test(m)));
  assert.ok(load({ EDULADDER_CSV_LIMIT: '2' }).errors.some((m) => /CSV_LIMIT/.test(m)));
});

test('pesan gagal-cepat menyebut variabel yang bermasalah', () => {
  const { errors } = load({ PORT: 'abc', EDULADDER_PUBLIC_URL: 'nope' });
  const text = formatConfigErrors(errors);
  assert.ok(text.includes('[BERHENTI]'));
  assert.ok(text.includes('PORT'));
  assert.ok(text.includes('EDULADDER_PUBLIC_URL'));
  assert.ok(text.includes('.env.example'));
});

test('helper parsing murni bekerja sesuai kontrak', () => {
  assert.strictEqual(toInt('12'), 12);
  assert.strictEqual(toInt(''), null);
  assert.strictEqual(toInt('1.5'), null);
  assert.deepStrictEqual(parseCorsOrigin('').origin, '*');
  assert.strictEqual(parseByteLimit('2mb', '1mb').limit, '2mb');
  assert.strictEqual(normalizePublicUrl('').value, '');
});

test('masa tenggang pemain terputus: default 10 dan validasi 0-600', () => {
  assert.strictEqual(load().config.disconnectGraceSeconds, 10);
  assert.strictEqual(load({ EDULADDER_DISCONNECT_GRACE_SECONDS: '0' }).config.disconnectGraceSeconds, 0);
  assert.strictEqual(load({ EDULADDER_DISCONNECT_GRACE_SECONDS: '25' }).config.disconnectGraceSeconds, 25);
  for (const value of ['-1', '601', 'abc', '2.5']) {
    const { errors } = load({ EDULADDER_DISCONNECT_GRACE_SECONDS: value });
    assert.ok(errors.some((m) => /EDULADDER_DISCONNECT_GRACE_SECONDS/.test(m)), `${value} harus ditolak`);
  }
});
