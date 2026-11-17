// Validation + normalisation d'une recette au format « recetteur/v1 ».
// Utilisé par le serveur (import), le navigateur (éditeur) et le skill (scripts/validate.mjs).
// Philosophie : refuser ce qui est inexploitable (erreurs), corriger ce qui est évident (avertissements).
import { FORMAT, TYPES, DIFFICULTES, RAYONS } from './vocab.js';
import { canonicalUnit } from './quantity.js';
import { normalize, slugify } from './text.js';
import { guessAisle, guessStaple } from './aisles.js';

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim());

/** "1/2", "1,5", "2" ou 2 → nombre ; sinon NaN. */
export function parseNumber(x) {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string') return NaN;
  const s = x.trim().replace(',', '.');
  const frac = s.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[1] || 0) + Number(frac[2]) / Number(frac[3]);
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

const TYPE_LOOKUP = new Map();
for (const [k, v] of Object.entries(TYPES)) {
  TYPE_LOOKUP.set(normalize(k), k);
  TYPE_LOOKUP.set(normalize(v), k);
}
Object.entries({
  'plat principal': 'plat', 'plat de resistance': 'plat', entrees: 'entree', desserts: 'dessert',
  accompagnements: 'accompagnement', brunch: 'petit-dejeuner', gouters: 'gouter', boissons: 'boisson',
  sauces: 'sauce', aperitif: 'apero', 'a l apero': 'apero', 'plat unique': 'plat',
}).forEach(([k, v]) => TYPE_LOOKUP.set(k, v));

const RAYON_LOOKUP = new Map();
for (const [k, v] of Object.entries(RAYONS)) {
  RAYON_LOOKUP.set(normalize(k), k);
  RAYON_LOOKUP.set(normalize(v), k);
}

export const STEP_TOKEN = /\{\{\s*([a-z0-9][a-z0-9_-]*)\s*\}\}/gi;

/**
 * @param {unknown} input  recette brute (objet JSON)
 * @returns {{ recipe: object|null, errors: string[], warnings: string[] }}
 */
export function validateRecipe(input) {
  const errors = [];
  const warnings = [];
  const err = (path, msg) => errors.push(`${path} : ${msg}`);
  const warn = (path, msg) => warnings.push(`${path} : ${msg}`);

  if (!isObj(input)) return { recipe: null, errors: ['La recette doit être un objet JSON.'], warnings };

  const r = { format: FORMAT };
  if (input.format != null && input.format !== FORMAT) {
    warn('format', `« ${input.format} » inconnu, « ${FORMAT} » attendu — import tenté quand même.`);
  }

  // --- Identité ---
  r.titre = str(input.titre);
  if (!r.titre) err('titre', 'obligatoire');
  else if (r.titre.length > 200) err('titre', 'trop long (200 caractères max)');
  r.description = str(input.description);

  const rawType = str(input.type);
  if (!rawType) r.type = 'plat';
  else if (TYPE_LOOKUP.has(normalize(rawType))) r.type = TYPE_LOOKUP.get(normalize(rawType));
  else {
    r.type = 'autre';
    warn('type', `« ${rawType} » inconnu → « autre » (valeurs : ${Object.keys(TYPES).join(', ')})`);
  }

  // --- Portions & temps ---
  const portions = parseNumber(input.portions);
  if (!Number.isFinite(portions) || portions < 1 || portions > 100) err('portions', 'nombre entier de 1 à 100 obligatoire');
  else r.portions = Math.round(portions);
  r.portions_unite = str(input.portions_unite) || 'personnes';

  for (const k of ['temps_preparation', 'temps_cuisson', 'temps_repos']) {
    if (input[k] == null || input[k] === '') continue;
    const n = parseNumber(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 20000) err(k, 'durée en minutes (nombre ≥ 0) attendue');
    else r[k] = Math.round(n);
  }

  if (input.difficulte != null && input.difficulte !== '') {
    const d = normalize(input.difficulte);
    const found = DIFFICULTES.find((x) => normalize(x) === d) ?? ({ simple: 'facile', moyenne: 'moyen', difficile: 'difficile', intermediaire: 'moyen' })[d];
    if (found) r.difficulte = found;
    else warn('difficulte', `« ${input.difficulte} » ignorée (valeurs : ${DIFFICULTES.join(', ')})`);
  }

  r.cuisine = str(input.cuisine);
  if (input.tags != null && !Array.isArray(input.tags)) err('tags', 'liste de mots-clés attendue');
  r.tags = [...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => str(t).toLowerCase()).filter(Boolean))];
  r.source = str(input.source);
  r.image = str(input.image);
  r.conservation = str(input.conservation);
  r.notes = Array.isArray(input.notes) ? input.notes.map(str).filter(Boolean).join('\n') : str(input.notes);
  r.materiel = Array.isArray(input.materiel) ? input.materiel.map(str).filter(Boolean) : [];

  // --- Ingrédients ---
  r.ingredients = [];
  const usedIds = new Set();
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    err('ingredients', 'liste non vide obligatoire');
  } else {
    input.ingredients.forEach((raw, i) => {
      const p = `ingredients[${i}]`;
      if (!isObj(raw)) return err(p, 'objet attendu');
      const ing = {};
      ing.nom = str(raw.nom);
      if (!ing.nom) return err(`${p}.nom`, 'obligatoire');
      const label = `${p} (« ${ing.nom} »)`;

      let id = str(raw.id).toLowerCase();
      if (id && !/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
        warn(`${label}.id`, `« ${id} » invalide (a-z, 0-9, - et _) → regénéré`);
        id = '';
      }
      if (!id) id = slugify(ing.nom).split('-').slice(0, 4).join('-') || `ing-${i + 1}`;
      let uniq = id, n = 2;
      while (usedIds.has(uniq)) uniq = `${id}-${n++}`;
      if (uniq !== id && raw.id) warn(`${label}.id`, `« ${id} » en double → « ${uniq} »`);
      ing.id = uniq;
      usedIds.add(uniq);

      if (raw.nom_pluriel) ing.nom_pluriel = str(raw.nom_pluriel);

      if (raw.quantite == null || raw.quantite === '') ing.quantite = null;
      else {
        const q = parseNumber(raw.quantite);
        if (!Number.isFinite(q) || q < 0) {
          warn(`${label}.quantite`, `« ${raw.quantite} » illisible → « au goût »`);
          ing.quantite = null;
        } else ing.quantite = q;
      }
      if (raw.quantite_max != null && raw.quantite_max !== '' && ing.quantite != null) {
        const q = parseNumber(raw.quantite_max);
        if (Number.isFinite(q) && q > ing.quantite) ing.quantite_max = q;
        else warn(`${label}.quantite_max`, 'ignorée (doit être un nombre supérieur à quantite)');
      }

      const u = raw.unite == null ? '' : str(raw.unite);
      const cu = canonicalUnit(u);
      if (cu === null) {
        warn(`${label}.unite`, `unité « ${u} » non standard, conservée telle quelle (non convertible)`);
        ing.unite = u;
      } else ing.unite = cu;
      if (ing.quantite == null) ing.unite = '';

      if (raw.note) ing.note = str(raw.note);
      if (raw.groupe) ing.groupe = str(raw.groupe);

      const rr = str(raw.rayon);
      if (rr && RAYON_LOOKUP.has(normalize(rr))) ing.rayon = RAYON_LOOKUP.get(normalize(rr));
      else {
        if (rr) warn(`${label}.rayon`, `« ${rr} » inconnu → deviné automatiquement`);
        ing.rayon = guessAisle(ing.nom);
      }

      if (raw.basique != null) ing.basique = !!raw.basique;
      else if (guessStaple(ing.nom) && ing.quantite == null) ing.basique = true;
      if (raw.fixe) ing.fixe = true;
      if (raw.optionnel) ing.optionnel = true;
      r.ingredients.push(ing);
    });
  }

  // --- Étapes ---
  r.etapes = [];
  const rawSteps = Array.isArray(input.etapes) ? input.etapes : null;
  if (!rawSteps || rawSteps.length === 0) err('etapes', 'liste non vide obligatoire');
  else {
    const byName = new Map(r.ingredients.map((g) => [normalize(g.nom), g.id]));
    rawSteps.forEach((raw, i) => {
      const p = `etapes[${i}]`;
      const o = typeof raw === 'string' ? { texte: raw } : raw;
      if (!isObj(o)) return err(p, 'objet ou texte attendu');
      const step = { texte: str(o.texte) };
      if (!step.texte) return err(`${p}.texte`, 'obligatoire');
      if (o.titre) step.titre = str(o.titre);
      if (o.duree != null && o.duree !== '') {
        const d = parseNumber(o.duree);
        if (Number.isFinite(d) && d > 0 && d <= 20000) step.duree = Math.round(d);
        else warn(`${p}.duree`, 'minutes (nombre > 0) attendues, ignorée');
      }
      // Plusieurs minuteurs sur une même étape (« 3 min de chaque côté ») ; `duree` reste le raccourci pour un seul.
      if (o.minuteurs != null) {
        if (!Array.isArray(o.minuteurs)) warn(`${p}.minuteurs`, 'liste attendue, ignorée');
        else {
          const list = [];
          o.minuteurs.slice(0, 6).forEach((m, j) => {
            const mins = parseNumber(isObj(m) ? (m.minutes ?? m.duree) : m);
            if (!(mins > 0 && mins <= 20000)) return warn(`${p}.minuteurs[${j}]`, 'durée en minutes (> 0) attendue, ignoré');
            const lib = isObj(m) ? str(m.libelle) : '';
            list.push(lib ? { minutes: Math.round(mins * 100) / 100, libelle: lib.slice(0, 80) } : { minutes: Math.round(mins * 100) / 100 });
          });
          if (o.minuteurs.length > 6) warn(`${p}.minuteurs`, '6 minuteurs au maximum par étape, les suivants sont ignorés');
          if (list.length) step.minuteurs = list;
        }
      }
      const refs = [];
      for (const ref of Array.isArray(o.ingredients) ? o.ingredients : []) {
        const key = str(ref).toLowerCase();
        if (usedIds.has(key)) refs.push(key);
        else if (byName.has(normalize(ref))) refs.push(byName.get(normalize(ref)));
        else err(`${p}.ingredients`, `« ${ref} » ne correspond à aucun ingrédient (ids : ${[...usedIds].join(', ')})`);
      }
      for (const m of step.texte.matchAll(STEP_TOKEN)) {
        if (!usedIds.has(m[1].toLowerCase())) err(`${p}.texte`, `{{${m[1]}}} ne correspond à aucun ingrédient`);
      }
      step.ingredients = [...new Set(refs)];
      r.etapes.push(step);
    });

    // Cohérence : chaque ingrédient devrait servir dans au moins une étape.
    const referenced = new Set();
    r.etapes.forEach((s) => {
      s.ingredients.forEach((x) => referenced.add(x));
      for (const m of s.texte.matchAll(STEP_TOKEN)) referenced.add(m[1].toLowerCase());
    });
    if (referenced.size > 0) {
      for (const g of r.ingredients) {
        if (!referenced.has(g.id)) warn(`ingredient « ${g.nom} »`, 'n’est utilisé dans aucune étape');
      }
    }
  }

  if (errors.length) return { recipe: null, errors, warnings };
  // Nettoyage : pas de champs vides inutiles.
  for (const k of ['description', 'cuisine', 'source', 'image', 'conservation', 'notes']) if (!r[k]) delete r[k];
  if (!r.materiel.length) delete r.materiel;
  return { recipe: r, errors, warnings };
}

/** Accepte une recette, un tableau de recettes ou { recettes: [...] }. */
export function validateBundle(input) {
  let list;
  if (Array.isArray(input)) list = input;
  else if (isObj(input) && Array.isArray(input.recettes)) list = input.recettes;
  else list = [input];
  return list.map((raw, index) => ({ index, ...validateRecipe(raw) }));
}

export const totalTime = (r) => (r.temps_preparation || 0) + (r.temps_cuisson || 0) + (r.temps_repos || 0);
export const activeTime = (r) => (r.temps_preparation || 0) + (r.temps_cuisson || 0);

