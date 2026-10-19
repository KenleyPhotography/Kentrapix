import { hello } from './service.js';
// Assistant d'aide KentraPix : répond aux questions fréquentes des clients (sans serveur, sans IA).
// Sujets d'aide, regroupés par thème. Pour ajouter une question : ajoutez une ligne dans le bon groupe.
//   t = étiquette courte du bouton, q = question complète, k = mots-clés (minuscules, sans accents), a = réponse courte.
const GROUPS = [
  { id: 'photos', label: 'Mes photos', items: [
    { t: 'Mes photos', q: 'Où sont mes photos ?', k: 'retrouver trouver voir photos galerie ouvrir ou sont', a: 'Menu <b>Mes galeries</b> → touchez votre galerie.' },
    { t: 'Favoris', q: 'Comment mettre en favori ?', k: 'favori favoris coeur aimer preferee preferees garder', a: 'Touchez le <b>cœur</b> sur une photo.<br>Vos favoris sont dans l’onglet <b>Favoris</b>.' },
    { t: 'Ma sélection', q: 'Comment envoyer ma sélection ?', k: 'selection selectionner choisir envoyer valider retouche album limite nombre photos', a: '1. Touchez vos photos.<br>2. Touchez <b>Envoyer ma sélection</b>.<br>Votre photographe est prévenu.' },
    { t: 'Télécharger', q: 'Comment télécharger mes photos ?', k: 'telecharger telechargement download zip enregistrer originale qualite hd', a: 'Ouvrez une photo → <b>Télécharger</b>, ou <b>Tout télécharger</b> en haut de la galerie.<br>Plusieurs photos arrivent en fichier ZIP.' },
    { t: 'Pas de téléchargement', q: 'Pourquoi je ne peux pas télécharger ?', k: 'impossible telecharger bloque desactive pas possible grise indisponible', a: 'Une galerie en <b>mode sélection</b> n’est pas téléchargeable : vous choisissez d’abord vos photos.<br>Demandez à votre photographe si besoin.' },
    { t: 'Photo verrouillée', q: 'Pourquoi une photo est verrouillée ?', k: 'verrouillee verrouille cadenas lock bloquee acces deverrouiller paiement', a: 'Votre photographe garde certaines photos verrouillées jusqu’au <b>règlement</b> (ou à une date).<br>Touchez la photo pour voir la raison.' },
    { t: 'Lien expiré', q: 'Mon lien de téléchargement a expiré', k: 'lien expire expiré expiration telechargement 10 minutes', a: 'Le lien dure <b>10 minutes</b>.<br>Relancez simplement le téléchargement.' },
    { t: 'Partager', q: 'Comment partager avec ma famille ?', k: 'partager partage famille amis lien mot de passe envoyer invite', a: 'Touchez <b>Partager</b>, créez un lien avec un mot de passe, puis envoyez-le par WhatsApp ou e-mail.<br>Vos proches peuvent aussi laisser des mots sous les photos.' },
    { t: 'Commentaire', q: 'Comment laisser un commentaire ?', k: 'commentaire commenter message ecrire retouche demande question photographe contacter', a: 'Ouvrez une photo et écrivez dans <b>Commentaires</b>.<br>Votre photographe vous répond.' },
    { t: 'Diaporama', q: 'Comment lancer le diaporama ?', k: 'diaporama slideshow musique plein ecran defiler lecture', a: 'Dans une galerie, touchez <b>Diaporama</b>. Glissez à gauche ou à droite pour changer de photo.' },
    { t: 'Durée', q: 'Combien de temps ma galerie reste-t-elle disponible ?', k: 'duree expire expiration disparait supprimee combien temps disponible conservation', a: 'Votre photographe fixe une date de fin. Vous êtes prévenu <b>7 jours avant</b>.<br>Téléchargez vos photos avant cette date.' },
    { t: 'Vie privée', q: 'Mes photos sont-elles privées ?', k: 'prive privee securite confidentiel confidentialite visible google public', a: 'Oui. Seuls vous et ceux qui ont votre lien et son mot de passe peuvent les voir. Elles ne sont jamais indexées par Google.' },
    { t: 'Donner mon avis', q: 'Comment donner mon avis ?', k: 'avis etoiles note noter evaluer commentaire satisfaction', a: 'Dans votre galerie, touchez les <b>étoiles</b> : l’avis part tout de suite.<br>Vous pouvez ajouter un commentaire dans <b>Mon avis</b>.' },
  ] },
  { id: 'rdv', label: 'Rendez-vous', items: [
    { t: 'Réserver', q: 'Comment réserver un rendez-vous ?', k: 'reserver reservation rendez vous rdv seance date heure creneau prendre', a: 'Menu <b>Rendez-vous</b> → choisissez votre photographe, un jour libre puis une heure.<br>Il confirme ou vous propose une autre date.' },
    { t: 'Annuler un rendez-vous', q: 'Comment annuler ou changer mon rendez-vous ?', k: 'annuler annulation changer modifier deplacer reporter rendez vous rdv', a: 'Menu <b>Rendez-vous</b> → <b>Annuler</b>, puis choisissez un autre créneau.<br>Écrivez à votre photographe pour un report.' },
    { t: 'Autre date proposée', q: 'Mon photographe propose une autre date', k: 'autre date proposee proposition accepter refuser nouvelle date', a: 'Menu <b>Rendez-vous</b> → <b>Accepter</b> ou <b>Refuser</b> la nouvelle date. Il est prévenu aussitôt.' },
    { t: 'Rappels', q: 'Vais-je recevoir un rappel ?', k: 'rappel rappels notification veille rendez vous prevenu', a: 'Oui : un rappel (e-mail et notification) la <b>veille</b> de votre rendez-vous.' },
  ] },
  { id: 'docs', label: 'Contrats et factures', items: [
    { t: 'Signer un contrat', q: 'Comment signer mon contrat ?', k: 'signer signature contrat electronique accepter lire doigt', a: 'Menu <b>Mes contrats</b> → <b>Lire et signer</b>.<br>Lisez, signez avec le doigt, écrivez votre nom et touchez <b>Signer</b>.' },
    { t: 'Refuser un point', q: 'Je n’accepte pas un point du contrat', k: 'refuser point clause souligner decocher contrat pas d accord reserve', a: 'Avant de signer, touchez la <b>ligne</b> concernée : elle est soulignée en rouge et votre photographe le voit.<br>Les cases se cochent ou se décochent d’un toucher.' },
    { t: 'Payer une facture', q: 'Comment payer ma facture ?', k: 'payer paiement facture moncash natcash regler argent', a: 'Menu <b>Mes factures</b> → ouvrez la facture.<br>Payez par <b>MonCash</b> ou <b>NatCash</b> au numéro indiqué, puis envoyez la capture à votre photographe.' },
    { t: 'Facture payée ?', q: 'Comment savoir si ma facture est payée ?', k: 'facture payee solde reste statut confirme recu', a: 'Le statut passe à <b>Payée</b> dès que votre photographe confirme le paiement.<br>Vous voyez toujours le solde restant.' },
  ] },
  { id: 'orders', label: 'Commandes', items: [
    { t: 'Commander un album', q: 'Comment commander un album ou un tirage ?', k: 'commander commande album tirage impression photo imprimer produit', a: 'Menu <b>Commandes</b> → choisissez un produit, puis vos photos, et touchez <b>Envoyer ma commande</b>.' },
    { t: 'Suivre ma commande', q: 'Comment suivre ma commande ?', k: 'suivre commande statut livraison prete retrait preparation', a: 'Menu <b>Commandes</b> : Nouvelle → Acceptée → En préparation → Prête → Remise.<br>Vous êtes prévenu à chaque étape.' },
  ] },
  { id: 'account', label: 'Mon compte', items: [
    { t: 'Mot de passe oublié', q: 'J’ai oublié mon mot de passe', k: 'mot de passe oublie connexion connecter reinitialiser login', a: 'Page de connexion → <b>Mot de passe oublié ?</b><br>Un lien vous est envoyé par e-mail.' },
    { t: 'Changer mon mot de passe', q: 'Comment changer mon mot de passe ?', k: 'changer modifier mot de passe securite profil', a: '<b>Profil</b> → <b>Sécurité</b> → <b>Mot de passe</b>.' },
    { t: 'Appareils connectés', q: 'Comment déconnecter un appareil ?', k: 'appareil appareils connecte deconnecter telephone ordinateur session securite', a: '<b>Profil</b> → <b>Appareils connectés</b> : touchez <b>Déconnecter</b> à côté de l’appareil, ou <b>tous les autres</b>.' },
    { t: 'Notifications', q: 'Comment activer les notifications ?', k: 'notification notifications alerte activer telephone prevenu push', a: '<b>Profil</b> → <b>Notifications</b> → activez-les sur cet appareil.<br>Vous êtes prévenu quand vos photos sont prêtes.' },
    { t: 'Ajouter un photographe', q: 'Comment ajouter un autre photographe ?', k: 'ajouter photographe code plusieurs autre', a: 'Menu <b>Mes photographes</b> → entrez son code (2 à 4 lettres ou chiffres).' },
    { t: 'Thème sombre', q: 'Comment mettre le thème sombre ?', k: 'theme sombre clair nuit dark apparence couleur', a: '<b>Profil</b> → <b>Apparence</b> : clair, sombre ou automatique.' },
    { t: 'Installer', q: 'Comment installer l’application ?', k: 'installer application app telephone ecran accueil icone pwa', a: 'Touchez <b>Installer l’application</b> : elle s’ajoute à votre écran d’accueil.' },
  ] },
];
const FAQ = GROUPS.flatMap((g) => g.items);

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ');
const STOP = new Set('comment pour avec mes les des une que qui est pas sur dans mon ton ses nos vos peux puis pourquoi quand'.split(' '));
const words = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

function search(text, list = FAQ) {
  const w = words(text);
  if (!w.length) return [];
  return list.map((f) => {
    const hay = norm(f.q + ' ' + f.k);
    return { f, score: w.reduce((n, x) => n + (hay.includes(x) ? 1 : 0), 0) };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).filter((r, _, all) => r.score === all[0].score).slice(0, 2).map((r) => r.f);
}

export function initFaq(getPhotographers) {
  if (document.getElementById('faq-root')) return;
  const ICON = '/logo/faq-icon.svg';
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
        <div><strong>Aide KentraPix</strong><small><i></i>Réponses instantanées</small></div>
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
  // Question « Contacter mon photographe » : réponse construite avec ses vraies coordonnées.
  const contact = () => {
    const list = getPhotographers?.() || [];
    if (!list.length) return null;
    const one = (p) => {
      const bits = [p.phone && `📞 ${p.phone}`, p.whatsapp && `💬 WhatsApp : ${p.whatsapp}`, p.email && `✉️ ${p.email}`, p.instagram && `📷 @${p.instagram}`].filter(Boolean);
      return `<b>${p.name}</b>${bits.length ? '<br>' + bits.join('<br>') : ''}`;
    };
    return { t: 'Mon photographe', q: 'Comment contacter mon photographe ?', k: 'contacter photographe telephone appeler whatsapp mail email joindre numero coordonnees', a: `${list.map(one).join('<br><br>')}<br><br>Retrouvez-les dans <b>Mes photographes</b>.` };
  };
  const items = () => [contact(), ...FAQ].filter(Boolean);
  const answer = (f) => f.a;
  const chip = (text, onclick, cls = '') => { const c = document.createElement('button'); c.type = 'button'; c.textContent = text; if (cls) c.className = cls; c.onclick = onclick; return c; };
  const suggest = (list) => {
    chips.replaceChildren(...list.map((f) => chip(f.t, () => { say(f.q, true); reply([answer(f)]); })));
  };
  // Accueil : les thèmes (Mes photos, Rendez-vous, Contrats et factures, Commandes, Mon compte) + le contact du photographe.
  const topics = () => {
    const c = contact();
    chips.replaceChildren(
      ...GROUPS.map((g) => chip(g.label, () => { say(g.label, true); reply([`Voici les questions sur <b>${g.label.toLowerCase()}</b> :`]); chips.replaceChildren(...g.items.map((f) => chip(f.t, () => { say(f.q, true); reply([answer(f)]); })), chip('← Tous les thèmes', topics, 'back')); }, 'topic')),
      ...(c ? [chip('Mon photographe', () => { say(c.q, true); reply([answer(c)]); }, 'topic')] : []),
    );
  };
  const hideNudge = () => { nudge.hidden = true; };
  const open = (on) => {
    hideNudge();
    panel.hidden = !on;
    fab.setAttribute('aria-expanded', String(on));
    fab.classList.toggle('on', on);
    if (on) {
      if (!log.children.length) { say(hello() + ' 👋 Comment puis-je vous aider ?<br>Touchez un sujet ou écrivez votre question.'); topics(); }
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
    const found = search(t, items());
    if (found.length) { reply(found.map(answer)); suggest(items().filter((f) => !found.includes(f)).slice(0, 4)); }
    else { reply(['Je n’ai pas trouvé de réponse précise. Essayez avec un autre mot, ou laissez un <b>commentaire</b> sur une photo : votre photographe vous répondra.']); topics(); }
  };

  // Bulle d'invitation, une seule fois par visite.
  try {
    if (!sessionStorage.getItem('kp-faq-nudge')) {
      sessionStorage.setItem('kp-faq-nudge', '1');
      setTimeout(() => { if (panel.hidden) { nudge.hidden = false; setTimeout(hideNudge, 6000); } }, 4000);
    }
  } catch (e) { /* stockage indisponible : pas de bulle */ }
}
