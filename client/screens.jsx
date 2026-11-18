/* Semua <script type="text/babel"> berbagi scope global; berkas ini
   dibungkus IIFE agar binding top-level tidak bentrok antar berkas. */
(function () {
  'use strict';
  const { useState, useEffect, useRef } = React;

  const GE = window.GameEngine;
  const Net = window.Net;

  /* Kelas Tailwind yang dipakai layar login & admin. */
  const T = {
    page: 'min-h-screen bg-slate-100 px-6 py-12 text-slate-900',
    pageInner: 'mx-auto w-full max-w-6xl',
    card: 'rounded-xl border border-slate-200 bg-white shadow-sm',
    label: 'mb-1.5 block text-sm font-semibold text-slate-700',
    input:
      'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 ' +
      'placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200',
    btn: 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ' +
      'disabled:cursor-not-allowed disabled:opacity-50',
    btnPrimary: 'bg-indigo-600 text-white hover:bg-indigo-700',
    btnSecondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    alert: 'rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700',
  };

  /* Layar login memakai Tailwind; tandai <html> agar aturan dasar styles.css
     (ukuran font clamp, latar gradasi, reset elemen) tidak berlaku di sini. */
  function markAdminUi() {
    document.documentElement.setAttribute('data-ui', 'admin');
  }

  /* Kerangka dua kolom layar penuh untuk halaman join dan login. */
  function AuthShell({ children }) {
    return (
      <div className="grid min-h-screen w-full grid-cols-1 bg-white text-slate-900 md:grid-cols-2">
        <aside className="flex items-center gap-4 bg-slate-900 px-8 py-8 md:flex-col md:items-start md:justify-between md:px-12 md:py-14 xl:px-20">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-xl text-white">
            <i className="fa-solid fa-dice-five" aria-hidden="true"></i>
          </span>
          <p className="m-0 text-3xl font-bold leading-tight text-white md:text-5xl xl:text-6xl">
            EduLadder
            <span className="block text-indigo-400">Battle</span>
          </p>
          <span className="hidden md:block" aria-hidden="true"></span>
        </aside>

        <main className="flex items-center justify-center px-8 py-12 md:px-12 xl:px-20">
          <div className="grid w-full max-w-md gap-8">{children}</div>
        </main>
      </div>
    );
  }

  function QrCode({ text }) {
    const ref = useRef(null);
    useEffect(() => {
      if (!ref.current) return;
      ref.current.innerHTML = '';
      if (window.QRCode) {
        new window.QRCode(ref.current, { text, width: 150, height: 150, correctLevel: window.QRCode.CorrectLevel.M });
      }
    }, [text]);
    return <div className="qr-box" ref={ref} aria-label="QR untuk bergabung" />;
  }

  function LandingScreen({ onJoin, onSetup, adminSession, onResumeAdmin, error }) {
    const [code, setCode] = useState(Net.currentRoomFromUrl());
    const [name, setName] = useState(Net.loadPref('player_name', '') || '');

    const submit = (e) => {
      e.preventDefault();
      const room = code.trim().toUpperCase();
      if (!room) return;
      if (!name.trim()) return;
      Net.savePref('player_name', name.trim());
      onJoin({ roomCode: room, name: name.trim(), token: Net.loadPlayerToken(room) || undefined });
    };

    return (
      <AuthShell>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Gabung room</h2>
        </div>

        <form className="grid gap-5" onSubmit={submit}>
          <div className="grid gap-2">
            <label className={T.label} htmlFor="join-code">Kode room</label>
            <input
              id="join-code"
              className={`${T.input} font-mono uppercase tracking-widest`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              placeholder="ABC123"
              autoFocus
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <label className={T.label} htmlFor="join-name">Nama</label>
            <input id="join-name" className={T.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={18} placeholder="Nama pemain" autoComplete="nickname" />
          </div>

          {error && (
            <p className={T.alert} role="alert">
              <i className="fa-solid fa-circle-exclamation mr-2" aria-hidden="true"></i>
              {error}
            </p>
          )}

          <button type="submit" className={`${T.btn} ${T.btnPrimary} mt-1 w-full py-3`} disabled={!code.trim() || !name.trim()}>
            Gabung
          </button>
        </form>

        <div className="grid gap-3 border-t border-slate-200 pt-6">
          {adminSession && adminSession.code ? (
            <button type="button" className={`${T.btn} ${T.btnSecondary} w-full`} onClick={() => onResumeAdmin(adminSession)}>
              Lanjutkan room {adminSession.code}
            </button>
          ) : null}
          <button type="button" className={`${T.btn} ${T.btnSecondary} w-full`} onClick={onSetup}>
            <i className="fa-solid fa-user-shield" aria-hidden="true"></i> Masuk sebagai admin
          </button>
        </div>
      </AuthShell>
    );
  }

  function AdminLoginScreen({ onLoggedIn, onBack, error }) {
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(error || '');

    useEffect(() => {
      markAdminUi();
    }, []);

    const submit = (e) => {
      e.preventDefault();
      if (!password.trim() || busy) return;
      setBusy(true);
      setMessage('');
      Net.request('/api/admin/login', { method: 'POST', body: { password } })
        .then((session) => {
          const merged = Object.assign({}, Net.loadAdminSession() || {}, { token: session.token, expiresAt: session.expiresAt });
          Net.saveAdminSession(merged);
          onLoggedIn(merged);
        })
        .catch((err) => setMessage(err.message || 'Login gagal.'))
        .finally(() => setBusy(false));
    };

    return (
      <AuthShell>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Login admin</h2>
        </div>

        <form className="grid gap-5" onSubmit={submit}>
          <div className="grid gap-2">
            <label className={T.label} htmlFor="admin-password">Password</label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                className={`${T.input} pr-12`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-slate-800"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
              >
                <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true"></i>
              </button>
            </div>
          </div>

          {message && (
            <p className={T.alert} role="alert">
              <i className="fa-solid fa-circle-exclamation mr-2" aria-hidden="true"></i>
              {message}
            </p>
          )}

          <button type="submit" className={`${T.btn} ${T.btnPrimary} mt-1 w-full py-3`} disabled={busy || !password.trim()}>
            {busy ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Memeriksa
              </>
            ) : (
              'Masuk'
            )}
          </button>
        </form>

        <div className="border-t border-slate-200 pt-6">
          <button type="button" className={`${T.btn} ${T.btnSecondary} w-full`} onClick={onBack}>
            <i className="fa-solid fa-arrow-left" aria-hidden="true"></i> Kembali
          </button>
        </div>
      </AuthShell>
    );
  }

  window.Screens = { LandingScreen, AdminLoginScreen, QrCode, T };
})();
