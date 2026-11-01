/*
 * Fill these values after the public GitHub repository, release, server and
 * community are ready. Empty values intentionally keep the related CTA local.
 */
const COUNTER_CONFIG = {
  download: 'https://github.com/HckrJT/counter-launcher/releases/latest/download/Counter-Launcher-Setup-1.20.7.exe',
  repo: 'https://github.com/HckrJT/counter-launcher',
  discord: '',
  server: '',
};

const toast = document.querySelector('.toast');
let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}

function configured(key) {
  return typeof COUNTER_CONFIG[key] === 'string' && COUNTER_CONFIG[key].trim().length > 0;
}

document.querySelectorAll('[data-config-link]').forEach((link) => {
  const key = link.dataset.configLink;
  if (configured(key)) {
    link.href = COUNTER_CONFIG[key];
    link.target = '_blank';
    link.rel = 'noreferrer';
    return;
  }
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showToast('Dieser Link wird nach dem öffentlichen Release in website/app.js eingetragen.');
  });
});

document.querySelectorAll('[data-config-text]').forEach((element) => {
  const key = element.dataset.configText;
  if (configured(key)) element.textContent = COUNTER_CONFIG[key];
});

document.querySelector('.copy-server')?.addEventListener('click', async () => {
  if (!configured('server')) {
    showToast('Die Serveradresse ist noch nicht veröffentlicht.');
    return;
  }
  try {
    await navigator.clipboard.writeText(COUNTER_CONFIG.server);
    showToast('Serveradresse kopiert.');
  } catch {
    showToast(`Server: ${COUNTER_CONFIG.server}`);
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();

const root = document.documentElement;
const glow = document.querySelector('.cursor-glow');
const ring = document.querySelector('.cursor-ring');
const particleCanvas = document.querySelector('#particle-field');
const particleContext = particleCanvas?.getContext('2d');
let pointerX = innerWidth / 2;
let pointerY = innerHeight / 2;
let glowX = pointerX;
let glowY = pointerY;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resizeParticles() {
  if (!particleCanvas) return;
  const scale = Math.min(devicePixelRatio || 1, 2);
  particleCanvas.width = innerWidth * scale;
  particleCanvas.height = innerHeight * scale;
  particleContext.setTransform(scale, 0, 0, scale, 0, 0);
}

const particles = Array.from({ length: 48 }, () => ({
  x: Math.random() * innerWidth, y: Math.random() * innerHeight,
  radius: .5 + Math.random() * 1.5, speed: .04 + Math.random() * .16,
  drift: Math.random() * 6.28, alpha: .12 + Math.random() * .28,
}));

function drawParticles(time = 0) {
  if (!particleContext || prefersReducedMotion) return;
  particleContext.clearRect(0, 0, innerWidth, innerHeight);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--purple').trim() || '#a978ff';
  particleContext.fillStyle = accent;
  for (const particle of particles) {
    particle.y -= particle.speed;
    if (particle.y < -10) { particle.y = innerHeight + 10; particle.x = Math.random() * innerWidth; }
    particleContext.globalAlpha = particle.alpha + Math.sin(time / 900 + particle.drift) * .08;
    particleContext.beginPath();
    particleContext.arc(particle.x + Math.sin(time / 2100 + particle.drift) * 10, particle.y, particle.radius, 0, Math.PI * 2);
    particleContext.fill();
  }
  requestAnimationFrame(drawParticles);
}

if (!prefersReducedMotion) {
  window.addEventListener('resize', resizeParticles);
  resizeParticles();
  requestAnimationFrame(drawParticles);
  window.addEventListener('pointermove', (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    root.style.setProperty('--mouse-x', `${pointerX}px`);
    root.style.setProperty('--mouse-y', `${pointerY}px`);
    document.body.classList.add('cursor-active');
    const target = event.target.closest('a, button, .feature-card, .game-preview');
    document.body.classList.toggle('cursor-hover', !!target);
  });
  const follow = () => {
    glowX += (pointerX - glowX) * .12;
    glowY += (pointerY - glowY) * .12;
    if (glow) glow.style.left = `${glowX}px`;
    if (glow) glow.style.top = `${glowY}px`;
    if (ring) { ring.style.left = `${pointerX}px`; ring.style.top = `${pointerY}px`; }
    requestAnimationFrame(follow);
  };
  follow();
}

document.querySelectorAll('[data-tilt]').forEach((card) => {
  if (prefersReducedMotion) return;
  card.addEventListener('pointermove', (event) => {
    const bounds = card.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    card.style.transform = `perspective(1200px) rotateX(${y * -3}deg) rotateY(${x * 4}deg)`;
  });
  card.addEventListener('pointerleave', () => { card.style.transform = ''; });
});

const atmosphere = document.querySelector('.hero-atmosphere');
if (atmosphere && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const count = 18;
  for (let index = 0; index < count; index += 1) {
    const star = document.createElement('b');
    star.className = 'hero-star';
    star.style.setProperty('--x', `${Math.random() * 100}%`);
    star.style.setProperty('--y', `${Math.random() * 100}%`);
    star.style.setProperty('--delay', `${Math.random() * 8}s`);
    star.style.setProperty('--size', `${1 + Math.random() * 2.5}px`);
    atmosphere.append(star);
  }
}
