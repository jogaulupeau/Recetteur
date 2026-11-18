import { h, icon, stepper, stars, toast, confirmDialog, clear, fill } from '../dom.js';
import { api } from '../api.js';
import { entry, dropEntry, patchEntry } from '../state.js';
import { favButton, defaultServings } from '../cards.js';
import { addToMenuDialog } from '../picker.js';
import { fmtTime, typeLabel, ago } from '../format.js';
import { visual, photoActions, sendPhoto } from '../photo.js';
import { formatIngredient } from '../../shared/quantity.js';
import { stepSegments, stepTimers } from '../../shared/steps.js';
import { stepTimerButtons, alertControl } from '../timers.js';
import { totalTime } from '../../shared/recipe.js';
import { today } from '../../shared/dates.js';

export function render({ params: [id], query, root }) {
  const e = entry(id);
  if (!e) {
    root.append(h('div', { class: 'card empty' }, h('h2', {}, 'Recette introuvable'), h('a', { class: 'btn', href: '#/recettes' }, 'Voir toutes les recettes')));
    return;
  }
  const r = e.recette;
  let portions = Number(query.get('p')) || defaultServings(r);

  const ingBox = h('div', {});
  const stepsBox = h('ol', { class: 'steps' });
  const metaBits = h('div', { class: 'meta' },
    totalTime(r) ? h('span', {}, icon('clock', 16), `${fmtTime(totalTime(r))}`,
      r.temps_preparation || r.temps_cuisson || r.temps_repos ? h('span', { class: 'small' }, `(${[
        r.temps_preparation ? `prépa ${fmtTime(r.temps_preparation)}` : '',
        r.temps_cuisson ? `cuisson ${fmtTime(r.temps_cuisson)}` : '',
        r.temps_repos ? `repos ${fmtTime(r.temps_repos)}` : ''].filter(Boolean).join(' · ')})`) : null) : null,
    r.difficulte ? h('span', {}, r.difficulte) : null,
    r.cuisine ? h('span', {}, `Cuisine ${r.cuisine}`) : null,
    e.derniere_cuisson ? h('span', {}, `Cuisinée ${ago(e.derniere_cuisson)} (${e.nb_cuissons}×)`) : null);

  function draw() {
    clear(ingBox);
    // Une <ul> par groupe d'ingrédients (« Vinaigrette », « Pour la pâte »…).
    let current = null, currentGroup = Symbol();
    for (const ing of r.ingredients) {
      if ((ing.groupe ?? '') !== currentGroup) {
        currentGroup = ing.groupe ?? '';
        if (currentGroup) ingBox.append(h('div', { class: 'ing-group' }, currentGroup));
        current = h('ul', { class: 'ing-list' });
        ingBox.append(current);
      }
      current.append(h('li', { class: ing.optionnel ? 'optional' : '' }, formatIngredient(ing, r.portions, portions)));
    }
    clear(stepsBox);
    r.etapes.forEach((s, i) => {
      stepsBox.append(h('li', {},
        s.titre ? h('h4', {}, s.titre) : null,
        h('div', {}, stepSegments(s.texte, r, portions).map((seg) => (seg.qte ? h('span', { class: 'q' }, seg.qte) : seg.texte))),
        stepTimers(s).length ? stepTimerButtons(e, i + 1, s, { size: 'sm' }) : null));
    });
  }
  draw();

  const cookLink = () => `#/recette/${encodeURIComponent(e.id)}/cuisiner?p=${portions}`;
  const cookBtn = h('a', { class: 'btn primary lg', href: cookLink() }, icon('play', 20), 'Cuisiner pas à pas');
  const setPortions = (v) => { portions = v; cookBtn.href = cookLink(); draw(); };

  const memo = h('textarea', { rows: 3, placeholder: 'Vos notes : ce qu’il faudrait changer, qui a aimé…', 'aria-label': 'Notes personnelles', onblur: async () => {
    if (memo.value !== e.memo) { patchEntry(await api.patch(`recettes/${e.id}`, { memo: memo.value })); toast('Notes enregistrées.'); }
  } }, e.memo);

  // Photo de la recette (sinon l'image indiquée dans la recette, sinon l'illustration). Glisser-déposer possible.
  const media = h('div', { class: 'hero-media' });
  const drawMedia = () => fill(media, visual(e, { className: 'plate', fit: 'slice', thumb: false }), photoActions(e, { onChange: drawMedia }));
  drawMedia();
  media.addEventListener('dragover', (ev) => (ev.preventDefault(), media.classList.add('drop')));
  media.addEventListener('dragleave', () => media.classList.remove('drop'));
  media.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    media.classList.remove('drop');
    const file = [...(ev.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    media.classList.add('busy');
    await sendPhoto(e, file, drawMedia);
    media.classList.remove('busy');
  });

  async function remove() {
    if (!(await confirmDialog(`Supprimer « ${r.titre} » ? Elle sera aussi retirée du menu.`, { ok: 'Supprimer', danger: true }))) return;
    await api.del(`recettes/${e.id}`);
    dropEntry(e.id);
    toast('Recette supprimée.');
    location.hash = '#/recettes';
  }
  async function markCooked() {
    patchEntry(await api.post(`recettes/${e.id}/cuisinee`, { date: today() }));
    toast('Notée comme cuisinée aujourd’hui. 👨‍🍳', { type: 'ok' });
    location.reload();
  }
  async function exportJson() {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${e.id}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  root.append(
    h('a', { class: 'btn ghost sm', href: '#/recettes' }, icon('left', 16), 'Recettes'),
    h('div', { class: 'hero', 'data-type': r.type },
      media,
      h('div', { class: 'hero-text' },
        h('div', { class: 'row between' }, h('div', { class: 'row' }, h('span', { class: 'badge' }, typeLabel(r.type)), r.tags.map((t) => h('span', { class: 'tag' }, t))), favButton(e)),
        h('h1', {}, r.titre),
        r.description ? h('p', { class: 'muted', style: { margin: 0, fontSize: '1.05rem' } }, r.description) : null,
        metaBits,
        h('div', { class: 'row' }, cookBtn,
          h('button', { class: 'btn', onclick: () => addToMenuDialog(e) }, icon('calendar', 18), 'Ajouter au menu'),
          h('button', { class: 'btn', onclick: markCooked, title: 'Noter comme cuisinée aujourd’hui' }, icon('check', 18), 'Cuisinée')))),
    h('div', { class: 'recipe-cols' },
      h('section', { class: 'card fiche sticky', 'data-type': r.type },
        h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, 'Ingrédients'), stepper(portions, setPortions, { unit: r.portions_unite })),
        r.portions_unite === 'personnes' && portions !== r.portions ? h('p', { class: 'small muted' }, `Recette d’origine : ${r.portions} personnes.`) : null,
        ingBox,
        r.materiel?.length ? h('div', {}, h('div', { class: 'ing-group' }, 'Matériel'), h('p', { class: 'small' }, r.materiel.join(' · '))) : null),
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, 'Préparation'), r.etapes.some((x) => stepTimers(x).length) ? alertControl() : null), stepsBox),
        r.notes || r.conservation || r.source ? h('section', { class: 'card stack' },
          r.notes ? h('div', {}, h('h3', {}, 'Notes'), h('p', { style: { whiteSpace: 'pre-line', margin: 0 } }, r.notes)) : null,
          r.conservation ? h('div', {}, h('h3', {}, 'Conservation'), h('p', { style: { margin: 0 } }, r.conservation)) : null,
          r.source ? h('p', { class: 'small muted', style: { margin: 0 } }, 'Source : ', /^https?:\/\//.test(r.source) ? h('a', { href: r.source, target: '_blank', rel: 'noopener noreferrer' }, r.source) : r.source) : null) : null,
        h('section', { class: 'card stack tight' }, h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, 'Votre avis'), stars(e.etoiles || 0, async (n) => { patchEntry(await api.patch(`recettes/${e.id}`, { etoiles: n })); location.reload(); })), memo),
        h('div', { class: 'row' },
          h('a', { class: 'btn sm', href: `#/recette/${encodeURIComponent(e.id)}/modifier` }, icon('edit', 16), 'Modifier'),
          h('button', { class: 'btn sm', onclick: exportJson }, icon('upload', 16), 'Exporter (JSON)'),
          h('button', { class: 'btn sm', onclick: () => window.print() }, icon('list', 16), 'Imprimer'),
          h('button', { class: 'btn sm danger', onclick: remove }, icon('trash', 16), 'Supprimer')))));
}
