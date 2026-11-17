import { h, icon, modal, stepper, toast, confirmDialog, empty, fill } from '../dom.js';
import { api } from '../api.js';
import { state, entry } from '../state.js';
import { pickRecipe } from '../picker.js';
import { tintOf } from '../art.js';
import { defaultServings } from '../cards.js';
import { fmtTime, SLOT_LABELS } from '../format.js';
import { today, addDays, weekStart, weekDays, weekLabel, dayName, dayShort } from '../../shared/dates.js';
import { autofill, suggest } from '../../shared/suggest.js';
import { tagCounts } from '../../shared/search.js';
import { totalTime } from '../../shared/recipe.js';

const SLOTS = Object.keys(SLOT_LABELS);

export async function render({ params: [week], root }) {
  const monday = weekStart(week || today());
  const days = weekDays(monday);
  let repas = await api.get(`menu?du=${monday}&au=${addDays(monday, 6)}`);
  const view = h('div', {});
  const title = h('div', { class: 'label' }, weekLabel(monday));

  const go = (m) => (location.hash = `#/menu/${m}`);
  root.append(
    h('div', { class: 'page-head' },
      h('div', { class: 'weeknav' },
        h('button', { class: 'icon-btn', title: 'Semaine précédente', 'aria-label': 'Semaine précédente', onclick: () => go(addDays(monday, -7)) }, icon('left', 22)),
        title,
        h('button', { class: 'icon-btn', title: 'Semaine suivante', 'aria-label': 'Semaine suivante', onclick: () => go(addDays(monday, 7)) }, icon('right', 22)),
        monday !== weekStart(today()) ? h('button', { class: 'btn sm', onclick: () => go(weekStart(today())) }, 'Cette semaine') : null),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: proposeDialog }, icon('shuffle', 18), 'Proposer un menu'),
        h('a', { class: 'btn primary', href: `#/courses/${monday}` }, icon('cart', 18), 'Courses'),
        h('button', { class: 'btn ghost', title: 'Vider la semaine', 'aria-label': 'Vider la semaine', onclick: clearWeek }, icon('trash', 18)))),
    view);

  const mealsIn = (date, slot) => repas.filter((m) => m.date === date && m.slot === slot).sort((a, b) => a.position - b.position || a.id - b.id);
  const plannedDocs = () => repas.map((m) => entry(m.recipeId)?.recette).filter(Boolean);

  async function add(date, slot) {
    const e = await pickRecipe({ titre: `${SLOT_LABELS[slot]} · ${dayName(date)} ${dayShort(date)}`, planned: plannedDocs(), exclude: repas.map((m) => m.recipeId) });
    if (!e) return;
    const m = await api.post('menu', { date, slot, recipeId: e.id, servings: defaultServings(e.recette) });
    repas.push(m);
    draw();
  }
  async function patch(m, body) {
    Object.assign(m, await api.patch(`menu/${m.id}`, body));
    draw();
  }
  async function remove(m) {
    await api.del(`menu/${m.id}`);
    repas = repas.filter((x) => x.id !== m.id);
    draw();
  }
  async function clearWeek() {
    if (!repas.some((m) => !m.fait)) return toast('Rien à vider sur cette semaine.');
    if (!(await confirmDialog('Retirer tous les repas non cuisinés de cette semaine ?', { ok: 'Vider', danger: true }))) return;
    await api.del(`menu?du=${monday}&au=${addDays(monday, 6)}`);
    repas = repas.filter((m) => m.fait);
    draw();
  }

  function mealEl(m) {
    const e = entry(m.recipeId);
    if (!e) return null;
    return h('div', { class: `meal ${m.fait ? 'done' : ''}`, 'data-type': e.recette.type, 'data-tint': tintOf(e.recette) },
      h('input', { type: 'checkbox', checked: m.fait, title: 'Marquer comme cuisiné', 'aria-label': `Cuisiné : ${e.recette.titre}`, onchange: (ev) => patch(m, { fait: ev.target.checked }) }),
      h('div', {},
        h('a', { class: 'meal-title', href: `#/recette/${encodeURIComponent(e.id)}?p=${m.servings}` }, e.recette.titre),
        h('div', { class: 'meal-sub' },
          stepper(m.servings, (v) => patch(m, { servings: v }), { unit: 'pers.', label: 'personnes' }),
          totalTime(e.recette) ? h('span', {}, fmtTime(totalTime(e.recette))) : null)),
      h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: 0 } },
        h('a', { class: 'icon-btn', title: 'Cuisiner', 'aria-label': `Cuisiner ${e.recette.titre}`, href: `#/recette/${encodeURIComponent(e.id)}/cuisiner?p=${m.servings}&repas=${m.id}` }, icon('play', 18)),
        h('button', { class: 'icon-btn', title: 'Retirer du menu', 'aria-label': 'Retirer du menu', onclick: () => remove(m) }, icon('x', 18))));
  }

  function draw() {
    if (!state.recettes.length) {
      fill(view, empty('Pas encore de recettes', 'Importez des recettes pour composer votre menu.', h('a', { class: 'btn primary', href: '#/importer' }, 'Importer des recettes')));
      return;
    }
    fill(view, 
      h('div', { class: 'week' }, days.map((date) =>
        h('section', { class: `day ${date === today() ? 'today' : ''}` },
          h('h3', {}, dayName(date), h('small', {}, dayShort(date))),
          SLOTS.map((slot) => h('div', { class: 'slot' },
            h('div', { class: 'slot-label' }, icon(slot === 'midi' ? 'sun' : 'moon', 14), SLOT_LABELS[slot]),
            mealsIn(date, slot).map(mealEl),
            h('button', { class: 'addmeal', onclick: () => add(date, slot), 'aria-label': `Ajouter un plat : ${SLOT_LABELS[slot]} ${dayName(date)}` }, icon('plus', 16), mealsIn(date, slot).length ? 'Ajouter' : 'Choisir une recette')))))));
  }

  // ------------------------------------------------------------ proposition automatique
  function proposeDialog() {
    if (!state.recettes.length) return toast('Importez d’abord des recettes.');
    const future = days.filter((d) => d >= today());
    if (!future.length) return toast('Cette semaine est passée : ouvrez une semaine à venir.');
    const opt = { jours: new Set(future), slots: new Set(['soir']), maxTemps: 0, portions: state.config.portions_defaut, tags: new Set() };
    let proposals = [];
    let m;
    const host = h('div', { class: 'stack' });

    const chipToggle = (set, value, label) => {
      const b = h('button', { type: 'button', class: `chip ${set.has(value) ? 'on' : ''}`, onclick: () => { set.has(value) ? set.delete(value) : set.add(value); b.classList.toggle('on', set.has(value)); } }, label);
      return b;
    };
    const slotsFree = () => [...opt.jours].sort().flatMap((d) => [...opt.slots].sort((a, b) => SLOTS.indexOf(a) - SLOTS.indexOf(b)).map((s) => `${d}|${s}`)).filter((k) => !mealsIn(...k.split('|')).length);

    function generate() {
      const creneaux = slotsFree();
      if (!creneaux.length) return toast('Aucun créneau libre avec ces choix.');
      proposals = autofill(state.recettes, {
        creneaux, dejaPlanifies: repas.map((x) => x.recipeId), portions: opt.portions, today: today(),
        maxTemps: opt.maxTemps || undefined, tags: [...opt.tags],
      });
      if (!proposals.length) return toast('Aucune recette ne correspond à ces critères.', { type: 'error' });
      drawProposals();
    }

    function drawOptions() {
      fill(host, 
        h('div', {}, h('strong', {}, 'Jours à remplir'), h('div', { class: 'chips', style: { marginTop: '.4rem' } }, future.map((d) => chipToggle(opt.jours, d, `${dayName(d, 'short')} ${d.slice(8)}`)))),
        h('div', {}, h('strong', {}, 'Repas'), h('div', { class: 'chips', style: { marginTop: '.4rem' } }, SLOTS.map((s) => chipToggle(opt.slots, s, SLOT_LABELS[s])))),
        h('div', { class: 'row between' }, h('strong', {}, 'Nombre de personnes'), stepper(opt.portions, (v) => (opt.portions = v), { unit: 'pers.' })),
        h('label', { class: 'field' }, 'Durée maximale',
          h('select', { onchange: (e) => (opt.maxTemps = Number(e.target.value)) }, [[0, 'Peu importe'], [30, '30 min'], [45, '45 min'], [60, '1 h']].map(([v, l]) => h('option', { value: v }, l)))),
        h('div', {}, h('strong', {}, 'Uniquement avec (facultatif)'), h('div', { class: 'chips', style: { marginTop: '.4rem' } }, tagCounts(state.recettes).slice(0, 10).map(([t]) => chipToggle(opt.tags, t, t)))),
        h('p', { class: 'small muted' }, 'Les recettes pas faites depuis longtemps et vos favorites sont privilégiées ; celles qui partagent des ingrédients sont rapprochées pour alléger les courses.'));
      setFoot([h('button', { class: 'btn', onclick: () => m.close() }, 'Annuler'), h('button', { class: 'btn primary', onclick: generate }, icon('shuffle', 18), 'Proposer')]);
    }

    function reroll(i) {
      const used = [...proposals.map((p) => p.recipeId), ...repas.map((x) => x.recipeId)];
      const pool = suggest(state.recettes, { type: 'plat', excludeIds: used, planned: [], today: today(), maxTemps: opt.maxTemps || undefined, tags: [...opt.tags], n: 3 });
      if (!pool.length) return toast('Plus d’autre idée avec ces critères.');
      const pick = pool[Math.floor(Math.random() * pool.length)];
      proposals[i] = { ...proposals[i], recipeId: pick.entry.id, raisons: pick.reasons };
      drawProposals();
    }

    function drawProposals() {
      fill(host, 
        h('p', { class: 'muted' }, `${proposals.length} repas proposés. Relancez ceux qui ne vous tentent pas.`),
        ...proposals.map((p, i) => {
          const e = entry(p.recipeId);
          return h('div', { class: 'pick', style: { cursor: 'default' } },
            h('span', {}, h('strong', {}, e.recette.titre),
              h('span', { class: 'small muted' }, `${dayName(p.date)} ${dayShort(p.date)} · ${SLOT_LABELS[p.slot]}${totalTime(e.recette) ? ` · ${fmtTime(totalTime(e.recette))}` : ''}${p.raisons?.length ? ` · ${p.raisons.join(', ')}` : ''}`)),
            h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: 0 } },
              h('button', { class: 'icon-btn', title: 'Autre idée', 'aria-label': 'Autre idée', onclick: () => reroll(i) }, icon('refresh', 18)),
              h('button', { class: 'icon-btn', title: 'Retirer', 'aria-label': 'Retirer', onclick: () => { proposals.splice(i, 1); proposals.length ? drawProposals() : drawOptions(); } }, icon('x', 18))));
        }));
      setFoot([
        h('button', { class: 'btn', onclick: drawOptions }, 'Retour'),
        h('button', { class: 'btn', onclick: generate }, icon('shuffle', 18), 'Tout relancer'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const created = await api.post('menu/lot', proposals.map(({ date, slot, recipeId, servings }) => ({ date, slot, recipeId, servings })));
            repas.push(...created);
            draw();
            m.close();
            toast(`${created.length} repas ajoutés au menu.`, { type: 'ok' });
          } catch (e) {
            toast(e.message, { type: 'error' });
          }
        } }, icon('check', 18), `Ajouter ${proposals.length} repas`),
      ]);
    }

    let foot;
    const setFoot = (btns) => fill(foot, ...btns);
    m = modal({ title: 'Proposer un menu', body: host, wide: true, actions: [] });
    foot = h('footer', { class: 'modal-foot' });
    m.el.append(foot);
    drawOptions();
  }

  draw();
}
