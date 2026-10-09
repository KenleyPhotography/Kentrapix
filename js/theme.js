// Thème clair / sombre. Chargé dans <head> AVANT les styles pour éviter le flash blanc.
// Choix enregistré sur l'appareil : 'auto' (suit le téléphone / l'ordinateur), 'light' ou 'dark'.
(function () {
  var KEY = 'kp-theme';
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function read() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply() {
    var pref = read();
    var dark = pref === 'dark' || (pref === 'auto' && !!media && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#07111f' : '#f4f7fc';
  }
  window.kpTheme = {
    get: read,
    set: function (pref) {
      try { if (pref === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch (e) {}
      apply();
    },
  };
  if (media && media.addEventListener) media.addEventListener('change', apply);
  apply();
  // La balise meta theme-color est plus bas dans le <head> : on la met à jour une fois lue.
  document.addEventListener('DOMContentLoaded', apply);
})();
