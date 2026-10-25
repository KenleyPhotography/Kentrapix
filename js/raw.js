// Fichiers RAW des appareils photo (NEF, CR2, CR3, ARW, DNG…). Le navigateur ne sait pas les développer,
// mais l'appareil enregistre dedans un JPEG déjà développé, presque toujours en pleine taille : c'est lui
// qui est extrait ici, puis utilisé comme photo, comme original téléchargeable ou comme couverture.
// Le RAW lui-même reste sur l'ordinateur du photographe. Même extraction côté serveur : server/src/lib/raw.js.
export const RAW_EXT=['cr2','cr3','crw','nef','nrw','arw','srf','sr2','dng','raf','orf','rw2','rwl','pef','srw','x3f','3fr','iiq','erf','kdc','mrw','raw'];
export const isRaw=f=>RAW_EXT.includes(String(f?.name??f).split('.').pop().toLowerCase());
// DSC_0001.NEF -> DSC_0001.jpg : le fichier enregistré est le JPEG extrait, pas le RAW.
export const jpgName=n=>n.replace(/\.[^.]*$/,'')+'.jpg';
// Valeur de l'attribut accept d'un champ « photo » : images du navigateur + RAW.
export const ACCEPT_PHOTO=['image/*',...RAW_EXT.map(e=>'.'+e)].join(',');

// ----- RAW : JPEG intégré le plus grand + orientation de l'en-tête TIFF (CR2, NEF, ARW, DNG, ORF, RW2…) -----
// Renvoie { file, bmp, orientation } : le JPEG extrait (nom en .jpg, orientation gravée dedans) et son image décodée.
export async function rawImage(file){const b=new Uint8Array(await file.arrayBuffer());const found=[];
for(let i=0;i<b.length-3;i++){if(b[i]===0xFF&&b[i+1]===0xD8&&b[i+2]===0xFF){const j=jpegAt(b,i);if(j){found.push(j);i=j.end-1}}}
found.sort((x,y)=>y.w*y.h-x.w*x.h);const tiff=rawOrientation(b);
// JPEG intégré livré avec son propre EXIF : on le laisse intact et c'est lui qui décide du sens.
// Sinon (le cas courant), l'orientation vient de l'en-tête TIFF du RAW et on la grave dans le JPEG.
for(const j of found){const bytes=b.subarray(j.start,j.end);const o=hasExif(bytes)?0:tiff;
try{const bmp=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}),{imageOrientation:o?'none':'from-image'});
return{file:new File([o>1?withOrientation(bytes,o):bytes],jpgName(file.name),{type:'image/jpeg'}),bmp,orientation:o||1}}catch{}}
throw Error('Aucune image lisible dans ce fichier RAW.')}
// true si ce JPEG porte déjà un bloc EXIF.
function hasExif(b){let i=2;while(i+4<=b.length&&b[i]===0xFF){const m=b[i+1];if(m===0xDA||m===0xD9)return false;
if(m===0xE1&&b[i+4]===0x45&&b[i+5]===0x78&&b[i+6]===0x69&&b[i+7]===0x66)return true;
const len=b[i+2]<<8|b[i+3];if(len<2)return false;i+=2+len}return false}
// Grave l'orientation dans le JPEG extrait (bloc EXIF minimal ajouté au début, aucune recompression) :
// l'original téléchargé par le client s'affiche alors dans le bon sens.
function withOrientation(bytes,orientation){const tiff=new Uint8Array(26);const dv=new DataView(tiff.buffer);
tiff[0]=tiff[1]=0x49;dv.setUint16(2,42,true);dv.setUint32(4,8,true);dv.setUint16(8,1,true);
dv.setUint16(10,0x0112,true);dv.setUint16(12,3,true);dv.setUint32(14,1,true);dv.setUint16(18,orientation,true);
const head=new Uint8Array([0x45,0x78,0x69,0x66,0,0]);const len=head.length+tiff.length+2;
const out=new Uint8Array(2+2+len+bytes.length-2);let p=0;
out.set(bytes.subarray(0,2),p);p+=2;out.set([0xFF,0xE1,len>>8,len&0xFF],p);p+=4;out.set(head,p);p+=head.length;out.set(tiff,p);p+=tiff.length;out.set(bytes.subarray(2),p);
return out}
// Parcourt les segments d'un JPEG commençant à s ; renvoie ses bornes et sa taille, ou null (données RAW, JPEG sans perte…).
function jpegAt(b,s){let i=s+2,w=0,h=0;while(i+2<=b.length){if(b[i]!==0xFF)return null;const m=b[i+1];if(m===0xFF){i++;continue}if(m===0xD9)return w?{start:s,end:i+2,w,h}:null;if((m>=0xD0&&m<=0xD7)||m===0x01){i+=2;continue}if(i+4>b.length)return null;const len=b[i+2]<<8|b[i+3];if(len<2)return null;
if(m>=0xC0&&m<=0xCF&&m!==0xC4&&m!==0xC8&&m!==0xCC){if(m===0xC3||m===0xC7||m===0xCB||m===0xCF)return null;h=b[i+5]<<8|b[i+6];w=b[i+7]<<8|b[i+8]}i+=2+len;
if(m===0xDA)while(i+1<b.length&&!(b[i]===0xFF&&b[i+1]!==0x00&&!(b[i+1]>=0xD0&&b[i+1]<=0xD7)))i++}return null}
// Orientation (balise 0x0112) dans le premier répertoire TIFF : en tête du fichier (CR2, NEF, ARW, DNG…)
// ou dans la boîte CMT1 des CR3. 0 si introuvable (RAF… : l'orientation EXIF du JPEG intégré est alors utilisée).
function rawOrientation(b){const t=tiffOrientation(b,0);if(t)return t;const head=b.subarray(0,Math.min(b.length,1<<16));for(let i=0;i<head.length-8;i++)if(head[i]===0x43&&head[i+1]===0x4D&&head[i+2]===0x54&&head[i+3]===0x31)return tiffOrientation(b,i+4);return 0}
function tiffOrientation(b,base){const le=b[base]===0x49&&b[base+1]===0x49;if(!le&&!(b[base]===0x4D&&b[base+1]===0x4D))return 0;const u16=o=>le?b[base+o]|b[base+o+1]<<8:b[base+o]<<8|b[base+o+1];const u32=o=>(le?b[base+o]|b[base+o+1]<<8|b[base+o+2]<<16|b[base+o+3]<<24:b[base+o]<<24|b[base+o+1]<<16|b[base+o+2]<<8|b[base+o+3])>>>0;
const ifd=u32(4);if(base+ifd+2>b.length)return 0;const n=u16(ifd);for(let k=0;k<n;k++){const e=ifd+2+k*12;if(base+e+12>b.length)break;if(u16(e)===0x0112){const o=u16(e+8);return o>=1&&o<=8?o:0}}return 0}
