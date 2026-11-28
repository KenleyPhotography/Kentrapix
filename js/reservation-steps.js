export function initReservationSteps(form) {
  const panels = Array.from(form.querySelectorAll('[data-step]'));
  const indicators = Array.from(form.querySelectorAll('[data-step-indicator]'));
  const back = form.querySelector('[data-step-back]');
  const next = form.querySelector('[data-step-next]');
  const submit = form.querySelector('[data-step-submit]');
  let current = 0;
  const invalid = (panel) => Array.from(panel.querySelectorAll('input, select, textarea')).find(control => !control.checkValidity());

  function show(index, focus = true) {
    current = index;
    panels.forEach((panel, step) => { panel.hidden = step !== index; });
    indicators.forEach((indicator, step) => {
      if (step === index) indicator.setAttribute('aria-current', 'step');
      else indicator.removeAttribute('aria-current');
    });
    back.hidden = index === 0;
    next.hidden = index === panels.length - 1;
    submit.hidden = !next.hidden;
    if (focus) panels[index].querySelector('h3').focus();
  }

  form.noValidate = true;
  back.onclick = () => show(current - 1);
  next.onclick = () => {
    const control = invalid(panels[current]);
    if (control) control.reportValidity();
    else show(current + 1);
  };
  form.addEventListener('submit', (event) => {
    if (current < panels.length - 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      next.click();
      return;
    }
    for (const [index, panel] of panels.entries()) {
      const control = invalid(panel);
      if (!control) continue;
      event.preventDefault();
      event.stopImmediatePropagation();
      show(index, false);
      control.reportValidity();
      return;
    }
  }, true);
  show(0, false);
  return () => show(0, false);
}
