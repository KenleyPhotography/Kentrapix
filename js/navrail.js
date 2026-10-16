// Barre de navigation mobile verticale rétractable : on la pousse vers le bord (doigt) pour la cacher,
// on la retire par la languette (toucher ou glisser vers la droite) pour la faire revenir. Le choix est mémorisé.
const KEY = 'kp-nav-rail';
const hidden = () => { try { return localStorage.getItem(KEY) === 'hidden'; } catch { return false; } };

export function setRail(hide) {
  document.body.classList.toggle('nav-hidden', hide);
  try { localStorage.setItem(KEY, hide ? 'hidden' : 'shown'); } catch { /* navigation privée : pas de mémoire, tant pis */ }
}

/** Languette au bord gauche (créée une seule fois, hors de #app pour survivre aux rendus). */
function ensureHandle() {
  let handle = document.getElementById('nav-handle');
  if (handle) return handle;
  handle = document.createElement('button');
  handle.id = 'nav-handle';
  handle.type = 'button';
  handle.className = 'nav-handle';
  handle.setAttribute('aria-label', 'Afficher le menu');
  handle.innerHTML = '<i aria-hidden="true"></i>';
  document.body.append(handle);
  let sx = null;
  handle.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  handle.addEventListener('pointermove', (e) => { if (sx !== null && e.clientX - sx > 14) { sx = null; setRail(false); } });
  handle.addEventListener('pointerup', () => { sx = null; });
  handle.addEventListener('pointercancel', () => { sx = null; });
  handle.addEventListener('click', () => setRail(false));
  return handle;
}

/** À appeler après chaque rendu (la barre est recréée à chaque fois). */
export function bindNavRail() {
  const nav = document.querySelector('.bottomnav');
  if (!nav) return;
  ensureHandle();
  document.body.classList.toggle('nav-hidden', hidden());
  let start = null; let dx = 0; let dragging = false; let swallow = false;
  nav.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; dx = 0; dragging = false; });
  nav.addEventListener('pointermove', (e) => {
    if (!start) return;
    dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      dragging = true;
      try { nav.setPointerCapture(e.pointerId); } catch { /* pas grave */ }
      nav.style.transition = 'none';
    }
    if (dragging) nav.style.transform = `translateX(${Math.min(0, dx)}px)`;
  });
  const end = () => {
    if (!start) return;
    const wasDragging = dragging;
    start = null; dragging = false;
    nav.style.transition = '';
    nav.style.transform = '';
    if (wasDragging) {
      swallow = true; setTimeout(() => { swallow = false; }, 80);
      if (dx < -36) setRail(true);
    }
  };
  nav.addEventListener('pointerup', end);
  nav.addEventListener('pointercancel', end);
  // Un glissement ne doit pas compter comme un clic sur un onglet.
  nav.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } }, true);
}
