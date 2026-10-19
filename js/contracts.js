// Contrats avec signature électronique : le photographe rédige (modèle prêt à adapter), envoie le lien au client, suit les signatures.
// Règle du studio : pas de séance sans contrat signé — les séances confirmées sans papier signé sont signalées en haut.
import { api, escape, hello } from './service.js';
import { icon } from './icons.js';
import { auth } from './auth.js';
import { waLink, firstName } from './whatsapp.js';
import { openSignatureModal } from './signature.js';

// Les boutons « Aperçu / Signer » ouvrent le contrat sur le site où l'on se trouve (même en essai sur localhost) ; les liens copiés ou envoyés restent complets.
const local = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };
const STATUS = { pending: ['En attente de signature', 'is-draft'], signed: ['Signé', 'is-live'], cancelled: ['Annulé', 'is-muted'] };
const fday = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '');
const fstamp = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const studioName = () => { const u = auth.session(); return u?.senderName || u?.name || 'Le photographe'; };

/** Modèle de contrat de séance photo : à relire et adapter avant l'envoi. */
const DEFAULT_TEMPLATE = `CONTRAT DE PRESTATION PHOTOGRAPHIQUE

Entre : {{studio}} (« le photographe »)
Et : {{client}} (« le client »)

1. Objet
Le photographe réalise pour le client une séance photo : {{session}}.
Date : {{date}}. Lieu : {{place}}.

2. Prix et paiement
Prix total : {{price}}. Acompte à la réservation : {{deposit}}. Le solde est payable au plus tard le jour de la séance ou à la remise des photos, selon l’accord entre les deux parties.
L’acompte n’est pas remboursable en cas d’annulation par le client moins de 48 heures avant la séance.

3. Report et annulation
Toute modification de date doit être demandée au moins 48 heures à l’avance. En cas d’empêchement du photographe (maladie, force majeure), la séance est reportée sans frais ou l’acompte est rendu.

4. Livraison des photos
Les photos retouchées sont livrées dans la galerie privée du client, sous un délai de … jours après la séance. Le photographe choisit les images qu’il juge les meilleures.

5. Droits d’auteur et utilisation
Le photographe reste l’auteur des photos. Le client peut les utiliser pour un usage personnel (impression, réseaux sociaux) en citant le photographe lorsque c’est possible. Toute vente ou utilisation commerciale demande l’accord écrit du photographe.

6. Droit à l’image
Le client autorise le photographe à utiliser quelques photos de la séance pour son portfolio et ses réseaux sociaux. Le client peut refuser en le disant au photographe avant la séance.

7. Acceptation
En signant électroniquement ce contrat, les deux parties acceptent ces conditions. Cette signature a la même valeur qu’une signature sur papier.`;

/** Modèle de contrat de MARIAGE (formule du studio) : choisi automatiquement quand la séance est un mariage. */
const WEDDING_TEMPLATE = `CONTRAT DE PRESTATION PHOTOGRAPHIQUE DE MARIAGE

Entre les soussignés :

Le Photographe : {{studio}}
Téléphone : {{studioPhone}}
E-mail : {{studioEmail}}

Et

Le(s) Client(s) : {{client}}
Téléphone : {{clientPhone}}
E-mail : {{clientEmail}}

1. Informations sur le mariage
• Date : {{date}}
• Lieu de la cérémonie : {{ceremony}}
• Lieu de la réception : {{reception}}
• Heure de début : {{start}}
• Heure de fin prévue : {{end}}

2. Objet du contrat
Le présent contrat a pour objet la réalisation d’un reportage photographique de mariage selon la formule choisie par les clients.

3. Prestations
La prestation comprend :
• Couverture photographique du mariage.
• Tri et retouche des meilleures photographies.
• Livraison des photos en haute résolution.
• Remise des photographies via galerie privée, lien de téléchargement ou clé USB selon la formule choisie.

4. Tarifs
• Montant total : {{price}}
• Dépôt (70 %) : {{deposit}}
• Solde (30 %) : {{balance}}

5. Conditions de paiement
• Un dépôt correspondant à 70 % du montant total est exigé pour confirmer la réservation.
• Le solde de 30 % devra être réglé le jour du mariage.
• À défaut, le client dispose d’un délai maximum de 15 jours après la cérémonie pour effectuer le paiement.
• Aucune photographie ne sera livrée avant le paiement intégral de la prestation.

6. Réservation
La date est considérée comme réservée uniquement après :
• la signature du présent contrat ;
• le paiement du dépôt de 70 %.
Sans dépôt, aucune réservation ne sera garantie.

7. Annulation
En cas d’annulation par les clients :
• le dépôt versé reste acquis au photographe ;
• il ne pourra faire l’objet d’aucun remboursement.

8. Report de la prestation
Toute demande de report devra être formulée dans les meilleurs délais.
Le report sera accepté uniquement selon la disponibilité du photographe.

9. Livraison
Les photographies seront livrées dans un délai de {{delivery}} jours après la réception du paiement complet.

10. Droit à l’image
Les clients :
{{imageRights}}

11. Responsabilité
Le photographe ne pourra être tenu responsable :
• des mauvaises conditions météorologiques ;
• des restrictions imposées par les lieux de cérémonie ;
• des retards causés par les clients ou les invités ;
• des cas de force majeure (maladie, catastrophe naturelle, accident, etc.).

12. Modifications
Toute modification concernant les horaires, les lieux ou la durée de la prestation devra être communiquée au moins 7 jours avant le mariage.
Des frais supplémentaires pourront être appliqués selon les changements demandés.

13. Conservation des fichiers
Les photographies seront conservées par le photographe pendant une durée de 6 mois après leur livraison.
Il est recommandé aux clients d’effectuer plusieurs copies de sauvegarde dès réception des fichiers.

14. Acceptation
Par leur signature, les parties déclarent avoir lu, compris et accepté l’ensemble des clauses du présent contrat.

15. Produits inclus
{{products}}

Photos imprimées :
• Nombre de photos imprimées : {{printCount}}
• Format : {{printFormat}}

Observations :
{{notes}}`;
const WEDDING_RE = /mariage|wedding|noce/i;
const WEDDING_ID = '__wedding';
const PRODUCTS = ['Tableau PVC', 'Porte-clé photo', 'Album photo', 'Galerie privée en ligne', 'Téléchargement des photos HD', 'Agrandissement photo'];

/** Remplace les {{…}} (client, studio, session, date, place, price, deposit, et ceux du contrat de mariage) par les valeurs saisies. */
const FALLBACK = { session: '…', date: 'à confirmer', place: 'à confirmer', ceremony: 'à confirmer', reception: 'à confirmer', price: '…', deposit: '…', balance: '…', client: '…', studio: '', delivery: '…', start: '…', end: '…', printCount: '…', printFormat: '…', notes: '…' };
const fillTemplate = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in FALLBACK || k in vars ? (vars[k] || FALLBACK[k] || '…') : all));
/** Inverse : remet les valeurs saisies sous forme de {{…}} pour enregistrer un modèle réutilisable. */
const unfillTemplate = (text, vars) => Object.entries(vars).filter(([, v]) => v && v.length > 1).sort((x, y) => y[1].length - x[1].length)
  .reduce((t, [k, v]) => t.split(v).join(`{{${k}}}`), text);

export const adminContractsPage = () => '<div class="greeting"><h1>Contrats</h1><p>Contrats à signer en ligne : plus de séance sans papier signé.</p></div><div id="ctr-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindAdminContracts({ toast, modal, clients }) {
  const root = document.getElementById('ctr-root');
  if (!root) return;
  let d;
  try { d = await api('/api/admin/contracts'); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
  const reload = async () => { d = await api('/api/admin/contracts'); draw(); };
  const find = (id) => d.contracts.find((c) => c.id === id);
  const pill = (s) => `<span class="badge ${STATUS[s][1]} ctr-status">${s === 'pending' ? `${icon('clock')} ` : s === 'signed' ? `${icon('check')} ` : ''}${STATUS[s][0]}</span>`;

  const card = (c) => {
    const text = `${hello()} ${firstName(c.client.name)}, c’est ${studioName()}. Voici le contrat « ${c.title} » à lire et signer en ligne (1 minute). ${c.client.guest ? `Ouvrez simplement ce lien : ${c.url}` : `Connectez-vous d’abord à votre compte KentraPix : ${c.url}`}`;
    const wa = waLink(c.client.whatsapp, text);
    return `<article class="inv-card ${c.status === 'cancelled' ? 'is-off' : ''}">
      <header><span class="inv-ico">${icon('file')}</span><div><strong>${escape(c.title)}</strong><span>${escape(c.client.name)}${c.client.guest ? ' · sans compte' : ''}${c.bookingDay ? ` · séance du ${escape(fday(c.bookingDay))}` : ''}</span></div>${pill(c.status)}</header>
      <p class="inv-foot">${c.status === 'pending' && !c.staffSigned ? '<span>À signer par vous avant l’envoi</span>' : ''}${c.status === 'signed' && c.reserves ? `<span class="ctr-reserve">Signé avec ${c.reserves} point${c.reserves > 1 ? 's' : ''} non accepté${c.reserves > 1 ? 's' : ''} : ouvrez le contrat</span>` : ''}${c.status === 'signed' ? `<span>Signé par ${escape(c.signedName)} · ${escape(fstamp(c.signedAt))}</span>` : `<span>Créé le ${escape(fstamp(c.createdAt))}</span>${c.sentAt ? '<span>Envoyé par e-mail</span>' : ''}`}</p>
      <div class="actions"><a class="btn sm" href="${escape(local(c.url))}" target="_blank" rel="noopener noreferrer">${icon('eye')} ${c.status === 'signed' ? 'Voir / imprimer' : 'Aperçu'}</a>
        ${c.status === 'pending' && !c.staffSigned ? `<a class="btn sm primary" href="${escape(local(c.url))}" target="_blank" rel="noopener noreferrer">${icon('edit')} Signer le contrat</a>` : ''}
        ${c.status === 'pending' && c.staffSigned ? `<button type="button" class="btn sm primary" data-ctr-send="${c.id}">${icon('send')} Envoyer par e-mail</button>` : ''}
        ${c.status === 'pending' && c.staffSigned && wa ? `<a class="btn sm icon-btn" href="${escape(wa)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" title="Envoyer par WhatsApp">${icon('chat')}</a>` : ''}
        ${c.status === 'pending' ? `<button type="button" class="btn sm" data-ctr-copy="${c.id}">${icon('copy')} Copier le lien</button><button type="button" class="btn sm" data-ctr-edit="${c.id}">Modifier</button><button type="button" class="btn sm" data-ctr-cancel="${c.id}">Annuler</button>` : ''}
        ${c.status !== 'signed' ? `<button type="button" class="btn sm icon-btn danger" data-ctr-del="${c.id}" aria-label="Supprimer" title="Supprimer">${icon('trash')}</button>` : ''}</div>
    </article>`;
  };

  const draw = () => {
    const open = d.contracts.filter((c) => c.status === 'pending');
    const signed = d.contracts.filter((c) => c.status === 'signed');
    const off = d.contracts.filter((c) => c.status === 'cancelled');
    root.innerHTML = `<div class="actions" style="margin:0 0 18px"><button type="button" class="btn primary" id="ctr-new">${icon('plus')} Nouveau contrat</button><button type="button" class="btn" id="ctr-sign">${icon('edit')} Ma signature ${d.mySignature ? '✓' : ''}</button></div>
      ${d.mySignature ? '' : '<p class="small" style="margin:-6px 0 14px">Enregistrez <strong>votre signature</strong> (bouton ci-dessus) : elle sera apposée automatiquement sur chaque contrat. Sinon, vous signez sur la page du contrat.</p>'}
      ${d.unsigned.length ? `<section class="settings bill-block"><h2>${icon('bell')} Séances sans contrat signé</h2><p class="small">Ne commencez pas ces séances avant d’avoir le contrat signé.</p><ul class="rem-list">${d.unsigned.map((u) => `<li class="rem-row is-late"><span class="rem-ico">${icon('bell')}</span><div><strong>${escape(u.clientName)}</strong><span>${escape(fday(u.day))} à ${escape(u.start)}${u.sessionType ? ` · ${escape(u.sessionType)}` : ''}${u.hasPending ? ' · contrat envoyé, pas encore signé' : ''}</span></div><div class="actions"><button type="button" class="btn sm primary" data-ctr-for="${u.bookingId}">Créer le contrat</button></div></li>`).join('')}</ul></section>` : ''}
      <section class="settings bill-block"><h2>À signer</h2>${open.length ? `<div class="inv-grid">${open.map(card).join('')}</div>` : '<div class="empty small"><p>Aucun contrat en attente.</p></div>'}</section>
      <section class="settings bill-block"><h2>Signés</h2>${signed.length ? `<div class="inv-grid">${signed.map(card).join('')}</div>` : '<div class="empty small"><p>Aucun contrat signé pour le moment.</p></div>'}</section>
      ${off.length ? `<details class="acc"><summary><span>Contrats annulés</span><small>${off.length}</small></summary><div class="acc-body inv-grid">${off.map(card).join('')}</div></details>` : ''}`;
    wire();
  };

  function wire() {
    root.querySelector('#ctr-new').onclick = () => formModal();
    root.querySelector('#ctr-sign').onclick = () => signatureModal();
    root.querySelectorAll('[data-ctr-for]').forEach((b) => { b.onclick = () => formModal({ bookingId: b.dataset.ctrFor }); });
    root.querySelectorAll('[data-ctr-edit]').forEach((b) => { b.onclick = () => formModal({ contract: find(b.dataset.ctrEdit) }); });
    root.querySelectorAll('[data-ctr-send]').forEach((b) => { b.onclick = guard(async () => {
      const c = find(b.dataset.ctrSend);
      if (!confirm(`Envoyer le contrat « ${c.title} » à ${c.client.name} (${c.client.email}) ?`)) return;
      b.disabled = true; const r = await api(`/api/admin/contracts/${c.id}/send`, { method: 'POST' });
      toast(r.email.status === 'sent' ? 'Contrat envoyé par e-mail.' : r.email.status === 'skipped' ? 'E-mail non envoyé : l’envoi d’e-mails n’est pas actif. Copiez le lien ou utilisez WhatsApp.' : `E-mail non envoyé : ${r.email.error || 'erreur'}`);
      await reload();
    }); });
    root.querySelectorAll('[data-ctr-copy]').forEach((b) => { b.onclick = guard(async () => { await navigator.clipboard.writeText(find(b.dataset.ctrCopy).url); toast('Lien copié.'); }); });
    root.querySelectorAll('[data-ctr-cancel]').forEach((b) => { b.onclick = guard(async () => {
      if (!confirm('Annuler ce contrat ? Le lien ne fonctionnera plus.')) return;
      await api(`/api/admin/contracts/${b.dataset.ctrCancel}`, { method: 'PATCH', body: { cancelled: true } }); await reload();
    }); });
    root.querySelectorAll('[data-ctr-del]').forEach((b) => { b.onclick = guard(async () => {
      if (!confirm('Supprimer définitivement ce contrat ?')) return;
      await api(`/api/admin/contracts/${b.dataset.ctrDel}`, { method: 'DELETE' }); await reload();
    }); });
  }

  // Le photographe dessine sa signature une fois ; elle est ensuite apposée sur chacun de ses contrats.
  function signatureModal(then) {
    openSignatureModal({ modal, toast, current: d.mySignature, onSaved: (sig) => { d.mySignature = sig; draw(); if (then) setTimeout(then, 150); } });
  }

  function formModal({ bookingId = '', contract = null } = {}) {
    const list = clients();
    const booking = d.unsigned.find((u) => u.bookingId === bookingId);
    const pre = contract ? contract.client.id : booking?.clientId || list[0]?.id || '';
    modal(contract ? 'Modifier le contrat' : 'Nouveau contrat', `
      ${contract ? '' : `<label>Client<select name="clientId" id="ctr-client">${list.map((c) => `<option value="${c.id}" ${c.id === pre ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}<option value="" ${pre ? '' : 'selected'}>Autre personne (pas encore dans le système)</option></select></label>
      <div id="ctr-guest" hidden><label>Nom de la personne<input id="ctr-gname" maxlength="80" placeholder="Ex. Marie Joseph"></label><div class="row2"><label>Téléphone / WhatsApp<input id="ctr-gphone" type="tel" maxlength="40"></label><label>E-mail <span class="optional">(facultatif)</span><input id="ctr-gemail" type="email" maxlength="190"></label></div><p class="small">Elle recevra le contrat par WhatsApp ou par e-mail et le signera depuis le lien, sans créer de compte.</p></div>`}
      ${contract ? '' : `<div class="row2"><label>Séance <span class="optional">(facultatif)</span><input name="session" id="ctr-session" maxlength="120" placeholder="Ex. Mariage, portrait" value="${escape(booking?.sessionType || '')}"></label>
      <label>Date <span class="optional">(facultatif)</span><input name="date" id="ctr-date" maxlength="60" placeholder="Ex. 12 décembre 2026" value="${escape(booking ? fday(booking.day) : '')}"></label></div>
      <div class="row2"><label>Lieu <span class="optional">(facultatif)</span><input name="place" id="ctr-place" maxlength="120"></label>
      <label>Prix total <span class="optional">(facultatif)</span><input name="price" id="ctr-price" maxlength="40" placeholder="Ex. 500 USD"></label></div>
      <label>Acompte <span class="optional">(facultatif)</span><input name="deposit" id="ctr-deposit" maxlength="40" placeholder="Ex. 200 USD"></label>
      <div id="ctr-wedding" hidden>
        <p class="small" style="margin:6px 0 10px"><strong>Mariage</strong> : ces informations remplissent le contrat de mariage. Pour un mariage, l’acompte est de 70 % et le solde de 30 % (calculés si vous indiquez le prix).</p>
        <div class="row2"><label>Lieu de la cérémonie<input id="ctr-ceremony" maxlength="120"></label><label>Lieu de la réception<input id="ctr-reception" maxlength="120"></label></div>
        <div class="row2"><label>Heure de début<input id="ctr-start" type="time"></label><label>Heure de fin prévue<input id="ctr-end" type="time"></label></div>
        <label>Livraison des photos (jours après le paiement complet)<input id="ctr-delivery" type="number" min="1" max="365" placeholder="Ex. 30"></label>
        <fieldset class="ctr-products"><legend>Produits inclus</legend>${PRODUCTS.map((p, i) => `<label class="ctr-check"><input type="checkbox" class="ctr-prod" value="${escape(p)}" ${i === 3 || i === 4 ? 'checked' : ''}> ${escape(p)}</label>`).join('')}
          <label>Autres <span class="optional">(facultatif)</span><input id="ctr-prod-other" maxlength="120"></label></fieldset>
        <div class="row2"><label>Nombre de photos imprimées<input id="ctr-printcount" maxlength="30"></label><label>Format<input id="ctr-printformat" maxlength="60" placeholder="Ex. 20×30 cm"></label></div>
        <label>Droit à l’image<select id="ctr-rights"><option value="">À cocher plus tard (cases vides)</option><option value="allow">Les clients autorisent l’utilisation des photos</option><option value="refuse">Les clients refusent toute utilisation</option></select></label>
        <label>Observations <span class="optional">(facultatif)</span><input id="ctr-notes" maxlength="300"></label>
      </div>`}
      ${contract ? '' : `<label>Modèle de contrat<select id="ctr-tpl"><option value="">Modèle KentraPix (séance photo)</option><option value="${WEDDING_ID}">Modèle mariage KentraPix</option>${d.templates.map((t) => `<option value="${t.id}">${escape(t.name)}</option>`).join('')}</select></label>`}
      <label>Titre<input name="title" id="ctr-title" required maxlength="200" value="${escape(contract?.title || '')}" placeholder="Ex. Contrat — Séance photo mariage"></label>
      <label>Texte du contrat <span class="optional">(relisez et adaptez)</span><textarea name="body" id="ctr-body" rows="14" required maxlength="20000" style="font:14px/1.5 Inter,sans-serif">${escape(contract?.body || '')}</textarea></label>
      ${contract ? '' : `<div class="actions" style="justify-content:flex-start"><button type="button" class="btn sm" id="ctr-tpl-save">Enregistrer comme modèle</button><button type="button" class="btn sm danger" id="ctr-tpl-del" hidden>Supprimer ce modèle</button></div>`}`,
    async (v) => {
      if (contract) {
        await api(`/api/admin/contracts/${contract.id}`, { method: 'PATCH', body: { title: v.title, body: v.body } });
        toast('Contrat modifié.');
      } else {
        const who = v.clientId ? { clientId: v.clientId, bookingId: booking?.clientId === v.clientId ? bookingId : '' } : { guest: { name: (v.gname || '').trim(), phone: (v.gphone || '').trim(), email: (v.gemail || '').trim() } };
        if (!v.clientId && (v.gname || '').trim().length < 2) throw Error('Entrez le nom de la personne.');
        await api('/api/admin/contracts', { method: 'POST', body: { ...who, title: v.title, body: v.body } });
        toast('Contrat créé : ouvrez-le pour le signer, puis envoyez-le au client.');
      }
      await reload();
    }, { submit: contract ? 'Enregistrer' : 'Créer le contrat' });

    if (contract) return;
    const host = document.getElementById('overlays');
    const el = (id) => host.querySelector(id);
    let touched = false;
    el('#ctr-body').addEventListener('input', () => { touched = true; });
    const refill = () => {
      if (!el('#ctr-title').dataset.edited) el('#ctr-title').value = `Contrat — ${el('#ctr-session').value || 'Séance photo'} — ${vars().client}`;
      if (touched && !confirm('Remplacer le texte que vous avez modifié par le modèle mis à jour ?')) return;
      el('#ctr-body').value = fillTemplate(currentTemplate(), vars());
      touched = false;
    };
    // Mariage : 70 % d'acompte et 30 % de solde, calculés à partir du prix (« 500 USD »).
    const money = (s) => { const m = String(s).replace(/\s/g, '').match(/^(\d+(?:[.,]\d+)?)(.*)$/); return m ? { n: Number(m[1].replace(',', '.')), cur: m[2].trim() } : null; };
    const fmt = (n, cur) => `${(Math.round(n * 100) / 100).toLocaleString('fr-FR')}${cur ? ` ${cur}` : ''}`;
    const wedding = () => el('#ctr-tpl').value === WEDDING_ID;
    const split = () => {
      const p = money(el('#ctr-price').value); if (!p) return { deposit: el('#ctr-deposit').value.trim(), balance: '' };
      const typed = money(el('#ctr-deposit').value);
      const dep = typed && el('#ctr-deposit').dataset.edited ? typed.n : p.n * 0.7;
      return { deposit: fmt(dep, p.cur), balance: fmt(Math.max(0, p.n - dep), p.cur) };
    };
    const productsText = () => [...PRODUCTS.map((p) => [p, [...host.querySelectorAll('.ctr-prod')].some((c) => c.checked && c.value === p)]), ...(el('#ctr-prod-other').value.trim() ? [[`Autres : ${el('#ctr-prod-other').value.trim()}`, true]] : [['Autres : …', false]])].map(([p, on]) => `${on ? '☑' : '☐'} ${p}`).join('\n');
    const rightsText = () => { const r = el('#ctr-rights').value; return `${r === 'allow' ? '☑' : '☐'} Autorisent le photographe à utiliser certaines photographies à des fins de communication (portfolio, réseaux sociaux, site internet).\n${r === 'refuse' ? '☑' : '☐'} Refusent toute utilisation de leurs photographies.`; };
    const vars = () => {
      const found = list.find((x) => x.id === el('#ctr-client').value); const u = auth.session() || {};
      const c = found || { name: el('#ctr-gname').value.trim(), phone: el('#ctr-gphone').value.trim(), email: el('#ctr-gemail').value.trim() };
      const sp = wedding() ? split() : { deposit: el('#ctr-deposit').value.trim(), balance: '' };
      return {
        client: c?.name || '', clientPhone: c?.phone || c?.whatsapp || '…', clientEmail: c?.email || '…', studio: studioName(), studioPhone: u.phone || u.whatsapp || '…', studioEmail: u.email || '…',
        session: el('#ctr-session').value.trim(), date: el('#ctr-date').value.trim(), place: el('#ctr-place').value.trim(), price: el('#ctr-price').value.trim(), deposit: sp.deposit, balance: sp.balance,
        ceremony: el('#ctr-ceremony').value.trim() || el('#ctr-place').value.trim(), reception: el('#ctr-reception').value.trim(), start: el('#ctr-start').value, end: el('#ctr-end').value, delivery: el('#ctr-delivery').value,
        printCount: el('#ctr-printcount').value.trim(), printFormat: el('#ctr-printformat').value.trim(), notes: el('#ctr-notes').value.trim(), products: productsText(), imageRights: rightsText(),
      };
    };
    const saved = () => d.templates.find((t) => t.id === el('#ctr-tpl').value);
    const currentTemplate = () => (wedding() ? WEDDING_TEMPLATE : saved()?.body || DEFAULT_TEMPLATE);
    const syncWedding = () => { el('#ctr-wedding').hidden = !wedding(); };
    let tplPicked = false;
    // Séance de mariage : le modèle mariage se choisit tout seul (sauf si vous avez choisi un autre modèle vous-même).
    const autoTemplate = () => {
      if (tplPicked) return;
      const want = WEDDING_RE.test(el('#ctr-session').value) ? WEDDING_ID : '';
      if (el('#ctr-tpl').value !== want && ['', WEDDING_ID].includes(el('#ctr-tpl').value)) el('#ctr-tpl').value = want;
      syncWedding();
    };
    const syncDel = () => { el('#ctr-tpl-del').hidden = !saved(); };
    el('#ctr-tpl').addEventListener('change', () => { tplPicked = true; syncDel(); syncWedding(); refill(); });
    el('#ctr-tpl-save').onclick = guard(async () => {
      const cur = saved();
      const name = prompt(cur ? 'Nom du modèle (gardez-le pour mettre à jour ce modèle) :' : 'Nom du nouveau modèle (ex. Mariage, Portrait, Bébé) :', cur?.name || '');
      if (!name?.trim()) return;
      const body = unfillTemplate(el('#ctr-body').value, vars());
      const same = cur && cur.name === name.trim();
      const res = await api(same ? `/api/admin/contracts/templates/${cur.id}` : '/api/admin/contracts/templates', { method: same ? 'PUT' : 'POST', body: { name: name.trim(), body } });
      if (same) cur.body = body; else { d.templates.push(res.template); d.templates.sort((x, y) => x.name.localeCompare(y.name)); }
      el('#ctr-tpl').innerHTML = `<option value="">Modèle KentraPix (séance photo)</option><option value="${WEDDING_ID}">Modèle mariage KentraPix</option>${d.templates.map((t) => `<option value="${t.id}">${escape(t.name)}</option>`).join('')}`;
      el('#ctr-tpl').value = res.template.id; syncDel(); touched = false;
      toast('Modèle enregistré.');
    });
    el('#ctr-tpl-del').onclick = guard(async () => {
      const cur = saved();
      if (!cur || !confirm(`Supprimer le modèle « ${cur.name} » ?`)) return;
      await api(`/api/admin/contracts/templates/${cur.id}`, { method: 'DELETE' });
      d.templates = d.templates.filter((t) => t.id !== cur.id);
      el('#ctr-tpl').querySelector(`option[value="${cur.id}"]`)?.remove(); el('#ctr-tpl').value = ''; syncDel(); refill();
    });
    el('#ctr-title').addEventListener('input', () => { el('#ctr-title').dataset.edited = '1'; });
    el('#ctr-deposit').addEventListener('input', () => { el('#ctr-deposit').dataset.edited = '1'; });
    const syncGuest = () => { el('#ctr-guest').hidden = !!el('#ctr-client').value; };
    el('#ctr-client').addEventListener('change', syncGuest); syncGuest();
    ['#ctr-gname', '#ctr-gphone', '#ctr-gemail', '#ctr-client', '#ctr-session', '#ctr-date', '#ctr-place', '#ctr-price', '#ctr-deposit', '#ctr-ceremony', '#ctr-reception', '#ctr-start', '#ctr-end', '#ctr-delivery', '#ctr-prod-other', '#ctr-printcount', '#ctr-printformat', '#ctr-rights', '#ctr-notes'].forEach((id) => el(id).addEventListener('change', () => { if (id === '#ctr-session') autoTemplate(); refill(); }));
    host.querySelectorAll('.ctr-prod').forEach((c) => c.addEventListener('change', refill));
    autoTemplate();
    refill();
  }

  draw();
}

// ====================================================================================================
//  Espace client : ses contrats (à signer, puis signés)
// ====================================================================================================
export const clientContractsPage = () => '<div class="greeting"><h1>Mes contrats</h1><p>Lisez et signez vos contrats en ligne.</p></div><div id="ctrC-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindClientContracts() {
  const root = document.getElementById('ctrC-root');
  if (!root) return;
  let list;
  try { list = (await api('/api/client/contracts')).contracts; } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }
  if (!list.length) { root.innerHTML = '<div class="empty"><h2>Aucun contrat pour le moment</h2><p>Quand votre photographe vous envoie un contrat, il apparaît ici.</p></div>'; return; }
  const card = (c) => `<article class="inv-card ${c.status === 'pending' ? 'is-late' : ''}">
    <header><span class="inv-ico">${icon('file')}</span><div><strong>${escape(c.title)}</strong><span>${escape(c.studio)}${c.bookingDay ? ` · séance du ${escape(fday(c.bookingDay))}` : ''}</span></div><span class="badge ${STATUS[c.status][1]}">${c.status === 'pending' ? 'À signer' : STATUS[c.status][0]}</span></header>
    <p class="inv-foot"><span>${c.status === 'signed' ? `Signé le ${escape(fstamp(c.signedAt))}` : `Reçu le ${escape(fstamp(c.createdAt))}`}</span></p>
    <div class="actions"><a class="btn sm ${c.status === 'pending' ? 'primary' : ''}" href="${escape(local(c.url))}" target="_blank" rel="noopener noreferrer">${icon('edit')} ${c.status === 'pending' ? 'Lire et signer' : 'Voir / imprimer'}</a></div>
  </article>`;
  const todo = list.filter((c) => c.status === 'pending'), done = list.filter((c) => c.status === 'signed');
  root.innerHTML = `${todo.length ? `<section class="settings bill-block"><h2>À signer</h2><div class="inv-grid">${todo.map(card).join('')}</div></section>` : ''}
    ${done.length ? `<section class="settings bill-block"><h2>Signés</h2><div class="inv-grid">${done.map(card).join('')}</div></section>` : ''}`;
}
