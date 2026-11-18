import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { createMcp, createEngine, buildTools, checkArgs, PROTOCOLS } from '../server/mcp.js';
import { exemples } from './helpers.js';

const TOKEN = 'jeton-de-test-0123456789-abcdefghij';
const errors = [];
const infos = [];
const log = { info: (...a) => infos.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')) };

async function boot({ readOnly = false, supervisorToken = null, fetchImpl } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recetteur-mcp-'));
  const app = createApp({ dataDir: dir, log, supervisorToken, fetch: fetchImpl, options: { portions_defaut: 4 } });
  const mcp = createMcp({ app, token: TOKEN, readOnly, version: 'test', log });
  await new Promise((r) => mcp.server.listen(0, '127.0.0.1', r));
  const port = mcp.server.address().port;
  let id = 0;
  const post = (body, { headers = {}, raw = false } = {}) => new Promise((resolve, reject) => {
    const data = raw ? body : JSON.stringify(body);
    const req = http.request({ port, host: '127.0.0.1', path: '/mcp', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers, 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, headers: res.headers, json: t ? JSON.parse(t) : null }); });
    });
    req.on('error', reject); req.end(data);
  });
  const rpc = async (method, params) => (await post({ jsonrpc: '2.0', id: ++id, method, params })).json;
  const tool = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); return { ...r.result, text: r.result?.content?.[0]?.text ?? '', error: r.error }; };
  return { app, mcp, port, post, rpc, tool, dir, close: async () => { await new Promise((r) => mcp.server.close(r)); await new Promise((r) => app.server.close(r)); } };
}
const get = (port, p, headers = {}) => new Promise((resolve) => { http.get({ port, host: '127.0.0.1', path: p, headers, agent: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); });

test('authentification : jeton absent, faux, ou trop court', async () => {
  const t = await boot();
  const noAuth = await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Authorization: '' } });
  assert.equal(noAuth.status, 401);
  assert.match(noAuth.headers['www-authenticate'], /Bearer/);
  assert.equal((await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Authorization: 'Bearer pas-le-bon-jeton-du-tout-0123456' } })).status, 401);
  assert.equal((await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Authorization: `Basic ${TOKEN}` } })).status, 401);
  assert.equal((await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 200);
  assert.throws(() => createMcp({ app: t.app, token: 'trop-court' }), /trop court/);
  assert.throws(() => createMcp({ app: t.app, token: '' }), /trop court/);
  await t.close();
});

test('transport : Origin refusé, méthodes, chemin, type de contenu, JSON, version de protocole', async () => {
  const t = await boot();
  assert.equal((await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Origin: 'http://localhost:3000' } })).status, 403); // même « localhost » : un navigateur local est refusé aussi
  assert.equal(await get(t.port, '/mcp', { Authorization: `Bearer ${TOKEN}` }), 405);
  assert.equal(await get(t.port, '/api/recettes', { Authorization: `Bearer ${TOKEN}` }), 404); // aucune route de l'app n'est exposée ici
  assert.equal(await get(t.port, '/', {}), 404);
  assert.equal((await t.post('{}', { raw: true, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const bad = await t.post('{oups', { raw: true });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, -32700);
  assert.equal((await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { 'MCP-Protocol-Version': '1999-01-01' } })).status, 400);
  assert.equal((await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { 'MCP-Protocol-Version': '2025-06-18' } })).status, 200);
  // notification : pas de réponse (202) ; lot ; lot de notifications
  assert.equal((await t.post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const batch = await t.post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  assert.equal(batch.status, 200);
  assert.deepEqual(batch.json.map((x) => x.id).sort(), [1, 2]);
  assert.equal((await t.post([{ jsonrpc: '2.0', method: 'notifications/initialized' }])).status, 202);
  assert.equal((await t.post([])).status, 400);
  await t.close();
});

test('blocage après 10 jetons invalides (même avec le bon jeton ensuite)', async () => {
  errors.length = 0;
  const t = await boot();
  for (let i = 0; i < 10; i++) assert.equal((await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Authorization: `Bearer mauvais-jeton-numero-${i}-0123456789` } })).status, 401);
  const blocked = await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['retry-after'], '60');
  assert.ok(errors.some((e) => e.includes('10 jetons invalides')));
  assert.ok(!errors.join('\n').includes(TOKEN), 'le jeton n’est jamais journalisé');
  await t.close();
});

test('initialize : négociation de version, capacités, instructions', async () => {
  const t = await boot();
  let r = (await t.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).result;
  assert.equal(r.protocolVersion, '2025-03-26');
  assert.equal(r.serverInfo.name, 'recetteur');
  assert.ok(r.capabilities.tools && r.capabilities.resources);
  assert.match(r.instructions, /recetteur:\/\/format/);
  assert.match(r.instructions, /ajouter_recettes/);
  r = (await t.rpc('initialize', { protocolVersion: '1999-01-01' })).result;
  assert.equal(r.protocolVersion, PROTOCOLS[0]);
  assert.deepEqual((await t.rpc('ping')).result, {});
  assert.equal((await t.rpc('methode/inconnue')).error.code, -32601);
  assert.equal((await t.rpc('tools/call', {})).error.code, -32602);
  assert.equal((await t.rpc('tools/call', { name: 'nimporte_quoi' })).error.code, -32602);
  assert.equal((await t.post({ jsonrpc: '1.0', id: 1, method: 'ping' })).json.error.code, -32600);
  await t.close();
});

test('catalogue des outils : schémas valides, annotations, lecture seule', async () => {
  const t = await boot();
  const list = (await t.rpc('tools/list')).result.tools;
  assert.equal(list.length, 17);
  assert.equal(new Set(list.map((x) => x.name)).size, list.length);
  for (const x of list) {
    assert.match(x.name, /^[a-z_]+$/);
    assert.ok(x.description.length > 20, x.name);
    assert.equal(x.inputSchema.type, 'object', x.name);
    assert.equal(x.inputSchema.additionalProperties, false, x.name);
    for (const k of x.inputSchema.required) assert.ok(x.inputSchema.properties[k], `${x.name}.${k}`);
    assert.equal(typeof x.annotations.readOnlyHint, 'boolean');
  }
  const by = Object.fromEntries(list.map((x) => [x.name, x]));
  assert.equal(by.rechercher_recettes.annotations.readOnlyHint, true);
  assert.equal(by.supprimer_recette.annotations.destructiveHint, true);
  assert.equal(by.retirer_repas.annotations.destructiveHint, true);
  assert.equal(by.planifier_repas.annotations.destructiveHint, false);
  await t.close();

  const ro = await boot({ readOnly: true });
  const names = (await ro.rpc('tools/list')).result.tools.map((x) => x.name);
  assert.ok(names.includes('rechercher_recettes') && names.includes('liste_de_courses') && names.includes('voir_menu'));
  for (const w of ['ajouter_recettes', 'supprimer_recette', 'planifier_repas', 'modifier_recette', 'lancer_minuteur', 'remplir_menu']) assert.ok(!names.includes(w), `${w} caché en lecture seule`);
  assert.equal((await ro.rpc('tools/call', { name: 'ajouter_recettes', arguments: { recettes: [] } })).error.code, -32602);
  await ro.close();
});

test('ressource recetteur://format', async () => {
  const t = await boot();
  assert.equal((await t.rpc('resources/list')).result.resources[0].uri, 'recetteur://format');
  const doc = (await t.rpc('resources/read', { uri: 'recetteur://format' })).result.contents[0];
  assert.equal(doc.mimeType, 'text/markdown');
  assert.match(doc.text, /recetteur\/v1/);
  assert.match(doc.text, /minuteurs/);
  assert.equal((await t.rpc('resources/read', { uri: 'file:///etc/passwd' })).error.code, -32002);
  await t.close();
});

test('valider les arguments : types, bornes, dates, paramètres inconnus', () => {
  const s = { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 5 }, d: { type: 'string', format: 'date' }, e: { type: 'string', enum: ['a', 'b'] }, l: { type: 'array', items: { type: 'string' }, maxItems: 2 } }, required: ['n'], additionalProperties: false };
  assert.equal(checkArgs(s, { n: 3, d: '2026-02-28', e: 'a', l: ['x'] }), null);
  assert.match(checkArgs(s, {}), /obligatoire/);
  assert.match(checkArgs(s, { n: 0 }), /minimum/);
  assert.match(checkArgs(s, { n: 6 }), /maximum/);
  assert.match(checkArgs(s, { n: 1.5 }), /integer/);
  assert.match(checkArgs(s, { n: '3' }), /integer/);
  assert.match(checkArgs(s, { n: 1, d: '2026-02-30' }), /date/);
  assert.match(checkArgs(s, { n: 1, d: 'demain' }), /date/);
  assert.match(checkArgs(s, { n: 1, e: 'z' }), /valeur parmi/);
  assert.match(checkArgs(s, { n: 1, l: [1] }), /string/);
  assert.match(checkArgs(s, { n: 1, l: ['a', 'b', 'c'] }), /maximum|éléments/);
  assert.match(checkArgs(s, { n: 1, inconnu: 1 }), /inconnu/);
  assert.match(checkArgs(s, JSON.parse('{"n":1,"__proto__":{"x":1}}')), /__proto__.*inconnu/);
  assert.match(checkArgs(s, []), /object/);
});

test('parcours complet : créer, chercher, lire (quantités ajustées), planifier, courses, suivi, suppression', async () => {
  const t = await boot();
  // --- aperçu puis création ; une recette invalide est signalée sans bloquer les autres
  let r = await t.tool('ajouter_recettes', { recettes: exemples, apercu: true });
  assert.equal(r.isError, undefined);
  assert.match(r.text, /Aperçu \(rien n'a été écrit\) : 5 nouvelle/);
  assert.equal((await t.app.dispatch('GET', '/api/recettes')).body.length, 0);
  r = await t.tool('ajouter_recettes', { recettes: [...exemples, { titre: 'Cassée', portions: 0 }] });
  assert.equal(r.isError, undefined);
  assert.match(r.text, /5 nouvelle\(s\).*1 invalide/);
  assert.match(r.text, /✗ Cassée — INVALIDE[\s\S]*erreur : portions/);
  assert.match(r.text, /✓ Spaghetti bolognaise — nouvelle \(id : spaghetti-bolognaise\)/);
  r = await t.tool('ajouter_recettes', { recettes: [{ titre: 'Cassée' }] });
  assert.equal(r.isError, true); // rien d'importé : c'est une erreur pour le modèle
  assert.match(r.text, /Corrigez/);
  r = await t.tool('ajouter_recettes', { recettes: exemples });
  assert.match(r.text, /5 ignorée/);

  // --- recherche
  r = await t.tool('rechercher_recettes', { q: 'lentille' });
  assert.match(r.text, /1 recette trouvée/);
  assert.match(r.text, /salade-de-lentilles-feta-et-noix · Salade de lentilles/);
  r = await t.tool('rechercher_recettes', { type: 'dessert' });
  assert.match(r.text, /tarte-aux-pommes/);
  assert.match((await t.tool('rechercher_recettes', { q: 'zzzz' })).text, /Aucune recette ne correspond/);
  assert.match((await t.tool('rechercher_recettes', { tags: ['four', 'végétarien'] })).text, /gratin-de-courgettes/);

  // --- lecture avec quantités ajustées
  r = await t.tool('lire_recette', { id: 'spaghetti-bolognaise', personnes: 6 });
  assert.match(r.text, /^# Spaghetti bolognaise/);
  assert.match(r.text, /pour 6 personnes \(recette écrite pour 4\)/);
  assert.match(r.text, /- 600 g de viande de bœuf hachée/);
  assert.match(r.text, /Ajoutez 600 g de viande hachée/); // {{boeuf}} résolu dans l'étape
  assert.match(r.text, /⏱ 45 min/);
  assert.match((await t.tool('lire_recette', { id: 'spaghetti-bolognaise' })).text, /pour 4 personnes/); // foyer = 4
  const json = JSON.parse((await t.tool('lire_recette', { id: 'tarte-aux-pommes', format: 'json' })).text);
  assert.equal(json.titre, 'Tarte aux pommes');
  const missing = await t.tool('lire_recette', { id: 'inconnue' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /introuvable/);
  assert.equal((await t.tool('lire_recette', { id: '__proto__' })).isError, true);
  assert.equal((await t.tool('lire_recette', { id: 'constructor' })).isError, true);

  // --- propositions
  r = await t.tool('proposer_recettes', { ingredients_disponibles: ['courgettes', 'crème', 'gruyère', 'oeufs'], nombre: 1 });
  assert.match(r.text, /gratin-de-courgettes/);
  assert.match(r.text, /ingrédients déjà là/);

  // --- menu
  r = await t.tool('planifier_repas', { date: '2026-11-18', creneau: 'soir', recette_id: 'gratin-de-courgettes', personnes: 6 });
  assert.match(r.text, /repas n°1/);
  await t.tool('planifier_repas', { date: '2026-11-18', creneau: 'midi', recette_id: 'tarte-aux-pommes' });
  r = await t.tool('voir_menu', { du: '2026-11-16' });
  assert.match(r.text, /Menu du 2026-11-16 au 2026-11-22/);
  assert.match(r.text, /Mercredi 18 nov\. : midi — Tarte aux pommes \(8 pers\.\)[^;]*\[repas n°2, recette tarte-aux-pommes\] ; soir — Gratin de courgettes \(6 pers\.\)/);
  assert.match(r.text, /Lundi 16 nov\. : midi — \(rien\) ; soir — \(rien\)/);
  assert.equal((await t.tool('planifier_repas', { date: '2026-11-19', creneau: 'brunch', recette_id: 'x' })).isError, true);
  assert.equal((await t.tool('planifier_repas', { date: '2026-11-19', creneau: 'soir', recette_id: 'inconnue' })).isError, true);
  assert.equal((await t.tool('planifier_repas', { date: '19/11/2026', creneau: 'soir', recette_id: 'x' })).isError, true);

  // --- remplissage : proposition sans écriture, puis application
  const before = (await t.app.dispatch('GET', '/api/menu')).body.length;
  r = await t.tool('remplir_menu', { du: '2026-11-19', au: '2026-11-21', creneaux: ['soir'], personnes: 2 });
  assert.match(r.text, /^Proposition \(rien n'est enregistré\) — 3 repas/);
  assert.equal((await t.app.dispatch('GET', '/api/menu')).body.length, before);
  r = await t.tool('remplir_menu', { du: '2026-11-19', au: '2026-11-21', creneaux: ['soir'], personnes: 2, appliquer: true });
  assert.match(r.text, /^Ajouté au menu — 3 repas/);
  assert.equal((await t.app.dispatch('GET', '/api/menu')).body.length, before + 3);
  assert.match((await t.tool('remplir_menu', { du: '2026-11-19', au: '2026-11-21', creneaux: ['soir'] })).text, /Aucun repas libre/);

  // --- courses : agrégées et rangées par rayon
  r = await t.tool('liste_de_courses', { date: '2026-11-18' });
  assert.match(r.text, /^Courses — semaine du 16 – 22 novembre/);
  assert.match(r.text, /\n- \[ \] .+ — .+/);
  assert.match(r.text, /FRUITS & LÉGUMES/);
  assert.match(r.text, /\(pour : .*Gratin de courgettes/);
  assert.match((await t.tool('liste_de_courses', { date: '2030-01-07' })).text, /rien à acheter/);

  // --- retirer un repas
  assert.match((await t.tool('retirer_repas', { repas_id: 1 })).text, /retiré/);
  assert.equal((await t.tool('retirer_repas', { repas_id: 9999 })).isError, true);

  // --- suivi et modification
  r = await t.tool('modifier_suivi_recette', { id: 'tarte-aux-pommes', favori: true, etoiles: 4, memo: 'Super avec de la cannelle' });
  assert.match(r.text, /favorite, 4\/5, mémo : Super avec de la cannelle/);
  assert.equal((await t.tool('modifier_suivi_recette', { id: 'tarte-aux-pommes', etoiles: 9 })).isError, true);
  r = await t.tool('marquer_cuisinee', { id: 'tarte-aux-pommes', date: '2026-11-17' });
  assert.match(r.text, /1 fois, dernière : 2026-11-17/);
  const doc = JSON.parse((await t.tool('lire_recette', { id: 'tarte-aux-pommes', format: 'json' })).text);
  doc.ingredients.find((i) => i.id === 'sucre').quantite = 80;
  r = await t.tool('modifier_recette', { id: 'tarte-aux-pommes', recette: doc });
  assert.match(r.text, /mise à jour/);
  assert.match((await t.tool('lire_recette', { id: 'tarte-aux-pommes', personnes: 8 })).text, /80 g de sucre/);
  assert.match((await t.tool('lire_recette', { id: 'tarte-aux-pommes' })).text, /favorite, 4\/5/); // le suivi est conservé
  assert.equal((await t.tool('modifier_recette', { id: 'tarte-aux-pommes', recette: { titre: 'x' } })).isError, true);

  // --- suppression : exige une confirmation explicite
  r = await t.tool('supprimer_recette', { id: 'gratin-de-courgettes', confirmer: false });
  assert.equal(r.isError, true);
  assert.match(r.text, /non confirmée/);
  assert.equal((await t.tool('supprimer_recette', { id: 'gratin-de-courgettes' })).isError, true); // paramètre requis
  assert.equal((await t.app.dispatch('GET', '/api/recettes/gratin-de-courgettes')).status, 200);
  assert.match((await t.tool('supprimer_recette', { id: 'gratin-de-courgettes', confirmer: true })).text, /supprimée/);
  assert.equal((await t.app.dispatch('GET', '/api/recettes/gratin-de-courgettes')).status, 404);
  await t.close();
});

test('minuteurs par MCP', async () => {
  const t = await boot();
  let r = await t.tool('lancer_minuteur', { minutes: 12, libelle: 'cuisson des pâtes', alerte_enceinte: false });
  assert.match(r.text, /Minuteur « cuisson des pâtes » lancé pour 12 min — n°/);
  const id = /n°(\w+)/.exec(r.text)[1];
  r = await t.tool('lister_minuteurs');
  assert.match(r.text, new RegExp(`n°${id} « cuisson des pâtes » : 1[12] min`));
  assert.match((await t.tool('lancer_minuteur', { minutes: 0.5 })).text, /30 s/);
  assert.equal((await t.tool('lancer_minuteur', { minutes: 0 })).isError, true);
  assert.equal((await t.tool('lancer_minuteur', { minutes: 5000 })).isError, true);
  assert.match((await t.tool('arreter_minuteur', { id })).text, /arrêté/);
  assert.equal((await t.tool('arreter_minuteur', { id })).isError, true);
  await t.close();
});

test('courses vers Home Assistant par MCP', async () => {
  let t = await boot();
  await t.tool('ajouter_recettes', { recettes: exemples });
  await t.tool('planifier_repas', { date: '2026-11-18', creneau: 'soir', recette_id: 'gratin-de-courgettes' });
  let r = await t.tool('envoyer_courses_vers_home_assistant', { date: '2026-11-18' });
  assert.equal(r.isError, true);
  assert.match(r.text, /uniquement lorsque l’app tourne dans Home Assistant/);
  await t.close();

  const calls = [];
  t = await boot({ supervisorToken: 'tok', fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200 }; } });
  await t.tool('ajouter_recettes', { recettes: exemples });
  await t.tool('planifier_repas', { date: '2026-11-18', creneau: 'soir', recette_id: 'gratin-de-courgettes', personnes: 6 });
  r = await t.tool('envoyer_courses_vers_home_assistant', { date: '2026-11-18' });
  assert.match(r.text, /\d+ articles envoyés à todo\.shopping_list/);
  assert.ok(calls.every((c) => c.entity_id === 'todo.shopping_list' && c.item));
  assert.ok(calls.some((c) => /courgettes/i.test(c.item)));
  await t.close();
});

test('les outils passent par les validations de l’app (mêmes limites que l’interface)', async () => {
  const t = await boot();
  const many = { titre: 'Trop', portions: 2, ingredients: Array.from({ length: 301 }, (_, i) => ({ nom: `i${i}` })), etapes: ['x'] };
  const r = await t.tool('ajouter_recettes', { recettes: [many] });
  assert.equal(r.isError, true);
  assert.match(r.text, /300 ingrédients au maximum/);
  assert.equal((await t.tool('ajouter_recettes', { recettes: Array.from({ length: 101 }, () => ({})) })).isError, true); // maxItems
  // une recette avec « __proto__ » dans ses champs n'empoisonne rien
  const sneaky = JSON.parse('{"titre":"Piège","portions":2,"__proto__":{"favori":true},"ingredients":[{"nom":"sel","__proto__":{"x":1}}],"etapes":["x"]}');
  await t.tool('ajouter_recettes', { recettes: [sneaky] });
  assert.equal(({}).favori, undefined);
  assert.equal(Object.prototype.x, undefined);
  await t.close();
});

test('une erreur interne dans un outil ne fuit rien et ne coupe pas le service', async () => {
  errors.length = 0;
  const t = await boot();
  const original = t.app.stores.recettes.data.recettes;
  Object.defineProperty(t.app.stores.recettes.data, 'recettes', { get() { throw new Error('ENOSPC /data/secret'); }, configurable: true });
  const r = await t.tool('rechercher_recettes', { q: 'x' });
  assert.equal(r.isError, true);
  assert.equal(r.text, 'Erreur interne du serveur.');
  assert.doesNotMatch(JSON.stringify(r), /ENOSPC|secret/);
  assert.ok(errors.some((e) => e.includes('ENOSPC')));
  Object.defineProperty(t.app.stores.recettes.data, 'recettes', { value: original, writable: true, configurable: true });
  assert.equal((await t.rpc('ping')).result !== undefined, true);
  await t.close();
});


test('journal : une ligne par requête, qui aide à diagnostiquer un client, sans jeton ni contenu', async () => {
  const t = await boot();
  try {
  infos.length = 0;
  await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Authorization: '', 'User-Agent': 'Claude-Test/1.0 "x"' } });
  await t.post({ jsonrpc: '2.0', id: 2, method: 'ping' }, { headers: { Authorization: 'Bearer faux-jeton-tout-a-fait-faux-123' } });
  await t.post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lister_minuteurs', arguments: { secret: 'CONTENU-SECRET' } } });
  const lines = infos.filter((l) => l.startsWith('MCP '));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /POST \/mcp → 401 \[sans en-tête Authorization\] agent="Claude-Test\/1\.0 x"/);
  assert.match(lines[1], /→ 401 \[jeton invalide\]/);
  assert.match(lines[2], /→ 200 tools\/call lister_minuteurs/);
  const all = infos.join('\n');
  for (const secret of [TOKEN, 'faux-jeton-tout-a-fait-faux-123', 'CONTENU-SECRET']) assert.ok(!all.includes(secret), 'le journal ne doit contenir ni jeton ni arguments');
  } finally { await t.close(); }
});

test('parcours « recettes données par liens » : import, doublon reconnu avec son id, puis planification', async () => {
  const t = await boot();
  try {
    const jow = { ...exemples[0], titre: 'Gratin de courgettes', source: 'https://jow.fr/recipes/gratin-courgettes-42' };
    let r = await t.tool('ajouter_recettes', { recettes: [jow] });
    assert.match(r.text, /nouvelle \(id : gratin-de-courgettes\)/);
    // la semaine suivante, la même page revient sous un autre titre : pas de doublon, et l'id existant est donné
    r = await t.tool('ajouter_recettes', { recettes: [{ ...jow, titre: 'Gratin de courgettes (Jow)', source: 'https://www.jow.fr/recipes/gratin-courgettes-42?x=1' }, { ...exemples[1], titre: 'Nouveau plat', source: 'https://jow.fr/recipes/nouveau-7' }] });
    assert.match(r.text, /1 nouvelle\(s\), 0 remplacée\(s\), 1 ignorée\(s\)/);
    assert.match(r.text, /Gratin de courgettes \(Jow\) — déjà présente \(ignorée\) \(id : gratin-de-courgettes\)/);
    const planned = await t.tool('planifier_repas', { date: '2026-11-23', creneau: 'soir', recette_id: 'gratin-de-courgettes' });
    assert.match(planned.text, /Ajouté au menu/);
    // les instructions du serveur expliquent le parcours à Claude
    const init = await t.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.match(init.result.instructions, /LIENS/);
    assert.match(init.result.instructions, /source/);
  } finally { await t.close(); }
});
