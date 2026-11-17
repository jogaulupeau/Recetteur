import { h, icon, toast, debounce } from '../dom.js';
import { api } from '../api.js';
import { entry, patchEntry } from '../state.js';
import { validateRecipe } from '../../shared/recipe.js';
import { extractJson } from '../../shared/import.js';

export function render({ params: [id], root }) {
  const e = entry(id);
  if (!e) {
    root.append(h('div', { class: 'card empty' }, h('h2', {}, 'Recette introuvable'), h('a', { class: 'btn', href: '#/recettes' }, 'Retour')));
    return;
  }
  const area = h('textarea', { class: 'code', rows: 28, spellcheck: false, 'aria-label': 'Recette au format JSON' }, JSON.stringify(e.recette, null, 2));
  const report = h('div', { class: 'stack tight' });
  const save = h('button', { class: 'btn primary', onclick: doSave }, icon('check', 18), 'Enregistrer');
  let parsed = null;

  function check() {
    parsed = null;
    report.replaceChildren();
    let data;
    try {
      data = extractJson(area.value);
    } catch (err) {
      report.append(h('div', { class: 'status bad' }, err.message));
      save.disabled = true;
      return;
    }
    const { recipe, errors, warnings } = validateRecipe(data);
    save.disabled = !recipe;
    if (recipe) parsed = data;
    if (errors.length) report.append(h('div', { class: 'status bad' }, h('strong', {}, 'À corriger'), h('ul', {}, errors.map((x) => h('li', { class: 'err' }, x)))));
    if (warnings.length) report.append(h('div', { class: 'status' }, h('strong', {}, 'Remarques'), h('ul', {}, warnings.map((x) => h('li', { class: 'warn' }, x)))));
    if (recipe && !warnings.length) report.append(h('div', { class: 'small muted' }, '✓ Format valide.'));
  }
  async function doSave() {
    try {
      const updated = await api.put(`recettes/${e.id}`, parsed);
      patchEntry(updated);
      toast('Recette enregistrée.', { type: 'ok' });
      location.hash = `#/recette/${encodeURIComponent(e.id)}`;
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }
  area.addEventListener('input', debounce(check, 200));
  root.append(
    h('a', { class: 'btn ghost sm', href: `#/recette/${encodeURIComponent(e.id)}` }, icon('left', 16), 'Annuler'),
    h('div', { class: 'page-head' }, h('h1', {}, `Modifier « ${e.recette.titre} »`), save),
    h('p', { class: 'muted' }, 'La recette est éditée au format JSON, le même que celui produit par Claude. Les quantités sont pour le nombre de « portions » indiqué ; l’application les ajuste ensuite.'),
    area, report);
  check();
}
