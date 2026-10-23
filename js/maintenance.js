// Page « en cours de maintenance » : titre, message et temps restant viennent du serveur
// (/api/public/maintenance, réglé par le propriétaire dans Studio > Réglages).
// Le site se rouvre tout seul à la fin de la durée : la page le voit et repart sur le site.

const el = (id) => document.getElementById(id);
const tile = (id) => el(id).querySelector('b');
const count = el('mt-count');
const bar = el('mt-bar');
const eta = el('mt-eta');
// Aperçu demandé depuis le studio : l'adresse est /maintenance, le site lui-même reste ouvert.
// Rien à cliquer sur cette page : le site revient tout seul, et « Espace studio » reste en bas.
const isPreview = location.pathname.replace(/\/$/, '') === '/maintenance';

let state = null;
let skew = 0; // écart entre l'horloge de l'appareil et celle du serveur
const now = () => Date.now() + skew;

/**
 * Le titre, en gros, lettre par lettre (comme la page d'attente du Worker Cloudflare).
 * La taille suit la longueur du texte : un mot court remplit la page, une phrase reste lisible.
 * Rejoué seulement quand le texte change, sinon l'animation repartirait à chaque rafraîchissement.
 */
let shown = '';
function hero(word) {
  const text = String(word || 'Maintenance').trim().slice(0, 120);
  if (text === shown) return;
  shown = text;
  const h = el('mt-hero');
  h.textContent = '';
  h.setAttribute('aria-label', text);
  h.style.setProperty('--hero', `clamp(26px, 8.5vw, ${Math.min(84, Math.round(620 / (0.56 * text.length)))}px)`);
  let n = 0;
  for (const ch of text) {
    if (ch === ' ') { h.append(' '); continue; } // un vrai espace : le titre peut aller à la ligne
    const b = document.createElement('b');
    b.textContent = ch;
    b.style.animationDelay = `${n++ * 70}ms`;
    h.append(b);
  }
}

const pad = (n) => String(n).padStart(2, '0');
const hour = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const sameDay = (iso) => new Date(iso).toDateString() === new Date(now()).toDateString();
const when = (iso) => (sameDay(iso)
  ? `aujourd’hui à ${hour(iso)}`
  : `${new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${hour(iso)}`);

async function load() {
  const res = await fetch('/api/public/maintenance', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const data = await res.json();
  if (data.now) skew = Date.parse(data.now) - Date.now();
  return data;
}

function draw() {
  hero(state.title);
  count.classList.toggle('is-on', !!(state.enabled && state.endsAt));
  tick();
}

function tick() {
  if (!state?.enabled || !state.endsAt) return;
  const left = Math.max(0, Date.parse(state.endsAt) - now());
  const total = Math.floor(left / 1000);
  const days = Math.floor(total / 86400);
  el('mt-d').hidden = !days;
  tile('mt-d').textContent = days;
  tile('mt-h').textContent = pad(Math.floor(total / 3600) % 24);
  tile('mt-m').textContent = pad(Math.floor(total / 60) % 60);
  tile('mt-s').textContent = pad(total % 60);
  // Barre d'avancement : part du début de la fermeture et se remplit jusqu'à l'heure de fin.
  const start = state.startedAt ? Date.parse(state.startedAt) : 0;
  const end = Date.parse(state.endsAt);
  if (start && end > start) {
    const done = Math.min(100, Math.max(0, Math.round(((now() - start) / (end - start)) * 100)));
    bar.firstElementChild.style.width = `${done}%`;
    bar.setAttribute('aria-valuenow', done);
  } else {
    bar.hidden = true;
  }
  if (left > 0) {
    el('mt-count-label').textContent = 'Réouverture dans';
    eta.textContent = `Retour prévu ${when(state.endsAt)}.`;
  } else {
    // L'heure est passée : le serveur rouvre le site à la prochaine visite ; la page le verra au prochain tour.
    el('mt-count-label').textContent = 'Réouverture imminente';
    eta.textContent = 'Le site revient d’une seconde à l’autre…';
  }
}

/** Site ouvert : on y retourne (en aperçu, la page reste telle quelle). */
function reopened() {
  if (isPreview) return;
  count.classList.remove('is-on');
  hero('Bienvenue');
  setTimeout(() => location.replace('/'), 2500);
}

async function refresh() {
  try {
    state = await load();
    draw();
    if (!state.enabled) reopened();
  } catch {
    // Serveur encore en train de redémarrer : on réessaiera au prochain tour.
  }
}

hero('Maintenance');
el('mt-year').textContent = new Date().getFullYear();

refresh();
setInterval(tick, 1000);
// Toutes les 20 s (et au retour sur l'onglet) : le site a peut-être rouvert avant l'heure prévue.
setInterval(refresh, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
