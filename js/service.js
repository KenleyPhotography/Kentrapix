// Client de l'API KentraPix (backend Node.js + PostgreSQL, dossier server/).
export const image=(id,w=1100)=>`https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=85`;
// Mise à jour / redémarrage du serveur : les appels reprennent tout seuls (jusqu'à ~1 min) au lieu d'afficher une erreur.
const RETRIES=12;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const banner=()=>{}; // les nouvelles tentatives se font sans rien afficher
export async function api(path,{method='GET',body,form}={}){const opts={method,credentials:'same-origin',headers:{Accept:'application/json'}};if(form)opts.body=form;else if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body)}let res;for(let n=0;;n++){try{res=await fetch(path,opts);if(![502,503,504].includes(res.status)||n>=RETRIES)break}catch{if(method==='POST'||n>=RETRIES){banner(false);throw Error('Connexion au serveur impossible. Vérifiez votre connexion.')}}banner(true);await sleep(Math.min(8000,1000*(n+1)))}banner(false);if(res.status===401&&!path.startsWith('/api/auth/')){location.href='/login';throw Error('Session expirée.')}if(res.status===204)return null;
// Page ouverte sans le serveur KentraPix (ex. Live Server sur le port 5500) : pas d'API JSON.
if(!(res.headers.get('content-type')||'').includes('application/json'))throw Error('Connexion impossible pour le moment. Réessayez dans un instant.');
const data=await res.json().catch(()=>({}));if(!res.ok){if(data.locked&&location.pathname.includes('admin')){location.reload();throw Error(data.error)}throw Error(data.error||'Une erreur est survenue.')}return data}
const data={clients:[],events:[],photos:[],favorites:[],downloads:[],permissions:{},activity:[],stats:{storageBytes:0},selections:{}};
export const service={data,readOnly:false,async load(role){Object.assign(data,await api(role==='admin'?'/api/admin/bootstrap':'/api/client/bootstrap'))},
// Aperçu admin : l'espace d'un client, sans rien enregistrer en son nom.
async loadPreview(clientId){const r=await api(`/api/admin/clients/${encodeURIComponent(clientId)}/preview`);Object.assign(data,r);this.readOnly=true;return r},photos(eventId){return data.photos.filter(p=>!eventId||p.eventId===eventId)},
// Mode sélection : liste des photos choisies par galerie, enregistrée sur le serveur à chaque changement (dans l'ordre des clics).
picks(eventId){return data.selections?.[eventId]?.photoIds||[]},
setPicks(eventId,ids){if(this.readOnly)return Promise.reject(Error('Aperçu : la sélection n’est pas modifiable.'));const ev=data.events.find(e=>e.id===eventId);const list=[...new Set(ids)];if(ev?.selectionLimit&&list.length>ev.selectionLimit)return Promise.reject(Error(`Vous pouvez choisir ${ev.selectionLimit} photos au maximum.`));const sel=data.selections[eventId]||(data.selections[eventId]={photoIds:[],note:'',submittedAt:null});const before=sel.photoIds;sel.photoIds=list;this._queue=(this._queue||Promise.resolve()).catch(()=>{}).then(()=>api(`/api/client/events/${eventId}/selection`,{method:'PUT',body:{photoIds:sel.photoIds}})).catch(e=>{sel.photoIds=before;throw e});return this._queue},
setNote(eventId,photoId,text){if(this.readOnly)return Promise.resolve();const sel=data.selections[eventId];if(!sel)return Promise.resolve();(sel.notes||(sel.notes={}))[photoId]=text;clearTimeout(this._noteT);this._pending=Object.assign(this._pending||{},{[eventId]:Object.assign((this._pending||{})[eventId]||{},{[photoId]:text})});return new Promise((res,rej)=>{this._noteT=setTimeout(()=>this.flushNotes().then(res,rej),600)})},
flushNotes(){clearTimeout(this._noteT);const p=this._pending||{};this._pending={};return Promise.all(Object.entries(p).map(([eventId,notes])=>api(`/api/client/events/${eventId}/selection/notes`,{method:'PUT',body:{notes}})))},
togglePick(eventId,photoId){const ids=this.picks(eventId);return this.setPicks(eventId,ids.includes(photoId)?ids.filter(i=>i!==photoId):[...ids,photoId])},
// Favori optimiste : l'écran change tout de suite, et revient en arrière si le serveur refuse.
async toggleFavorite(id){if(this.readOnly)throw Error('Aperçu : les favoris ne sont pas enregistrés.');const on=data.favorites.includes(id);const flip=()=>{const n=data.favorites.indexOf(id);n<0?data.favorites.push(id):data.favorites.splice(n,1)};flip();try{await api(`/api/client/favorites/${id}`,{method:on?'DELETE':'PUT'})}catch(e){flip();throw e}}};
export const date=d=>new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{month:'short',day:'numeric',year:'numeric'});
export const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Salutation du moment : « Bonjour » le matin, « Bonsoir » à partir de midi (heure de l'appareil).
export const hello=()=>new Date().getHours()>=12?'Bonsoir':'Bonjour';
