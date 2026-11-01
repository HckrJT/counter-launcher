/*
 * Fill these values after the public GitHub repository, release, server and
 * community are ready. Empty values intentionally keep the related CTA local.
 */
const COUNTER_CONFIG = {
  download: '',
  repo: '',
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
