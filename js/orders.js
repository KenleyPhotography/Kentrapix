// Albums et tirages : le photographe publie un catalogue ; le client choisit un produit et ses photos, puis envoie sa commande.
import { api, escape, service, hello } from './service.js';
import { icon } from './icons.js';
import { waLink, firstName, siteUrl } from './whatsapp.js';

const STATUS = { new: 'Nouvelle', accepted: 'Acceptée', production: 'En préparation', ready: 'Prête', delivered: 'Remise', cancelled: 'Annulée' };
const money = (n, cur) => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${cur}`;
const when = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const pill = (s) => `<span class="bk-pill ord-${s}">${STATUS[s] || s}</span>`;
const range = (p) => (p.minPhotos === p.maxPhotos ? `${p.minPhotos} photo${p.minPhotos > 1 ? 's' : ''}` : `${p.minPhotos} à ${p.maxPhotos} photos`);

// ====================================================================================================
//  Espace client
// ====================================================================================================
export const clientOrdersPage = () => '<div class="greeting"><h1>Commandes</h1></div><div id="ord-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindClientOrders({ toast, modal }) {
  const root = document.getElementById('ord-root');
  if (!root) return;
  let data;
  const refresh = async () => { data = await api('/api/client/orders'); draw(); };
  try { data = await api('/api/client/orders'); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }

  const draw = () => {
    const shops = data.photographers.filter((p) => p.products.length);
    const catalogue = shops.length
      ? shops.map((s) => `<section class="settings bill-block"><h2>${escape(s.name)}</h2><div class="ord-cards">${s.products.map((p) => `<article class="ord-card ${p.cover ? '' : 'no-cover'}">${p.cover ? `<img src="${escape(p.cover)}" alt="" loading="lazy">` : `<span class="ord-card-ico">${icon('albums')}</span>`}<span class="ord-card-tag">${escape(money(p.price, p.currency))}</span><div class="ord-card-body"><h3>${escape(p.name)}</h3>${p.description ? `<p>${escape(p.description)}</p>` : ''}<p class="ord-card-meta">${icon('photos')} ${escape(range(p))}</p><button type="button" class="btn primary" data-ord-new="${s.id}:${p.id}">Commander</button></div></article>`).join('')}</div></section>`).join('')
      : `<div class="empty">${icon('albums')}<h2>Aucun album ni tirage proposé</h2><p class="small">Votre photographe n’a pas encore publié de catalogue. Revenez bientôt ou écrivez-lui directement.</p></div>`;
    const mine = data.orders.length
      ? `<section class="settings bill-block"><h2>Mes commandes</h2><ul class="rem-list">${data.orders.map((o) => `<li class="rem-row">${o.cover ? `<img class="ord-cover" src="${escape(o.cover.url)}" alt="">` : `<span class="rem-ico">${icon('albums')}</span>`}<div><strong>${escape(o.product)} × ${o.quantity}</strong><span>${escape(when(o.createdAt))} · ${o.photos.length} photo${o.photos.length > 1 ? 's' : ''} · ${escape(money(o.total, o.currency))} · ${escape(o.staff.name)}${o.reply ? ` · « ${escape(o.reply)} »` : ''}</span></div><div class="actions">${pill(o.status)}${o.status === 'new' ? `<button type="button" class="btn sm" data-ord-cancel="${o.id}">Annuler</button>` : ''}</div></li>`).join('')}</ul></section>`
      : '';
    root.innerHTML = `${mine}${catalogue}`;
    root.querySelectorAll('[data-ord-cancel]').forEach((b) => { b.onclick = async () => {
      if (!confirm('Annuler cette commande ?')) return;
      try { await api(`/api/client/orders/${b.dataset.ordCancel}`, { method: 'DELETE' }); toast('Commande annulée.'); await refresh(); } catch (e) { toast(e.message); }
    }; });
    root.querySelectorAll('[data-ord-new]').forEach((b) => { b.onclick = () => {
      const [staffId, productId] = b.dataset.ordNew.split(':');
      const shop = data.photographers.find((p) => p.id === staffId); const product = shop.products.find((p) => p.id === productId);
      orderModal(shop, product);
    }; });
  };

  function orderModal(shop, product) {
    // Photos de CE photographe, ouvertes au client (pas les verrouillées).
    const events = service.data.events.filter((e) => e.photographerId === shop.id);
    const photos = service.data.photos.filter((p) => !p.locked && events.some((e) => e.id === p.eventId));
    if (!photos.length) return toast('Vous n’avez pas encore de photos chez ce photographe.');
    const picked = new Set();
    const evName = (id) => events.find((e) => e.id === id)?.name || '';
    modal(product.name, `<p class="small">${escape(money(product.price, product.currency))} · ${escape(range(product))}</p>
      <input type="hidden" name="photoIds" value="">
      ${events.length > 1 ? `<label>Galerie<select id="ord-ev"><option value="">Toutes</option>${events.map((e) => `<option value="${e.id}">${escape(e.name)}</option>`).join('')}</select></label>` : ''}
      <div class="ord-count" id="ord-count"></div>
      <div class="ord-grid" id="ord-grid"></div>
      <div class="row2"><label>Quantité<input name="quantity" type="number" min="1" max="50" value="1" required></label>
      <label>Remise<select name="delivery"><option value="pickup">Retrait chez le photographe</option><option value="delivery">Livraison</option></select></label></div>
      <label id="ord-addr" hidden>Adresse de livraison<input name="address" maxlength="300"></label>
      <label>Message <span class="optional">(facultatif)</span><input name="note" maxlength="600" placeholder="Papier, couleur de couverture…"></label>`,
    async (v) => {
      if (picked.size < product.minPhotos) throw Error(`Choisissez au moins ${product.minPhotos} photo(s).`);
      const r = await api('/api/client/orders', { method: 'POST', body: { staffId: shop.id, productId: product.id, quantity: Number(v.quantity), photoIds: [...picked], delivery: v.delivery, address: v.address || '', note: v.note || '' } });
      toast(`Commande envoyée : ${money(r.order.total, r.order.currency)}. Votre photographe va vous répondre.`);
      await refresh();
    }, { submit: 'Envoyer la commande' });
    const host = document.getElementById('overlays');
    const grid = host.querySelector('#ord-grid'); const count = host.querySelector('#ord-count');
    const hid = host.querySelector('input[name=photoIds]');
    const paint = () => {
      const ev = host.querySelector('#ord-ev')?.value || '';
      grid.innerHTML = photos.filter((p) => !ev || p.eventId === ev).map((p) => `<button type="button" class="ord-photo ${picked.has(p.id) ? 'is-on' : ''}" data-p="${p.id}" aria-pressed="${picked.has(p.id)}" title="${escape(evName(p.eventId))}"><img src="${escape(p.thumb || p.preview)}" alt="" loading="lazy"><span>N° ${p.number}</span><i>${icon('check')}</i></button>`).join('');
      count.textContent = `${picked.size} photo${picked.size > 1 ? 's' : ''} choisie${picked.size > 1 ? 's' : ''} · ${range(product)}`;
      count.classList.toggle('is-bad', picked.size > product.maxPhotos);
      hid.value = [...picked].join(',');
      grid.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.p;
        if (picked.has(id)) picked.delete(id); else if (picked.size >= product.maxPhotos) return toast(`Maximum ${product.maxPhotos} photo(s) pour ce produit.`); else picked.add(id);
        paint();
      }));
    };
    host.querySelector('#ord-ev')?.addEventListener('change', paint);
    host.querySelector('select[name=delivery]').addEventListener('change', (e) => { host.querySelector('#ord-addr').hidden = e.target.value !== 'delivery'; });
    paint();
  }
  draw();
}

// ====================================================================================================
//  Studio
// ====================================================================================================
export const adminOrdersPage = () => '<div class="greeting"><h1>Commandes</h1></div><div id="ordA-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindAdminOrders({ toast, modal, navigate, clients }) {
  const root = document.getElementById('ordA-root');
  if (!root) return;
  let d;
  try { d = await api('/api/admin/orders'); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
  const reload = async () => { d = await api('/api/admin/orders'); draw(); };
  const NEXT = { new: [['accepted', 'Accepter', 'primary']], accepted: [['production', 'En préparation']], production: [['ready', 'Prête']], ready: [['delivered', 'Remise']], delivered: [], cancelled: [] };

  const orderCard = (o) => {
    const nums = o.photos.map((p) => p.number).sort((a, b) => a - b).join(', ');
    const say = { new: 'Merci pour votre commande', accepted: 'Votre commande est acceptée', production: 'Votre commande est en préparation', ready: o.delivery === 'delivery' ? 'Votre commande est prête, elle va vous être livrée' : 'Votre commande est prête, vous pouvez venir la récupérer', delivered: 'Votre commande a été remise, merci !', cancelled: 'Votre commande a été annulée' }[o.status];
    const link = waLink(o.client.whatsapp, `${hello()} ${firstName(o.client.name)}, ${say} : « ${o.product} ». ${siteUrl('/client')}`);
    return `<article class="inv-card ${o.status === 'new' ? 'is-late' : ''} ${o.status === 'cancelled' ? 'is-off' : ''}">
      <header>${o.cover ? `<img class="ord-cover" src="${escape(o.cover.url)}" alt="">` : `<span class="inv-ico">${icon('albums')}</span>`}<div><strong>${escape(o.product)} × ${o.quantity}</strong><span>${escape(o.client.name)} · ${escape(when(o.createdAt))}${o.source === 'studio' ? ' · créée par vous' : ''}</span></div>${pill(o.status)}</header>
      <dl class="inv-amounts"><div><dt>Total</dt><dd>${escape(money(o.total, o.currency))}</dd></div><div><dt>Photos</dt><dd>${o.photos.length}</dd></div><div><dt>Remise</dt><dd>${o.delivery === 'delivery' ? 'Livraison' : 'Retrait'}</dd></div></dl>
      ${o.address ? `<p class="inv-client">${escape(o.address)}</p>` : ''}${o.note ? `<p class="small">« ${escape(o.note)} »</p>` : ''}
      <details class="acc"><summary><span>Photos commandées</span><small>N° ${escape(nums)}</small></summary><div class="acc-body"><div class="sel-thumbs">${o.photos.map((p) => `<figure>${p.thumb ? `<img src="${escape(p.thumb)}" alt="" loading="lazy">` : ''}<figcaption>N° ${p.number}<br><small>${escape(p.filename)}</small></figcaption></figure>`).join('')}</div></div></details>
      <div class="actions">${(NEXT[o.status] || []).map(([s, l, c]) => `<button type="button" class="btn sm ${c || ''}" data-orda-status="${o.id}:${s}">${l}</button>`).join('')}
        ${!['delivered', 'cancelled'].includes(o.status) ? `<button type="button" class="btn sm" data-orda-status="${o.id}:cancelled">Annuler</button>` : ''}
        <button type="button" class="btn sm" data-copy="${escape(nums)}">${icon('copy')} N°</button>
        <button type="button" class="btn sm" data-copy="${escape(o.photos.map((p) => p.filename).join(', '))}">${icon('copy')} Fichiers</button>
        <button type="button" class="btn sm primary" data-orda-album="${o.id}">Composer l’album</button>
        <button type="button" class="btn sm" data-orda-invoice="${o.id}">Facturer</button>
        ${link ? `<a class="btn sm icon-btn" href="${escape(link)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" title="WhatsApp">${icon('chat')}</a>` : ''}</div>
    </article>`;
  };

  const productRow = (p) => `<li class="rem-row ${p.active ? '' : 'is-done'}">${p.cover ? `<img class="ord-thumb" src="${escape(p.cover)}" alt="">` : `<span class="rem-ico">${icon('albums')}</span>`}<div><strong>${escape(p.name)}</strong><span>${escape(money(p.price, p.currency))} · ${escape(range(p))}${p.active ? '' : ' · masqué'}</span></div><div class="actions"><button type="button" class="btn sm" data-orda-edit="${p.id}">Modifier</button><button type="button" class="btn sm icon-btn danger" data-orda-del="${p.id}" aria-label="Supprimer" title="Supprimer">${icon('trash')}</button></div></li>`;

  const draw = () => {
    const open = d.orders.filter((o) => !['delivered', 'cancelled'].includes(o.status));
    const done = d.orders.filter((o) => ['delivered', 'cancelled'].includes(o.status));
    root.innerHTML = `<section class="settings bill-block"><div class="row between"><h2>Catalogue</h2><button type="button" class="btn sm primary" id="ordA-add">${icon('plus')} Ajouter un produit</button></div>
      ${d.products.length ? `<ul class="rem-list">${d.products.map(productRow).join('')}</ul>` : '<div class="empty small"><p>Ajoutez vos albums et tirages (ex. Album 30×30, Tirage 20×30) : vos clients pourront les commander.</p></div>'}</section>
      <section class="settings bill-block"><div class="row between"><h2>Commandes à traiter <span class="count-pill">${open.length}</span></h2><button type="button" class="btn sm primary" id="orda-new">${icon('plus')} Nouvelle commande</button></div>${open.length ? `<div class="inv-list">${open.map(orderCard).join('')}</div>` : '<div class="empty small"><p>Aucune commande en cours.</p></div>'}</section>
      ${done.length ? `<details class="acc"><summary><span>Commandes terminées</span><small>${done.length}</small></summary><div class="acc-body inv-list">${done.map(orderCard).join('')}</div></details>` : ''}`;
    root.querySelector('#ordA-add').onclick = () => productModal();
    root.querySelector('#orda-new').onclick = () => newOrderModal();
    root.querySelectorAll('[data-orda-album]').forEach((b) => { b.onclick = () => albumModal(b.getAttribute('data-orda-album')); });
    root.querySelectorAll('[data-orda-edit]').forEach((b) => { b.onclick = () => productModal(d.products.find((p) => p.id === b.getAttribute('data-orda-edit'))); });
    root.querySelectorAll('[data-orda-del]').forEach((b) => { b.onclick = guard(async () => {
      if (!confirm('Supprimer ce produit ? Les commandes déjà reçues restent visibles.')) return;
      await api(`/api/admin/orders/products/${b.getAttribute('data-orda-del')}`, { method: 'DELETE' }); await reload();
    }); });
    root.querySelectorAll('[data-orda-status]').forEach((b) => { b.onclick = guard(async () => {
      const [id, status] = b.getAttribute('data-orda-status').split(':');
      let reply = '';
      if (status === 'cancelled') { reply = prompt('Message pour le client (facultatif) :', '') ?? null; if (reply === null) return; }
      b.disabled = true; await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: { status, reply } }); toast('Commande mise à jour : le client est prévenu.'); await reload();
    }); });
    root.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copié.'); } catch { toast('Copie impossible.'); } }; });
    root.querySelectorAll('[data-orda-invoice]').forEach((b) => { b.onclick = guard(async () => {
      const o = d.orders.find((x) => x.id === b.getAttribute('data-orda-invoice'));
      if (!confirm(`Créer une facture de ${money(o.total, o.currency)} pour ${o.client.name} ?`)) return;
      const r = await api('/api/admin/invoices', { method: 'POST', body: { clientId: o.client.id, eventId: '', title: `${o.product} × ${o.quantity}`, amount: o.total, currency: o.currency, dueDate: '', notes: '', paymentType: 'credit', advance: '', advanceMethod: 'especes' } });
      toast(`Facture ${r.invoice.number} créée.`); navigate('Billing');
    }); });
  };

  // ----- Composer l'album : page de couverture + photos (choisies par le photographe) -----
  async function albumModal(orderId) {
    const order = d.orders.find((x) => x.id === orderId);
    let lib;
    try { lib = (await api(`/api/admin/orders/${orderId}/library`)).photos; } catch (e) { return toast(e.message); }
    if (!lib.length) return toast('Ce client n’a encore aucune galerie faite par vous : créez d’abord une galerie pour lui.');
    const byId = new Map(lib.map((p) => [p.id, p]));
    const picked = order.photos.map((p) => p.id).filter((id) => byId.has(id));
    let cover = order.cover?.photoId || null; let coverTouched = false; let custom = order.cover?.custom ? order.cover.url : null;
    const events = [...new Set(lib.map((p) => p.event))];
    modal(`Album — ${order.client.name}`, `
      <h3 class="bill-sub">Page de couverture</h3>
      <div class="alb-cover" id="alb-cover"></div>
      <div class="row"><label class="btn sm">Envoyer une image<input type="file" id="alb-file" accept="image/*" hidden></label><button type="button" class="btn sm" id="alb-clear">Retirer la couverture</button></div>
      <p class="small">Ou touchez l’étoile sur une photo choisie ci-dessous pour en faire la couverture.</p>
      <h3 class="bill-sub">Photos de l’album <span class="count-pill" id="alb-count"></span></h3>
      ${events.length > 1 ? `<label>Galerie<select id="alb-ev"><option value="">Toutes</option>${events.map((e) => `<option>${escape(e)}</option>`).join('')}</select></label>` : ''}
      <div class="ord-grid" id="alb-grid"></div>`,
    async () => {
      await api(`/api/admin/orders/${orderId}/photos`, { method: 'PUT', body: { photoIds: picked } });
      if (coverTouched) await api(`/api/admin/orders/${orderId}/cover`, { method: 'PUT', body: { photoId: cover && picked.includes(cover) ? cover : null } });
      toast('Album enregistré.'); await reload();
    }, { submit: 'Enregistrer l’album' });
    const host = document.getElementById('overlays');
    const grid = host.querySelector('#alb-grid'); const count = host.querySelector('#alb-count'); const box = host.querySelector('#alb-cover');
    const paintCover = () => {
      const src = custom || (cover && byId.get(cover)?.thumb);
      box.innerHTML = src ? `<img src="${escape(src)}" alt="Couverture">` : '<span>Aucune couverture</span>';
    };
    const paint = () => {
      const ev = host.querySelector('#alb-ev')?.value || '';
      grid.innerHTML = lib.filter((p) => !ev || p.event === ev).map((p) => {
        const on = picked.includes(p.id);
        return `<div class="ord-photo ${on ? 'is-on' : ''} ${cover === p.id && !custom ? 'is-cover' : ''}" data-p="${p.id}" role="button" tabindex="0" aria-pressed="${on}" title="${escape(p.event)}"><img src="${escape(p.thumb)}" alt="" loading="lazy"><span>${on ? `${picked.indexOf(p.id) + 1} · ` : ''}N° ${p.number}</span><i>${icon('check')}</i>${on ? `<button type="button" class="alb-star" data-star="${p.id}" aria-label="Choisir comme couverture">${icon('star')}</button>` : ''}</div>`;
      }).join('');
      count.textContent = picked.length;
      grid.querySelectorAll('[data-p]').forEach((el) => el.addEventListener('click', (e) => {
        const id = el.dataset.p;
        if (e.target.closest('[data-star]')) { cover = id; coverTouched = true; custom = null; paintCover(); paint(); return; }
        const i = picked.indexOf(id); if (i >= 0) picked.splice(i, 1); else picked.push(id);
        if (cover === id && i >= 0) { cover = null; coverTouched = true; }
        paint();
      }));
    };
    host.querySelector('#alb-ev')?.addEventListener('change', paint);
    host.querySelector('#alb-file').addEventListener('change', guard(async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('cover', f);
      const r = await api(`/api/admin/orders/${orderId}/cover`, { method: 'POST', form: fd });
      custom = r.order.cover?.url || null; cover = null; coverTouched = false; toast('Couverture envoyée.'); paintCover(); paint();
    }));
    host.querySelector('#alb-clear').addEventListener('click', guard(async () => {
      await api(`/api/admin/orders/${orderId}/cover`, { method: 'DELETE' }); custom = null; cover = null; coverTouched = false; toast('Couverture retirée.'); paintCover(); paint();
    }));
    paintCover(); paint();
  }

  // ----- Le photographe crée lui-même la commande d'un client, puis compose l'album -----
  function newOrderModal() {
    const list = clients();
    if (!list.length) return toast('Ajoutez d’abord un client.');
    modal('Nouvelle commande', `<label>Client<select name="clientId">${list.map((c) => `<option value="${c.id}">${escape(c.name)}</option>`).join('')}</select></label>
      <label>Produit<select name="productId" id="ordn-prod">${d.products.map((p) => `<option value="${p.id}">${escape(p.name)} — ${escape(money(p.price, p.currency))}</option>`).join('')}<option value="">Autre (nom libre)</option></select></label>
      <label id="ordn-name" hidden>Nom de la commande<input name="name" maxlength="120" placeholder="Ex. Album mariage 30×30"></label>
      <div class="row2"><label>Quantité<input name="quantity" type="number" min="1" max="50" value="1" required></label>
      <label>Remise<select name="delivery"><option value="pickup">Retrait chez moi</option><option value="delivery">Livraison</option></select></label></div>
      <label>Note <span class="optional">(facultatif)</span><input name="note" maxlength="600"></label>`,
    async (v) => {
      const body = { clientId: v.clientId, productId: v.productId || null, name: v.name || '', quantity: Number(v.quantity), delivery: v.delivery, address: '', note: v.note || '' };
      const r = await api('/api/admin/orders', { method: 'POST', body });
      toast('Commande créée : composez maintenant l’album.'); await reload(); setTimeout(() => albumModal(r.order.id), 150);
    }, { submit: 'Créer et composer l’album' });
    const host = document.getElementById('overlays');
    const sync = () => { host.querySelector('#ordn-name').hidden = !!host.querySelector('#ordn-prod').value; };
    host.querySelector('#ordn-prod').addEventListener('change', sync); sync();
  }

  function productModal(p) {
    modal(p ? 'Modifier le produit' : 'Nouveau produit', `<label>Nom<input name="name" required maxlength="120" value="${escape(p?.name || '')}" placeholder="Ex. Album 30×30 — 20 pages"></label>
      <label>Description <span class="optional">(facultatif)</span><input name="description" maxlength="400" value="${escape(p?.description || '')}" placeholder="Ex. Couverture rigide, papier mat"></label>
      <div class="row2"><label>Prix<input name="price" type="number" min="0" step="0.01" required value="${p?.price ?? ''}"></label><label>Devise<select name="currency">${d.currencies.map((c) => `<option ${((p?.currency) || 'USD') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
      <div class="row2"><label>Photos minimum<input name="minPhotos" type="number" min="1" max="500" required value="${p?.minPhotos ?? 1}"></label><label>Photos maximum<input name="maxPhotos" type="number" min="1" max="500" required value="${p?.maxPhotos ?? 30}"></label></div>
      <label>Photo de couverture <span class="optional">(facultatif)</span><input type="file" name="cover" accept="image/*"></label>
      <p class="small">${p?.cover ? 'Une couverture est déjà en place : choisissez une nouvelle image pour la remplacer. ' : ''}Cette image s’affiche en grand dans le catalogue de vos clients, avec le nom, la description et le prix. Choisissez une belle photo en format portrait ou carré.</p>
      <label class="share-toggle"><span><strong>Visible pour les clients</strong></span><input class="switch" type="checkbox" name="active" ${p?.active === false ? '' : 'checked'}></label>`,
    async (v) => {
      const body = { name: v.name, description: v.description || '', price: v.price, currency: v.currency, minPhotos: Number(v.minPhotos), maxPhotos: Number(v.maxPhotos), active: v.active === 'on' };
      const saved = await api(p ? `/api/admin/orders/products/${p.id}` : '/api/admin/orders/products', { method: p ? 'PUT' : 'POST', body });
      if (v.cover && v.cover.size) { const form = new FormData(); form.append('cover', v.cover); await api(`/api/admin/orders/products/${saved.product.id}/cover`, { method: 'POST', form }); }
      toast('Produit enregistré.'); await reload();
    }, { submit: 'Enregistrer' });
  }
  draw();
}
