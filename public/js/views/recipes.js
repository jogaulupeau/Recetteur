import { h, icon, empty, debounce, toast, fill } from '../dom.js';
import { state } from '../state.js';
import { recipeCard, loadExamples } from '../cards.js';
import { searchRecipes, tagCounts } from '../../shared/search.js';
import { TYPES } from '../../shared/vocab.js';
import { emptyPlate } from '../art.js';

// Les filtres survivent à la navigation (aller voir une fiche, revenir).
const filters = { q: '', type: '', tags: [], favoris: false, maxTemps: 0, tri: '' };

export function render({ root }) {
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Recettes'), h('p', { class: 'muted', id: 'count' })),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: surprise }, icon('shuffle', 18), 'Surprenez-moi'),
      h('a', { class: 'btn primary', href: '#/importer' }, icon('plus', 18), 'Ajouter')));
  root.append(head);

  if (!state.recettes.length) {
    const blank = (empty('Votre livre de recettes est vide',
      'Importez des recettes générées avec Claude, ou commencez avec quelques exemples.',
      h('a', { class: 'btn primary', href: '#/importer' }, icon('upload', 18), 'Importer des recettes'),
      h('button', { class: 'btn', onclick: async (ev) => { ev.target.disabled = true; await loadExamples(); location.reload(); } }, 'Charger 5 exemples')));
    blank.prepend(emptyPlate());
    root.append(blank);
    return;
  }

  const search = h('input', { type: 'search', placeholder: 'Rechercher : titre, ingrédient, mot-clé…', value: filters.q, 'aria-label': 'Rechercher une recette', autocomplete: 'off' });
  const typeBar = h('div', { class: 'typebar' });
  const tagBar = h('div', { class: 'chips' });
  const results = h('div', { class: 'rgrid' });
  const maxSel = h('select', { 'aria-label': 'Durée maximale', onchange: (e) => ((filters.maxTemps = Number(e.target.value)), update()) },
    [[0, 'Durée : peu importe'], [20, '≤ 20 min'], [30, '≤ 30 min'], [45, '≤ 45 min'], [60, '≤ 1 h'], [90, '≤ 1 h 30']].map(([v, l]) => h('option', { value: v, selected: v === filters.maxTemps }, l)));
  const sortSel = h('select', { 'aria-label': 'Tri', onchange: (e) => ((filters.tri = e.target.value), update()) },
    [['', 'Tri : pertinence / A–Z'], ['recent', 'Plus récentes'], ['rapide', 'Plus rapides'], ['cuisine', 'Cuisinées récemment']].map(([v, l]) => h('option', { value: v, selected: v === filters.tri }, l)));
  const favChip = h('button', { class: 'chip', type: 'button', onclick: () => ((filters.favoris = !filters.favoris), update()) }, icon('heart', 14), 'Favoris');

  const present = Object.entries(TYPES).filter(([k]) => state.recettes.some((e) => e.recette.type === k));
  const tags = tagCounts(state.recettes).slice(0, 14);

  function filtered() {
    return searchRecipes(state.recettes, { ...filters, tri: filters.tri || undefined });
  }
  function update() {
    fill(typeBar, ...[['', 'Tout'], ...present].map(([k, label]) =>
      h('button', { type: 'button', class: `chip ${filters.type === k ? 'on' : ''}`, onclick: () => ((filters.type = k), update()) }, label)));
    fill(tagBar, ...tags.map(([t, n]) =>
      h('button', { type: 'button', class: `chip ${filters.tags.includes(t) ? 'on' : ''}`, onclick: () => {
        filters.tags = filters.tags.includes(t) ? filters.tags.filter((x) => x !== t) : [...filters.tags, t];
        update();
      } }, `${t} `, h('small', {}, n))));
    favChip.classList.toggle('on', filters.favoris);
    const list = filtered();
    root.querySelector('#count').textContent = `${list.length} sur ${state.recettes.length} recette${state.recettes.length > 1 ? 's' : ''}`;
    fill(results, ...(list.length ? list.map((e) => recipeCard(e)) : [h('div', { class: 'card empty', style: { gridColumn: '1/-1' } }, h('p', { class: 'muted' }, 'Aucune recette ne correspond à ces critères.'),
      h('button', { class: 'btn', onclick: () => (Object.assign(filters, { q: '', type: '', tags: [], favoris: false, maxTemps: 0 }), (search.value = ''), (maxSel.value = 0), update()) }, 'Réinitialiser les filtres'))]));
  }

  function surprise() {
    const list = filtered();
    if (!list.length) return toast('Aucune recette à proposer avec ces filtres.');
    const pick = list[Math.floor(Math.random() * list.length)];
    location.hash = `#/recette/${encodeURIComponent(pick.id)}`;
  }

  search.addEventListener('input', debounce(() => ((filters.q = search.value), update()), 120));
  root.append(h('div', { class: 'filters' },
    h('div', { class: 'searchbox' }, icon('search', 18), search),
    typeBar, tagBar,
    h('div', { class: 'row' }, favChip, maxSel, sortSel)), results);
  update();
}
