import{icon}from'./icons.js';import{openSlideshow}from'./slideshow.js';
// Galerie partagée par un client à sa famille : mot de passe, puis photos + diaporama. Aucun téléchargement.
const app=document.getElementById('app');
const token=new URLSearchParams(location.search).get('t')||'';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=m=>{const t=document.getElementById('toast');t.textContent=m;t.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display='none',3600)};
const brand=`<a class="share-brand" href="/login.html" aria-label="KentraPix"><img src="/logo/kentrapix-icon.svg" alt="" width="34" height="34"><span>Kentra<b>Pix</b></span></a>`;
const date=d=>d?new Date(String(d).slice(0,10)+'T12:00:00Z').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):'';
async function call(path,opts={}){const res=await fetch(path,{credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json'},...opts});if(res.status===204)return null;const body=await res.json().catch(()=>({}));if(!res.ok)throw Object.assign(Error(body.error||'Erreur, réessayez.'),{status:res.status});return body}

function message(title,text){app.innerHTML=`<main class="share-gate">${brand}<section class="share-card">${icon('lock')}<h1>${esc(title)}</h1><p>${esc(text)}</p></section></main>`}

function gate(studio){
app.innerHTML=`<main class="share-gate">${brand}<section class="share-card"><span class="share-lock">${icon('lock')}</span><h1>Galerie privée</h1><p>${studio?`Photos de <strong>${esc(studio)}</strong>, partagées avec vous.`:'Des photos ont été partagées avec vous.'} Entrez le mot de passe reçu avec ce lien.</p><form id="gate"><label class="sr-only" for="pw">Mot de passe</label><input id="pw" name="password" type="password" required autocomplete="current-password" placeholder="Mot de passe"><button class="btn primary">${icon('arrow')} Voir les photos</button></form></section></main>`;
const form=document.getElementById('gate');form.password.focus();
form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;try{await call(`/api/share/${encodeURIComponent(token)}/open`,{method:'POST',body:JSON.stringify({password:form.password.value})});load()}catch(err){toast(err.message);form.password.select()}finally{b.disabled=false}}}

function gallery(d){
const e=d.event,meta=[e.type,date(e.date),e.location].filter(Boolean).map(esc).join(' · ');
// Téléchargement : seulement si le studio l'autorise (d.download = adresse du ZIP, sinon null).
const dl=d.download;
app.innerHTML=`<header class="share-top">${brand}<div class="share-top-actions">${dl?`<a class="btn" href="${esc(dl)}" download>${icon('download')} <span>Tout télécharger</span></a>`:''}<button class="btn primary" id="play">${icon('play')} <span>Diaporama</span></button></div></header><main class="share-main"><div class="share-head"><p class="share-kicker">${d.studio?`${esc(d.studio)} · `:''}${d.photos.length} photo${d.photos.length>1?'s':''}</p><h1>${esc(e.name)}</h1>${meta?`<p class="share-meta">${meta}</p>`:''}</div><div class="share-grid">${d.photos.map((p,i)=>`<figure class="share-cell"><button class="share-tile" data-i="${i}" aria-label="Photo ${p.number}"><img src="${esc(p.preview)}" alt="" loading="lazy" draggable="false"${p.width&&p.height?` width="${p.width}" height="${p.height}"`:''}></button>${dl?`<a class="share-dl" href="${esc(dl)}/${esc(p.id)}" download title="Télécharger" aria-label="Télécharger la photo ${p.number}">${icon('download')}</a>`:''}</figure>`).join('')}</div><p class="share-foot">${icon(dl?'heart':'lock')} ${dl?'Photos à garder en souvenir':'Photos protégées · téléchargement désactivé'} · KentraPix</p></main>`;
const play=i=>openSlideshow({photos:d.photos,music:e.music,title:e.name,start:i});
document.getElementById('play').onclick=()=>play(0);
app.querySelectorAll('.share-tile').forEach(b=>b.onclick=()=>play(Number(b.dataset.i)));
app.addEventListener('contextmenu',ev=>{if(ev.target.closest('img'))ev.preventDefault()})}

async function load(){
if(!/^[A-Za-z0-9_-]{32}$/.test(token))return message('Lien incomplet','Vérifiez que vous avez copié l’adresse en entier.');
try{const d=await call(`/api/share/${encodeURIComponent(token)}`);d.locked?gate(d.studio):gallery(d)}
catch(err){err.status===404?message('Lien indisponible','Ce lien n’existe pas ou la galerie n’est plus disponible.'):message('Oups','Impossible de charger la galerie. Réessayez plus tard.')}}
load();
