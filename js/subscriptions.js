const form = document.getElementById('subscription');
const { plan, period, method } = form.elements;
const status = form.querySelector('[role=status]');
const submit = form.querySelector('[type=submit]');
const number = document.getElementById('subscription-number');
let config;

function sync() {
  if (!config) return;
  number.value = config[method.value] || '';
  document.getElementById('subscription-amount').textContent = config.prices[plan.value][period.value] + ' GDS';
  submit.disabled = !number.value;
  document.querySelectorAll('[data-payment-method]').forEach(button => {
    button.hidden = !config[button.dataset.paymentMethod];
    button.setAttribute('aria-pressed', String(method.value === button.dataset.paymentMethod));
  });
}
document.querySelectorAll('[data-payment-method]').forEach(button => {
  button.addEventListener('click', () => {
    method.value = button.dataset.paymentMethod;
    sync();
  });
});
document.querySelectorAll('[data-plan]').forEach(link => link.addEventListener('click', () => {
  plan.value = link.dataset.plan;
  sync();
}));
form.addEventListener('change', sync);
document.getElementById('subscription-copy').onclick = async () => {
  if (!number.value) return;
  try { await navigator.clipboard.writeText(number.value); status.textContent = 'Numéro copié.'; }
  catch { number.select(); status.textContent = 'Numéro sélectionné.'; }
};
form.onsubmit = async event => {
  event.preventDefault();
  submit.disabled = true;
  try {
    const response = await fetch('/api/public/subscriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Impossible d’envoyer la demande.');
    const link = document.createElement('a');
    link.href = result.tracking;
    link.textContent = 'Ouvrir et conserver mon lien de suivi';
    status.replaceChildren('Demande reçue. ', link);
    form.elements.transferCode.value = '';
  } catch (error) { status.textContent = error.message; }
  finally { sync(); }
};
fetch('/api/public/subscriptions/payment').then(async response => {
  if (!response.ok) throw new Error();
  config = await response.json();
  for (const [key, label] of [['moncash', 'MonCash'], ['natcash', 'NatCash']]) {
    if (config[key]) method.add(new Option(label, key));
  }
  if (!method.options.length) status.textContent = 'Les moyens de paiement seront affichés après leur configuration.';
  sync();
}).catch(() => { status.textContent = 'Moyens de paiement indisponibles.'; });
