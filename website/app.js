// Counter website: pixel sky, scroll reveal, tilt, feature tabs, colour picker, live download info from GitHub.
(() => {
  const REPO = 'HckrJT/counter-launcher';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  document.getElementById('year').textContent = new Date().getFullYear();

  // ---- nav shadow after scrolling
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 24);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---- scroll reveal + count-up
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
      $$('[data-count]', e.target).forEach(countUp);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.rv').forEach((el) => io.observe(el));
  function countUp(el) {
    const to = Number(el.dataset.count);
    if (reduce || !to) return;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 1100);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---- floating motes in the bands
  $$('.motes').forEach((box) => {
    for (let i = 0; i < 18; i++) {
      const m = document.createElement('i');
      m.style.cssText = `left:${Math.random() * 100}%;--s:${3 + Math.floor(Math.random() * 4)}px;--d:${10 + Math.random() * 9}s;--dl:${-Math.random() * 14}s;--x:${(Math.random() - 0.5) * 60}px`;
      box.append(m);
    }
  });

  // ---- hero tilt that follows the mouse
  const tilt = $('[data-tilt]');
  if (tilt && !reduce && matchMedia('(hover: hover)').matches) {
    const shot = $('.shot', tilt);
    addEventListener('pointermove', (e) => {
      const r = tilt.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const x = (e.clientX / innerWidth - 0.5) * 2, y = (e.clientY / innerHeight - 0.5) * 2;
      shot.style.transform = `rotateY(${-9 + x * 5}deg) rotateX(${4 - y * 4}deg)`;
    }, { passive: true });
  }

  // ---- feature tabs with autoplay
  const tabs = $('#tabs');
  const tabBtns = $$('.tab', tabs), slides = $$('.slide', tabs);
  const DUR = 7000;
  let cur = 0, timer = null;
  tabs.style.setProperty('--dur', DUR + 'ms');
  function show(i) {
    cur = i;
    tabBtns.forEach((b, n) => {
      b.classList.toggle('on', n === i);
      b.setAttribute('aria-selected', n === i);
      if (n === i) { const bar = $('.bar', b); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
    });
    slides.forEach((s, n) => s.classList.toggle('on', n === i));
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (reduce || tabs.classList.contains('paused')) return;
    timer = setTimeout(() => show((cur + 1) % tabBtns.length), DUR);
  }
  tabBtns.forEach((b, i) => b.addEventListener('click', () => show(i)));
  tabs.addEventListener('pointerenter', () => { tabs.classList.add('paused'); clearTimeout(timer); });
  tabs.addEventListener('pointerleave', () => { tabs.classList.remove('paused'); show(cur); });
  new IntersectionObserver((e) => { if (e[0].isIntersecting) schedule(); else clearTimeout(timer); }).observe(tabs);

  // ---- module chips of the Counter mod (examples)
  const mods = ['FPS', 'Ping', 'Koordinaten', 'Uptime', 'Leben', 'Hunger', 'Rüstung', 'Effekte', 'Reichweite', 'Nether-Koordinaten', 'Wetter', 'Sichtweite', 'FOV', 'Java & CPU', 'Gelaufen', 'Tetris', 'Pong'];
  $('#modchips').append(...mods.map((m) => Object.assign(document.createElement('span'), { textContent: m })));

  // ---- accent colour: recolours the whole page and swaps the launcher screenshot
  const root = document.documentElement;
  $$('#swatches .sw').forEach((b) => b.addEventListener('click', () => {
    $$('#swatches .sw').forEach((x) => x.classList.toggle('on', x === b));
    root.style.setProperty('--accent', b.dataset.c);
    $$('#colorstage .cs').forEach((img) => img.classList.toggle('on', img.dataset.n === b.dataset.img));
  }));

  // ---- pixel sky (stars + a few drifting squares)
  const cv = $('#sky'), g = cv.getContext('2d');
  let W = 0, H = 0, stars = [];
  function size() {
    W = cv.width = innerWidth; H = cv.height = innerHeight;
    stars = Array.from({ length: Math.round(W * H / 9000) }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() < 0.15 ? 3 : 2, a: Math.random(), v: 0.004 + Math.random() * 0.012 }));
  }
  size();
  addEventListener('resize', size);
  function sky() {
    g.clearRect(0, 0, W, H);
    for (const s of stars) {
      s.a += s.v;
      g.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(s.a * 3));
      g.fillStyle = '#e8e2ff';
      g.fillRect(Math.round(s.x), Math.round(s.y), s.s, s.s);
    }
    g.globalAlpha = 1;
    if (!reduce) requestAnimationFrame(sky);
  }
  sky();

  // ---- download button and version info from the latest GitHub release
  const fmtSize = (b) => `${Math.round(b / 1048576)} MB`;
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`).then((r) => (r.ok ? r.json() : Promise.reject())).then((rel) => {
    const exe = (rel.assets || []).find((a) => /Setup.*\.exe$/i.test(a.name));
    const ver = String(rel.tag_name || '').replace(/^v/, '');
    $$('[data-version]').forEach((el) => (el.textContent = ver ? `Version ${ver}` : 'Neueste Version'));
    if (exe) {
      $$('[data-size]').forEach((el) => (el.textContent = `${fmtSize(exe.size)} · Windows 10/11`));
      $$('[data-dl]').forEach((a) => { if (a.closest('#download')) a.href = exe.browser_download_url; });
    }
    if (rel.published_at) $$('[data-date]').forEach((el) => (el.textContent = `veröffentlicht am ${new Date(rel.published_at).toLocaleDateString('de-DE')}`));
  }).catch(() => {});
})();
