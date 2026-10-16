// Notifications sur ce téléphone (Web Push) : activer / désactiver / tester, dans la page « Profil ».
import { api } from './service.js';

export const pushSection = () => '<section class="settings profile-panel" id="push-box"><header><h2>Notifications sur ce téléphone</h2></header><div id="push-body"><p class="small">Chargement…</p></div></section>';

const keyBytes = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export async function bindPush({ toast }) {
  const body = document.getElementById('push-body');
  if (!body) return;
  const say = (html) => { body.innerHTML = html; };
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) {
    say(isIos() && !standalone()
      ? '<p class="small">Sur iPhone, ajoutez d’abord KentraPix à l’écran d’accueil (bouton Partager → « Sur l’écran d’accueil »), puis ouvrez l’application depuis l’icône pour activer les notifications.</p>'
      : '<p class="small">Ce navigateur ne permet pas les notifications. Essayez avec Chrome, Edge ou Safari (iPhone : après ajout à l’écran d’accueil).</p>');
    return;
  }
  let info;
  try { info = await api('/api/push'); } catch (e) { say(`<p class="small">${e.message}</p>`); return; }
  if (!info.enabled) { say('<p class="small">Les notifications ne sont pas encore activées sur ce serveur.</p>'); return; }

  const draw = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const denied = Notification.permission === 'denied';
    say(`<p class="small">${sub ? 'Activées : vous serez prévenu sur ce téléphone (photos prêtes, rendez-vous, commandes, rappels).' : 'Recevez une alerte sur ce téléphone, sans ouvrir vos e-mails.'}</p>
      ${denied ? '<p class="small">Les notifications sont bloquées pour ce site : autorisez-les dans les réglages du navigateur, puis revenez ici.</p>' : ''}
      <div class="row">${sub
        ? '<button class="btn sm" id="push-test">Envoyer un essai</button><button class="btn sm" id="push-off">Désactiver</button>'
        : `<button class="btn sm primary" id="push-on" ${denied ? 'disabled' : ''}>Activer les notifications</button>`}</div>`);
    body.querySelector('#push-on')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { toast('Notifications refusées : vous pourrez les activer plus tard.'); return await draw(); }
        const created = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) });
        await api('/api/push/subscribe', { method: 'POST', body: created.toJSON() });
        toast('Notifications activées sur ce téléphone.');
      } catch (err) { toast(err.message || 'Activation impossible.'); }
      await draw();
    });
    body.querySelector('#push-off')?.addEventListener('click', async () => {
      try {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint } });
        toast('Notifications désactivées sur ce téléphone.');
      } catch (err) { toast(err.message); }
      await draw();
    });
    body.querySelector('#push-test')?.addEventListener('click', async () => {
      try { await api('/api/push/test', { method: 'POST' }); toast('Essai envoyé.'); } catch (err) { toast(err.message); }
    });
  };
  await draw();
}
