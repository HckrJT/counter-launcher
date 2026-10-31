// Counter Launcher – background gallery: pixel night, the animated scenes (scenes.js), shader videos shipped with the
// launcher, own video / Wallpaper Engine videos, screenshot, own picture, gradient and solid colour. Plus the layer
// switches (pixel ground, cubes, stars) and video/scene options.

const video = h('video', { id: 'bgvideo', muted: true, loop: true, playsinline: true, autoplay: true });
video.muted = true;
document.getElementById('sky').before(video);
let videoUrl = null;
async function loadVideo() {
  const r = await api.bgVideo();
  videoUrl = r.ok ? r.data : null;
  syncVideo();
}
function syncVideo() {
  const on = state && theme().bg === 'video' && !!videoUrl;
  video.style.display = on ? '' : 'none';
  if (!on) {
    if (!video.paused) video.pause();
    return;
  }
  if (video.dataset.src !== videoUrl) {
    video.dataset.src = videoUrl;
    video.src = videoUrl;
  }
  video.playbackRate = opt('videoRate', 1);
  const pause = document.hidden || (opt('pauseInGame', true) && state.running.length > 0) || document.body.classList.contains('no-motion');
  if (pause && !video.paused) video.pause();
  if (!pause && video.paused) video.play().catch(() => {});
}
document.addEventListener('visibilitychange', syncVideo);
api.on('running', () => setTimeout(syncVideo, 50));

const BG_CLASSES = ['sky', 'campfire', 'aurora', 'storm', 'end', 'ocean', 'sunset', 'snow', 'matrix', 'nebula', 'synth', 'sakura', 'video', 'gradient', 'image', 'solid'];
const _applyThemeBg = applyTheme;
// eslint-disable-next-line no-func-assign
applyTheme = function (t = theme(), accent = state.settings.accent) {
  _applyThemeBg(t, accent);
  const b = document.body.classList;
  for (const k of BG_CLASSES) b.toggle('bg-' + k, (t.bg || 'sky') === k);
  b.toggle('no-land', t.land === false);
  document.documentElement.style.setProperty('--bg-blur', (t.bgBlur ?? 0) + 'px');
  syncVideo();
};

async function setBg(bg, extra = {}) {
  await saveTheme({ bg, shotBg: false, ...extra });
  render();
}

function wallpaperModal() {
  const body = h('div', { class: 'wp-grid' }, h('div', { class: 'skeleton', style: 'height:120px' }));
  modal(h('div', {}, h('h2', {}, 'Wallpaper Engine'),
    h('p', { class: 'muted', style: 'margin-top:-6px' }, 'Deine installierten Video-Hintergründe. Szenen- und Web-Hintergründe kann nur Wallpaper Engine selbst abspielen.'),
    body, h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, h('button', { class: 'btn', onclick: closeModal }, 'Schließen'))), true);
  call(api.wallpapers).then(({ videos, other }) => {
    if (!videos.length) {
      body.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'Keine Video-Hintergründe gefunden'), other ? `${other} Hintergründe sind Szenen oder Webseiten – die gehen nur in Wallpaper Engine.` : 'Ist Wallpaper Engine über Steam installiert?'));
      return;
    }
    body.replaceChildren(...videos.map((v) => h('div', { class: 'wp-card', onclick: async () => {
      try {
        videoUrl = await call(api.useVideo, v.file);
        closeModal();
        await refresh();
        syncVideo();
        render();
        toast(`„${v.title}“ ist jetzt dein Hintergrund`);
      } catch (e) {
        toast(e.message, true);
      }
    } }, v.preview ? h('img', { src: v.preview, alt: '', loading: 'lazy' }) : h('div', { class: 'wp-ph' }, '▶'), h('div', { class: 't' }, v.title), h('div', { class: 'm' }, `${(v.size / 1048576).toFixed(0)} MB`))),
    other ? h('div', { class: 'muted', style: 'grid-column:1/-1;font-size:12px' }, `${other} weitere sind Szenen/Web – nicht als Video nutzbar.`) : null);
  }).catch((e) => body.replaceChildren(h('div', { class: 'empty' }, e.message)));
}

function backgroundSection() {
  const t = theme();
  const cur = t.shotBg ? 'shot' : t.bg || 'sky';
  const card = (key, name, art, onPick, sub) => h('div', { class: 'bg-card' + (cur === key ? ' on' : ''), onclick: onPick }, h('div', { class: 'bg-art' }, art), h('div', { class: 't' }, name), sub ? h('div', { class: 'm' }, sub) : null);
  const swatch = (css) => h('div', { class: 'bg-thumb', style: `background:${css}` });
  const nightArt = h('div', { class: 'bg-thumb night' }, h('i'));
  const gallery = h('div', { class: 'bg-gallery' },
    card('sky', 'Pixel-Nacht', nightArt, () => setBg('sky'), 'Sterne, Würfel, Boden'),
    ...Object.entries(SCENES).map(([k, s]) => card(k, s.name, sceneThumb(k), () => setBg(k), 'animiert')),
    card('video', 'Video', swatch('linear-gradient(135deg,#1b1530,#3b2a66)'), async () => {
      if (!videoUrl) {
        const u = await call(api.pickVideo).catch((e) => toast(e.message, true));
        if (!u) return;
        videoUrl = u;
      }
      await setBg('video');
    }, videoUrl ? 'eigenes Video' : 'MP4 / WebM wählen'),
    card('wallpaper', 'Wallpaper Engine', swatch('linear-gradient(135deg,#0d2a4a,#1d6fb8)'), wallpaperModal, 'Videos aus Steam'),
    card('shot', 'Screenshot', swatch('linear-gradient(135deg,#2a3b1c,#6a8a3a)'), async () => { await saveTheme({ shotBg: true, bg: 'sky' }); loadShot(true); render(); }, 'zufällig aus Instanzen'),
    card('image', 'Eigenes Bild', bgImage ? h('img', { class: 'bg-thumb', src: bgImage, alt: '' }) : swatch('linear-gradient(135deg,#222,#444)'), async () => {
      if (!bgImage) {
        const img = await call(api.pickBackground);
        if (!img) return;
        bgImage = img;
      }
      await setBg('image');
    }),
    card('gradient', 'Verlauf', swatch(`linear-gradient(${t.gradAngle}deg, ${state.settings.accent}, ${t.accent2})`), () => setBg('gradient')),
    card('solid', 'Einfarbig', swatch(t.solid), () => setBg('solid')));
  // shader videos recorded in game (downloaded from the launcher's GitHub release on first use)
  call(api.shaderBackgrounds).then((list) => {
    for (const b of list.reverse()) {
      const on = cur === 'video' && t.video === b.file;
      gallery.prepend(h('div', { class: 'bg-card' + (on ? ' on' : ''), onclick: async (e) => {
        const c = e.currentTarget;
        c.classList.add('loading');
        try {
          videoUrl = await call(api.useShaderBackground, b.name);
          await refresh();
          render();
        } catch (err) {
          toast(err.message, true);
          c.classList.remove('loading');
        }
      } },
      h('div', { class: 'bg-art' }, b.thumb ? h('img', { class: 'bg-thumb', src: b.thumb, alt: '' }) : h('div', { class: 'bg-thumb' }), h('span', { class: 'bg-badge' }, 'Shader')),
      h('div', { class: 't' }, b.title), h('div', { class: 'm' }, b.downloaded ? 'im Spiel aufgenommen' : `im Spiel aufgenommen · ${(b.size / 1048576).toFixed(0)} MB`)));
    }
  }).catch(() => {});

  const opts = h('div', { class: 'form panel', style: 'margin-top:14px' },
    ...(cur === 'sky' ? [...switchRow('Pixel-Boden unten', 'land', true), ...switchRow('Sterne', 'stars', true)] : []),
    ...switchRow('Schwebende Würfel', 'cubes', true),
    ...(SCENES[cur] ? segRow('Bildrate der Szene', 'sceneFps', [[15, '15'], [30, '30'], [60, '60']], 30) : []),
    ...(cur === 'video' ? [
      ...rangeRow('Video-Tempo', 'videoRate', 0.25, 2, 0.05, 1, '×', (v) => { video.playbackRate = v; }),
      h('label', {}, 'Video'), h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: async () => { const u = await call(api.pickVideo).catch((e) => toast(e.message, true)); if (u) { videoUrl = u; await refresh(); render(); } } }, 'Anderes Video'), h('button', { class: 'btn sm', onclick: wallpaperModal }, 'Aus Wallpaper Engine'))] : []),
    ...(cur === 'image' ? [h('label', {}, 'Bild'), h('div', {}, h('button', { class: 'btn sm', onclick: async () => { const img = await call(api.pickBackground); if (img) { bgImage = img; applyTheme(); render(); } } }, 'Bild wechseln'))] : []),
    ...(['video', 'image'].includes(cur) ? [...rangeRow('Abdunkeln', 'bgDim', 0, 90, 5, 45, '%', (v) => document.documentElement.style.setProperty('--bg-dim', String(v / 100))),
      ...rangeRow('Unschärfe', 'bgBlur', 0, 20, 1, 0, 'px', (v) => document.documentElement.style.setProperty('--bg-blur', v + 'px'))] : []),
    ...(cur === 'gradient' ? rangeRow('Verlaufswinkel', 'gradAngle', 0, 360, 15, 135, '°', () => applyTheme()) : []),
    ...(cur === 'solid' ? [h('label', {}, 'Farbe'), h('input', { type: 'color', value: t.solid, style: 'width:64px;height:34px;padding:3px', oninput: (e) => applyTheme({ ...theme(), solid: e.target.value }), onchange: (e) => saveTheme({ solid: e.target.value }) })] : []),
    ...switchRow('Animationen pausieren, solange das Spiel läuft', 'pauseInGame', true));
  return h('div', {}, h('h2', {}, 'Hintergrund'), gallery, opts);
}

const _consoleSettingsBg = consoleSettings;
// eslint-disable-next-line no-func-assign
consoleSettings = function () {
  return h('div', {}, backgroundSection(), _consoleSettingsBg());
};

window.addEventListener('DOMContentLoaded', () => setTimeout(loadVideo, 300));
