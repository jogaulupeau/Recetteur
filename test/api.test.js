import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { exemples } from './helpers.js';

let dir, app, base, haCalls, haFail = false;
const silent = { info() {}, error() {} };
const api = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recetteur-'));
  haCalls = [];
  const fakeFetch = async (url, init) => {
    haCalls.push({ url, ...init, body: JSON.parse(init.body) });
    return { ok: !haFail, status: haFail ? 404 : 200 };
  };
  app = createApp({ dataDir: dir, log: silent, supervisorToken: 'tok', fetch: fakeFetch, options: { portions_defaut: 3 } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => {
  app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config', async () => {
  const { body } = await api('GET', '/api/config');
  assert.equal(body.portions_defaut, 3);
  assert.equal(body.ha, true);
});

test('import : aperçu sans écriture, puis import, puis doublons', async () => {
  const bundle = { format: 'recetteur/v1', recettes: [...exemples, { titre: 'Cassée' }] };
  let r = await api('POST', '/api/import?apercu=1', bundle);
  assert.equal(r.body.resume.nouveaux, 5);
  assert.equal(r.body.resume.invalides, 1);
  assert.equal((await api('GET', '/api/recettes')).body.length, 0);

  r = await api('POST', '/api/import', bundle);
  assert.equal(r.body.resume.nouveaux, 5);
  assert.equal((await api('GET', '/api/recettes')).body.length, 5);

  r = await api('POST', '/api/import', bundle); // mode par défaut : ignorer
  assert.equal(r.body.resume.ignores, 5);
  assert.equal((await api('GET', '/api/recettes')).body.length, 5);

  r = await api('POST', '/api/import?mode=dupliquer', [exemples[0]]);
  assert.equal(r.body.resultats[0].id, 'spaghetti-bolognaise-2');
  r = await api('POST', '/api/import?mode=remplacer', [{ ...exemples[0], portions: 6 }]);
  assert.equal(r.body.resultats[0].statut, 'remplace');
  assert.equal((await api('GET', '/api/recettes/spaghetti-bolognaise')).body.recette.portions, 6);
  await api('DELETE', '/api/recettes/spaghetti-bolognaise-2');
});

test('CRUD recette, favoris, erreurs de validation lisibles', async () => {
  let r = await api('POST', '/api/recettes', { titre: 'x' });
  assert.equal(r.status, 400);
  assert.ok(r.body.erreurs.length >= 3);

  r = await api('POST', '/api/recettes', { titre: 'Crêpes', portions: 4, ingredients: [{ nom: 'farine', quantite: 250, unite: 'g' }], etapes: ['Mélanger.'] });
  assert.equal(r.status, 201);
  assert.equal(r.body.id, 'crepes');

  r = await api('PATCH', '/api/recettes/crepes', { favori: true, etoiles: 9, memo: 'Super' });
  assert.deepEqual([r.body.favori, r.body.etoiles, r.body.memo], [true, 5, 'Super']);

  r = await api('PUT', '/api/recettes/crepes', { titre: 'Crêpes', portions: 8, ingredients: [{ nom: 'farine', quantite: 500, unite: 'g' }], etapes: ['Mélanger.'] });
  assert.equal(r.body.recette.portions, 8);
  assert.equal(r.body.favori, true); // le suivi est conservé

  assert.equal((await api('GET', '/api/recettes/inconnue')).status, 404);
  assert.equal((await api('DELETE', '/api/recettes/crepes')).status, 200);
  assert.equal((await api('GET', '/api/recettes/crepes')).status, 404);
});

test('menu : ajout, lot, filtre, « fait » met à jour la dernière cuisson', async () => {
  let r = await api('POST', '/api/menu', { date: '2026-11-17', slot: 'soir', recipeId: 'gratin-de-courgettes', servings: 4 });
  assert.equal(r.status, 201);
  const id = r.body.id;
  assert.equal((await api('POST', '/api/menu', { date: '2026-11-17', slot: 'brunch', recipeId: 'gratin-de-courgettes', servings: 4 })).status, 400);
  assert.equal((await api('POST', '/api/menu', { date: '2026-11-17', slot: 'soir', recipeId: 'nope', servings: 4 })).status, 404);

  r = await api('POST', '/api/menu/lot', [
    { date: '2026-11-18', slot: 'midi', recipeId: 'tarte-aux-pommes', servings: 8 },
    { date: '2026-11-25', slot: 'midi', recipeId: 'tarte-aux-pommes', servings: 8 },
  ]);
  assert.equal(r.body.length, 2);
  assert.equal((await api('GET', '/api/menu?du=2026-11-16&au=2026-11-22')).body.length, 2);

  await api('PATCH', `/api/menu/${id}`, { fait: true });
  let g = (await api('GET', '/api/recettes/gratin-de-courgettes')).body;
  assert.equal(g.derniere_cuisson, '2026-11-17');
  assert.equal(g.nb_cuissons, 1);
  await api('PATCH', `/api/menu/${id}`, { fait: false });
  g = (await api('GET', '/api/recettes/gratin-de-courgettes')).body;
  assert.equal(g.derniere_cuisson, null);

  r = await api('DELETE', '/api/menu?du=2026-11-16&au=2026-11-22');
  assert.equal(r.body.supprimes, 2);
});

test('supprimer une recette la retire du menu', async () => {
  await api('POST', '/api/menu', { date: '2026-12-01', slot: 'soir', recipeId: 'tarte-aux-pommes', servings: 4 });
  await api('DELETE', '/api/recettes/tarte-aux-pommes');
  assert.equal((await api('GET', '/api/menu?du=2026-12-01&au=2026-12-01')).body.length, 0);
});

test('courses : état par semaine, stock', async () => {
  const put = { coches: ['ail'], manuels: [{ id: 'm1', texte: 'Papier toilette', coche: false }] };
  assert.equal((await api('PUT', '/api/courses/2026-11-16', put)).status, 200);
  assert.deepEqual((await api('GET', '/api/courses/2026-11-16')).body, put);
  assert.deepEqual((await api('GET', '/api/courses/2030-01-01')).body, { coches: [], manuels: [] });
  assert.equal((await api('PUT', '/api/courses/lundi', put)).status, 400);
  assert.deepEqual((await api('PUT', '/api/stock', ['sel', 'sel', 'poivre'])).body, ['sel', 'poivre']);
});

test('Home Assistant : envoi des articles vers la liste todo', async () => {
  const r = await api('POST', '/api/courses-ha', { items: ['Tomates — 800 g', 'Ail — 6 gousses'] });
  assert.equal(r.body.envoyes, 2);
  assert.equal(r.body.liste, 'todo.shopping_list');
  assert.equal(haCalls.length, 2);
  assert.equal(haCalls[0].url, 'http://supervisor/core/api/services/todo/add_item');
  assert.equal(haCalls[0].headers.Authorization, 'Bearer tok');
  assert.deepEqual(haCalls[0].body, { entity_id: 'todo.shopping_list', item: 'Tomates — 800 g' });
  haFail = true;
  assert.equal((await api('POST', '/api/courses-ha', { items: ['x'] })).status, 502);
  assert.equal((await api('POST', '/api/courses-ha', { items: [] })).status, 400);
  haFail = false;
});

test('données persistées sur disque, relues au redémarrage', () => {
  const app2 = createApp({ dataDir: dir, log: silent });
  assert.ok(app2.stores.recettes.data.recettes['poulet-roti-aux-pommes-de-terre']);
  assert.equal(app2.config.portions_defaut, 4);
});

test('fichier corrompu : mis de côté, pas écrasé', () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'recetteur-'));
  fs.writeFileSync(path.join(d2, 'recettes.json'), '{ pas du json');
  const a = createApp({ dataDir: d2, log: silent });
  assert.deepEqual(a.stores.recettes.data.recettes, {});
  assert.ok(fs.readdirSync(d2).some((f) => f.endsWith('.corrompu')));
  fs.rmSync(d2, { recursive: true, force: true });
});

test('statique : index, partage, anti-traversée de chemin ; routes inconnues', async () => {
  assert.equal((await fetch(base + '/shared/vocab.js')).status, 200);
  assert.equal((await fetch(base + '/shared/../server/app.js')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/server/app.js')).status, 404);
  assert.equal((await api('GET', '/api/nimporte')).status, 404);
  assert.equal((await api('PUT', '/api/menu')).status, 405);
  const r = await fetch(base + '/api/recettes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oups' });
  assert.equal(r.status, 400);
});
