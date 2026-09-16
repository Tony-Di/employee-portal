import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSites } from '../public/js/search.js';

const names = sites => sites.map(site => site.name);

test('every search word must match, across names, descriptions and aliases in either language', () => {
  const sites = [
    { name: '服务台', name_en: 'HelpDesk', description: '设备报修', keywords: '电脑, IT support' },
    { name: '电脑商城', description: '采购设备' },
  ];
  assert.deepEqual(names(searchSites(sites, '电脑 报修')), ['服务台']);
  assert.deepEqual(names(searchSites(sites, 'support 服务台')), ['服务台']);
  assert.deepEqual(names(searchSites(sites, '电脑 财务')), []);
});

test('exact names rank before name fragments, aliases and descriptions, with stable ties', () => {
  const sites = [
    { name: 'Reference', description: 'Contact HelpDesk' },
    { name: 'Tickets', keywords: 'HelpDesk' },
    { name: 'HelpDesk support' },
    { name: 'HelpDesk' },
    { name: 'HelpDesk portal' },
  ];
  assert.deepEqual(names(searchSites(sites, 'helpdesk')), [
    'HelpDesk', 'HelpDesk support', 'HelpDesk portal', 'Tickets', 'Reference',
  ]);
  assert.deepEqual(names(searchSites(sites, '')), names(sites), 'clearing search restores configured order');
  assert.equal(sites[0].name, 'Reference', 'ranking does not mutate its input');
});

test('more query words in the name rank before matches found in other fields', () => {
  const sites = [
    { name: 'Support', keywords: 'IT' },
    { name: 'Company IT support' },
    { name: 'Tickets', description: 'IT support' },
  ];
  assert.deepEqual(names(searchSites(sites, 'support IT')), ['Company IT support', 'Support', 'Tickets']);
});

test('search normalizes case, full-width characters and whitespace without weighting repeated words', () => {
  const sites = [{ name: 'IT HelpDesk', keywords: '电脑' }];
  assert.deepEqual(names(searchSites(sites, '　ＨＥＬＰＤＥＳＫ\t电脑  电脑　')), ['IT HelpDesk']);
  assert.deepEqual(names(searchSites(sites, '  \t\n')), ['IT HelpDesk']);
});

test('percent signs, underscores and backslashes remain literal search text', () => {
  const sites = [{ name: '100%_ready\\path' }, { name: '100 percent ready' }];
  for (const query of ['%', '_', '\\']) {
    assert.deepEqual(names(searchSites(sites, query)), ['100%_ready\\path']);
  }
});

test('only administrator searches include URLs', () => {
  const sites = [{ name: '邮箱', url: 'https://mail.example.com', description: '公司邮件' }];
  assert.deepEqual(searchSites(sites, 'mail.example'), []);
  assert.deepEqual(names(searchSites(sites, 'mail.example 邮件', { includeUrl: true })), ['邮箱']);
});

test('category filtering combines with all query terms and preserves default order', () => {
  const sites = [{ name: 'IT tickets', category_id: 1 }, { name: 'IT support', category_id: 2 }];
  assert.deepEqual(names(searchSites(sites, 'IT', { category: '2' })), ['IT support']);
  assert.deepEqual(searchSites(sites, 'tickets', { category: '2' }), []);
  assert.deepEqual(names(searchSites(sites, '', { category: 'invalid' })), names(sites));
});
