(() => {
  const toggle = document.querySelector('.public-faq-toggle');
  const panel = document.getElementById('questions');
  const close = panel.querySelector('.public-faq-close');
  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) close.focus();
    else toggle.focus();
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });
  document.addEventListener('click', event => {
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
})();
