// Recherche et filtres, côté navigateur (quelques centaines de recettes : instantané).
import { normalize, ingredientKey } from './text.js';
import { TYPES } from './vocab.js';
import { totalTime } from './recipe.js';

const cache = new WeakMap();

function index(entry) {
  let ix = cache.get(entry.recette);
  if (!ix) {
    const r = entry.recette;
    ix = {
      titre: normalize(r.titre),
      tags: normalize([...(r.tags || []), r.cuisine || '', TYPES[r.type] || ''].join(' ')),
      ingredients: normalize(r.ingredients.map((i) => i.nom).join(' ')),
      texte: normalize([r.description, r.notes, r.etapes.map((e) => e.texte).join(' ')].join(' ')),
    };
    cache.set(entry.recette, ix);
  }
  return ix;
}

/** Score de pertinence d'un mot dans une recette ; 0 = absent. */
function tokenScore(ix, tok) {
  let s = 0;
  if (ix.titre.startsWith(tok)) s += 16;
  else if (ix.titre.includes(` ${tok}`)) s += 12;
  else if (ix.titre.includes(tok)) s += 9;
  if (ix.tags.includes(tok)) s += 6;
  if (ix.ingredients.includes(tok)) s += 4;
  if (ix.texte.includes(tok)) s += 1;
  return s;
}

/**
 * @param {object[]} entries  entrées { id, recette, favori, … }
 * @param {{q?:string, type?:string, tags?:string[], favoris?:boolean, maxTemps?:number, difficulte?:string, tri?:string}} f
 */
export function searchRecipes(entries, f = {}) {
  const tokens = normalize(f.q || '').split(' ').filter(Boolean);
  const res = [];
  for (const e of entries) {
    const r = e.recette;
    if (f.type && r.type !== f.type) continue;
    if (f.favoris && !e.favori) continue;
    if (f.difficulte && r.difficulte !== f.difficulte) continue;
    if (f.maxTemps && totalTime(r) > f.maxTemps) continue;
    if (f.tags?.length && !f.tags.every((t) => r.tags.includes(t))) continue;
    let score = 0;
    if (tokens.length) {
      const ix = index(e);
      let ok = true;
      for (const t of tokens) {
        const s = tokenScore(ix, t);
        if (!s) { ok = false; break; }
        score += s;
      }
      if (!ok) continue;
    }
    res.push({ e, score });
  }
  const tri = f.tri || (tokens.length ? 'pertinence' : 'titre');
  const by = {
    pertinence: (a, b) => b.score - a.score || a.e.recette.titre.localeCompare(b.e.recette.titre, 'fr'),
    titre: (a, b) => a.e.recette.titre.localeCompare(b.e.recette.titre, 'fr'),
    recent: (a, b) => (b.e.cree_le || '').localeCompare(a.e.cree_le || ''),
    rapide: (a, b) => totalTime(a.e.recette) - totalTime(b.e.recette),
    cuisine: (a, b) => (b.e.derniere_cuisson || '').localeCompare(a.e.derniere_cuisson || ''),
  }[tri];
  return res.sort(by).map((x) => x.e);
}

/** Tous les mots-clés avec leur fréquence, du plus courant au plus rare. */
export function tagCounts(entries) {
  const m = new Map();
  for (const e of entries) for (const t of e.recette.tags) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
}

/** Clés d'ingrédients hors « basiques » : sert au rapprochement avec ce qu'on a en stock. */
export function mainIngredientKeys(recette) {
  return recette.ingredients.filter((i) => !i.basique).map((i) => ingredientKey(i.nom));
}
