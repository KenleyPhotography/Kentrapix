// Import avec vraie progression réseau, 3 photos en parallèle au maximum.
// Photos en ligne (service.data.upload.direct) : le navigateur prépare l'aperçu puis envoie original + aperçu
// directement au bucket via des adresses signées ; le serveur n'enregistre que la fiche de la photo.
// Galerie en mode sélection : seul l'aperçu compressé est envoyé (l'original reste sur l'ordinateur).
// Fichiers RAW (NEF, CR2, CR3, ARW, DNG…) : le JPEG pleine taille que l'appareil a enregistré dedans est
// extrait ici. C'est lui qui part — comme original téléchargeable (renommé .jpg) dans une galerie normale,
// ou seulement compressé en aperçu dans une galerie en mode sélection. Le RAW reste sur l'ordinateur.
import{service,escape}from'./service.js';
import{isRaw,jpgName,rawImage,ACCEPT_PHOTO}from'./raw.js';
const PARALLEL=3;
const DIRECT=['image/jpeg','image/png','image/webp','image/avif'];
const eventOf=id=>service.data.events.find(e=>e.id===id);
const mbOf=b=>(b/1024/1024).toFixed(2)+' Mo';
// ----- Import qui continue sur toutes les pages du studio -----
// La file d'attente et le bloc de progression vivent au niveau du module (et du <body>) : changer de page du studio ne les interrompt pas.
const pending=[];let running=0,dock=null,notify=()=>{},announced=true;
function pump(){while(running<PARALLEL&&pending.length){const task=pending.shift();running++;Promise.resolve().then(task).catch(()=>{}).finally(()=>{running--;pump();refreshDock()})}refreshDock()}
function ensureDock(){if(dock&&dock.root.isConnected)return dock;const root=document.createElement('section');root.id='upload-dock';root.setAttribute('role','status');root.setAttribute('aria-live','polite');
root.innerHTML='<header><div><strong>Import des photos</strong><span id="ud-sum"></span></div><button type="button" id="ud-toggle" aria-label="Réduire" aria-expanded="true">▾</button><button type="button" id="ud-close" aria-label="Fermer" hidden>×</button></header><div class="ud-bar"><i id="ud-fill"></i></div><div id="ud-list"></div>';
document.body.appendChild(root);const toggle=root.querySelector('#ud-toggle');toggle.onclick=()=>{const c=root.classList.toggle('is-collapsed');toggle.textContent=c?'▴':'▾';toggle.setAttribute('aria-expanded',String(!c))};
root.querySelector('#ud-close').onclick=()=>{[...root.querySelectorAll('.upload-row')].filter(r=>r.dataset.state==='done').forEach(r=>r.remove());if(!root.querySelector('.upload-row'))root.remove();dock=null};
dock={root,list:root.querySelector('#ud-list'),sum:root.querySelector('#ud-sum'),fill:root.querySelector('#ud-fill'),close:root.querySelector('#ud-close')};return dock}
function refreshDock(){if(!dock||!dock.root.isConnected)return;const rows=[...dock.list.querySelectorAll('.upload-row')];const done=rows.filter(r=>r.dataset.state==='done').length,fail=rows.filter(r=>r.dataset.state==='fail').length;const active=running+pending.length;const total=done+fail+active;
let part=0;for(const r of rows)if(!r.dataset.state)part+=Math.min(1,(parseFloat(r.querySelector('.progress-bar span')?.style.width)||0)/100);
dock.fill.style.width=total?Math.min(100,((done+fail+part)/total)*100)+'%':'0%';
dock.sum.textContent=active?`${done+fail}/${total} envoyées — vous pouvez changer de page`:fail?`${done} importée${done>1?'s':''}, ${fail} en échec`:`${done} photo${done>1?'s':''} importée${done>1?'s':''}`;
dock.root.classList.toggle('is-idle',!active);dock.close.hidden=!!active;
if(active)announced=false;else if(!announced&&done){announced=true;if(!fail)notify(`Import terminé : ${done} photo${done>1?'s':''}.`);}}
setInterval(refreshDock,500);
window.addEventListener('beforeunload',e=>{if(running||pending.length){e.preventDefault();e.returnValue=''}});
export const uploading=()=>running+pending.length>0;
export function bindUploader(toast){notify=toast;const input=document.getElementById('files'),drop=document.getElementById('drop'),select=document.getElementById('upload-event');if(!input)return;
const hint=()=>{const sel=eventOf(select.value)?.selectionMode;input.accept=ACCEPT_PHOTO;const h=document.getElementById('upload-hint');if(h)h.textContent=sel?'Galerie en mode sélection : photos compressées avant l’envoi, RAW acceptés (CR2, CR3, NEF, ARW, DNG…). Les originaux restent sur votre ordinateur.':'Photos envoyées en qualité originale (JPG, PNG, WEBP ou AVIF). RAW acceptés (CR2, CR3, NEF, ARW, DNG…) : le JPEG pleine taille enregistré dans le fichier est envoyé à sa place.'};hint();select.addEventListener('change',hint);
document.getElementById('browse').onclick=()=>input.click();input.onchange=()=>{upload([...input.files]);input.value=''};drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag')};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');upload([...e.dataTransfer.files])};
function upload(files){const eventId=select.value;const selection=!!eventOf(eventId)?.selectionMode;const direct=!!service.data.upload?.direct;const queue=files.filter(f=>{if(isRaw(f))return true;if(!f.type.startsWith('image/')){toast(f.name+' : choisissez une image.');return false}if(direct&&!selection&&!DIRECT.includes(f.type)){toast(f.name+' : format non pris en charge (JPG, PNG, WEBP, AVIF ou RAW).');return false}return true}).map(f=>()=>direct?sendDirect(f,eventId):send(f,eventId,selection));if(queue.length){ensureDock();pending.push(...queue);pump()}}
function row(file){const el=document.createElement('div');el.className='upload-row';el.innerHTML=`<div class="ud-thumb"><svg class="ud-ring" viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="20"/><circle class="arc" cx="22" cy="22" r="20" pathLength="100" stroke-dasharray="0 100"/></svg><span class="ud-img"></span><b class="ud-pct">0%</b></div><div class="progress"><strong>${escape(file.name)}</strong><p class="small">${mbOf(file.size)}</p><div class="progress-bar"><span style="width:0%"></span></div></div><button class="btn">Annuler</button>`;ensureDock().list.append(el);
const bar=el.querySelector('.progress-bar span'),arc=el.querySelector('.arc'),pct=el.querySelector('.ud-pct');
// Anneau + pourcentage suivent la barre (le code d'envoi continue d'écrire la largeur de la barre).
const sync=()=>{const done=el.dataset.state==='done',p=done?100:Math.max(0,Math.min(100,parseFloat(bar.style.width)||0));arc.setAttribute('stroke-dasharray',`${p} 100`);pct.textContent=done?'✓':`${Math.round(p)}%`;el.classList.toggle('is-done',done)};
new MutationObserver(sync).observe(bar,{attributes:true,attributeFilter:['style']});new MutationObserver(sync).observe(el,{attributes:true,attributeFilter:['data-state']});
// Vignette de la photo envoyée (réduite à la lecture : pas de décodage complet d'un fichier de 20 Mo).
if(file.type.startsWith('image/')&&!isRaw(file))createImageBitmap(file,{resizeWidth:96,resizeQuality:'low'}).then(b=>{const c=document.createElement('canvas');c.width=c.height=48;const k=Math.max(48/b.width,48/b.height);c.getContext('2d').drawImage(b,(48-b.width*k)/2,(48-b.height*k)/2,b.width*k,b.height*k);b.close?.();const img=el.querySelector('.ud-img');img.style.backgroundImage=`url(${c.toDataURL('image/jpeg',0.7)})`;img.classList.add('has-img')}).catch(()=>{});
return{el,bar,status:el.querySelector('p'),button:el.querySelector('button')}}
// ----- Envoi au serveur (stockage local) ; mode sélection : aperçu compressé seulement -----
async function send(file,eventId,selection){const{el,bar,status,button}=row(file);let body=file,name=file.name;if(selection||isRaw(file)){try{status.textContent=isRaw(file)?'Lecture du RAW…':'Compression…';const raw=isRaw(file)?await rawImage(file):null;if(raw)name=jpgName(file.name);
// Galerie en mode sélection : aperçu compressé. Galerie normale : le JPEG extrait du RAW, tel quel.
if(selection){status.textContent='Compression…';body=await makePreview(raw||file,service.data.upload?.previewWidth||1600)}else{body=raw.file;raw.bmp.close?.()}
status.textContent=`${mbOf(file.size)} → ${mbOf(body.size)}`}catch(err){status.textContent=err.message;button.textContent='Fermer';button.onclick=()=>el.remove();return}}
return new Promise(done=>{let xhr,stopped=false;const fail=msg=>{status.textContent=msg;el.dataset.state='fail';bar.style.width='0%';button.textContent='Réessayer';button.onclick=()=>{el.remove();send(file,eventId,selection)};done()};button.onclick=()=>{stopped=true;xhr?.abort();el.remove();done()};
// Mise à jour du serveur pendant l'envoi : la photo repart toute seule (jusqu'à 12 essais) au lieu d'échouer.
const go=n=>{xhr=new XMLHttpRequest();const again=msg=>{if(stopped)return;if(n>=12)return fail(msg);status.textContent='Nouvelle tentative…';bar.style.width='0%';setTimeout(()=>go(n+1),Math.min(10000,2000*(n+1)))};xhr.upload.onprogress=e=>{if(e.lengthComputable)bar.style.width=Math.min(95,e.loaded/e.total*100)+'%'};xhr.onload=()=>{let res={};try{res=JSON.parse(xhr.responseText)}catch{}if(xhr.status>=200&&xhr.status<300){service.data.photos.push(res.photo);bar.style.width='100%';status.textContent='Importée';el.dataset.state='done';button.remove();done()}else if([0,502,503,504].includes(xhr.status))again('Serveur indisponible');else fail(res.error||'Échec de l’import')};xhr.onerror=()=>again('Connexion perdue');const form=new FormData();form.append('photo',body,name);xhr.open('POST',`/api/admin/events/${encodeURIComponent(eventId)}/photos`);xhr.send(form)};go(0)})}
// ----- Envoi direct au bucket (photos en ligne) -----
const post=async(url,body)=>{const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Échec de l’import');return j};
function put(url,headers,body,onProgress,signal){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',url);for(const[k,v]of Object.entries(headers))xhr.setRequestHeader(k,v);xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(e.loaded/e.total)};xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error(`Envoi refusé par le stockage (${xhr.status})`));xhr.onerror=()=>reject(Error('Connexion perdue'));signal.onabort=()=>{xhr.abort();reject(Error('Annulé'))};xhr.send(body)})}
async function sendDirect(file,eventId){const{el,bar,status,button}=row(file);const ctrl={aborted:false,onabort:null};const base=`/api/admin/events/${encodeURIComponent(eventId)}/uploads`;button.onclick=()=>{ctrl.aborted=true;ctrl.onabort?.();el.remove()};
// RAW : c'est le JPEG pleine taille extrait du fichier qui tient lieu d'original (le RAW reste sur l'ordinateur).
try{let src=file,raw=null;if(isRaw(file)){status.textContent='Lecture du RAW…';raw=await rawImage(file);src=raw.file;if(ctrl.aborted)return}
status.textContent='Préparation…';const t=await post(base,{filename:src.name,type:src.type.slice(0,40),size:src.size});if(t.previewOnly)status.textContent='Compression…';const preview=await makePreview(raw||src,t.previewWidth);if(ctrl.aborted)return;
if(t.previewOnly){status.textContent=`${mbOf(file.size)} → ${mbOf(preview.size)} (compressée)`;await put(t.preview.url,t.preview.headers,preview,p=>bar.style.width=Math.min(90,p*90)+'%',ctrl)}
else{status.textContent=mbOf(src.size);await put(t.original.url,t.original.headers,src,p=>bar.style.width=Math.min(90,p*90)+'%',ctrl);await put(t.preview.url,t.preview.headers,preview,null,ctrl)}bar.style.width='95%';
const r=await post(`${base}/complete`,{id:t.id,ext:t.ext,ticket:t.ticket,filename:t.previewOnly?file.name:src.name,type:src.type.slice(0,40),size:src.size,previewOnly:!!t.previewOnly});service.data.photos.push(r.photo);bar.style.width='100%';status.textContent=t.previewOnly?`Importée — ${mbOf(preview.size)}`:'Importée';el.dataset.state='done';button.remove()}
catch(err){if(ctrl.aborted)return;status.textContent=err.message;el.dataset.state='fail';bar.style.width='0%';button.textContent='Réessayer';button.onclick=()=>{el.remove();sendDirect(file,eventId)}}}}

// ----- Aperçu WEBP (orientation appliquée), largeur max = réglage du serveur -----
// source : un fichier image, ou { bmp, orientation } extrait d'un RAW (orientation EXIF 1 à 8).
async function makePreview(source,max){const{bmp,orientation=1}=source instanceof Blob?{bmp:await createImageBitmap(source,{imageOrientation:'from-image'})}:source;
const swap=orientation>=5&&orientation<=8;const w=swap?bmp.height:bmp.width,h=swap?bmp.width:bmp.height;const k=Math.min(1,max/Math.max(w,h));const c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);const ctx=c.getContext('2d');const W=c.width,H=c.height;
const m={2:[-1,0,0,1,W,0],3:[-1,0,0,-1,W,H],4:[1,0,0,-1,0,H],5:[0,1,1,0,0,0],6:[0,1,-1,0,W,0],7:[0,-1,-1,0,W,H],8:[0,-1,1,0,0,H]}[orientation];if(m)ctx.transform(...m);ctx.drawImage(bmp,0,0,swap?H:W,swap?W:H);bmp.close?.();
let blob=await new Promise(r=>c.toBlob(r,'image/webp',0.82));if(!blob||blob.type!=='image/webp')blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.85));if(!blob)throw Error('Aperçu impossible pour cette image.');return blob}
