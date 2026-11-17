import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShoppingList, groupByAisle, shoppingToText } from '../shared/shopping.js';
import { byTitle, entrees } from './helpers.js';

const map = new Map(entrees.map((e) => [e.id, e.recette]));
const item = (list, key) => list.find((i) => i.key === key);

test('additionne les ingrédients communs et convertit les unités', () => {
  const list = buildShoppingList(
    [
      { recipeId: byTitle('Spaghetti').id, servings: 4 },
      { recipeId: byTitle('Poulet').id, servings: 4 },
      { recipeId: byTitle('Salade').id, servings: 4 },
    ],
    map,
  );
  // ail : 2 gousses (bolognaise) + 4 gousses (poulet)
  assert.equal(item(list, 'ail').quantite, '6 gousses');
  // huile d'olive : 2 + 2 + 4 c. à soupe
  assert.equal(item(list, 'huile d olive').quantite, '8 c. à soupe');
  // oignon et oignon rouge restent distincts
  assert.ok(item(list, 'oignon'));
  assert.ok(item(list, 'oignon rouge'));
});

test('proportionnel aux portions, et lignes distinctes pour unités incompatibles', () => {
  const list = buildShoppingList([{ recipeId: byTitle('Spaghetti').id, servings: 8 }], map);
  assert.equal(item(list, 'spaghetti').quantite, '640 g');
  assert.equal(item(list, 'oignon').nom, 'oignons');
  assert.equal(item(list, 'oignon').quantite, '2');
  // les quantités « fixes » ne doublent pas
  assert.equal(item(list, 'origan seche').quantite, '1 c. à café');
});

test('kg ↔ g : somme et affichage lisible', () => {
  const list = buildShoppingList(
    [
      { recipeId: byTitle('Gratin').id, servings: 6 }, // 1,2 kg de courgettes
      { recipeId: byTitle('Gratin').id, servings: 3 }, // 600 g
    ],
    map,
  );
  assert.equal(item(list, 'courgette').quantite, '1,8 kg');
});

test('basiques repérés, rayons ordonnés, texte exportable', () => {
  const list = buildShoppingList([{ recipeId: byTitle('Poulet').id, servings: 4 }], map);
  assert.equal(item(list, 'sel').basique, true);
  assert.equal(item(list, 'sel').quantite, '');
  const groups = groupByAisle(list.filter((i) => !i.basique));
  assert.equal(groups[0].rayon, 'fruits-legumes');
  const txt = shoppingToText(groups, { titre: 'Courses' });
  assert.match(txt, /^Courses\n\nFRUITS & LÉGUMES\n- /);
  assert.match(txt, /- Pommes de terre — 800 g/);
});
