// Visual effects for the Counter Launcher: splash, page transitions, spotlight on glass, 3D tilt, magnetic buttons,
// pixel bursts, count-up numbers and the layered pixel sky (moon, clouds, stars). Everything respects "no-motion".
(() => {
  const motion = () => !document.body.classList.contains('no-motion');
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#9d5cff';

  // ---------------------------------------------------------------- splash: logo built from pixels
  const LOGO = [
    '..XXXXXX..',
    '.XXXXXXXX.',
    'XXX....XXX',
    'XX........',
    'XX........',
    'XX........',
    'XXX....XXX',
    '.XXXXXXXX.',
    '..XXXXXX..',
  ];
  function splash() {
    const c = document.createElement('canvas');
    c.id = 'splash';
    document.body.append(c);
    const g = c.getContext('2d');
    const px = [];
    LOGO.forEach((row, y) => [...row].forEach((ch, x) => ch === 'X' && px.push({ x, y, d: Math.random() * 380 })));
    const start = performance.now();
    (function frame(now) {
      const t = now - start;
      c.width = innerWidth;
      c.height = innerHeight;
      const s = Math.min(innerWidth, innerHeight) / 30;
      const ox = innerWidth / 2 - 5 * s, oy = innerHeight / 2 - 6.5 * s;
      g.fillStyle = '#07070c';
      g.globalAlpha = t < 1100 ? 1 : Math.max(0, 1 - (t - 1100) / 400);
      g.fillRect(0, 0, c.width, c.height);
      const a = accent();
      for (const p of px) {
        const k = Math.max(0, Math.min(1, (t - p.d) / 420));
        const e = 1 - Math.pow(1 - k, 3);
        g.fillStyle = a;
        g.shadowColor = a;
        g.shadowBlur = 18 * e;
        const fall = (1 - e) * s * 6;
        g.fillRect(ox + p.x * s + 1, oy + p.y * s + 1 - fall, s - 2, s - 2);
      }
      g.shadowBlur = 0;
      if (t > 650) {
        g.fillStyle = `rgba(236,235,243,${Math.min(1, (t - 650) / 300) * (t < 1100 ? 1 : Math.max(0, 1 - (t - 1100) / 400))})`;
        g.font = `700 ${Math.round(s * 0.9)}px "Segoe UI", sans-serif`;
        g.textAlign = 'center';
        g.fillText('C O U N T E R', innerWidth / 2, oy + 11.5 * s);
      }
      if (t < 1500) requestAnimationFrame(frame);
      else c.remove();
    })(start);
  }
  if (motion()) splash();

  // ---------------------------------------------------------------- page transitions
  window.transition = (fn) => {
    if (!motion() || !document.startViewTransition) return fn();
    return document.startViewTransition(fn).finished;
  };

  // ---------------------------------------------------------------- spotlight inside glass + 3D tilt + magnetic buttons
  document.addEventListener('pointermove', (e) => {
    const panel = e.target.closest?.('.panel, .result, .lib-item, .preset, .banner');
    if (panel) {
      const r = panel.getBoundingClientRect();
      panel.style.setProperty('--sx', `${e.clientX - r.left}px`);
      panel.style.setProperty('--sy', `${e.clientY - r.top}px`);
    }
    if (!motion()) return;
    const tile = e.target.closest?.('.tile, .preset');
    if (tile) {
      const r = tile.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -7, ry = ((e.clientX - r.left) / r.width - 0.5) * 9;
      tile.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-3px)`;
    }
    const mag = e.target.closest?.('.btn.primary, .btn.play');
    if (mag) {
      const r = mag.getBoundingClientRect();
      mag.style.transform = `translate(${((e.clientX - r.left) / r.width - 0.5) * 6}px, ${((e.clientY - r.top) / r.height - 0.5) * 5}px)`;
    }
  });
  document.addEventListener('pointerout', (e) => {
    const t = e.target.closest?.('.tile, .preset, .btn.primary, .btn.play');
    if (t && !t.contains(e.relatedTarget)) t.style.transform = '';
  });

  // ---------------------------------------------------------------- pixel burst (play button)
  window.pixelBurst = (el) => {
    if (!motion()) return;
    const r = el.getBoundingClientRect();
    const c = document.createElement('canvas');
    c.className = 'burst';
    c.width = innerWidth;
    c.height = innerHeight;
    document.body.append(c);
    const g = c.getContext('2d');
    const a = accent();
    const parts = Array.from({ length: 46 }, () => {
      const ang = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2, s: 3 + Math.random() * 4, white: Math.random() < 0.3 };
    });
    let f = 0;
    (function frame() {
      g.clearRect(0, 0, c.width, c.height);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.25;
        p.vx *= 0.97;
        g.globalAlpha = Math.max(0, 1 - f / 45);
        g.fillStyle = p.white ? '#fff' : a;
        g.fillRect(p.x, p.y, p.s, p.s);
      }
      if (++f < 46) requestAnimationFrame(frame);
      else c.remove();
    })();
  };

  // ---------------------------------------------------------------- numbers count up when they appear
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target, target = Number(el.dataset.count), suffix = el.dataset.suffix || '';
      if (!motion() || !target) continue;
      const start = performance.now();
      (function step(now) {
        const k = Math.min(1, (now - start) / 700);
        const v = target * (1 - Math.pow(1 - k, 3));
        el.textContent = Intl.NumberFormat('de', { notation: 'compact' }).format(Math.round(v)) + suffix;
        if (k < 1) requestAnimationFrame(step);
      })(start);
    }
  });
  new MutationObserver(() => document.querySelectorAll('[data-count]:not([data-seen])').forEach((el) => { el.dataset.seen = '1'; io.observe(el); }))
    .observe(document.body, { childList: true, subtree: true });

  // ---------------------------------------------------------------- moon + pixel clouds behind the stars
  const back = document.createElement('canvas');
  back.id = 'sky-back';
  document.body.prepend(back);
  const bg = back.getContext('2d');
  const S = 4;
  const clouds = Array.from({ length: 7 }, (_, i) => ({ x: Math.random(), y: 0.15 + Math.random() * 0.55, w: 10 + Math.random() * 18, speed: 0.000006 + (i % 3) * 0.000004, layer: i % 3 }));
  (function frame(t) {
    const w = Math.ceil(innerWidth / S), hh = Math.ceil(innerHeight / S);
    if (back.width !== w || back.height !== hh) { back.width = w; back.height = hh; }
    bg.clearRect(0, 0, w, hh);
    const visible = !document.body.classList.contains('no-stars');
    if (visible) {
      // moon in the accent colour with a soft halo, blocky like in Minecraft
      const a = accent();
      const mx = w * 0.82, my = hh * 0.2, mr = Math.max(4, Math.round(hh * 0.05));
      const pulse = 0.85 + 0.15 * Math.sin(t / 1800);
      const grad = bg.createRadialGradient(mx, my, mr, mx, my, mr * 7);
      grad.addColorStop(0, a + '55');
      grad.addColorStop(1, a + '00');
      bg.globalAlpha = pulse;
      bg.fillStyle = grad;
      bg.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14);
      bg.globalAlpha = 1;
      bg.fillStyle = a;
      bg.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
      bg.fillStyle = 'rgba(255,255,255,0.35)';
      bg.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
      bg.fillStyle = 'rgba(0,0,0,0.18)';
      bg.fillRect(mx - mr * 0.5, my - mr * 0.3, mr * 0.5, mr * 0.5);
      bg.fillRect(mx + mr * 0.2, my + mr * 0.25, mr * 0.6, mr * 0.6);
      // drifting pixel clouds (three depths)
      for (const c of clouds) {
        if (motion()) c.x += c.speed * (1 + c.layer);
        if (c.x > 1.2) c.x = -0.3;
        const cx = Math.floor(c.x * w), cy = Math.floor(c.y * hh);
        bg.fillStyle = `rgba(${c.layer === 2 ? '60,52,90' : c.layer === 1 ? '40,34,64' : '26,22,42'},${0.35 + c.layer * 0.12})`;
        bg.fillRect(cx, cy, Math.floor(c.w), 2);
        bg.fillRect(cx + 2, cy - 1, Math.floor(c.w * 0.6), 1);
        bg.fillRect(cx + 3, cy + 2, Math.floor(c.w * 0.7), 1);
      }
    }
    requestAnimationFrame(frame);
  })(0);
})();
