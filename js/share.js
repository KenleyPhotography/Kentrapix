import{icon}from'./icons.js';import{openSlideshow}from'./slideshow.js';
// Galerie partagée par un client à sa famille : mot de passe, puis photos + diaporama, téléchargement si permis,
// et commentaires sous les photos si le lien les autorise (prénom retenu sur l'appareil).
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
app.innerHTML=`<header class="share-top">${brand}<div class="share-top-actions">${dl?`<a class="btn" href="${esc(dl)}" download>${icon('download')} <span>Tout télécharger</span></a>`:''}<button class="btn primary" id="play">${icon('play')} <span>Diaporama</span></button></div></header><main class="share-main"><div class="share-head">${d.comments?`<p class="share-hint">${icon('chat')} Touchez la bulle sous une photo pour laisser un mot.</p>`:''}<p class="share-kicker">${d.studio?`${esc(d.studio)} · `:''}${d.photos.length} photo${d.photos.length>1?'s':''}</p><h1>${esc(e.name)}</h1>${meta?`<p class="share-meta">${meta}</p>`:''}</div><div class="share-grid">${d.photos.map((p,i)=>`<figure class="share-cell"><button class="share-tile" data-i="${i}" aria-label="Photo ${p.number}"><img src="${esc(p.preview)}" alt="" loading="lazy" draggable="false"${p.width&&p.height?` width="${p.width}" height="${p.height}"`:''}></button>${dl?`<a class="share-dl" href="${esc(dl)}/${esc(p.id)}" download title="Télécharger" aria-label="Télécharger la photo ${p.number}">${icon('download')}</a>`:''}${d.comments?`<button class="share-chat" data-chat="${i}" aria-label="Commentaires de la photo ${p.number}">${icon('chat')}<b>${p.commentCount||''}</b></button>`:''}</figure>`).join('')}</div><p class="share-foot">${icon(dl?'heart':'lock')} ${dl?'Photos à garder en souvenir':'Photos protégées · téléchargement désactivé'} · KentraPix</p></main>`;
const play=i=>openSlideshow({photos:d.photos,music:e.music,title:e.name,start:i});
document.getElementById('play').onclick=()=>play(0);
app.querySelectorAll('.share-tile').forEach(b=>b.onclick=()=>play(Number(b.dataset.i)));
app.querySelectorAll('[data-chat]').forEach(b=>b.onclick=()=>openComments(d,Number(b.dataset.chat)));
app.addEventListener('contextmenu',ev=>{if(ev.target.closest('img'))ev.preventDefault()})}

// ----- Commentaires de la famille -----
const NAME_KEY='kp-share-name';
const savedName=()=>{try{return localStorage.getItem(NAME_KEY)||''}catch{return''}};
const saveName=n=>{try{localStorage.setItem(NAME_KEY,n)}catch{}};
const when=iso=>new Date(iso).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const initials=n=>String(n||'').split(/\s+/).filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase();
function openComments(d,i){const host=document.getElementById('sheet');let at=i,items=null;
const close=()=>{host.innerHTML='';document.removeEventListener('keydown',key);document.body.style.overflow=''};
const key=e=>{if(e.key==='Escape')close();if(e.target.matches?.('textarea,input'))return;if(e.key==='ArrowRight')go(1);if(e.key==='ArrowLeft')go(-1)};
const go=n=>{at=(at+n+d.photos.length)%d.photos.length;items=null;draw();fetchList()};
const list=()=>items===null?'<li class="sc-empty">Chargement…</li>':items.length?items.map(c=>`<li class="sc-item"><span class="sc-avatar">${esc(initials(c.author.name))}</span><div><p class="sc-meta"><strong>${esc(c.author.name)}</strong><time>${when(c.date)}</time></p><p>${esc(c.body).replace(/\n/g,'<br>')}</p>${c.mine?`<button class="text-link" data-del="${esc(c.id)}">Supprimer</button>`:''}</div></li>`).join(''):'<li class="sc-empty">Soyez le premier à laisser un mot sur cette photo.</li>';
function draw(){const p=d.photos[at];host.innerHTML=`<div class="sc-backdrop"><section class="sc-sheet" role="dialog" aria-modal="true" aria-label="Commentaires de la photo ${p.number}"><div class="sc-photo"><img src="${esc(p.preview)}" alt="Photo ${p.number}" draggable="false"><span class="sc-num">N° ${p.number}</span>${d.photos.length>1?`<button class="sc-nav is-prev" data-go="-1" aria-label="Photo précédente">${icon('back')}</button><button class="sc-nav is-next" data-go="1" aria-label="Photo suivante">${icon('arrow')}</button>`:''}</div><div class="sc-side"><div class="sc-head"><h2>Commentaires</h2><button class="sc-close" aria-label="Fermer">${icon('close')}</button></div><ul class="sc-list" id="sc-list">${list()}</ul><form class="sc-form" id="sc-form"><input name="name" maxlength="80" required placeholder="Votre prénom" autocomplete="given-name" value="${esc(savedName())}" aria-label="Votre prénom"><div class="sc-row"><textarea name="body" maxlength="1000" required rows="2" placeholder="Un mot sur cette photo…" aria-label="Votre commentaire"></textarea><button class="btn primary" aria-label="Envoyer">${icon('send')}</button></div></form></div></section></div>`;
document.body.style.overflow='hidden';
host.querySelector('.sc-backdrop').onclick=e=>{if(e.target===e.currentTarget)close()};host.querySelector('.sc-close').onclick=close;
host.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(Number(b.dataset.go)));
const form=host.querySelector('#sc-form');const area=form.body;area.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}};
form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;const name=form.name.value.trim();try{const r=await call(`/api/share/${encodeURIComponent(token)}/photos/${p.id}/comments`,{method:'POST',body:JSON.stringify({name,body:area.value})});saveName(name);items=[...(items||[]),r.comment];p.commentCount=(p.commentCount||0)+1;area.value='';refresh();area.focus()}catch(err){toast(err.message)}finally{b.disabled=false}};
bindList();(savedName()?area:form.name).focus()}
function refresh(){const ul=host.querySelector('#sc-list');if(!ul)return;ul.innerHTML=list();ul.scrollTop=ul.scrollHeight;bindList();
const badge=app.querySelector(`[data-chat="${at}"] b`);if(badge)badge.textContent=d.photos[at].commentCount||''}
function bindList(){host.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Supprimer votre commentaire ?'))return;try{await call(`/api/share/${encodeURIComponent(token)}/comments/${b.dataset.del}`,{method:'DELETE'});items=items.filter(c=>c.id!==b.dataset.del);d.photos[at].commentCount=Math.max(0,(d.photos[at].commentCount||1)-1);refresh()}catch(err){toast(err.message)}})}
async function fetchList(){const p=d.photos[at];try{const r=await call(`/api/share/${encodeURIComponent(token)}/photos/${p.id}/comments`);if(d.photos[at]!==p)return;items=r.comments;p.commentCount=items.length;refresh()}catch(err){toast(err.message)}}
document.addEventListener('keydown',key);draw();fetchList()}

async function load(){
if(!/^[A-Za-z0-9_-]{32}$/.test(token))return message('Lien incomplet','Vérifiez que vous avez copié l’adresse en entier.');
try{const d=await call(`/api/share/${encodeURIComponent(token)}`);d.locked?gate(d.studio):gallery(d)}
catch(err){err.status===404?message('Lien indisponible','Ce lien n’existe pas ou la galerie n’est plus disponible.'):message('Oups','Impossible de charger la galerie. Réessayez plus tard.')}}
load();
