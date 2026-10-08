import{icon}from'./icons.js';
// Diaporama plein écran : fondu enchaîné, léger zoom, musique de la galerie, commandes qui s'effacent.
// Utilisé par l'espace client et par la page de partage famille (aucun téléchargement possible).
const DELAY=5000;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function openSlideshow({photos,music=null,title='',start=0}){
if(!photos?.length)return;
let host=document.getElementById('slideshow-host');if(host)host.remove();
host=document.createElement('div');host.id='slideshow-host';document.body.append(host);
let index=start,playing=true,timer=null,hideTimer=null,layer=0,muted=false;
host.innerHTML=`<div class="slideshow" role="dialog" aria-modal="true" aria-label="Diaporama">
<div class="ss-stage"><img class="ss-img" alt="" draggable="false"><img class="ss-img" alt="" draggable="false"></div>
<div class="ss-top"><div><p class="ss-title">${esc(title)}</p><p class="ss-count"></p></div><button class="ss-btn" data-ss="close" aria-label="Fermer">${icon('close')}</button></div>
<div class="ss-bar"><span class="ss-progress"></span></div>
<div class="ss-controls"><button class="ss-btn" data-ss="prev" aria-label="Photo précédente">${icon('back')}</button><button class="ss-btn ss-main" data-ss="play" aria-label="Pause">${icon('pause')}</button><button class="ss-btn" data-ss="next" aria-label="Photo suivante">${icon('arrow')}</button>${music?`<button class="ss-btn" data-ss="music" aria-label="Couper la musique">${icon('volume')}</button>`:''}${document.fullscreenEnabled?`<button class="ss-btn" data-ss="full" aria-label="Plein écran">${icon('expand')}</button>`:''}</div>
${music?`<audio class="ss-audio" src="${esc(music)}" loop preload="auto"></audio>`:''}</div>`;
const root=host.querySelector('.slideshow'),imgs=[...host.querySelectorAll('.ss-img')],count=host.querySelector('.ss-count'),bar=host.querySelector('.ss-progress'),audio=host.querySelector('.ss-audio'),playBtn=host.querySelector('[data-ss="play"]'),musicBtn=host.querySelector('[data-ss="music"]');
document.body.style.overflow='hidden';
const preload=i=>{const p=photos[(i+photos.length)%photos.length];if(p){const im=new Image();im.src=p.preview}};
const show=()=>{const next=imgs[1-layer],cur=imgs[layer];next.onload=()=>{next.classList.add('on');cur.classList.remove('on');layer=1-layer};next.src=photos[index].preview;if(next.complete&&next.naturalWidth)next.onload();count.textContent=`${index+1} / ${photos.length}`;preload(index+1);restartBar()};
const restartBar=()=>{bar.style.transition='none';bar.style.width='0';if(!playing)return;void bar.offsetWidth;bar.style.transition=`width ${DELAY}ms linear`;bar.style.width='100%'};
const tick=()=>{clearTimeout(timer);if(playing)timer=setTimeout(()=>{index=(index+1)%photos.length;show();tick()},DELAY)};
const go=n=>{index=(index+n+photos.length)%photos.length;show();tick()};
const fadeIn=()=>{if(!audio||muted)return;audio.volume=0;audio.play().then(()=>{let v=0;const f=setInterval(()=>{v=Math.min(1,v+0.05);audio.volume=v;if(v>=1)clearInterval(f)},80)}).catch(()=>{})};
const setPlaying=p=>{playing=p;playBtn.innerHTML=icon(p?'pause':'play');playBtn.setAttribute('aria-label',p?'Pause':'Lecture');root.classList.toggle('paused',!p);if(audio&&!muted){p?audio.play().catch(()=>{}):audio.pause()}restartBar();tick()};
const setMuted=m=>{muted=m;if(!audio)return;audio.muted=m;musicBtn.innerHTML=icon(m?'mute':'volume');musicBtn.setAttribute('aria-label',m?'Activer la musique':'Couper la musique');if(!m&&playing)audio.play().catch(()=>{})};
const wake=()=>{root.classList.remove('idle');clearTimeout(hideTimer);hideTimer=setTimeout(()=>root.classList.add('idle'),2600)};
const close=()=>{clearTimeout(timer);clearTimeout(hideTimer);audio?.pause();document.removeEventListener('keydown',key);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});document.body.style.overflow='';host.remove()};
const key=e=>{wake();if(e.key==='Escape')close();else if(e.key==='ArrowRight')go(1);else if(e.key==='ArrowLeft')go(-1);else if(e.key===' '){e.preventDefault();setPlaying(!playing)}};
host.addEventListener('click',e=>{const b=e.target.closest('[data-ss]');wake();if(!b)return;const a=b.dataset.ss;if(a==='close')close();else if(a==='prev')go(-1);else if(a==='next')go(1);else if(a==='play')setPlaying(!playing);else if(a==='music')setMuted(!muted);else if(a==='full')document.fullscreenElement?document.exitFullscreen():root.requestFullscreen?.().catch(()=>{})});
root.addEventListener('mousemove',wake);root.addEventListener('contextmenu',e=>e.preventDefault());
let sx=null;root.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;wake()},{passive:true});root.addEventListener('touchend',e=>{if(sx===null)return;const dx=e.changedTouches[0].clientX-sx;sx=null;if(Math.abs(dx)>50)go(dx<0?1:-1)});
document.addEventListener('keydown',key);
show();tick();wake();fadeIn();
}
