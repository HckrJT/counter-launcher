// Counter 2.0 motion layer: sliding indicators (rail, tabs), scroll reveal, click waves, floating dust.
// Only active while <body> has the class "v2"; everything is cosmetic and removable without side effects.
(() => {
  const on = () => document.body.classList.contains('v2');
  const motion = () => on() && !document.body.classList.contains('no-motion');

  // ---- sliding indicator next to the active rail button
  function railIndicator() {
    const rail = document.getElementById('rail');
    if (!rail) return;
    let ind = document.getElementById('rail-ind');
    if (!ind) { ind = document.createElement('div'); ind.id = 'rail-ind'; rail.append(ind); }
    const a = rail.querySelector('.nav.active');
    if (!on() || !a) { ind.style.opacity = 0; return; }
    ind.style.opacity = 1;
    ind.style.top = a.offsetTop + a.offsetHeight / 2 - 11 + 'px';
  }

  // ---- sliding underline below the active tab
  function tabIndicators() {
    for (const tabs of document.querySelectorAll('.tabs')) {
      let ind = tabs.querySelector(':scope > .v2-ind');
      const a = tabs.querySelector('button.on');
      if (!on() || !a) { ind?.remove(); continue; }
      if (!ind) { ind = document.createElement('i'); ind.className = 'v2-ind'; tabs.append(ind); }
      ind.style.left = a.offsetLeft + 'px';
      ind.style.width = a.offsetWidth + 'px';
    }
  }

  // ---- reveal cards when they scroll into view, with a small stagger
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('v2-in'); io.unobserve(e.target); }
  }, { threshold: 0, rootMargin: '300px 0px' });
  function reveal() {
    if (!motion()) return;
    let n = 0;
    const all = document.querySelectorAll('#content .panel, #content .result, #content .preset, #content .tile, #content .lrow');
    // long lists (mods, search results): no hide-and-reveal at all, that only costs time while scrolling
    const many = all.length > 60;
    for (const el of all) {
      if (el.dataset.v2) continue;
      if (many && !el.matches('.panel')) { el.dataset.v2 = 1; continue; }
      el.dataset.v2 = 1;
      el.classList.add('v2-reveal');
      el.style.setProperty('--d', Math.min(n++, 14) * 40 + 'ms');
      io.observe(el);
    }
  }

  // ---- click wave on buttons
  document.addEventListener('pointerdown', (e) => {
    if (!motion()) return;
    const b = e.target.closest?.('.btn, .nav, .seg button, .tabs button');
    if (!b) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2;
    const w = document.createElement('span');
    w.className = 'v2-wave';
    w.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.style.overflow = 'hidden';
    b.append(w);
    setTimeout(() => w.remove(), 750);
  });

  // ---- slow floating dust particles in the accent colour
  let dust = null, parts = [], raf = 0;
  function startDust() {
    if (dust || !motion()) return;
    dust = document.createElement('canvas');
    dust.id = 'v2-dust';
    document.body.prepend(dust);
    const g = dust.getContext('2d');
    const size = () => { dust.width = innerWidth; dust.height = innerHeight; };
    size();
    addEventListener('resize', size);
    parts = Array.from({ length: 34 }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: 0.6 + Math.random() * 1.8, v: 0.08 + Math.random() * 0.25, p: Math.random() * 6.28 }));
    (function frame(t) {
      if (!dust) return;
      if (!motion()) { g.clearRect(0, 0, dust.width, dust.height); raf = requestAnimationFrame(frame); return; }
      g.clearRect(0, 0, dust.width, dust.height);
      g.fillStyle = window.cssAccent();
      for (const p of parts) {
        p.y -= p.v;
        if (p.y < -4) { p.y = dust.height + 4; p.x = Math.random() * dust.width; }
        g.globalAlpha = 0.16 + 0.14 * Math.sin(t / 900 + p.p);
        g.beginPath();
        g.arc(p.x + Math.sin(t / 2400 + p.p) * 14, p.y, p.r, 0, 6.28);
        g.fill();
      }
      raf = requestAnimationFrame(frame);
    })(0);
  }
  function stopDust() { cancelAnimationFrame(raf); dust?.remove(); dust = null; }

  // ---- keep everything in sync with the DOM and the setting
  let queued = false;
  function sync() {
    queued = false;
    railIndicator();
    tabIndicators();
    reveal();
    if (motion()) startDust(); else stopDust();
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
  new MutationObserver(queue).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', queue);
  queue();
})();
