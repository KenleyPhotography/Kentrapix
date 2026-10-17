// Notifications sur ce téléphone (Web Push) : activer / désactiver / tester, dans la page « Profil ».
import { api, escape } from './service.js';

export const pushSection = () => '<section class="settings profile-panel" id="push-box"><header><h2>Notifications sur ce téléphone</h2></header><div id="push-body"><p class="small">Chargement…</p></div></section>';

const keyBytes = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- Application Android (APK) : Firebase Cloud Messaging via le plugin natif ----------
const nativePush = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.PushNotifications : null);
let nativeReady = false;
let nativeError = '';
async function registerNative() {
  const P = nativePush();
  if (!P) return false;
  let perm = await P.checkPermissions();
  if (perm.receive !== 'granted' && perm.receive !== 'denied') perm = await P.requestPermissions(); // boîte de dialogue Android
  if (perm.receive !== 'granted') return false;
  if (!nativeReady) {
    nativeReady = true;
    // Canal des notifications KentraPix (Android 8+) : importance haute, vibration, voyant bleu Kentra.
    await P.createChannel({ id: 'kentrapix', name: 'KentraPix', description: 'Photos prêtes, rendez-vous, contrats et rappels', importance: 4, visibility: 0, vibration: true, lights: true, lightColor: '#1265d8' }).catch(() => {});
    P.addListener('registration', (t) => {
      try { localStorage.setItem('kp-fcm-token', t.value); } catch { /* sans stockage */ }
      api('/api/push/fcm', { method: 'POST', body: { token: t.value } }).catch(() => {});
    });
    // Application ouverte : Android n'affiche pas la notification, on la montre dans l'application.
    P.addListener('pushNotificationReceived', (n) => {
      document.getElementById('push-live')?.remove();
      const el = document.createElement('div');
      el.id = 'push-live';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top));z-index:9999;max-width:460px;margin:0 auto;background:#1265d8;color:#fff;border-radius:14px;padding:12px 16px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:15px';
      el.innerHTML = `<b>${escape(n.title || 'KentraPix')}</b><br>${escape(n.body || '')}`;
      const url = n.data?.url;
      el.onclick = () => { el.remove(); if (typeof url === 'string' && url.startsWith('/') && url !== '/') location.href = url; };
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 6000);
    });
    P.addListener('registrationError', (e) => { nativeError = e?.error || 'Enregistrement refusé par Firebase'; });
    P.addListener('pushNotificationActionPerformed', (a) => {
      const url = a.notification?.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) location.href = url;
    });
  }
  await P.register();
  return true;
}

export async function bindPush({ toast }) {
  const body = document.getElementById('push-body');
  if (!body) return;
  const say = (html) => { body.innerHTML = html; };
  if (nativePush()) {
    const ok = await registerNative().catch((e) => { nativeError = e?.message || String(e); return false; });
    await new Promise((r) => setTimeout(r, 2500)); // laisse à Firebase le temps de donner le jeton
    let devices = '?';
    try { devices = (await api('/api/push')).devices; } catch { /* hors connexion */ }
    say(ok
      ? `<p class="small">${devices > 0 ? 'Activées : vous serez prévenu sur ce téléphone (photos prêtes, rendez-vous, commandes, rappels).' : 'Autorisées, mais cet appareil n’est pas encore enregistré. Fermez puis rouvrez l’application.'}</p><p class="small">Appareils enregistrés : <b>${devices}</b>${nativeError ? ` · Erreur : ${escape(nativeError)}` : ''}</p><div class="row"><button class="btn sm" id="push-test">Envoyer un essai</button></div>`
      : `<p class="small">Les notifications sont bloquées ou indisponibles : autorisez-les dans Réglages Android → Applications → KentraPix → Notifications.${nativeError ? ` (${escape(nativeError)})` : ''}</p>`);
    body.querySelector('#push-test')?.addEventListener('click', async () => {
      try { await api('/api/push/test', { method: 'POST', body: { delay: 8 } }); toast('Essai dans 8 secondes : appuyez sur le bouton Accueil pour fermer l’application et voir la notification.'); } catch (err) { toast(err.message); }
    });
    return;
  }
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

// ---------- Activation automatique ----------
// Une fois KentraPix installé (icône / fenêtre d'application), on propose les notifications dès l'ouverture :
// un seul toucher sur « Activer » (les navigateurs exigent un geste de l'utilisateur). Si l'autorisation est déjà donnée,
// l'appareil est réabonné sans rien demander. Refus ou « Plus tard » : on ne redemande pas avant 14 jours.
const ASKED_KEY = 'kp-push-asked';
const askedRecently = () => { try { return Date.now() - Number(localStorage.getItem(ASKED_KEY) || 0) < 14 * 864e5; } catch { return false; } };
const markAsked = () => { try { localStorage.setItem(ASKED_KEY, String(Date.now())); } catch { /* sans stockage : on redemandera */ } };

async function subscribeThisDevice(reg, publicKey) {
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

export async function offerPush({ toast }) {
  try {
    if (nativePush()) return void (await registerNative()); // application Android : demande système, sans bandeau
    if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    const info = await api('/api/push');
    if (!info.enabled) return;
    const reg = await navigator.serviceWorker.ready;
    if (Notification.permission === 'granted') return await subscribeThisDevice(reg, info.publicKey); // réabonnement silencieux
    if (!standalone() || askedRecently() || document.getElementById('push-ask')) return;
    const bar = document.createElement('div');
    bar.id = 'push-ask';
    bar.setAttribute('role', 'dialog');
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9999;max-width:460px;margin:0 auto;background:#1265d8;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:15px;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
    bar.innerHTML = '<span style="flex:1 1 200px"><b>Activer les notifications ?</b><br>Soyez prévenu dès que vos photos sont prêtes.</span><span style="display:flex;gap:8px"><button type="button" id="push-ask-later" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);border-radius:10px;padding:9px 14px;font:inherit">Plus tard</button><button type="button" id="push-ask-on" style="background:#fff;color:#1265d8;border:0;border-radius:10px;padding:9px 16px;font:inherit;font-weight:700">Activer</button></span>';
    document.body.appendChild(bar);
    bar.querySelector('#push-ask-later').onclick = () => { markAsked(); bar.remove(); };
    bar.querySelector('#push-ask-on').onclick = async () => {
      markAsked();
      bar.remove();
      try {
        if ((await Notification.requestPermission()) !== 'granted') return toast('Notifications refusées : vous pourrez les activer dans Profil.');
        await subscribeThisDevice(reg, info.publicKey);
        toast('Notifications activées sur cet appareil.');
      } catch (err) { toast(err.message || 'Activation impossible.'); }
    };
  } catch { /* hors connexion ou serveur sans notifications : rien à faire */ }
}

// À la déconnexion : cet appareil ne reçoit plus les notifications de ce compte (appareil partagé). Reconnexion = réabonnement automatique.
export async function detachPush() {
  try {
    const eps = [];
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) eps.push(sub.endpoint);
    try { const t = localStorage.getItem('kp-fcm-token'); if (t) eps.push(`fcm:${t}`); } catch { /* sans stockage */ }
    await Promise.all(eps.map((endpoint) => api('/api/push/unsubscribe', { method: 'POST', body: { endpoint } }).catch(() => {})));
  } catch { /* hors connexion : ignoré */ }
}
