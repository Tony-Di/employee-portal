// Instant search and category filtering. Without JavaScript the same form filters on the server.
import { searchSites } from './search.js';

(() => {
  const form = document.querySelector('[data-filter-form]');
  if (!form) return;
  const input = form.querySelector('input[name="q"]');
  const chips = [...document.querySelectorAll('.chip')];
  const list = document.querySelector('.cards');
  const items = [...list.querySelectorAll('.card-item')].map(element => ({
    ...JSON.parse(element.dataset.search), element, order: Number(element.dataset.order),
  })).sort((a, b) => a.order - b.order);
  const status = document.querySelector('[data-result-status]');
  const lang = document.documentElement.lang === 'en' ? 'en' : 'zh';
  let category = (chips.find(c => c.getAttribute('aria-pressed') === 'true') || { value: '' }).value;

  function apply() {
    const results = searchSites(items, input.value, { category });
    const visible = new Set(results);
    const shown = results.length;
    for (const item of items) {
      item.element.hidden = !visible.has(item);
    }
    list.append(...results.map(item => item.element), ...items.filter(item => !visible.has(item)).map(item => item.element));
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
