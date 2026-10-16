// Messages WhatsApp « prêts à envoyer » : un clic ouvre WhatsApp avec le texte déjà écrit (aucun service payant, rien n'est envoyé sans votre appui).
import { escape } from './service.js';
import { icon } from './icons.js';

const digits = (n) => String(n || '').replace(/\D/g, '');
export const waLink = (number, text) => (digits(number) ? `https://wa.me/${digits(number)}?text=${encodeURIComponent(text)}` : '');
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
export const siteUrl = (path = '/client') => `${location.origin}${path}`;

/** Bouton rond WhatsApp (vide si le client n'a pas de numéro). */
export const waBtn = (number, text, label = 'Prévenir par WhatsApp') => {
  const href = waLink(number, text);
  return href ? `<a class="btn sm icon-btn" href="${escape(href)}" target="_blank" rel="noopener noreferrer" title="${escape(label)}" aria-label="${escape(label)}" data-tip="${escape(label)}">${icon('chat')}</a>` : '';
};
