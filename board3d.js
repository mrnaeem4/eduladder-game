/* ------------------------------------------------------------------ */
/* EduLadder Battle - papan 3D (Three.js UMD, tanpa build)             */
/* Visual saja: tidak menyimpan aturan permainan. React tetap pemilik   */
/* state. Semua animasi mengembalikan Promise.                          */
/* ------------------------------------------------------------------ */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const hasThree = () => typeof window.THREE !== 'undefined' && window.THREE;

  const BOARD_N = 10;
  const WIN_CELL = 100;
  const CELL = 1;
  const GAP = 0.06;
  const PITCH = CELL + GAP;
  const HALF = (BOARD_N * PITCH) / 2;
  const BOARD_TOP_Y = 0.08;

  const ELEVATION = (56 * Math.PI) / 180;
  const FOV = 38;

  const COLORS = {
    cellA: 0xfef3c7,
    cellB: 0xfde68a,
    ladder: 0xbbf7d0,
    snake: 0xfecdd3,
    weapon: 0xddd6fe,
    start: 0x818cf8,
    finish: 0xf59e0b,
    frame: 0x1e1b4b,
    floor: 0x0b1020,
  };

  /* Ikon pertahanan untuk lencana melayang di atas karakter. Digambar di
     canvas agar tidak butuh aset eksternal, sama seperti papan. */
  function createBadgeTexture(THREE, kind, tint) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = 104;
    const cx = size / 2;
    const cy = size / 2;

    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = tint;
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 16;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (kind === 'penawar') {
      // Botol obat: tutup + badan, plus tanda silang medis.
      ctx.beginPath();
      ctx.rect(cx - 28, cy - 78, 56, 30);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(cx - 62, cy - 44, 124, 118);
      ctx.fill();
      ctx.fillStyle = '#be123c';
      ctx.fillRect(cx - 12, cy - 10, 24, 60);
      ctx.fillRect(cx - 30, cy + 8, 60, 24);
    } else if (kind === 'locked') {
      // Gembok: badan persegi + lengkung di atasnya.
      ctx.beginPath();
      ctx.rect(cx - 56, cy - 12, 112, 88);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.arc(cx, cy - 16, 34, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(cx, cy + 20, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - 6, cy + 28, 12, 26);
    } else {
      // Perisai: bahu datar, ujung bawah meruncing.
      ctx.beginPath();
      ctx.moveTo(cx - 62, cy - 62);
      ctx.lineTo(cx + 62, cy - 62);
      ctx.lineTo(cx + 62, cy + 8);
      ctx.quadraticCurveTo(cx + 62, cy + 62, cx, cy + 84);
      ctx.quadraticCurveTo(cx - 62, cy + 62, cx - 62, cy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = tint;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 36);
      ctx.lineTo(cx, cy + 46);
      ctx.moveTo(cx - 34, cy + 4);
      ctx.lineTo(cx + 34, cy + 4);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  const BADGE_KINDS = ['shield', 'penawar', 'locked'];
  const BADGE_TINTS = { shield: '#0891b2', penawar: '#059669', locked: '#b45309' };

  /* Palet per slot; harus sama dengan PLAYER_SLOTS di app.js. */
  const SLOT_STYLES = {
    1: { form: 'robot', main: 0x2563eb, light: 0x60a5fa, deep: 0x1e3a8a, label: '#1d4ed8', ring: 0x3b82f6, accent: 0xfbbf24 },
    2: { form: 'creature', main: 0xe11d48, light: 0xfb7185, deep: 0x881337, label: '#be123c', ring: 0xf43f5e, accent: 0xf59e0b },
    3: { form: 'rocket', main: 0xf59e0b, light: 0xfbbf24, deep: 0x92400e, label: '#b45309', ring: 0xf59e0b, accent: 0xfef3c7 },
    4: { form: 'star', main: 0x059669, light: 0x34d399, deep: 0x065f46, label: '#047857', ring: 0x10b981, accent: 0xfde68a },
  };

  const DEFAULT_PLAYERS = [
    { id: 'p1', slot: 1, name: 'Pemain 1' },
    { id: 'p2', slot: 2, name: 'Pemain 2' },
  ];

  const styleFor = (slot) => SLOT_STYLES[slot] || SLOT_STYLES[1];

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function cellToXZ(cell) {
    const c = clamp(cell, 1, WIN_CELL);
    const col = (c - 1) % BOARD_N;
    const rowFromBottom = Math.floor((c - 1) / BOARD_N);
    const visualCol = rowFromBottom % 2 === 0 ? col : BOARD_N - 1 - col;
    return {
      x: (visualCol - (BOARD_N - 1) / 2) * PITCH,
      z: ((BOARD_N - 1) / 2 - rowFromBottom) * PITCH,
    };
  }

  function createNumberAtlas(THREE) {
    const size = 2048;
    const cellPx = size / BOARD_N;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, size, size);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `900 ${Math.round(cellPx * 0.46)}px "Segoe UI", "Inter", Arial, sans-serif`;

    for (let num = 1; num <= WIN_CELL; num++) {
      const acol = (num - 1) % BOARD_N;
      const arow = Math.floor((num - 1) / BOARD_N);
      const cx = acol * cellPx + cellPx / 2;
      const cy = arow * cellPx + cellPx / 2;

      ctx.lineWidth = cellPx * 0.055;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText(String(num), cx, cy);

      ctx.fillStyle = num === 1 ? '#312e81' : '#3f3208';
      if (num === WIN_CELL) ctx.fillStyle = '#7c2d12';
      ctx.fillText(String(num), cx, cy);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    texture.userData = { cols: BOARD_N, rows: BOARD_N };
    return texture;
  }

  function numberPlaneGeometry(THREE, num, baseSize) {
    const geo = new THREE.PlaneGeometry(baseSize, baseSize);
    const cols = BOARD_N;
    const rows = BOARD_N;
    const acol = (num - 1) % cols;
    const arow = Math.floor((num - 1) / rows);
    const u0 = acol / cols;
    const u1 = (acol + 1) / cols;
    const vTop = 1 - arow / rows;
    const vBottom = 1 - (arow + 1) / rows;
    // PlaneGeometry uv default: (0,1),(1,1),(0,0),(1,0)
    const uv = geo.attributes.uv;
    uv.setXY(0, u0, vTop);
    uv.setXY(1, u1, vTop);
    uv.setXY(2, u0, vBottom);
    uv.setXY(3, u1, vBottom);
    uv.needsUpdate = true;
    return geo;
  }

  function makeLabelSprite(THREE, text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const label = (text || '').trim() || 'Pemain';
    const maxTextWidth = 420;
    let fontSize = 64;
    const setFont = () => {
      ctx.font = `700 ${fontSize}px "Segoe UI", "Inter", Arial, sans-serif`;
    };
    setFont();
    while (ctx.measureText(label).width > maxTextWidth && fontSize > 28) {
      fontSize -= 4;
      setFont();
    }
    const textWidth = ctx.measureText(label).width;
    const pad = 24;
    const boxW = textWidth + pad * 2;
    const boxH = 96;
    const x = (canvas.width - boxW) / 2;
    const y = (canvas.height - boxH) / 2;
    const r = 28;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
    ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
    ctx.arcTo(x, y + boxH, x, y, r);
    ctx.arcTo(x, y, x + boxW, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    setFont();
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 3);

    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.5, 0.47, 1);
    sprite.userData.dispose = () => {
      texture.dispose();
      material.dispose();
    };
    return sprite;
  }

  function buildRobot(THREE, style) {
    const palette = style || SLOT_STYLES[1];
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: palette.main, roughness: 0.45, metalness: 0.35 });
    const visorMat = new THREE.MeshStandardMaterial({
      color: palette.light,
      emissive: palette.light,
      emissiveIntensity: 0.55,
      roughness: 0.3,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: palette.deep, roughness: 0.5, metalness: 0.4 });
    const amberMat = new THREE.MeshStandardMaterial({ color: palette.accent, emissive: palette.accent, emissiveIntensity: 0.35 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.2, 8, 18), bodyMat);
    body.position.y = 0.34;
    body.castShadow = true;
    group.add(body);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.06), visorMat);
    visor.position.set(0, 0.44, 0.14);
    visor.castShadow = true;
    group.add(visor);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), darkMat);
    antenna.position.set(0, 0.63, 0);
    group.add(antenna);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), amberMat);
    tip.position.set(0, 0.72, 0);
    group.add(tip);

    const footGeo = new THREE.BoxGeometry(0.13, 0.08, 0.18);
    [-0.09, 0.09].forEach((fx) => {
      const foot = new THREE.Mesh(footGeo, darkMat);
      foot.position.set(fx, 0.04, 0.02);
      foot.castShadow = true;
      group.add(foot);
    });

    return { group, materials: [bodyMat, visorMat, darkMat, amberMat], geometries: [body.geometry, visor.geometry, antenna.geometry, tip.geometry, footGeo] };
  }

  function buildCreature(THREE, style) {
    const palette = style || SLOT_STYLES[2];
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: palette.main, roughness: 0.55, metalness: 0.05 });
    const earMat = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: palette.deep, roughness: 0.5 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 22, 18), bodyMat);
    body.scale.set(1, 0.92, 1);
    body.position.y = 0.28;
    body.castShadow = true;
    group.add(body);

    const earGeo = new THREE.ConeGeometry(0.07, 0.18, 14);
    [-0.11, 0.11].forEach((ex) => {
      const ear = new THREE.Mesh(earGeo, earMat);
      ear.position.set(ex, 0.5, -0.02);
      ear.rotation.z = ex < 0 ? 0.35 : -0.35;
      ear.castShadow = true;
      group.add(ear);
    });

    const eyeGeo = new THREE.SphereGeometry(0.05, 12, 10);
    const pupilGeo = new THREE.SphereGeometry(0.024, 10, 8);
    [-0.08, 0.08].forEach((ex) => {
      const eye = new THREE.Mesh(eyeGeo, whiteMat);
      eye.position.set(ex, 0.34, 0.18);
      group.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, darkMat);
      pupil.position.set(ex, 0.34, 0.215);
      group.add(pupil);
    });

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 12), earMat);
    tail.position.set(0, 0.24, -0.24);
    tail.rotation.x = Math.PI / 2.1;
    group.add(tail);

    const footGeo = new THREE.SphereGeometry(0.08, 12, 10);
    [-0.1, 0.1].forEach((fx) => {
      const foot = new THREE.Mesh(footGeo, darkMat);
      foot.position.set(fx, 0.08, 0.06);
      foot.scale.set(1, 0.7, 1.2);
      foot.castShadow = true;
      group.add(foot);
    });

    return { group, materials: [bodyMat, earMat, darkMat, whiteMat], geometries: [body.geometry, earGeo, eyeGeo, pupilGeo, tail.geometry, footGeo] };
  }

  function buildRocket(THREE, style) {
    const palette = style || SLOT_STYLES[3];
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: palette.main, roughness: 0.4, metalness: 0.35 });
    const finMat = new THREE.MeshStandardMaterial({ color: palette.deep, roughness: 0.5, metalness: 0.3 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: palette.light,
      emissive: palette.light,
      emissiveIntensity: 0.65,
      roughness: 0.2,
      metalness: 0.1,
    });
    const flameMat = new THREE.MeshStandardMaterial({
      color: palette.accent,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.9,
      roughness: 0.4,
    });

    const bodyGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.36, 18);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.38;
    body.castShadow = true;
    group.add(body);

    const noseGeo = new THREE.ConeGeometry(0.13, 0.2, 18);
    const nose = new THREE.Mesh(noseGeo, bodyMat);
    nose.position.y = 0.66;
    nose.castShadow = true;
    group.add(nose);

    const windowGeo = new THREE.SphereGeometry(0.065, 16, 12);
    const port = new THREE.Mesh(windowGeo, windowMat);
    port.position.set(0, 0.44, 0.12);
    group.add(port);

    const finGeo = new THREE.BoxGeometry(0.035, 0.2, 0.17);
    [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].forEach((angle) => {
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.position.set(Math.sin(angle) * 0.15, 0.2, Math.cos(angle) * 0.15);
      fin.rotation.y = angle;
      fin.castShadow = true;
      group.add(fin);
    });

    const flameGeo = new THREE.ConeGeometry(0.085, 0.18, 14);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 0.1;
    flame.rotation.x = Math.PI;
    group.add(flame);

    const ringGeo = new THREE.TorusGeometry(0.16, 0.022, 8, 24);
    const collar = new THREE.Mesh(ringGeo, finMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.2;
    group.add(collar);

    return {
      group,
      materials: [bodyMat, finMat, windowMat, flameMat],
      geometries: [bodyGeo, noseGeo, windowGeo, finGeo, flameGeo, ringGeo],
    };
  }

  function buildStar(THREE, style) {
    const palette = style || SLOT_STYLES[4];
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: palette.main,
      emissive: palette.deep,
      emissiveIntensity: 0.25,
      roughness: 0.45,
      metalness: 0.2,
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: palette.deep, roughness: 0.5 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });

    const shape = new THREE.Shape();
    const outer = 0.24;
    const inner = 0.105;
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    }
    shape.closePath();

    const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2 });
    starGeo.center();
    const star = new THREE.Mesh(starGeo, bodyMat);
    star.position.y = 0.4;
    star.castShadow = true;
    group.add(star);

    const eyeGeo = new THREE.SphereGeometry(0.045, 12, 10);
    const pupilGeo = new THREE.SphereGeometry(0.022, 10, 8);
    [-0.075, 0.075].forEach((ex) => {
      const eye = new THREE.Mesh(eyeGeo, whiteMat);
      eye.position.set(ex, 0.44, 0.1);
      group.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, darkMat);
      pupil.position.set(ex, 0.44, 0.135);
      group.add(pupil);
    });

    const footGeo = new THREE.SphereGeometry(0.07, 12, 10);
    [-0.09, 0.09].forEach((fx) => {
      const foot = new THREE.Mesh(footGeo, trimMat);
      foot.position.set(fx, 0.15, 0.02);
      foot.scale.set(1, 0.6, 1.1);
      foot.castShadow = true;
      group.add(foot);
    });

    const haloGeo = new THREE.TorusGeometry(0.3, 0.018, 8, 32);
    const halo = new THREE.Mesh(haloGeo, trimMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.72;
    group.add(halo);

    return {
      group,
      materials: [bodyMat, trimMat, darkMat, whiteMat],
      geometries: [starGeo, eyeGeo, pupilGeo, footGeo, haloGeo],
    };
  }

  const MODEL_BUILDERS = {
    robot: buildRobot,
    creature: buildCreature,
    rocket: buildRocket,
    star: buildStar,
  };

  class Board3D {
    static supported() {
      try {
        if (!window.WebGLRenderingContext) return { ok: false, reason: 'Browser tidak mendukung WebGL.' };
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false })
          || canvas.getContext('experimental-webgl');
        if (!gl) {
          return {
            ok: false,
            reason: 'WebGL diblokir browser (akselerasi grafis nonaktif atau driver GPU bermasalah).',
          };
        }
        // Konteks uji dilepas agar tidak memakan slot konteks WebGL renderer.
        const lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        return { ok: true, reason: '' };
      } catch (error) {
        return { ok: false, reason: `Deteksi WebGL gagal: ${error && error.message ? error.message : error}` };
      }
    }

    constructor(container, options) {
      if (!hasThree()) throw new Error('Three.js tidak tersedia.');
      this.THREE = window.THREE;
      this.container = container;
      this.options = options || {};
      this.ladders = this.options.ladders || {};
      this.snakes = this.options.snakes || {};
      this.weaponCells = Array.isArray(this.options.weaponCells) ? this.options.weaponCells : [];
      this._weaponIndex = {};
      this.weaponCells.forEach((cell) => {
        const num = Number(cell);
        if (Number.isInteger(num) && num >= 1 && num <= WIN_CELL) this._weaponIndex[num] = true;
      });
      this.reducedMotion =
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

      const rawPlayers = Array.isArray(this.options.players) && this.options.players.length ? this.options.players : DEFAULT_PLAYERS;
      this.players = [];
      rawPlayers.slice(0, 4).forEach((player) => {
        const slot = Number(player && player.slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > 4) return;
        if (this.players.some((item) => item.slot === slot)) return;
        this.players.push({
          id: (player && player.id) || `p${slot}`,
          slot,
          name: ((player && player.name) || '').trim() || `Pemain ${slot}`,
        });
      });
      if (this.players.length < 2) this.players = DEFAULT_PLAYERS.map((player) => ({ ...player }));

      this.cells = {};
      this.players.forEach((player) => {
        this.cells[player.id] = 1;
      });
      this.anims = [];
      this.disposables = [];
      this.running = false;
      this.overlayPaused = false;
      this.hidden = false;
      this.lastTime = 0;
      this.elapsed = 0;
      this.camAzim = 0;
      this.camAzimTarget = 0;
      this.camDist = 20;
      this.focusId = this.players[0].id;
      this.highlight = null;

      const THREE = this.THREE;

      this.scene = new THREE.Scene();
      this.scene.background = null;

      this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 300);
      this.camera.position.set(0, 16, 11);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.domElement.className = 'board3d-canvas';
      this.container.appendChild(this.renderer.domElement);

      this._buildLights();
      this._buildFloor();
      this._buildCells();
      this._buildNumbers();
      this._buildSnakesAndLadders();
      this._buildWeaponMarkers();
      this._buildCharacters();
      this._buildMarker();

      this._onResize = () => this.resize();
      this._onVisibility = () => {
        this.hidden = document.hidden;
        if (this.hidden) this._stop();
        else this._maybeStart();
      };
      window.addEventListener('resize', this._onResize);
      document.addEventListener('visibilitychange', this._onVisibility);

      this._contextLost = (event) => {
        event.preventDefault();
        this._stop();
        if (this.options.onError) this.options.onError(new Error('Konteks WebGL hilang.'));
      };
      this._contextRestored = () => {
        this.resize();
        this._maybeStart();
      };
      this.renderer.domElement.addEventListener('webglcontextlost', this._contextLost, false);
      this.renderer.domElement.addEventListener('webglcontextrestored', this._contextRestored, false);

      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => {
          if (this._resizeTimer) clearTimeout(this._resizeTimer);
          this._resizeTimer = setTimeout(() => this.resize(), 100);
        });
        this.observer.observe(this.container);
      }

      this.resize(true);
      this.setPositions(this.options.positions || this.cells);
      this.focusTurn(this.players[0].id);
      if (this.effects) this.setEffects(this.effects);
      this._maybeStart();

      if (this.options.onReady) this.options.onReady(this);
    }

    /* ---------------- pembangunan scene ---------------- */

    _track(obj) {
      this.disposables.push(obj);
      return obj;
    }

    _buildLights() {
      const THREE = this.THREE;
      const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 0.85);
      this.scene.add(hemi);

      const dir = new THREE.DirectionalLight(0xffffff, 1.05);
      dir.position.set(8, 18, 10);
      dir.castShadow = true;
      dir.shadow.mapSize.set(2048, 2048);
      dir.shadow.camera.left = -9;
      dir.shadow.camera.right = 9;
      dir.shadow.camera.top = 9;
      dir.shadow.camera.bottom = -9;
      dir.shadow.camera.near = 1;
      dir.shadow.camera.far = 60;
      dir.shadow.bias = -0.0004;
      this.scene.add(dir);
      this.scene.add(dir.target);
      this.disposables.push(hemi, dir);

      const fill = new THREE.AmbientLight(0xffffff, 0.18);
      this.scene.add(fill);
      this.disposables.push(fill);
    }

    _buildFloor() {
      const THREE = this.THREE;
      const floorGeo = new THREE.PlaneGeometry(HALF * 4.2, HALF * 4.2);
      const floorMat = new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.95, metalness: 0.05 });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.09;
      floor.receiveShadow = true;
      this.scene.add(floor);

      const frameGeo = new THREE.BoxGeometry(HALF * 2 + 0.34, 0.14, HALF * 2 + 0.34);
      const frameMat = new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.6, metalness: 0.25 });
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.y = -0.05;
      frame.receiveShadow = true;
      frame.castShadow = true;
      this.scene.add(frame);

      this._track({ dispose: () => { floorGeo.dispose(); floorMat.dispose(); frameGeo.dispose(); frameMat.dispose(); } });
    }

    _baseColorFor(num) {
      if (num === WIN_CELL) return { color: COLORS.finish, emissive: 0xd97706, intensity: 0.35 };
      if (num === 1) return { color: COLORS.start, emissive: 0x000000, intensity: 0 };
      if (this._weaponIndex && this._weaponIndex[num]) return { color: COLORS.weapon, emissive: 0x4c1d95, intensity: 0.16 };
      if (this.ladders[num]) return { color: COLORS.ladder, emissive: 0x000000, intensity: 0 };
      if (this.snakes[num]) return { color: COLORS.snake, emissive: 0x000000, intensity: 0 };
      const col = (num - 1) % BOARD_N;
      const row = Math.floor((num - 1) / BOARD_N);
      return { color: (row + col) % 2 === 0 ? COLORS.cellA : COLORS.cellB, emissive: 0x000000, intensity: 0 };
    }

    _buildCells() {
      const THREE = this.THREE;
      this.cellMeshes = {};
      const geo = new THREE.BoxGeometry(CELL, 0.16, CELL);
      this._track({ dispose: () => geo.dispose() });

      for (let num = 1; num <= WIN_CELL; num++) {
        const { x, z } = cellToXZ(num);
        const base = this._baseColorFor(num);
        const mat = new THREE.MeshStandardMaterial({ color: base.color, emissive: base.emissive, emissiveIntensity: base.intensity, roughness: 0.85, metalness: 0.05 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, 0, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.cell = num;
        mesh.userData.baseEmissive = base.emissive;
        mesh.userData.baseIntensity = base.intensity;
        this.scene.add(mesh);
        this.cellMeshes[num] = mesh;
        this._track({ dispose: () => mat.dispose() });
      }
    }

    _buildNumbers() {
      const THREE = this.THREE;
      this.numberMaterial = new THREE.MeshBasicMaterial({ map: this.numberTexture || (this.numberTexture = createNumberAtlas(THREE)), transparent: true });
      this._track({ dispose: () => { this.numberTexture.dispose(); this.numberMaterial.dispose(); } });

      for (let num = 1; num <= WIN_CELL; num++) {
        const geo = numberPlaneGeometry(THREE, num, CELL * 0.86);
        const { x, z } = cellToXZ(num);
        const plane = new THREE.Mesh(geo, this.numberMaterial);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(x, BOARD_TOP_Y + 0.003, z);
        plane.renderOrder = 1;
        this.scene.add(plane);
        this._track({ dispose: () => geo.dispose() });
      }
    }

    _buildSnakesAndLadders() {
      const THREE = this.THREE;
      Object.keys(this.ladders).forEach((from) => this._buildLadder(Number(from), this.ladders[from]));
      Object.keys(this.snakes).forEach((head, index) => this._buildSnake(Number(head), this.snakes[head], index));
    }

    /* Ikon senjata digambar di canvas lalu ditempel sebagai bidang datar di
       atas kotak, sama seperti nomor kotak. Tanpa aset eksternal. */
    _buildWeaponMarkers() {
      const THREE = this.THREE;
      if (!this.weaponCells.length) return;
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = '#6d28d9';
      ctx.fillStyle = '#6d28d9';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      // Tanda silang senjata: dua garis bersilang seperti bidikan.
      ctx.beginPath();
      ctx.moveTo(size * 0.5, size * 0.2);
      ctx.lineTo(size * 0.5, size * 0.4);
      ctx.moveTo(size * 0.5, size * 0.6);
      ctx.lineTo(size * 0.5, size * 0.8);
      ctx.moveTo(size * 0.2, size * 0.5);
      ctx.lineTo(size * 0.4, size * 0.5);
      ctx.moveTo(size * 0.6, size * 0.5);
      ctx.lineTo(size * 0.8, size * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(size * 0.5, size * 0.5, size * 0.1, 0, Math.PI * 2);
      ctx.fill();

      const texture = new THREE.CanvasTexture(canvas);
      if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.7, depthWrite: false });
      this._track({ dispose: () => { texture.dispose(); material.dispose(); } });

      this.weaponCells.forEach((cell) => {
        const geo = new THREE.PlaneGeometry(CELL * 0.52, CELL * 0.52);
        const plane = new THREE.Mesh(geo, material);
        const { x, z } = cellToXZ(cell);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(x, BOARD_TOP_Y + 0.004, z);
        plane.renderOrder = 2;
        this.scene.add(plane);
        this._track({ dispose: () => geo.dispose() });
      });
    }

    _buildLadder(from, to) {
      const THREE = this.THREE;
      const a = cellToXZ(from);
      const b = cellToXZ(to);
      // Angkat di atas permukaan kotak agar rel tidak terpotong z-fighting
      // dengan bidang atas kotak (dulu hanya tangga di atas celah yang utuh).
      const lift = BOARD_TOP_Y + 0.14;
      const start = new THREE.Vector3(a.x, lift, a.z);
      const end = new THREE.Vector3(b.x, lift, b.z);
      const dir = new THREE.Vector3().subVectors(end, start);
      const length = dir.length();
      const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());

      const group = new THREE.Group();
      group.position.copy(mid);
      group.quaternion.copy(quat);

      const railMat = new THREE.MeshStandardMaterial({ color: 0xa16207, roughness: 0.5, metalness: 0.45 });
      const rungMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.45, metalness: 0.5 });
      const glowMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, emissive: 0xfacc15, emissiveIntensity: 0.65, roughness: 0.4 });

      const half = CELL * 0.2;
      const railGeo = new THREE.BoxGeometry(0.07, length, 0.07);
      [-half, half].forEach((rx) => {
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(rx, 0, 0);
        rail.castShadow = true;
        group.add(rail);
      });

      const rungCount = Math.max(3, Math.round(length / (CELL / 2.1)));
      const rungGeo = new THREE.BoxGeometry(half * 2 + 0.07, 0.05, 0.05);
      const rungSpan = length;
      for (let i = 1; i < rungCount; i++) {
        const rung = new THREE.Mesh(rungGeo, rungMat);
        rung.position.set(0, -rungSpan / 2 + (rungSpan * i) / rungCount, 0);
        rung.castShadow = true;
        group.add(rung);
      }

      const ringGeo = new THREE.TorusGeometry(0.22, 0.045, 10, 24);
      const ring = new THREE.Mesh(ringGeo, glowMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, length / 2, 0);
      group.add(ring);

      this.scene.add(group);
      this._track({
        dispose: () => {
          railGeo.dispose(); rungGeo.dispose(); ringGeo.dispose();
          railMat.dispose(); rungMat.dispose(); glowMat.dispose();
        },
      });
    }

    _buildSnake(head, tail, index) {
      const THREE = this.THREE;
      const a = cellToXZ(head);
      const b = cellToXZ(tail);
      const start = new THREE.Vector3(a.x, BOARD_TOP_Y + 0.1, a.z);
      const end = new THREE.Vector3(b.x, BOARD_TOP_Y + 0.02, b.z);
      const dir = new THREE.Vector3().subVectors(end, start);
      const length = dir.length();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      const amp = Math.min(length * 0.16, CELL * 0.7);

      const pts = [];
      const segments = 6;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const wave = Math.sin(t * Math.PI * 2.4 + index) * amp * Math.sin(t * Math.PI);
        const p = new THREE.Vector3().lerpVectors(start, end, t).addScaledVector(perp, wave);
        p.y += Math.sin(t * Math.PI) * 0.28;
        pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const color = index % 2 === 0 ? 0xbe123c : 0x7e22ce;
      const dark = new THREE.MeshStandardMaterial({ color: 0x450a0a, roughness: 0.6 });
      const tailMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
      const headMat = new THREE.MeshStandardMaterial({ color: 0xfb7185, roughness: 0.45 });
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 });
      const pupilMat = new THREE.MeshStandardMaterial({ color: 0x450a0a, roughness: 0.4 });

      const bodyGeo = new THREE.TubeGeometry(curve, 42, 0.13, 12, false);
      const body = new THREE.Mesh(bodyGeo, tailMat);
      body.castShadow = true;
      this.scene.add(body);

      const headPos = curve.getPoint(0);
      const headDir = curve.getTangent(0);
      const headGeo = new THREE.SphereGeometry(0.24, 18, 14);
      const headMesh = new THREE.Mesh(headGeo, headMat);
      headMesh.position.copy(headPos);
      headMesh.position.y += 0.06;
      headMesh.scale.set(1, 0.9, 1.25);
      headMesh.castShadow = true;
      this.scene.add(headMesh);

      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(headDir, up).normalize();
      const eyeGeo = new THREE.SphereGeometry(0.05, 10, 8);
      const pupilGeo = new THREE.SphereGeometry(0.025, 10, 8);
      [-1, 1].forEach((s) => {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.copy(headPos).addScaledVector(side, 0.11).addScaledVector(headDir, 0.14);
        eye.position.y += 0.12;
        this.scene.add(eye);
        const pupil = new THREE.Mesh(pupilGeo, pupilMat);
        pupil.position.copy(eye.position).addScaledVector(headDir, 0.03);
        this.scene.add(pupil);
      });

      const tongueGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6);
      const tongue = new THREE.Mesh(tongueGeo, dark);
      tongue.position.copy(headPos).addScaledVector(headDir, 0.3);
      tongue.position.y += 0.04;
      tongue.rotation.z = Math.PI / 2;
      tongue.lookAt(headPos.clone().addScaledVector(headDir, 1));
      this.scene.add(tongue);

      this._track({
        dispose: () => {
          bodyGeo.dispose(); headGeo.dispose(); eyeGeo.dispose(); pupilGeo.dispose(); tongueGeo.dispose();
          dark.dispose(); tailMat.dispose(); headMat.dispose(); eyeMat.dispose(); pupilMat.dispose();
        },
      });
    }

    _buildCharacters() {
      const THREE = this.THREE;
      const total = Math.max(1, this.players.length);

      const makeChar = (player, model, style, index) => {
        const root = new THREE.Group();
        const bob = new THREE.Group();
        bob.add(model.group);
        root.add(bob);

        const label = makeLabelSprite(THREE, player.name, style.label);
        label.position.set(0, 0.95, 0);
        root.add(label);

        const ringGeo = new THREE.RingGeometry(0.28, 0.38, 28);
        const ringMat = new THREE.MeshBasicMaterial({ color: style.ring, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        ring.visible = false;
        root.add(ring);

        // Lencana melayang untuk pertahanan aktif (Shield / Penawar).
        const badges = {};
        BADGE_KINDS.forEach((kind, badgeIndex) => {
          const tex = createBadgeTexture(THREE, kind, BADGE_TINTS[kind]);
          const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
          const sprite = new THREE.Sprite(mat);
          sprite.scale.set(0.34, 0.34, 1);
          const spread = (badgeIndex - (BADGE_KINDS.length - 1) / 2) * 0.2;
          sprite.position.set(spread, 0.98, 0);
          sprite.visible = false;
          sprite.userData.baseY = 0.98;
          sprite.userData.phase = badgeIndex * Math.PI;
          root.add(sprite);
          this._track({ dispose: () => { tex.dispose(); mat.dispose(); } });
          badges[kind] = sprite;
        });

        this.scene.add(root);
        this.disposables.push({
          dispose: () => {
            (model.materials || []).forEach((material) => material.dispose());
            (model.geometries || []).forEach((geometry) => geometry.dispose());
          },
        });
        this._track({ dispose: () => { ringGeo.dispose(); ringMat.dispose(); if (label.userData.dispose) label.userData.dispose(); } });

        return {
          root,
          bob,
          model,
          label,
          ring,
          badges,
          pos: { x: 0, z: 0 },
          phase: (index / total) * Math.PI * 2,
          cell: 1,
        };
      };

      this.chars = {};
      this.players.forEach((player, index) => {
        const style = styleFor(player.slot);
        const builder = MODEL_BUILDERS[style.form] || buildRobot;
        this.chars[player.id] = makeChar(player, builder(THREE, style), style, index);
      });
    }

    _buildMarker() {
      const THREE = this.THREE;
      const geo = new THREE.RingGeometry(CELL * 0.32, CELL * 0.44, 32);
      const mat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = BOARD_TOP_Y + 0.02;
      ring.visible = false;
      this.scene.add(ring);
      this.marker = ring;
      this._track({ dispose: () => { geo.dispose(); mat.dispose(); } });
    }

    /* ---------------- posisi ---------------- */

    _occupants(cell) {
      return this.players.filter((player) => this.cells[player.id] === cell).map((player) => player.id);
    }

    _offsetFor(id, cell) {
      const occupants = this._occupants(cell);
      const count = occupants.length;
      if (count <= 1) return { dx: 0, dz: 0 };
      const index = Math.max(0, occupants.indexOf(id));
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
      const radius = 0.3;
      return { dx: Math.cos(angle) * radius, dz: Math.sin(angle) * radius };
    }

    _placeAt(id, instant) {
      const ch = this.chars[id];
      if (!ch) return;
      const cell = this.cells[id];
      const { x, z } = cellToXZ(cell);
      const off = this._offsetFor(id, cell);
      const tx = x + off.dx;
      const tz = z + off.dz;
      const shared = this._occupants(cell).length > 1;
      ch.model.group.scale.setScalar(shared ? 0.68 : 1);
      if (instant) {
        ch.root.position.set(tx, BOARD_TOP_Y, tz);
      } else {
        ch.root.position.x = tx;
        ch.root.position.z = tz;
        ch.root.position.y = BOARD_TOP_Y;
        ch.bob.scale.set(1, 1, 1);
      }
      ch.pos = { x: tx, z: tz };
    }

    _reflowCell(cell, instant) {
      this._occupants(cell).forEach((id) => this._placeAt(id, instant));
    }

    placeCharacter(id, instant) {
      this._placeAt(id, instant);
    }

    setPositions(positions) {
      if (!positions) return;
      this.players.forEach((player) => {
        const value = positions[player.id];
        if (typeof value === 'number') this.cells[player.id] = clamp(Math.round(value), 1, WIN_CELL);
      });
      const touched = new Set(this.players.map((player) => this.cells[player.id]));
      touched.forEach((cell) => this._reflowCell(cell, true));
    }

    /* ---------------- animasi ---------------- */

    _animate(duration, onUpdate, ease) {
      const easing = ease || easeOutCubic;
      return new Promise((resolve) => {
        this.anims.push({ t: 0, duration, onUpdate, resolve, ease: easing });
      });
    }

    hop(id, path, opts) {
      const steps = Array.isArray(path) ? path.filter((c) => typeof c === 'number') : [];
      if (!steps.length) return Promise.resolve();
      if (this.reducedMotion) return this._quickMove(id, steps);

      const ch = this.chars[id];
      if (!ch) return Promise.resolve();
      const perStep = clamp(0.26 - (steps.length - 1) * 0.012, 0.1, 0.26);
      const shield = Boolean(opts && opts.shield);

      let chain = Promise.resolve();
      let previousCell = this.cells[id];
      steps.forEach((cell) => {
        chain = chain.then(() => {
          const from = { x: ch.root.position.x, z: ch.root.position.z };
          this.cells[id] = cell;
          const target = cellToXZ(cell);
          const off = this._offsetFor(id, cell);
          const to = { x: target.x + off.dx, z: target.z + off.dz };
          return this._animate(perStep, (k) => {
            const arc = Math.sin(Math.PI * k) * 0.36;
            ch.root.position.x = from.x + (to.x - from.x) * k;
            ch.root.position.z = from.z + (to.z - from.z) * k;
            ch.root.position.y = BOARD_TOP_Y + arc;
            const squash = 1 + Math.sin(Math.PI * k) * 0.14;
            ch.bob.scale.set(squash, 2 - squash, squash);
          }).then(() => {
            ch.bob.scale.set(1, 1, 1);
            this._reflowCell(previousCell);
            this._reflowCell(cell);
            previousCell = cell;
          });
        });
      });
      if (shield) chain = chain.then(() => this._flashShield(id));
      return chain;
    }

    _quickMove(id, steps) {
      const ch = this.chars[id];
      if (!ch) return Promise.resolve();
      const previousCell = this.cells[id];
      const from = { x: ch.root.position.x, z: ch.root.position.z };
      const cell = steps[steps.length - 1];
      this.cells[id] = cell;
      const target = cellToXZ(cell);
      const off = this._offsetFor(id, cell);
      const to = { x: target.x + off.dx, z: target.z + off.dz };
      ch.ring.visible = false;
      return this._animate(0.28, (k) => {
        ch.root.position.x = from.x + (to.x - from.x) * k;
        ch.root.position.z = from.z + (to.z - from.z) * k;
      }, easeInOutCubic).then(() => {
        this._reflowCell(previousCell);
        this._reflowCell(cell);
      });
    }

    slide(id, from, to, type) {
      const ch = this.chars[id];
      if (!ch) return Promise.resolve();
      const previousCell = this.cells[id];
      this.cells[id] = to;
      const start = { x: ch.root.position.x, z: ch.root.position.z };
      const toXZ = cellToXZ(to);
      const off = this._offsetFor(id, to);
      const end = { x: toXZ.x + off.dx, z: toXZ.z + off.dz };

      if (this.reducedMotion) {
        ch.ring.visible = false;
        return this._animate(0.3, (k) => {
          ch.root.position.x = start.x + (end.x - start.x) * k;
          ch.root.position.z = start.z + (end.z - start.z) * k;
        }).then(() => {
          this._reflowCell(previousCell);
          this._reflowCell(to);
        });
      }

      // arah hadap menuju ujung (tangga/ular)
      const heading = Math.atan2(end.x - start.x, end.z - start.z);
      const startRot = ch.root.rotation.y;
      let delta = heading - startRot;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const duration = clamp(0.55 + Math.hypot(end.x - start.x, end.z - start.z) * 0.045, 0.6, 1.1);

      return this._animate(
        duration,
        (k) => {
          ch.root.position.x = start.x + (end.x - start.x) * k;
          ch.root.position.z = start.z + (end.z - start.z) * k;
          const climb = type === 'ladder' ? k : 0;
          ch.root.position.y = BOARD_TOP_Y + Math.sin(Math.PI * k) * (type === 'ladder' ? 0.22 : 0.3) - climb * 0.02;
          ch.root.rotation.y = startRot + delta * k;
          const spin = type === 'snake' ? Math.sin(k * Math.PI * 3) * 0.18 : 0;
          ch.bob.rotation.z = spin;
        },
        easeInOutCubic
      ).then(() => {
        ch.bob.rotation.z = 0;
        ch.root.rotation.y = heading;
        this._reflowCell(previousCell);
        this._reflowCell(to);
      });
    }

    _flashShield(id) {
      const THREE = this.THREE;
      const ch = this.chars[id];
      if (!ch) return Promise.resolve();
      const geo = new THREE.SphereGeometry(0.42, 20, 16);
      const mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.42, wireframe: true });
      const shell = new THREE.Mesh(geo, mat);
      shell.position.set(ch.root.position.x, 0.34, ch.root.position.z);
      this.scene.add(shell);
      return this._animate(0.6, (k) => {
        const s = 0.6 + k * 0.9;
        shell.scale.set(s, s, s);
        mat.opacity = 0.5 * (1 - k);
      }).then(() => {
        this.scene.remove(shell);
        geo.dispose();
        mat.dispose();
      });
    }

    /* Efek serangan senjata. Visual saja; posisi akhir tetap diatur React
       lewat setPositions setelah Promise ini selesai. `kind`: bomb, magnet,
       portal, trap, block. */
    strike(actorId, targetId, kind) {
      const THREE = this.THREE;
      const ch = this.chars[targetId];
      if (!ch) return Promise.resolve();
      if (this.reducedMotion) return Promise.resolve();

      const hex = kind === 'trap' ? 0x14b8a6 : kind === 'portal' ? 0x8b5cf6 : kind === 'magnet' ? 0xf43f5e : kind === 'block' ? 0x38bdf8 : 0xf97316;
      const geo = new THREE.RingGeometry(0.2, 0.42, 28);
      const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(ch.root.position.x, BOARD_TOP_Y + 0.03, ch.root.position.z);
      this.scene.add(ring);

      const shake = kind === 'block' ? 0.02 : 0.06;
      const baseY = ch.root.position.y;

      return this._animate(0.7, (k) => {
        const s = 0.7 + k * 2.1;
        ring.scale.set(s, s, s);
        mat.opacity = 0.9 * (1 - k);
        ch.root.position.y = baseY + Math.sin(k * Math.PI * 6) * shake * (1 - k);
      }).then(() => {
        ch.root.position.y = baseY;
        this.scene.remove(ring);
        geo.dispose();
        mat.dispose();
      });
    }

    /* Pertahanan aktif per pemain, ditampilkan sebagai lencana melayang di
       atas karakter. `status` berbentuk { [playerId]: ['shield','locked'] }.
       Dipanggil React setiap status berubah; tidak memengaruhi aturan. */
    setEffects(status) {
      const map = status && typeof status === 'object' ? status : {};
      this.effects = map;
      Object.keys(this.chars || {}).forEach((id) => {
        const kinds = Array.isArray(map[id]) ? map[id] : map[id] ? [map[id]] : [];
        const ch = this.chars[id];
        BADGE_KINDS.forEach((kind) => {
          const badge = ch.badges && ch.badges[kind];
          if (!badge) return;
          badge.visible = kinds.indexOf(kind) >= 0;
        });
      });
      // Papan bisa sedang di-pause (overlay soal terbuka) saat status berubah.
      if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    }

    focusTurn(id) {
      this.focusId = id;
      const total = this.players.length;
      const index = this.players.findIndex((player) => player.id === id);
      this.camAzimTarget = total > 1 ? (index / (total - 1) - 0.5) * 0.06 : 0;
      Object.keys(this.chars).forEach((key) => {
        this.chars[key].ring.visible = key === id;
      });
    }

    highlightCell(cell) {
      if (cell === null || cell === undefined) {
        this.highlight = null;
        if (this.marker) this.marker.visible = false;
        this._resetCellGlow();
        return;
      }
      this.highlight = cell;
      const { x, z } = cellToXZ(cell);
      if (this.marker) {
        this.marker.position.set(x, BOARD_TOP_Y + 0.02, z);
        this.marker.visible = true;
      }
    }

    _resetCellGlow() {
      if (!this.cellMeshes) return;
      Object.keys(this.cellMeshes).forEach((num) => {
        const mesh = this.cellMeshes[num];
        mesh.material.emissive.setHex(mesh.userData.baseEmissive);
        mesh.material.emissiveIntensity = mesh.userData.baseIntensity;
      });
    }

    celebrate(id) {
      const THREE = this.THREE;
      const fallbackId = this.players[0] && this.players[0].id;
      const ch = this.chars[id] || (fallbackId && this.chars[fallbackId]) || Object.values(this.chars || {})[0];
      if (!ch) return Promise.resolve();
      const count = 140;
      const positions = new Float32Array(count * 3);
      const velocities = [];
      const colors = [0xfbbf24, 0x22c55e, 0x3b82f6, 0xf43f5e, 0xa855f7, 0xffffff];

      for (let i = 0; i < count; i++) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;
        velocities.push({
          x: (Math.random() - 0.5) * 6,
          y: 3 + Math.random() * 5,
          z: (Math.random() - 0.5) * 6,
        });
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({ size: 0.13, vertexColors: false, color: 0xfbbf24, transparent: true, opacity: 1 });
      const points = new THREE.Points(geo, mat);
      points.position.set(ch.root.position.x, 0.6, ch.root.position.z);
      this.scene.add(points);

      return this._animate(2.6, (k) => {
        const pos = geo.attributes.position.array;
        for (let i = 0; i < count; i++) {
          const v = velocities[i];
          pos[i * 3] = v.x * k;
          pos[i * 3 + 1] = Math.max(0.1, v.y * k - 4.9 * k * k * 1.4);
          pos[i * 3 + 2] = v.z * k;
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = 1 - Math.max(0, (k - 0.5) * 2);
        mat.color.setHex(colors[Math.floor(k * colors.length) % colors.length]);
      }).then(() => {
        this.scene.remove(points);
        geo.dispose();
        mat.dispose();
      });
    }

    /* ---------------- loop & resize ---------------- */

    pause() {
      this.overlayPaused = true;
      this._stop();
    }

    resume() {
      this.overlayPaused = false;
      this._maybeStart();
    }

    _maybeStart() {
      if (this.hidden || this.overlayPaused) return;
      this._start();
    }

    _start() {
      if (this.running) return;
      this.running = true;
      this.lastTime = 0;
      const step = (now) => {
        if (!this.running) return;
        const seconds = now / 1000;
        const dt = this.lastTime ? Math.min(0.05, seconds - this.lastTime) : 0.016;
        this.lastTime = seconds;
        this.elapsed += dt;
        this._update(dt);
        this.renderer.render(this.scene, this.camera);
        this._frame = requestAnimationFrame(step);
      };
      this._frame = requestAnimationFrame(step);
    }

    _stop() {
      this.running = false;
      if (this._frame) cancelAnimationFrame(this._frame);
      this._frame = null;
    }

    _update(dt) {
      const THREE = this.THREE;

      // animasi aktif
      for (let i = this.anims.length - 1; i >= 0; i--) {
        const item = this.anims[i];
        item.t += dt;
        const raw = item.duration > 0 ? clamp(item.t / item.duration, 0, 1) : 1;
        item.onUpdate(item.ease(raw));
        if (raw >= 1) {
          this.anims.splice(i, 1);
          item.resolve();
        }
      }

      // idle bob
      Object.keys(this.chars).forEach((team) => {
        const ch = this.chars[team];
        ch.bob.position.y = Math.sin(this.elapsed * 2 + ch.phase) * 0.03;
      });

      // lencana pertahanan melayang naik-turun di atas kepala
      Object.keys(this.chars).forEach((team) => {
        const ch = this.chars[team];
        if (!ch.badges) return;
        BADGE_KINDS.forEach((kind) => {
          const badge = ch.badges[kind];
          if (!badge || !badge.visible) return;
          const phase = badge.userData.phase || 0;
          const wave = Math.sin(this.elapsed * 2.4 + phase);
          badge.position.y = badge.userData.baseY + wave * 0.06;
          const s = 0.34 + wave * 0.02;
          badge.scale.set(s, s, 1);
        });
      });

      // lean kamera
      this.camAzim += (this.camAzimTarget - this.camAzim) * Math.min(1, dt * 3);
      const dir = new THREE.Vector3(
        Math.cos(ELEVATION) * Math.sin(this.camAzim),
        Math.sin(ELEVATION),
        Math.cos(ELEVATION) * Math.cos(this.camAzim)
      );
      this.camera.position.copy(dir.multiplyScalar(this.camDist));
      this.camera.lookAt(0, 0, 0);

      // marker pulse
      if (this.marker && this.marker.visible) {
        const s = 1 + Math.sin(this.elapsed * 5) * 0.08;
        this.marker.scale.set(s, s, s);
        this.marker.material.opacity = 0.55 + Math.sin(this.elapsed * 5) * 0.25;
      }

      // glow kotak highlight
      if (this.highlight && this.cellMeshes && this.cellMeshes[this.highlight]) {
        const mesh = this.cellMeshes[this.highlight];
        mesh.material.emissive.setHex(0xfacc15);
        mesh.material.emissiveIntensity = 0.35 + Math.sin(this.elapsed * 5) * 0.25;
      }

      // ring tim aktif
      Object.keys(this.chars).forEach((team) => {
        const ch = this.chars[team];
        if (ch.ring.visible) {
          const s = 1 + Math.sin(this.elapsed * 3.5) * 0.07;
          ch.ring.scale.set(s, s, s);
        }
      });
    }

    resize(initial) {
      const width = Math.max(1, this.container.clientWidth || window.innerWidth);
      const height = Math.max(1, this.container.clientHeight || window.innerHeight);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this._fitCamera();
      if (initial) {
        this.renderer.render(this.scene, this.camera);
      } else if (!this.running) {
        this.renderer.render(this.scene, this.camera);
      }
    }

    _boardBounds() {
      const margin = 0.34;
      const half = HALF + margin;
      return [
        new this.THREE.Vector3(-half, -0.02, -half),
        new this.THREE.Vector3(half, -0.02, -half),
        new this.THREE.Vector3(-half, -0.02, half),
        new this.THREE.Vector3(half, -0.02, half),
        new this.THREE.Vector3(-half, 1.05, -half),
        new this.THREE.Vector3(half, 1.05, -half),
        new this.THREE.Vector3(-half, 1.05, half),
        new this.THREE.Vector3(half, 1.05, half),
      ];
    }

    _fitCamera() {
      const THREE = this.THREE;
      const corners = this._boardBounds();
      const target = new THREE.Vector3(0, 0, 0);
      let dist = 18;

      for (let iter = 0; iter < 5; iter++) {
        const dir = new THREE.Vector3(
          Math.cos(ELEVATION) * Math.sin(this.camAzimTarget),
          Math.sin(ELEVATION),
          Math.cos(ELEVATION) * Math.cos(this.camAzimTarget)
        );
        this.camera.position.copy(target).addScaledVector(dir, dist);
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld();
        const vp = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
        let maxX = 0;
        let maxY = 0;
        corners.forEach((corner) => {
          const p = corner.clone().applyMatrix4(vp);
          maxX = Math.max(maxX, Math.abs(p.x));
          maxY = Math.max(maxY, Math.abs(p.y));
        });
        const scale = Math.max(maxX / 0.96, maxY / 0.94);
        if (!Number.isFinite(scale) || scale <= 0) break;
        dist *= clamp(scale, 0.5, 2);
      }

      this.camDist = dist;
      const dir = new THREE.Vector3(
        Math.cos(ELEVATION) * Math.sin(this.camAzim),
        Math.sin(ELEVATION),
        Math.cos(ELEVATION) * Math.cos(this.camAzim)
      );
      this.camera.position.copy(dir.multiplyScalar(this.camDist));
      this.camera.lookAt(0, 0, 0);
    }

    dispose() {
      this._stop();
      window.removeEventListener('resize', this._onResize);
      document.removeEventListener('visibilitychange', this._onVisibility);
      if (this.observer) this.observer.disconnect();
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      if (this.renderer) {
        this.renderer.domElement.removeEventListener('webglcontextlost', this._contextLost, false);
        this.renderer.domElement.removeEventListener('webglcontextrestored', this._contextRestored, false);
      }
      (this.disposables || []).forEach((item) => {
        if (!item) return;
        if (item.dispose) item.dispose();
      });
      this.disposables = [];
      if (this.anims) {
        this.anims.forEach((item) => item.resolve());
        this.anims = [];
      }
      if (this.renderer) {
        this.renderer.dispose();
        if (this.renderer.domElement && this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
      }
      this.renderer = null;
      this.scene = null;
      this.camera = null;
    }
  }

  window.Board3D = Board3D;
})();
