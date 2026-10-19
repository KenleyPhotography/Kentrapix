// Photos du portfolio : stockées dans le dépôt GitHub (branche dédiée, jamais déployée), via l'API « contents ».
import { config } from '../config.js';

const gh = () => config.github;
const API = 'https://api.github.com';

export const githubReady = () => !!gh().token;

async function call(method, path, body, accept = 'application/vnd.github+json') {
  return fetch(`${API}/repos/${gh().repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${gh().token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'KentraPix',
      Accept: accept,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let branchReady = false;
/** Crée la branche des photos (à partir de la branche principale) si elle n'existe pas encore. */
async function ensureBranch() {
  if (branchReady) return;
  const have = await call('GET', `/git/ref/heads/${gh().branch}`);
  if (have.status === 404) {
    const base = await call('GET', `/git/ref/heads/${gh().base}`);
    if (!base.ok) throw new Error(`Branche ${gh().base} introuvable sur GitHub (${base.status}).`);
    const sha = (await base.json()).object.sha;
    const made = await call('POST', '/git/refs', { ref: `refs/heads/${gh().branch}`, sha });
    if (!made.ok) throw new Error(`Création de la branche impossible (${made.status}).`);
  } else if (!have.ok) {
    throw new Error(`GitHub : accès refusé ou jeton invalide (${have.status}).`);
  }
  branchReady = true;
}

/** Ajoute un fichier ; renvoie son sha (nécessaire pour le supprimer). */
export async function putFile(file, buffer, message) {
  await ensureBranch();
  const res = await call('PUT', `/contents/portfolio/${file}`, { message, content: buffer.toString('base64'), branch: gh().branch });
  if (!res.ok) throw new Error(`GitHub : envoi impossible (${res.status}).`);
  return (await res.json()).content.sha;
}

export async function deleteFile(file, sha) {
  const res = await call('DELETE', `/contents/portfolio/${file}`, { message: `Retire ${file}`, sha, branch: gh().branch });
  if (!res.ok && res.status !== 404) throw new Error(`GitHub : suppression impossible (${res.status}).`);
}

/** Octets d'une photo (lue sur GitHub) ; null si elle n'existe pas. */
export async function readFile(file) {
  const res = await call('GET', `/contents/portfolio/${file}?ref=${encodeURIComponent(gh().branch)}`, null, 'application/vnd.github.raw+json');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub : lecture impossible (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}
