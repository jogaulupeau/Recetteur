import { h, clear, icon, toast, fill } from './dom.js';
import { init } from './state.js';

import * as home from './views/home.js';
import * as recipes from './views/recipes.js';
import * as recipe from './views/recipe.js';
import * as cook from './views/cook.js';
import * as menu from './views/menu.js';
import * as shopping from './views/shopping.js';
import * as importer from './views/import.js';
import * as editor from './views/editor.js';

// [motif, vue, onglet actif]
const ROUTES = [
  [/^\/?$/, home, 'home'],
  [/^\/recettes$/, recipes, 'recettes'],
  [/^\/importer$/, importer, 'recettes'],
  [/^\/recette\/([^/]+)$/, recipe, 'recettes'],
  [/^\/recette\/([^/]+)\/cuisiner$/, cook, 'recettes'],
  [/^\/recette\/([^/]+)\/modifier$/, editor, 'recettes'],
  [/^\/menu(?:\/(\d{4}-\d{2}-\d{2}))?$/, menu, 'menu'],
  [/^\/courses(?:\/(\d{4}-\d{2}-\d{2}))?$/, shopping, 'courses'],
];
const TABS = [
  ['home', '#/', 'Accueil', 'home'],
  ['recettes', '#/recettes', 'Recettes', 'book'],
  ['menu', '#/menu', 'Menu', 'calendar'],
  ['courses', '#/courses', 'Courses', 'cart'],
];

const app = document.getElementById('app');
const main = h('main', { id: 'main' });
const navLinks = () => TABS.map(([id, href, label, ic]) => h('a', { href, 'data-tab': id }, icon(ic, 20), h('span', {}, label)));
const desktopNav = h('nav', { class: 'nav', 'aria-label': 'Navigation' }, navLinks());
const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Navigation' }, navLinks());
app.append(
  h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: new URL('../icons/icon.svg', import.meta.url).href, alt: '' }), 'Recetteur'),
    desktopNav)),
  main,
  tabbar,
);

let cleanup = null;
let token = 0;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: decodeURI(path).replace(/\/+$/, '') || '/', query: new URLSearchParams(qs) };
}

async function render() {
  const mine = ++token;
  cleanup?.();
  cleanup = null;
  const { path, query } = parseHash();
  const match = ROUTES.map(([re, view, tab]) => [path.match(re), view, tab]).find(([m]) => m);
  document.body.classList.toggle('cooking', !!match && match[1] === cook);
  document.querySelectorAll('[data-tab]').forEach((a) => (match && a.dataset.tab === match[2] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  clear(main);
  window.scrollTo(0, 0);
  if (!match) {
    main.append(h('div', { class: 'card empty' }, h('h2', {}, 'Page introuvable'), h('a', { class: 'btn', href: '#/' }, 'Retour à l’accueil')));
    return;
  }
  main.append(h('div', { class: 'skeleton' }));
  try {
    const out = await match[1].render({ params: match[0].slice(1).map((x) => (x ? decodeURIComponent(x) : x)), query, root: main });
    if (mine !== token) return out?.(); // une autre navigation a pris le relais
    cleanup = typeof out === 'function' ? out : null;
    main.querySelector(':scope > .skeleton')?.remove();
  } catch (e) {
    if (mine !== token) return;
    console.error(e);
    clear(main).append(h('div', { class: 'card empty' }, h('h2', {}, 'Oups'), h('p', { class: 'muted' }, e.message), h('button', { class: 'btn', onclick: render }, 'Réessayer')));
  }
}

window.addEventListener('hashchange', render);
(async () => {
  try {
    await init();
  } catch (e) {
    fill(main, h('div', { class: 'card empty' }, h('h2', {}, 'Impossible de démarrer'), h('p', { class: 'muted' }, e.message)));
    return;
  }
  render();
})();

window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Une erreur est survenue.', { type: 'error' }));
