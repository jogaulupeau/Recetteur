import { h, icon, toast } from './dom.js';
import { api } from './api.js';
import { patchEntry, state } from './state.js';
import { fmtTime, ago, typeLabel } from './format.js';
import { totalTime } from '../shared/recipe.js';

/** Servings par défaut : la taille du foyer pour des plats « pour N personnes », sinon la quantité de la recette. */
export const defaultServings = (r) => (r.portions_unite === 'personnes' ? state.config.portions_defaut : r.portions);

export function favButton(e) {
  const btn = h('button', {
    class: `icon-btn fav ${e.favori ? 'on' : ''}`,
    title: e.favori ? 'Retirer des favoris' : 'Ajouter aux favoris',
    'aria-pressed': String(!!e.favori),
    onclick: async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const updated = await api.patch(`recettes/${e.id}`, { favori: !e.favori });
      patchEntry(updated);
      e.favori = updated.favori;
      btn.classList.toggle('on', e.favori);
      btn.setAttribute('aria-pressed', String(e.favori));
      btn.title = e.favori ? 'Retirer des favoris' : 'Ajouter aux favoris';
    },
  }, icon('heart'));
  return btn;
}

export function metaLine(e) {
  const r = e.recette;
  const t = totalTime(r);
  return h('div', { class: 'meta' },
    t ? h('span', {}, icon('clock', 15), fmtTime(t)) : null,
    h('span', {}, icon('users', 15), `${r.portions} ${r.portions_unite === 'personnes' ? 'pers.' : r.portions_unite}`),
    r.difficulte ? h('span', {}, r.difficulte) : null,
  );
}

export function recipeCard(e, { reasons = [], manquants = [] } = {}) {
  const r = e.recette;
  return h('a', { class: 'rcard', href: `#/recette/${encodeURIComponent(e.id)}` },
    r.image ? h('img', { class: 'cover', src: r.image, alt: '', loading: 'lazy', onerror: (ev) => ev.target.remove() }) : null,
    favButton(e),
    h('div', {}, h('span', { class: 'badge' }, typeLabel(r.type))),
    h('h3', {}, r.titre),
    metaLine(e),
    r.tags.length ? h('div', { class: 'chips' }, r.tags.slice(0, 4).map((t) => h('span', { class: 'tag' }, t))) : null,
    e.derniere_cuisson ? h('div', { class: 'small muted' }, `Cuisinée ${ago(e.derniere_cuisson)}`) : null,
    reasons.length ? h('div', { class: 'reasons' }, reasons.join(' · ')) : null,
    manquants.length ? h('div', { class: 'small muted' }, `Manque : ${manquants.slice(0, 4).join(', ')}${manquants.length > 4 ? '…' : ''}`) : null,
  );
}

export async function loadExamples() {
  const bundle = await api.get('exemple');
  const res = await api.post('import', bundle);
  await (await import('./state.js')).reloadRecettes();
  toast(`${res.resume.nouveaux} recette(s) d’exemple ajoutée(s).`, { type: 'ok' });
  return res;
}
