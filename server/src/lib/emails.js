import { config } from '../config.js';

// Modèles d'e-mails KentraPix. Styles en ligne (seuls compris par les messageries),
// couleurs du bleu Kentra : #1265d8, dégradé #1c77ee → #0c4088, texte #082445.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const loginUrl = () => `${config.appUrl}/login.html`;
/** Nom du studio par défaut : celui de MAIL_FROM (« Kenley Photography <…> »). */
const defaultStudio = () => config.mail.from.replace(/\s*<.*$/, '').replace(/"/g, '').trim() || 'KentraPix';

function layout({ preheader, title, body, cta, studio = defaultStudio() }) {
  const button = cta
    ? `<tr><td style="padding:8px 0 4px"><a href="${esc(cta.url)}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#1265d8;background-image:linear-gradient(115deg,#1c77ee,#1056bf);color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">${esc(cta.label)}</a></td></tr>`
    : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f7fc;font-family:'Segoe UI',Inter,Arial,sans-serif;color:#172b46">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fc;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 20px 50px -24px rgba(8,36,69,.35)">
<tr><td style="padding:22px 32px;border-bottom:4px solid #1265d8;background:#ffffff">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:12px;vertical-align:middle"><img src="cid:kentrapix-logo" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;border-radius:11px"></td>
    <td style="vertical-align:middle;font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#082445">Kentra<span style="color:#1265d8">Pix</span></td>
  </tr></table>
</td></tr>
<tr><td style="padding:32px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="font-size:24px;line-height:1.25;font-weight:700;color:#082445;padding-bottom:16px">${esc(title)}</td></tr>
    <tr><td style="font-size:15px;line-height:1.65;color:#3c577c;padding-bottom:20px">${body}</td></tr>
    ${button}
  </table>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e0eaf8;font-size:12px;line-height:1.6;color:#8a9ab3">
  <strong style="color:#3c577c">${esc(studio)}</strong> · Vos souvenirs, votre espace.<br>Envoyé avec KentraPix, car un espace photo a été créé pour vous.
</td></tr>
</table></td></tr></table></body></html>`;
}

const credentials = (email, password) =>
  `<div style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#e8f1ff;color:#082445;font-size:14px;line-height:1.8">
    E-mail : <strong>${esc(email)}</strong><br>Mot de passe temporaire : <strong style="font-family:Consolas,monospace">${esc(password)}</strong>
  </div>Vous choisirez votre propre mot de passe à la première connexion.`;

export function welcomeEmail({ name, email, password, studio = defaultStudio() }) {
  const title = `Bienvenue ${firstName(name)} !`;
  return {
    subject: 'Votre espace photo KentraPix est prêt',
    html: layout({
      studio,
      preheader: 'Vos accès à votre espace photo privé.',
      title,
      body: `${esc(studio)} vous a créé un espace privé pour retrouver vos photos.${credentials(email, password)}`,
      cta: { label: 'Me connecter', url: loginUrl() },
    }),
    text: `${title}\n\n${studio} vous a créé un espace privé.\nE-mail : ${email}\nMot de passe temporaire : ${password}\nVous choisirez votre mot de passe à la première connexion.\n\nConnexion : ${loginUrl()}`,
  };
}

export function galleryReadyEmail({ name, eventName, count, studio = defaultStudio() }) {
  const title = 'Vos photos sont prêtes';
  const url = `${config.appUrl}/client.html`;
  return {
    subject: `Vos photos « ${eventName} » sont prêtes`,
    html: layout({
      studio,
      preheader: `${count} photos vous attendent.`,
      title,
      body: `Bonjour ${esc(firstName(name))},<br><br>Votre galerie <strong style="color:#082445">${esc(eventName)}</strong> est disponible : <strong style="color:#1265d8">${count} photo${count > 1 ? 's' : ''}</strong> vous attendent.`,
      cta: { label: 'Voir mes photos', url },
    }),
    text: `Bonjour ${firstName(name)},\n\nVotre galerie « ${eventName} » est disponible : ${count} photo(s) vous attendent.\n\n${url}`,
  };
}

const longDate = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function expiryEmail({ name, eventName, expiresAt, daysLeft, studio = defaultStudio() }) {
  const when = daysLeft <= 0 ? 'aujourd’hui' : daysLeft === 1 ? 'demain' : `dans ${daysLeft} jours`;
  const url = `${config.appUrl}/client.html`;
  return {
    subject: `Votre galerie « ${eventName} » ferme ${when}`,
    html: layout({
      studio,
      preheader: `Disponible jusqu’au ${longDate(expiresAt)}.`,
      title: `Votre galerie ferme ${when}`,
      body: `Bonjour ${esc(firstName(name))},<br><br>Votre galerie <strong style="color:#082445">${esc(eventName)}</strong> reste disponible jusqu’au <strong style="color:#1265d8">${esc(longDate(expiresAt))}</strong>.<br><br>Pensez à télécharger vos photos préférées avant cette date : ensuite, la galerie ne sera plus accessible.`,
      cta: { label: 'Voir mes photos', url },
    }),
    text: `Bonjour ${firstName(name)},\n\nVotre galerie « ${eventName} » reste disponible jusqu'au ${longDate(expiresAt)}.\nPensez à télécharger vos photos avant cette date.\n\n${url}`,
  };
}

export function passwordResetEmail({ name, email, password, studio = defaultStudio() }) {
  return {
    subject: 'Votre nouveau mot de passe KentraPix',
    html: layout({
      studio,
      preheader: 'Un nouveau mot de passe temporaire a été créé.',
      title: 'Nouveau mot de passe',
      body: `Bonjour ${esc(firstName(name))},<br><br>Un nouveau mot de passe temporaire a été créé pour vous.${credentials(email, password)}`,
      cta: { label: 'Me connecter', url: loginUrl() },
    }),
    text: `Bonjour ${firstName(name)},\n\nNouveau mot de passe temporaire : ${password}\nVous choisirez votre mot de passe à la connexion.\n\n${loginUrl()}`,
  };
}

export function adminInviteEmail({ name, email, password, studio = defaultStudio() }) {
  return {
    subject: 'Vous faites partie de l’équipe KentraPix',
    html: layout({
      studio,
      preheader: 'Vous avez maintenant accès au studio.',
      title: `Bienvenue dans l’équipe, ${firstName(name)} !`,
      body: `Vous avez maintenant accès au studio KentraPix : clients, galeries et photos.${password ? credentials(email, password) : '<br><br>Connectez-vous avec votre mot de passe habituel.'}`,
      cta: { label: 'Ouvrir le studio', url: `${config.appUrl}/admin.html` },
    }),
    text: `Bienvenue dans l'équipe KentraPix.\n${password ? `E-mail : ${email}\nMot de passe temporaire : ${password}\n` : ''}\n${config.appUrl}/admin.html`,
  };
}

export function resetLinkEmail({ name, url }) {
  return {
    subject: 'Réinitialiser votre mot de passe KentraPix',
    html: layout({
      preheader: 'Ce lien est valable 1 heure.',
      title: 'Mot de passe oublié ?',
      body: `Bonjour ${esc(firstName(name))},<br><br>Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable <strong style="color:#082445">1 heure</strong> et ne fonctionne qu’une fois.<br><br>Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste inchangé.`,
      cta: { label: 'Choisir un nouveau mot de passe', url },
    }),
    text: `Bonjour ${firstName(name)},\n\nNouveau mot de passe (lien valable 1 heure) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
  };
}

export function studioResetEmail({ name, url }) {
  return {
    subject: 'Réinitialiser le mot de passe de votre studio KentraPix',
    html: layout({
      preheader: 'Ce lien est valable 1 heure.',
      title: 'Mot de passe du studio oublié ?',
      body: `Bonjour ${esc(firstName(name))},<br><br>Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe pour votre studio. Ce lien est valable <strong style="color:#082445">1 heure</strong> et ne fonctionne qu’une fois.<br><br>Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : le mot de passe de votre studio reste inchangé.`,
      cta: { label: 'Choisir un nouveau mot de passe du studio', url },
    }),
    text: `Bonjour ${firstName(name)},

Nouveau mot de passe du studio (lien valable 1 heure) :
${url}

Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
  };
}

export function signupEmail({ name }) {
  return {
    subject: 'Bienvenue sur KentraPix',
    html: layout({
      preheader: 'Votre compte est créé.',
      title: `Bienvenue ${firstName(name)} !`,
      body: 'Votre compte KentraPix est prêt. Vos galeries apparaîtront ici dès que votre photographe les aura publiées.',
      cta: { label: 'Ouvrir mon espace', url: `${config.appUrl}/client.html` },
    }),
    text: `Bienvenue ${firstName(name)} !\n\nVotre compte KentraPix est prêt.\n${config.appUrl}/client.html`,
  };
}

export function selectionEmail({ clientName, eventName, numbers, note }) {
  const list = numbers.join(', ');
  return {
    subject: `Sélection reçue : ${clientName} — ${eventName}`,
    html: layout({
      preheader: `${numbers.length} photo(s) choisie(s).`,
      title: 'Nouvelle sélection',
      body: `<strong style="color:#082445">${esc(clientName)}</strong> a choisi <strong style="color:#1265d8">${numbers.length} photo${numbers.length > 1 ? 's' : ''}</strong> dans « ${esc(eventName)} » :
        <div style="margin:16px 0;padding:16px 18px;border-radius:14px;background:#e8f1ff;color:#082445;font-size:15px;line-height:1.7;font-weight:700">N° ${esc(list)}</div>
        ${note ? `Message du client :<br><em>« ${esc(note).replace(/\r?\n/g, '<br>')} »</em>` : ''}`,
      cta: { label: 'Ouvrir le studio', url: `${config.appUrl}/admin.html` },
    }),
    text: `${clientName} a choisi ${numbers.length} photo(s) dans « ${eventName} » : N° ${list}${note ? `\n\nMessage : ${note}` : ''}`,
  };
}

/** Notification écrite dans le studio (page « Notifications »), avec la galerie liée s'il y en a une. */
export function announcementEmail({ name, title, body, eventName = null, studio = defaultStudio() }) {
  const url = `${config.appUrl}/client.html`;
  return {
    subject: title,
    html: layout({
      studio,
      preheader: body.slice(0, 90),
      title,
      body: `Bonjour ${esc(firstName(name))},<br><br>${esc(body).replace(/\r?\n/g, '<br>')}${eventName ? `<br><br>Galerie : <strong style="color:#082445">${esc(eventName)}</strong>` : ''}`,
      cta: { label: eventName ? 'Voir la galerie' : 'Ouvrir mon espace', url },
    }),
    text: `Bonjour ${firstName(name)},\n\n${body}${eventName ? `\n\nGalerie : ${eventName}` : ''}\n\n${url}`,
  };
}

export function messageEmail({ name, subject, message, studio = defaultStudio() }) {
  return {
    subject,
    html: layout({
      studio,
      preheader: message.slice(0, 90),
      title: subject,
      body: `Bonjour ${esc(firstName(name))},<br><br>${esc(message).replace(/\r?\n/g, '<br>')}`,
      cta: { label: 'Ouvrir mon espace', url: `${config.appUrl}/client.html` },
    }),
    text: `Bonjour ${firstName(name)},\n\n${message}\n\n${config.appUrl}/client.html`,
  };
}
