const paths = {
  home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  news: 'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5',
  box: 'm3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4 M12 11v10',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  spark: 'm12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2 M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  search: 'M21 21l-5-5 M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14',
  back: 'm15 18-6-6 6-6',
  arrow: 'M5 12h14 m-6-6 6 6-6 6',
  plus: 'M12 5v14 M5 12h14',
  edit: 'm16 3 5 5-12 12H4v-5Z M13 6l5 5',
  check: 'm5 12 4 4L20 5',
  close: 'm6 6 12 12 M18 6 6 18',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  bookmark: 'M6 3h12v18l-6-4-6 4Z',
  shield: 'm12 3 8 4v6c0 4-8 8-8 8s-8-4-8-8V7Z M8 12l3 3 5-6',
  chart: 'M4 19V9 M10 19V4 M16 19v-7 M22 21H2',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  folder: 'M3 5h7l2 3h9v13H3Z',
  message: 'M21 15a3 3 0 0 1-3 3H8l-5 4V5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z',
  calendar: 'M4 5h16v16H4Z M8 2v6 M16 2v6 M4 11h16',
  image: 'M3 3h18v18H3Z m0 13 5-5 5 5 3-3 5 5 M8 7h.01',
  upload: 'M12 16V3 m-5 5 5-5 5 5 M3 16v5h18v-5',
  play: 'm8 4 13 8-13 8Z',
  logout: 'M9 4H3v16h6 M13 8l4 4-4 4 M8 12h13',
  refresh: 'M20 7V3l-4 4 M20 7a9 9 0 1 0 1 7',
  layers: 'm12 3 10 5-10 5L2 8Z M2 12l10 5 10-5 M2 16l10 5 10-5',
  flag: 'M4 22V3c5-4 10 4 16 0v12c-6 4-11-4-16 0'
};
export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.box}"/></svg>`;
