import { h, icon, toast, empty, debounce, fill } from '../dom.js';
import { api } from '../api.js';
import { state, docMap } from '../state.js';
import { today, addDays, weekStart, weekDays, weekLabel, dayName } from '../../shared/dates.js';
import { buildShoppingList, groupByAisle, itemLabel, shoppingToText } from '../../shared/shopping.js';
import { RAYONS } from '../../shared/vocab.js';

export async function render({ params: [week], root }) {
  const monday = weekStart(week || today());
  const days = weekDays(monday);
  const [repas, saved, stock0] = await Promise.all([
    api.get(`menu?du=${monday}&au=${addDays(monday, 6)}`),
    api.get(`courses/${monday}`),
    api.get('stock'),
  ]);
  const coches = new Set(saved.coches);
  let manuels = saved.manuels;
  const stock = new Set(stock0);
  // Par défaut : les jours à venir (courses faites en début de semaine → toute la semaine).
  const included = new Set(days.filter((d) => monday !== weekStart(today()) || d >= today() || !repas.some((m) => m.date >= today())));
  const recettes = docMap();

  const go = (m) => (location.hash = `#/courses/${m}`);
  const saveSoon = debounce(() => api.put(`courses/${monday}`, { coches: [...coches], manuels }).catch((e) => toast(e.message, { type: 'error' })), 300);
  const saveStock = () => api.put('stock', [...stock]).catch((e) => toast(e.message, { type: 'error' }));

  const body = h('div', {});
  const dayBar = h('div', { class: 'daypick' });
  const input = h('input', { type: 'text', placeholder: 'Ajouter un article (papier toilette, lessive…)', 'aria-label': 'Ajouter un article', maxLength: 200 });
  const addManual = () => {
    const t = input.value.trim();
    if (!t) return;
    manuels.push({ id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, texte: t, coche: false });
    input.value = '';
    saveSoon();
    draw();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && addManual());

  root.append(
    h('div', { class: 'page-head' },
      h('div', { class: 'weeknav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Semaine précédente', onclick: () => go(addDays(monday, -7)) }, icon('left', 22)),
        h('div', { class: 'label' }, weekLabel(monday)),
        h('button', { class: 'icon-btn', 'aria-label': 'Semaine suivante', onclick: () => go(addDays(monday, 7)) }, icon('right', 22))),
      h('a', { class: 'btn', href: `#/menu/${monday}` }, icon('calendar', 18), 'Voir le menu')),
    h('div', { class: 'stack tight', style: { marginBottom: '1rem' } },
      h('div', { class: 'small muted' }, 'Repas pris en compte :'), dayBar),
    body);

  function current() {
    const meals = repas.filter((m) => included.has(m.date));
    const items = buildShoppingList(meals.map((m) => ({ recipeId: m.recipeId, servings: m.servings })), recettes);
    return { meals, items };
  }

  function toggle(key, on) {
    on ? coches.add(key) : coches.delete(key);
    saveSoon();
    draw();
  }

  function itemRow(it) {
    const done = coches.has(it.key);
    return h('li', { class: `item ${done ? 'checked' : ''}` },
      h('input', { type: 'checkbox', id: `i-${it.key}`, checked: done, onchange: (e) => toggle(it.key, e.target.checked) }),
      h('label', { for: `i-${it.key}` },
        h('span', { class: 'name' }, it.nom),
        it.recettes.length ? h('span', { class: 'from' }, `pour ${it.recettes.map((r) => r.titre).join(', ')}`) : null),
      it.quantite ? h('span', { class: 'qty' }, it.quantite) : null,
      h('button', { class: 'icon-btn', title: 'Toujours en stock : ne plus l’afficher', 'aria-label': `${it.nom} : toujours en stock`, onclick: () => { stock.add(it.key); saveStock(); draw(); } }, icon('home', 18)));
  }

  function draw() {
    fill(dayBar, ...days.map((d) => {
      const n = repas.filter((m) => m.date === d).length;
      const b = h('button', { type: 'button', class: `chip ${included.has(d) ? 'on' : ''}`, disabled: !n, title: n ? `${n} repas` : 'Aucun repas',
        onclick: () => { included.has(d) ? included.delete(d) : included.add(d); draw(); } }, `${dayName(d, 'short')} `, h('small', {}, n || '–'));
      return b;
    }));

    const { meals, items } = current();
    if (!state.recettes.length || !repas.length) {
      fill(body, empty('Rien à acheter pour le moment', 'Composez d’abord le menu de la semaine : la liste de courses se construit toute seule.', h('a', { class: 'btn primary', href: `#/menu/${monday}` }, 'Composer le menu')));
      return;
    }
    if (!meals.length) {
      fill(body, empty('Aucun jour sélectionné', 'Choisissez au moins un jour ci-dessus.'));
      return;
    }

    const toBuy = items.filter((i) => !i.basique && !stock.has(i.key));
    const basics = items.filter((i) => i.basique && !stock.has(i.key));
    const stocked = items.filter((i) => stock.has(i.key));
    const total = toBuy.length + manuels.length;
    const done = toBuy.filter((i) => coches.has(i.key)).length + manuels.filter((m) => m.coche).length;

    const groups = groupByAisle(toBuy).map((g) => ({
      ...g,
      items: [...g.items].sort((a, b) => Number(coches.has(a.key)) - Number(coches.has(b.key))),
    }));

    const textList = () => {
      const open = new Set([...coches]);
      let t = shoppingToText(groupByAisle(toBuy), { titre: `Courses — semaine du ${weekLabel(monday)}`, checked: open }).trimEnd();
      const man = manuels.filter((m) => !m.coche).map((m) => `- ${m.texte}`);
      if (man.length) t += `\n\nAUTRES\n${man.join('\n')}`;
      return t + '\n';
    };
    const haItems = () => [...groupByAisle(toBuy).flatMap((g) => g.items.filter((i) => !coches.has(i.key)).map(itemLabel)), ...manuels.filter((m) => !m.coche).map((m) => m.texte)];

    fill(body, 
      h('div', { class: 'stack tight', style: { marginBottom: '1rem' } },
        h('div', { class: 'row between' }, h('strong', {}, `${done} / ${total} article${total > 1 ? 's' : ''}`), h('span', { class: 'small muted' }, `${meals.length} repas`)),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done }, h('i', { style: { width: `${total ? (done / total) * 100 : 0}%` } })),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: async () => { await navigator.clipboard.writeText(textList()); toast('Liste copiée.', { type: 'ok' }); } }, icon('copy', 16), 'Copier'),
          navigator.share ? h('button', { class: 'btn sm', onclick: () => navigator.share({ title: 'Courses', text: textList() }).catch(() => {}) }, icon('share', 16), 'Partager') : null,
          state.config.ha ? h('button', { class: 'btn sm', title: `Ajoute les articles restants à ${state.config.ha_todo_entity}`, onclick: async (ev) => {
            const btn = ev.currentTarget;
            const list = haItems();
            if (!list.length) return toast('Tout est déjà coché.');
            btn.disabled = true;
            try {
              const r = await api.post('courses-ha', { items: list });
              toast(`${r.envoyes} article(s) ajouté(s) à ${r.liste}.${r.echecs.length ? ` ${r.echecs.length} en échec.` : ''}`, { type: r.echecs.length ? 'info' : 'ok' });
            } catch (e) { toast(e.message, { type: 'error' }); }
            btn.disabled = false;
          } }, icon('ha', 16), 'Vers Home Assistant') : null,
          coches.size || manuels.some((m) => m.coche) ? h('button', { class: 'btn sm ghost', onclick: () => { coches.clear(); manuels.forEach((m) => (m.coche = false)); saveSoon(); draw(); } }, 'Tout décocher') : null)),

      h('div', { class: 'row', style: { marginBottom: '1rem', flexWrap: 'nowrap' } }, h('div', { class: 'grow' }, input), h('button', { class: 'btn', onclick: addManual }, icon('plus', 18), 'Ajouter')),

      ...groups.map((g) => h('section', { class: 'aisle', 'data-rayon': g.rayon }, h('h3', {}, g.label), h('ul', { class: 'items' }, g.items.map(itemRow)))),

      manuels.length ? h('section', { class: 'aisle' }, h('h3', {}, 'Ajoutés à la main'), h('ul', { class: 'items' }, manuels.map((m) =>
        h('li', { class: `item ${m.coche ? 'checked' : ''}` },
          h('input', { type: 'checkbox', id: `i-${m.id}`, checked: m.coche, onchange: (e) => { m.coche = e.target.checked; saveSoon(); draw(); } }),
          h('label', { for: `i-${m.id}` }, h('span', { class: 'name' }, m.texte)),
          h('button', { class: 'icon-btn', title: 'Supprimer', 'aria-label': `Supprimer ${m.texte}`, onclick: () => { manuels = manuels.filter((x) => x !== m); saveSoon(); draw(); } }, icon('x', 18)))))) : null,

      basics.length ? h('details', { class: 'fold' }, h('summary', {}, `Placard à vérifier (${basics.length})`, h('span', { class: 'small' }, ' — sel, huile, épices…')),
        h('ul', { class: 'items' }, basics.map(itemRow))) : null,

      stocked.length ? h('details', { class: 'fold' }, h('summary', {}, `Toujours en stock (${stocked.length})`),
        h('ul', { class: 'items' }, stocked.map((it) => h('li', { class: 'item' },
          h('label', {}, h('span', { class: 'name' }, it.nom), it.quantite ? h('span', { class: 'from' }, `${it.quantite} nécessaire${RAYONS[it.rayon] ? ` · ${RAYONS[it.rayon]}` : ''}`) : null),
          h('button', { class: 'btn sm', onclick: () => { stock.delete(it.key); saveStock(); draw(); } }, 'Remettre sur la liste'))))) : null);
  }

  draw();
}
