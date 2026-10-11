// Photos débloquées pour le client : liste de numéros du type « 1-10, 15, 20-25 » (numéro = place de la photo dans la galerie).
// Règle d'une galerie : unlock_numbers (texte) si présent, sinon unlock_limit (« les N premières »), sinon toutes les photos.
// unlock_numbers = '' (vide) signifie « aucune photo débloquée ».

const cache = new Map();

/** « 1-10, 15 » -> [[1,10],[15,15]] (trié, fusionné). Lève une erreur si le texte n'est pas valide. */
export function parseRanges(text) {
  const str = String(text ?? '').trim();
  if (cache.has(str)) return cache.get(str);
  if (!/^[\d\s,;–-]*$/.test(str)) throw new Error('Numéros invalides : utilisez des chiffres, des virgules et des tirets (ex. 1-10, 15, 20-25).');
  const ranges = [];
  for (const part of str.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[–-]\s*(\d+)$/) || part.match(/^(\d+)$/);
    if (!m) throw new Error(`Numéro invalide : « ${part} ». Exemple : 1-10, 15, 20-25.`);
    let a = Number(m[1]);
    let b = Number(m[2] ?? m[1]);
    if (a < 1 || b < 1 || a > 100000 || b > 100000) throw new Error('Les numéros de photos vont de 1 à 100000.');
    if (a > b) [a, b] = [b, a];
    ranges.push([a, b]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  if (cache.size > 500) cache.clear();
  cache.set(str, merged);
  return merged;
}

/** [[1,10],[15,15]] -> « 1-10, 15 » */
export const formatRanges = (ranges) => ranges.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(', ');

/** Texte propre pour la base (fusionné, trié). */
export const normalizeNumbers = (text) => formatRanges(parseRanges(text));

/** La photo n° `number` de la galerie `e` est-elle ouverte au client ? (e : ligne de la table events ou jointure) */
export function isOpen(e, number) {
  if (e.unlock_numbers != null) return parseRanges(e.unlock_numbers).some(([a, b]) => number >= a && number <= b);
  if (e.unlock_limit != null) return Number(number) <= Number(e.unlock_limit);
  return true;
}

/** Texte à montrer au photographe / client : « 1-10, 15 », '' (aucune) ou null (toutes). */
export const effectiveNumbers = (e) => (e.unlock_numbers != null ? e.unlock_numbers : e.unlock_limit != null ? (Number(e.unlock_limit) > 0 ? `1-${e.unlock_limit}` : '') : null);
