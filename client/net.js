/* Lapisan jaringan klien: Socket.IO + REST + penyimpanan lokal. */
window.Net = (function () {
  const socket = window.io
    ? window.io({ autoConnect: false, transports: ['websocket', 'polling'] })
    : null;

  /* Basis URL publik untuk QR/link join, dikirim server lewat /api/config.
     Di-cache di localStorage agar QR benar sejak render pertama. */
  const PUBLIC_URL_KEY = 'eduladder_public_url';
  let PUBLIC_BASE = (function () {
    try {
      return localStorage.getItem(PUBLIC_URL_KEY) || '';
    } catch (error) {
      return '';
    }
  })();

  function setPublicBase(value) {
    PUBLIC_BASE = typeof value === 'string' && value.trim() ? value.trim().replace(/\/+$/, '') : '';
    try {
      if (PUBLIC_BASE) localStorage.setItem(PUBLIC_URL_KEY, PUBLIC_BASE);
      else localStorage.removeItem(PUBLIC_URL_KEY);
    } catch (error) {
      /* localStorage bisa diblokir; abaikan. */
    }
    return PUBLIC_BASE;
  }

  /* Ambil konfigurasi publik dari server. Mengembalikan nilai terbaru. */
  function loadServerConfig() {
    return fetch('/api/config', { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setPublicBase(data && data.publicUrl ? data.publicUrl : ''))
      .catch(() => PUBLIC_BASE);
  }

  /* Selisih jam server dan klien (serverNow - Date.now()). Deadline dibuat
     dengan jam server, jadi countdown harus menghitung terhadap jam yang sama.
     Disimpan sebagai median beberapa sampel terakhir agar lonjakan latensi
     tidak membuat angka melompat. */
  const MAX_OFFSET_SAMPLES = 5;
  const MAX_PLAUSIBLE_OFFSET = 5 * 60 * 1000;
  let clockOffset = 0;
  let offsetSamples = [];

  function resetOffset() {
    clockOffset = 0;
    offsetSamples = [];
  }

  /* Murni: hitung offset dari satu pasangan jam server + jam klien. */
  function computeOffset(serverNow, clientNow) {
    const server = Number(serverNow);
    const client = Number(clientNow);
    if (!Number.isFinite(server) || !Number.isFinite(client)) return null;
    return server - client;
  }

  function trackServerNow(serverNow) {
    const offset = computeOffset(serverNow, Date.now());
    if (offset === null) return clockOffset;
    /* Jam perangkat meleset ekstrem: abaikan dan andalkan sisa relatif. */
    if (Math.abs(offset) > MAX_PLAUSIBLE_OFFSET) {
      resetOffset();
      return clockOffset;
    }
    offsetSamples.push(offset);
    if (offsetSamples.length > MAX_OFFSET_SAMPLES) offsetSamples.shift();
    const sorted = offsetSamples.slice().sort((a, b) => a - b);
    clockOffset = sorted[Math.floor(sorted.length / 2)];
    return clockOffset;
  }

  function getClockOffset() {
    return clockOffset;
  }

  function connect() {
    if (!socket) return null;
    if (!socket.connected) socket.connect();
    return socket;
  }

  function request(path, options) {
    const opts = options || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const adminSession = loadAdminSession();
    if (adminSession && adminSession.token) headers.Authorization = `Bearer ${adminSession.token}`;
    return fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then((response) =>
      response
        .json()
        .catch(() => ({}))
        .then((data) => {
          if (!response.ok) {
            const error = new Error((data && data.message) || `HTTP ${response.status}`);
            error.status = response.status;
            error.data = data;
            throw error;
          }
          return data;
        })
    );
  }

  /* Unduh berkas dari endpoint admin (mis. CSV jawaban). Mengembalikan
     Promise<string> berisi nama berkas yang dipakai. */
  function downloadFile(path, fallbackName) {
    const headers = {};
    const adminSession = loadAdminSession();
    if (adminSession && adminSession.token) headers.Authorization = `Bearer ${adminSession.token}`;
    return fetch(path, { headers })
      .then((response) => {
        if (!response.ok) {
          return response
            .json()
            .catch(() => ({}))
            .then((data) => {
              const error = new Error((data && data.message) || `HTTP ${response.status}`);
              error.status = response.status;
              error.data = data;
              throw error;
            });
        }
        const disposition = response.headers.get('content-disposition') || '';
        const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
        const plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
        let name = fallbackName || 'unduhan.csv';
        if (utfMatch) {
          try { name = decodeURIComponent(utfMatch[1]); } catch (error) { /* pakai fallback */ }
        } else if (plainMatch) {
          name = plainMatch[1];
        }
        return response.blob().then((blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          return name;
        });
      });
  }

  function roomKey(code, suffix) {
    return `eduladder_${suffix}_${String(code || '').toUpperCase()}`;
  }

  function savePlayerToken(code, token, playerId) {
    try {
      localStorage.setItem(roomKey(code, 'token'), token);
      if (playerId) localStorage.setItem(roomKey(code, 'player'), playerId);
    } catch (error) {
      /* localStorage bisa diblokir; abaikan. */
    }
  }

  function loadPlayerToken(code) {
    try {
      return localStorage.getItem(roomKey(code, 'token'));
    } catch (error) {
      return null;
    }
  }

  function saveAdminSession(session) {
    try {
      localStorage.setItem('eduladder_admin', JSON.stringify(session));
    } catch (error) {
      /* abaikan */
    }
  }

  function loadAdminSession() {
    try {
      const raw = localStorage.getItem('eduladder_admin');
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function clearAdminSession() {
    try {
      localStorage.removeItem('eduladder_admin');
    } catch (error) {
      /* abaikan */
    }
  }

  function saveRoom(code) {
    try {
      const list = loadRooms();
      if (!list.includes(code)) list.unshift(code);
      localStorage.setItem('eduladder_rooms', JSON.stringify(list.slice(0, 20)));
    } catch (error) {
      /* abaikan */
    }
  }

  function loadRooms() {
    try {
      const raw = localStorage.getItem('eduladder_rooms');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function loadPref(key, fallback) {
    try {
      const raw = localStorage.getItem(`eduladder_${key}`);
      if (raw === null) return fallback;
      return raw === 'true' ? true : raw === 'false' ? false : raw;
    } catch (error) {
      return fallback;
    }
  }

  function savePref(key, value) {
    try {
      localStorage.setItem(`eduladder_${key}`, String(value));
    } catch (error) {
      /* abaikan */
    }
  }

  function currentRoomFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return (params.get('room') || '').toUpperCase();
    } catch (error) {
      return '';
    }
  }

  function setRoomInUrl(code) {
    try {
      const url = new URL(window.location.href);
      if (code) url.searchParams.set('room', code);
      else url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    } catch (error) {
      /* abaikan */
    }
  }

  function joinUrl(code) {
    const url = PUBLIC_BASE ? new URL(PUBLIC_BASE.replace(/\/+$/, '') + '/') : new URL(window.location.href);
    url.pathname = '/';
    url.search = `?room=${encodeURIComponent(code)}`;
    return url.toString();
  }

  return {
    socket,
    connect,
    request,
    downloadFile,
    loadServerConfig,
    computeOffset,
    trackServerNow,
    getClockOffset,
    resetClockOffset: resetOffset,
    savePlayerToken,
    loadPlayerToken,
    saveAdminSession,
    loadAdminSession,
    clearAdminSession,
    saveRoom,
    loadRooms,
    loadPref,
    savePref,
    currentRoomFromUrl,
    setRoomInUrl,
    joinUrl,
  };
})();
