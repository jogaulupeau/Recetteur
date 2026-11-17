// Texte d'une étape avec les quantités mises à l'échelle : « Ajoutez {{boeuf}} de viande » → « Ajoutez 600 g de viande ».
import { STEP_TOKEN } from './recipe.js';
import { scaleAmount, formatAmount } from './quantity.js';

/** Découpe en segments { texte } ou { qte, id } (la quantité s'affiche en gras dans l'interface). */
export function stepSegments(texte, recette, portions) {
  const byId = new Map(recette.ingredients.map((i) => [i.id, i]));
  const out = [];
  let last = 0;
  for (const m of texte.matchAll(STEP_TOKEN)) {
    if (m.index > last) out.push({ texte: texte.slice(last, m.index) });
    const ing = byId.get(m[1].toLowerCase());
    const qte = ing ? formatAmount(scaleAmount(ing, recette.portions, portions)) : '';
    out.push(qte ? { qte, id: m[1] } : { texte: ing ? 'la quantité souhaitée' : m[0] });
    last = m.index + m[0].length;
  }
  if (last < texte.length) out.push({ texte: texte.slice(last) });
  return out;
}

export const stepPlainText = (texte, recette, portions) =>
  stepSegments(texte, recette, portions).map((s) => s.qte ?? s.texte).join('');

/**
 * Minuteurs proposés pour une étape : `minuteurs` s'il existe, sinon `duree` comme minuteur unique.
 * @returns {{minutes:number, libelle:string}[]}  libelle vide = à déduire du titre de l'étape
 */
export function stepTimers(step) {
  if (step.minuteurs?.length) return step.minuteurs.map((m) => ({ minutes: m.minutes, libelle: m.libelle || '' }));
  return step.duree ? [{ minutes: step.duree, libelle: '' }] : [];
}
