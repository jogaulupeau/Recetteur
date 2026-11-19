import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createMenuPublisher, ENTITIES, EMPTY, snapshot } from '../server/menu-ha.js';
import { exemples } from './helpers.js';

const silent = { info() {}, error() {} };
const DAY = '2026-11-19';

async function boot({ options = {}, token = 'tok', failing = () => false, slug = 'db891f0a_recetteur' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recetteur-sensors-'));
  const calls = [];
  const infoCalls = [];
  const fakeFetch = async (url, init) => {
    if (url.endsWith('/addons/self/info')) { // identité de l'app, demandée au Supervisor pour construire les liens
      infoCalls.push({ url, auth: init.headers.Authorization });
      return slug ? { ok: true, status: 200, json: async () => ({ result: 'ok', data: { slug } }) } : { ok: false, status: 403 };
    }
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return { ok: !failing(), status: failing() ? 503 : 200 };
  };
  const app = createApp({ dataDir: dir, log: silent, supervisorToken: token, haBase: 'http://ha/api', fetch: fakeFetch, options });
  const post = async (url, body) => app.dispatch('POST', url, body);
  await post('/api/import', exemples);
  const ids = Object.keys(app.stores.recettes.data.recettes);
  return { app, calls, infoCalls, ids, post, dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const states = (calls) => Object.fromEntries(calls.filter((c) => c.url.includes('/states/')).map((c) => [c.url.split('/states/')[1], c.body]));

test('capteurs : un pour le midi, un pour le soir, uniquement le jour demandé', async () => {
  const t = await boot();
  try {
    const [a, b] = t.ids;
    await t.post('/api/menu', { date: DAY, slot: 'midi', recipeId: a, servings: 4 });
    await t.post('/api/menu', { date: DAY, slot: 'soir', recipeId: b, servings: 2 });
    await t.post('/api/menu', { date: DAY, slot: 'soir', recipeId: a, servings: 2 });
    await t.post('/api/menu', { date: '2026-11-20', slot: 'midi', recipeId: b, servings: 4 }); // un autre jour : jamais publié
    t.calls.length = 0;

    assert.equal(await t.app.sensors.publish(DAY), true);
    const s = states(t.calls);
    assert.deepEqual(Object.keys(s).sort(), ['sensor.recetteur_menu_midi', 'sensor.recetteur_menu_soir']);
    const midi = s['sensor.recetteur_menu_midi'];
    const soir = s['sensor.recetteur_menu_soir'];
    const titre = (id) => t.app.stores.recettes.data.recettes[id].recette.titre;
    assert.equal(midi.state, titre(a));
    assert.equal(soir.state, `${titre(b)} + ${titre(a)}`);
    assert.equal(midi.attributes.nombre, 1);
    assert.equal(soir.attributes.nombre, 2);
    assert.equal(midi.attributes.date, DAY);
    assert.deepEqual(soir.attributes.titres, [titre(b), titre(a)]);
    assert.equal(soir.attributes.recettes[0].id, b);
    assert.equal(soir.attributes.recettes[0].personnes, 2);
    assert.ok(soir.attributes.recettes[0].duree_minutes > 0);
    assert.equal(soir.attributes.recettes[0].fait, false);
    assert.equal(midi.attributes.friendly_name, 'Menu du midi');
    // chaque appel est authentifié par le jeton du Supervisor et utilise POST /states/<entité>
    assert.ok(t.calls.every((c) => c.method === 'POST' && c.auth === 'Bearer tok' && c.url.startsWith('http://ha/api/states/sensor.recetteur_menu_')));
    // le repas de demain n'apparaît nulle part : le midi d'aujourd'hui reste « a », pas « b »
    assert.ok(!JSON.stringify(t.calls).includes('2026-11-20'));
    assert.deepEqual(midi.attributes.titres, [titre(a)]);
  } finally { t.done(); }
});

test('capteurs : « Rien de prévu » sans repas, suivi « fait », recette supprimée', async () => {
  const t = await boot();
  try {
    t.calls.length = 0;
    await t.app.sensors.publish(DAY);
    let s = states(t.calls);
    assert.equal(s['sensor.recetteur_menu_midi'].state, EMPTY);
    assert.equal(s['sensor.recetteur_menu_midi'].attributes.nombre, 0);
    assert.deepEqual(s['sensor.recetteur_menu_midi'].attributes.recettes, []);

    const m = (await t.post('/api/menu', { date: DAY, slot: 'soir', recipeId: t.ids[0], servings: 4 })).body;
    await t.app.dispatch('PATCH', `/api/menu/${m.id}`, { fait: true });
    t.calls.length = 0;
    await t.app.sensors.publish(DAY);
    assert.equal(states(t.calls)['sensor.recetteur_menu_soir'].attributes.recettes[0].fait, true);
  } finally { t.done(); }
});

test('capteurs : l\'état est limité à 255 caractères', () => {
  const menu = { data: { repas: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, date: DAY, slot: 'soir', recipeId: `r${i}`, servings: 4, position: i })) } };
  const recettes = { data: { recettes: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`r${i}`, { recette: { titre: `Un titre de recette très long numéro ${i} `.repeat(3), temps_preparation: 5 } }])) } };
  const s = snapshot({ menu, recettes, date: DAY }).soir;
  assert.equal(s.state.length, 255);
  assert.ok(s.state.endsWith('…'));
  assert.equal(s.attributes.nombre, 5);
});

test('capteurs : inertes hors Home Assistant ou si l\'option est désactivée', async () => {
  for (const cfg of [{ token: null }, { options: { ha_publier_menu: false } }]) {
    const t = await boot(cfg);
    try {
      t.calls.length = 0;
      assert.equal(t.app.sensors.enabled, false);
      assert.equal(await t.app.sensors.publish(DAY), false);
      t.app.sensors.start();
      await t.post('/api/menu', { date: DAY, slot: 'soir', recipeId: t.ids[0], servings: 4 });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(t.calls.filter((c) => c.url.includes('/states/')).length, 0);
      t.app.sensors.stop();
    } finally { t.done(); }
  }
});

test('capteurs : republication groupée après modification, au changement de jour et périodiquement', async () => {
  const writes = [];
  const ha = { setState: async (entity, state) => { writes.push([entity, state]); } };
  const menu = { data: { repas: [] } };
  const recettes = { data: { recettes: { a: { recette: { titre: 'Soupe', temps_preparation: 10 } } } } };
  let day = DAY;
  const p = createMenuPublisher({ ha, menu, recettes, log: silent, enabled: true, debounceMs: 10, tickMs: 15, refreshMs: 60_000, getToday: () => day });
  p.schedule(); // pas démarré : sans effet
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(writes.length, 0);

  p.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(writes.length, 2); // démarrage : midi + soir
  writes.length = 0;

  menu.data.repas.push({ id: 1, date: DAY, slot: 'soir', recipeId: 'a', servings: 4, position: 0 });
  for (let i = 0; i < 5; i++) p.schedule(); // rafale : une seule publication
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(writes.map((w) => w[0]).sort(), [ENTITIES.midi, ENTITIES.soir]);
  assert.equal(writes.find((w) => w[0] === ENTITIES.soir)[1], 'Soupe');
  writes.length = 0;

  day = '2026-11-20'; // minuit passé : le menu d'hier disparaît, sans aucune modification
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(writes.find((w) => w[0] === ENTITIES.soir)[1], EMPTY);
  p.stop();
});

test('capteurs : un échec de Home Assistant est journalisé une fois, puis l\'app se rétablit', async () => {
  const logs = { info: [], error: [] };
  const log = { info: (m) => logs.info.push(m), error: (m) => logs.error.push(m) };
  let down = true;
  const ha = { setState: async () => { if (down) throw new Error('HTTP 503'); } };
  const p = createMenuPublisher({ ha, menu: { data: { repas: [] } }, recettes: { data: { recettes: {} } }, log, enabled: true, getToday: () => DAY });
  assert.equal(await p.publish(), false);
  assert.equal(await p.publish(), false);
  assert.equal(logs.error.length, 1);
  assert.match(logs.error[0], /HTTP 503/);
  down = false;
  assert.equal(await p.publish(), true);
  assert.ok(logs.info.some((m) => /de nouveau/.test(m)));
});

test('liens : fiche recette et mode pas à pas, construits d\'après l\'identifiant de l\'app donné par le Supervisor', async () => {
  const t = await boot();
  try {
    const m = (await t.post('/api/menu', { date: DAY, slot: 'soir', recipeId: t.ids[0], servings: 3 })).body;
    t.calls.length = 0;
    await t.app.sensors.publish(DAY);
    await t.app.sensors.publish(DAY); // l'identifiant est mémorisé : une seule demande au Supervisor
    assert.equal(t.infoCalls.length, 1);
    assert.equal(t.infoCalls[0].auth, 'Bearer tok');
    const soir = states(t.calls)['sensor.recetteur_menu_soir'];
    assert.equal(soir.attributes.lien_app, '/db891f0a_recetteur');
    const r = soir.attributes.recettes[0];
    assert.equal(r.lien, `/db891f0a_recetteur#/recette/${t.ids[0]}`);
    assert.equal(r.lien_cuisine, `/db891f0a_recetteur#/recette/${t.ids[0]}/cuisiner?p=3&repas=${m.id}`);
    // le capteur du midi (vide) porte quand même le lien de l'app
    assert.equal(states(t.calls)['sensor.recetteur_menu_midi'].attributes.lien_app, '/db891f0a_recetteur');
  } finally { t.done(); }
});

test('liens : option ha_lien_base prioritaire ; sans identifiant ni option, pas de lien mais les capteurs fonctionnent', async () => {
  let t = await boot({ options: { ha_lien_base: '/db891f0a_recetteur/' } });
  try {
    await t.post('/api/menu', { date: DAY, slot: 'soir', recipeId: t.ids[0], servings: 4 });
    t.calls.length = 0;
    await t.app.sensors.publish(DAY);
    assert.equal(t.infoCalls.length, 0); // pas besoin du Supervisor
    assert.equal(states(t.calls)['sensor.recetteur_menu_soir'].attributes.recettes[0].lien, `/db891f0a_recetteur#/recette/${t.ids[0]}`);
  } finally { t.done(); }

  t = await boot({ slug: null });
  try {
    await t.post('/api/menu', { date: DAY, slot: 'soir', recipeId: t.ids[0], servings: 4 });
    t.calls.length = 0;
    assert.equal(await t.app.sensors.publish(DAY), true);
    const soir = states(t.calls)['sensor.recetteur_menu_soir'];
    assert.ok(soir.state.length > 0);
    assert.ok(!('lien_app' in soir.attributes) && !('lien' in soir.attributes.recettes[0]));
  } finally { t.done(); }

  // une valeur douteuse (ni chemin ni http(s)) est ignorée plutôt que publiée
  t = await boot({ options: { ha_lien_base: 'javascript:alert(1)' } });
  try { assert.equal(t.app.config.ha_lien_base, ''); } finally { t.done(); }
});

test('liens : identifiants de recette échappés', () => {
  const menu = { data: { repas: [{ id: 1, date: DAY, slot: 'soir', recipeId: 'a b/c', servings: 4, position: 0 }] } };
  const recettes = { data: { recettes: { 'a b/c': { recette: { titre: 'X' } } } } };
  const r = snapshot({ menu, recettes, date: DAY, linkBase: '/x' }).soir.attributes.recettes[0];
  assert.equal(r.lien, '/x#/recette/a%20b%2Fc');
});
