/* ------------------------------------------------------------------ */
/* EduLadder Battle - podium 3D (Three.js UMD, tanpa build)            */
/* Visual saja: peringkat dihitung engine dan dikirim oleh React.       */
/* ------------------------------------------------------------------ */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const hasThree = () => typeof window.THREE !== 'undefined' && window.THREE;

  const PODIUM_HEIGHTS = { 1: 1.9, 2: 1.45, 3: 1.1 };
  const PODIUM_COLORS = { 1: 0xfbbf24, 2: 0xcbd5e1, 3: 0xf59e0b };
  const PODIUM_EDGE = { 1: 0xd97706, 2: 0x94a3b8, 3: 0xb45309 };

  const CAMERA_FOV = 42;

  /* PRNG deterministik: hutan sama setiap kali podium dimainkan. */
  function mulberry32(seed) {
    let value = seed >>> 0;
    return function rand() {
      value += 0x6d2b79f5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function grassTexture(THREE) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3f6212';
    ctx.fillRect(0, 0, size, size);
    const rand = mulberry32(7);
    for (let i = 0; i < 2600; i += 1) {
      const shade = 40 + Math.floor(rand() * 60);
      ctx.fillStyle = `rgb(${Math.floor(shade * 0.7)}, ${shade + 40}, ${Math.floor(shade * 0.45)})`;
      const x = rand() * size;
      const y = rand() * size;
      ctx.fillRect(x, y, 2, 3 + rand() * 3);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(24, 24);
    if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  class Podium3D {
    static supported() {
      return Boolean(hasThree());
    }

    constructor(container, options) {
      if (!hasThree()) throw new Error('Three.js tidak tersedia.');
      const THREE = window.THREE;
      this.THREE = THREE;
      this.container = container;
      this.options = options || {};
      this.entries = Array.isArray(this.options.entries) ? this.options.entries.slice(0, 12) : [];
      this.reducedMotion = Boolean(this.options.reducedMotion);
      this.onStage = typeof this.options.onStage === 'function' ? this.options.onStage : () => {};

      this.characterStyles = {};
      (Array.isArray(this.options.characterStyles) ? this.options.characterStyles : []).forEach((character) => {
        const id = Number(character && character.id);
        if (!Number.isInteger(id) || id < 1) return;
        const palette = window.Board3DModels && window.Board3DModels.palette
          ? window.Board3DModels.palette(character)
          : null;
        if (palette) this.characterStyles[id] = palette;
      });

      this.anims = [];
      this.disposables = [];
      this.running = false;
      this.hidden = false;
      this.lastTime = 0;
      this.elapsed = 0;
      this.cameraIntro = 0;
      this.cameraLook = new THREE.Vector3(0, 1, 0);
      this.motes = [];
      this.spotlights = [];

      const width = Math.max(1, container.clientWidth || window.innerWidth);
      const height = Math.max(1, container.clientHeight || window.innerHeight);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0xfbc98f);
      this.scene.fog = new THREE.FogExp2(0xf3c48a, 0.022);

      this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, width / height, 0.1, 260);
      this.camera.position.set(0, 7.2, 13.5);
      this.camera.lookAt(0, 1.2, 0);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.setSize(width, height, false);
      if (THREE.sRGBEncoding !== undefined) this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.domElement.className = 'podium3d-canvas';
      this.container.appendChild(this.renderer.domElement);

      this._buildLights();
      this._buildGround();
      this._buildForest();
      this._buildPodium();
      this._buildCharacters();
      this._buildDust();
      this._buildMotes();

      this._onResize = () => this.resize();
      window.addEventListener('resize', this._onResize);
      this.resize();
    }

    _track(...items) {
      items.forEach((item) => {
        if (item) this.disposables.push(item);
      });
      return items[0];
    }

    _buildLights() {
      const THREE = this.THREE;
      const hemi = new THREE.HemisphereLight(0xfff3d6, 0x3f6212, 0.95);
      const sun = new THREE.DirectionalLight(0xffe1b0, 1.35);
      sun.position.set(-7, 12, 6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 40;
      sun.shadow.camera.left = -10;
      sun.shadow.camera.right = 10;
      sun.shadow.camera.top = 10;
      sun.shadow.camera.bottom = -10;
      const fill = new THREE.DirectionalLight(0xffc078, 0.45);
      fill.position.set(8, 6, -8);
      this.scene.add(hemi, sun, fill);
      this.sun = sun;
    }

    _buildGround() {
      const THREE = this.THREE;
      const geometry = new THREE.PlaneGeometry(160, 160, 1, 1);
      const material = new THREE.MeshStandardMaterial({ map: grassTexture(THREE), roughness: 0.95, metalness: 0 });
      const ground = new THREE.Mesh(geometry, material);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);
      this._track(geometry, material, material.map);

      /* Panggung batu di bawah podium agar podium tidak "mengambang". */
      const stageGeo = new THREE.CylinderGeometry(5.2, 5.6, 0.5, 40);
      const stageMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7, metalness: 0.05 });
      const stage = new THREE.Mesh(stageGeo, stageMat);
      stage.position.y = 0.25;
      stage.receiveShadow = true;
      this.scene.add(stage);
      this._track(stageGeo, stageMat);
    }

    _buildForest() {
      const THREE = this.THREE;
      const rand = mulberry32(20241119);
      const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.5, 6);
      const leafGeo = new THREE.ConeGeometry(0.95, 1.5, 7);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
      const leafMats = [0x166534, 0x15803d, 0x4d7c0f, 0x065f46].map(
        (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true })
      );
      this._track(trunkGeo, leafGeo, trunkMat, ...leafMats);

      const count = 84;
      for (let i = 0; i < count; i += 1) {
        const angle = rand() * Math.PI * 2;
        const radius = 9 + rand() * 26;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius * 0.9 - 2;
        const scale = 0.8 + rand() * 1.5;
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.75;
        trunk.castShadow = true;
        tree.add(trunk);
        const leafMat = leafMats[Math.floor(rand() * leafMats.length)];
        for (let level = 0; level < 3; level += 1) {
          const cone = new THREE.Mesh(leafGeo, leafMat);
          cone.position.y = 1.5 + level * 0.75;
          cone.scale.setScalar(1 - level * 0.22);
          cone.castShadow = true;
          tree.add(cone);
        }
        tree.position.set(x, 0, z);
        tree.scale.setScalar(scale);
        tree.rotation.y = rand() * Math.PI * 2;
        this.scene.add(tree);
      }

      /* Batu dekoratif di sekitar panggung. */
      const rockGeo = new THREE.DodecahedronGeometry(0.35, 0);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.95, flatShading: true });
      this._track(rockGeo, rockMat);
      for (let i = 0; i < 14; i += 1) {
        const angle = (i / 14) * Math.PI * 2 + rand() * 0.3;
        const radius = 6.4 + rand() * 2.2;
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.set(Math.cos(angle) * radius, 0.22, Math.sin(angle) * radius * 0.8);
        rock.rotation.set(rand(), rand() * 3, rand());
        rock.scale.set(0.7 + rand() * 0.9, 0.6 + rand() * 0.7, 0.7 + rand() * 0.9);
        rock.castShadow = true;
        this.scene.add(rock);
      }
    }

    _buildPodium() {
      const THREE = this.THREE;
      const layout = [
        { place: 2, x: -2.4 },
        { place: 1, x: 0 },
        { place: 3, x: 2.4 },
      ];
      this.blocks = {};
      layout.forEach(({ place, x }) => {
        const height = PODIUM_HEIGHTS[place];
        const geo = new THREE.BoxGeometry(2.1, height, 2.1);
        const mat = new THREE.MeshStandardMaterial({
          color: PODIUM_COLORS[place],
          roughness: 0.42,
          metalness: place === 1 ? 0.45 : 0.25,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, 0.5 + height / 2, 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this._track(geo, mat);

        /* Garis tepi agar blok terbaca sebagai podium. */
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: PODIUM_EDGE[place] })
        );
        edges.position.copy(mesh.position);
        this.scene.add(edges);
        this._track(edges.geometry, edges.material);

        this.blocks[place] = { mesh, top: 0.5 + height };
      });

      /* Bendera kecil di belakang podium. */
      const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 4.2, 8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(0, 2.1, -2.1);
      this.scene.add(pole);
      const flagGeo = new THREE.PlaneGeometry(1.4, 0.8, 1, 1);
      const flagMat = new THREE.MeshStandardMaterial({ color: 0x4338ca, side: THREE.DoubleSide, roughness: 0.7 });
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(0.72, 3.6, -2.1);
      this.scene.add(flag);
      this._track(poleGeo, poleMat, flagGeo, flagMat);

      /* Tangga kecil menuju panggung. */
      const stepGeo = new THREE.BoxGeometry(1.6, 0.18, 0.5);
      const stepMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.8 });
      for (let i = 0; i < 3; i += 1) {
        const step = new THREE.Mesh(stepGeo, stepMat);
        step.position.set(0, 0.09 + i * 0.16, 3.4 - i * 0.5);
        step.castShadow = true;
        step.receiveShadow = true;
        this.scene.add(step);
      }
      this._track(stepGeo, stepMat);
    }

    _buildCharacter(entry, position) {
      const THREE = this.THREE;
      const palette = this.characterStyles[entry.char] || (window.Board3DModels && window.Board3DModels.palette
        ? window.Board3DModels.palette(entry.character || { color: '#2563eb', light: '#60a5fa', deep: '#1e3a8a', form: 'robot' })
        : null);
      if (!window.Board3DModels || !palette) return null;
      const model = window.Board3DModels.build(palette.form, palette);
      const group = model.group;
      group.scale.setScalar(1.75);
      group.position.set(position.x, 0, position.z);
      group.traverse((node) => {
        if (node.isMesh) node.castShadow = true;
      });
      this.scene.add(group);
      this._track(...(model.geometries || []), ...(model.materials || []));
      return group;
    }

    _buildCharacters() {
      this.actors = [];
      const top = this.entries.slice(0, 3);
      top.forEach((entry, index) => {
        const place = index + 1;
        const block = this.blocks[place];
        if (!block) return;
        const group = this._buildCharacter(entry, { x: block.mesh.position.x, z: 0 });
        if (!group) return;
        const baseY = block.top;
        /* Karakter "jatuh" dari atas podium: mulai jauh di atas. */
        group.position.y = baseY + 9;
        group.visible = false;
        this.actors.push({ place, entry, group, baseY, landed: false, idleAt: 0 });
      });

      /* Pemain lain berbaris di depan panggung. */
      this.line = [];
      const rest = this.entries.slice(3);
      rest.forEach((entry, index) => {
        const columns = Math.min(6, Math.max(1, rest.length));
        const row = Math.floor(index / columns);
        const col = index % columns;
        const x = (col - (columns - 1) / 2) * 1.5;
        const z = 4.4 + row * 1.6;
        const group = this._buildCharacter(entry, { x, z });
        if (!group) return;
        group.scale.setScalar(1.15);
        group.position.y = 0.5;
        group.visible = false;
        this.line.push({ entry, group, delay: index * 0.35, shown: false });
      });
    }

    _buildDust() {
      const THREE = this.THREE;
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.8 });
      this._track(texture, material);
      this.dustMaterial = material;
      this.dustTexture = texture;
    }

    _buildMotes() {
      const THREE = this.THREE;
      const geo = new THREE.BufferGeometry();
      const count = 70;
      const positions = new Float32Array(count * 3);
      const rand = mulberry32(99);
      for (let i = 0; i < count; i += 1) {
        positions[i * 3] = (rand() - 0.5) * 30;
        positions[i * 3 + 1] = 1 + rand() * 8;
        positions[i * 3 + 2] = (rand() - 0.5) * 24;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({ color: 0xfff7d6, size: 0.12, transparent: true, opacity: 0.8, depthWrite: false });
      const points = new THREE.Points(geo, mat);
      this.scene.add(points);
      this.motes.push({ points, positions, geo });
      this._track(geo, mat);
    }

    _spawnDust(at) {
      const THREE = this.THREE;
      if (!this.dustMaterial) return;
      const count = 14;
      for (let i = 0; i < count; i += 1) {
        const sprite = new THREE.Sprite(this.dustMaterial.clone());
        sprite.position.copy(at);
        sprite.position.y += 0.25;
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 1.6;
        sprite.userData.vx = Math.cos(angle) * speed;
        sprite.userData.vz = Math.sin(angle) * speed;
        sprite.userData.life = 0.7 + Math.random() * 0.4;
        sprite.userData.age = 0;
        sprite.scale.setScalar(0.5);
        this.scene.add(sprite);
        this.scene.userData = this.scene.userData || {};
        (this.scene.userData.dust = this.scene.userData.dust || []).push(sprite);
      }
    }

    _updateDust(dt) {
      const list = (this.scene.userData && this.scene.userData.dust) || [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const sprite = list[i];
        sprite.userData.age += dt;
        const t = sprite.userData.age / sprite.userData.life;
        if (t >= 1) {
          this.scene.remove(sprite);
          if (sprite.material) sprite.material.dispose();
          list.splice(i, 1);
          continue;
        }
        sprite.position.x += sprite.userData.vx * dt;
        sprite.position.z += sprite.userData.vz * dt;
        sprite.position.y += dt * 0.6;
        sprite.scale.setScalar(0.5 + t * 1.4);
        if (sprite.material) sprite.material.opacity = 0.8 * (1 - t);
      }
      this.scene.userData.dust = list;
    }

    _animate(duration, update) {
      return new Promise((resolve) => {
        if (this.reducedMotion || !(duration > 0)) {
          try {
            update(1);
          } catch (error) {
            /* abaikan */
          }
          resolve();
          return;
        }
        this.anims.push({ elapsed: 0, duration, update, resolve });
        this._start();
      });
    }

    _wait(ms) {
      return this._animate(ms / 1000, () => {});
    }

    async play() {
      if (this.playing) return this.playPromise;
      this.playing = true;
      this.playPromise = (async () => {
        this._start();
        if (this.reducedMotion) {
          this.actors.forEach((actor) => {
            actor.group.visible = true;
            actor.group.position.y = actor.baseY;
            actor.landed = true;
          });
          this.line.forEach((item) => {
            item.group.visible = true;
            item.shown = true;
          });
          this.cameraIntro = 1;
          this.onStage('done');
          return;
        }

        /* 1. Sapuan kamera hutan. */
        this.onStage('intro');
        this.cameraIntro = 0;
        await this._animate(1.2, (t) => {
          this.cameraIntro = easeOutCubic(t);
        });

        /* 2. Juara 3 -> 2 -> 1 berurutan. */
        const order = [3, 2, 1];
        for (const place of order) {
          const actor = this.actors.find((item) => item.place === place);
          if (!actor) continue;
          this.onStage(`place-${place}`);
          actor.group.visible = true;
          await this._animate(1.1, (t) => {
            const eased = easeOutCubic(clamp(t, 0, 1));
            actor.group.position.y = actor.baseY + 9 * (1 - eased) + Math.sin(eased * Math.PI) * 0.4;
            if (t >= 1 && !actor.landed) {
              actor.landed = true;
              actor.group.position.y = actor.baseY;
              this._spawnDust(actor.group.position);
            }
            if (t >= 1) {
              const hop = Math.max(0, Math.sin((this.elapsed - actor.idleAt) * 2.4)) * 0.04;
              actor.group.position.y = actor.baseY + hop;
            }
          });
          actor.idleAt = this.elapsed;
          await this._wait(220);
        }

        /* 3. Pemain lain muncul berjajar dengan lompatan kecil. */
        for (const item of this.line) {
          if (item.shown) continue;
          item.group.visible = true;
          item.shown = true;
          const baseY = 0.5;
          this._animate(0.35, (t) => {
            item.group.position.y = baseY + Math.sin(clamp(t, 0, 1) * Math.PI) * 0.35;
            if (t >= 1) item.group.position.y = baseY;
          });
        }

        /* 4. Fokus ke podium dan selesai. */
        await this._wait(Math.max(500, this.line.length * 140));
        this.onStage('done');
      })();
      return this.playPromise;
    }

    skip() {
      this.anims.forEach((item) => item.resolve());
      this.anims = [];
      this.actors.forEach((actor) => {
        actor.group.visible = true;
        actor.group.position.y = actor.baseY;
        actor.landed = true;
      });
      this.line.forEach((item) => {
        item.group.visible = true;
        item.shown = true;
      });
      this.cameraIntro = 1;
      this.playing = true;
      this.onStage('done');
    }

    resize() {
      if (!this.renderer || !this.container) return;
      const width = Math.max(1, this.container.clientWidth || window.innerWidth);
      const height = Math.max(1, this.container.clientHeight || window.innerHeight);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    }

    _start() {
      if (this.running || this.hidden || !this.renderer) return;
      this.running = true;
      this.lastTime = performance.now();
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
        this.lastTime = now;
        this.elapsed += dt;
        this._update(dt);
        this.renderer.render(this.scene, this.camera);
        this.frame = requestAnimationFrame(loop);
      };
      this.frame = requestAnimationFrame(loop);
    }

    _stop() {
      this.running = false;
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = null;
    }

    _update(dt) {
      for (let i = this.anims.length - 1; i >= 0; i -= 1) {
        const item = this.anims[i];
        item.elapsed += dt;
        const t = clamp(item.elapsed / item.duration, 0, 1);
        try {
          item.update(t);
        } catch (error) {
          /* abaikan galat animasi */
        }
        if (t >= 1) {
          this.anims.splice(i, 1);
          item.resolve();
        }
      }

      /* Orbit idle pelan di sekitar podium. */
      const intro = this.cameraIntro;
      const azimuth = -0.75 + intro * 0.75 + Math.sin(this.elapsed * 0.16) * 0.12;
      const dist = 22 - intro * 7.2;
      const height = 12 - intro * 5.4;
      this.camera.position.set(Math.sin(azimuth) * dist, height, Math.cos(azimuth) * dist);
      this.camera.lookAt(0, 1 + intro * 0.6, 0);

      /* Karakter juara bergoyang ringan setelah mendarat. */
      this.actors.forEach((actor) => {
        if (!actor.landed) return;
        actor.group.rotation.y = Math.sin(this.elapsed * 1.4 + actor.place) * 0.08;
      });

      this.motes.forEach((item) => {
        item.positions[1] += dt * 0.35;
        for (let i = 1; i < item.positions.length; i += 3) {
          if (item.positions[i] > 9) item.positions[i] = 0.6;
        }
        item.geo.attributes.position.needsUpdate = true;
      });

      this._updateDust(dt);
    }

    dispose() {
      this._stop();
      window.removeEventListener('resize', this._onResize);
      this.anims.forEach((item) => item.resolve());
      this.anims = [];
      const dust = (this.scene.userData && this.scene.userData.dust) || [];
      dust.forEach((sprite) => {
        if (sprite.material) sprite.material.dispose();
      });
      this.disposables.forEach((item) => {
        if (item && item.dispose) item.dispose();
      });
      this.disposables = [];
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

  window.Podium3D = Podium3D;
})();
