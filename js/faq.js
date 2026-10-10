// Assistant d'aide KentraPix : répond aux questions fréquentes des clients (sans serveur, sans IA).
// Pour ajouter une question : ajoutez une ligne dans FAQ (mots-clés en minuscules, sans accents).
const FAQ = [
  { q: 'Comment retrouver mes photos ?', k: 'retrouver trouver voir photos galerie ouvrir ou sont', a: 'Ouvrez <b>Mes galeries</b> dans le menu, puis touchez la galerie de votre événement. Vos photos s’affichent tout de suite.' },
  { q: 'Comment trier par visage ?', k: 'visage visages personne personnes moi trier filtre reconnaissance retrouver quelqu un', a: 'Dans votre galerie, la ligne <b>Trier par visage</b> montre les personnes reconnues. Touchez un visage pour ne voir que ses photos, puis <b>Tout afficher</b> pour revenir à toutes les photos. Si vous ne la voyez pas, la reconnaissance n’est pas encore terminée ou n’est pas activée pour cette galerie.' },
  { q: 'Comment choisir mes photos préférées ?', k: 'favori favoris coeur aimer preferee preferees garder', a: 'Touchez le <b>cœur</b> sur une photo pour l’ajouter à vos <b>Favoris</b>. Retrouvez-les tous dans l’onglet Favoris.' },
  { q: 'Comment envoyer ma sélection à mon photographe ?', k: 'selection selectionner choisir envoyer valider retouche album limite nombre photos', a: 'Si votre galerie est en <b>mode sélection</b>, cochez les photos que vous voulez. Votre choix s’enregistre à chaque clic. Quand vous avez fini, touchez <b>Envoyer ma sélection</b> (vous pouvez ajouter un message). Votre photographe est prévenu par e-mail. Vous pouvez modifier votre choix puis toucher <b>Renvoyer ma sélection</b>.' },
  { q: 'Comment télécharger mes photos ?', k: 'telecharger telechargement download zip enregistrer originale qualite hd', a: 'Ouvrez une photo et touchez <b>Télécharger</b>, ou sélectionnez plusieurs photos pour recevoir un fichier ZIP. Vous pouvez aussi télécharger toute la galerie. Les photos sont en qualité originale.' },
  { q: 'Pourquoi je ne peux pas télécharger ?', k: 'impossible telecharger bloque desactive pas possible grise indisponible', a: 'Dans une galerie en <b>mode sélection</b>, le téléchargement est désactivé tant que le photographe n’a pas livré les photos finales. Il peut aussi être désactivé pour certains événements. Contactez votre photographe pour l’activer.' },
  { q: 'Mon lien de téléchargement a expiré', k: 'lien expire expiré expiration telechargement 10 minutes', a: 'Les liens de téléchargement sont valables <b>10 minutes</b>, par sécurité. Relancez simplement le téléchargement pour en obtenir un nouveau.' },
  { q: 'Comment partager avec ma famille ?', k: 'partager partage famille amis lien mot de passe envoyer invite', a: 'Ouvrez votre galerie et touchez le bouton <b>Partager avec la famille</b>. Créez un lien avec un mot de passe, puis envoyez les deux à vos proches. Vous choisissez s’ils peuvent télécharger ou commenter, et vous pouvez retirer le lien à tout moment.' },
  { q: 'Comment laisser un commentaire ?', k: 'commentaire commenter message ecrire retouche demande question photographe contacter', a: 'Ouvrez une photo et écrivez dans la zone <b>Commentaires</b>. Votre photographe le voit et peut vous répondre depuis son espace.' },
  { q: 'Combien de temps ma galerie reste-t-elle disponible ?', k: 'duree expire expiration disparait supprimee combien temps disponible', a: 'Chaque galerie a une date d’expiration fixée par votre photographe. Pensez à télécharger vos photos avant cette date. Si votre galerie a disparu, contactez-le pour la réactiver.' },
  { q: 'Mes photos sont-elles privées ?', k: 'prive privee securite confidentiel confidentialite visible google public', a: 'Oui. Votre galerie n’est visible que par vous et par les personnes à qui vous donnez un lien protégé par mot de passe. Elle n’apparaît pas sur Google.' },
  { q: 'J’ai oublié mon mot de passe', k: 'mot de passe oublie connexion connecter reinitialiser changer login', a: 'Sur la page de connexion, touchez <b>Mot de passe oublié ?</b> et suivez le lien reçu par e-mail. Pour le changer, ouvrez votre <b>Profil</b>.' },
  { q: 'Comment installer l’application ?', k: 'installer application app telephone ecran accueil icone pwa', a: 'Touchez <b>Installer l’application</b> : KentraPix s’ajoute à votre écran d’accueil et s’ouvre comme une vraie application.' },
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
  const root = document.createElement('div');
  root.id = 'faq-root';
  root.innerHTML = `
    <button class="faq-fab" type="button" aria-label="Aide" aria-expanded="false" aria-controls="faq-panel">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>
    </button>
    <section class="faq-panel" id="faq-panel" role="dialog" aria-label="Aide KentraPix" hidden>
      <header><div><strong>Besoin d’aide ?</strong><small>Réponses instantanées</small></div><button type="button" class="faq-x" aria-label="Fermer">×</button></header>
      <div class="faq-log" id="faq-log" aria-live="polite"></div>
      <div class="faq-chips" id="faq-chips"></div>
      <form class="faq-form" id="faq-form"><input id="faq-in" type="text" placeholder="Posez votre question…" autocomplete="off" maxlength="120"><button type="submit" aria-label="Envoyer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
    </section>`;
  document.body.appendChild(root);

  const fab = root.querySelector('.faq-fab'), panel = root.querySelector('.faq-panel'), log = root.querySelector('#faq-log'),
    chips = root.querySelector('#faq-chips'), form = root.querySelector('#faq-form'), input = root.querySelector('#faq-in');

  const say = (html, me) => {
    const b = document.createElement('div');
    b.className = 'faq-msg' + (me ? ' me' : '');
    if (me) b.textContent = html; else b.innerHTML = html;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
  };
  const answer = (f) => say(`<b>${f.q}</b><br>${f.a}`);
  const suggest = (list) => {
    chips.replaceChildren(...list.map((f) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.textContent = f.q;
      c.onclick = () => { say(f.q, true); answer(f); };
      return c;
    }));
  };
  const open = (on) => {
    panel.hidden = !on;
    fab.setAttribute('aria-expanded', String(on));
    fab.classList.toggle('on', on);
    if (on) {
      if (!log.children.length) { say('Bonjour 👋 Je peux répondre à vos questions sur vos photos. Choisissez une question ou écrivez la vôtre.'); suggest(FAQ.slice(0, 5)); }
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
    if (found.length) { found.forEach(answer); suggest(FAQ.filter((f) => !found.includes(f)).slice(0, 3)); }
    else { say('Je n’ai pas trouvé de réponse précise. Essayez avec un autre mot, ou laissez un <b>commentaire</b> sur une photo : votre photographe vous répondra.'); suggest(FAQ.slice(0, 4)); }
  };
}
