const questions = [
  ['service', 'Bonjour ! Quel type de séance souhaitez-vous ?', 'Ex. Portrait, mariage, graduation…'],
  ['date', 'Quand souhaitez-vous faire la séance ?', 'Ex. Le 12 décembre, dans l’après-midi'],
  ['place', 'Où la séance doit-elle se dérouler ?', 'Ex. Aux Cayes, en studio'],
  ['budget', 'Quel budget aimeriez-vous proposer ?', 'Ex. 5 000 HTG, ou « à discuter »'],
  ['details', 'Qu’aimeriez-vous inclure dans le devis ?', 'Ex. Durée, nombre de photos, tirages…'],
];

export function quoteButton(person, reserve, packageName = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'outline quote-trigger';
  button.textContent = 'Discuter du prix';
  button.onclick = () => openQuote(person, reserve, packageName);
  return button;
}

function openQuote(person, reserve, packageName) {
  const dialog = document.createElement('dialog');
  dialog.className = 'quote-dialog';
  dialog.setAttribute('aria-labelledby', 'quote-title');
  dialog.innerHTML = `
    <form method="dialog" class="quote-close"><button class="outline">Fermer ×</button></form>
    <h2 id="quote-title">Préparer une demande de devis</h2>
    <p class="quote-note">L’assistant prépare votre message. Le photographe répond et fixe le prix avec vous.</p>
    <div class="quote-log" role="log" aria-live="polite"></div>
    <form class="quote-form">
      <label for="quote-answer">Votre réponse</label>
      <input id="quote-answer" maxlength="140" autocomplete="off" required>
      <button class="primary">Continuer</button>
    </form>
    <section class="quote-result" hidden>
      <label for="quote-message">Message à relire ou modifier</label>
      <textarea id="quote-message" rows="7" maxlength="1000"></textarea>
      <div class="actions"></div>
    </section>`;

  const log = dialog.querySelector('.quote-log');
  const form = dialog.querySelector('.quote-form');
  const input = form.querySelector('input');
  const result = dialog.querySelector('.quote-result');
  const draft = result.querySelector('textarea');
  const actions = result.querySelector('.actions');
  const answers = {};
  let index = 0;
  if (packageName) { answers.service = packageName; index = 1; }

  function say(text, isAnswer = false) {
    const message = document.createElement('p');
    message.className = isAnswer ? 'quote-answer' : 'quote-prompt';
    message.textContent = text;
    log.append(message);
    log.scrollTop = log.scrollHeight;
  }

  function ask() {
    say(questions[index][1]);
    input.placeholder = questions[index][2];
  }

  function complete() {
    form.hidden = true;
    result.hidden = false;
    say('Votre demande est prête. Relisez-la avant de contacter le photographe.');
    draft.value = [
      `Bonjour ${person.name}, je souhaite discuter d’un devis pour une séance.`,
      `Séance : ${answers.service}`,
      `Date : ${answers.date}`,
      `Lieu : ${answers.place}`,
      `Budget proposé : ${answers.budget}`,
      `À inclure : ${answers.details}`,
      'Quel prix et quelles options pouvez-vous me proposer ?',
    ].join('\n');

    function channel(label, url) {
      const link = document.createElement('a');
      link.className = 'outline';
      link.textContent = label;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const sync = () => { link.href = url(draft.value.trim()); };
      draft.addEventListener('input', sync);
      sync();
      actions.append(link);
    }

    const digits = (person.phone || '').replace(/\D/g, '');
    if (digits.length >= 8) {
      const number = digits.length === 8 ? '509' + digits : digits;
      channel('Ouvrir WhatsApp', message => `https://wa.me/${number}?text=${encodeURIComponent(message)}`);
    }
    if (person.email) {
      channel('Ouvrir l’e-mail', message => `mailto:${encodeURIComponent(person.email)}?subject=Demande%20de%20devis%20Kentra%20Pix&body=${encodeURIComponent(message)}`);
    }
    if (reserve) {
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'primary';
      use.textContent = 'Ajouter à ma réservation';
      use.onclick = () => {
        dialog.close();
        reserve(draft.value.trim());
      };
      actions.append(use);
    }
    draft.focus();
  }

  form.onsubmit = event => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) { input.focus(); return; }
    answers[questions[index][0]] = value;
    say(value, true);
    input.value = '';
    index++;
    if (index === questions.length) complete();
    else ask();
  };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  if (packageName) say('Forfait sélectionné : ' + packageName);
  ask();
  dialog.showModal();
  input.focus();
}
