import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUnit, formatIngredient, formatNumber, kitchenRound } from '../shared/quantity.js';
import { pluralize, withDe, ingredientKey } from '../shared/text.js';

const fmt = (ing, base, n) => formatIngredient(ing, base, n);

test('unités : alias et inconnues', () => {
  assert.equal(canonicalUnit('cuillères à soupe'), 'c. à soupe');
  assert.equal(canonicalUnit('CàS'), 'c. à soupe');
  assert.equal(canonicalUnit('c.c.'), 'c. à café');
  assert.equal(canonicalUnit('Gousses'), 'gousse');
  assert.equal(canonicalUnit('pièces'), '');
  assert.equal(canonicalUnit(null), '');
  assert.equal(canonicalUnit('mètre'), null);
});

test('nombres affichés à la française', () => {
  assert.equal(formatNumber(1.5), '1½');
  assert.equal(formatNumber(0.25), '¼');
  assert.equal(formatNumber(2.75), '2¾');
  assert.equal(formatNumber(1.2), '1,2');
  assert.equal(formatNumber(400), '400');
});

test('arrondis de cuisine', () => {
  assert.equal(kitchenRound(133, 'g'), 135);
  assert.equal(kitchenRound(7.3, 'g'), 7.5);
  assert.equal(kitchenRound(2.6, 'c. à soupe'), 2.5);
  assert.equal(kitchenRound(12.4, 'gousse'), 12);
});

test('pluriels et élisions', () => {
  assert.equal(pluralize('pomme de terre'), 'pommes de terre');
  assert.equal(pluralize('oignon rouge'), 'oignons rouges');
  assert.equal(pluralize('poireau'), 'poireaux');
  assert.equal(pluralize('radis'), 'radis');
  assert.equal(pluralize('filet de poulet'), 'filets de poulet');
  assert.equal(withDe('huile d’olive'), 'd’huile d’olive');
  assert.equal(withDe('haricots verts'), 'de haricots verts');
  assert.equal(withDe('herbes de Provence'), 'd’herbes de Provence');
  assert.equal(withDe('œufs'), 'd’œufs');
  assert.equal(withDe('farine'), 'de farine');
  assert.equal(withDe('ail'), 'd’ail');
  assert.equal(withDe('eau'), 'd’eau');
});

test('clé d’ingrédient insensible au pluriel et aux accents', () => {
  assert.equal(ingredientKey('Tomates pelées'), ingredientKey('tomate pelee'));
  assert.equal(ingredientKey('œufs'), ingredientKey('oeuf'));
  assert.notEqual(ingredientKey('riz'), ingredientKey('ri'));
});

test('mise à l’échelle : masses, pièces, cuillères, plages', () => {
  assert.equal(fmt({ nom: 'tomates', quantite: 400, unite: 'g' }, 4, 6), '600 g de tomates');
  assert.equal(fmt({ nom: 'farine', quantite: 500, unite: 'g' }, 4, 10), '1¼ kg de farine');
  assert.equal(fmt({ nom: 'crème', quantite: 1, unite: 'kg' }, 4, 2), '500 g de crème');
  assert.equal(fmt({ nom: 'oignon', quantite: 1 }, 2, 6), '3 oignons');
  assert.equal(fmt({ nom: 'oignon', quantite: 1 }, 4, 4), '1 oignon');
  assert.equal(fmt({ nom: 'oignon', quantite: 1 }, 4, 6), '1½ oignon'); // pluriel à partir de 2
  assert.equal(fmt({ nom: 'ail', quantite: 1, unite: 'gousse' }, 2, 3), '1½ gousse d’ail');
  assert.equal(fmt({ nom: 'ail', quantite: 2, quantite_max: 3, unite: 'gousse' }, 4, 8), '4 à 6 gousses d’ail');
  assert.equal(fmt({ nom: 'huile d’olive', quantite: 1, unite: 'c. à soupe' }, 4, 6), '1½ c. à soupe d’huile d’olive');
  assert.equal(fmt({ nom: 'lait', quantite: 50, unite: 'cl' }, 4, 6), '75 cl de lait');
});

test('quantités fixes et « au goût »', () => {
  assert.equal(fmt({ nom: 'origan', quantite: 1, unite: 'c. à café', fixe: true }, 4, 12), '1 c. à café d’origan');
  assert.equal(fmt({ nom: 'sel', quantite: null }, 4, 12), 'sel');
  assert.equal(fmt({ nom: 'pomme de terre', quantite: 4, note: 'épluchées' }, 4, 8), '8 pommes de terre, épluchées');
});

import { stepPlainText } from '../shared/steps.js';
import { byTitle } from './helpers.js';

test('texte d’étape : quantités injectées et mises à l’échelle', () => {
  const r = byTitle('Spaghetti').recette;
  const s = r.etapes[1].texte; // « Ajoutez {{boeuf}} de viande hachée… »
  assert.match(stepPlainText(s, r, 4), /^Ajoutez 400 g de viande/);
  assert.match(stepPlainText(s, r, 6), /^Ajoutez 600 g de viande/);
  assert.equal(stepPlainText('Sans jeton.', r, 4), 'Sans jeton.');
});
