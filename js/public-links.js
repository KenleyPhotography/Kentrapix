fetch('/api/public/public-services')
  .then((response) => response.ok ? response.json() : null)
  .then((settings) => {
    if (settings && !settings.portfolioEnabled) {
      document.querySelectorAll('[data-public-portfolio]').forEach((link) => link.remove());
    }
  })
  .catch(() => {});
