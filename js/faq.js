// Assistant d'aide KentraPix : répond aux questions fréquentes des clients (sans serveur, sans IA).
// Pour ajouter une question : ajoutez une ligne dans FAQ.
//   t = étiquette courte du bouton, q = question complète, k = mots-clés (minuscules, sans accents), a = réponse courte.
const FAQ = [
  { t: '🔎 Mes photos', q: 'Où sont mes photos ?', k: 'retrouver trouver voir photos galerie ouvrir ou sont', a: 'Menu <b>Mes galeries</b> → touchez votre galerie.' },
  { t: '🙂 Par visage', q: 'Comment trier par visage ?', k: 'visage visages personne personnes moi trier filtre reconnaissance retrouver quelqu un', a: 'Dans la galerie, touchez un visage sur la ligne <b>Trier par visage</b>.<br>Touchez <b>Tout afficher</b> pour revenir.' },
  { t: '❤️ Favoris', q: 'Comment mettre en favori ?', k: 'favori favoris coeur aimer preferee preferees garder', a: 'Touchez le <b>cœur</b> sur une photo.<br>Vos favoris sont dans l’onglet <b>Favoris</b>.' },
  { t: '✅ Ma sélection', q: 'Comment envoyer ma sélection ?', k: 'selection selectionner choisir envoyer valider retouche album limite nombre photos', a: '1. Touchez vos photos.<br>2. Touchez <b>Envoyer ma sélection</b>.<br>Votre photographe est prévenu.' },
  { t: '⬇️ Télécharger', q: 'Comment télécharger mes photos ?', k: 'telecharger telechargement download zip enregistrer originale qualite hd', a: 'Ouvrez une photo → <b>Télécharger</b>.<br>Plusieurs photos ? Elles arrivent en fichier ZIP.' },
  { t: '🚫 Pas de téléchargement', q: 'Pourquoi je ne peux pas télécharger ?', k: 'impossible telecharger bloque desactive pas possible grise indisponible', a: 'Une galerie en <b>mode sélection</b> n’est pas téléchargeable.<br>Demandez à votre photographe de l’activer.' },
  { t: '⏱️ Lien expiré', q: 'Mon lien de téléchargement a expiré', k: 'lien expire expiré expiration telechargement 10 minutes', a: 'Le lien dure <b>10 minutes</b>.<br>Relancez le téléchargement.' },
  { t: '👪 Partager', q: 'Comment partager avec ma famille ?', k: 'partager partage famille amis lien mot de passe envoyer invite', a: 'Touchez <b>Partager avec la famille</b>, créez un lien avec un mot de passe, puis envoyez-le.' },
  { t: '💬 Commentaire', q: 'Comment laisser un commentaire ?', k: 'commentaire commenter message ecrire retouche demande question photographe contacter', a: 'Ouvrez une photo et écrivez dans <b>Commentaires</b>.<br>Votre photographe vous répond.' },
  { t: '📅 Durée', q: 'Combien de temps ma galerie reste-t-elle disponible ?', k: 'duree expire expiration disparait supprimee combien temps disponible', a: 'Votre photographe fixe une date de fin.<br>Téléchargez vos photos avant.' },
  { t: '🔒 Vie privée', q: 'Mes photos sont-elles privées ?', k: 'prive privee securite confidentiel confidentialite visible google public', a: 'Oui. Seuls vous et ceux qui ont votre lien et son mot de passe peuvent les voir.' },
  { t: '🔑 Mot de passe', q: 'J’ai oublié mon mot de passe', k: 'mot de passe oublie connexion connecter reinitialiser changer login', a: 'Page de connexion → <b>Mot de passe oublié ?</b><br>Un lien vous est envoyé par e-mail.' },
  { t: '📱 Installer', q: 'Comment installer l’application ?', k: 'installer application app telephone ecran accueil icone pwa', a: 'Touchez <b>Installer l’application</b> : elle s’ajoute à votre écran d’accueil.' },
];

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ');
const STOP = new Set('comment pour avec mes les des une que qui est pas sur dans mon ton ses nos vos peux puis pourquoi quand'.split(' '));
const words = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

function search(text) {
  const w = words(text);
  if (!w.length) return [];
  return FAQ.map((f) => {
    const hay = norm(f.q + ' ' + f.k);
    return { f, score: w.reduce((n, x) => n + (hay.includes(x) ? 1 : 0), 0) };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).filter((r, _, all) => r.score === all[0].score).slice(0, 2).map((r) => r.f);
}

export function initFaq() {
  if (document.getElementById('faq-root')) return;
  const ICON = '/logo/faq-icon.webp';
  const root = document.createElement('div');
  root.id = 'faq-root';
  root.innerHTML = `
    <div class="faq-nudge" id="faq-nudge" hidden>Une question ? Je suis là 👋</div>
    <button class="faq-fab" type="button" aria-label="Aide" aria-expanded="false" aria-controls="faq-panel">
      <img src="${ICON}" alt="" width="60" height="60">
    </button>
    <section class="faq-panel" id="faq-panel" role="dialog" aria-label="Aide KentraPix" hidden>
      <header>
        <img class="faq-logo" src="${ICON}" alt="" width="44" height="44">
        <div><strong>Besoin d’aide ?</strong><small><i></i>Réponses instantanées</small></div>
        <button type="button" class="faq-x" aria-label="Fermer">×</button>
      </header>
      <div class="faq-log" id="faq-log" aria-live="polite"></div>
      <div class="faq-chips" id="faq-chips"></div>
      <form class="faq-form" id="faq-form"><input id="faq-in" type="text" placeholder="Posez votre question…" autocomplete="off" maxlength="120"><button type="submit" aria-label="Envoyer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
    </section>`;
  document.body.appendChild(root);

  const fab = root.querySelector('.faq-fab'), panel = root.querySelector('.faq-panel'), log = root.querySelector('#faq-log'),
    chips = root.querySelector('#faq-chips'), form = root.querySelector('#faq-form'), input = root.querySelector('#faq-in'),
    nudge = root.querySelector('#faq-nudge');

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const say = (html, me) => {
    const b = document.createElement('div');
    b.className = 'faq-msg' + (me ? ' me' : '');
    if (me) b.textContent = html; else b.innerHTML = html;
    log.appendChild(b);
    scroll();
  };
  // Petite pause « en train d'écrire » avant chaque réponse : plus vivant qu'un affichage instantané.
  const reply = (htmls) => {
    const dots = document.createElement('div');
    dots.className = 'faq-msg faq-typing';
    dots.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(dots);
    scroll();
    setTimeout(() => { dots.remove(); htmls.forEach((h) => say(h)); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550);
  };
  const answer = (f) => f.a;
  const suggest = (list) => {
    chips.replaceChildren(...list.map((f) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.textContent = f.t;
      c.onclick = () => { say(f.q, true); reply([answer(f)]); };
      return c;
    }));
  };
  const hideNudge = () => { nudge.hidden = true; };
  const open = (on) => {
    hideNudge();
    panel.hidden = !on;
    fab.setAttribute('aria-expanded', String(on));
    fab.classList.toggle('on', on);
    if (on) {
      if (!log.children.length) { say('Bonjour 👋 Comment puis-je vous aider ?<br>Touchez un sujet ou écrivez votre question.'); suggest(FAQ.slice(0, 6)); }
      input.focus();
    } else fab.focus();
  };

  fab.onclick = () => open(panel.hidden);
  root.querySelector('.faq-x').onclick = () => open(false);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) open(false); });
  form.onsubmit = (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    say(t, true);
    const found = search(t);
    if (found.length) { reply(found.map(answer)); suggest(FAQ.filter((f) => !found.includes(f)).slice(0, 4)); }
    else { reply(['Je n’ai pas trouvé de réponse précise. Essayez avec un autre mot, ou laissez un <b>commentaire</b> sur une photo : votre photographe vous répondra.']); suggest(FAQ.slice(0, 6)); }
  };

  // Bulle d'invitation, une seule fois par visite.
  try {
    if (!sessionStorage.getItem('kp-faq-nudge')) {
      sessionStorage.setItem('kp-faq-nudge', '1');
      setTimeout(() => { if (panel.hidden) { nudge.hidden = false; setTimeout(hideNudge, 6000); } }, 4000);
    }
  } catch (e) { /* stockage indisponible : pas de bulle */ }
}
