/* 取調室 — ソフトウェア3D。内部 160×112 を整数倍で表示。
   面はフラットシェード、色は9bit相当へ量子化し、Bayerディザで中間調を作る。 */
(function () {
  const GW = 160, GH = 112, FOCAL = 128;
  const BAYER = new Uint8Array([
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ]);

  function pack(r, g, b) {
    r = Math.max(0, Math.min(252, Math.round(r / 36) * 36));
    g = Math.max(0, Math.min(252, Math.round(g / 36) * 36));
    b = Math.max(0, Math.min(252, Math.round(b / 36) * 36));
    return r | (g << 8) | (b << 16) | (255 << 24);
  }
  function makeRamp(r, g, b) {
    return [0.38, 0.62, 0.84, 1].map(function (k) {
      return pack(r * k, g * k, b * k);
    });
  }
  function rampCss(ramp) {
    const c = ramp[2];
    return 'rgb(' + (c & 255) + ',' + ((c >>> 8) & 255) + ',' + ((c >>> 16) & 255) + ')';
  }

  const WALL = makeRamp(48, 64, 112);
  const FLOOR_A = makeRamp(58, 52, 70);
  const FLOOR_B = makeRamp(28, 26, 40);
  const WOOD = makeRamp(150, 86, 36);
  const SKIN = makeRamp(220, 156, 114);
  const METAL = makeRamp(150, 158, 176);
  const LAMP = makeRamp(240, 196, 64);
  const CHAIR = makeRamp(92, 28, 40);
  const EYE = makeRamp(12, 14, 22);
  const MOUTH = makeRamp(150, 54, 58);
  const INK = makeRamp(0, 0, 0);
  const RED = makeRamp(220, 48, 60);
  const WINDOW = makeRamp(72, 150, 186);
  const PAPER = makeRamp(210, 198, 170);
  const HAIR_BASE = [[232, 63, 111], [59, 42, 26], [63, 169, 245], [245, 197, 66], [122, 122, 122]];
  const CLOTH_BASE = [[255, 210, 63], [63, 216, 166], [179, 107, 255], [255, 138, 61], [74, 120, 255]];
  const HAIR_R = HAIR_BASE.map(function (c) { return makeRamp(c[0], c[1], c[2]); });
  const CLOTH_R = CLOTH_BASE.map(function (c) { return makeRamp(c[0], c[1], c[2]); });

  const color = new Uint32Array(GW * GH);
  const depth = new Float32Array(GW * GH);
  const view = document.getElementById('view');
  const ctx = view.getContext('2d', { alpha: false });
  const img = ctx.createImageData(GW, GH);
  ctx.imageSmoothingEnabled = false;

  let EX = 0, EY = 1.4, EZ = 2.4;
  let RX = 1, RY = 0, RZ = 0, UX = 0, UY = 1, UZ = 0, BX = 0, BY = 0, BZ = 1;
  const LX = 0.15, LY = 0.84, LZ = 0.52;
  const LL = Math.hypot(LX, LY, LZ);
  const LNX = LX / LL, LNY = LY / LL, LNZ = LZ / LL;
  const LAMPX = -1.12, LAMPY = 1.62, LAMPZ = 0.2;
  let MOOD = 0.55;
  let lookX = 0;

  function aim(ex, ey, ez, tx, ty, tz) {
    EX = ex; EY = ey; EZ = ez;
    let fx = ex - tx, fy = ey - ty, fz = ez - tz;
    let fl = Math.hypot(fx, fy, fz) || 1;
    BX = fx / fl; BY = fy / fl; BZ = fz / fl;
    RX = BZ; RY = 0; RZ = -BX;
    fl = Math.hypot(RX, RY, RZ) || 1;
    RX /= fl; RY /= fl; RZ /= fl;
    UX = BY * RZ - BZ * RY;
    UY = BZ * RX - BX * RZ;
    UZ = BX * RY - BY * RX;
  }

  function project(x, y, z) {
    const dx = x - EX, dy = y - EY, dz = z - EZ;
    const cx = dx * RX + dy * RY + dz * RZ;
    const cy = dx * UX + dy * UY + dz * UZ;
    const cz = -(dx * BX + dy * BY + dz * BZ);
    if (cz < 0.15) return null;
    const s = FOCAL / cz;
    return { x: GW * 0.5 + cx * s, y: GH * 0.5 - cy * s, z: cz };
  }

  const room = [];
  const dyn = [];
  let dynN = 0;
  let into = room;

  function pushTri(ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, ramp, bias, shell) {
    if (into === room) {
      room.push({
        a: { x: ax, y: ay, z: az },
        b: { x: bx, y: by, z: bz },
        c: { x: cx, y: cy, z: cz },
        n: [nx, ny, nz],
        ramp: ramp,
        bias: bias || 0,
        shell: !!shell
      });
      return;
    }
    let t = dyn[dynN++];
    if (!t) {
      t = { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, c: { x: 0, y: 0, z: 0 }, n: [0, 0, 0], ramp: null, bias: 0, shell: false };
      dyn[dynN - 1] = t;
    }
    t.a.x = ax; t.a.y = ay; t.a.z = az;
    t.b.x = bx; t.b.y = by; t.b.z = bz;
    t.c.x = cx; t.c.y = cy; t.c.z = cz;
    t.n[0] = nx; t.n[1] = ny; t.n[2] = nz;
    t.ramp = ramp; t.bias = bias || 0; t.shell = !!shell;
  }

  function addBox(cx, cy, cz, hx, hy, hz, ramp, bias, shell) {
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    const F = [
      [0, 1, 0, x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0],
      [0, -1, 0, x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1],
      [0, 0, 1, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
      [0, 0, -1, x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0],
      [1, 0, 0, x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1],
      [-1, 0, 0, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0]
    ];
    for (let i = 0; i < 6; i++) {
      const f = F[i];
      pushTri(f[3], f[4], f[5], f[6], f[7], f[8], f[9], f[10], f[11], f[0], f[1], f[2], ramp, bias, shell);
      pushTri(f[3], f[4], f[5], f[9], f[10], f[11], f[12], f[13], f[14], f[0], f[1], f[2], ramp, bias, shell);
    }
  }

  function buildRoom() {
    into = room;
    for (let iz = 0; iz < 7; iz++) {
      for (let ix = 0; ix < 8; ix++) {
        const ramp = ((ix + iz) & 1) ? FLOOR_A : FLOOR_B;
        addBox(-1.8 + (ix + 0.5) * 0.45, 0.03, -1.15 + (iz + 0.5) * 0.4, 0.225, 0.03, 0.2, ramp, 0, false);
      }
    }
    addBox(0, 2.12, 0.15, 1.85, 0.05, 1.55, WALL, -0.12, false);
    for (let band = 0; band < 7; band++) {
      addBox(0, 0.16 + band * 0.3, -1.52, 1.85, 0.15, 0.06, WALL, 0.28 - band * 0.06, false);
    }
    addBox(-1.9, 1.05, 0.15, 0.06, 1.05, 1.55, WALL, -0.04, false);
    addBox(1.9, 1.05, 0.15, 0.06, 1.05, 1.55, WALL, -0.04, false);
    addBox(0, 1.15, -1.44, 0.72, 0.42, 0.03, WINDOW, 0.2, false);
    const heights = [0.28, 0.46, 0.22, 0.55, 0.34, 0.4];
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i];
      addBox(-0.58 + i * 0.22, 0.78 + h * 0.5, -1.38, 0.08, h * 0.5, 0.04, METAL, -0.05, false);
    }
    addBox(0, 0.72, 0.58, 1.2, 0.045, 0.4, WOOD, 0.05, false);
    [[-1, 0.28], [1, 0.28], [-1, 0.88], [1, 0.88]].forEach(function (p) {
      addBox(p[0], 0.34, p[1], 0.06, 0.32, 0.06, WOOD, -0.05, false);
    });
    addBox(-1.12, 1.9, 0.2, 0.02, 0.2, 0.02, METAL, 0, false);
    addBox(-1.12, 1.68, 0.2, 0.16, 0.035, 0.16, METAL, 0.08, false);
    addBox(-1.12, 1.6, 0.2, 0.06, 0.04, 0.06, LAMP, 0.55, false);
    addBox(1.35, 1.45, -1.4, 0.16, 0.16, 0.03, METAL, 0.08, false);
    addBox(-0.35, 0.8, 0.72, 0.12, 0.03, 0.08, PAPER, 0.1, false);
    addBox(0.2, 0.8, 0.55, 0.1, 0.025, 0.07, PAPER, 0.05, false);
    addBox(0.55, 0.79, 0.78, 0.03, 0.08, 0.03, METAL, 0.1, false);
    addBox(-1.55, 0.7, -1.35, 0.22, 0.55, 0.04, WOOD, -0.08, false);
  }
  buildRoom();

  function seats(n) {
    const span = n <= 3 ? 1.4 : n === 4 ? 1.8 : 2.1;
    const xs = [];
    for (let i = 0; i < n; i++) xs.push(n === 1 ? 0 : (i / (n - 1) - 0.5) * span);
    return xs;
  }

  const heads = [];
  const PERSON_Z = -0.02;

  function addChair(x) {
    addBox(x, 0.4, PERSON_Z - 0.06, 0.18, 0.045, 0.16, CHAIR, 0, false);
    addBox(x, 0.68, PERSON_Z - 0.2, 0.18, 0.24, 0.04, CHAIR, 0, false);
  }

  function addSolid(x, y, z, hx, hy, hz, ramp, bias) {
    addBox(x, y, z, hx + 0.03, hy + 0.03, hz + 0.03, INK, -0.2, true);
    addBox(x, y, z, hx, hy, hz, ramp, bias, false);
  }

  function addPerson(x, i, bob, selected, eyeOpen) {
    const z = PERSON_Z + (selected ? 0.06 : 0);
    const yb = bob;
    const cloth = CLOTH_R[i];
    const hair = HAIR_R[i];
    const bias = selected ? 0.16 : 0;
    addChair(x);
    addSolid(x, 0.8 + yb, z, 0.15, 0.2, 0.09, cloth, bias);
    addSolid(x - 0.2, 0.74 + yb, z + 0.02, 0.045, 0.13, 0.045, cloth, bias);
    addSolid(x + 0.2, 0.74 + yb, z + 0.02, 0.045, 0.13, 0.045, cloth, bias);
    addSolid(x, 1.18 + yb, z - 0.02, 0.125, 0.09, 0.1, hair, bias);
    addSolid(x, 1.16 + yb, z + 0.02, 0.1, 0.11, 0.09, SKIN, bias);
    const ez = z + 0.125;
    const eh = eyeOpen ? 0.02 : 0.008;
    addBox(x - 0.045, 1.18 + yb, ez, 0.022, eh, 0.012, EYE, 0, false);
    addBox(x + 0.045, 1.18 + yb, ez, 0.022, eh, 0.012, EYE, 0, false);
    addBox(x, 1.08 + yb, ez, 0.028, 0.01, 0.012, MOUTH, 0, false);
    addBox(x, 0.78, 0.22, 0.06, 0.015, 0.02, cloth, 0.2, false);
  }

  function addMarker(x, y, ramp) {
    addBox(x, y, PERSON_Z, 0.045, 0.07, 0.045, ramp, 0.4, false);
  }

  function buildDynamic(now) {
    dynN = 0;
    into = dyn;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ph = reduce ? 0 : (Math.floor(now / 180) % 4);
    const bob = [0, 0.014, 0.028, 0.014][ph];
    const blink = !reduce && (Math.floor(now / 180) % 18) === 2;
    const hand = [[1, 0], [0, 1], [-1, 0], [0, -1]][ph];
    addBox(1.35 + hand[0] * 0.07, 1.45 + hand[1] * 0.07, -1.36, hand[0] ? 0.07 : 0.018, hand[1] ? 0.07 : 0.018, 0.015, LAMP, 0.3, false);
    const playing = SCREEN === 'pick' || SCREEN === 'done' || SCREEN === 'end';
    const n = playing && G && G.n ? G.n : 0;
    heads.length = 0;
    if (!n) {
      seats(3).forEach(addChair);
      return;
    }
    const xs = seats(n);
    for (let i = 0; i < n; i++) {
      const selected = SCREEN === 'pick' && i === CUR;
      addPerson(xs[i], i, bob + (i % 2) * 0.004, selected, !(blink && i === CUR));
      if (SCREEN === 'pick' && i === CUR) addMarker(xs[i], 1.5 + bob, LAMP);
      if (SCREEN !== 'pick' && G.p) {
        if (i === G.p.L) addMarker(xs[i], 1.52, RED);
        if (i === G.p.c && SCREEN !== 'pick') addMarker(xs[i], 1.36, LAMP);
      }
      const hp = project(xs[i], 1.2, PERSON_Z);
      if (hp) heads.push({ i: i, x: hp.x, y: hp.y });
    }
  }

  function shadeIndex(light, x, y) {
    let L = light;
    if (!(L > 0)) L = 0;
    if (L > 0.999) L = 0.999;
    const scaled = L * 3;
    const si = scaled | 0;
    const frac = scaled - si;
    if (frac < 0.35 || frac > 0.65) {
      const step = frac > 0.65 && si < 3 ? si + 1 : si;
      return step > 3 ? 3 : step;
    }
    const bv = BAYER[((y & 3) << 2) + (x & 3)];
    return ((frac - 0.35) / 0.3) * 16 >= bv ? (si < 3 ? si + 1 : 3) : si;
  }

  function clearBuf() {
    depth.fill(1e6);
    for (let y = 0; y < GH; y++) {
      const row = y * GW;
      const base = 0.58 - (y / GH) * 0.36;
      for (let x = 0; x < GW; x++) {
        const edge = Math.abs(x - GW * 0.5) / (GW * 0.5);
        color[row + x] = WALL[shadeIndex(base - edge * edge * 0.08, x, y)];
      }
    }
  }

  function fillTri(a, b, c, ramp, light) {
    if (a.y > b.y) { const t = a; a = b; b = t; }
    if (b.y > c.y) { const t = b; b = c; c = t; }
    if (a.y > b.y) { const t = a; a = b; b = t; }
    const minx = Math.min(a.x, b.x, c.x), maxx = Math.max(a.x, b.x, c.x);
    const miny = Math.min(a.y, b.y, c.y), maxy = Math.max(a.y, b.y, c.y);
    if (maxx < 0 || minx >= GW || maxy < 0 || miny >= GH) return;
    let y0 = Math.ceil(a.y), y2 = Math.ceil(c.y);
    if (y0 < 0) y0 = 0;
    if (y2 > GH) y2 = GH;
    const dyAC = c.y - a.y;
    if (dyAC < 0.4) return;
    for (let y = y0; y < y2; y++) {
      const tac = (y - a.y) / dyAC;
      let xl = a.x + (c.x - a.x) * tac;
      let zl = a.z + (c.z - a.z) * tac;
      let xr, zr;
      if (y < b.y) {
        const dy = b.y - a.y;
        const t = dy > 0.001 ? (y - a.y) / dy : 0;
        xr = a.x + (b.x - a.x) * t;
        zr = a.z + (b.z - a.z) * t;
      } else {
        const dy = c.y - b.y;
        const t = dy > 0.001 ? (y - b.y) / dy : 0;
        xr = b.x + (c.x - b.x) * t;
        zr = b.z + (c.z - b.z) * t;
      }
      if (xl > xr) {
        const tx = xl; xl = xr; xr = tx;
        const tz = zl; zl = zr; zr = tz;
      }
      let x0 = Math.ceil(xl), x1 = Math.ceil(xr);
      if (x0 < 0) x0 = 0;
      if (x1 > GW) x1 = GW;
      const dxs = xr - xl;
      const row = y * GW;
      for (let x = x0; x < x1; x++) {
        const t = dxs > 0.001 ? (x - xl) / dxs : 0;
        const z = zl + (zr - zl) * t;
        const i = row + x;
        if (z >= depth[i]) continue;
        depth[i] = z;
        color[i] = ramp[shadeIndex(light, x, y)];
      }
    }
  }

  function shadeTri(t) {
    const ax = t.a.x, ay = t.a.y, az = t.a.z;
    const bx = t.b.x, by = t.b.y, bz = t.b.z;
    const cx = t.c.x, cy = t.c.y, cz = t.c.z;
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    const vx = EX - mx, vy = EY - my, vz = EZ - mz;
    const nx = t.n[0], ny = t.n[1], nz = t.n[2];
    const facing = nx * vx + ny * vy + nz * vz;
    if (t.shell) { if (facing > 0) return; }
    else if (facing <= 0) return;
    const p0 = project(ax, ay, az), p1 = project(bx, by, bz), p2 = project(cx, cy, cz);
    if (!p0 || !p1 || !p2) return;
    const nd = nx * LNX + ny * LNY + nz * LNZ;
    const vl = Math.hypot(vx, vy, vz) || 1;
    const fill = facing / vl;
    let light = 0.1 + Math.max(0, nd) * 0.52 + Math.max(0, fill) * 0.16 + t.bias;
    const dist = Math.hypot(mx - LAMPX, my - LAMPY, mz - LAMPZ);
    if (dist < 2.5) light += (1 - dist / 2.5) * 0.4;
    light *= MOOD;
    if (t.shell) light = 0.02;
    fillTri(p0, p1, p2, t.ramp, light);
  }

  function present() {
    const px = img.data;
    for (let i = 0, p = 0; i < color.length; i++, p += 4) {
      const c = color[i];
      px[p] = c & 255;
      px[p + 1] = (c >>> 8) & 255;
      px[p + 2] = (c >>> 16) & 255;
      px[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  const stage = document.getElementById('stage');
  const pad = document.getElementById('fcpad');
  function fit() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    let s = Math.floor(Math.min(sw / GW, sh / GH));
    if (s < 1) s = 1;
    if (s > 5) s = 5;
    view.style.width = (GW * s) + 'px';
    view.style.height = (GH * s) + 'px';
    document.documentElement.style.setProperty('--pad-h', pad.offsetHeight + 'px');
  }
  window.addEventListener('resize', fit);
  fit();

  /* ===== 入力 ===== */
  const DIRS = ['up', 'down', 'left', 'right'];
  const held = Object.create(null);
  const timers = Object.create(null);
  const subs = [];
  const root = document.getElementById('fcpad');
  const dpad = document.getElementById('fc-dpad');
  const hintEl = document.getElementById('hint');

  function emit(btn, phase) {
    for (let i = 0; i < subs.length; i++) subs[i](btn, phase);
  }
  function visual(btn, on) {
    if (DIRS.indexOf(btn) >= 0) { dpad.classList.toggle('press-' + btn, on); return; }
    const el = root.querySelector('[data-fc="' + btn + '"]');
    if (el) el.classList.toggle('press', on);
  }
  function buzz() { if (navigator.vibrate) navigator.vibrate(12); }
  function down(btn) {
    if (held[btn]) return;
    held[btn] = true;
    visual(btn, true);
    buzz();
    unlock();
    emit(btn, 'down');
    if (DIRS.indexOf(btn) >= 0) {
      timers[btn] = setTimeout(function tick() {
        if (!held[btn]) return;
        emit(btn, 'repeat');
        timers[btn] = setTimeout(tick, 95);
      }, 300);
    }
  }
  function up(btn) {
    if (!held[btn]) return;
    held[btn] = false;
    visual(btn, false);
    clearTimeout(timers[btn]);
    emit(btn, 'up');
  }
  root.querySelectorAll('[data-fc]').forEach(function (elm) {
    const btn = elm.dataset.fc;
    elm.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { elm.setPointerCapture(e.pointerId); } catch (err) {}
      down(btn);
    });
    const release = function (e) { e.preventDefault(); up(btn); };
    elm.addEventListener('pointerup', release);
    elm.addEventListener('pointercancel', release);
    elm.addEventListener('lostpointercapture', function () { up(btn); });
  });
  window.addEventListener('blur', function () { Object.keys(held).forEach(up); });
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    x: 'a', X: 'a', ' ': 'a', z: 'b', Z: 'b', Enter: 'start', Shift: 'select'
  };
  window.addEventListener('keydown', function (e) {
    const b = KEYMAP[e.key];
    if (b && !e.repeat) { e.preventDefault(); down(b); }
  });
  window.addEventListener('keyup', function (e) {
    const b = KEYMAP[e.key];
    if (b) { e.preventDefault(); up(b); }
  });
  function setHint(text) { hintEl.textContent = text || ''; }
  function toggleLamp(btn, on) {
    const el = root.querySelector('[data-fc="' + btn + '"]');
    if (el) el.classList.toggle('on', !!on);
  }

  /* ===== 音声：矩形リード＋三角ベース＋ノイズ ===== */
  let AC = null, MUTE = false, bgmTimer = null, stepN = 0, noiseBuf = null;
  try { MUTE = localStorage.getItem('tg.252.mute') === '1'; } catch (e) {}
  function audioInit() {
    try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; }
  }
  function tone(freq, dur, type, gain) {
    if (MUTE || !AC) return;
    if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, AC.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), AC.currentTime + dur);
    g.gain.setValueAtTime(gain, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g).connect(AC.destination);
    o.start();
    o.stop(AC.currentTime + dur + 0.02);
  }
  function hat(dur) {
    if (MUTE || !AC) return;
    if (!noiseBuf) {
      noiseBuf = AC.createBuffer(1, 8000, 22050);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = AC.createBufferSource();
    src.buffer = noiseBuf;
    const f = AC.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1400;
    const g = AC.createGain();
    g.gain.setValueAtTime(0.025, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    src.connect(f).connect(g).connect(AC.destination);
    src.start();
    src.stop(AC.currentTime + dur);
  }
  const BASS = [110, 110, 98, 87, 110, 110, 130, 98];
  const LEAD = [330, 392, 494, 392, 440, 494, 523, 494];
  function tickBgm() {
    if (MUTE || PAUSED || !AC) return;
    const i = stepN % 8;
    tone(BASS[i], 0.16, 'triangle', 0.04);
    if (i % 2 === 0) tone(LEAD[i], 0.1, 'square', 0.018);
    else hat(0.04);
    stepN++;
  }
  function bgmStart() {
    if (bgmTimer || MUTE || !AC) return;
    bgmTimer = setInterval(tickBgm, 180);
  }
  function bgmStop() {
    if (bgmTimer) clearInterval(bgmTimer);
    bgmTimer = null;
  }
  function beep(f, dur, type) { audioInit(); tone(f, dur || 0.06, type || 'square', 0.05); }
  function unlock() {
    audioInit();
    if (AC && AC.state === 'suspended') AC.resume();
    if (!MUTE && !PAUSED) bgmStart();
  }
  function setMute(v) {
    MUTE = v;
    try { localStorage.setItem('tg.252.mute', v ? '1' : '0'); } catch (e) {}
    toggleLamp('select', !v);
    if (v) bgmStop();
    else { unlock(); beep(880, 0.06); }
  }
  document.addEventListener('pointerdown', unlock);
  toggleLamp('select', !MUTE);

  /* ===== ゲーム ===== */
  const NAMES = ['ミカ', 'ケンタ', 'ユウ', 'サラ', 'ゴロー'];
  const CASES = [
    '冷蔵庫のプリンを食べた', '社長の机にラクダのぬいぐるみを置いた', 'ホワイトボードを勝手に消した',
    '寝ている猫にヒゲを描き足した', '最後のコピー用紙を使い切った', 'オアシスの水を飲み干した',
    '全員の目覚まし時計を止めた', '給湯室のお菓子を隠した', 'ゲーム機の電源を抜いた', '玄関の花瓶を割った',
    '会議の資料をこっそり折り紙にした', 'エレベーターのボタンを全部押した'
  ];
  const TOTAL = 10;
  const N = function (i) { return NAMES[i]; };
  const TPL = [
    { w: 3, need: 0, txt: function () { return 'わたしはやってないよ'; }, ev: function (s, c) { return c !== s; } },
    { w: 3, need: 1, txt: function (s, t) { return N(t) + 'は犯人じゃない'; }, ev: function (s, c, L, t) { return c !== t; } },
    { w: 2, need: 1, txt: function (s, t) { return '犯人は' + N(t) + 'だよ'; }, ev: function (s, c, L, t) { return c === t; } },
    { w: 2, need: 2, txt: function (s, t, u) { return '犯人は' + N(t) + 'か' + N(u) + 'のどっちか'; }, ev: function (s, c, L, t, u) { return c === t || c === u; } },
    { w: 2, need: 1, txt: function (s, t) { return N(t) + 'はウソついてる'; }, ev: function (s, c, L, t) { return L === t; } },
    { w: 1, need: 1, txt: function (s, t) { return N(t) + 'は本当のこと言ってる'; }, ev: function (s, c, L, t) { return L !== t; } }
  ];
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pickTpl() {
    const tot = TPL.reduce(function (a, b) { return a + b.w; }, 0);
    let r = Math.random() * tot;
    for (let i = 0; i < TPL.length; i++) { if ((r -= TPL[i].w) < 0) return TPL[i]; }
    return TPL[0];
  }
  function others(n, s) {
    const a = [];
    for (let i = 0; i < n; i++) if (i !== s) a.push(i);
    return a.sort(function () { return Math.random() - 0.5; });
  }
  function makePuzzle(n) {
    for (let tries = 0; tries < 2000; tries++) {
      const c = rnd(n), L = rnd(n), st = [];
      let ok = true;
      for (let s = 0; s < n && ok; s++) {
        let got = null;
        for (let k = 0; k < 60 && !got; k++) {
          const t = pickTpl(), o = others(n, s), args = o.slice(0, t.need);
          if (t.need === 2 && args[0] > args[1]) args.reverse();
          if (t.ev(s, c, L, args[0], args[1]) === (s !== L)) got = { t: t, args: args };
        }
        if (!got) ok = false; else st.push(got);
      }
      if (!ok) continue;
      let sols = 0;
      let only = null;
      for (let cc = 0; cc < n; cc++) {
        for (let ll = 0; ll < n; ll++) {
          const good = st.every(function (x, s) {
            return x.t.ev(s, cc, ll, x.args[0], x.args[1]) === (s !== ll);
          });
          if (good) { sols++; only = [cc, ll]; }
        }
      }
      if (sols === 1) return { c: c, L: L, st: st, only: only };
    }
    return null;
  }

  let SCREEN = 'title', CUR = 0, PAUSED = false, G = {};
  const pauseEl = document.getElementById('pause');
  const dossier = document.getElementById('dossier');
  const hudCase = document.getElementById('hud-case');
  const hudScore = document.getElementById('hud-score');
  const hudLife = document.getElementById('hud-life');
  const recEl = document.getElementById('rec');

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function best() {
    try { return +localStorage.getItem('tg.252.best') || +localStorage.getItem('usotsuki-best') || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { if (v > best()) localStorage.setItem('tg.252.best', String(v)); } catch (e) {}
  }
  function bindTap(elm, fn) {
    if (!elm) return;
    elm.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { elm.setPointerCapture(e.pointerId); } catch (err) {}
      elm.classList.add('is-pressed');
      buzz();
      unlock();
      fn(e);
    });
    const release = function () { elm.classList.remove('is-pressed'); };
    elm.addEventListener('pointerup', release);
    elm.addEventListener('pointercancel', release);
  }
  function paintHud() {
    const playing = SCREEN === 'pick' || SCREEN === 'done' || SCREEN === 'end';
    hudCase.textContent = playing && G.no ? String(G.no).padStart(2, '0') : '--';
    hudScore.textContent = String(playing ? (G.score || 0) : 0).padStart(6, '0');
    const life = playing ? (G.life || 0) : 3;
    hudLife.textContent = '♥'.repeat(life) + '♡'.repeat(Math.max(0, 3 - life));
    hudLife.setAttribute('aria-label', '残りハート' + life);
  }
  function paintCur() {
    dossier.querySelectorAll('.row').forEach(function (b) {
      b.classList.toggle('cur', +b.dataset.i === CUR);
    });
  }
  function clearDossier() {
    while (dossier.firstChild) dossier.removeChild(dossier.firstChild);
  }

  function titleScreen() {
    SCREEN = 'title';
    PAUSED = false;
    pauseEl.classList.remove('show');
    MOOD = 0.48;
    G = {};
    clearDossier();
    const block = el('div', 'title-block');
    block.appendChild(el('h1', null, 'ウソつきを探せ！'));
    block.appendChild(el('p', null, '取調室に集められた容疑者たち。ウソつきは1人だけ。'));
    const rules = el('p', null, '証言を読んでウソを当てる。当たれば犯人も。外すとハートが減る。全' + TOTAL + '事件。ハイスコア ' + best() + '点。');
    block.appendChild(rules);
    dossier.appendChild(block);
    const go = el('button', 'btn', '取り調べを始める');
    go.id = 'go';
    go.type = 'button';
    dossier.appendChild(go);
    bindTap(go, startGame);
    setHint('A でスタート');
    paintHud();
  }

  function startGame() {
    if (SCREEN !== 'title') return;
    beep(880, 0.08);
    G = { no: 0, score: 0, life: 3 };
    nextCase();
  }

  function nextCase() {
    if (G.no >= TOTAL || G.life <= 0) return endScreen();
    G.no++;
    const n = G.no <= 3 ? 3 : G.no <= 7 ? 4 : 5;
    let p = null;
    for (let i = 0; i < 8 && !p; i++) p = makePuzzle(n);
    if (!p) { G.no--; return; }
    G.n = n;
    G.p = p;
    G.phase = 'liar';
    G.caseText = CASES[rnd(CASES.length)];
    G.t0 = Date.now();
    CUR = 0;
    MOOD = 1;
    renderCase();
  }

  function renderCase() {
    SCREEN = G.phase === 'done' ? 'done' : 'pick';
    clearDossier();
    dossier.appendChild(el('p', 'case-line', '事件ファイル No.' + String(G.no).padStart(3, '0') + '　だれかが' + G.caseText + '。'));
    const ask = G.phase === 'liar' ? 'ウソつきは1人だけ。だれ？' : G.phase === 'culprit' ? '正解。犯人はだれ？' : '';
    if (ask) dossier.appendChild(el('p', 'ask', ask));
    const reveal = G.phase === 'done';
    for (let s = 0; s < G.n; s++) {
      const x = G.p.st[s];
      const said = x.t.txt(s, x.args[0], x.args[1]);
      const row = el('button', 'row');
      row.type = 'button';
      row.dataset.i = String(s);
      if (reveal) row.disabled = true;
      if (!reveal && s === CUR) row.classList.add('cur');
      if ((G.phase === 'culprit' && s === G.pickL) || (reveal && s === G.p.L)) row.classList.add('lit');
      const sw = el('i', 'swatch');
      sw.style.background = rampCss(CLOTH_R[s]);
      sw.style.boxShadow = 'inset 0 7px 0 ' + rampCss(HAIR_R[s]);
      row.appendChild(sw);
      row.appendChild(el('span', 'who', N(s)));
      row.appendChild(el('span', 'line', '「' + said + '」'));
      if (reveal) row.appendChild(el('span', s === G.p.L ? 'mark f' : 'mark t', s === G.p.L ? 'ウソ' : '本当'));
      if (reveal && s === G.p.c) row.appendChild(el('span', 'stamp', '犯人'));
      dossier.appendChild(row);
      if (!reveal) bindTap(row, function () { CUR = s; pick(s); });
    }
    if (reveal) {
      const box = el('div', 'result');
      String(G.msg || '').split('\n').forEach(function (line, idx) {
        if (idx) box.appendChild(document.createElement('br'));
        box.appendChild(document.createTextNode(line));
      });
      dossier.appendChild(box);
      const nx = el('button', 'btn', G.no >= TOTAL || G.life <= 0 ? '結果を見る' : '次の事件へ');
      nx.id = 'nx';
      nx.type = 'button';
      dossier.appendChild(nx);
      bindTap(nx, nextCase);
    }
    setHint(reveal ? 'A で次へ' : '十字キーで選ぶ / A で決定');
    paintHud();
  }

  function pick(i) {
    if (SCREEN !== 'pick' || !G.p) return;
    const p = G.p;
    if (G.phase === 'liar') {
      G.pickL = i;
      if (i === p.L) {
        const sec = (Date.now() - G.t0) / 1000;
        const bonus = Math.max(0, Math.round(60 - sec));
        beep(1320, 0.12);
        G.score += 100 + bonus;
        G.gain = 'ウソつき的中 +100／スピード +' + bonus;
        G.phase = 'culprit';
        renderCase();
      } else {
        beep(160, 0.25, 'sawtooth');
        G.life--;
        G.phase = 'done';
        G.msg = 'ざんねん。' + N(i) + 'は本当のことを言っていた。\nウソつきは' + N(p.L) + '。この証言だけをウソにすると、犯人は' + N(p.c) + 'になる。';
        renderCase();
      }
    } else if (G.phase === 'culprit') {
      G.pickC = i;
      G.phase = 'done';
      let m = G.gain || '';
      if (i === p.c) { beep(1560, 0.16); G.score += 50; m += '／犯人も的中 +50'; }
      else { beep(220, 0.18, 'triangle'); m += '／犯人は' + N(p.c) + 'だった'; }
      G.msg = m + '\n' + N(p.L) + 'の証言だけがウソ。残りを本当として読むと、犯人は' + N(p.c) + 'に絞れる。';
      renderCase();
    }
  }

  function endScreen() {
    saveBest(G.score || 0);
    SCREEN = 'end';
    MOOD = 0.7;
    const s = G.score || 0;
    const rank = s >= 1400 ? '名探偵' : s >= 1000 ? '敏腕刑事' : s >= 600 ? '見習い刑事' : '新人巡査';
    clearDossier();
    const block = el('div', 'title-block');
    block.appendChild(el('h1', null, '取り調べ終了'));
    block.appendChild(el('p', null, 'スコア ' + s + ' 点'));
    block.appendChild(el('p', null, '称号：' + rank));
    block.appendChild(el('p', null, 'ハイスコア ' + best() + ' 点'));
    dossier.appendChild(block);
    const again = el('button', 'btn', 'もう一度');
    again.id = 'again';
    again.type = 'button';
    dossier.appendChild(again);
    bindTap(again, titleScreen);
    setHint('A でもう一度');
    paintHud();
  }

  function showPause(v) {
    if (v && SCREEN === 'title') return;
    PAUSED = v;
    pauseEl.classList.toggle('show', v);
    setHint(v ? 'ポーズ中  B でもどる' : (SCREEN === 'pick' ? '十字キーで選ぶ / A で決定' : ''));
    beep(v ? 420 : 640, 0.07);
    if (v) bgmStop();
    else if (!MUTE) bgmStart();
  }
  function pressA() {
    if (PAUSED) { showPause(false); return; }
    if (SCREEN === 'title') { startGame(); return; }
    if (SCREEN === 'pick') { beep(990, 0.05); pick(CUR); return; }
    if (SCREEN === 'done') { nextCase(); return; }
    if (SCREEN === 'end') { titleScreen(); return; }
  }
  function moveCur(d) {
    if (PAUSED || SCREEN !== 'pick' || !G.n) return;
    CUR = (CUR + d + G.n) % G.n;
    beep(720, 0.03);
    paintCur();
  }
  subs.push(function (btn, phase) {
    if (phase === 'up') return;
    if (btn === 'up' || btn === 'left') moveCur(-1);
    else if (btn === 'down' || btn === 'right') moveCur(1);
    else if (btn === 'a' && phase === 'down') pressA();
    else if (btn === 'b' && phase === 'down') {
      if (PAUSED) showPause(false);
      else beep(300, 0.05);
    } else if (btn === 'start' && phase === 'down' && SCREEN !== 'title') showPause(!PAUSED);
    else if (btn === 'select' && phase === 'down') setMute(!MUTE);
  });
  bindTap(document.getElementById('pv-resume'), function () { showPause(false); });
  bindTap(document.getElementById('pv-title'), function () { showPause(false); titleScreen(); });

  view.addEventListener('pointerdown', function (e) {
    if (PAUSED || SCREEN !== 'pick') return;
    const rect = view.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * GW;
    const y = (e.clientY - rect.top) / rect.height * GH;
    let bestI = -1, bd = 16 * 16;
    for (let i = 0; i < heads.length; i++) {
      const dx = heads[i].x - x, dy = heads[i].y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bestI = heads[i].i; }
    }
    if (bestI >= 0) { CUR = bestI; pick(bestI); }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      Object.keys(held).forEach(up);
      bgmStop();
      if (AC && AC.state === 'running') AC.suspend();
      if (SCREEN !== 'title' && !PAUSED) showPause(true);
    }
  });

  let lastTouch = 0;
  document.addEventListener('touchend', function (e) {
    const now = Date.now();
    if (now - lastTouch <= 300) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
  document.addEventListener('touchmove', function (e) {
    if (e.target.closest('[data-scrollable]')) return;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('selectstart', function (e) { e.preventDefault(); });

  let recOn = true;
  let frozen = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!PAUSED) frozen = now;
    const playing = SCREEN === 'pick' || SCREEN === 'done' || SCREEN === 'end';
    const n = playing && G.n ? G.n : 0;
    const target = n ? seats(n)[Math.max(0, Math.min(n - 1, CUR))] * 0.26 : 0;
    lookX += (target - lookX) * 0.12;
    aim(lookX * 0.1, 1.32, 2.32, lookX * 0.4, 1.0, 0.02);
    clearBuf();
    for (let i = 0; i < room.length; i++) shadeTri(room[i]);
    buildDynamic(frozen);
    for (let i = 0; i < dynN; i++) shadeTri(dyn[i]);
    present();
    const on = (Math.floor(now / 480) % 2) === 0;
    if (on !== recOn) { recOn = on; recEl.style.visibility = on ? 'visible' : 'hidden'; }
  }

  titleScreen();
  requestAnimationFrame(frame);
  window.addEventListener('load', fit);
})();
