// Sélecteur de recette (avec suggestions) et dialogue « ajouter au menu ».
import { h, icon, modal, stepper, toast, debounce, fill } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';
import { searchRecipes } from '../shared/search.js';
import { suggest } from '../shared/suggest.js';
import { TYPES } from '../shared/vocab.js';
import { today, dayName, dayMonth, addDays } from '../shared/dates.js';
import { totalTime } from '../shared/recipe.js';
import { fmtTime, SLOT_LABELS } from './format.js';
import { defaultServings } from './cards.js';
import { plate, tintOf } from './art.js';

/**
 * Ouvre un sélecteur ; résout avec l'entrée choisie (ou undefined).
 * @param {{titre?:string, type?:string, exclude?:string[], planned?:object[]}} o
 */
export function pickRecipe({ titre = 'Choisir une recette', type = 'plat', exclude = [], planned = [] } = {}) {
  let q = '';
  let t = type;
  let m;
  const input = h('input', { type: 'search', placeholder: 'Rechercher un plat, un ingrédient…', 'aria-label': 'Rechercher', autocomplete: 'off' });
  const typeBar = h('div', { class: 'typebar' });
  const list = h('div', { class: 'picker-list' });

  const row = (e, sub) =>
    h('button', { class: 'pick', type: 'button', 'data-type': e.recette.type, 'data-tint': tintOf(e.recette), onclick: () => m.close(e) },
      h('span', { class: 'lead' }, plate(e.recette, { className: 'avatar' }), h('span', {}, h('strong', {}, e.recette.titre), h('span', { class: 'small muted' }, sub ?? ''))),
      h('span', { class: 'small muted' }, totalTime(e.recette) ? fmtTime(totalTime(e.recette)) : ''));

  const draw = () => {
    fill(typeBar, ...[['', 'Tout'], ...Object.entries(TYPES).filter(([k]) => state.recettes.some((e) => e.recette.type === k))].map(([k, label]) =>
      h('button', { type: 'button', class: `chip ${t === k ? 'on' : ''}`, onclick: () => ((t = k), draw()) }, label)));
    const kids = [];
    if (!q.trim()) {
      const sugg = suggest(state.recettes, { type: t, excludeIds: exclude, planned, today: today(), n: 4 });
      if (sugg.length) {
        kids.push(h('div', { class: 'picker-h' }, 'Suggestions'));
        sugg.forEach((s) => kids.push(row(s.entry, s.reasons.join(' · '))));
        kids.push(h('div', { class: 'picker-h' }, 'Toutes les recettes'));
      }
    }
    const found = searchRecipes(state.recettes, { q, type: t });
    if (!found.length) kids.push(h('p', { class: 'muted' }, state.recettes.length ? 'Aucune recette ne correspond.' : 'Aucune recette pour l’instant — importez-en depuis l’onglet Recettes.'));
    found.slice(0, 80).forEach((e) => kids.push(row(e, e.favori ? '♥ favorite' : '')));
    fill(list, ...kids);
  };
  input.addEventListener('input', debounce(() => ((q = input.value), draw()), 120));
  draw();
  m = modal({ title: titre, body: [h('div', { class: 'searchbox' }, icon('search', 18), input), typeBar, list] });
  setTimeout(() => input.focus(), 50);
  return m.done;
}

/** Dialogue : jour + créneau + nombre de personnes → POST /menu. Résout avec le repas créé. */
export function addToMenuDialog(entry, { date = today(), slot = 'soir' } = {}) {
  let servings = defaultServings(entry.recette);
  const dateIn = h('input', { type: 'date', value: date, 'aria-label': 'Jour' });
  const slotSel = h('select', { 'aria-label': 'Repas' }, Object.entries(SLOT_LABELS).map(([k, v]) => h('option', { value: k, selected: k === slot }, v)));
  const quick = h('div', { class: 'chips' }, [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = addDays(today(), i);
    return h('button', { type: 'button', class: 'chip', onclick: () => (dateIn.value = d) }, i === 0 ? 'Aujourd’hui' : i === 1 ? 'Demain' : `${dayName(d, 'short')} ${dayMonth(d).split(' ')[0]}`);
  }));
  let m;
  const body = h('div', { class: 'stack' },
    h('p', { class: 'muted' }, entry.recette.titre),
    quick,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, dateIn), h('div', {}, slotSel)),
    h('div', { class: 'row between' }, h('span', {}, 'Pour'), stepper(servings, (v) => (servings = v))));
  m = modal({
    title: 'Ajouter au menu',
    body,
    actions: [
      h('button', { class: 'btn', onclick: () => m.close() }, 'Annuler'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          try {
            const created = await api.post('menu', { date: dateIn.value, slot: slotSel.value, recipeId: entry.id, servings });
            toast(`Ajouté au menu du ${dayName(created.date)} ${dayMonth(created.date)}.`, { type: 'ok' });
            m.close(created);
          } catch (e) {
            toast(e.message, { type: 'error' });
          }
        },
      }, 'Ajouter'),
    ],
  });
  return m.done;
}

