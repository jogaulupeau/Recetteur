// API + fichiers statiques. Aucune dépendance : node:http uniquement.
import http from 'node:http';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './store.js';
import { createHa, HaError } from './ha.js';
import { createTimers } from './minuteurs.js';
import { validateRecipe, validateBundle } from '../shared/recipe.js';
import { slugify, sourceKey } from '../shared/text.js';
import { FORMAT } from '../shared/vocab.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, '..', 'public');
const SHARED = path.join(ROOT, '..', 'shared');
const MAX_BODY = 8 * 1024 * 1024;
const MAX_PHOTO = 6 * 1024 * 1024; // le navigateur redimensionne avant l'envoi (≈ 300 Ko) : c'est un garde-fou
const SLOTS = ['matin', 'midi', 'soir'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = 'Introuvable.') => new HttpError(404, msg);
const CREATED = Symbol('created');
const created = (body) => ({ [CREATED]: true, body });
const FILE = Symbol('file');
const fileOut = (file, type, cache) => ({ [FILE]: true, file, type, cache });

/** Type d'image d'après les premiers octets (on ne se fie ni à l'en-tête ni à l'extension). */
export function sniffImage(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}
const IMG_TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

/**
 * @param {object} o
 * @param {string} o.dataDir
 * @param {object} [o.options]  { portions_defaut, ha_todo_entity }
 * @param {object} [o.log]
 * @param {string|null} [o.supervisorToken]  jeton Home Assistant (add-on) ; null = hors Home Assistant
 * @param {string} [o.haBase]
 * @param {typeof fetch} [o.fetch]
 */
const gzip = promisify(zlib.gzip);
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg)/;

// En-têtes de sécurité de toutes les réponses. La CSP interdit tout script ou ressource venant d'ailleurs que de l'app
// elle-même (les images http(s) d'une recette restent permises : `image` est un champ de la recette ; `blob:` sert au
// décodage d'une photo choisie par l'utilisateur, avant son redimensionnement).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP };
// Une photo n'est jamais un document : même une image piégée ne pourrait rien exécuter.
const FILE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' };

/**
 * @param {string[]|null} [o.allowedPeers]  adresses IP autorisées à se connecter (l'ingress de Home Assistant : 172.30.32.2)
 * @param {string[]|null} [o.allowedHosts]  noms d'hôte acceptés dans l'en-tête Host (protège du « DNS rebinding » en local)
 */
export function createApp({ dataDir, options = {}, log = console, supervisorToken = null, haBase = 'http://supervisor/core/api', fetch: doFetch = globalThis.fetch, allowedPeers = null, allowedHosts = null } = {}) {
  // Le plus gros fichier : JSON compact et copie .bak au plus toutes les 10 min (sinon 2 × 1,7 Mo réécrits à chaque clic sur un cœur).
  const recettes = new JsonStore(path.join(dataDir, 'recettes.json'), { version: 1, recettes: {} }, log, { pretty: false, bakEveryMs: 10 * 60 * 1000 });
  const menu = new JsonStore(path.join(dataDir, 'menu.json'), { version: 1, suivant: 1, repas: [] }, log);
  const etat = new JsonStore(path.join(dataDir, 'etat.json'), { version: 1, courses: {}, stock: [], minuteurs: [] }, log);
  const cfg = {
    portions_defaut: Number(options.portions_defaut) || 4,
    ha_todo_entity: options.ha_todo_entity || 'todo.shopping_list',
    alerte_media_player: String(options.alerte_media_player ?? '').trim(),
    alerte_voix: String(options.alerte_voix ?? '').trim(),
    alerte_son: String(options.alerte_son ?? '').trim(),
  };
  const ha = createHa({ token: supervisorToken, base: haBase, fetch: doFetch, cfg });
  const timers = createTimers({ store: etat, titreRecette: (id) => recettes.data.recettes[id]?.recette.titre, ha, log });
  timers.restore();

  const now = () => new Date().toISOString();
  const entry = (id) => {
    // Object.hasOwn : « __proto__ » ou « constructor » ne doivent pas désigner l'objet prototype (pollution).
    const e = Object.hasOwn(recettes.data.recettes, id) ? recettes.data.recettes[id] : undefined;
    if (!e) throw notFound('Recette introuvable.');
    return e;
  };
  const list = () => Object.values(recettes.data.recettes);

  function uniqueId(titre) {
    const base = slugify(titre);
    let id = base, n = 2;
    while (Object.hasOwn(recettes.data.recettes, id)) id = `${base}-${n++}`;
    return id;
  }
  const newEntry = (id, recette) => ({
    id, recette, photo: null, favori: false, etoiles: 0, memo: '', derniere_cuisson: null, nb_cuissons: 0, cree_le: now(), modifie_le: now(),
  });

  function refreshCooked(recipeId) {
    const e = recettes.data.recettes[recipeId];
    if (!e) return;
    const done = [...menu.data.repas.filter((r) => r.recipeId === recipeId && r.fait).map((r) => r.date), ...(e.cuissons_manuelles ?? [])].sort();
    e.nb_cuissons = done.length;
    e.derniere_cuisson = done.at(-1) ?? null;
  }

  const requireDate = (d, nom = 'date') => {
    if (!ISO.test(String(d ?? ''))) throw bad(`${nom} : format AAAA-MM-JJ attendu.`);
    return d;
  };

  // ------------------------------------------------------------------ routes
  const routes = [];
  const route = (method, pattern, handler, { raw = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, re, keys, handler, raw });
  };

  route('GET', '/api/config', () => ({
    portions_defaut: cfg.portions_defaut,
    ha_todo_entity: cfg.ha_todo_entity,
    format: FORMAT,
    ha: !!supervisorToken,
    // Alerte sur un lecteur multimédia : `mode` vaut « voix », « son » ou null (non configurée).
    alerte: { mode: ha.alertMode(), lecteur: cfg.alerte_media_player || null },
  }));

  // --- Recettes
  route('GET', '/api/recettes', () => list());
  route('GET', '/api/recettes/:id', ({ params }) => entry(params.id));

  route('POST', '/api/recettes', ({ body }) => {
    const { recipe, errors, warnings } = validateRecipe(body);
    if (!recipe) throw Object.assign(bad('Recette invalide.'), { details: { erreurs: errors, avertissements: warnings } });
    const id = uniqueId(recipe.titre);
    const e = recettes.update((d) => (d.recettes[id] = newEntry(id, recipe)));
    return created({ ...e, avertissements: warnings });
  });

  route('PUT', '/api/recettes/:id', ({ params, body }) => {
    const e = entry(params.id);
    const { recipe, errors, warnings } = validateRecipe(body);
    if (!recipe) throw Object.assign(bad('Recette invalide.'), { details: { erreurs: errors, avertissements: warnings } });
    recettes.update(() => {
      e.recette = recipe;
      e.modifie_le = now();
    });
    return { ...e, avertissements: warnings };
  });

  route('PATCH', '/api/recettes/:id', ({ params, body }) => {
    const e = entry(params.id);
    recettes.update(() => {
      if ('favori' in body) e.favori = !!body.favori;
      if ('etoiles' in body) e.etoiles = Math.min(5, Math.max(0, Math.round(Number(body.etoiles) || 0)));
      if ('memo' in body) e.memo = String(body.memo ?? '').slice(0, 5000);
    });
    return e;
  });

  // --- Photos : fichiers dans <data>/photos, une version « complète » et une vignette (réalisée par le navigateur).
  const photosDir = path.join(dataDir, 'photos');
  const photoFile = (id, kind, ext) => path.join(photosDir, `${id}.${kind}.${ext}`);
  const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
  function dropPhotoFiles(id) {
    if (!SAFE_ID.test(id) || !fs.existsSync(photosDir)) return;
    for (const f of fs.readdirSync(photosDir)) if (f.startsWith(`${id}.full.`) || f.startsWith(`${id}.thumb.`)) fs.rmSync(path.join(photosDir, f), { force: true });
  }

  route('PUT', '/api/recettes/:id/photo', ({ params, query, body }) => {
    const e = entry(params.id);
    if (!SAFE_ID.test(e.id)) throw bad('Identifiant de recette invalide.');
    if (!Buffer.isBuffer(body) || !body.length) throw bad('Aucune image reçue.');
    const img = sniffImage(body);
    if (!img) throw new HttpError(415, 'Format non pris en charge : envoyez une image JPEG, PNG ou WebP.');
    const kind = query.get('t') === 'vignette' ? 'thumb' : 'full';
    fs.mkdirSync(photosDir, { recursive: true });
    const target = photoFile(e.id, kind, img.ext);
    // Remplace l'ancienne version (l'extension peut différer), écriture atomique.
    for (const old of fs.readdirSync(photosDir)) if (old.startsWith(`${e.id}.${kind}.`)) fs.rmSync(path.join(photosDir, old), { force: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`; // nom unique : deux envois simultanés ne se marchent pas dessus
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, target);
    recettes.update(() => {
      e.photo = { ...(e.photo ?? {}), v: Date.now(), [kind]: img.ext };
      e.modifie_le = now();
    });
    return e;
  }, { raw: true });

  route('GET', '/api/recettes/:id/photo', ({ params, query }) => {
    const e = entry(params.id);
    const kind = query.get('t') === 'vignette' && e.photo?.thumb ? 'thumb' : 'full';
    const ext = e.photo?.[kind];
    const file = ext && SAFE_ID.test(e.id) ? photoFile(e.id, kind, ext) : null;
    if (!file || !fs.existsSync(file)) throw notFound('Cette recette n’a pas de photo.');
    // `v` (version) change à chaque envoi : l'URL est alors immuable et peut être mise en cache à vie.
    return fileOut(file, IMG_TYPE[ext], query.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache');
  });

  route('DELETE', '/api/recettes/:id/photo', ({ params }) => {
    const e = entry(params.id);
    dropPhotoFiles(e.id);
    recettes.update(() => {
      e.photo = null;
    });
    return e;
  });

  route('DELETE', '/api/recettes/:id', ({ params }) => {
    entry(params.id);
    dropPhotoFiles(params.id);
    recettes.update((d) => delete d.recettes[params.id]);
    menu.update((d) => (d.repas = d.repas.filter((r) => r.recipeId !== params.id)));
    return { ok: true };
  });

  // « Je l'ai cuisinée » hors menu
  route('POST', '/api/recettes/:id/cuisinee', ({ params, body }) => {
    const e = entry(params.id);
    const date = requireDate(body?.date);
    recettes.update(() => {
      e.cuissons_manuelles = [...(e.cuissons_manuelles ?? []), date].slice(-200);
      refreshCooked(e.id);
    });
    return e;
  });

  // --- Import (aperçu possible), mode : ignorer | remplacer | dupliquer
  route('POST', '/api/import', ({ body, query }) => {
    const mode = query.get('mode') || 'ignorer';
    if (!['ignorer', 'remplacer', 'dupliquer'].includes(mode)) throw bad('mode : ignorer, remplacer ou dupliquer.');
    const apercu = query.get('apercu') === '1';
    // Une recette déjà importée depuis la même adresse (champ `source`) est un doublon même si son titre diffère légèrement.
    const bySource = new Map();
    for (const e of Object.values(recettes.data.recettes)) {
      const key = sourceKey(e.recette.source);
      if (key && !bySource.has(key)) bySource.set(key, e);
    }
    const results = validateBundle(body).map((r) => {
      const out = { index: r.index, titre: r.recipe?.titre ?? null, erreurs: r.errors, avertissements: r.warnings };
      if (!r.recipe) return { ...out, statut: 'invalide' };
      const slug = slugify(r.recipe.titre);
      const sameSource = bySource.get(sourceKey(r.recipe.source));
      const existing = Object.hasOwn(recettes.data.recettes, slug) ? recettes.data.recettes[slug] : sameSource;
      if (existing) out.existant = existing.id;
      const statut = !existing ? 'nouveau' : mode === 'remplacer' ? 'remplace' : mode === 'dupliquer' ? 'nouveau' : 'ignore';
      return { ...out, statut, _recipe: r.recipe };
    });
    if (!apercu) {
      recettes.update(() => {
        for (const r of results) {
          if (!r._recipe || r.statut === 'ignore') continue;
          if (r.statut === 'remplace') {
            const e = recettes.data.recettes[r.existant];
            e.recette = r._recipe;
            e.modifie_le = now();
            r.id = e.id;
          } else {
            const id = uniqueId(r._recipe.titre);
            recettes.data.recettes[id] = newEntry(id, r._recipe);
            r.id = id;
          }
        }
      });
    }
    return {
      apercu,
      mode,
      resultats: results.map(({ _recipe, ...r }) => r),
      resume: {
        total: results.length,
        nouveaux: results.filter((r) => r.statut === 'nouveau').length,
        remplaces: results.filter((r) => r.statut === 'remplace').length,
        ignores: results.filter((r) => r.statut === 'ignore').length,
        invalides: results.filter((r) => r.statut === 'invalide').length,
      },
    };
  });

  // Recettes d'exemple (premier lancement) : même format que l'import.
  route('GET', '/api/exemple', () => JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'examples', 'recettes-exemple.json'), 'utf8')));
  route('GET', '/api/export', () => ({ format: FORMAT, exporte_le: now(), recettes: list().map((e) => e.recette) }));

  // --- Menu
  const meal = (id) => {
    const m = menu.data.repas.find((r) => r.id === Number(id));
    if (!m) throw notFound('Repas introuvable.');
    return m;
  };
  function checkMeal(m) {
    requireDate(m.date);
    if (!SLOTS.includes(m.slot)) throw bad(`slot : ${SLOTS.join(', ')}.`);
    entry(m.recipeId);
    const servings = Math.round(Number(m.servings));
    if (!(servings >= 1 && servings <= 100)) throw bad('servings : entier de 1 à 100.');
    return { date: m.date, slot: m.slot, recipeId: m.recipeId, servings };
  }
  const addMeal = (d, m) => {
    if (d.repas.length >= 5000) throw bad('Trop de repas planifiés (5000 au maximum) : videz d’anciennes semaines.');
    const clean = checkMeal(m);
    const pos = d.repas.filter((r) => r.date === clean.date && r.slot === clean.slot).length;
    const rec = { id: d.suivant++, ...clean, position: pos, fait: false };
    d.repas.push(rec);
    return rec;
  };

  route('GET', '/api/menu', ({ query }) => {
    const du = query.get('du') || '0000-00-00', au = query.get('au') || '9999-99-99';
    return menu.data.repas.filter((r) => r.date >= du && r.date <= au);
  });
  route('POST', '/api/menu', ({ body }) => created(menu.update((d) => addMeal(d, body))));
  route('POST', '/api/menu/lot', ({ body }) => {
    if (!Array.isArray(body)) throw bad('Liste de repas attendue.');
    body.forEach(checkMeal); // tout ou rien
    return created(menu.update((d) => body.map((m) => addMeal(d, m))));
  });
  route('PATCH', '/api/menu/:id', ({ params, body }) => {
    const m = meal(params.id);
    menu.update(() => {
      if ('servings' in body) {
        const s = Math.round(Number(body.servings));
        if (!(s >= 1 && s <= 100)) throw bad('servings : entier de 1 à 100.');
        m.servings = s;
      }
      if ('date' in body) m.date = requireDate(body.date);
      if ('slot' in body) {
        if (!SLOTS.includes(body.slot)) throw bad(`slot : ${SLOTS.join(', ')}.`);
        m.slot = body.slot;
      }
      if ('fait' in body) m.fait = !!body.fait;
      refreshCooked(m.recipeId);
    });
    recettes.save();
    return m;
  });
  route('DELETE', '/api/menu/:id', ({ params }) => {
    const m = meal(params.id);
    menu.update((d) => (d.repas = d.repas.filter((r) => r !== m)));
    refreshCooked(m.recipeId);
    recettes.save();
    return { ok: true };
  });
  route('DELETE', '/api/menu', ({ query }) => {
    const du = requireDate(query.get('du'), 'du'), au = requireDate(query.get('au'), 'au');
    let n = 0;
    menu.update((d) => {
      const keep = d.repas.filter((r) => !(r.date >= du && r.date <= au && !r.fait));
      n = d.repas.length - keep.length;
      d.repas = keep;
    });
    return { supprimes: n };
  });

  // --- Courses : cases cochées + lignes ajoutées à la main, par semaine (lundi) ; stock permanent
  route('GET', '/api/courses/:semaine', ({ params }) => etat.data.courses[params.semaine] ?? { coches: [], manuels: [] });
  route('PUT', '/api/courses/:semaine', ({ params, body }) => {
    requireDate(params.semaine, 'semaine');
    const coches = Array.isArray(body.coches) ? body.coches.map(String).slice(0, 2000) : [];
    const manuels = (Array.isArray(body.manuels) ? body.manuels : []).slice(0, 500).map((m) => ({
      id: String(m.id), texte: String(m.texte ?? '').slice(0, 200), coche: !!m.coche,
    }));
    etat.update((d) => {
      d.courses[params.semaine] = { coches, manuels };
      // On ne garde que les 12 dernières semaines.
      for (const k of Object.keys(d.courses).sort().slice(0, -12)) delete d.courses[k];
    });
    return etat.data.courses[params.semaine];
  });
  route('GET', '/api/stock', () => etat.data.stock);
  route('PUT', '/api/stock', ({ body }) => {
    if (!Array.isArray(body)) throw bad('Liste de clés attendue.');
    etat.update((d) => (d.stock = [...new Set(body.map(String))].slice(0, 2000)));
    return etat.data.stock;
  });

  // --- Home Assistant : ajout à une liste « todo » (par défaut todo.shopping_list)
  route('POST', '/api/courses-ha', async ({ body }) => {
    if (!supervisorToken) throw new HttpError(501, 'Disponible uniquement lorsque l’app tourne dans Home Assistant.');
    const items = (Array.isArray(body?.items) ? body.items.slice(0, 300) : []).map((s) => String(s).trim().slice(0, 200)).filter(Boolean);
    if (!items.length) throw bad('Aucun article à envoyer.');
    let ok = 0;
    const echecs = [];
    for (const item of items) {
      try {
        await ha.call('todo/add_item', { entity_id: cfg.ha_todo_entity, item });
        ok++;
      } catch (e) {
        echecs.push(`${item} (${e.message})`);
      }
    }
    if (ok === 0) throw new HttpError(502, `Home Assistant n’a rien accepté (${echecs[0]}). Vérifiez que « ${cfg.ha_todo_entity} » existe.`);
    return { envoyes: ok, echecs, liste: cfg.ha_todo_entity };
  });

  // --- Minuteurs (côté serveur) et alerte sur un lecteur multimédia Home Assistant
  const known = (t) => t ?? (() => { throw notFound('Minuteur introuvable.'); })();
  route('GET', '/api/minuteurs', () => timers.list());
  route('POST', '/api/minuteurs', ({ body }) => created(timers.create(body ?? {})));
  route('POST', '/api/minuteurs/:id/pause', ({ params }) => known(timers.pause(params.id)));
  route('POST', '/api/minuteurs/:id/reprendre', ({ params }) => known(timers.resume(params.id)));
  route('POST', '/api/minuteurs/:id/ajouter', ({ params, body }) => known(timers.add(params.id, body)));
  route('DELETE', '/api/minuteurs/:id', ({ params }) => (known(timers.remove(params.id) || null), { ok: true }));
  route('POST', '/api/alerte/test', async () => {
    try {
      return { mode: await ha.announce('Test de l’alerte Recetteur : le minuteur sonnera ici.'), lecteur: cfg.alerte_media_player };
    } catch (e) {
      if (e instanceof HaError) throw new HttpError(e.status, e.message);
      throw e;
    }
  });

  // ------------------------------------------------------------------ HTTP
  async function readBody(req) {
    if (req.method === 'GET' || req.method === 'DELETE') return undefined;
    // Exiger application/json force le navigateur à une pré-vérification (CORS) pour tout site tiers : un formulaire ou un
    // fetch « simple » venant d'une autre page ne peut donc pas déclencher d'action (CSRF).
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'En-tête « Content-Type: application/json » requis.');
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Corps de requête trop volumineux.');
      chunks.push(c);
    }
    if (!size) return {};
    let v;
    try {
      v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      throw bad(`JSON invalide : ${e.message}`);
    }
    if (v === null || typeof v !== 'object') throw bad('Le corps doit être un objet ou un tableau JSON.');
    return v;
  }

  async function readRaw(req) {
    if (Number(req.headers['content-length']) > MAX_PHOTO) throw new HttpError(413, 'Image trop volumineuse (6 Mo maximum).');
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_PHOTO) throw new HttpError(413, 'Image trop volumineuse (6 Mo maximum).');
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Exécute une route « en processus », sans HTTP : mêmes validations, mêmes règles, mêmes erreurs que l'API.
   * Sert au serveur MCP (server/mcp.js), pour qu'une recette créée par Claude passe exactement par le même chemin que
   * celle collée dans l'interface. Retourne toujours { status, body }.
   */
  async function dispatch(method, url, body) {
    try {
      const u = new URL(url, 'http://x');
      const pathname = decodeURIComponent(u.pathname);
      let matched = false;
      for (const r of routes) {
        if (r.raw) continue; // pas d'envoi binaire par cette voie
        const m = pathname.match(r.re);
        if (!m) continue;
        matched = true;
        if (r.method !== method) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
        const payload = method === 'GET' || method === 'DELETE' ? undefined : structuredClone(body ?? {});
        const out = await r.handler({ params, query: u.searchParams, body: payload });
        if (out?.[FILE]) return { status: 200, body: null };
        return out?.[CREATED] ? { status: 201, body: out.body } : { status: 200, body: out };
      }
      return { status: matched ? 405 : 404, body: { erreur: matched ? 'Méthode non autorisée.' : 'Route inconnue.' } };
    } catch (e) {
      const intentional = e instanceof HttpError || (Number.isInteger(e?.status) && e.status < 500);
      if (!intentional) log.error(e?.stack || e);
      return { status: intentional ? e.status : 500, body: { erreur: intentional ? e.message : 'Erreur interne du serveur.', ...(intentional ? (e.details ?? {}) : {}) } };
    }
  }

  const wantsGzip = (req) => /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');

  /** Réponse JSON, compressée si le client le accepte et que la charge le justifie (l'API de 600 recettes : 865 Ko → 55 Ko). */
  async function send(req, res, status, payload, headers = {}) {
    let body = Buffer.from(JSON.stringify(payload));
    const h = { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...SECURITY_HEADERS, 'Cross-Origin-Resource-Policy': 'same-origin', ...headers };
    if (body.length > 1024 && wantsGzip(req)) {
      body = await gzip(body);
      h['Content-Encoding'] = 'gzip';
    }
    h['Content-Length'] = body.length;
    res.writeHead(status, h);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function serveStatic(req, res, pathname) {
    let base = PUBLIC, rel = pathname;
    if (pathname.startsWith('/shared/')) (base = SHARED), (rel = pathname.slice('/shared'.length));
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(base, rel));
    if (rel.includes('\0') || !file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      return res.end('Introuvable');
    }
    // Les polices et icônes changent rarement : une semaine de cache ; le code (JS/CSS/HTML) se revalide à chaque ouverture (ETag).
    const stable = /^\/(fonts|icons)\//.test(rel);
    return sendFile(req, res, file, MIME[path.extname(file)] ?? 'application/octet-stream', stable ? 'public, max-age=604800' : 'no-cache', SECURITY_HEADERS);
  }

  const gzFiles = new Map(); // fichier → { key, buf } : on ne compresse chaque fichier statique qu'une fois
  /** Envoie un fichier avec ETag (304 si inchangé) et compression gzip des textes. */
  function sendFile(req, res, file, type, cache, extra = FILE_HEADERS) {
    const st = fs.statSync(file);
    const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
    const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': cache, Vary: 'Accept-Encoding', ...extra };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    if (COMPRESSIBLE.test(type) && st.size > 1024 && wantsGzip(req)) {
      const key = `${st.size}-${st.mtimeMs}`;
      let hit = gzFiles.get(file);
      if (hit?.key !== key) gzFiles.set(file, (hit = { key, buf: zlib.gzipSync(fs.readFileSync(file), { level: 9 }) }));
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': hit.buf.length });
      return res.end(req.method === 'HEAD' ? undefined : hit.buf);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const refused = new Set();
  /** Filtre d'accès, avant tout routage. Retourne l'erreur à renvoyer, ou null. */
  function gate(req) {
    const peer = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (allowedPeers && !allowedPeers.has(peer)) {
      if (!refused.has(peer)) {
        refused.add(peer);
        log.error(`Connexion refusée depuis ${peer} : seul l’ingress de Home Assistant (${[...allowedPeers].join(', ')}) est autorisé (option « ingress_only »).`);
      }
      return new HttpError(403, 'Accès refusé.');
    }
    if (allowedHosts && !allowedHosts.has(String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, ''))) return new HttpError(403, 'Nom d’hôte non autorisé.');
    // Une écriture déclenchée depuis une autre page web (CSRF) est refusée : les navigateurs récents annoncent l'origine.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return new HttpError(403, 'Requête inter-sites refusée.');
    }
    return null;
  }

  async function handle(req, res) {
    try {
      const denied = gate(req);
      if (denied) throw denied;
      let url, pathname;
      try {
        url = new URL(req.url, 'http://x');
        pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, '/'); // URIError sur « %E0%A4%A » : à l'intérieur du try
      } catch {
        throw bad('URL invalide.');
      }
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée.');
        return serveStatic(req, res, pathname);
      }
      let matched = false;
      for (const r of routes) {
        const m = pathname.match(r.re);
        if (!m) continue;
        matched = true;
        if (r.method !== req.method) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
        const out = await r.handler({ params, query: url.searchParams, body: await (r.raw ? readRaw(req) : readBody(req)) });
        if (out?.[FILE]) return sendFile(req, res, out.file, out.type, out.cache);
        return out?.[CREATED] ? await send(req, res, 201, out.body) : await send(req, res, 200, out);
      }
      throw matched ? new HttpError(405, 'Méthode non autorisée.') : notFound('Route inconnue.');
    } catch (e) {
      // Les erreurs « voulues » (HttpError, ou portant un code < 500) disent ce qui ne va pas ; une erreur inattendue est
      // journalisée en détail côté serveur et ne révèle rien au client (chemins, messages du moteur…).
      const intentional = e instanceof HttpError || (Number.isInteger(e?.status) && e.status < 500);
      if (!intentional) log.error(e?.stack || e);
      const status = intentional ? e.status : 500;
      if (res.headersSent) return res.destroy();
      await send(req, res, status, { erreur: intentional ? e.message : 'Erreur interne du serveur.', ...(intentional ? (e.details ?? {}) : {}) });
    }
  }

  const server = http.createServer((req, res) => {
    // Filet de sécurité : aucune requête ne doit jamais faire tomber le processus (Node arrête sur une promesse rejetée).
    handle(req, res).catch((e) => {
      log.error(e?.stack || e);
      try { res.headersSent ? res.destroy() : (res.writeHead(500, SECURITY_HEADERS), res.end()); } catch { /* connexion déjà fermée */ }
    });
  });
  server.headersTimeout = 20_000; // anti « slowloris » : un client qui goutte-à-goutte ses en-têtes est coupé
  server.requestTimeout = 120_000;

  server.on('close', () => timers.close());
  return { server, stores: { recettes, menu, etat }, config: cfg, timers, dispatch };
}
