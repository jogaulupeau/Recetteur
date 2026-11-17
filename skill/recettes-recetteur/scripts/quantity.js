// Quantités : conversion d'unités, mise à l'échelle, arrondis « de cuisine », affichage français.
import { UNITES, UNITE_ALIAS } from './vocab.js';
import { pluralize, withDe, normalize } from './text.js';

/** Unité telle qu'écrite → unité canonique ('' si aucune). Renvoie null si inconnue. */
export function canonicalUnit(u) {
  if (u == null) return '';
  const raw = String(u).trim();
  if (raw === '') return '';
  if (Object.hasOwn(UNITES, raw)) return raw;
  const low = raw.toLowerCase();
  if (Object.hasOwn(UNITES, low)) return low;
  if (Object.hasOwn(UNITE_ALIAS, raw)) return UNITE_ALIAS[raw];
  if (Object.hasOwn(UNITE_ALIAS, low)) return UNITE_ALIAS[low];
  const bare = normalize(raw);
  for (const [k, v] of Object.entries(UNITE_ALIAS)) if (normalize(k) === bare) return v;
  return null;
}

export const isKnownUnit = (u) => canonicalUnit(u) !== null;

/** Convertit en unité de base de la famille (g ou ml). Autres unités : inchangé. */
export function toBase(q, unit) {
  const def = UNITES[unit];
  if (def?.famille) return { q: q * def.facteur, unit: def.famille === 'masse' ? 'g' : 'ml' };
  return { q, unit };
}

/** Choisit la plus lisible entre g/kg et ml/l. */
export function fromBase(q, unit) {
  if (unit === 'g' && q >= 1000) return { q: q / 1000, unit: 'kg' };
  if (unit === 'ml' && q >= 1000) return { q: q / 1000, unit: 'l' };
  return { q, unit };
}

function roundTo(n, step) {
  return Math.round(n / step) * step;
}

/** Arrondi pensé pour la cuisine selon l'unité (133 g → 135 g, 2,6 cuillères → 2½…). */
export function kitchenRound(q, unit) {
  if (!(q > 0)) return q;
  if (unit === 'g' || unit === 'ml') {
    if (q < 10) return roundTo(q, 0.5) || 0.5;
    if (q < 50) return Math.round(q);
    if (q < 1000) return roundTo(q, 5);
    return roundTo(q, 10);
  }
  if (unit === 'kg' || unit === 'l') return roundTo(q, 0.05) || 0.05;
  if (unit === 'cl' || unit === 'dl') return roundTo(q, 0.5) || 0.5;
  if (unit === 'c. à soupe' || unit === 'c. à café') return roundTo(q, 0.25) || 0.25;
  // pièces, gousses, tranches… : demis jusqu'à 10, entiers ensuite
  if (q < 10) return roundTo(q, 0.5) || 0.5;
  return Math.round(q);
}

const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** 1.5 → « 1½ », 0.25 → « ¼ », 2.4 → « 2,4 ». */
export function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return '';
  const whole = Math.floor(n + 1e-9);
  const frac = Math.round((n - whole) * 100) / 100;
  if (frac === 0) return String(whole);
  if (FRACTIONS[frac]) return (whole ? String(whole) : '') + FRACTIONS[frac];
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/**
 * Mise à l'échelle d'un ingrédient pour `portions` personnes (recette écrite pour `base`).
 * Retourne { min, max, unite } avec arrondi de cuisine ; min = null si « au goût ».
 * Les unités de masse/volume sont ré-exprimées au mieux (0,5 kg → 500 g ; 1200 g → 1,2 kg).
 */
export function scaleAmount(ing, base, portions) {
  const unit = canonicalUnit(ing.unite) ?? String(ing.unite ?? '').trim();
  const { quantite: lo, quantite_max: hi } = ing;
  if (lo == null) return { min: null, max: null, unite: unit };

  const factor = ing.fixe || !base || !portions ? 1 : portions / base;
  if (factor === 1) return { min: lo, max: hi ?? null, unite: unit };

  const def = UNITES[unit];
  // cl / dl : on reste dans l'unité d'origine
  if (def?.famille && unit !== 'cl' && unit !== 'dl') {
    const bLo = toBase(lo * factor, unit);
    const bHi = hi != null ? toBase(hi * factor, unit) : null;
    const shown = fromBase(bHi ? Math.max(bLo.q, bHi.q) : bLo.q, bLo.unit).unit;
    const div = shown === 'kg' || shown === 'l' ? 1000 : 1;
    return {
      min: kitchenRound(bLo.q / div, shown),
      max: bHi ? kitchenRound(bHi.q / div, shown) : null,
      unite: shown,
    };
  }
  return {
    min: kitchenRound(lo * factor, unit),
    max: hi != null ? kitchenRound(hi * factor, unit) : null,
    unite: unit,
  };
}

/** En français, le pluriel commence à 2 : « 1,5 oignon », « 2 oignons ». */
export const isPlural = (q) => q >= 2;

/** « 400 g », « 2½ c. à soupe », « 2 à 3 gousses », « » si pas de quantité. */
export function formatAmount({ min, max, unite }) {
  if (min == null) return '';
  const rangeQ = max != null && max !== min ? `${formatNumber(min)} à ${formatNumber(max)}` : formatNumber(min);
  const plural = isPlural(max ?? min);
  if (!unite) return rangeQ;
  const def = UNITES[unite];
  const label = def?.abbr || !plural || unite.endsWith('s') ? unite : pluralize(unite);
  return `${rangeQ} ${label}`;
}

/** Ligne complète d'ingrédient pour une recette à `portions` personnes. */
export function formatIngredient(ing, base, portions, { withNote = true } = {}) {
  const amount = scaleAmount(ing, base, portions);
  const q = amount.min;
  const qty = formatAmount(amount);
  const plural = isPlural(amount.max ?? q);
  let nom = ing.nom;
  let text;
  if (q == null) {
    text = nom;
  } else if (!amount.unite) {
    // « 2 oignons »
    if (plural) nom = ing.nom_pluriel || pluralize(nom);
    text = `${qty} ${nom}`;
  } else {
    text = `${qty} ${withDe(nom)}`;
  }
  if (withNote && ing.note) text += `, ${ing.note}`;
  if (ing.optionnel) text += ' (facultatif)';
  return text;
}
