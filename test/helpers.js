import { readFileSync } from 'node:fs';
import { validateBundle } from '../shared/recipe.js';

export const exemples = validateBundle(JSON.parse(readFileSync(new URL('../examples/recettes-exemple.json', import.meta.url), 'utf8'))).map((x) => x.recipe);

/** Entrées telles que renvoyées par l'API. */
export const entrees = exemples.map((recette, i) => ({
  id: recette.titre.toLowerCase().replace(/[^a-z]+/g, '-'),
  recette,
  favori: false,
  derniere_cuisson: null,
  nb_cuissons: 0,
  cree_le: `2026-01-0${i + 1}`,
}));
export const byTitle = (t) => entrees.find((e) => e.recette.titre.startsWith(t));
