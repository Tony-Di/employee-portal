// Preset icons: inner SVG markup for a 24×24 stroked icon. Keys are stored in sites.icon_key.
export const ICONS = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20a3 3 0 0 1-3 2h-3"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.5-6.5a4 4 0 0 0-2-2z"/><path d="M10 15 5 20"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-7"/>',
  book: '<path d="M12 6.5C10.5 5 8 4.5 3.5 4.5v14c4.5 0 7 .5 8.5 2 1.5-1.5 4-2 8.5-2v-14c-4.5 0-7 .5-8.5 2z"/><path d="M12 6.5v14"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3 6"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9v.01M17.5 15v.01"/>',
  building: '<path d="M5 21V4h10v17M15 9h4v12M3 21h18"/><path d="M8.5 8h3M8.5 12h3M8.5 16h3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
};

export const ICON_LABELS = {
  globe: ['网站', 'Website'], headset: ['技术支持', 'Support'], grid: ['应用', 'Apps'], calendar: ['日程', 'Calendar'],
  mail: ['邮件', 'Mail'], chat: ['沟通', 'Chat'], wrench: ['维护', 'Maintenance'], chart: ['报表', 'Reports'],
  book: ['知识库', 'Knowledge'], users: ['人员', 'People'], shield: ['安全', 'Security'], folder: ['文件', 'Files'],
  clock: ['考勤', 'Time'], money: ['财务', 'Finance'], building: ['行政', 'Facilities'], lock: ['账号', 'Accounts'],
};
