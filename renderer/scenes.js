// Counter Launcher â€“ animated pixel backgrounds ("Szenen"): campfire, aurora, thunderstorm, the End, underwater and
// sunset. Each scene draws one frame into a small canvas (3 screen pixels per pixel) and keeps its particles in `st`.
// The same draw functions render the thumbnails in the background gallery.

const SCENES = {};
const srand = (seed) => {
  let x = seed * 9301 + 49297;
  return () => ((x = (x * 9301 + 49297) % 233280) / 233280);
};
const lerp = (a, b, k) => a + (b - a) * k;
const mixRgb = (a, b, k) => a.map((v, i) => Math.round(lerp(v, b[i], k)));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function skyGradient(g, w, hh, top, bottom, to = 1) {
  const gr = g.createLinearGradient(0, 0, 0, hh * to);
  gr.addColorStop(0, rgb(top));
  gr.addColorStop(1, rgb(bottom));
  g.fillStyle = gr;
  g.fillRect(0, 0, w, hh);
}
function stars(g, w, hh, st, t, count, maxY = 0.6, tint = [255, 255, 255]) {
  if (!st.stars || st.stars.w !== w) {
    const r = srand(7);
    st.stars = Array.from({ length: count }, () => [Math.floor(r() * w), Math.floor(r() * hh * maxY), r() * 6, r()]);
    st.stars.w = w;
  }
  for (const [x, y, p, b] of st.stars) {
    g.fillStyle = rgb(tint, (0.2 + 0.6 * b) * (0.55 + 0.45 * Math.sin(t / 900 + p)));
    g.fillRect(x, y, 1, 1);
  }
}
/** blocky silhouette line: returns heights per column */
function ridge(w, seed, base, amp, step = 2, freq = [37, 13, 71]) {
  const r = srand(seed);
  const p = [r() * 9, r() * 9, r() * 9];
  const out = [];
  for (let x = 0; x < w; x += step) {
    const n = Math.sin(x / freq[0] + p[0]) * 0.5 + Math.sin(x / freq[1] + p[1]) * 0.25 + Math.sin(x / freq[2] + p[2]) * 0.6;
    out.push(Math.round(base - n * amp));
  }
  return out;
}
function fillRidge(g, hh, line, color, step = 2) {
  g.fillStyle = color;
  line.forEach((y, i) => g.fillRect(i * step, y, step, hh - y));
}
function pines(g, line, seed, color, chance, step = 2, size = 1) {
  const r = srand(seed);
  g.fillStyle = color;
  line.forEach((y, i) => {
    if (r() > chance) return;
    const x = i * step;
    const th = Math.round((3 + r() * 3) * size);
    g.fillRect(x, y - th, 1, th);
    for (let k = 0; k < 4 * size; k++) g.fillRect(x - Math.floor(k / size), y - th - 8 * size + k * 2, 1 + Math.floor(k / size) * 2, 2);
  });
}
function vignette(g, w, hh, a = 0.55) {
  const gr = g.createRadialGradient(w / 2, hh * 0.55, Math.min(w, hh) * 0.3, w / 2, hh * 0.55, Math.max(w, hh) * 0.75);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, `rgba(0,0,0,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, hh);
}
function particles(st, key, max, spawn, dt) {
  const list = (st[key] ||= []);
  while (list.length < max) list.push(spawn(true));
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life > p.max) list[i] = spawn(false);
  }
  return list;
}

// ================================================================= campfire
SCENES.campfire = {
  name: 'Lagerfeuer',
  draw(g, w, hh, t, st, dt, acc) {
    const gy = Math.round(hh * 0.8);
    const fx = Math.round(w * 0.64);
    const flick = 0.9 + 0.1 * Math.sin(t / 90) * Math.sin(t / 37 + 1);
    skyGradient(g, w, hh, [6, 5, 14], mixRgb([24, 14, 40], acc, 0.18), 0.8);
    stars(g, w, hh, st, t, 140, 0.55);
    g.fillStyle = 'rgba(230,230,250,0.9)';
    g.fillRect(Math.round(w * 0.8), Math.round(hh * 0.13), 6, 6);
    g.fillStyle = 'rgba(230,230,250,0.12)';
    g.fillRect(Math.round(w * 0.8) - 3, Math.round(hh * 0.13) - 3, 12, 12);
    if (!st.far || st.far.w !== w) {
      st.far = ridge(w, 3, hh * 0.64, hh * 0.08);
      st.mid = ridge(w, 4, hh * 0.74, hh * 0.05);
      st.far.w = w;
    }
    fillRidge(g, hh, st.far, rgb(mixRgb([20, 14, 34], acc, 0.12)));
    pines(g, st.far, 11, rgb(mixRgb([18, 12, 30], acc, 0.1)), 0.12);
    fillRidge(g, hh, st.mid, 'rgb(13,10,22)');
    pines(g, st.mid, 12, 'rgb(11,8,18)', 0.18, 2, 2);
    // ground: grass blocks, lit by the fire
    for (let x = 0; x < w; x += 8) {
      const d = Math.abs(x + 4 - fx) / (w * 0.35);
      const lit = Math.max(0, 1 - d) * flick;
      g.fillStyle = rgb(mixRgb([22, 38, 22], [120, 90, 40], lit * 0.7));
      g.fillRect(x, gy, 8, 2);
      g.fillStyle = rgb(mixRgb([30, 20, 14], [110, 60, 30], lit * 0.6));
      g.fillRect(x, gy + 2, 8, hh - gy);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 7, gy, 1, hh - gy);
      for (let y = gy + 8; y < hh; y += 8) g.fillRect(x, y, 8, 1);
    }
    // glow
    g.globalCompositeOperation = 'lighter';
    const rad = hh * 0.55 * flick;
    const glow = g.createRadialGradient(fx, gy - 6, 2, fx, gy - 6, rad);
    glow.addColorStop(0, 'rgba(255,150,60,0.42)');
    glow.addColorStop(0.35, 'rgba(255,100,30,0.14)');
    glow.addColorStop(1, 'rgba(255,80,20,0)');
    g.fillStyle = glow;
    g.fillRect(fx - rad, gy - 6 - rad, rad * 2, rad * 2);
    g.globalCompositeOperation = 'source-over';
    // seats (logs) and the campfire block
    g.fillStyle = 'rgb(70,44,26)';
    g.fillRect(fx - 34, gy - 3, 16, 3);
    g.fillRect(fx + 20, gy - 3, 16, 3);
    g.fillStyle = 'rgb(110,72,40)';
    g.fillRect(fx - 34, gy - 3, 16, 1);
    g.fillRect(fx + 20, gy - 3, 16, 1);
    g.fillStyle = 'rgb(60,38,22)';
    g.fillRect(fx - 8, gy - 2, 16, 2);
    g.fillRect(fx - 6, gy - 4, 12, 2);
    g.fillStyle = 'rgb(40,24,14)';
    g.fillRect(fx - 4, gy - 4, 8, 1);
    // flames
    for (let x = -6; x <= 6; x++) {
      const taper = 1 - Math.abs(x) / 7;
      const n = Math.sin(t / 110 + x * 1.7) * 0.5 + Math.sin(t / 53 + x * 3.1) * 0.3 + 0.8;
      const fh = Math.max(1, Math.round(16 * taper * n * flick));
      for (let y = 0; y < fh; y++) {
        const k = y / fh;
        const col = k < 0.3 ? [255, 240, 170] : k < 0.65 ? [255, 170, 50] : [255, 80, 20];
        g.fillStyle = rgb(col, k > 0.85 ? 0.6 : 1);
        g.fillRect(fx + x, gy - 4 - y, 1, 1);
      }
    }
    // sparks and smoke
    const r = Math.random;
    const sparks = particles(st, 'sparks', 26, (init) => ({ x: fx + (r() - 0.5) * 8, y: gy - 6 - (init ? r() * 40 : 0), vx: (r() - 0.5) * 0.006, vy: -0.012 - r() * 0.02, life: 0, max: 1500 + r() * 2000, p: r() * 6 }), dt);
    for (const p of sparks) {
      g.fillStyle = `rgba(255,${150 + ((p.p * 30) | 0)},60,${(1 - p.life / p.max).toFixed(2)})`;
      g.fillRect(Math.round(p.x + Math.sin(p.life / 300 + p.p) * 2), Math.round(p.y), 1, 1);
    }
    const smoke = particles(st, 'smoke', 14, (init) => ({ x: fx + (r() - 0.5) * 4, y: gy - 18 - (init ? r() * 60 : 0), vx: 0.002 + r() * 0.003, vy: -0.01 - r() * 0.006, life: 0, max: 5000 + r() * 3000 }), dt);
    for (const p of smoke) {
      const k = p.life / p.max;
      const s = 2 + Math.round(k * 6);
      g.fillStyle = `rgba(160,150,170,${(0.09 * (1 - k)).toFixed(3)})`;
      g.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
    // fireflies
    const flies = particles(st, 'flies', 10, () => ({ x: r() * w, y: hh * (0.6 + r() * 0.15), vx: (r() - 0.5) * 0.008, vy: (r() - 0.5) * 0.004, life: 0, max: 4000 + r() * 4000, p: r() * 6 }), dt);
    for (const p of flies) {
      g.fillStyle = `rgba(200,255,120,${(0.4 + 0.5 * Math.sin(t / 400 + p.p)).toFixed(2)})`;
      g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    vignette(g, w, hh, 0.6);
  },
};

// ================================================================= aurora
SCENES.aurora = {
  name: 'Polarlicht',
  draw(g, w, hh, t, st, dt, acc) {
    skyGradient(g, w, hh, [3, 8, 18], [10, 26, 40], 0.85);
    stars(g, w, hh, st, t, 160, 0.7);
    g.globalCompositeOperation = 'lighter';
    for (let band = 0; band < 3; band++) {
      const base = hh * (0.18 + band * 0.09);
      const col = band === 1 ? acc : band === 0 ? [60, 255, 160] : [80, 200, 255];
      for (let x = 0; x < w; x += 1) {
        const y = base + Math.sin(x / 47 + t / 2600 + band * 2) * hh * 0.06 + Math.sin(x / 13 + t / 900 + band) * 3;
        const len = hh * (0.12 + 0.06 * Math.sin(x / 23 + t / 1500 + band));
        const a = 0.05 + 0.05 * Math.sin(x / 9 + t / 700 + band * 3);
        const gr = g.createLinearGradient(0, y, 0, y + len);
        gr.addColorStop(0, rgb(col, 0));
        gr.addColorStop(0.3, rgb(col, Math.max(0, a)));
        gr.addColorStop(1, rgb(col, 0));
        g.fillStyle = gr;
        g.fillRect(x, y, 1, len);
      }
    }
    g.globalCompositeOperation = 'source-over';
    if (!st.mtn || st.mtn.w !== w) {
      st.mtn = ridge(w, 21, hh * 0.6, hh * 0.1, 2, [29, 9, 61]);
      st.hill = ridge(w, 22, hh * 0.8, hh * 0.04);
      st.mtn.w = w;
    }
    st.mtn.forEach((y, i) => {
      g.fillStyle = 'rgb(16,24,38)';
      g.fillRect(i * 2, y, 2, hh - y);
      g.fillStyle = 'rgba(170,190,220,0.6)';
      if (y < hh * 0.6) g.fillRect(i * 2, y, 2, Math.max(1, Math.round((hh * 0.6 - y) * 0.35)));
    });
    fillRidge(g, hh, st.hill, 'rgb(58,70,96)');
    g.fillStyle = 'rgba(30,36,56,0.6)';
    st.hill.forEach((y, i) => g.fillRect(i * 2, y + 6, 2, hh));
    pines(g, st.hill, 23, 'rgb(10,22,26)', 0.2, 2, 2);
    g.fillStyle = 'rgba(150,175,215,0.5)';
    st.hill.forEach((y, i) => g.fillRect(i * 2, y, 2, 1));
    vignette(g, w, hh, 0.5);
  },
};

// ================================================================= thunderstorm
SCENES.storm = {
  name: 'Gewitter',
  draw(g, w, hh, t, st, dt, acc) {
    skyGradient(g, w, hh, [10, 11, 18], [28, 30, 42], 0.8);
    if (!st.next) st.next = t + 3000;
    if (t > st.next) {
      st.flash = t;
      st.next = t + 5000 + Math.random() * 9000;
      const r = srand(Math.floor(t));
      let x = w * (0.2 + r() * 0.6);
      st.bolt = [[x, 0]];
      for (let y = 0; y < hh * 0.75; y += 6) {
        x += (r() - 0.5) * 14;
        st.bolt.push([x, y]);
      }
    }
    const since = t - (st.flash || -99999);
    if (since < 600) {
      const a = since < 80 ? 0.55 : since < 160 ? 0.1 : since < 240 ? 0.4 : 0.4 * (1 - since / 600);
      g.fillStyle = `rgba(200,210,255,${Math.max(0, a).toFixed(2)})`;
      g.fillRect(0, 0, w, hh);
      if (since < 260) {
        g.strokeStyle = 'rgba(240,240,255,0.95)';
        g.lineWidth = 1;
        g.beginPath();
        st.bolt.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      }
    }
    // clouds
    for (let layer = 0; layer < 3; layer++) {
      const r = srand(30 + layer);
      for (let k = 0; k < 9; k++) {
        const cw = 40 + r() * 70;
        const x = ((r() * w * 1.4 + (t / (90 - layer * 25))) % (w * 1.4)) - w * 0.2;
        const y = hh * (0.04 + layer * 0.07 + r() * 0.06);
        g.fillStyle = `rgba(${18 + layer * 10},${19 + layer * 10},${28 + layer * 12},0.85)`;
        g.fillRect(Math.round(x), Math.round(y), Math.round(cw), 6);
        g.fillRect(Math.round(x + 6), Math.round(y - 3), Math.round(cw * 0.6), 3);
        g.fillRect(Math.round(x + 10), Math.round(y + 6), Math.round(cw * 0.7), 3);
      }
    }
    if (!st.hills || st.hills.w !== w) {
      st.hills = ridge(w, 41, hh * 0.72, hh * 0.06);
      st.near = ridge(w, 42, hh * 0.84, hh * 0.03);
      st.hills.w = w;
    }
    fillRidge(g, hh, st.hills, 'rgb(16,20,26)');
    pines(g, st.hills, 43, 'rgb(12,15,20)', 0.15, 2, 2);
    // a small house with a lit window
    const hx = Math.round(w * 0.68), hy = st.hills[Math.floor(hx / 2)];
    g.fillStyle = 'rgb(20,16,14)';
    g.fillRect(hx, hy - 10, 14, 10);
    g.fillRect(hx - 1, hy - 12, 16, 2);
    g.fillRect(hx + 1, hy - 14, 12, 2);
    g.fillStyle = `rgba(255,190,90,${(0.75 + 0.2 * Math.sin(t / 300)).toFixed(2)})`;
    g.fillRect(hx + 4, hy - 7, 3, 3);
    fillRidge(g, hh, st.near, 'rgb(14,22,16)');
    // rain
    const r = Math.random;
    const drops = particles(st, 'rain', 220, (init) => ({ x: r() * (w + 60), y: init ? r() * hh : -10, vx: -0.06, vy: 0.32 + r() * 0.12, life: 0, max: 99999 }), dt);
    g.fillStyle = 'rgba(150,170,210,0.35)';
    for (const p of drops) {
      if (p.y > hh) {
        p.y = -10;
        p.x = r() * (w + 60);
      }
      g.fillRect(Math.round(p.x), Math.round(p.y), 1, 4);
    }
    vignette(g, w, hh, 0.55);
  },
};

// ================================================================= the End
SCENES.end = {
  name: 'Das Ende',
  draw(g, w, hh, t, st, dt, acc) {
    skyGradient(g, w, hh, [8, 4, 14], mixRgb([26, 14, 40], acc, 0.25));
    stars(g, w, hh, st, t, 220, 1, [230, 200, 255]);
    if (!st.isl || st.isl.w !== w) {
      const r = srand(51);
      st.isl = Array.from({ length: 6 }, (_, i) => ({ x: r() * w, y: hh * (0.35 + r() * 0.45), s: 10 + r() * (i === 0 ? 50 : 22), p: r() * 6 }));
      st.isl.sort((a, b) => a.s - b.s);
      st.isl.w = w;
    }
    for (const isl of st.isl) {
      const y = isl.y + Math.sin(t / 2400 + isl.p) * 3;
      const s = Math.round(isl.s);
      for (let k = 0; k < s / 2; k += 2) {
        const width = Math.round(s * 2 * (1 - k / s));
        g.fillStyle = k === 0 ? 'rgb(222,222,160)' : `rgb(${150 - k * 3},${148 - k * 3},${100 - k * 2})`;
        g.fillRect(Math.round(isl.x - width / 2), Math.round(y + k), width, 2);
      }
      if (isl.s > 40) {
        // obsidian pillars with crystals
        for (const off of [-0.6, 0, 0.55]) {
          const px = Math.round(isl.x + off * isl.s), ph = Math.round(isl.s * (0.9 + Math.abs(off)));
          g.fillStyle = 'rgb(22,14,34)';
          g.fillRect(px - 3, Math.round(y - ph), 6, ph);
          g.fillStyle = `rgba(255,140,255,${(0.6 + 0.4 * Math.sin(t / 300 + off * 5)).toFixed(2)})`;
          g.fillRect(px - 1, Math.round(y - ph - 4), 3, 3);
          g.fillStyle = 'rgba(255,140,255,0.15)';
          g.fillRect(px - 4, Math.round(y - ph - 7), 9, 9);
        }
      }
    }
    const r = Math.random;
    const rods = particles(st, 'rods', 40, (init) => ({ x: r() * w, y: init ? r() * hh : hh + 2, vx: (r() - 0.5) * 0.004, vy: -0.004 - r() * 0.008, life: 0, max: 20000 }), dt);
    for (const p of rods) {
      if (p.y < -2) Object.assign(p, { y: hh + 2, x: r() * w });
      g.fillStyle = 'rgba(240,230,255,0.7)';
      g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    vignette(g, w, hh, 0.5);
  },
};

// ================================================================= underwater
SCENES.ocean = {
  name: 'Unterwasser',
  draw(g, w, hh, t, st, dt, acc) {
    skyGradient(g, w, hh, [14, 70, 110], [3, 16, 30]);
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 7; k++) {
      const x = ((k * w) / 6 + Math.sin(t / 3000 + k) * 20) % (w + 40);
      g.fillStyle = `rgba(120,200,255,${(0.035 + 0.02 * Math.sin(t / 1200 + k * 2)).toFixed(3)})`;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 14, 0);
      g.lineTo(x - 30, hh);
      g.lineTo(x - 52, hh);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    const floor = Math.round(hh * 0.86);
    if (!st.sand || st.sand.w !== w) {
      st.sand = ridge(w, 61, floor, 3);
      st.sand.w = w;
      const r = srand(62);
      st.kelp = Array.from({ length: Math.round(w / 18) }, () => ({ x: r() * w, hgt: 20 + r() * hh * 0.35, p: r() * 6, c: r() < 0.5 }));
    }
    fillRidge(g, hh, st.sand, 'rgb(150,136,96)');
    g.fillStyle = 'rgba(0,0,0,0.25)';
    st.sand.forEach((y, i) => g.fillRect(i * 2, y + 3, 2, hh));
    for (const k of st.kelp) {
      for (let y = 0; y < k.hgt; y += 2) {
        const sway = Math.sin(t / 1400 + k.p + y / 18) * (y / k.hgt) * 6;
        g.fillStyle = k.c ? 'rgb(40,110,60)' : 'rgb(30,90,70)';
        g.fillRect(Math.round(k.x + sway), floor - y, 2, 2);
      }
    }
    if (!st.fish) {
      const r = srand(63);
      st.fish = Array.from({ length: 6 }, () => ({ y: hh * (0.2 + r() * 0.5), sp: 0.01 + r() * 0.02, off: r() * 2000, c: [[255, 140, 60], [80, 200, 255], [255, 220, 90], acc][Math.floor(r() * 4)] }));
    }
    for (const f of st.fish) {
      const x = ((t * f.sp + f.off) % (w + 40)) - 20;
      const y = Math.round(f.y + Math.sin(t / 700 + f.off) * 4);
      g.fillStyle = rgb(f.c);
      g.fillRect(Math.round(x), y, 5, 3);
      g.fillRect(Math.round(x) - 2, y - 1, 2, 5);
      g.fillStyle = '#000';
      g.fillRect(Math.round(x) + 4, y, 1, 1);
    }
    const r = Math.random;
    const bubbles = particles(st, 'bub', 30, (init) => ({ x: r() * w, y: init ? r() * hh : floor, vx: 0, vy: -0.01 - r() * 0.02, life: 0, max: 99999, p: r() * 6 }), dt);
    for (const p of bubbles) {
      if (p.y < 0) Object.assign(p, { y: floor, x: r() * w });
      g.fillStyle = 'rgba(200,240,255,0.45)';
      g.fillRect(Math.round(p.x + Math.sin(p.y / 10 + p.p) * 1.5), Math.round(p.y), 1, 1);
    }
    vignette(g, w, hh, 0.5);
  },
};

// ================================================================= sunset
SCENES.sunset = {
  name: 'Sonnenuntergang',
  draw(g, w, hh, t, st, dt, acc) {
    const gr = g.createLinearGradient(0, 0, 0, hh);
    gr.addColorStop(0, rgb(mixRgb([40, 20, 70], acc, 0.25)));
    gr.addColorStop(0.5, 'rgb(220,90,80)');
    gr.addColorStop(0.75, 'rgb(255,170,90)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, hh);
    const sx = Math.round(w * 0.62), sy = Math.round(hh * 0.66), sr = Math.round(hh * 0.055);
    for (const [k, a] of [[14, 0.06], [9, 0.1], [4, 0.2]]) {
      g.fillStyle = `rgba(255,220,140,${a})`;
      g.fillRect(sx - sr - k, sy - sr - k, sr * 2 + k * 2, sr * 2 + k * 2);
    }
    g.fillStyle = 'rgb(255,226,140)';
    g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    for (let layer = 0; layer < 2; layer++) {
      const r = srand(70 + layer);
      for (let k = 0; k < 7; k++) {
        const cw = 30 + r() * 60;
        const x = ((r() * w * 1.4 + t / (160 - layer * 60)) % (w * 1.4)) - w * 0.2;
        const y = hh * (0.12 + layer * 0.14 + r() * 0.12);
        g.fillStyle = layer ? 'rgba(255,170,150,0.55)' : 'rgba(170,90,130,0.6)';
        g.fillRect(Math.round(x), Math.round(y), Math.round(cw), 3);
        g.fillRect(Math.round(x + 5), Math.round(y - 2), Math.round(cw * 0.5), 2);
      }
    }
    if (!st.h1 || st.h1.w !== w) {
      st.h1 = ridge(w, 81, hh * 0.72, hh * 0.06);
      st.h2 = ridge(w, 82, hh * 0.82, hh * 0.05);
      st.h1.w = w;
    }
    fillRidge(g, hh, st.h1, 'rgb(120,50,70)');
    pines(g, st.h1, 83, 'rgb(100,40,60)', 0.1);
    fillRidge(g, hh, st.h2, 'rgb(50,20,40)');
    pines(g, st.h2, 84, 'rgb(40,16,32)', 0.15, 2, 2);
    // birds
    for (let k = 0; k < 4; k++) {
      const x = ((t / 40 + k * 37) % (w + 30)) - 15;
      const y = Math.round(hh * 0.3 + k * 6 + Math.sin(t / 500 + k) * 3);
      const wing = Math.sin(t / 120 + k) > 0 ? -1 : 0;
      g.fillStyle = 'rgba(40,20,40,0.8)';
      g.fillRect(Math.round(x), y, 1, 1);
      g.fillRect(Math.round(x) - 2, y + wing, 2, 1);
      g.fillRect(Math.round(x) + 1, y + wing, 2, 1);
    }
    vignette(g, w, hh, 0.45);
  },
};

// ================================================================= runner
const sceneCanvas = h('canvas', { id: 'scene' });
document.getElementById('sky').before(sceneCanvas);
const sceneState = {};
let sceneLast = 0;
let sceneFrame = 0;
const sceneKey = () => (state && state.settings ? theme().bg : null);
function scenePaused() {
  return document.hidden || (opt('pauseInGame', true) && state.running.length > 0);
}
(function sceneLoop(t) {
  requestAnimationFrame(sceneLoop);
  const key = sceneKey();
  const scene = SCENES[key];
  sceneCanvas.style.display = scene ? '' : 'none';
  if (!scene) return;
  const fps = document.body.classList.contains('no-motion') ? 2 : opt('sceneFps', 30);
  if (t - sceneLast < 1000 / fps) return;
  if (scenePaused() && sceneFrame > 0) return;
  const dt = Math.min(100, t - sceneLast);
  sceneLast = t;
  sceneFrame++;
  const S = 3;
  const w = Math.ceil(innerWidth / S), hh = Math.ceil(innerHeight / S);
  if (sceneCanvas.width !== w || sceneCanvas.height !== hh) {
    sceneCanvas.width = w;
    sceneCanvas.height = hh;
  }
  const g = sceneCanvas.getContext('2d');
  const st = (sceneState[key] ||= {});
  scene.draw(g, w, hh, t, st, dt, accentRgb());
})(0);

/** a still frame of a scene for the gallery (particles simulated for a moment) */
function sceneThumb(key, w = 120, hh = 70) {
  const c = h('canvas', { width: w, height: hh, class: 'bg-thumb' });
  const g = c.getContext('2d');
  const st = {};
  const acc = accentRgb();
  for (let k = 0; k < 40; k++) SCENES[key].draw(g, w, hh, 4000 + k * 33, st, 33, acc);
  return c;
}
