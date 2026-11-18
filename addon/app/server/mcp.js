// Serveur MCP (Model Context Protocol) de Recetteur : permet à Claude de lire, créer et organiser les recettes, le menu,
// les courses et les minuteurs directement, sans copier-coller.
//
// Transport « Streamable HTTP » (spécification 2025-03-26 / 2025-06-18), version sans état : chaque requête est un POST JSON-RPC,
// la réponse est un JSON. Sur son propre port, séparé de l'ingress de Home Assistant, et fermé sans jeton.
//
// Sécurité (voir docs/AUDIT.md) : jeton Bearer obligatoire (comparaison en temps constant), en-tête Origin refusé
// (spécification : protège du DNS rebinding), blocage après échecs d'authentification, limitation de débit, corps borné,
// mode « lecture seule » qui retire tous les outils d'écriture. Les outils passent par les routes de l'app (dispatch) :
// mêmes validations et mêmes limites que l'interface.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatIngredient } from '../shared/quantity.js';
import { stepPlainText, stepTimers } from '../shared/steps.js';
import { searchRecipes } from '../shared/search.js';
import { suggest, autofill } from '../shared/suggest.js';
import { buildShoppingList, groupByAisle, itemLabel } from '../shared/shopping.js';
import { today, addDays, weekStart, weekDays, dayName, dayShort, weekLabel, fromISO, toISO } from '../shared/dates.js';
import { totalTime } from '../shared/recipe.js';
import { TYPES, FORMAT } from '../shared/vocab.js';
import { capitalize } from '../shared/text.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 4 * 1024 * 1024;
export const MIN_TOKEN = 24;

const INSTRUCTIONS = `Recetteur est le carnet de cuisine de l'utilisateur : recettes, menu de la semaine, liste de courses, minuteurs. Les textes sont en français.

Pour CRÉER une recette : lis d'abord la ressource « recetteur://format » (référence du format ${FORMAT}), puis appelle ajouter_recettes avec une liste de recettes. Règles clés : quantités en nombres, unités g/kg/ml/cl/l/c. à soupe/c. à café/gousse…, pas d'unité pour des pièces entières ; chaque ingrédient a un id court et est utilisé dans au moins une étape ; dans le texte d'une étape, écris {{id}} à la place d'une quantité qui dépend du nombre de convives ; ajoute "minuteurs" ou "duree" pour les vraies attentes. Appelle ajouter_recettes avec apercu=true si tu hésites, et corrige les erreurs signalées.
Pour une recette existante : rechercher_recettes → lire_recette (format "json" pour la modifier avec modifier_recette).
Les quantités se règlent par le nombre de personnes (paramètre "personnes"). Demande-le à l'utilisateur s'il ne l'a pas dit.
Menu : voir_menu, planifier_repas, remplir_menu (propose d'abord, appliquer=true une fois validé). Courses : liste_de_courses.
Avant tout outil destructeur (supprimer_recette, retirer_repas), obtiens l'accord de l'utilisateur.`;

// ---------------------------------------------------------------- petits outils
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(fromISO(s)) === s;
const dur = (min) => (!min ? '' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`);
const plural = (n, un, plus) => `${n} ${n > 1 ? plus : un}`;
const SLOTS = ['midi', 'soir'];
const TYPE_KEYS = Object.keys(TYPES);

class ToolError extends Error {}

/** Validation minimale d'arguments d'après un JSON Schema (types, enum, bornes, requis, propriétés inconnues). */
export function checkArgs(schema, args, at = 'arguments') {
  const t = schema.type;
  const typeOk = (v) => (t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'array' ? Array.isArray(v) : t === 'object' ? v && typeof v === 'object' && !Array.isArray(v) : typeof v === t);
  if (t && !typeOk(args)) return `${at} : ${t} attendu`;
  if (schema.enum && !schema.enum.includes(args)) return `${at} : valeur parmi ${schema.enum.join(', ')}`;
  if (typeof args === 'number') {
    if (schema.minimum != null && args < schema.minimum) return `${at} : ${schema.minimum} au minimum`;
    if (schema.maximum != null && args > schema.maximum) return `${at} : ${schema.maximum} au maximum`;
  }
  if (typeof args === 'string') {
    if (schema.maxLength != null && args.length > schema.maxLength) return `${at} : ${schema.maxLength} caractères au maximum`;
    if (schema.format === 'date' && !isDate(args)) return `${at} : date AAAA-MM-JJ attendue`;
  }
  if (Array.isArray(args)) {
    if (schema.maxItems != null && args.length > schema.maxItems) return `${at} : ${schema.maxItems} éléments au maximum`;
    if (schema.items) for (const [i, v] of args.entries()) { const e = checkArgs(schema.items, v, `${at}[${i}]`); if (e) return e; }
  }
  if (t === 'object' && schema.properties) {
    for (const k of schema.required ?? []) if (!Object.hasOwn(args, k) || args[k] == null) return `${at}.${k} : obligatoire`;
    for (const [k, v] of Object.entries(args)) {
      if (!Object.hasOwn(schema.properties, k)) return `${at}.${k} : paramètre inconnu`;
      if (v == null) continue;
      const e = checkArgs(schema.properties[k], v, `${at}.${k}`);
      if (e) return e;
    }
  }
  return null;
}

// ---------------------------------------------------------------- outils
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const date = (description) => str(description, { format: 'date' });
const int = (description, minimum, maximum) => ({ type: 'integer', description, minimum, maximum });
const bool = (description) => ({ type: 'boolean', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const TYPE_ENUM = { type: 'string', enum: TYPE_KEYS, description: `Type de plat : ${TYPE_KEYS.join(', ')}` };

/**
 * @param {object} ctx { dispatch, stores, cfg, supervisor: boolean }
 * @returns {object[]} outils : { name, title, description, inputSchema, readOnly, destructive, handler(args) → texte }
 */
export function buildTools(ctx) {
  const { dispatch, stores } = ctx;
  const entries = () => Object.values(stores.recettes.data.recettes);
  const entryOf = (id) => (Object.hasOwn(stores.recettes.data.recettes, id) ? stores.recettes.data.recettes[id] : null);
  const need = (id) => entryOf(id) ?? (() => { throw new ToolError(`Recette « ${id} » introuvable. Utilisez rechercher_recettes pour trouver son identifiant.`); })();
  const api = async (method, url, body) => {
    const r = await dispatch(method, url, body);
    if (r.status >= 400) {
      const detail = [...(r.body?.erreurs ?? []), ...(r.body?.avertissements ?? [])];
      throw new ToolError(`${r.body?.erreur ?? `Erreur ${r.status}`}${detail.length ? `\n- ${detail.join('\n- ')}` : ''}`);
    }
    return r.body;
  };
  const docs = () => new Map(entries().map((e) => [e.id, e.recette]));
  const when = (d) => `${dayName(d)} ${dayShort(d)}`;
  const weekOf = (d) => weekStart(d ?? today());

  const recipeLine = (e) => {
    const r = e.recette;
    return `- ${e.id} · ${r.titre} — ${TYPES[r.type] ?? r.type}${totalTime(r) ? `, ${dur(totalTime(r))}` : ''}, ${r.portions} ${r.portions_unite === 'personnes' ? 'pers.' : r.portions_unite}${r.tags.length ? ` [${r.tags.join(', ')}]` : ''}${e.favori ? ' ♥' : ''}${e.derniere_cuisson ? ` · cuisinée le ${e.derniere_cuisson}` : ''}`;
  };

  function recipeText(e, n) {
    const r = e.recette;
    const L = [`# ${r.titre}`, `Identifiant : ${e.id}`];
    L.push([TYPES[r.type], r.cuisine && `cuisine ${r.cuisine}`, r.difficulte, totalTime(r) && `${dur(totalTime(r))} au total${r.temps_preparation ? ` (prépa ${dur(r.temps_preparation)}` : ''}${r.temps_cuisson ? `${r.temps_preparation ? ', ' : ' ('}cuisson ${dur(r.temps_cuisson)}` : ''}${r.temps_repos ? `, repos ${dur(r.temps_repos)}` : ''}${r.temps_preparation || r.temps_cuisson ? ')' : ''}`].filter(Boolean).join(' · '));
    if (r.description) L.push(r.description);
    L.push('', `## Ingrédients — pour ${n} ${r.portions_unite}${n !== r.portions ? ` (recette écrite pour ${r.portions})` : ''}`);
    let g;
    for (const ing of r.ingredients) {
      if ((ing.groupe ?? '') !== (g ?? '')) { g = ing.groupe; if (g) L.push(`**${g}**`); }
      L.push(`- ${formatIngredient(ing, r.portions, n)}`);
    }
    L.push('', '## Préparation');
    r.etapes.forEach((s, i) => {
      const timers = stepTimers(s).map((t) => `⏱ ${dur(Math.round(t.minutes))}${t.libelle ? ` ${t.libelle}` : ''}`).join(', ');
      L.push(`${i + 1}. ${s.titre ? `${s.titre} — ` : ''}${stepPlainText(s.texte, r, n)}${timers ? ` (${timers})` : ''}`);
    });
    if (r.materiel?.length) L.push('', `Matériel : ${r.materiel.join(', ')}`);
    if (r.notes) L.push('', `Notes : ${r.notes}`);
    if (r.conservation) L.push(`Conservation : ${r.conservation}`);
    L.push('', `Suivi : ${e.favori ? 'favorite, ' : ''}${e.etoiles ? `${e.etoiles}/5, ` : ''}${e.nb_cuissons ? `cuisinée ${plural(e.nb_cuissons, 'fois', 'fois')}${e.derniere_cuisson ? ` (dernière : ${e.derniere_cuisson})` : ''}` : 'jamais cuisinée'}${e.memo ? ` · note perso : ${e.memo}` : ''}`);
    return L.join('\n');
  }

  async function shoppingFor(dateArg, jours) {
    const monday = weekOf(dateArg);
    const all = await api('GET', `/api/menu?du=${monday}&au=${addDays(monday, 6)}`);
    const wanted = new Set(jours?.length ? jours : weekDays(monday));
    const meals = all.filter((m) => wanted.has(m.date));
    const items = buildShoppingList(meals.map((m) => ({ recipeId: m.recipeId, servings: m.servings })), docs());
    const [state, stock] = [await api('GET', `/api/courses/${monday}`), await api('GET', '/api/stock')];
    return { monday, meals, items, coches: new Set(state.coches), manuels: state.manuels, stock: new Set(stock) };
  }

  const tools = [
    {
      name: 'rechercher_recettes', title: 'Rechercher des recettes', readOnly: true,
      description: 'Cherche dans le livre de recettes (titre, ingrédient, mot-clé) avec des filtres. Retourne les identifiants à utiliser dans les autres outils.',
      inputSchema: obj({ q: str('Mots à chercher (titre, ingrédients, mots-clés), sans accents ni casse', { maxLength: 200 }), type: TYPE_ENUM, tags: { type: 'array', items: str('mot-clé'), maxItems: 10, description: 'Mots-clés exigés (tous)' }, favoris: bool('Seulement les favorites'), temps_max: int('Durée totale maximale en minutes', 1, 1440), tri: { type: 'string', enum: ['pertinence', 'titre', 'recent', 'rapide', 'cuisine'] }, limite: int('Nombre maximum de résultats (20 par défaut)', 1, 100) }),
      handler: async (a) => {
        const found = searchRecipes(entries(), { q: a.q, type: a.type, tags: a.tags, favoris: a.favoris, maxTemps: a.temps_max, tri: a.tri });
        const lim = a.limite ?? 20;
        if (!found.length) return `Aucune recette ne correspond (livre : ${entries().length} recette${entries().length > 1 ? 's' : ''}).`;
        return [`${plural(found.length, 'recette trouvée', 'recettes trouvées')}${found.length > lim ? ` (${lim} affichées)` : ''} :`, ...found.slice(0, lim).map(recipeLine)].join('\n');
      },
    },
    {
      name: 'lire_recette', title: 'Lire une recette', readOnly: true,
      description: 'Affiche une recette complète avec les quantités ajustées au nombre de personnes demandé. format="json" renvoie le document brut (utile avant modifier_recette).',
      inputSchema: obj({ id: str('Identifiant de la recette', { maxLength: 100 }), personnes: int('Nombre de personnes (par défaut : celui de la recette)', 1, 100), format: { type: 'string', enum: ['texte', 'json'] } }, ['id']),
      handler: async (a) => {
        const e = need(a.id);
        return a.format === 'json' ? JSON.stringify(e.recette, null, 2) : recipeText(e, a.personnes ?? (e.recette.portions_unite === 'personnes' ? ctx.cfg.portions_defaut : e.recette.portions));
      },
    },
    {
      name: 'proposer_recettes', title: 'Proposer des recettes', readOnly: true,
      description: 'Suggère des recettes : pas faites depuis longtemps, favorites, ou qui utilisent les ingrédients que l\'utilisateur a déjà. Ne modifie rien.',
      inputSchema: obj({ type: TYPE_ENUM, temps_max: int('Durée totale maximale en minutes', 1, 1440), tags: { type: 'array', items: str('mot-clé'), maxItems: 10 }, sans_tags: { type: 'array', items: str('mot-clé'), maxItems: 10 }, ingredients_disponibles: { type: 'array', items: str('ingrédient', { maxLength: 80 }), maxItems: 30, description: 'Ce qu\'il y a dans le frigo' }, nombre: int('Nombre de propositions (5 par défaut)', 1, 10) }),
      handler: async (a) => {
        const r = suggest(entries(), { type: a.type ?? 'plat', maxTemps: a.temps_max, tags: a.tags ?? [], sansTags: a.sans_tags ?? [], have: a.ingredients_disponibles ?? [], today: today(), n: a.nombre ?? 5 });
        if (!r.length) return 'Aucune recette ne correspond à ces critères.';
        return r.map((x) => `${recipeLine(x.entry)}${x.reasons.length ? `\n  → ${x.reasons.join(' · ')}` : ''}${x.manquants.length ? `\n  manque : ${x.manquants.slice(0, 6).join(', ')}` : ''}`).join('\n');
      },
    },
    {
      name: 'voir_menu', title: 'Voir le menu', readOnly: true,
      description: 'Affiche les repas planifiés (midi et soir) sur une période. Par défaut : la semaine en cours. Donne les numéros de repas utiles pour retirer_repas.',
      inputSchema: obj({ du: date('Premier jour (AAAA-MM-JJ) ; par défaut le lundi de la semaine en cours'), au: date('Dernier jour inclus ; par défaut 6 jours après « du »') }),
      handler: async (a) => {
        const du = a.du ?? weekOf(), au = a.au ?? addDays(du, 6);
        if (au < du) throw new ToolError('« au » doit être postérieur à « du ».');
        const meals = await api('GET', `/api/menu?du=${du}&au=${au}`);
        const out = [`Menu du ${du} au ${au}${du === weekStart(du) && au === addDays(du, 6) ? ` (${weekLabel(du)})` : ''} :`];
        for (let d = du, n = 0; d <= au && n < 62; d = addDays(d, 1), n++) {
          const parts = SLOTS.map((s) => {
            const ms = meals.filter((m) => m.date === d && m.slot === s);
            return `${s} — ${ms.length ? ms.map((m) => `${stores.recettes.data.recettes[m.recipeId]?.recette.titre ?? m.recipeId} (${m.servings} pers.)${m.fait ? ' ✓ cuisiné' : ''} [repas n°${m.id}, recette ${m.recipeId}]`).join(' ; ') : '(rien)'}`;
          });
          out.push(`${capitalize(when(d))} : ${parts.join(' ; ')}`);
        }
        return out.join('\n');
      },
    },
    {
      name: 'liste_de_courses', title: 'Liste de courses', readOnly: true,
      description: 'Calcule la liste de courses des repas planifiés d\'une semaine : quantités additionnées et converties, rangées par rayon, avec ce qui est déjà coché ou en stock.',
      inputSchema: obj({ date: date('Un jour de la semaine voulue ; par défaut aujourd\'hui'), jours: { type: 'array', items: date('jour'), maxItems: 7, description: 'Se limiter à ces jours' }, inclure_stock: bool('Lister aussi les articles « toujours en stock »') }),
      handler: async (a) => {
        const s = await shoppingFor(a.date, a.jours);
        if (!s.meals.length) return `Aucun repas planifié sur la semaine du ${weekLabel(s.monday)} : rien à acheter.`;
        const buy = s.items.filter((i) => !i.basique && !s.stock.has(i.key));
        const out = [`Courses — semaine du ${weekLabel(s.monday)} (${plural(s.meals.length, 'repas', 'repas')}, ${plural(buy.length + s.manuels.length, 'article', 'articles')})`];
        for (const g of groupByAisle(buy)) {
          out.push('', g.label.toUpperCase());
          for (const it of g.items) out.push(`- [${s.coches.has(it.key) ? 'x' : ' '}] ${itemLabel(it)}${it.recettes.length ? `  (pour : ${it.recettes.map((r) => r.titre).join(', ')})` : ''}`);
        }
        const basics = s.items.filter((i) => i.basique && !s.stock.has(i.key));
        if (basics.length) out.push('', 'PLACARD À VÉRIFIER', ...basics.map((i) => `- ${itemLabel(i)}`));
        if (s.manuels.length) out.push('', 'AJOUTÉS À LA MAIN', ...s.manuels.map((m) => `- [${m.coche ? 'x' : ' '}] ${m.texte}`));
        const stocked = s.items.filter((i) => s.stock.has(i.key));
        if (a.inclure_stock && stocked.length) out.push('', 'TOUJOURS EN STOCK (non listés)', ...stocked.map((i) => `- ${itemLabel(i)}`));
        return out.join('\n');
      },
    },
    {
      name: 'ajouter_recettes', title: 'Ajouter des recettes', readOnly: false,
      description: `Crée des recettes dans le livre. Chaque recette suit le format ${FORMAT} (voir la ressource recetteur://format). Valide avant d'écrire : les erreurs bloquantes et les corrections automatiques sont renvoyées. mode : ignorer (défaut), remplacer ou dupliquer si une recette du même titre existe.`,
      inputSchema: obj({ recettes: { type: 'array', items: { type: 'object' }, maxItems: 100, description: 'Liste de recettes au format recetteur/v1 (même pour une seule)' }, mode: { type: 'string', enum: ['ignorer', 'remplacer', 'dupliquer'] }, apercu: bool('true : valider sans rien écrire') }, ['recettes']),
      handler: async (a) => {
        const res = await api('POST', `/api/import?mode=${a.mode ?? 'ignorer'}${a.apercu ? '&apercu=1' : ''}`, a.recettes);
        const r = res.resume;
        const LAB = { nouveau: 'nouvelle', remplace: 'remplace l\'existante', ignore: 'déjà présente (ignorée)', invalide: 'INVALIDE' };
        const out = [`${a.apercu ? 'Aperçu (rien n\'a été écrit)' : 'Import terminé'} : ${r.nouveaux} nouvelle(s), ${r.remplaces} remplacée(s), ${r.ignores} ignorée(s), ${r.invalides} invalide(s).`];
        for (const x of res.resultats) {
          // Une recette invalide n'a pas de titre « validé » : on rappelle celui que l'appelant avait envoyé, pour qu'il sache laquelle corriger.
          const sent = a.recettes[x.index]?.titre;
          const name = x.titre ?? (typeof sent === 'string' && sent.trim() ? sent.trim().slice(0, 100) : `recette n°${x.index + 1}`);
          out.push(`${x.statut === 'invalide' ? '✗' : '✓'} ${name} — ${LAB[x.statut]}${x.id ? ` (id : ${x.id})` : ''}`);
          for (const e of x.erreurs) out.push(`    erreur : ${e}`);
          for (const w of x.avertissements) out.push(`    avertissement : ${w}`);
        }
        if (r.invalides) out.push('', 'Corrigez les recettes invalides puis relancez ajouter_recettes (seules celles-ci sont à renvoyer).');
        if (r.invalides && !r.nouveaux && !r.remplaces) throw new ToolError(out.join('\n'));
        return out.join('\n');
      },
    },
    {
      name: 'modifier_recette', title: 'Modifier une recette', readOnly: false,
      description: 'Remplace le contenu d\'une recette existante par un document complet (obtenu avec lire_recette format="json", puis modifié). Le suivi (favori, notes, historique) est conservé.',
      inputSchema: obj({ id: str('Identifiant', { maxLength: 100 }), recette: { type: 'object', description: 'Document complet de la recette' } }, ['id', 'recette']),
      handler: async (a) => {
        need(a.id);
        const r = await api('PUT', `/api/recettes/${encodeURIComponent(a.id)}`, a.recette);
        return `Recette « ${r.recette.titre} » mise à jour.${r.avertissements?.length ? `\nAvertissements :\n- ${r.avertissements.join('\n- ')}` : ''}`;
      },
    },
    {
      name: 'modifier_suivi_recette', title: 'Favori, note, mémo', readOnly: false, idempotent: true,
      description: 'Change le suivi personnel d\'une recette : favorite, étoiles (0 à 5), note perso.',
      inputSchema: obj({ id: str('Identifiant', { maxLength: 100 }), favori: bool('Favorite ?'), etoiles: int('Note de 0 à 5', 0, 5), memo: str('Note personnelle', { maxLength: 5000 }) }, ['id']),
      handler: async (a) => {
        need(a.id);
        const { id, ...patch } = a;
        const e = await api('PATCH', `/api/recettes/${encodeURIComponent(id)}`, patch);
        return `« ${e.recette.titre} » : ${e.favori ? 'favorite' : 'pas en favori'}, ${e.etoiles ? `${e.etoiles}/5` : 'sans note'}${e.memo ? `, mémo : ${e.memo}` : ''}.`;
      },
    },
    {
      name: 'marquer_cuisinee', title: 'Marquer comme cuisinée', readOnly: false,
      description: 'Note qu\'une recette a été cuisinée (par défaut aujourd\'hui) : elle sera moins souvent reproposée.',
      inputSchema: obj({ id: str('Identifiant', { maxLength: 100 }), date: date('Jour (par défaut aujourd\'hui)') }, ['id']),
      handler: async (a) => {
        need(a.id);
        const e = await api('POST', `/api/recettes/${encodeURIComponent(a.id)}/cuisinee`, { date: a.date ?? today() });
        return `« ${e.recette.titre} » notée comme cuisinée (${e.nb_cuissons} fois, dernière : ${e.derniere_cuisson}).`;
      },
    },
    {
      name: 'supprimer_recette', title: 'Supprimer une recette', readOnly: false, destructive: true,
      description: 'Supprime définitivement une recette, ses photos et ses repas planifiés. Demande l\'accord de l\'utilisateur avant, puis passe confirmer=true.',
      inputSchema: obj({ id: str('Identifiant', { maxLength: 100 }), confirmer: bool('Doit valoir true') }, ['id', 'confirmer']),
      handler: async (a) => {
        const e = need(a.id);
        if (a.confirmer !== true) throw new ToolError('Suppression non confirmée : passez confirmer=true après accord de l\'utilisateur.');
        await api('DELETE', `/api/recettes/${encodeURIComponent(a.id)}`);
        return `Recette « ${e.recette.titre} » supprimée.`;
      },
    },
    {
      name: 'planifier_repas', title: 'Planifier un repas', readOnly: false,
      description: 'Ajoute une recette au menu, à un jour et un repas (midi ou soir). Plusieurs plats peuvent être planifiés sur un même repas.',
      inputSchema: obj({ date: date('Jour (AAAA-MM-JJ)'), creneau: { type: 'string', enum: SLOTS }, recette_id: str('Identifiant de la recette', { maxLength: 100 }), personnes: int('Nombre de personnes (par défaut : celui du foyer)', 1, 100) }, ['date', 'creneau', 'recette_id']),
      handler: async (a) => {
        const e = need(a.recette_id);
        const servings = a.personnes ?? (e.recette.portions_unite === 'personnes' ? ctx.cfg.portions_defaut : e.recette.portions);
        const m = await api('POST', '/api/menu', { date: a.date, slot: a.creneau, recipeId: a.recette_id, servings });
        return `Ajouté au menu : « ${e.recette.titre} », ${when(m.date)} (${m.slot}), ${m.servings} pers. — repas n°${m.id}.`;
      },
    },
    {
      name: 'retirer_repas', title: 'Retirer un repas du menu', readOnly: false, destructive: true,
      description: 'Retire un repas du menu (numéro donné par voir_menu). La recette elle-même n\'est pas supprimée.',
      inputSchema: obj({ repas_id: int('Numéro du repas', 1, 1_000_000_000) }, ['repas_id']),
      handler: async (a) => { await api('DELETE', `/api/menu/${a.repas_id}`); return `Repas n°${a.repas_id} retiré du menu.`; },
    },
    {
      name: 'remplir_menu', title: 'Remplir le menu', readOnly: false,
      description: 'Propose (ou applique) des recettes pour les repas encore vides d\'une période, en variant, en privilégiant les recettes pas faites depuis longtemps et les ingrédients communs. Par défaut, ne fait que PROPOSER : montre la proposition à l\'utilisateur, puis rappelle avec appliquer=true.',
      inputSchema: obj({ du: date('Premier jour ; par défaut aujourd\'hui'), au: date('Dernier jour ; par défaut dimanche'), creneaux: { type: 'array', items: { type: 'string', enum: SLOTS }, maxItems: 2, description: 'Repas à remplir (par défaut : soir)' }, personnes: int('Nombre de personnes', 1, 100), temps_max: int('Durée totale maximale', 1, 1440), tags: { type: 'array', items: str('mot-clé'), maxItems: 10 }, appliquer: bool('true : enregistrer la proposition dans le menu') }),
      handler: async (a) => {
        const du = a.du ?? today(), au = a.au ?? addDays(weekStart(du), 6);
        if (au < du) throw new ToolError('« au » doit être postérieur à « du ».');
        const existing = await api('GET', `/api/menu?du=${du}&au=${au}`);
        const slots = a.creneaux?.length ? a.creneaux : ['soir'];
        const free = [];
        for (let d = du, n = 0; d <= au && n < 62; d = addDays(d, 1), n++) for (const s of slots) if (!existing.some((m) => m.date === d && m.slot === s)) free.push(`${d}|${s}`);
        if (!free.length) return 'Aucun repas libre sur cette période : rien à proposer.';
        const plan = autofill(entries(), { creneaux: free, dejaPlanifies: existing.map((m) => m.recipeId), portions: a.personnes ?? ctx.cfg.portions_defaut, today: today(), maxTemps: a.temps_max, tags: a.tags ?? [] });
        if (!plan.length) return 'Aucune recette ne correspond à ces critères.';
        if (a.appliquer) await api('POST', '/api/menu/lot', plan.map(({ date: d, slot, recipeId, servings }) => ({ date: d, slot, recipeId, servings })));
        return [`${a.appliquer ? 'Ajouté au menu' : 'Proposition (rien n\'est enregistré)'} — ${plural(plan.length, 'repas', 'repas')} :`, ...plan.map((p) => `- ${when(p.date)} (${p.slot}) : ${stores.recettes.data.recettes[p.recipeId].recette.titre} (${p.servings} pers.)${p.raisons?.length ? ` — ${p.raisons.join(', ')}` : ''}`), ...(a.appliquer ? [] : ['', 'Pour l\'enregistrer : rappelez remplir_menu avec les mêmes paramètres et appliquer=true.'])].join('\n');
      },
    },
    {
      name: 'envoyer_courses_vers_home_assistant', title: 'Envoyer les courses à Home Assistant', readOnly: false,
      description: 'Ajoute les articles restants de la liste de courses (non cochés, hors placard et stock) à la liste « todo » de Home Assistant configurée.',
      inputSchema: obj({ date: date('Un jour de la semaine voulue ; par défaut aujourd\'hui'), jours: { type: 'array', items: date('jour'), maxItems: 7 } }),
      handler: async (a) => {
        const s = await shoppingFor(a.date, a.jours);
        const items = [...groupByAisle(s.items.filter((i) => !i.basique && !s.stock.has(i.key) && !s.coches.has(i.key))).flatMap((g) => g.items.map(itemLabel)), ...s.manuels.filter((m) => !m.coche).map((m) => m.texte)];
        if (!items.length) return 'Rien à envoyer : tout est déjà coché ou en stock.';
        const r = await api('POST', '/api/courses-ha', { items });
        return `${plural(r.envoyes, 'article envoyé', 'articles envoyés')} à ${r.liste}${r.echecs.length ? `, ${r.echecs.length} en échec : ${r.echecs.slice(0, 3).join('; ')}` : ''}.`;
      },
    },
    {
      name: 'lancer_minuteur', title: 'Lancer un minuteur', readOnly: false,
      description: 'Démarre un minuteur de cuisine. À l\'échéance, il sonne dans l\'interface et, si une enceinte est configurée, une alerte y est diffusée.',
      inputSchema: obj({ minutes: { type: 'number', description: 'Durée en minutes (décimales permises : 0.5 = 30 s)', minimum: 0.1, maximum: 1440 }, libelle: str('À quoi sert-il (ex. « cuisson des pâtes »)', { maxLength: 80 }), alerte_enceinte: bool('Annoncer la fin sur l\'enceinte (true par défaut)') }, ['minutes']),
      handler: async (a) => {
        const t = await api('POST', '/api/minuteurs', { secondes: Math.round(a.minutes * 60), libelle: a.libelle, alerte: a.alerte_enceinte !== false });
        return `Minuteur « ${t.libelle} » lancé pour ${dur(Math.floor(t.total / 60)) || ''}${t.total % 60 ? ` ${t.total % 60} s` : ''}${t.alerte ? ' (alerte sur l\'enceinte à la fin)' : ''} — n°${t.id}.`;
      },
    },
    {
      name: 'lister_minuteurs', title: 'Minuteurs en cours', readOnly: true,
      description: 'Liste les minuteurs en cours, en pause ou qui sonnent.',
      inputSchema: obj({}),
      handler: async () => {
        const r = await api('GET', '/api/minuteurs');
        if (!r.minuteurs.length) return 'Aucun minuteur.';
        return r.minuteurs.map((t) => {
          const reste = t.etat === 'en_cours' ? Math.max(0, Math.ceil((t.fin - r.maintenant) / 1000)) : t.etat === 'pause' ? t.reste : 0;
          return `- n°${t.id} « ${t.libelle} »${t.recette_titre ? ` (${t.recette_titre})` : ''} : ${t.etat === 'sonne' ? 'TERMINÉ' : `${Math.floor(reste / 60)} min ${reste % 60} s restantes${t.etat === 'pause' ? ' (en pause)' : ''}`}`;
        }).join('\n');
      },
    },
    {
      name: 'arreter_minuteur', title: 'Arrêter un minuteur', readOnly: false, destructive: true,
      description: 'Annule un minuteur ou coupe sa sonnerie (numéro donné par lister_minuteurs).',
      inputSchema: obj({ id: str('Numéro du minuteur', { maxLength: 20 }) }, ['id']),
      handler: async (a) => { await api('DELETE', `/api/minuteurs/${encodeURIComponent(a.id)}`); return `Minuteur ${a.id} arrêté.`; },
    },
  ];
  return tools;
}

// ---------------------------------------------------------------- ressources
const RESOURCES = [{ uri: 'recetteur://format', name: 'Format des recettes (recetteur/v1)', description: 'Référence complète du format JSON des recettes : champs, unités, règles pour les quantités ajustables et les minuteurs.', mimeType: 'text/markdown' }];
function formatDoc() {
  for (const p of [path.join(HERE, '..', 'skill', 'recettes-recetteur', 'references', 'format.md')]) {
    try { return fs.readFileSync(p, 'utf8'); } catch { /* suivant */ }
  }
  return `Format ${FORMAT} : voir la documentation du dépôt (skill/recettes-recetteur/references/format.md).`;
}

// ---------------------------------------------------------------- protocole JSON-RPC
/**
 * Moteur MCP, indépendant du transport (testable sans HTTP).
 * @param {object} o { tools, version, readOnly, log }
 */
export function createEngine({ tools, version = '0', readOnly = false, log = console }) {
  const exposed = tools.filter((t) => !readOnly || t.readOnly);
  const byName = new Map(exposed.map((t) => [t.name, t]));
  const annotations = (t) => ({ title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !t.readOnly && !!t.destructive, idempotentHint: !!t.readOnly || !!t.idempotent, openWorldHint: false });
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  async function call(name, args) {
    const tool = byName.get(name);
    if (!tool) throw Object.assign(new Error(`Outil inconnu ou indisponible : ${name}`), { code: -32602 });
    const bad = checkArgs(tool.inputSchema, args ?? {});
    if (bad) return { content: [{ type: 'text', text: `Arguments invalides — ${bad}` }], isError: true };
    try {
      return { content: [{ type: 'text', text: await tool.handler(args ?? {}) }] };
    } catch (e) {
      if (e instanceof ToolError) return { content: [{ type: 'text', text: e.message }], isError: true };
      log.error(`MCP, outil ${name} :`, e?.stack || e);
      return { content: [{ type: 'text', text: 'Erreur interne du serveur.' }], isError: true };
    }
  }

  /** Traite UN message JSON-RPC ; retourne la réponse, ou null pour une notification. */
  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') return rpcError(msg?.id, -32600, 'Requête JSON-RPC invalide.');
    if (typeof msg.method !== 'string') return null; // une réponse du client : rien à faire
    const isNotification = !('id' in msg);
    const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
    try {
      switch (msg.method) {
        case 'initialize': {
          const asked = msg.params?.protocolVersion;
          return reply({
            protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
            serverInfo: { name: 'recetteur', title: 'Recetteur', version },
            instructions: INSTRUCTIONS,
          });
        }
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools: exposed.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: annotations(t) })) });
        case 'tools/call': {
          if (typeof msg.params?.name !== 'string') throw Object.assign(new Error('Paramètre « name » manquant.'), { code: -32602 });
          const out = await call(msg.params.name, msg.params.arguments);
          return reply(out);
        }
        case 'resources/list': return reply({ resources: RESOURCES });
        case 'resources/templates/list': return reply({ resourceTemplates: [] });
        case 'resources/read': {
          if (msg.params?.uri !== 'recetteur://format') throw Object.assign(new Error('Ressource inconnue.'), { code: -32002 });
          return reply({ contents: [{ uri: 'recetteur://format', mimeType: 'text/markdown', text: formatDoc() }] });
        }
        case 'prompts/list': return reply({ prompts: [] });
        default:
          if (msg.method.startsWith('notifications/')) return null;
          return isNotification ? null : rpcError(msg.id, -32601, `Méthode inconnue : ${msg.method}`);
      }
    } catch (e) {
      return isNotification ? null : rpcError(msg.id, e.code ?? -32603, e.code ? e.message : 'Erreur interne du serveur.');
    }
  }

  return { handle, tools: exposed };
}

// ---------------------------------------------------------------- transport HTTP
/**
 * Serveur HTTP du MCP : un seul point d'entrée, POST /mcp.
 * @param {object} o { engine, token, log, maxPerMinute }
 */
export function createMcpServer({ engine, token, log = console, maxPerMinute = 300 }) {
  if (typeof token !== 'string' || token.length < MIN_TOKEN) throw new Error(`Jeton MCP trop court (${MIN_TOKEN} caractères minimum).`);
  const tokenDigest = sha(token);
  const failures = new Map(); // ip → { n, until }
  const hits = new Map(); // ip → { n, reset }

  const json = (res, status, payload, headers = {}) => {
    const body = payload == null ? '' : JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) });
    res.end(body);
  };

  function throttled(ip) {
    const now = Date.now();
    const f = failures.get(ip);
    if (f && f.until > now && f.n >= 10) return true;
    let h = hits.get(ip);
    if (!h || h.reset < now) hits.set(ip, (h = { n: 0, reset: now + 60_000 }));
    return ++h.n > maxPerMinute;
  }
  function authFailed(ip) {
    const now = Date.now();
    const f = failures.get(ip);
    failures.set(ip, !f || f.until < now ? { n: 1, until: now + 60_000 } : { n: f.n + 1, until: f.until });
    if ((failures.get(ip).n) === 10) log.error(`MCP : 10 jetons invalides depuis ${ip} en 1 minute — adresse bloquée pour une minute.`);
  }

  const server = http.createServer(async (req, res) => {
    const ip = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    try {
      // Sans quoi un site web visité par l'utilisateur pourrait viser le serveur depuis son navigateur (DNS rebinding) : la
      // spécification impose de refuser tout en-tête Origin. Les clients MCP (Claude, SDK) n'en envoient pas.
      if (req.headers.origin) return json(res, 403, { error: 'Origine refusée.' });
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== '/mcp' && url.pathname !== '/mcp/') return json(res, 404, { error: 'Introuvable : le point d\'entrée est /mcp.' });
      if (throttled(ip)) return json(res, 429, { error: 'Trop de requêtes.' }, { 'Retry-After': '60' });

      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
      if (!m || !crypto.timingSafeEqual(sha(m[1].trim()), tokenDigest)) {
        authFailed(ip);
        return json(res, 401, { error: 'Jeton absent ou invalide.' }, { 'WWW-Authenticate': 'Bearer realm="recetteur"' });
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'POST uniquement (serveur sans session).' }, { Allow: 'POST' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return json(res, 415, { error: 'Content-Type: application/json requis.' });
      const ver = req.headers['mcp-protocol-version'];
      if (ver && !PROTOCOLS.includes(ver)) return json(res, 400, { error: `Version de protocole non prise en charge : ${ver}.` });

      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) return json(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Requête trop volumineuse.' } });
        chunks.push(c);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide.' } });
      }
      if (Array.isArray(body)) {
        if (!body.length || body.length > 50) return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Lot vide ou trop grand.' } });
        const out = (await Promise.all(body.map((x) => engine.handle(x)))).filter(Boolean);
        return out.length ? json(res, 200, out) : json(res, 202, null);
      }
      const out = await engine.handle(body);
      return out ? json(res, 200, out) : json(res, 202, null);
    } catch (e) {
      log.error('MCP :', e?.stack || e);
      try { json(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Erreur interne du serveur.' } }); } catch { /* connexion fermée */ }
    }
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 120_000;
  const sweep = setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); for (const [k, v] of failures) if (v.until < n) failures.delete(k); }, 60_000);
  sweep.unref();
  server.on('close', () => clearInterval(sweep));
  return server;
}

/** Assemble moteur + serveur pour une app Recetteur. */
export function createMcp({ app, token, readOnly = false, version = '0', log = console }) {
  const tools = buildTools({ dispatch: app.dispatch, stores: app.stores, cfg: app.config });
  const engine = createEngine({ tools, version, readOnly, log });
  return { engine, server: createMcpServer({ engine, token, log }) };
}

