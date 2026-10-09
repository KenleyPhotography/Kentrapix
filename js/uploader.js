// Import avec vraie progression réseau, 3 photos en parallèle au maximum.
// Photos en ligne (service.data.upload.direct) : le navigateur prépare l'aperçu puis envoie original + aperçu
// directement au bucket via des adresses signées ; le serveur n'enregistre que la fiche de la photo.
// Galerie en mode sélection : seul l'aperçu compressé est envoyé (l'original reste sur l'ordinateur).
// Fichiers RAW (mode sélection uniquement) : le JPEG pleine taille enregistré par l'appareil dans le RAW est extrait ici.
import{service,escape}from'./service.js';
const PARALLEL=3;
const DIRECT=['image/jpeg','image/png','image/webp','image/avif'];
const RAW_EXT=['cr2','cr3','crw','nef','nrw','arw','srf','sr2','dng','raf','orf','rw2','rwl','pef','srw','x3f','3fr','iiq','erf','kdc','mrw','raw'];
const isRaw=f=>RAW_EXT.includes(f.name.split('.').pop().toLowerCase());
const eventOf=id=>service.data.events.find(e=>e.id===id);
const mbOf=b=>(b/1024/1024).toFixed(2)+' Mo';
export function bindUploader(toast){const input=document.getElementById('files'),drop=document.getElementById('drop'),select=document.getElementById('upload-event');if(!input)return;
const hint=()=>{const sel=eventOf(select.value)?.selectionMode;input.accept=sel?['image/*',...RAW_EXT.map(e=>'.'+e)].join(','):'image/*';const h=document.getElementById('upload-hint');if(h)h.textContent=sel?'Galerie en mode sélection : photos compressées avant l’envoi, RAW acceptés (CR2, CR3, NEF, ARW, DNG…). Les originaux restent sur votre ordinateur.':'Photos envoyées en qualité originale (JPG, PNG, WEBP ou AVIF).'};hint();select.addEventListener('change',hint);
document.getElementById('browse').onclick=()=>input.click();input.onchange=()=>{upload([...input.files]);input.value=''};drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag')};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');upload([...e.dataTransfer.files])};
function upload(files){const eventId=select.value;const selection=!!eventOf(eventId)?.selectionMode;const direct=!!service.data.upload?.direct;const queue=files.filter(f=>{if(isRaw(f)){if(selection)return true;toast(f.name+' : les fichiers RAW sont acceptés seulement dans une galerie en mode sélection.');return false}if(!f.type.startsWith('image/')){toast(f.name+' : choisissez une image.');return false}if(direct&&!selection&&!DIRECT.includes(f.type)){toast(f.name+' : format non pris en charge (JPG, PNG, WEBP ou AVIF).');return false}return true}).map(f=>()=>direct?sendDirect(f,eventId):send(f,eventId,selection));const worker=async()=>{while(queue.length)await queue.shift()()};for(let i=0;i<PARALLEL;i++)worker()}
function row(file){const el=document.createElement('div');el.className='upload-row';el.innerHTML=`<div class="progress"><strong>${escape(file.name)}</strong><p class="small">${mbOf(file.size)}</p><div class="progress-bar"><span style="width:0%"></span></div></div><button class="btn">Annuler</button>`;document.getElementById('upload-list')?.append(el);return{el,bar:el.querySelector('span'),status:el.querySelector('p'),button:el.querySelector('button')}}
// ----- Envoi au serveur (stockage local) ; mode sélection : aperçu compressé seulement -----
async function send(file,eventId,selection){const{el,bar,status,button}=row(file);let body=file;if(selection||isRaw(file)){try{status.textContent='Compression…';body=await makePreview(isRaw(file)?await rawImage(file):file,service.data.upload?.previewWidth||1600);status.textContent=`${mbOf(file.size)} → ${mbOf(body.size)}`}catch(err){status.textContent=err.message;button.textContent='Fermer';button.onclick=()=>el.remove();return}}
return new Promise(done=>{const xhr=new XMLHttpRequest();const fail=msg=>{status.textContent=msg;bar.style.width='0%';button.textContent='Réessayer';button.onclick=()=>{el.remove();send(file,eventId,selection)};done()};button.onclick=()=>{xhr.abort();el.remove();done()};xhr.upload.onprogress=e=>{if(e.lengthComputable)bar.style.width=Math.min(95,e.loaded/e.total*100)+'%'};xhr.onload=()=>{let res={};try{res=JSON.parse(xhr.responseText)}catch{}if(xhr.status>=200&&xhr.status<300){service.data.photos.push(res.photo);bar.style.width='100%';status.textContent='Importée';button.remove();done()}else fail(res.error||'Échec de l’import')};xhr.onerror=()=>fail('Connexion perdue');const form=new FormData();form.append('photo',body,file.name);xhr.open('POST',`/api/admin/events/${encodeURIComponent(eventId)}/photos`);xhr.send(form)})}
// ----- Envoi direct au bucket (photos en ligne) -----
const post=async(url,body)=>{const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Échec de l’import');return j};
function put(url,headers,body,onProgress,signal){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',url);for(const[k,v]of Object.entries(headers))xhr.setRequestHeader(k,v);xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(e.loaded/e.total)};xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error(`Envoi refusé par le stockage (${xhr.status})`));xhr.onerror=()=>reject(Error('Connexion perdue'));signal.onabort=()=>{xhr.abort();reject(Error('Annulé'))};xhr.send(body)})}
async function sendDirect(file,eventId){const{el,bar,status,button}=row(file);const ctrl={aborted:false,onabort:null};const base=`/api/admin/events/${encodeURIComponent(eventId)}/uploads`;button.onclick=()=>{ctrl.aborted=true;ctrl.onabort?.();el.remove()};
try{status.textContent='Préparation…';const t=await post(base,{filename:file.name,type:file.type.slice(0,40),size:file.size});if(t.previewOnly)status.textContent='Compression…';const preview=await makePreview(isRaw(file)?await rawImage(file):file,t.previewWidth);if(ctrl.aborted)return;
if(t.previewOnly){status.textContent=`${mbOf(file.size)} → ${mbOf(preview.size)} (compressée)`;await put(t.preview.url,t.preview.headers,preview,p=>bar.style.width=Math.min(90,p*90)+'%',ctrl)}
else{status.textContent=mbOf(file.size);await put(t.original.url,t.original.headers,file,p=>bar.style.width=Math.min(90,p*90)+'%',ctrl);await put(t.preview.url,t.preview.headers,preview,null,ctrl)}bar.style.width='95%';
const r=await post(`${base}/complete`,{id:t.id,ext:t.ext,ticket:t.ticket,filename:file.name,type:file.type.slice(0,40),size:file.size,previewOnly:!!t.previewOnly});service.data.photos.push(r.photo);bar.style.width='100%';status.textContent=t.previewOnly?`Importée — ${mbOf(preview.size)}`:'Importée';button.remove()}
catch(err){if(ctrl.aborted)return;status.textContent=err.message;bar.style.width='0%';button.textContent='Réessayer';button.onclick=()=>{el.remove();sendDirect(file,eventId)}}}}

// ----- Aperçu WEBP (orientation appliquée), largeur max = réglage du serveur -----
// source : un fichier image, ou { bmp, orientation } extrait d'un RAW (orientation EXIF 1 à 8).
async function makePreview(source,max){const{bmp,orientation=1}=source instanceof Blob?{bmp:await createImageBitmap(source,{imageOrientation:'from-image'})}:source;
const swap=orientation>=5&&orientation<=8;const w=swap?bmp.height:bmp.width,h=swap?bmp.width:bmp.height;const k=Math.min(1,max/Math.max(w,h));const c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);const ctx=c.getContext('2d');const W=c.width,H=c.height;
const m={2:[-1,0,0,1,W,0],3:[-1,0,0,-1,W,H],4:[1,0,0,-1,0,H],5:[0,1,1,0,0,0],6:[0,1,-1,0,W,0],7:[0,-1,-1,0,W,H],8:[0,-1,1,0,0,H]}[orientation];if(m)ctx.transform(...m);ctx.drawImage(bmp,0,0,swap?H:W,swap?W:H);bmp.close?.();
let blob=await new Promise(r=>c.toBlob(r,'image/webp',0.82));if(!blob||blob.type!=='image/webp')blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.85));if(!blob)throw Error('Aperçu impossible pour cette image.');return blob}

// ----- RAW : JPEG intégré le plus grand + orientation de l'en-tête TIFF (CR2, NEF, ARW, DNG, ORF, RW2…) -----
async function rawImage(file){const b=new Uint8Array(await file.arrayBuffer());const found=[];
for(let i=0;i<b.length-3;i++){if(b[i]===0xFF&&b[i+1]===0xD8&&b[i+2]===0xFF){const j=jpegAt(b,i);if(j){found.push(j);i=j.end-1}}}
found.sort((x,y)=>y.w*y.h-x.w*x.h);const orientation=rawOrientation(b);
for(const j of found){try{const bmp=await createImageBitmap(new Blob([b.subarray(j.start,j.end)],{type:'image/jpeg'}),{imageOrientation:orientation?'none':'from-image'});return{bmp,orientation:orientation||1}}catch{}}
throw Error('Aucune image lisible dans ce fichier RAW.')}
// Parcourt les segments d'un JPEG commençant à s ; renvoie ses bornes et sa taille, ou null (données RAW, JPEG sans perte…).
function jpegAt(b,s){let i=s+2,w=0,h=0;while(i+4<=b.length){if(b[i]!==0xFF)return null;const m=b[i+1];if(m===0xFF){i++;continue}if(m===0xD9)return w?{start:s,end:i+2,w,h}:null;if((m>=0xD0&&m<=0xD7)||m===0x01){i+=2;continue}const len=b[i+2]<<8|b[i+3];if(len<2)return null;
if(m>=0xC0&&m<=0xCF&&m!==0xC4&&m!==0xC8&&m!==0xCC){if(m===0xC3||m===0xC7||m===0xCB||m===0xCF)return null;h=b[i+5]<<8|b[i+6];w=b[i+7]<<8|b[i+8]}i+=2+len;
if(m===0xDA)while(i+1<b.length&&!(b[i]===0xFF&&b[i+1]!==0x00&&!(b[i+1]>=0xD0&&b[i+1]<=0xD7)))i++}return null}
// Orientation (balise 0x0112) dans le premier répertoire TIFF : en tête du fichier (CR2, NEF, ARW, DNG…)
// ou dans la boîte CMT1 des CR3. 0 si introuvable (RAF… : l'orientation EXIF du JPEG intégré est alors utilisée).
function rawOrientation(b){const t=tiffOrientation(b,0);if(t)return t;const head=b.subarray(0,Math.min(b.length,1<<16));for(let i=0;i<head.length-8;i++)if(head[i]===0x43&&head[i+1]===0x4D&&head[i+2]===0x54&&head[i+3]===0x31)return tiffOrientation(b,i+4);return 0}
function tiffOrientation(b,base){const le=b[base]===0x49&&b[base+1]===0x49;if(!le&&!(b[base]===0x4D&&b[base+1]===0x4D))return 0;const u16=o=>le?b[base+o]|b[base+o+1]<<8:b[base+o]<<8|b[base+o+1];const u32=o=>(le?b[base+o]|b[base+o+1]<<8|b[base+o+2]<<16|b[base+o+3]<<24:b[base+o]<<24|b[base+o+1]<<16|b[base+o+2]<<8|b[base+o+3])>>>0;
const ifd=u32(4);if(base+ifd+2>b.length)return 0;const n=u16(ifd);for(let k=0;k<n;k++){const e=ifd+2+k*12;if(base+e+12>b.length)break;if(u16(e)===0x0112){const o=u16(e+8);return o>=1&&o<=8?o:0}}return 0}
