// Signature électronique du photographe : dessinée une fois, puis apposée sur ses contrats et ses factures.
import { api, escape } from './service.js';

export async function loadMySignature() {
  return (await api('/api/admin/contracts/signature')).signature || null;
}

/** Fenêtre de dessin : enregistre la signature (PNG) puis appelle onSaved(dataUrl). */
export function openSignatureModal({ modal, toast, current = null, onSaved }) {
  modal('Ma signature', `<p class="small">Dessinez votre signature avec le doigt ou la souris. Elle sera apposée sur vos contrats et vos factures.</p>
    ${current ? `<p class="small">Signature actuelle :</p><img src="${escape(current)}" alt="" style="max-height:70px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:4px">` : ''}
    <canvas id="sig-pad" style="display:block;width:100%;height:170px;border:2px dashed #8db6ee;border-radius:12px;background:#fff;touch-action:none;cursor:crosshair"></canvas>
    <button type="button" class="btn sm" id="sig-pad-clear">Effacer</button>`,
  async () => {
    if (ink < 60) throw new Error('Dessinez votre signature dans le cadre.');
    const r = await api('/api/admin/contracts/signature', { method: 'PUT', body: { signature: canvas.toDataURL('image/png') } });
    toast('Signature enregistrée.');
    onSaved?.(r.signature);
  }, { submit: 'Enregistrer ma signature' });
  const canvas = document.getElementById('sig-pad');
  const ctx = canvas.getContext('2d');
  const r = canvas.getBoundingClientRect(), ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * ratio); canvas.height = Math.round(r.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#082445';
  let ink = 0, last = null;
  const pos = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); last = pos(e); ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, 6.3); ctx.fillStyle = '#082445'; ctx.fill(); ink += 2; });
  canvas.addEventListener('pointermove', (e) => { if (!last) return; e.preventDefault(); const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ink += Math.abs(p.x - last.x) + Math.abs(p.y - last.y); last = p; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, () => { last = null; }));
  document.getElementById('sig-pad-clear').onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ink = 0; };
}
