/* Semua <script type="text/babel"> berbagi scope global; berkas ini
   dibungkus IIFE agar binding top-level tidak bentrok antar berkas. */
(function () {
  'use strict';
  const { useState, useEffect, useRef, useCallback } = React;

  const Net = window.Net;

  function App() {
    const UI = window.UI;
    const Screens = window.Screens;
    const [screen, setScreen] = useState('landing');
    const [snapshot, setSnapshot] = useState(null);
    const [question, setQuestion] = useState(null);
    const [toasts, setToasts] = useState([]);
    const [flash, setFlash] = useState(null);
    const [scoreFloats, setScoreFloats] = useState([]);
    const [, setPublicBaseVersion] = useState(0);
    const [error, setError] = useState('');
    const [adminSession, setAdminSession] = useState(() => Net.loadAdminSession());
    const [soundOn, setSoundOn] = useState(() => Net.loadPref('sfx', true));
    const [musicOn, setMusicOn] = useState(() => Net.loadPref('music', true));
    const socketRef = useRef(null);
    const boardRef = useRef(null);
    const toastIdRef = useRef(0);
    const scoreFloatIdRef = useRef(0);
    const lastJoinRef = useRef(null);

    const pushToast = useCallback((message, tone, icon) => {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev.slice(-2), { id, message, tone: tone || 'info', icon: icon || 'fa-solid fa-circle-info' }]);
      setTimeout(() => setToasts((prev) => prev.map((item) => (item.id === id ? { ...item, leaving: true } : item))), 2200);
      setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 2500);
    }, []);

    /* Buang rujukan room yang sudah tidak ada, tanpa membuang sesi login. */
    const forgetSavedRoom = useCallback(() => {
      setAdminSession((prev) => {
        if (!prev || !prev.code) return prev;
        const next = { ...prev };
        delete next.code;
        Net.saveAdminSession(next);
        return next;
      });
    }, []);

    /* Ambil URL publik untuk QR/link join sebelum lobi dirender. */
    useEffect(() => {
      const loadConfig = Net.loadServerConfig;
      if (!loadConfig) return undefined;
      let active = true;
      loadConfig()
        .then((base) => {
          if (active && base) setPublicBaseVersion((v) => v + 1);
        })
        .catch(() => {});
      return () => { active = false; };
    }, []);

    useEffect(() => {
      const socket = Net.connect();
      socketRef.current = socket;
      if (!socket) return undefined;

      const onSnapshot = (data) => {
        setSnapshot(data);
        setError('');
        setScreen((current) => (current === 'setup' || current === 'login' ? 'room' : current === 'landing' ? 'room' : current));
      };
      const onQuestion = (data) => setQuestion(data);
      const onEvents = (events) => {
        (events || []).forEach((event) => {
          if (!event) return;
          if (event.type === 'toast') pushToast(event.message, event.tone, event.icon);
          else if (event.type === 'flash') setFlash({ tone: event.tone, text: event.text, id: Date.now() + Math.random() });
          else if (event.type === 'sfx') AudioKit.sfx(event.kind, Net.loadPref('sfx', true));
          else if (event.type === 'scorePop') {
            const id = ++scoreFloatIdRef.current;
            setScoreFloats((prev) => [
              ...prev.slice(-8),
              { id, playerId: event.playerId, delta: event.delta || 0, tone: event.tone || 'neutral' },
            ]);
            setTimeout(() => setScoreFloats((prev) => prev.filter((item) => item.id !== id)), 1100);
          } else if (event.type === 'attack') {
            const board = boardRef.current;
            if (board && board.strike) board.strike(event.actorId, event.targetId, event.shielded ? 'block' : event.weapon);
          } else if (event.type === 'celebrate') {
            const board = boardRef.current;
            if (board && board.celebrate) board.celebrate(event.playerId);
          }
        });
      };
      const onToken = (data) => {
        if (!data || !data.token) return;
        Net.savePlayerToken(data.roomCode, data.token, data.playerId);
        Net.saveRoom(data.roomCode);
        /* Simpan token ke payload join agar reconnect memakai identitas yang sama. */
        lastJoinRef.current = Object.assign({}, lastJoinRef.current || {}, {
          roomCode: data.roomCode,
          token: data.token,
        });
      };
      const onError = (data) => {
        const message = data.message || 'Terjadi kesalahan.';
        setError(message);
        pushToast(message, 'bad');
        /* Room rujukan sudah tidak ada: buang tombol "Lanjutkan room". */
        if (data.code === 'not_found') forgetSavedRoom();
        if (data.code === 'unauthorized') setAdminSession(Net.loadAdminSession());
      };
      const onNotice = (data) => pushToast(data.message, 'info');

      socket.on('room:snapshot', onSnapshot);
      socket.on('question', onQuestion);
      socket.on('game:events', onEvents);
      socket.on('room:token', onToken);
      socket.on('room:error', onError);
      socket.on('room:notice', onNotice);
      socket.on('room:closed', (data) => {
        const reason = data && data.reason;
        /* Hanya penutupan yang benar-benar mengakhiri sesi. 'finished' bukan
           penutupan: layar permainan harus tetap tampil untuk popup pemenang. */
        if (reason !== 'deleted' && reason !== 'kicked' && reason !== 'closed') return;
        setSnapshot(null);
        setQuestion(null);
        lastJoinRef.current = null;
        Net.setRoomInUrl('');
        /* Room hilang: jangan simpan rujukannya lagi sebagai "lanjutkan room". */
        forgetSavedRoom();
        /* Admin yang menutup sesi kembali ke panel manajemen room; pemain ke beranda. */
        const isAdmin = Boolean(Net.loadAdminSession() && Net.loadAdminSession().token);
        setScreen((current) => {
          if (reason === 'closed' && isAdmin) return 'setup';
          return current === 'room' ? 'landing' : current;
        });
        if (reason === 'deleted') pushToast('Room dihapus oleh admin.', 'warn');
        if (reason === 'kicked') pushToast('Kamu dikeluarkan dari room.', 'warn');
        if (reason === 'closed') pushToast('Sesi permainan ditutup.', 'info');
      });

      socket.on('connect', () => {
        const last = lastJoinRef.current;
        if (!last) return;
        /* Pakai token terbaru dari localStorage (mis. setelah reload halaman). */
        if (last.asAdmin) {
          socket.emit('room:join', last);
          return;
        }
        const token = Net.loadPlayerToken(last.roomCode) || last.token;
        lastJoinRef.current = Object.assign({}, last, { token });
        socket.emit('room:join', Object.assign({}, last, { token }));
      });

      return () => {
        socket.off();
        socket.disconnect();
      };
    }, [pushToast]);

    useEffect(() => {
      if (!flash) return undefined;
      const id = flash.id;
      const timer = setTimeout(() => setFlash((current) => (current && current.id === id ? null : current)), 1500);
      return () => clearTimeout(timer);
    }, [flash]);

    useEffect(() => { Net.savePref('sfx', soundOn); }, [soundOn]);
    useEffect(() => { Net.savePref('music', musicOn); }, [musicOn]);

    useEffect(() => {
      const phase = snapshot && snapshot.state ? snapshot.state.phase : 'lobby';
      const playing = phase && !['lobby', 'finished'].includes(phase);
      if (playing && musicOn) AudioKit.startBgm();
      else AudioKit.stopBgm();
    }, [musicOn, snapshot]);

    /* Tombol "Lanjutkan room" hanya boleh muncul bila room-nya masih ada.
       Sesi admin sendiri cukup diperiksa sekali saat halaman dimuat. */
    const savedCode = adminSession && adminSession.code;
    const savedToken = adminSession && adminSession.token;
    useEffect(() => {
      if (!savedToken) return undefined;
      let active = true;
      Net.request('/api/admin/session').catch((err) => {
        if (active && err && err.status === 401) {
          Net.clearAdminSession();
          setAdminSession(null);
        }
      });
      return () => { active = false; };
    }, [savedToken]);

    useEffect(() => {
      if (!savedCode) return undefined;
      let active = true;
      Net.request(`/api/rooms/${savedCode}`).catch(() => {
        /* Room sudah dihapus (atau tidak lagi bisa diakses). */
        if (active) forgetSavedRoom();
      });
      return () => { active = false; };
    }, [savedCode, forgetSavedRoom]);

    const emit = useCallback((event, payload) => {
      const socket = socketRef.current;
      if (socket) socket.emit(event, payload);
    }, []);

    const handleJoin = (form) => {
      AudioKit.prime();
      setError('');
      lastJoinRef.current = form;
      Net.setRoomInUrl(form.roomCode);
      emit('room:join', form);
      setScreen('room');
    };

    const openRoomAsAdmin = (code) => {
      AudioKit.prime();
      const session = adminSession || {};
      if (!session.token) {
        pushToast('Sesi admin berakhir. Silakan login kembali.', 'bad');
        lastJoinRef.current = null;
        setScreen('login');
        return;
      }
      lastJoinRef.current = { roomCode: code, asAdmin: true, adminSession: session.token };
      Net.setRoomInUrl(code);
      Net.saveRoom(code);
      setAdminSession((prev) => {
        const next = { ...(prev || {}), code };
        Net.saveAdminSession(next);
        return next;
      });
      emit('room:join', { roomCode: code, asAdmin: true, adminSession: session.token });
      setScreen('room');
    };

    const resumeAdmin = (session) => {
      if (!session) return;
      if (session.code && session.token) return openRoomAsAdmin(session.code);
      setScreen('login');
    };

    const leaveRoom = () => {
      emit('room:leave');
      lastJoinRef.current = null;
      setSnapshot(null);
      setQuestion(null);
      setScreen(adminSession && adminSession.token ? 'setup' : 'landing');
      Net.setRoomInUrl('');
    };

    const logoutAdmin = () => {
      emit('room:leave');
      Net.request('/api/admin/logout', { method: 'POST' }).catch(() => {});
      Net.clearAdminSession();
      setAdminSession(null);
      lastJoinRef.current = null;
      setSnapshot(null);
      setQuestion(null);
      setScreen('landing');
      Net.setRoomInUrl('');
    };

    const adminLoggedIn = Boolean(adminSession && adminSession.token);
    const inRoom = Boolean(snapshot);
    /* Layar Tailwind: landing, login, admin, dan lobi. Game memakai styles.css. */
    const tailwindUi = !inRoom || !snapshot.state;
    useEffect(() => {
      if (tailwindUi) document.documentElement.setAttribute('data-ui', 'admin');
      else document.documentElement.removeAttribute('data-ui');
    }, [tailwindUi]);

    const content = () => {
      if (inRoom) {
        if (snapshot.state) {
          return <window.GameScreen snapshot={snapshot} question={question} emit={emit} boardRef={boardRef} scoreFloats={scoreFloats} soundOn={soundOn} setSoundOn={setSoundOn} musicOn={musicOn} setMusicOn={setMusicOn} onLeave={leaveRoom} />;
        }
        return <window.LobbyScreen snapshot={snapshot} emit={emit} onLeave={leaveRoom} />;
      }
      if (screen === 'login') {
        return <Screens.AdminLoginScreen onLoggedIn={(session) => { setAdminSession(session); setScreen('setup'); }} onBack={() => setScreen('landing')} error={error} />;
      }
      if (screen === 'setup' && adminLoggedIn) {
        return <window.AdminDashboard onOpenRoom={openRoomAsAdmin} onLogout={logoutAdmin} onExit={() => setScreen('landing')} />;
      }
      return (
        <Screens.LandingScreen
          onJoin={handleJoin}
          onSetup={() => setScreen(adminLoggedIn ? 'setup' : 'login')}
          adminSession={adminSession}
          onResumeAdmin={resumeAdmin}
          error={error}
        />
      );
    };

    return (
      <>
        <UI.Toasts toasts={toasts} />
        <UI.ResultFlash flash={flash} />
        {content()}
      </>
    );
  }

  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
})();
