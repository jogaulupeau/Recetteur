import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepLink, adoptParentHash } from '../public/js/deeplink.js';

test('lien profond : seules les pages recette et cuisiner sont reprises', () => {
  assert.equal(deepLink('#/recette/poulet-roti'), '#/recette/poulet-roti');
  assert.equal(deepLink('#/recette/poulet-roti/cuisiner?p=4&repas=12'), '#/recette/poulet-roti/cuisiner?p=4&repas=12');
  for (const bad of ['', '#', '#/', '#/menu', '#/importer', '#/recette/', '#/recette/x/modifier', '#/recette/x/cuisiner?p=<script>', '#/recette/x y',
    '#//evil.example', 'javascript:alert(1)', '#/recette/' + 'a'.repeat(400), null, undefined, 42]) {
    assert.equal(deepLink(bad), null, String(bad).slice(0, 40));
  }
});

const fakeWindow = ({ ownHash = '', parentHash = '#/recette/x', framed = true, crossOrigin = false } = {}) => {
  const win = { location: { hash: ownHash } };
  win.parent = !framed ? win : crossOrigin ? { get location() { throw new Error('SecurityError'); } } : { location: { hash: parentHash } };
  return win;
};

test('adoptParentHash : reprend le fragment du parent seulement dans un iframe, sur l\'accueil, et de façon sûre', () => {
  let w = fakeWindow();
  assert.equal(adoptParentHash(w), true);
  assert.equal(w.location.hash, '#/recette/x');
  w = fakeWindow({ ownHash: '#/menu' }); // l'app a déjà une page : on n'y touche pas
  assert.equal(adoptParentHash(w), false);
  assert.equal(w.location.hash, '#/menu');
  w = fakeWindow({ ownHash: '#/' }); // « #/ » = accueil
  assert.equal(adoptParentHash(w), true);
  assert.equal(adoptParentHash(fakeWindow({ framed: false })), false); // pas dans un iframe
  assert.equal(adoptParentHash(fakeWindow({ crossOrigin: true })), false); // parent d'une autre origine : sans erreur
  w = fakeWindow({ parentHash: '#/lovelace/0' }); // fragment du parent sans rapport
  assert.equal(adoptParentHash(w), false);
  assert.equal(w.location.hash, '');
});
