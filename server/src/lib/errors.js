import { z, ZodError } from 'zod';

// Messages de validation par défaut en français (les champs importants ont leur propre message).
const FIELD_NAMES = { name: 'nom', email: 'e-mail', password: 'mot de passe', subject: 'objet', message: 'message', date: 'date', type: 'type', clientId: 'destinataire' };
z.setErrorMap((issue, ctx) => {
  const field = FIELD_NAMES[issue.path.at(-1)] || issue.path.join('.') || 'valeur';
  if (issue.code === 'invalid_type' && issue.received === 'undefined') return { message: `Champ obligatoire : ${field}.` };
  if (issue.code === 'invalid_type') return { message: `Valeur invalide : ${field}.` };
  if (issue.code === 'too_big') return { message: `Trop long : ${field}.` };
  if (issue.code === 'too_small') return { message: `Trop court : ${field}.` };
  if (issue.code === 'unrecognized_keys') return { message: 'Champ non autorisé.' };
  return { message: ctx.defaultError };
});
import multer from 'multer';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status, message) => new HttpError(status, message);

export function apiNotFound(req, res) {
  res.status(404).json({ error: 'Ressource introuvable.' });
}

// Express 5 transmet automatiquement ici les erreurs des routes async.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message;

  if (err instanceof ZodError) {
    status = 400;
    message = err.issues[0]?.message || 'Données invalides.';
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE'
      ? `Fichier trop volumineux (maximum ${config.maxUploadMb} Mo).`
      : 'Envoi de fichier invalide.';
  } else if (err.code === 'ER_DUP_ENTRY') {
    status = 409;
    message = 'Cette adresse e-mail est déjà utilisée.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Requête trop volumineuse.';
  }

  if (status >= 500) {
    console.error(err);
    message = 'Erreur interne du serveur.';
  }
  if (res.headersSent) return res.destroy(err);
  res.status(status).json({ error: message });
}
