const toggle = document.querySelector('.nav-toggle');
const header = document.querySelector('.top');
header.classList.add('nav-ready');
toggle.addEventListener('click', () => {
  toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') !== 'true'));
});
