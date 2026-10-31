// Counter Launcher – the assistant's mascots, drawn as 16x16 pixel art and animated (bob, blink, thinking):
// "Pixi" (a cute axolotl) and "Byte" (a cool visor robot). The plain orb stays available too.

const MASCOTS = {
  pixi: {
    name: 'Pixi',
    persona: 'Du heißt Pixi, ein kleiner, süßer Pixel-Axolotl. Sprich fröhlich, warm und verspielt, gern mit ein paar passenden Emojis, aber bleib hilfreich und konkret.',
    rows: [
      '................',
      '.g............g.',
      'ggg..oooooo..ggg',
      '.gg.obbbbbbo.gg.',
      '..gobbbbbbbbog..',
      '...obllllllbo...',
      '..obllllllllbo..',
      '..oblkwllkwlbo..',
      '..oblkkllkklbo..',
      '..obpllmmllpbo..',
      '..obllllllllbo..',
      '...obllllllbo...',
      '...obbbbbbbbo...',
      '..obo.obbo.obo..',
      '..oo..oooo..oo..',
      '................',
    ],
    colors: (acc, acc2) => ({ o: '#2a1033', b: '#f39ad0', l: '#ffc9e8', k: '#1b1020', w: '#ffffff', p: '#ff6fae', m: '#c2457f', g: acc, G: '#ffe1f4' }),
    blink: (r) => { r[7] = r[7].replace(/k|w/g, 'l'); return r; },
    think: (r, t) => (Math.floor(t / 160) % 2 ? r.map((x, i) => (i < 5 ? x.replace(/g/g, 'G') : x)) : r),
  },
  byte: {
    name: 'Byte',
    persona: 'Du heißt Byte, ein cooler Pixel-Roboter mit Visier. Sprich lässig, selbstbewusst und knapp, ein bisschen trocken-witzig, ohne viele Emojis.',
    rows: [
      '.......a........',
      '.......o........',
      '....oooooooo....',
      '...ommmmmmmmo...',
      '..ommvvvvvvmmo..',
      '..omvvvvvvvvmo..',
      '..omvcvvvvcvmo..',
      '..omvcvvvvcvmo..',
      '..omvvvvvvvvmo..',
      '..ommvvvvvvmmo..',
      '...ommmmmmmmo...',
      '....oommmmoo....',
      '...ommmmmmmmo...',
      '..omm.mmmm.mmo..',
      '..oo..oooo..oo..',
      '................',
    ],
    colors: (acc, acc2) => ({ o: '#0d0b16', m: shade(acc, 0.45), v: '#0a0c18', c: acc2, a: acc2, s: shade(acc2, 0.35) }),
    blink: (r) => { r[7] = r[7].replace(/c/g, 'v'); return r; },
    think: (r, t) => {
      const line = 4 + (Math.floor(t / 90) % 6);
      return r.map((x, i) => (i === line ? x.replace(/v/g, 's') : x));
    },
  },
};

function shade(hex, k) {
  const n = parseInt(String(hex).slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `rgb(${c.join(',')})`;
}

MASCOTS.counti = {
  name: 'Counti',
  persona: 'Du heißt Counti, ein kleines, rundes, glänzendes Wesen und das Maskottchen von Counter. Sprich freundlich, neugierig und motiviert, mit Witz und gelegentlich einem Emoji, und pack Sachen direkt an.',
};

function mascotKind() {
  try {
    return JSON.parse(localStorage.getItem('cl.aiMascot')) || 'counti';
  } catch {
    return 'counti';
  }
}

// ---------------------------------------------------------------- Counti: round glossy 3D creature (SVG)
let countiId = 0;
const SVGNS = 'http://www.w3.org/2000/svg';
function countiSvg(size) {
  const id = 'ct' + countiId++;
  const wrap = document.createElement('div');
  wrap.className = 'counti';
  wrap.style.width = wrap.style.height = size + 'px';
  wrap.innerHTML = `<svg viewBox="0 0 120 120" width="${size}" height="${size}" xmlns="${SVGNS}">
  <defs>
    <radialGradient id="${id}b" cx="38%" cy="30%" r="75%">
      <stop offset="0" style="stop-color:color-mix(in srgb, var(--accent) 35%, #fff)"/>
      <stop offset="0.45" style="stop-color:var(--accent)"/>
      <stop offset="1" style="stop-color:color-mix(in srgb, var(--accent) 45%, #07040f)"/>
    </radialGradient>
    <radialGradient id="${id}l" cx="40%" cy="30%" r="80%">
      <stop offset="0" style="stop-color:color-mix(in srgb, var(--accent) 60%, #fff)"/>
      <stop offset="1" style="stop-color:color-mix(in srgb, var(--accent) 55%, #07040f)"/>
    </radialGradient>
    <radialGradient id="${id}g" cx="35%" cy="30%" r="70%">
      <stop offset="0" stop-color="#fff"/>
      <stop offset="0.5" style="stop-color:color-mix(in srgb, var(--accent-2) 70%, #fff)"/>
      <stop offset="1" style="stop-color:var(--accent-2)"/>
    </radialGradient>
    <radialGradient id="${id}e" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#dcd6ee"/>
    </radialGradient>
  </defs>
  <ellipse class="ct-shadow" cx="60" cy="113" rx="30" ry="5" fill="rgba(0,0,0,.35)"/>
  <g class="ct-body">
    <g class="ct-ant ct-ant-l"><path d="M49 32 Q42 18 37 9" stroke="color-mix(in srgb, var(--accent) 50%, #07040f)" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle class="ct-glow" cx="37" cy="9" r="5.5" fill="url(#${id}g)"/></g>
    <g class="ct-ant ct-ant-r"><path d="M71 32 Q78 18 83 9" stroke="color-mix(in srgb, var(--accent) 50%, #07040f)" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle class="ct-glow" cx="83" cy="9" r="5.5" fill="url(#${id}g)"/></g>
    <ellipse cx="45" cy="101" rx="11" ry="7.5" fill="url(#${id}l)"/>
    <ellipse cx="75" cy="101" rx="11" ry="7.5" fill="url(#${id}l)"/>
    <ellipse class="ct-arm ct-arm-l" cx="19" cy="72" rx="7.5" ry="12" fill="url(#${id}l)"/>
    <ellipse class="ct-arm ct-arm-r" cx="101" cy="72" rx="7.5" ry="12" fill="url(#${id}l)"/>
    <circle cx="60" cy="62" r="40" fill="url(#${id}b)"/>
    <ellipse cx="60" cy="80" rx="22" ry="14" fill="#fff" opacity=".10"/>
    <ellipse cx="45" cy="36" rx="14" ry="7" fill="#fff" opacity=".35" transform="rotate(-24 45 36)"/>
    <circle cx="72" cy="31" r="2.6" fill="#fff" opacity=".45"/>
    <g class="ct-eyes">
      <g class="ct-eye"><ellipse cx="46" cy="58" rx="9.5" ry="11.5" fill="url(#${id}e)"/><g class="ct-pupil"><circle cx="46" cy="59" r="6" fill="#1a1028"/><circle cx="43.6" cy="56" r="2.2" fill="#fff"/><circle cx="48" cy="61.5" r="1" fill="#fff" opacity=".8"/></g></g>
      <g class="ct-eye"><ellipse cx="74" cy="58" rx="9.5" ry="11.5" fill="url(#${id}e)"/><g class="ct-pupil"><circle cx="74" cy="59" r="6" fill="#1a1028"/><circle cx="71.6" cy="56" r="2.2" fill="#fff"/><circle cx="76" cy="61.5" r="1" fill="#fff" opacity=".8"/></g></g>
    </g>
    <ellipse cx="34" cy="73" rx="6.5" ry="3.8" fill="#ff7ab8" opacity=".55"/>
    <ellipse cx="86" cy="73" rx="6.5" ry="3.8" fill="#ff7ab8" opacity=".55"/>
    <path class="ct-mouth" d="M53 76 Q60 83 67 76" stroke="#2a1033" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  </g>
</svg>`;
  return wrap;
}
// the eyes follow the mouse
document.addEventListener('mousemove', (e) => {
  for (const el of document.querySelectorAll('.counti')) {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.48);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 260) * 3.2;
    for (const p of el.querySelectorAll('.ct-pupil')) p.setAttribute('transform', `translate(${((dx / d) * k).toFixed(2)} ${((dy / d) * k * 0.8).toFixed(2)})`);
  }
});

/** animated mascot element; size in CSS pixels; set .dataset.thinking = '1' while the assistant works */
function mascot(size = 34, kind = mascotKind()) {
  if (kind === 'counti') return countiSvg(size);
  if (!MASCOTS[kind]) return h('div', { class: 'ai-orb', style: `width:${size}px;height:${size}px` });
  const m = MASCOTS[kind];
  const c = h('canvas', { width: 16, height: 16, class: 'mascot', style: `width:${size}px;height:${size}px` });
  const g = c.getContext('2d');
  const seed = Math.random() * 3000;
  (function draw(t) {
    if (!c.isConnected && t > 2000) return;
    const css = getComputedStyle(document.documentElement);
    const pal = m.colors(css.getPropertyValue('--accent').trim() || '#9d5cff', css.getPropertyValue('--accent-2').trim() || '#29d3ff');
    let rows = [...m.rows];
    if ((t + seed) % 3400 < 140) rows = m.blink(rows);
    if (c.dataset.thinking === '1') rows = m.think(rows, t);
    g.clearRect(0, 0, 16, 16);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.' || !pal[ch]) return;
      g.fillStyle = pal[ch];
      g.fillRect(x, y, 1, 1);
    }));
    // antenna / gill glow pulse
    if (kind === 'byte') {
      g.globalAlpha = 0.35 + 0.35 * Math.sin(t / 300);
      g.fillStyle = pal.a;
      g.fillRect(6, 0, 3, 1);
      g.globalAlpha = 1;
    }
    setTimeout(() => requestAnimationFrame(draw), 60);
  })(0);
  return c;
}
const mascotName = () => (MASCOTS[mascotKind()] || { name: 'Assistent' }).name;
const mascotPersona = () => (MASCOTS[mascotKind()] || { persona: '' }).persona;
