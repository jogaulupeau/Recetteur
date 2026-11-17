// Propositions de recettes et remplissage automatique du menu de la semaine.
import { totalTime } from './recipe.js';
import { mainIngredientKeys } from './search.js';
import { ingredientKey } from './text.js';
import { daysBetween } from './dates.js';

/**
 * Classe les recettes à proposer. Le tirage reste aléatoire (pour varier d'un jour à l'autre)
 * mais pondéré : pas cuisiné depuis longtemps, favori, ingrédients déjà en stock ou déjà au menu.
 *
 * @param {object[]} entries
 * @param {object} o
 * @param {string} [o.type='plat']  type de plat voulu ('' = tous)
 * @param {number} [o.maxTemps]     temps total max en minutes
 * @param {string[]} [o.tags]       mots-clés exigés
 * @param {string[]} [o.sansTags]   mots-clés exclus
 * @param {string[]} [o.excludeIds]
 * @param {string[]} [o.have]       ingrédients disponibles (texte libre)
 * @param {object[]} [o.planned]    recettes (documents) déjà prévues : on favorise les ingrédients communs
 * @param {string} o.today          AAAA-MM-JJ
 * @param {()=>number} [o.rng]
 * @param {number} [o.n=5]
 */
export function suggest(entries, o) {
  const { type = 'plat', maxTemps, tags = [], sansTags = [], excludeIds = [], have = [], planned = [], today, rng = Math.random, n = 5 } = o;
  const exclude = new Set(excludeIds);
  const haveKeys = new Set(have.map(ingredientKey).filter(Boolean));
  const plannedKeys = new Set(planned.flatMap((r) => mainIngredientKeys(r)));
  const plannedTags = new Set(planned.flatMap((r) => r.tags));

  const scored = [];
  for (const e of entries) {
    const r = e.recette;
    if (exclude.has(e.id)) continue;
    if (type && r.type !== type) continue;
    if (maxTemps && totalTime(r) > maxTemps) continue;
    if (tags.length && !tags.every((t) => r.tags.includes(t))) continue;
    if (sansTags.some((t) => r.tags.includes(t))) continue;

    const reasons = [];
    let score = rng() * 1.5;

    if (!e.derniere_cuisson) {
      score += 1.2;
      if (e.nb_cuissons === 0 || e.nb_cuissons == null) reasons.push('jamais cuisinée');
    } else {
      const d = daysBetween(e.derniere_cuisson, today);
      if (d < 10) score -= 3;
      else if (d > 30) reasons.push('pas faite depuis un moment');
      score += Math.min(d / 30, 1.5);
    }
    if (e.favori) { score += 0.8; reasons.push('favorite'); }
    if (e.etoiles) score += (e.etoiles - 3) * 0.25;

    const keys = mainIngredientKeys(r);
    let manquants = [];
    if (haveKeys.size && keys.length) {
      const hit = keys.filter((k) => [...haveKeys].some((h) => k === h || k.includes(h) || h.includes(k)));
      score += 4 * (hit.length / keys.length);
      manquants = r.ingredients.filter((i) => !i.basique && !hit.includes(ingredientKey(i.nom))).map((i) => i.nom);
      if (hit.length) reasons.push(`${hit.length}/${keys.length} ingrédients déjà là`);
    }
    if (plannedKeys.size && keys.length) {
      const shared = keys.filter((k) => plannedKeys.has(k)).length;
      if (shared) { score += 2 * (shared / keys.length); reasons.push('ingrédients communs avec le menu'); }
    }
    // Variété : on évite d'enchaîner deux fois le même mot-clé principal (poulet, pâtes…).
    const repeated = r.tags.filter((t) => plannedTags.has(t)).length;
    score -= Math.min(repeated, 3) * 0.35;

    scored.push({ entry: e, score, reasons, manquants });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, n);
}

/**
 * Propose des repas pour les créneaux libres. Ne modifie rien : renvoie la liste à valider.
 * @param {object[]} entries
 * @param {object} o
 * @param {string[]} o.creneaux  clés « date|slot » à remplir
 * @param {Map<string,object>} o.recettes  id → document (pour les recettes déjà planifiées)
 * @param {string[]} o.dejaPlanifies  ids déjà dans la semaine
 * @param {number} [o.portions=4]
 */
export function autofill(entries, o) {
  const { creneaux, dejaPlanifies = [], portions = 4, today, rng, type = 'plat', ...filters } = o;
  const used = [...dejaPlanifies];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const planned = used.map((id) => byId.get(id)?.recette).filter(Boolean);
  const out = [];
  for (const key of creneaux) {
    const [date, slot] = key.split('|');
    let pick = suggest(entries, { ...filters, type, excludeIds: used, planned, today, rng, n: 1 })[0];
    if (!pick) pick = suggest(entries, { ...filters, type, excludeIds: [], planned, today, rng, n: 1 })[0]; // moins de recettes que de repas : on répète
    if (!pick) break;
    used.push(pick.entry.id);
    planned.push(pick.entry.recette);
    out.push({ date, slot, recipeId: pick.entry.id, servings: portions, raisons: pick.reasons });
  }
  return out;
}

