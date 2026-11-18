import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { createApp } from '../server/app.js';
import { JsonStore } from '../server/store.js';
import { validateRecipe, validateBundle, LIMITS } from '../shared/recipe.js';
import { exemples } from './helpers.js';

const errors = [];
const log = { info() {}, error: (...a) => errors.push(a.join(' ')) };
const J = { 'Content-Type': 'application/json' };

async function boot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recetteur-sec-'));
  const app = createApp({ dataDir: dir, log, ...opts });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  // `fetch` décompresse lui-même le gzip (l'en-tête content-encoding reste visible) ; les Buffer partent tels quels (images).
  const call = async (method, url, body, headers = J) => {
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString()); } catch { /* pas du JSON */ }
    return { status: res.status, headers: res.headers, json, buf };
  };
  // Lecture « brute » : les octets compressés tels qu'ils circulent sur le réseau.
  const rawGet = (reqPath, headers = {}) => new Promise((resolve, reject) => {
    http.get({ port, host: '127.0.0.1', path: reqPath, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  // requête « brute » (en-tête Host choisi, URL non normalisée)
  const raw = (reqPath, headers = {}) => new Promise((resolve) => {
    const q = http.request({ port, host: '127.0.0.1', path: reqPath, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    q.on('error', (e) => resolve(`erreur ${e.code}`));
    q.end();
  });
  return { app, call, raw, rawGet, dir, port, close: () => new Promise((r) => app.server.close(r)) };
}
const sample = { titre: 'Test', portions: 2, ingredients: [{ nom: 'farine', quantite: 1, unite: 'kg' }], etapes: ['Cuire.'] };

test('pollution de prototype : « __proto__ », « constructor »… ne désignent jamais un objet interne', async () => {
  const t = await boot();
  await t.call('POST', '/api/recettes', sample);
  for (const id of ['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'prototype']) {
    for (const [m, body] of [['GET'], ['PATCH', { favori: true, etoiles: 5, memo: 'x' }], ['PUT', sample], ['DELETE'], ['POST', {}]]) {
      const url = m === 'POST' ? `/api/recettes/${id}/cuisinee` : `/api/recettes/${id}`;
      const r = await t.call(m, url, body);
      assert.equal(r.status, 404, `${m} ${id} → ${r.status}`);
    }
    assert.equal((await t.call('PUT', `/api/recettes/${id}/photo`, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 0, 0, 0, 0, 0, 0]), { 'Content-Type': 'image/jpeg' })).status, 404);
  }
  assert.equal(({}).favori, undefined);
  assert.equal(Object.prototype.favori, undefined);
  assert.equal(Object.keys(Object.prototype).length, 0);

  // Un titre qui vaut « constructor » est une recette comme une autre — sans casser la détection de doublons.
  const bundle = [{ ...sample, titre: 'constructor' }];
  let r = await t.call('POST', '/api/import', bundle);
  assert.equal(r.json.resultats[0].statut, 'nouveau');
  r = await t.call('POST', '/api/import', bundle);
  assert.equal(r.json.resultats[0].statut, 'ignore');
  assert.equal((await t.call('PATCH', '/api/recettes/constructor', { favori: true })).json.favori, true);
  assert.equal(Object.prototype.favori, undefined);
  await t.close();
});

test('URL malformée : réponse 400, le serveur ne s’arrête pas (régression : URIError hors try)', async () => {
  const t = await boot();
  for (const p of ['/%E0%A4%A', '/api/recettes/%E0%A4%A', '/%', '/api/%zz']) assert.equal(await t.raw(p), 400, p);
  assert.equal(await t.raw('/api/config'), 200); // toujours en vie
  await t.close();
});

test('CSRF : une écriture sans application/json ou venant d’un autre site est refusée', async () => {
  const t = await boot({ supervisorToken: 'tok', fetch: async () => ({ ok: true, status: 200 }) });
  for (const [u, b] of [['/api/recettes', sample], ['/api/menu', {}], ['/api/courses-ha', { items: ['x'] }], ['/api/alerte/test', {}], ['/api/minuteurs', { secondes: 5 }]]) {
    // formulaire / fetch « simple » d'une autre page : text/plain
    assert.equal((await t.call('POST', u, JSON.stringify(b), { 'Content-Type': 'text/plain' })).status, 415, `${u} text/plain`);
    assert.equal((await t.call('POST', u, JSON.stringify(b), { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415, `${u} form`);
    assert.equal((await t.call('POST', u, undefined, {})).status, 415, `${u} sans en-tête`);
    // en-tête annoncé par le navigateur : requête inter-sites
    for (const site of ['cross-site', 'same-site']) assert.equal((await t.call('POST', u, b, { ...J, 'Sec-Fetch-Site': site })).status, 403, `${u} ${site}`);
  }
  assert.equal((await t.call('DELETE', '/api/recettes/x', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await t.call('PUT', '/api/recettes/x/photo', Buffer.from('x'), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  // usage légitime : même origine, ou pas d'en-tête (curl, tests)
  assert.equal((await t.call('POST', '/api/recettes', sample, { ...J, 'Sec-Fetch-Site': 'same-origin' })).status, 201);
  assert.equal((await t.call('POST', '/api/recettes', { ...sample, titre: 'Autre' }, { ...J, 'Sec-Fetch-Site': 'none' })).status, 201);
  assert.equal((await t.call('GET', '/api/recettes', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 200); // lecture : le navigateur bloquera la lecture par la page tierce
  assert.equal((await t.call('GET', '/api/recettes')).json.length, 2); // rien n'a été créé par les attaques
  await t.close();
});

test('corps JSON inattendus : 400 propre, jamais 500', async () => {
  const t = await boot({ supervisorToken: 'tok', fetch: async () => ({ ok: true, status: 200 }) });
  await t.call('POST', '/api/recettes', sample);
  for (const body of ['null', '"texte"', '42', 'true', '[1,2]']) {
    for (const [m, u] of [['PATCH', '/api/recettes/test'], ['POST', '/api/menu'], ['PUT', '/api/courses/2026-11-16'], ['PUT', '/api/stock'], ['POST', '/api/minuteurs'], ['POST', '/api/courses-ha']]) {
      const r = await t.call(m, u, body);
      // jamais 500 ; les valeurs scalaires ou null sont refusées (400), un tableau est un objet JSON valide (sans effet ici)
      assert.ok(r.status < 500 && (body === '[1,2]' || r.status >= 400), `${m} ${u} ${body} → ${r.status}`);
    }
  }
  assert.equal((await t.call('PATCH', '/api/recettes/test', '{oups')).status, 400);
  await t.close();
});

test('une erreur interne ne révèle rien au client (mais est journalisée)', async () => {
  errors.length = 0;
  const t = await boot();
  await t.call('POST', '/api/recettes', sample);
  t.app.stores.recettes.save = () => { throw new Error("ENOSPC: no space left on device, write '/data/recettes.json.tmp'"); };
  const r = await t.call('PATCH', '/api/recettes/test', { favori: true });
  assert.equal(r.status, 500);
  assert.equal(r.json.erreur, 'Erreur interne du serveur.');
  assert.doesNotMatch(JSON.stringify(r.json), /ENOSPC|\/data|recettes\.json/);
  assert.ok(errors.some((e) => e.includes('ENOSPC')), 'détail journalisé côté serveur');
  assert.equal((await t.call('GET', '/api/config')).status, 200); // et l'app continue
  await t.close();
});

test('en-têtes de sécurité : CSP, nosniff, pas de Referer ; photos en bac à sable', async () => {
  const t = await boot();
  for (const u of ['/', '/api/config', '/js/app.js', '/css/app.css', '/shared/vocab.js', '/inexistant']) {
    const r = await t.call('GET', u);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/, u);
    assert.match(csp, /script-src 'self'(;|$)/, u);   // aucun script inline ni externe
    assert.match(csp, /object-src 'none'/, u);
    assert.match(csp, /img-src [^;]*blob:/, u);       // décodage d'une photo choisie (repli <img> : Safari, HEIC)
    assert.match(csp, /frame-ancestors 'self'/, u);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', u);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', u);
  }
  await t.call('POST', '/api/recettes', sample);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF-test-xx'), Buffer.from([0xff, 0xd9])]);
  assert.equal((await t.call('PUT', '/api/recettes/test/photo', jpeg, { 'Content-Type': 'image/jpeg' })).status, 200);
  const photo = await t.call('GET', '/api/recettes/test/photo');
  assert.equal(photo.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(photo.headers.get('cross-origin-resource-policy'), 'same-origin');
  // pas de CORS : une page tierce ne peut pas lire l'API
  assert.equal((await t.call('GET', '/api/config', undefined, { Origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
  assert.equal(await t.raw('/api/recettes', { Origin: 'https://evil.example' }) >= 200, true);
  await t.close();
});

test('filtre d’accès : seul l’ingress (pairs) et les hôtes attendus (DNS rebinding)', async () => {
  errors.length = 0;
  let t = await boot({ allowedPeers: new Set(['172.30.32.2']) });
  assert.equal((await t.call('GET', '/api/config')).status, 403);
  assert.equal(await t.raw('/'), 403);
  assert.equal(errors.filter((e) => e.includes('Connexion refusée depuis 127.0.0.1')).length, 1, 'journalisé une seule fois par adresse');
  await t.close();

  t = await boot({ allowedPeers: new Set(['127.0.0.1', '172.30.32.2']) });
  assert.equal((await t.call('GET', '/api/config')).status, 200);
  await t.close();

  t = await boot({ allowedHosts: new Set(['localhost', '127.0.0.1', '[::1]']) });
  assert.equal(await t.raw('/api/config', { Host: `localhost:${t.port}` }), 200);
  assert.equal(await t.raw('/api/config', { Host: `127.0.0.1:${t.port}` }), 200);
  assert.equal(await t.raw('/api/config', { Host: `[::1]:${t.port}` }), 200);
  assert.equal(await t.raw('/api/config', { Host: 'evil.example' }), 403);
  assert.equal(await t.raw('/api/config', { Host: `evil.example:${t.port}` }), 403);
  assert.equal(await t.raw('/', { Host: 'attaquant.test' }), 403);
  await t.close();
});

test('limites : tailles, nombre d’éléments, complexité linéaire, URL d’image', () => {
  const base = () => ({ titre: 'T', portions: 2, ingredients: [{ id: 'a', nom: 'sel', quantite: 1, unite: 'g' }], etapes: [{ texte: 'x {{a}}' }] });
  const bad = (mut) => { const r = base(); mut(r); return validateRecipe(r); };
  assert.ok(bad((r) => (r.ingredients = Array.from({ length: LIMITS.ingredients + 1 }, (_, i) => ({ nom: `i${i}` })))).errors.some((e) => e.startsWith('ingredients')));
  assert.ok(bad((r) => (r.etapes = Array.from({ length: LIMITS.etapes + 1 }, () => 'x'))).errors.some((e) => e.startsWith('etapes')));
  assert.ok(bad((r) => (r.etapes = [{ texte: 'x'.repeat(LIMITS.texte + 1) }])).errors.length);
  assert.ok(bad((r) => (r.description = 'x'.repeat(LIMITS.description + 1))).errors.some((e) => e.startsWith('description')));
  assert.ok(bad((r) => (r.titre = 'x'.repeat(LIMITS.titre + 1))).errors.length);
  assert.ok(bad((r) => (r.tags = Array.from({ length: 50 }, (_, i) => `t${i}`))).errors.some((e) => e.startsWith('tags')));
  // 300 ingrédients de même id : ids uniques, et en temps linéaire (avant : 30 000 → 29 s)
  const t0 = Date.now();
  const many = validateRecipe({ ...base(), ingredients: Array.from({ length: LIMITS.ingredients }, () => ({ id: 'x', nom: 'a', quantite: 1 })), etapes: [{ texte: 'x' }] });
  assert.deepEqual(many.errors, []);
  assert.equal(new Set(many.recipe.ingredients.map((i) => i.id)).size, LIMITS.ingredients);
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
  // lot trop gros
  assert.match(validateBundle(Array.from({ length: LIMITS.recettes + 1 }, base))[0].errors[0], /Trop de recettes/);
  // seules les URL http(s) sont acceptées comme image
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', '//evil.example/x.png', 'ftp://x/y.png']) {
    const r = validateRecipe({ ...base(), image: bad });
    assert.equal(r.recipe.image, undefined, bad);
    assert.ok(r.warnings.some((w) => w.startsWith('image')), bad);
  }
  assert.equal(validateRecipe({ ...base(), image: 'https://exemple.fr/p.jpg' }).recipe.image, 'https://exemple.fr/p.jpg');
});

test('une importation démesurée est refusée vite, sans bloquer le serveur', async () => {
  const t = await boot();
  const bomb = { titre: 'Bomb', portions: 2, ingredients: Array.from({ length: 30000 }, () => ({ id: 'x', nom: 'a', quantite: 1 })), etapes: ['x'] };
  const t0 = Date.now();
  const r = await t.call('POST', '/api/import?apercu=1', bomb);
  assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms (avant : 29 s)`);
  assert.equal(r.json.resume.invalides, 1);
  assert.equal((await t.call('POST', '/api/recettes', { ...sample, description: 'x'.repeat(5000) })).status, 400);
  await t.close();
});

test('minuteurs : plafond de 50 (un même minuteur relancé le remplace)', async () => {
  const t = await boot();
  for (let i = 0; i < 50; i++) assert.equal((await t.call('POST', '/api/minuteurs', { secondes: 600, libelle: `m${i}`, cle: `k${i}` })).status, 201);
  assert.equal((await t.call('POST', '/api/minuteurs', { secondes: 600 })).status, 400);
  assert.equal((await t.call('POST', '/api/minuteurs', { secondes: 300, libelle: 'relancé', cle: 'k3' })).status, 201);
  assert.equal((await t.call('GET', '/api/minuteurs')).json.minuteurs.length, 50);
  await t.close();
});

test('compression : API et fichiers statiques en gzip, 304 conservé, polices en cache long', async () => {
  const t = await boot();
  await t.call('POST', '/api/import', { format: 'recetteur/v1', recettes: exemples });
  const api = await t.rawGet('/api/recettes', { 'Accept-Encoding': 'gzip' });
  assert.equal(api.headers['content-encoding'], 'gzip');
  const plain = zlib.gunzipSync(api.body);
  assert.equal(JSON.parse(plain).length, exemples.length);
  assert.ok(api.body.length < plain.length / 2, `${api.body.length} o au lieu de ${plain.length} o`);
  const nogz = await t.rawGet('/api/recettes');
  assert.equal(nogz.headers['content-encoding'], undefined); // client sans gzip
  assert.equal(nogz.body.length, plain.length);
  assert.equal((await t.rawGet('/api/config', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], undefined); // trop petit pour valoir le coût

  const js = await t.rawGet('/js/art.js', { 'Accept-Encoding': 'gzip' });
  assert.equal(js.headers['content-encoding'], 'gzip');
  assert.match(zlib.gunzipSync(js.body).toString(), /plateSvg/);
  assert.match(js.headers.vary, /Accept-Encoding/);
  assert.ok(js.body.length < fs.statSync(new URL('../public/js/art.js', import.meta.url)).size / 2);
  assert.equal((await t.rawGet('/js/art.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': js.headers.etag })).status, 304);
  const font = await t.rawGet('/fonts/figtree.woff2', { 'Accept-Encoding': 'gzip' });
  assert.equal(font.headers['content-encoding'], undefined); // déjà compressée
  assert.match(font.headers['cache-control'], /max-age=604800/);
  assert.equal(js.headers['cache-control'], 'no-cache');
  await t.close();
});

test('stockage : JSON compact et copie .bak limitée dans le temps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recetteur-store-'));
  const f = path.join(dir, 'big.json');
  const s = new JsonStore(f, { v: 0, liste: [1, 2, 3] }, log, { pretty: false, bakEveryMs: 60_000 });
  s.update((d) => (d.v = 1)); // 1re écriture : pas de fichier à sauvegarder
  assert.equal(fs.existsSync(`${f}.bak`), false);
  assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\n/, 'compact');
  s.update((d) => (d.v = 2)); // 2e : la copie se crée (état « v = 1 »)
  assert.equal(JSON.parse(fs.readFileSync(`${f}.bak`, 'utf8')).v, 1);
  s.update((d) => (d.v = 3)); // 3e, aussitôt : la copie est récente, on ne la recopie pas
  s.update((d) => (d.v = 4));
  assert.equal(JSON.parse(fs.readFileSync(`${f}.bak`, 'utf8')).v, 1);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).v, 4);
  // par défaut (petits fichiers) : indenté, copie à chaque fois
  const p = new JsonStore(path.join(dir, 'small.json'), { v: 0 }, log);
  p.update((d) => (d.v = 1)); p.update((d) => (d.v = 2)); p.update((d) => (d.v = 3));
  assert.match(fs.readFileSync(path.join(dir, 'small.json'), 'utf8'), /\n {2}"v"/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'small.json.bak'), 'utf8')).v, 2);
});

test('deux envois de photo simultanés ne se corrompent pas', async () => {
  const t = await boot();
  await t.call('POST', '/api/recettes', sample);
  const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.alloc(2000, n), Buffer.from([0xff, 0xd9])]);
  const rs = await Promise.all([1, 2, 3, 4].map((n) => t.call('PUT', '/api/recettes/test/photo', jpeg(n), { 'Content-Type': 'image/jpeg' })));
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200, 200]);
  const files = fs.readdirSync(path.join(t.dir, 'photos'));
  assert.deepEqual(files, ['test.full.jpg']); // aucun .tmp orphelin
  await t.close();
});
