// Photos débloquées pour le client : saisie de numéros (« 1-10, 15, 20-25 ») OU choix dans la liste des photos.
// Les deux restent synchronisés. Tout est dans une section repliable pour ne pas allonger la fenêtre de la galerie.
import { escape } from './service.js';

/** « 1-10, 15 » -> Set { 1..10, 15 } (les valeurs invalides sont ignorées pendant la frappe). */
export function parseNums(text) {
  const set = new Set();
  for (const part of String(text || '').split(/[,;]/)) {
    const m = part.trim().match(/^(\d+)\s*[–-]\s*(\d+)$/) || part.trim().match(/^(\d+)$/);
    if (!m) continue;
    let a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (a > b) [a, b] = [b, a];
    for (let n = Math.max(1, a); n <= Math.min(b, 100000); n++) set.add(n);
  }
  return set;
}

/** Set { 1..10, 15 } -> « 1-10, 15 » */
export function fmtNums(set) {
  const nums = [...set].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]));
    i = j;
  }
  return out.join(', ');
}

const summaryText = (mode, set, total) => (mode === 'all' ? 'Toutes' : set.size ? `${Math.min(set.size, total)} sur ${total}` : 'Aucune');

/** Section repliable (fermée par défaut) à insérer dans la fenêtre de modification d'une galerie. */
export function unlockSection(e, photos) {
  const all = e.unlockNumbers == null;
  const set = parseNums(e.unlockNumbers || '');
  return `<details class="acc" id="acc-unlock">
    <summary><span>Photos visibles par le client</span><small id="unlock-sum">${escape(summaryText(all ? 'all' : 'some', set, photos.length))}</small></summary>
    <div class="acc-body">
      <div class="opt-row" role="radiogroup" aria-label="Photos visibles">
        <label class="opt"><input type="radio" name="unlockMode" value="all" ${all ? 'checked' : ''}><span>Toutes les photos</span></label>
        <label class="opt"><input type="radio" name="unlockMode" value="some" ${all ? '' : 'checked'}><span>Seulement certaines photos</span></label>
      </div>
      <div id="unlock-some" ${all ? 'hidden' : ''}>
        <label>Numéros à débloquer
          <input name="unlockNumbers" id="unlock-nums" value="${escape(e.unlockNumbers || '')}" placeholder="Ex. 1-10, 15, 20-25" autocomplete="off" inputmode="numeric">
          <small class="field-hint">Séparez les numéros par des virgules ; un tiret pour une série (1-10). Vide = aucune photo.</small>
        </label>
        <button type="button" class="btn sm" id="unlock-open-pick" ${photos.length ? '' : 'disabled'}>Choisir dans la liste des photos (${photos.length})</button>
        <div id="unlock-pick" hidden>
          <div class="up-tools"><button type="button" class="text-link" data-up="all">Tout cocher</button><button type="button" class="text-link" data-up="none">Aucune</button><button type="button" class="text-link" data-up="invert">Inverser</button><span id="up-count"></span></div>
          <div class="up-grid" id="up-grid"></div>
        </div>
        <label>Photos non débloquées
          <select name="lockMode"><option value="locked" ${e.lockMode !== 'hidden' ? 'selected' : ''}>Visibles mais verrouillées</option><option value="hidden" ${e.lockMode === 'hidden' ? 'selected' : ''}>Cachées</option></select>
        </label>
        <label>Flou des photos verrouillées
          <select name="lockBlur"><option value="2.5" ${Number(e.lockBlur) === 2.5 || !e.lockBlur ? 'selected' : ''}>Léger (2.5) — on devine bien la photo</option><option value="6" ${Number(e.lockBlur) === 6 ? 'selected' : ''}>Moyen (6)</option><option value="12" ${Number(e.lockBlur) === 12 ? 'selected' : ''}>Fort (12) — presque illisible</option></select>
          <small class="field-hint">Sert seulement aux photos « visibles mais verrouillées » : une version réduite et floue, jamais la vraie photo.</small>
        </label>
        <label>Message pour le client <span class="optional">(facultatif)</span>
          <input name="lockReason" maxlength="300" value="${escape(e.lockReason || '')}" placeholder="Ex. Disponibles après le paiement du solde">
          <small class="field-hint">Explique au client pourquoi il ne peut pas ouvrir les autres photos.</small>
        </label>
      </div>
    </div>
  </details>`;
}

/** Relie la section (à appeler juste après l'ouverture de la fenêtre). */
export function bindUnlock(photos) {
  const host = document.getElementById('overlays');
  const nums = host.querySelector('#unlock-nums');
  if (!nums) return;
  const some = host.querySelector('#unlock-some'), sum = host.querySelector('#unlock-sum'), pick = host.querySelector('#unlock-pick'), grid = host.querySelector('#up-grid'), count = host.querySelector('#up-count');
  const total = photos.length;
  const mode = () => host.querySelector('input[name="unlockMode"]:checked')?.value || 'all';
  const sorted = [...photos].sort((a, b) => a.number - b.number);

  const refresh = () => {
    const set = parseNums(nums.value);
    sum.textContent = summaryText(mode(), set, total);
    if (grid.childElementCount) {
      grid.querySelectorAll('input').forEach((c) => { c.checked = set.has(Number(c.value)); });
      count.textContent = `${[...set].filter((n) => n <= total).length} / ${total} cochées`;
    }
  };
  host.querySelectorAll('input[name="unlockMode"]').forEach((r) => { r.onchange = () => { some.hidden = mode() === 'all'; refresh(); }; });
  nums.addEventListener('input', refresh);

  host.querySelector('#unlock-open-pick')?.addEventListener('click', () => {
    // La grille n'est construite qu'à la première ouverture : la fenêtre s'ouvre vite même avec des centaines de photos.
    if (!grid.childElementCount) {
      grid.innerHTML = sorted.map((p) => `<label class="up-tile"><input type="checkbox" value="${p.number}"><img src="${escape(p.thumb || p.preview)}" alt="Photo ${p.number}" loading="lazy" decoding="async"><span>${p.number}</span></label>`).join('');
      grid.onchange = () => {
        const set = new Set([...grid.querySelectorAll('input:checked')].map((c) => Number(c.value)));
        nums.value = fmtNums(set);
        refresh();
      };
    }
    pick.hidden = !pick.hidden;
    refresh();
  });
  pick.querySelectorAll('[data-up]').forEach((b) => {
    b.onclick = () => {
      const cur = new Set([...grid.querySelectorAll('input:checked')].map((c) => Number(c.value)));
      const all = sorted.map((p) => p.number);
      const next = b.dataset.up === 'all' ? new Set(all) : b.dataset.up === 'none' ? new Set() : new Set(all.filter((n) => !cur.has(n)));
      nums.value = fmtNums(next);
      refresh();
    };
  });
  refresh();
}

/**
 * Choix de photos réutilisable (partage famille…) : « Toutes » ou « Seulement certaines » par numéros
 * ou en cochant dans la liste. Champs : name="shareMode" (all|some) et name="shareNumbers".
 */
export function photoPickerHtml(photos) {
  return `<div class="opt-row" role="radiogroup" aria-label="Photos à partager">
      <label class="opt"><input type="radio" name="shareMode" value="all" checked><span>Toutes les photos</span></label>
      <label class="opt"><input type="radio" name="shareMode" value="some"><span>Seulement certaines</span></label>
    </div>
    <div id="sp-some" hidden>
      <label>Numéros à partager
        <input name="shareNumbers" id="sp-nums" placeholder="Ex. 1-10, 15, 20-25" autocomplete="off" inputmode="numeric">
        <small class="field-hint">Séparez par des virgules ; un tiret pour une série (1-10).</small>
      </label>
      <button type="button" class="btn sm" id="sp-open" ${photos.length ? '' : 'disabled'}>Choisir dans la liste (${photos.length})</button>
      <div id="sp-pick" hidden>
        <div class="up-tools"><button type="button" class="text-link" data-sp="all">Tout cocher</button><button type="button" class="text-link" data-sp="none">Aucune</button><button type="button" class="text-link" data-sp="invert">Inverser</button><span id="sp-count"></span></div>
        <div class="up-grid" id="sp-grid"></div>
      </div>
    </div>`;
}

export function bindPhotoPicker(photos) {
  const host = document.getElementById('overlays');
  const nums = host.querySelector('#sp-nums');
  if (!nums) return;
  const some = host.querySelector('#sp-some'), pick = host.querySelector('#sp-pick'), grid = host.querySelector('#sp-grid'), count = host.querySelector('#sp-count'), sum = host.querySelector('#sp-sum');
  const total = photos.length;
  const sorted = [...photos].sort((a, b) => a.number - b.number);
  const mode = () => host.querySelector('input[name="shareMode"]:checked')?.value || 'all';
  const refresh = () => {
    const set = parseNums(nums.value);
    if (sum) sum.textContent = mode() === 'all' ? 'Toutes' : set.size ? `${Math.min(set.size, total)} sur ${total}` : 'Aucune choisie';
    if (grid.childElementCount) {
      grid.querySelectorAll('input').forEach((c) => { c.checked = set.has(Number(c.value)); });
      count.textContent = `${[...set].filter((n) => n <= total).length} / ${total} cochées`;
    }
  };
  host.querySelectorAll('input[name="shareMode"]').forEach((r) => { r.onchange = () => { some.hidden = mode() === 'all'; refresh(); }; });
  nums.addEventListener('input', refresh);
  host.querySelector('#sp-open')?.addEventListener('click', () => {
    if (!grid.childElementCount) {
      grid.innerHTML = sorted.map((p) => `<label class="up-tile"><input type="checkbox" value="${p.number}"><img src="${escape(p.thumb || p.preview)}" alt="Photo ${p.number}" loading="lazy" decoding="async"><span>${p.number}</span></label>`).join('');
      grid.onchange = () => { nums.value = fmtNums(new Set([...grid.querySelectorAll('input:checked')].map((c) => Number(c.value)))); refresh(); };
    }
    pick.hidden = !pick.hidden;
    refresh();
  });
  pick.querySelectorAll('[data-sp]').forEach((b) => {
    b.onclick = () => {
      const cur = new Set([...grid.querySelectorAll('input:checked')].map((c) => Number(c.value)));
      const all = sorted.map((p) => p.number);
      nums.value = fmtNums(b.dataset.sp === 'all' ? new Set(all) : b.dataset.sp === 'none' ? new Set() : new Set(all.filter((n) => !cur.has(n))));
      refresh();
    };
  });
  refresh();
}
