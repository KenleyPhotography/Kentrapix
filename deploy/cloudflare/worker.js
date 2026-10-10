// Cloudflare Worker KentraPix : affiche une page « Bienvenue » pendant que Render se réveille.
// Route à créer : kentrapix.kenleyelysee.com/*  (le DNS doit être « proxied », nuage orange).
// Quand Render répond, la page redirige toute seule vers le site.

const ORIGIN_TIMEOUT_MS = 8000;

const WELCOME = `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>KentraPix</title>
<link rel="icon" href="/logo/icon-192.png">
<style>
:root{--blue:#1265d8;--blue-d:#0a3d85;--blue-l:#7db6ff}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{position:relative;min-height:100vh;overflow:hidden;color:#fff;text-align:center;font-family:Inter,'Segoe UI',Arial,sans-serif;
 background:linear-gradient(135deg,var(--blue-d),var(--blue) 55%,#1a74ec)}
.orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;animation:drift 14s ease-in-out infinite alternate}
.o1{width:46vmax;height:46vmax;background:#3a80e0;top:-18vmax;right:-12vmax}
.o2{width:38vmax;height:38vmax;background:#0a3d85;bottom:-16vmax;left:-12vmax;animation-delay:-5s}
.o3{width:22vmax;height:22vmax;background:#4aa0ff;top:40%;left:55%;opacity:.3;animation-delay:-9s}
main{position:relative;z-index:1;min-height:100vh;display:flex;align-items:center;justify-content:center;gap:clamp(40px,8vw,120px);padding:32px clamp(16px,5vw,64px)}
.txt{display:flex;flex-direction:column;align-items:center;max-width:620px}
.logo{width:clamp(84px,12vw,120px);height:auto;border-radius:26%;box-shadow:0 16px 34px rgba(0,20,70,.45);animation:float 4s ease-in-out infinite}
h1{margin:22px 0 0;font-size:clamp(52px,9vw,128px);line-height:.95;font-weight:800;letter-spacing:-.04em}
h1 b{display:inline-block;font-weight:800;opacity:0;transform:translateY(40px);animation:rise .7s cubic-bezier(.2,.9,.3,1.2) forwards}
.brand{margin:14px 0 22px;font-size:clamp(20px,3vw,30px);font-weight:700;letter-spacing:.02em;animation:glow 3s ease-in-out infinite}.brand span{color:var(--blue-l)}
.bar{width:min(360px,80vw);height:6px;border-radius:99px;background:rgba(255,255,255,.2);overflow:hidden}
.bar i{position:relative;overflow:hidden;display:block;height:100%;width:8%;border-radius:99px;background:linear-gradient(90deg,#fff,var(--blue-l));transition:width .6s ease}
.bar i:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.9),transparent);transform:translateX(-100%);animation:shine 1.6s linear infinite}
.msg{margin:14px 0 2px;font-size:15px;min-height:22px}
button{margin-top:16px;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;color:var(--blue);background:#fff;border:0;border-radius:50%;cursor:pointer;transition:transform .15s}
button:hover{transform:rotate(90deg) scale(1.06)}button:active{transform:scale(.94)}
button svg{width:22px;height:22px}
.count{flex:none;display:flex;flex-direction:column;align-items:center;width:clamp(150px,17vw,220px)}
.sab{width:100%;height:auto;overflow:visible;filter:drop-shadow(0 18px 22px rgba(0,20,70,.4));transform-origin:50% 50%;animation:rock 4s ease-in-out infinite}
.sab.flip{animation:flip 1.4s ease-in-out infinite}
@media (max-width:860px){
 main{flex-direction:column;justify-content:space-between;padding-top:40px;padding-bottom:36px;gap:28px}
 .txt{flex:1;justify-content:center}
 .count{width:110px}
}
@keyframes float{50%{transform:translateY(-6px)}}
@keyframes rise{to{opacity:1;transform:none}}
@keyframes drift{to{transform:translate(6vmax,5vmax) scale(1.15)}}
@keyframes shine{to{transform:translateX(100%)}}
@keyframes glow{50%{text-shadow:0 0 22px rgba(125,182,255,.9)}}
@keyframes rock{50%{transform:rotate(8deg)}0%,100%{transform:rotate(-8deg)}}
@keyframes flip{0%,30%{transform:rotate(0)}70%,100%{transform:rotate(180deg)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}h1 b{opacity:1;transform:none}}
</style></head><body>
<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div>
<main>
 <div class="txt">
  <img class="logo" src="/logo/icon-192.png" alt="KentraPix" width="120" height="120">
  <h1 aria-label="Bienvenue" id="t"></h1>
  <div class="brand">Kentra<span>Pix</span></div>
  <div class="bar" role="progressbar" aria-label="Chargement"><i id="fill"></i></div>
  <p class="msg" id="msg" aria-live="polite">Nous préparons votre espace…</p>
  <button id="retry" type="button" aria-label="Réessayer" title="Réessayer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>
 </div>
 <div class="count" aria-hidden="true">
  <svg class="sab" id="sab" viewBox="0 0 120 160">
   <defs>
    <linearGradient id="wd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5638"/><stop offset="1" stop-color="#3b2013"/></linearGradient>
    <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#cfe0f5" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>
    <linearGradient id="sd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc247"/><stop offset="1" stop-color="#e08a12"/></linearGradient>
    <clipPath id="cp"><path d="M32 28H88C88 52 68 66 64 80C68 94 88 108 88 132H32C32 108 52 94 56 80C52 66 32 52 32 28Z"/></clipPath>
   </defs>
   <rect x="26" y="22" width="6" height="116" rx="3" fill="url(#wd)"/><rect x="88" y="22" width="6" height="116" rx="3" fill="url(#wd)"/>
   <path d="M32 28H88C88 52 68 66 64 80C68 94 88 108 88 132H32C32 108 52 94 56 80C52 66 32 52 32 28Z" fill="rgba(255,255,255,.12)"/>
   <g clip-path="url(#cp)"><rect id="st" x="30" y="28" width="60" height="52" fill="url(#sd)"/><rect id="sb" x="30" y="132" width="60" height="0" fill="url(#sd)"/><rect id="sm" x="59" y="80" width="2" height="52" fill="#ffc247"/></g>
   <path d="M32 28H88C88 52 68 66 64 80C68 94 88 108 88 132H32C32 108 52 94 56 80C52 66 32 52 32 28Z" fill="url(#gl)" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>
   <rect x="18" y="14" width="84" height="14" rx="7" fill="url(#wd)"/><rect x="18" y="132" width="84" height="14" rx="7" fill="url(#wd)"/>
  </svg>
 </div>
</main>
<script>
(function(){
 var TOTAL=45;
 var t=document.getElementById('t');
 'Bienvenue'.split('').forEach(function(ch,i){var b=document.createElement('b');b.textContent=ch;b.style.animationDelay=(i*70)+'ms';t.appendChild(b)});
 var msg=document.getElementById('msg'),fill=document.getElementById('fill'),sab=document.getElementById('sab'),st=document.getElementById('st'),sb=document.getElementById('sb'),sm=document.getElementById('sm');
 function sand(p){var t=28+p*52,b=132-p*50;st.setAttribute('y',t);st.setAttribute('height',80-t+1);sb.setAttribute('y',b);sb.setAttribute('height',132-b);sm.setAttribute('height',Math.max(0,b-80));sm.style.opacity=p>=1?0:1}
 sand(0);
 var steps=['Nous préparons votre espace…','Chargement de votre galerie…','Vos souvenirs arrivent…','Presque prêt…'];
 var start=Date.now(),busy=false,done=false;
 function check(){
  if(busy||done)return;busy=true;
  var c=new AbortController(),tm=setTimeout(function(){c.abort()},6000);
  fetch('/api/health?_='+Date.now(),{cache:'no-store',signal:c.signal,headers:{Accept:'application/json'}})
   .then(function(r){return r.ok?r.json().catch(function(){return null}):null})
   .then(function(j){if(j){done=true;fill.style.width='100%';sand(1);msg.textContent='C’est prêt, bienvenue !';setTimeout(function(){location.replace(location.href)},500)}})
   .catch(function(){}).then(function(){clearTimeout(tm);busy=false});
 }
 setInterval(function(){
  if(done)return;
  var s=Math.floor((Date.now()-start)/1000),left=Math.max(0,TOTAL-s);
  sand(1-left/TOTAL);
  if(left===0){sab.setAttribute('class','sab flip')}
  msg.textContent=steps[Math.min(steps.length-1,Math.floor(s/12))];
  fill.style.width=Math.min(92,8+s*1.5)+'%';
 },1000);
 setInterval(check,3000);check();
 document.getElementById('retry').onclick=function(){msg.textContent='Nouvelle tentative…';check()};
})();
</script></body></html>`;

function wantsHtml(request) {
  return request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html');
}

// Render répond parfois avec sa propre page « SERVICE WAKING UP » (statut 200 ou autre) : on la reconnaît à son contenu.
const RENDER_MARKERS = /SERVICE WAKING UP|INCOMING HTTP REQUEST DETECTED|ALLOCATING COMPUTE RESOURCES/i;

async function isWaking(request, res) {
  if ([502, 503, 504].includes(res.status)) return true;
  if (/hibernate|suspend|wake/i.test(res.headers.get('x-render-routing') || '')) return true;
  if (wantsHtml(request) && (res.headers.get('content-type') || '').includes('text/html')) {
    try { return RENDER_MARKERS.test(await res.clone().text()); } catch (e) { return false; }
  }
  return false;
}

export default {
  async fetch(request) {
    let res = null;
    try {
      res = await fetch(request, { signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS) });
    } catch (e) { /* timeout ou erreur réseau : Render dort encore */ }

    if (res && !(await isWaking(request, res))) return res;

    if (wantsHtml(request)) {
      return new Response(WELCOME, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '10' },
      });
    }
    return new Response(JSON.stringify({ error: 'waking' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '10' },
    });
  },
};
