// Light/dark toggle without a page reload. Without JavaScript the link sets the theme on the server.
(() => {
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme || (media.matches ? 'dark' : 'light');

  function sync() {
    const next = current() === 'dark' ? 'light' : 'dark';
    for (const toggle of document.querySelectorAll('[data-theme-toggle]')) {
      const label = toggle.dataset[next === 'dark' ? 'labelDark' : 'labelLight'];
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
      const url = new URL(toggle.href);
      url.searchParams.set('theme', next);
      toggle.href = url;
    }
  }

  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-theme-toggle]');
    if (!toggle) return;
    event.preventDefault();
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    document.cookie = `portal_theme=${next}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
    sync();
  });
  media.addEventListener('change', sync);
  document.addEventListener('DOMContentLoaded', sync);
})();
