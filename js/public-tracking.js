const box = document.getElementById('tracking');
const [kind, token] = location.hash.slice(1).split('/');
const labels = { pending: 'En attente', accepted: 'Acceptée', declined: 'Refusée', cancelled: 'Annulée', reviewed: 'En cours d’examen', approved: 'Approuvée', active: 'Actif', expired: 'Expiré', expiring: 'Expire bientôt', suspended: 'Suspendu' };

function append(tag, text) {
  const item = document.createElement(tag);
  item.textContent = text;
  box.append(item);
  return item;
}

async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Demande indisponible.');
  return data;
}

async function load() {
  box.replaceChildren();
  if (!['reservation', 'candidature', 'abonnement'].includes(kind) || !/^[a-f0-9]{64}$/.test(token || '')) {
    append('p', 'Ouvrez le lien privé obtenu lors de l’envoi de votre demande.');
    return;
  }
  try {
    const record = await post('/api/public/tracking', { kind, token });
    append('h2', record.proposed_date ? 'Autre créneau proposé' : labels[record.status] || record.status);
    append('p', 'Référence : ' + token.slice(-10).toUpperCase());
    if (record.plan) append('p', `Kentra Pix ${record.plan === 'studio' ? 'Studio' : 'Portfolio'} · ${record.amount} GDS · ${record.period === 'year' ? 'Annuel' : 'Mensuel'}`);
    if (record.expires_at) append('p', 'Échéance : ' + record.expires_at.slice(0, 10));
    if (record.plan && ['expired', 'expiring', 'pending'].includes(record.status)) {
      const renew = append('a', 'Payer ou renouveler mon abonnement');
      renew.href = '/tarifs#souscrire';
    }
    if (record.wished_date) append('p', 'Date demandée : ' + record.wished_date + ' à ' + record.wished_time);
    if (record.proposed_date) {
      append('p', 'Proposition : ' + record.proposed_date + ' à ' + record.proposed_time);
      const status = append('p', '');
      const buttons = [true, false].map(accept => {
        const button = append('button', accept ? 'Choisir cette date' : 'Refuser la proposition');
        button.className = 'pf-btn';
        button.onclick = async () => {
          buttons.forEach(item => { item.disabled = true; });
          try {
            await post('/api/public/tracking/respond', { token, accept });
            await load();
          } catch (error) { status.textContent = error.message; }
          finally { buttons.forEach(item => { item.disabled = false; }); }
        };
        return button;
      });
    }
  } catch (error) { append('p', error.message); }
}

load();
