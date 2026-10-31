// Counter 2.0 scenes: five more animated pixel backgrounds (same draw interface as scenes.js).

SCENES.snow = {
  name: 'Schneenacht',
  draw(g, w, hh, t, st, dt, acc) {
    skyGradient(g, w, hh, [8, 12, 28], mixRgb([30, 44, 80], acc, 0.2));
    stars(g, w, hh, st, t, 90, 0.5, [220, 235, 255]);
    if (!st.f || st.f.w !== w) {
      const r = srand(81);
      st.f = Array.from({ length: Math.floor(w / 3) }, () => ({ x: r() * w, y: r() * hh, v: 4 + r() * 10, z: r(), p: r() * 6 }));
      st.f.w = w;
    }
    const ground = hh * 0.9;
    const hills = ridge(w, 5, ground, 6);
    g.fillStyle = 'rgb(222,232,246)';
    hills.forEach((y, i) => g.fillRect(i * 2, y, 2, hh - y));
    for (const f of st.f) {
      f.y += (f.v * dt) / 1000 * (0.5 + f.z);
      f.x += Math.sin(t / 1300 + f.p) * 0.15;
      if (f.y > ground) { f.y = -2; f.x = Math.random() * w; }
      g.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * f.z})`;
      g.fillRect(Math.floor(f.x), Math.floor(f.y), f.z > 0.7 ? 2 : 1, f.z > 0.7 ? 2 : 1);
    }
  },
};

SCENES.matrix = {
  name: 'Datenregen',
  draw(g, w, hh, t, st, dt, acc) {
    g.fillStyle = 'rgba(4,8,6,0.22)';
    g.fillRect(0, 0, w, hh);
    if (!st.c || st.c.w !== w) {
      const r = srand(23);
      st.c = Array.from({ length: Math.floor(w / 3) }, (_, i) => ({ x: i * 3, y: r() * hh, v: 20 + r() * 50, len: 6 + Math.floor(r() * 14) }));
      st.c.w = w;
      g.fillStyle = 'rgb(4,8,6)';
      g.fillRect(0, 0, w, hh);
    }
    for (const c of st.c) {
      c.y += (c.v * dt) / 1000;
      if (c.y - c.len > hh) { c.y = 0; c.v = 20 + Math.random() * 50; }
      for (let k = 0; k < c.len; k++) {
        g.fillStyle = rgb(mixRgb(acc, [255, 255, 255], k === 0 ? 0.8 : 0), 1 - k / c.len);
        if (((Math.floor(t / 90) + c.x + k * 7) & 3) !== 0 || k === 0) g.fillRect(c.x, Math.floor(c.y - k * 2), 1, 2);
      }
    }
  },
};

SCENES.nebula = {
  name: 'Nebel',
  draw(g, w, hh, t, st, dt, acc) {
    g.fillStyle = 'rgb(5,5,12)';
    g.fillRect(0, 0, w, hh);
    const blobs = [[0.25, 0.35, 0.5, acc, 0.5], [0.7, 0.3, 0.45, mixRgb(acc, [60, 160, 255], 0.7), 0.4], [0.5, 0.75, 0.5, mixRgb(acc, [255, 90, 170], 0.6), 0.35]];
    blobs.forEach(([bx, by, br, col, a], i) => {
      const x = (bx + Math.sin(t / 7000 + i * 2) * 0.08) * w, y = (by + Math.cos(t / 8000 + i) * 0.08) * hh, r = br * Math.max(w, hh) * 0.6;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgb(col, a));
      gr.addColorStop(1, rgb(col, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, hh);
    });
    stars(g, w, hh, st, t, 260, 1);
  },
};

SCENES.synth = {
  name: 'Retro-Gitter',
  draw(g, w, hh, t, st, dt, acc) {
    const hor = hh * 0.55;
    skyGradient(g, w, hh, [14, 6, 40], mixRgb([255, 80, 160], acc, 0.3), 0.55);
    g.fillStyle = 'rgb(10,4,28)';
    g.fillRect(0, hor, w, hh - hor);
    const sx = w / 2, sr = Math.min(w, hh) * 0.2;
    for (let y = -sr; y < sr; y++) {
      if (y > 0 && ((y + Math.floor(t / 200)) % 6) < 2 + y / 10) continue;
      const half = Math.sqrt(sr * sr - y * y);
      g.fillStyle = rgb(mixRgb([255, 210, 90], [255, 60, 150], (y + sr) / (2 * sr)));
      g.fillRect(sx - half, hor - sr * 1.1 + y, half * 2, 1);
    }
    g.fillStyle = rgb(mixRgb(acc, [255, 255, 255], 0.2), 0.8);
    for (let i = -20; i <= 20; i++) {
      for (let y = hor; y < hh; y += 1) {
        const d = (y - hor) / (hh - hor);
        g.fillRect(Math.floor(sx + i * d * w * 0.12), y, 1, 1);
      }
    }
    for (let k = 0; k < 9; k++) {
      const d = ((k + (t / 1500) % 1) / 9) ** 2;
      g.fillRect(0, Math.floor(hor + d * (hh - hor)), w, 1);
    }
  },
};

SCENES.sakura = {
  name: 'Kirschblüten',
  draw(g, w, hh, t, st, dt, acc) {
    skyGradient(g, w, hh, [255, 196, 214], mixRgb([255, 236, 220], acc, 0.12));
    const ground = hh * 0.88;
    g.fillStyle = 'rgb(120,170,110)';
    ridge(w, 9, ground, 5).forEach((y, i) => g.fillRect(i * 2, y, 2, hh - y));
    if (!st.p || st.p.w !== w) {
      const r = srand(37);
      st.p = Array.from({ length: Math.floor(w / 5) }, () => ({ x: r() * w, y: r() * hh, v: 6 + r() * 10, p: r() * 6, s: r() }));
      st.p.w = w;
    }
    for (const p of st.p) {
      p.y += (p.v * dt) / 1000;
      p.x += (Math.sin(t / 900 + p.p) * 8 + 6) * dt / 1000;
      if (p.y > ground || p.x > w + 3) { p.y = -3; p.x = Math.random() * w; }
      g.fillStyle = p.s > 0.5 ? 'rgb(255,150,185)' : 'rgb(255,200,220)';
      g.fillRect(Math.floor(p.x), Math.floor(p.y), 2, 1);
      g.fillRect(Math.floor(p.x) + 1, Math.floor(p.y) + 1, 1, 1);
    }
  },
};
