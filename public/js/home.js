// Instant search and category filtering. Without JavaScript the same form filters on the server.
(() => {
  const form = document.querySelector('[data-filter-form]');
  if (!form) return;
  const input = form.querySelector('input[name="q"]');
  const chips = [...document.querySelectorAll('.chip')];
  const items = [...document.querySelectorAll('.card-item')];
  const status = document.querySelector('[data-result-status]');
  const lang = document.documentElement.lang === 'en' ? 'en' : 'zh';
  let category = (chips.find(c => c.getAttribute('aria-pressed') === 'true') || { value: '' }).value;

  function apply() {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const item of items) {
      const match = (!q || item.dataset.search.includes(q)) && (!category || item.dataset.category === category);
      item.hidden = !match;
      if (match) shown += 1;
    }
    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.value === category));
    status.textContent = shown ? status.dataset[`template${lang === 'en' ? 'En' : 'Zh'}`].replace('{n}', shown) : status.dataset[`empty${lang === 'en' ? 'En' : 'Zh'}`];
    const params = new URLSearchParams();
    if (input.value.trim()) params.set('q', input.value.trim());
    if (category) params.set('category', category);
    history.replaceState(null, '', params.size ? `?${params}` : location.pathname);
  }

  input.addEventListener('input', apply);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (event.submitter?.classList.contains('chip')) category = event.submitter.value;
    apply();
  });
})();
