// Shared by server-rendered results and the homepage's instant filtering.
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');

export function searchSites(sites, query = '', { category = '', includeUrl = false } = {}) {
  const phrase = normalize(String(query ?? '').trim().slice(0, 100));
  const terms = [...new Set(phrase.split(' ').filter(Boolean))];
  const categoryId = Number(category);
  const filterCategory = Number.isInteger(categoryId) && categoryId > 0 && categoryId < 2 ** 31;
  const results = [];

  sites.forEach((site, order) => {
    if (filterCategory && site.category_id !== categoryId) return;
    const names = [normalize(site.name), normalize(site.name_en)];
    const keywords = normalize(site.keywords);
    const text = [...names, normalize(site.description), normalize(site.description_en), keywords,
      ...(includeUrl ? [normalize(site.url)] : [])].join(' ');
    if (!terms.every(term => text.includes(term))) return;
    results.push({
      site, order,
      exactName: Number(Boolean(phrase) && names.includes(phrase)),
      nameMatches: terms.filter(term => names.some(name => name.includes(term))).length,
      keywordMatches: terms.filter(term => keywords.includes(term)).length,
    });
  });

  return results.sort((a, b) => b.exactName - a.exactName || b.nameMatches - a.nameMatches ||
    b.keywordMatches - a.keywordMatches || a.order - b.order).map(result => result.site);
}
