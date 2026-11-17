// Liste de courses : additionne les ingrédients de plusieurs repas, convertit les unités,
// regroupe par rayon.
import { RAYONS } from './vocab.js';
import { canonicalUnit, toBase, fromBase, kitchenRound, formatAmount, isPlural } from './quantity.js';
import { ingredientKey, pluralize, capitalize } from './text.js';

const RAYON_ORDER = Object.keys(RAYONS);

/**
 * @param {{recipeId:string, servings:number}[]} repas  un élément par recette planifiée
 * @param {Map<string, object>|((id:string)=>object|undefined)} recettes  id → recette (document)
 */
export function buildShoppingList(repas, recettes) {
  const get = typeof recettes === 'function' ? recettes : (id) => recettes.get(id);
  const items = new Map();

  for (const meal of repas) {
    const r = get(meal.recipeId);
    if (!r) continue;
    const portions = meal.servings || r.portions;
    for (const ing of r.ingredients) {
      const key = ingredientKey(ing.nom);
      let it = items.get(key);
      if (!it) {
        it = { key, nom: ing.nom, nom_pluriel: ing.nom_pluriel, rayon: ing.rayon || 'autre', basique: true, lines: new Map(), auGout: false, recettes: [] };
        items.set(key, it);
      }
      if (it.rayon === 'autre' && ing.rayon) it.rayon = ing.rayon;
      if (!ing.basique) it.basique = false;
      if (!it.recettes.some((x) => x.id === meal.recipeId)) it.recettes.push({ id: meal.recipeId, titre: r.titre });

      if (ing.quantite == null) {
        it.auGout = true;
        continue;
      }
      const factor = ing.fixe ? 1 : portions / r.portions;
      const unit = canonicalUnit(ing.unite) ?? String(ing.unite ?? '').trim();
      const lo = toBase(ing.quantite * factor, unit);
      const hi = toBase((ing.quantite_max ?? ing.quantite) * factor, unit);
      const line = it.lines.get(lo.unit) ?? { unite: lo.unit, min: 0, max: 0, range: false };
      line.min += lo.q;
      line.max += hi.q;
      if (ing.quantite_max != null) line.range = true;
      it.lines.set(lo.unit, line);
    }
  }

  const out = [];
  for (const it of items.values()) {
    const quantites = [...it.lines.values()].map((l) => {
      const rl = kitchenRound(l.min, l.unite);
      const rh = kitchenRound(l.max, l.unite);
      const f = fromBase(rh, l.unite);
      const div = f.unit !== l.unite ? 1000 : 1;
      return { min: rl / div, max: l.range && rh !== rl ? rh / div : null, unite: f.unit };
    });
    // Un ingrédient compté en pièces (2 oignons + 1 oignon) : nom au pluriel si besoin.
    const solo = quantites.length === 1 && !quantites[0].unite ? quantites[0] : null;
    const plural = solo && isPlural(solo.max ?? solo.min);
    const nom = plural ? it.nom_pluriel || pluralize(it.nom) : it.nom;
    out.push({
      key: it.key,
      nom,
      rayon: it.rayon,
      basique: it.basique,
      auGout: it.auGout,
      quantites,
      quantite: quantites.map((q) => formatAmount(q)).join(' + '),
      recettes: it.recettes,
    });
  }
  out.sort((a, b) => RAYON_ORDER.indexOf(a.rayon) - RAYON_ORDER.indexOf(b.rayon) || a.nom.localeCompare(b.nom, 'fr'));
  return out;
}

/** [{ rayon, label, items }] dans l'ordre du magasin. */
export function groupByAisle(items) {
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.rayon)) groups.set(it.rayon, { rayon: it.rayon, label: RAYONS[it.rayon] ?? 'Autre', items: [] });
    groups.get(it.rayon).items.push(it);
  }
  return [...groups.values()].sort((a, b) => RAYON_ORDER.indexOf(a.rayon) - RAYON_ORDER.indexOf(b.rayon));
}

/** Libellé d'une ligne : « Tomates pelées — 800 g ». */
export const itemLabel = (it) => (it.quantite ? `${capitalize(it.nom)} — ${it.quantite}` : capitalize(it.nom));

/** Texte brut à coller dans un message ou une note. */
export function shoppingToText(groups, { titre = 'Liste de courses', checked = new Set() } = {}) {
  const lines = [titre, ''];
  for (const g of groups) {
    const todo = g.items.filter((i) => !checked.has(i.key));
    if (!todo.length) continue;
    lines.push(g.label.toUpperCase());
    for (const it of todo) lines.push(`- ${itemLabel(it)}`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}
