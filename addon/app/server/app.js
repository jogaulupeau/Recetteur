// API + fichiers statiques. Aucune dépendance : node:http uniquement.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './store.js';
import { createHa, HaError } from './ha.js';
import { createTimers } from './minuteurs.js';
import { validateRecipe, validateBundle } from '../shared/recipe.js';
import { slugify } from '../shared/text.js';
import { FORMAT } from '../shared/vocab.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, '..', 'public');
const SHARED = path.join(ROOT, '..', 'shared');
const MAX_BODY = 8 * 1024 * 1024;
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
export function createApp({ dataDir, options = {}, log = console, supervisorToken = null, haBase = 'http://supervisor/core/api', fetch: doFetch = globalThis.fetch } = {}) {
  const recettes = new JsonStore(path.join(dataDir, 'recettes.json'), { version: 1, recettes: {} }, log);
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
    const e = recettes.data.recettes[id];
    if (!e) throw notFound('Recette introuvable.');
    return e;
  };
  const list = () => Object.values(recettes.data.recettes);

  function uniqueId(titre) {
    const base = slugify(titre);
    let id = base, n = 2;
    while (recettes.data.recettes[id]) id = `${base}-${n++}`;
    return id;
  }
  const newEntry = (id, recette) => ({
    id, recette, favori: false, etoiles: 0, memo: '', derniere_cuisson: null, nb_cuissons: 0, cree_le: now(), modifie_le: now(),
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
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, re, keys, handler });
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

  route('DELETE', '/api/recettes/:id', ({ params }) => {
    entry(params.id);
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
    const results = validateBundle(body).map((r) => {
      const out = { index: r.index, titre: r.recipe?.titre ?? null, erreurs: r.errors, avertissements: r.warnings };
      if (!r.recipe) return { ...out, statut: 'invalide' };
      const existing = recettes.data.recettes[slugify(r.recipe.titre)];
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
    const items = (Array.isArray(body?.items) ? body.items : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 300);
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
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Corps de requête trop volumineux.');
      chunks.push(c);
    }
    if (!size) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      throw bad(`JSON invalide : ${e.message}`);
    }
  }

  const send = (res, status, payload, headers = {}) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };

  function serveStatic(req, res, pathname) {
    let base = PUBLIC, rel = pathname;
    if (pathname.startsWith('/shared/')) (base = SHARED), (rel = pathname.slice('/shared'.length));
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable');
    }
    const st = fs.statSync(file);
    const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
    const headers = { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', ETag: etag, 'Cache-Control': 'no-cache' };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, '/');
    try {
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
        const out = await r.handler({ params, query: url.searchParams, body: await readBody(req) });
        return out?.[CREATED] ? send(res, 201, out.body) : send(res, 200, out);
      }
      throw matched ? new HttpError(405, 'Méthode non autorisée.') : notFound('Route inconnue.');
    } catch (e) {
      const status = e.status ?? 500;
      if (status >= 500 && !(e instanceof HttpError)) log.error(e.stack || e);
      send(res, status, { erreur: e.message, ...(e.details ?? {}) });
    }
  });

  server.on('close', () => timers.close());
  return { server, stores: { recettes, menu, etat }, config: cfg, timers };
}
