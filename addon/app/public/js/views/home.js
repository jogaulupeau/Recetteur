import { h, icon, toast, empty, fill } from '../dom.js';
import { api } from '../api.js';
import { state, entry } from '../state.js';
import { recipeCard, defaultServings, loadExamples } from '../cards.js';
import { pickRecipe } from '../picker.js';
import { tintOf, emptyPlate } from '../art.js';
import { visual } from '../photo.js';
import { suggest } from '../../shared/suggest.js';
import { today, addDays, dayName, dayMonth, weekStart } from '../../shared/dates.js';
import { fmtTime, SLOT_LABELS } from '../format.js';
import { totalTime } from '../../shared/recipe.js';
import { capitalize } from '../../shared/text.js';

export async function render({ root }) {
  const t = today();
  const hour = new Date().getHours();
  root.append(h('div', { class: 'page-head' }, h('div', {},
    h('h1', {}, hour < 18 ? 'Bonjour' : 'Bonsoir', h('span', { class: 'dot' }, '.')),
    h('p', { class: 'muted', style: { margin: 0 } }, capitalize(`${dayName(t)} ${dayMonth(t)}`)))));

  if (!state.recettes.length) {
    const welcome = (empty('Bienvenue dans Recetteur', 'Commencez par ajouter des recettes : collez celles générées avec Claude, ou chargez quelques exemples pour essayer.',
      h('a', { class: 'btn primary', href: '#/importer' }, icon('upload', 18), 'Importer des recettes'),
      h('button', { class: 'btn', onclick: async (ev) => { ev.currentTarget.disabled = true; await loadExamples(); location.reload(); } }, 'Charger 5 exemples')));
    welcome.prepend(emptyPlate());
    root.append(welcome);
    return;
  }

  let repas = await api.get(`menu?du=${t}&au=${addDays(t, 1)}`);
  const todayBox = h('section', { class: 'slate stack' });
  const ideasBox = h('div', { class: 'rgrid' });
  const fridge = h('input', { type: 'text', placeholder: 'Dans le frigo : courgettes, crème, œufs…', 'aria-label': 'Ingrédients disponibles', autocomplete: 'off' });
  let have = [];

  function drawToday() {
    const mealRow = (m) => {
      const e = entry(m.recipeId);
      return e ? h('div', { class: `meal ${m.fait ? 'done' : ''}`, 'data-type': e.recette.type, 'data-tint': tintOf(e.recette) },
        visual(e, { className: 'avatar' }),
        h('div', {}, h('a', { class: 'meal-title', href: `#/recette/${encodeURIComponent(e.id)}?p=${m.servings}` }, e.recette.titre),
          h('div', { class: 'meal-sub' }, `${m.servings} pers.`, totalTime(e.recette) ? ` · ${fmtTime(totalTime(e.recette))}` : '')),
        h('a', { class: 'btn sm primary', href: `#/recette/${encodeURIComponent(e.id)}/cuisiner?p=${m.servings}&repas=${m.id}` }, icon('play', 16), 'Cuisiner')) : null;
    };
    const slotBlock = (date, slot, label) => {
      const ms = repas.filter((m) => m.date === date && m.slot === slot);
      return h('div', { class: 'stack tight' }, h('div', { class: 'slot-label' }, label),
        ms.map(mealRow),
        ms.length ? null : h('button', { class: 'addmeal', onclick: () => plan(date, slot) }, icon('plus', 16), 'Choisir une recette'));
    };
    fill(todayBox, 
      h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, 'Au menu ', h('em', {}, 'aujourd’hui')), h('a', { class: 'btn sm', href: `#/menu/${weekStart(t)}` }, icon('calendar', 16), 'Menu de la semaine')),
      slotBlock(t, 'midi', SLOT_LABELS.midi), slotBlock(t, 'soir', SLOT_LABELS.soir),
      repas.some((m) => m.date === addDays(t, 1)) ? h('p', { class: 'small muted', style: { margin: 0 } }, 'Demain : ', repas.filter((m) => m.date === addDays(t, 1)).map((m) => entry(m.recipeId)?.recette.titre).filter(Boolean).join(' · ')) : null);
  }
  async function plan(date, slot) {
    const e = await pickRecipe({ titre: `${SLOT_LABELS[slot]} · aujourd’hui`, exclude: repas.map((m) => m.recipeId) });
    if (!e) return;
    repas.push(await api.post('menu', { date, slot, recipeId: e.id, servings: defaultServings(e.recette) }));
    drawToday();
  }

  let seen = [];
  function drawIdeas(reroll = false) {
    const planned = repas.map((m) => entry(m.recipeId)?.recette).filter(Boolean);
    let list = suggest(state.recettes, { type: have.length ? '' : 'plat', have, planned, today: t, n: 3, excludeIds: reroll ? seen : [] });
    if (reroll && !list.length) { seen = []; list = suggest(state.recettes, { type: have.length ? '' : 'plat', have, planned, today: t, n: 3 }); }
    seen.push(...list.map((s) => s.entry.id));
    fill(ideasBox, ...(list.length ? list.map((s) => recipeCard(s.entry, s)) : [h('p', { class: 'muted' }, 'Aucune idée pour l’instant.')]));
  }
  fridge.addEventListener('input', () => {
    have = fridge.value.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
    seen = [];
    drawIdeas();
  });

  drawToday();
  drawIdeas();
  root.append(h('div', { class: 'stack' }, todayBox,
    h('section', { class: 'stack' },
      h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, have.length ? 'Avec ce que vous avez' : h('span', {}, 'Une idée ', h('em', {}, 'pour ce soir'), ' ?')), h('button', { class: 'btn sm', onclick: () => drawIdeas(true) }, icon('refresh', 16), 'D’autres idées')),
      fridge, ideasBox),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/courses/${weekStart(t)}` }, icon('cart', 18), 'Courses de la semaine'),
      h('a', { class: 'btn', href: '#/importer' }, icon('upload', 18), 'Importer des recettes'))));
}
