import { api } from './api.js';

export const state = { recettes: [], config: { portions_defaut: 4, ha: false }, index: new Map() };

function reindex() {
  state.index = new Map(state.recettes.map((e) => [e.id, e]));
}

export async function init() {
  const [config, recettes] = await Promise.all([api.get('config'), api.get('recettes')]);
  state.config = config;
  state.recettes = recettes;
  reindex();
}

export const reloadRecettes = async () => {
  state.recettes = await api.get('recettes');
  reindex();
};

export const entry = (id) => state.index.get(id);
export const docMap = () => new Map(state.recettes.map((e) => [e.id, e.recette]));

/** Met à jour une entrée en place après une réponse du serveur. */
export function patchEntry(e) {
  const i = state.recettes.findIndex((x) => x.id === e.id);
  if (i >= 0) state.recettes[i] = e;
  else state.recettes.push(e);
  reindex();
  return e;
}
export function dropEntry(id) {
  state.recettes = state.recettes.filter((e) => e.id !== id);
  reindex();
}
