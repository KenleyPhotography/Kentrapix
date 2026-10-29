// Contrats de site internet : système à part, sans aucun lien avec les séances photo ni les rendez-vous.
// On remplit une fiche (client, projet, prix, délais) et le contrat se rédige tout seul en dessous.
// Ensuite il se signe comme un contrat photo : le studio signe, le client reçoit un lien secret et
// dessine sa signature depuis son téléphone — sans avoir besoin d'un compte KentraPix.
import { api, escape, hello } from './service.js';
import { icon } from './icons.js';
import { auth } from './auth.js';
import { waLink, firstName } from './whatsapp.js';
import { openSignatureModal } from './signature.js';

const API = '/api/admin/websites';
// Les boutons « Aperçu / Signer » ouvrent le contrat sur le site où l'on se trouve (même en essai sur localhost) ; les liens copiés restent complets.
const local = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };
const STATUS = { pending: ['En attente de signature', 'is-draft'], signed: ['Signé', 'is-live'], cancelled: ['Annulé', 'is-muted'] };
const fstamp = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const studioName = () => { const u = auth.session(); return u?.senderName || u?.name || 'Le prestataire'; };

const SITE_TYPES = ['Site vitrine', 'Site d’entreprise', 'Boutique en ligne', 'Portfolio', 'Blog / actualités', 'Page unique (landing page)', 'Application web', 'Autre'];
const FEATURES = [
  'Version mobile (responsive)', 'Certificat SSL (https)', 'Formulaire de contact', 'Bouton WhatsApp',
  'Galerie photo', 'Blog / actualités', 'Paiement en ligne', 'Réservation en ligne',
  'Espace client', 'Référencement Google (de base)', 'Liens vers les réseaux sociaux', 'Site multilingue',
];
const FEATURES_ON = [0, 1, 2, 3, 9]; // cochées par défaut : ce que tout site reçoit de toute façon

/** Modèle de contrat de création de site internet : à relire et adapter avant l'envoi. */
const DEFAULT_TEMPLATE = `CONTRAT DE CRÉATION DE SITE INTERNET

Entre les soussignés :

Le Prestataire : {{studio}}
Téléphone : {{studioPhone}}
E-mail : {{studioEmail}}

Et

Le Client : {{client}}
Entreprise : {{company}}
Téléphone : {{clientPhone}}
E-mail : {{clientEmail}}

1. Objet du contrat
Le présent contrat a pour objet la création d’un site internet pour le client, avec les caractéristiques et les fonctionnalités décrites ci-dessous.

2. Le site
• Type de site : {{siteType}}
• Nom de domaine : {{domain}}
• Nombre de pages prévues : {{pages}}
• Langue(s) du site : {{languages}}

3. Fonctionnalités incluses
{{features}}

4. Tarifs
• Montant total : {{price}}
• Acompte à la commande : {{deposit}}
• Solde à la mise en ligne : {{balance}}
• Hébergement et nom de domaine : {{hosting}} par an
• Maintenance (mises à jour, sauvegardes, petites corrections) : {{maintenance}} par mois

5. Conditions de paiement
• Le travail commence après la signature de ce contrat et le versement de l’acompte.
• Le solde est payable le jour de la mise en ligne du site.
• L’hébergement et le nom de domaine se renouvellent chaque année et se paient d’avance.
• Passé 30 jours de retard de paiement, le prestataire peut suspendre le site jusqu’au règlement.

6. Délais et contenu
• Délai de réalisation : {{delay}} jours ouvrables à partir de la réception de l’acompte et de tout le contenu.
• Mise en ligne prévue le : {{launch}}.
• Contenu fourni par le client : {{content}}.
• Les délais sont suspendus aussi longtemps que le prestataire attend un contenu ou une réponse du client.

7. Corrections et modifications
• {{revisions}} séries de corrections sont incluses avant la mise en ligne.
• Toute demande supplémentaire, et toute modification de ce qui a déjà été accepté (nouvelles pages, nouvelles fonctionnalités, nouveau design), fait l’objet d’un devis à part.

8. Propriété du site
• Le site, son contenu et son nom de domaine appartiennent au client dès le paiement intégral de la prestation.
• Le prestataire garde le droit de citer le site et d’en montrer des images dans son portfolio, sauf refus écrit du client.
• Le prestataire reste propriétaire des outils, modèles et bibliothèques qu’il réutilise d’un projet à l’autre.

9. Contenu fourni par le client
Le client garantit qu’il détient les droits sur les textes, les images et les logos qu’il transmet, et il reste seul responsable de leur contenu.

10. Hébergement, sauvegardes et sécurité
• Hébergement retenu : {{hostingPlan}}.
• Le prestataire ne peut être tenu responsable d’une panne de l’hébergeur, d’une coupure d’internet ou d’une intrusion due à un mot de passe transmis ou mal gardé par le client.
• Sans contrat de maintenance, les sauvegardes et les mises à jour restent à la charge du client.

11. Remise et formation
À la mise en ligne, le prestataire remet au client tous ses accès (hébergement, nom de domaine, administration du site) et lui explique l’utilisation du site : {{training}}.

12. Garantie
Pendant {{warranty}} jours après la mise en ligne, le prestataire corrige gratuitement toute panne ou tout défaut venant de son travail. Cette garantie ne couvre ni les changements de contenu ni les nouvelles demandes.

13. Annulation
• En cas d’annulation par le client, l’acompte reste acquis au prestataire pour le travail déjà réalisé.
• En cas d’annulation par le prestataire avant le début des travaux, l’acompte est rendu au client.

14. Force majeure
Aucune des deux parties n’est responsable d’un retard causé par un événement hors de son contrôle : panne générale d’internet, coupure d’électricité prolongée, catastrophe naturelle, troubles, maladie grave.

15. Acceptation
Par leur signature, les parties déclarent avoir lu, compris et accepté l’ensemble des clauses du présent contrat. La signature électronique a la même valeur qu’une signature sur papier.

Observations :
{{notes}}`;

// Valeurs de remplacement quand un champ de la fiche est laissé vide.
const FALLBACK = {
  client: '…', company: '…', clientPhone: '…', clientEmail: '…', studio: '', studioPhone: '…', studioEmail: '…',
  siteType: 'à définir', domain: 'à définir', pages: '…', languages: 'français', features: '…',
  price: '…', deposit: '…', balance: '…', hosting: '…', maintenance: '…', hostingPlan: 'à définir',
  delay: '…', launch: 'à convenir', revisions: '2', warranty: '30', content: 'textes, photos et logo',
  training: 'une séance d’explication', notes: '…',
};
const fillTemplate = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in FALLBACK || k in vars ? (vars[k] || FALLBACK[k] || '…') : all));
/** Inverse : remet les valeurs saisies sous forme de {{…}} pour enregistrer un modèle réutilisable. */
const unfillTemplate = (text, vars) => Object.entries(vars).filter(([, v]) => v && String(v).length > 1).sort((x, y) => String(y[1]).length - String(x[1]).length)
  .reduce((t, [k, v]) => t.split(v).join(`{{${k}}}`), text);

export const adminWebContractsPage = () => '<div class="greeting"><h1>Sites web</h1></div><div id="web-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindAdminWebContracts({ toast, modal }) {
  const root = document.getElementById('web-root');
  if (!root) return;
  let d;
  try { d = await api(API); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
  const reload = async () => { d = await api(API); draw(); };
  const find = (id) => d.contracts.find((c) => c.id === id);
  const pill = (s) => `<span class="badge ${STATUS[s][1]} ctr-status">${s === 'pending' ? `${icon('clock')} ` : s === 'signed' ? `${icon('check')} ` : ''}${STATUS[s][0]}</span>`;

  const card = (c) => {
    const f = c.sheet || {};
    const text = `${hello()} ${firstName(c.client.name)}, c’est ${studioName()}. Voici le contrat « ${c.title} » pour votre site internet, à lire et signer en ligne (1 minute) : ${c.url}`;
    const wa = waLink(c.client.whatsapp, text);
    const about = [f.domain, f.siteType, f.price].filter(Boolean).join(' · ');
    return `<article class="inv-card ${c.status === 'cancelled' ? 'is-off' : ''}">
      <header><span class="inv-ico">${icon('globe')}</span><div><strong>${escape(c.title)}</strong><span>${escape(c.client.name)}${f.company ? ` · ${escape(f.company)}` : ''}</span></div>${pill(c.status)}</header>
      ${about ? `<p class="inv-foot web-about"><span>${escape(about)}</span></p>` : ''}
      <p class="inv-foot">${c.status === 'pending' && !c.staffSigned ? '<span>À signer par vous avant l’envoi</span>' : ''}${c.status === 'signed' && c.reserves ? `<span class="ctr-reserve">Signé avec ${c.reserves} point${c.reserves > 1 ? 's' : ''} non accepté${c.reserves > 1 ? 's' : ''} : ouvrez le contrat</span>` : ''}${c.status === 'signed' ? `<span>Signé par ${escape(c.signedName)} · ${escape(fstamp(c.signedAt))}</span>` : `<span>Créé le ${escape(fstamp(c.createdAt))}</span>${c.sentAt ? '<span>Envoyé par e-mail</span>' : ''}`}</p>
      <div class="actions"><a class="btn sm" href="${escape(local(c.url))}" target="_blank" rel="noopener noreferrer">${icon('eye')} ${c.status === 'signed' ? 'Voir / imprimer' : 'Aperçu'}</a>
        ${c.status === 'pending' && !c.staffSigned ? `<a class="btn sm primary" href="${escape(local(c.url))}" target="_blank" rel="noopener noreferrer">${icon('edit')} Signer le contrat</a>` : ''}
        ${c.status === 'pending' && c.staffSigned && c.client.email ? `<button type="button" class="btn sm primary" data-web-send="${c.id}">${icon('send')} Envoyer par e-mail</button>` : ''}
        ${c.status === 'pending' && c.staffSigned && wa ? `<a class="btn sm icon-btn" href="${escape(wa)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" title="Envoyer par WhatsApp">${icon('chat')}</a>` : ''}
        ${c.status === 'pending' ? `<button type="button" class="btn sm" data-web-copy="${c.id}">${icon('copy')} Copier le lien</button><button type="button" class="btn sm" data-web-edit="${c.id}">Modifier</button><button type="button" class="btn sm" data-web-cancel="${c.id}">Annuler</button>` : ''}
        ${c.status !== 'signed' ? `<button type="button" class="btn sm icon-btn danger" data-web-del="${c.id}" aria-label="Supprimer" title="Supprimer">${icon('trash')}</button>` : ''}</div>
    </article>`;
  };

  const draw = () => {
    const open = d.contracts.filter((c) => c.status === 'pending');
    const signed = d.contracts.filter((c) => c.status === 'signed');
    const off = d.contracts.filter((c) => c.status === 'cancelled');
    root.innerHTML = `<div class="actions" style="margin:0 0 18px"><button type="button" class="btn primary" id="web-new">${icon('plus')} Nouveau contrat de site web</button><button type="button" class="btn" id="web-sign">${icon('edit')} Ma signature ${d.mySignature ? '✓' : ''}</button></div>
      <p class="small web-intro">Ces contrats sont indépendants de vos séances photo : vous remplissez la fiche du projet, le contrat se rédige tout seul, et votre client le signe depuis un lien — sans compte KentraPix.</p>
      ${d.mySignature ? '' : '<p class="small" style="margin:-6px 0 14px">Enregistrez <strong>votre signature</strong> (bouton ci-dessus) : elle sera apposée automatiquement sur chaque contrat. Sinon, vous signez sur la page du contrat.</p>'}
      <section class="settings bill-block"><h2>À signer</h2>${open.length ? `<div class="inv-grid">${open.map(card).join('')}</div>` : '<div class="empty small"><p>Aucun contrat en attente.</p></div>'}</section>
      <section class="settings bill-block"><h2>Signés</h2>${signed.length ? `<div class="inv-grid">${signed.map(card).join('')}</div>` : '<div class="empty small"><p>Aucun contrat signé pour le moment.</p></div>'}</section>
      ${off.length ? `<details class="acc"><summary><span>Contrats annulés</span><small>${off.length}</small></summary><div class="acc-body inv-grid">${off.map(card).join('')}</div></details>` : ''}`;
    wire();
  };

  function wire() {
    root.querySelector('#web-new').onclick = () => formModal();
    root.querySelector('#web-sign').onclick = () => openSignatureModal({ modal, toast, current: d.mySignature, onSaved: (sig) => { d.mySignature = sig; draw(); } });
    root.querySelectorAll('[data-web-edit]').forEach((b) => { b.onclick = () => formModal(find(b.dataset.webEdit)); });
    root.querySelectorAll('[data-web-send]').forEach((b) => { b.onclick = guard(async () => {
      const c = find(b.dataset.webSend);
      if (!confirm(`Envoyer le contrat « ${c.title} » à ${c.client.name} (${c.client.email}) ?`)) return;
      b.disabled = true; const r = await api(`${API}/${c.id}/send`, { method: 'POST' });
      toast(r.email.status === 'sent' ? 'Contrat envoyé par e-mail.' : r.email.status === 'skipped' ? 'E-mail non envoyé : l’envoi d’e-mails n’est pas actif. Copiez le lien ou utilisez WhatsApp.' : `E-mail non envoyé : ${r.email.error || 'erreur'}`);
      await reload();
    }); });
    root.querySelectorAll('[data-web-copy]').forEach((b) => { b.onclick = guard(async () => { await navigator.clipboard.writeText(find(b.dataset.webCopy).url); toast('Lien copié.'); }); });
    root.querySelectorAll('[data-web-cancel]').forEach((b) => { b.onclick = guard(async () => {
      if (!confirm('Annuler ce contrat ? Le lien ne fonctionnera plus.')) return;
      await api(`${API}/${b.dataset.webCancel}`, { method: 'PATCH', body: { cancelled: true } }); await reload();
    }); });
    root.querySelectorAll('[data-web-del]').forEach((b) => { b.onclick = guard(async () => {
      if (!confirm('Supprimer définitivement ce contrat ?')) return;
      await api(`${API}/${b.dataset.webDel}`, { method: 'DELETE' }); await reload();
    }); });
  }

  // ----- Fiche du projet : les champs du haut écrivent le contrat du bas en direct -----
  function formModal(contract = null) {
    const f = contract?.sheet || {};
    const opt = (list, v) => list.map((x) => `<option value="${escape(x)}" ${x === v ? 'selected' : ''}>${escape(x)}</option>`).join('');
    // Fonctionnalités cochées : celles de la fiche enregistrée, ou les cases par défaut pour un nouveau contrat.
    const on = (i) => (f.features ? f.features.includes(FEATURES[i]) : FEATURES_ON.includes(i));
    modal(contract ? 'Modifier le contrat' : 'Nouveau contrat de site web', `
      <fieldset class="ctr-products"><legend>Le client</legend>
        <label>Nom du client<input name="name" id="web-name" required maxlength="80" placeholder="Ex. Marie Joseph" value="${escape(contract?.client.name || '')}"></label>
        <label>Entreprise <span class="optional">(facultatif)</span><input name="company" id="web-company" maxlength="120" placeholder="Ex. Boutique Soleil" value="${escape(f.company || '')}"></label>
        <div class="row2"><label>Téléphone / WhatsApp<input name="phone" id="web-phone" type="tel" maxlength="40" value="${escape(contract?.client.phone || '')}"></label>
        <label>E-mail <span class="optional">(facultatif)</span><input name="email" id="web-email" type="email" maxlength="190" value="${escape(contract?.client.email || '')}"></label></div>
      </fieldset>
      <fieldset class="ctr-products"><legend>Le site</legend>
        <div class="row2"><label>Type de site<select name="siteType" id="web-type">${opt(SITE_TYPES, f.siteType || SITE_TYPES[0])}</select></label>
        <label>Nom de domaine<input name="domain" id="web-domain" maxlength="120" placeholder="Ex. boutiquesoleil.com" value="${escape(f.domain || '')}"></label></div>
        <div class="row2"><label>Nombre de pages<input name="pages" id="web-pages" maxlength="30" placeholder="Ex. 5" value="${escape(f.pages || '')}"></label>
        <label>Langue(s)<input name="languages" id="web-languages" maxlength="60" placeholder="Ex. français, créole" value="${escape(f.languages || '')}"></label></div>
      </fieldset>
      <fieldset class="ctr-products"><legend>Fonctionnalités incluses</legend>${FEATURES.map((x, i) => `<label class="ctr-check"><input type="checkbox" class="web-feat" value="${escape(x)}" ${on(i) ? 'checked' : ''}> ${escape(x)}</label>`).join('')}</fieldset>
      <fieldset class="ctr-products"><legend>Prix et paiement</legend>
        <div class="row2"><label>Prix total<input name="price" id="web-price" maxlength="40" placeholder="Ex. 600 USD" value="${escape(f.price || '')}"></label>
        <label>Acompte <span class="optional">(50 % par défaut)</span><input name="deposit" id="web-deposit" maxlength="40" value="${escape(f.deposit || '')}" ${f.deposit ? 'data-edited="1"' : ''}></label></div>
        <div class="row2"><label>Hébergement + domaine par an<input name="hosting" id="web-hosting" maxlength="40" placeholder="Ex. 120 USD" value="${escape(f.hosting || '')}"></label>
        <label>Maintenance par mois <span class="optional">(facultatif)</span><input name="maintenance" id="web-maintenance" maxlength="40" placeholder="Ex. 25 USD" value="${escape(f.maintenance || '')}"></label></div>
        <label>Hébergement retenu <span class="optional">(facultatif)</span><input name="hostingPlan" id="web-plan" maxlength="120" placeholder="Ex. Hostinger, formule 1 an" value="${escape(f.hostingPlan || '')}"></label>
      </fieldset>
      <fieldset class="ctr-products"><legend>Délais et suites</legend>
        <div class="row2"><label>Délai de réalisation (jours ouvrables)<input name="delay" id="web-delay" type="number" min="1" max="365" placeholder="Ex. 21" value="${escape(f.delay || '')}"></label>
        <label>Mise en ligne prévue le<input name="launch" id="web-launch" maxlength="40" placeholder="Ex. 15 décembre 2026" value="${escape(f.launch || '')}"></label></div>
        <div class="row2"><label>Séries de corrections incluses<input name="revisions" id="web-revisions" type="number" min="0" max="20" placeholder="2" value="${escape(f.revisions || '')}"></label>
        <label>Garantie après mise en ligne (jours)<input name="warranty" id="web-warranty" type="number" min="0" max="365" placeholder="30" value="${escape(f.warranty || '')}"></label></div>
        <label>Contenu fourni par le client<input name="content" id="web-content" maxlength="200" placeholder="Ex. textes, photos et logo" value="${escape(f.content || '')}"></label>
        <label>Remise et formation<input name="training" id="web-training" maxlength="200" placeholder="Ex. une séance d’explication de 1 heure" value="${escape(f.training || '')}"></label>
        <label>Observations <span class="optional">(facultatif)</span><input name="notes" id="web-notes" maxlength="300" value="${escape(f.notes || '')}"></label>
      </fieldset>
      <label>Modèle de contrat<select id="web-tpl"><option value="">Modèle KentraPix (création de site internet)</option>${d.templates.map((t) => `<option value="${t.id}">${escape(t.name)}</option>`).join('')}</select></label>
      <label>Objet <span class="optional">(la ligne en tête du contrat)</span><input name="subject" id="web-subject" maxlength="120" value="${escape(contract?.subject || '')}" placeholder="Ex. Contrat de création de site internet"></label>
      <label>Titre<input name="title" id="web-title" required maxlength="200" value="${escape(contract?.title || '')}" ${contract ? 'data-edited="1"' : ''} placeholder="Ex. Contrat — Site internet Boutique Soleil"></label>
      <label>Texte du contrat <span class="optional">(relisez et adaptez)</span><textarea name="body" id="web-body" rows="14" required maxlength="20000" style="font:14px/1.5 Inter,sans-serif">${escape(contract?.body || '')}</textarea></label>
      <p class="field-hint" id="web-kept" hidden>Votre texte est gardé tel quel : les champs ci-dessus ne le modifient plus. Pour repartir du modèle, rechoisissez-le dans la liste.</p>
      <div class="actions" style="justify-content:flex-start"><button type="button" class="btn sm" id="web-tpl-save">Enregistrer comme modèle</button><button type="button" class="btn sm danger" id="web-tpl-del" hidden>Supprimer ce modèle</button></div>`,
    async (v) => {
      const payload = {
        subject: v.subject, title: v.title, body: v.body, sheet: sheet(),
        client: { name: v.name.trim(), phone: (v.phone || '').trim(), email: (v.email || '').trim() },
      };
      if (contract) {
        await api(`${API}/${contract.id}`, { method: 'PATCH', body: payload });
        toast('Contrat modifié.');
      } else {
        await api(API, { method: 'POST', body: payload });
        toast('Contrat créé : ouvrez-le pour le signer, puis envoyez-le à votre client.');
      }
      await reload();
    }, { submit: contract ? 'Enregistrer' : 'Créer le contrat' });

    const host = document.getElementById('overlays');
    const el = (id) => host.querySelector(id);
    const val = (id) => el(id).value.trim();
    let touched = !!contract; // un contrat qu'on modifie garde son texte tant qu'on ne change rien
    el('#web-body').addEventListener('input', () => { touched = true; });
    el('#web-title').addEventListener('input', () => { el('#web-title').dataset.edited = '1'; });
    el('#web-deposit').addEventListener('input', () => { el('#web-deposit').dataset.edited = '1'; });

    // Acompte : 50 % du prix total, calculé à partir de « 600 USD » tant que vous n'écrivez pas le vôtre.
    const money = (s) => { const m = String(s).replace(/\s/g, '').match(/^(\d+(?:[.,]\d+)?)(.*)$/); return m ? { n: Number(m[1].replace(',', '.')), cur: m[2].trim() } : null; };
    const fmt = (n, cur) => `${(Math.round(n * 100) / 100).toLocaleString('fr-FR')}${cur ? ` ${cur}` : ''}`;
    const split = () => {
      const p = money(val('#web-price')); if (!p) return { deposit: val('#web-deposit'), balance: '' };
      const typed = money(val('#web-deposit'));
      const dep = typed && el('#web-deposit').dataset.edited ? typed.n : p.n * 0.5;
      return { deposit: fmt(dep, p.cur), balance: fmt(Math.max(0, p.n - dep), p.cur) };
    };
    const features = () => [...host.querySelectorAll('.web-feat')].filter((c) => c.checked).map((c) => c.value);
    const featuresText = () => FEATURES.map((x) => `${features().includes(x) ? '☑' : '☐'} ${x}`).join('\n');

    /** La fiche enregistrée avec le contrat : elle permet de le rouvrir et de le corriger plus tard. */
    const sheet = () => ({
      company: val('#web-company'), siteType: val('#web-type'), domain: val('#web-domain'), pages: val('#web-pages'), languages: val('#web-languages'),
      features: features(), price: val('#web-price'), deposit: split().deposit, hosting: val('#web-hosting'), maintenance: val('#web-maintenance'),
      hostingPlan: val('#web-plan'), delay: val('#web-delay'), launch: val('#web-launch'), revisions: val('#web-revisions'), warranty: val('#web-warranty'),
      content: val('#web-content'), training: val('#web-training'), notes: val('#web-notes'),
    });

    const vars = () => {
      const u = auth.session() || {};
      const sp = split();
      return {
        ...sheet(), features: featuresText(), deposit: sp.deposit, balance: sp.balance,
        client: val('#web-name'), clientPhone: val('#web-phone'), clientEmail: val('#web-email'),
        studio: studioName(), studioPhone: u.phone || u.whatsapp || '…', studioEmail: u.email || '…',
      };
    };

    const saved = () => d.templates.find((t) => t.id === el('#web-tpl').value);
    // Le texte écrit par le photographe n'est JAMAIS remplacé par les champs de la fiche : dès qu'il y touche,
    // la fiche cesse de le réécrire (un mot dit pourquoi). Seul un choix dans la liste des modèles le refait,
    // et encore faut-il le confirmer : ce qu'il a écrit est ce que le client reçoit.
    const refill = (picked) => {
      const kept = el('#web-kept');
      if (touched && !picked) { if (kept) kept.hidden = false; return; }
      if (touched && !confirm('Reprendre le modèle ? Le texte que vous avez écrit sera remplacé.')) return;
      if (!el('#web-title').dataset.edited) el('#web-title').value = `Contrat — Site internet — ${val('#web-company') || val('#web-name') || 'nouveau client'}`;
      el('#web-body').value = fillTemplate(saved()?.body || DEFAULT_TEMPLATE, vars());
      touched = false;
      if (kept) kept.hidden = true;
    };
    const syncDel = () => { el('#web-tpl-del').hidden = !saved(); };
    el('#web-tpl').addEventListener('change', () => { syncDel(); refill(true); });
    el('#web-tpl-save').onclick = guard(async () => {
      const cur = saved();
      const name = prompt(cur ? 'Nom du modèle (gardez-le pour mettre à jour ce modèle) :' : 'Nom du nouveau modèle (ex. Site vitrine, Boutique en ligne) :', cur?.name || '');
      if (!name?.trim()) return;
      const body = unfillTemplate(el('#web-body').value, vars());
      const same = cur && cur.name === name.trim();
      const res = await api(same ? `${API}/templates/${cur.id}` : `${API}/templates`, { method: same ? 'PUT' : 'POST', body: { name: name.trim(), body } });
      if (same) cur.body = body; else { d.templates.push(res.template); d.templates.sort((x, y) => x.name.localeCompare(y.name)); }
      el('#web-tpl').innerHTML = `<option value="">Modèle KentraPix (création de site internet)</option>${d.templates.map((t) => `<option value="${t.id}">${escape(t.name)}</option>`).join('')}`;
      el('#web-tpl').value = res.template.id; syncDel(); touched = false;
      toast('Modèle enregistré.');
    });
    el('#web-tpl-del').onclick = guard(async () => {
      const cur = saved();
      if (!cur || !confirm(`Supprimer le modèle « ${cur.name} » ?`)) return;
      await api(`${API}/templates/${cur.id}`, { method: 'DELETE' });
      d.templates = d.templates.filter((t) => t.id !== cur.id);
      el('#web-tpl').querySelector(`option[value="${cur.id}"]`)?.remove(); el('#web-tpl').value = ''; syncDel(); refill(true);
    });

    host.querySelectorAll('.web-feat').forEach((c) => c.addEventListener('change', () => refill()));
    ['#web-name', '#web-company', '#web-phone', '#web-email', '#web-type', '#web-domain', '#web-pages', '#web-languages', '#web-price', '#web-deposit',
      '#web-hosting', '#web-maintenance', '#web-plan', '#web-delay', '#web-launch', '#web-revisions', '#web-warranty', '#web-content', '#web-training', '#web-notes']
      .forEach((id) => el(id).addEventListener('change', () => refill()));
    if (!contract) refill();
  }

  draw();
}
