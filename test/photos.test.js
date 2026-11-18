import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, sniffImage } from '../server/app.js';
import { exemples } from './helpers.js';

const silent = { info() {}, error() {} };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF-fausse-photo-pour-test'), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fausse-png-pour-test')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 fausse-webp')]);

async function boot(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recetteur-photo-'))) {
  const app = createApp({ dataDir: dir, log: silent });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const json = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const put = (url, buf, type = 'application/octet-stream') => fetch(base + url, { method: 'PUT', headers: { 'Content-Type': type }, body: buf });
  await json('POST', '/api/import', exemples[0]);
  return { app, base, json, put, dir, close: () => new Promise((r) => app.server.close(r)) };
}
const URL_ = '/api/recettes/spaghetti-bolognaise/photo';

test('reconnaissance du format d’après les octets', () => {
  assert.equal(sniffImage(JPEG).ext, 'jpg');
  assert.equal(sniffImage(PNG).ext, 'png');
  assert.equal(sniffImage(WEBP).ext, 'webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(Buffer.from('GIF89a--------------')), null);
  assert.equal(sniffImage(Buffer.alloc(3)), null);
});

test('envoi, lecture (cache), vignette, remplacement, suppression', async () => {
  const t = await boot();
  assert.equal((await t.json('GET', '/api/recettes/spaghetti-bolognaise')).body.photo, null);
  assert.equal((await fetch(t.base + URL_)).status, 404);

  // la vignette d'abord, puis la version complète : la photo n'existe qu'une fois la complète reçue
  let r = await t.put(URL_ + '?t=vignette', PNG, 'image/png');
  assert.equal(r.status, 200);
  assert.equal(((await r.json()).photo.full), undefined);
  r = await t.put(URL_, JPEG, 'image/jpeg');
  const e = await r.json();
  assert.equal(e.photo.full, 'jpg');
  assert.equal(e.photo.thumb, 'png');
  assert.ok(e.photo.v > 0);

  const full = await fetch(t.base + URL_ + `?v=${e.photo.v}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/jpeg');
  assert.match(full.headers.get('cache-control'), /immutable/);
  assert.ok(Buffer.from(await full.arrayBuffer()).equals(JPEG));
  const thumb = await fetch(t.base + URL_ + `?v=${e.photo.v}&t=vignette`);
  assert.equal(thumb.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await thumb.arrayBuffer()).equals(PNG));
  assert.match((await fetch(t.base + URL_)).headers.get('cache-control'), /no-cache/);

  // ETag → 304
  const etag = full.headers.get('etag');
  assert.equal((await fetch(t.base + URL_, { headers: { 'If-None-Match': etag } })).status, 304);

  // remplacement par un WebP : l'ancien fichier disparaît
  r = await t.put(URL_, WEBP, 'image/webp');
  const e2 = await r.json();
  assert.equal(e2.photo.full, 'webp');
  assert.ok(e2.photo.v >= e.photo.v);
  assert.deepEqual(fs.readdirSync(path.join(t.dir, 'photos')).sort(), ['spaghetti-bolognaise.full.webp', 'spaghetti-bolognaise.thumb.png']);

  // la liste des recettes expose la photo, sans les octets
  const list = (await t.json('GET', '/api/recettes')).body;
  assert.equal(list[0].photo.full, 'webp');

  assert.equal((await t.json('DELETE', URL_)).body.photo, null);
  assert.deepEqual(fs.readdirSync(path.join(t.dir, 'photos')), []);
  assert.equal((await fetch(t.base + URL_)).status, 404);
  await t.close();
});

test('refus : faux format (SVG/HTML déguisés), vide, trop gros, recette inconnue', async () => {
  const t = await boot();
  const svg = await t.put(URL_, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/jpeg');
  assert.equal(svg.status, 415); // l'en-tête dit « jpeg », les octets disent le contraire
  assert.equal((await t.put(URL_, Buffer.alloc(0), 'image/jpeg')).status, 400);
  assert.equal((await t.put(URL_, Buffer.concat([JPEG, Buffer.alloc(6.5 * 1024 * 1024)]), 'image/jpeg').catch(() => ({ status: 413 }))).status, 413);
  assert.equal((await t.put('/api/recettes/inconnue/photo', JPEG)).status, 404);
  assert.equal((await t.json('GET', '/api/recettes/spaghetti-bolognaise')).body.photo, null);
  assert.equal(fs.existsSync(path.join(t.dir, 'photos')) ? fs.readdirSync(path.join(t.dir, 'photos')).length : 0, 0);
  await t.close();
});

test('supprimer la recette supprime ses photos ; remplacer par import les conserve ; persistance au redémarrage', async () => {
  const t = await boot();
  await t.put(URL_ + '?t=vignette', JPEG);
  await t.put(URL_, JPEG);
  await t.json('POST', '/api/import?mode=remplacer', [{ ...exemples[0], portions: 6 }]);
  assert.equal((await t.json('GET', '/api/recettes/spaghetti-bolognaise')).body.photo.full, 'jpg');
  const dir = t.dir;
  await t.close();

  const again = createApp({ dataDir: dir, log: silent });
  assert.equal(again.stores.recettes.data.recettes['spaghetti-bolognaise'].photo.full, 'jpg');
  await new Promise((r) => again.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${again.server.address().port}`;
  assert.equal((await fetch(base + URL_)).status, 200);
  await fetch(base + '/api/recettes/spaghetti-bolognaise', { method: 'DELETE' });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'photos')), []);
  await new Promise((r) => again.server.close(r));
});
