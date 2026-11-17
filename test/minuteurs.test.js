import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { exemples } from './helpers.js';

const silent = { info() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'recetteur-min-'));

async function boot({ dir = tmp(), options = {}, token = 'tok', fail = false } = {}) {
  const calls = [];
  const app = createApp({
    dataDir: dir, log: silent, supervisorToken: token, options,
    fetch: async (url, init) => { calls.push({ url: url.replace('http://supervisor/core/api/services/', ''), body: JSON.parse(init.body) }); return { ok: !fail, status: fail ? 404 : 200 }; },
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { app, api, calls, dir, close: () => new Promise((r) => app.server.close(r)) };
}
const VOIX = { alerte_media_player: 'media_player.cuisine', alerte_voix: 'tts.piper' };

test('config : l’alerte n’est annoncée que si tout est configuré', async () => {
  let t = await boot();
  assert.deepEqual((await t.api('GET', '/api/config')).body.alerte, { mode: null, lecteur: null });
  await t.close();
  t = await boot({ options: VOIX });
  assert.deepEqual((await t.api('GET', '/api/config')).body.alerte, { mode: 'voix', lecteur: 'media_player.cuisine' });
  await t.close();
  t = await boot({ options: { alerte_media_player: 'media_player.salon', alerte_son: 'media-source://media_source/local/ding.mp3' } });
  assert.equal((await t.api('GET', '/api/config')).body.alerte.mode, 'son');
  await t.close();
  t = await boot({ options: VOIX, token: null }); // hors Home Assistant
  assert.equal((await t.api('GET', '/api/config')).body.alerte.mode, null);
  await t.close();
});

test('un minuteur sonne à l’échéance et annonce la fin sur le lecteur (voix)', async () => {
  const t = await boot({ options: VOIX });
  await t.api('POST', '/api/import', exemples[0]);
  const r = await t.api('POST', '/api/minuteurs', { secondes: 1, libelle: 'Le mijotage', recipeId: 'spaghetti-bolognaise', etape: 3, alerte: true });
  assert.equal(r.status, 201);
  assert.equal(r.body.etat, 'en_cours');
  assert.equal(r.body.recette_titre, 'Spaghetti bolognaise');
  assert.equal(r.body.alerte, true);
  const { body } = await t.api('GET', '/api/minuteurs');
  assert.equal(body.minuteurs.length, 1);
  assert.ok(Math.abs(body.maintenant - Date.now()) < 2000);

  await sleep(1350);
  const after = (await t.api('GET', '/api/minuteurs')).body.minuteurs[0];
  assert.equal(after.etat, 'sonne');
  assert.equal(after.alerte_envoyee, 'voix');
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, 'tts/speak');
  assert.deepEqual(t.calls[0].body, { entity_id: 'tts.piper', media_player_entity_id: 'media_player.cuisine', message: 'Minuteur terminé : Le mijotage, Spaghetti bolognaise.' });

  assert.equal((await t.api('DELETE', `/api/minuteurs/${after.id}`)).status, 200);
  assert.equal((await t.api('GET', '/api/minuteurs')).body.minuteurs.length, 0);
  assert.equal((await t.api('DELETE', `/api/minuteurs/${after.id}`)).status, 404);
  await t.close();
});

test('mode son : play_media en annonce ; sans alerte demandée, rien n’est envoyé', async () => {
  const t = await boot({ options: { alerte_media_player: 'media_player.salon', alerte_son: 'http://x/ding.mp3' } });
  await t.api('POST', '/api/minuteurs', { secondes: 1, libelle: 'Pâtes' });
  await t.api('POST', '/api/minuteurs', { secondes: 1, libelle: 'Silencieux', alerte: false });
  await sleep(1350);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, 'media_player/play_media');
  assert.deepEqual(t.calls[0].body, { entity_id: 'media_player.salon', media_content_id: 'http://x/ding.mp3', media_content_type: 'music', announce: true });
  await t.close();
});

test('échec de Home Assistant : le minuteur sonne quand même, l’erreur est notée', async () => {
  const t = await boot({ options: VOIX, fail: true });
  await t.api('POST', '/api/minuteurs', { secondes: 1, libelle: 'Four' });
  await sleep(1350);
  const m = (await t.api('GET', '/api/minuteurs')).body.minuteurs[0];
  assert.equal(m.etat, 'sonne');
  assert.match(m.alerte_erreur, /tts\.piper → media_player\.cuisine/);
  await t.close();
});

test('pause, reprise, ajout de temps, remplacement d’un minuteur de même clé', async () => {
  const t = await boot();
  const m = (await t.api('POST', '/api/minuteurs', { secondes: 600, libelle: 'Rôti', cle: 'r:1:0' })).body;
  assert.equal(m.alerte, false); // pas de lecteur configuré
  const p = (await t.api('POST', `/api/minuteurs/${m.id}/pause`)).body;
  assert.equal(p.etat, 'pause');
  assert.ok(p.reste >= 599 && p.reste <= 600);
  assert.equal(p.fin, null);
  const plus = (await t.api('POST', `/api/minuteurs/${m.id}/ajouter`, { secondes: 60 })).body;
  assert.ok(plus.reste >= 659);
  const r = (await t.api('POST', `/api/minuteurs/${m.id}/reprendre`)).body;
  assert.equal(r.etat, 'en_cours');
  assert.ok(r.fin - Date.now() > 655000);
  // même clé : remplace
  const again = (await t.api('POST', '/api/minuteurs', { secondes: 30, libelle: 'Rôti', cle: 'r:1:0' })).body;
  const list = (await t.api('GET', '/api/minuteurs')).body.minuteurs;
  assert.deepEqual(list.map((x) => x.id), [again.id]);
  assert.equal((await t.api('POST', '/api/minuteurs/zzz/pause')).status, 404);
  await t.close();
});

test('validation des durées', async () => {
  const t = await boot();
  for (const secondes of [0, -5, 'abc', 90000]) assert.equal((await t.api('POST', '/api/minuteurs', { secondes })).status, 400);
  const ok = await t.api('POST', '/api/minuteurs', { secondes: 90 });
  assert.equal(ok.body.libelle, 'Minuteur');
  await t.close();
});

test('persistance : un minuteur en cours est réarmé au redémarrage, et sonne', async () => {
  const dir = tmp();
  let t = await boot({ dir, options: VOIX });
  await t.api('POST', '/api/minuteurs', { secondes: 2, libelle: 'Gratin' });
  await t.close();
  await sleep(100);
  t = await boot({ dir, options: VOIX });
  assert.equal((await t.api('GET', '/api/minuteurs')).body.minuteurs[0].etat, 'en_cours');
  await sleep(2100);
  assert.equal((await t.api('GET', '/api/minuteurs')).body.minuteurs[0].etat, 'sonne');
  assert.equal(t.calls.length, 1);
  await t.close();
});

test('redémarrage après l’échéance : rattrapage si récent, silence si ancien', async () => {
  const dir = tmp();
  const now = Date.now();
  const mk = (id, fin) => ({ id, cle: null, libelle: id, recipeId: null, etape: null, recette_titre: null, total: 60, fin, reste: null, etat: 'en_cours', alerte: true, cree_a: now - 3600e3 });
  fs.writeFileSync(path.join(dir, 'etat.json'), JSON.stringify({ version: 1, courses: {}, stock: [], minuteurs: [mk('recent', now - 30e3), mk('ancien', now - 20 * 60e3)] }));
  const t = await boot({ dir, options: VOIX });
  await sleep(100);
  const list = (await t.api('GET', '/api/minuteurs')).body.minuteurs;
  assert.deepEqual(list.map((x) => [x.id, x.etat]), [['recent', 'sonne'], ['ancien', 'sonne']]);
  assert.equal(t.calls.length, 1); // seul le minuteur récent est annoncé
  assert.match(t.calls[0].body.message, /recent/);
  await t.close();
});

test('test de l’alerte : succès, non configurée, hors Home Assistant, refus', async () => {
  let t = await boot({ options: VOIX });
  const ok = await t.api('POST', '/api/alerte/test');
  assert.equal(ok.body.mode, 'voix');
  assert.match(t.calls[0].body.message, /Test de l’alerte/);
  await t.close();
  t = await boot({ options: { alerte_media_player: 'media_player.x' } });
  assert.equal((await t.api('POST', '/api/alerte/test')).status, 400);
  await t.close();
  t = await boot({ options: VOIX, token: null });
  assert.equal((await t.api('POST', '/api/alerte/test')).status, 501);
  await t.close();
  t = await boot({ options: VOIX, fail: true });
  const bad = await t.api('POST', '/api/alerte/test');
  assert.equal(bad.status, 502);
  assert.match(bad.body.erreur, /media_player\.cuisine/);
  await t.close();
});
