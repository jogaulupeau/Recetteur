// Utilitaires texte (français) : normalisation, slug, pluriels, élisions.

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slugify(s) {
  return normalize(s).replace(/ /g, '-').slice(0, 80) || 'recette';
}

// Clé de rapprochement d'un ingrédient pour la liste de courses :
// « Tomates pelées » et « tomate pelée » donnent la même clé.
export function ingredientKey(nom) {
  return normalize(nom)
    .split(' ')
    .map(singular)
    .join(' ');
}

function singular(w) {
  if (w.length > 3 && /(s|x)$/.test(w) && !/(ss|us)$/.test(w)) return w.slice(0, -1);
  return w;
}

const PREPOSITIONS = new Set(['de', 'd', 'du', 'des', 'a', 'au', 'aux', 'en', 'la', 'le', 'les', 'et', 'ou', 'sans', 'avec']);

// Pluriel naïf d'un nom d'ingrédient. `nom_pluriel` dans la recette l'emporte toujours.
export function pluralize(nom) {
  const words = String(nom).split(' ');
  const out = [];
  let stop = false;
  for (const w of words) {
    const bare = normalize(w).replace(/ /g, '');
    if (stop || PREPOSITIONS.has(bare) || /^d['’]/i.test(w) || /^l['’]/i.test(w)) {
      stop = true;
      out.push(w);
    } else out.push(pluralWord(w));
  }
  return out.join(' ');
}

function pluralWord(w) {
  if (!w || /[sxz]$/i.test(w)) return w;
  if (/(eau|eu)$/i.test(w) && !/^(bleu|pneu)$/i.test(w)) return w + 'x';
  if (/al$/i.test(w)) return w.slice(0, -2) + 'aux';
  return w + 's';
}

// « h » aspirés courants en cuisine : on dit « de haricots », pas « d’haricots ».
const H_ASPIRE = /^(haricot|hareng|homard|hachis|harissa|houmous|hummus|halloumi|haddock|hamburger|hot[- ]?dog|hamburger|hibiscus|hoisin|halva|hacher|hache)/i;

export function startsWithVowel(s) {
  const t = String(s).trim();
  if (/^h/i.test(t)) return /^h[aeiouyàâéèêîôû]/i.test(t) && !H_ASPIRE.test(normalize(t));
  return /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(t);
}

// « de » / « d' » devant un nom.
export function withDe(nom) {
  const n = String(nom).trim();
  if (/^(d['’]|de |du |des |de la |de l['’])/i.test(n)) return n;
  return startsWithVowel(n) ? `d’${n}` : `de ${n}`;
}

export function capitalize(s) {
  s = String(s ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
