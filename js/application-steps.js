export function initApplication(form, loadPayment, sendApplication) {
  const details = form.querySelector('[data-details]');
  const step = form.querySelector('[data-transfer]');
  const status = form.querySelector('[role=status]');
  const next = form.querySelector('[data-continue]');
  const method = form.elements.method;
  const code = form.elements.transferCode;
  const number = form.querySelector('[data-number]');
  const copy = form.querySelector('[data-copy]');
  const submit = form.querySelector('[data-send]');
  let payment;
  let review = false;

  function show(nextStep) {
    review = nextStep;
    details.hidden = nextStep;
    step.hidden = !nextStep;
    method.disabled = code.disabled = !nextStep || !payment;
    step.querySelector('[data-payment-fields]').hidden = !payment;
    submit.hidden = !nextStep;
    next.hidden = nextStep;
    form.querySelector('[data-back]').hidden = !nextStep;
  }

  method.onchange = () => { number.value = payment?.[method.value] || ''; };
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(number.value);
      status.textContent = 'Numéro copié.';
    } catch {
      number.select();
      status.textContent = 'Sélectionnez et copiez le numéro.';
    }
  };
  form.querySelector('[data-back]').onclick = () => { show(false); status.textContent = ''; };
  form.onsubmit = async event => {
    event.preventDefault();
    status.textContent = '';
    const button = review ? submit : next;
    button.disabled = true;
    try {
      if (!review) {
        payment = await loadPayment();
        method.replaceChildren(...['moncash', 'natcash'].filter(key => payment?.[key])
          .map(key => new Option(key === 'moncash' ? 'MonCash' : 'NatCash', key)));
        method.onchange();
        step.querySelector('[data-amount]').textContent = payment ? payment.amount + ' HTG' : 'Candidature sans frais.';
        show(true);
        step.querySelector('h3').focus();
      } else {
        const result = await sendApplication(Object.fromEntries(new FormData(form)));
        form.reset();
        show(false);
        status.textContent = 'Votre candidature a été envoyée. ';
        if (result?.tracking) {
          const link = document.createElement('a');
          link.href = result.tracking;
          link.textContent = 'Suivre ma candidature';
          status.append(link);
        }
      }
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  show(false);
}
