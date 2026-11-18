import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconFor, pickIngredients, dishForm, weightOf } from '../shared/visual.js';
import { byTitle } from './helpers.js';

test('un ingrédient réel donne son icône (et pas celle de son rayon)', () => {
  const cases = {
    'carottes': 'carotte', 'courgettes': 'courgette', 'tomates concassées en boîte': 'tomate', 'concentré de tomate': 'tomate',
    'pommes de terre': 'patate', 'pommes': 'pomme', 'pomme golden': 'pomme', 'patate douce': 'courge',
    'oignon rouge': 'oignon', 'ail': 'ail', 'aubergine': 'aubergine', 'poivron vert': 'poivron', 'champignons de Paris': 'champignon',
    'jeunes pousses d’épinards': 'feuilles', 'persil': 'herbes', 'thym': 'herbes', 'citron': 'citron',
    'œufs': 'oeuf', 'œuf': 'oeuf', 'feta': 'cubes', 'mozzarella': 'boule', 'gruyère râpé': 'fromage', 'parmesan': 'fromage',
    'beurre': 'beurre', 'crème fraîche épaisse': 'creme', 'lait de coco': 'coco',
    'cuisses de poulet': 'poulet', 'poulet fermier': 'poulet', 'steak haché': 'viande', 'viande de bœuf hachée': 'viande', 'épaule d’agneau': 'viande',
    'lardons': 'porc', 'jambon': 'porc', 'saucisses': 'saucisse', 'pavés de saumon': 'poisson', 'thon': 'poisson', 'crevettes': 'crevette',
    'spaghetti': 'pates', 'tagliatelles': 'pates', 'riz basmati': 'riz', 'couscous': 'graines', 'quinoa': 'graines',
    'lentilles vertes': 'legumineuse', 'pois chiches cuits': 'legumineuse', 'haricots rouges': 'legumineuse',
    'pain à burger': 'pain', 'noix': 'noix', 'chocolat noir': 'chocolat', 'pâte brisée': 'pate', 'pâte à pizza': 'pate',
    'fraises': 'baies', 'haricots verts': 'gousses', 'brocoli': 'brocoli', 'potiron': 'courge', 'maïs': 'mais', 'olives noires': 'olive',
  };
  for (const [nom, icon] of Object.entries(cases)) assert.equal(iconFor(nom), icon, `${nom} → ${icon}`);
});

test('régression : « bœuf » n’est pas un œuf, et les mots courts exigent une frontière de mot', () => {
  assert.notEqual(iconFor('bœuf haché'), 'oeuf');
  assert.notEqual(iconFor('boeuf'), 'oeuf');
  assert.equal(iconFor('table'), null); // « ble » dans « table » ≠ blé
  assert.equal(iconFor('sole'), 'poisson');
  assert.equal(iconFor('sel'), 'epice');
  assert.equal(iconFor('chou-fleur'), 'brocoli');
  assert.equal(iconFor('chou rouge'), 'feuilles');
  assert.equal(iconFor('lait de coco'), 'coco');
  // Sous-chaînes piégeuses : « semoule » contient « moule », « coquillettes » contient « coquille ».
  assert.equal(iconFor('semoule de couscous'), 'graines');
  assert.equal(iconFor('coquillettes'), 'pates');
  assert.equal(iconFor('moules marinières'), 'crevette');
  assert.equal(iconFor('coquilles Saint-Jacques'), 'crevette');
  assert.equal(iconFor('vermicelles'), 'pates');
  assert.equal(iconFor('pâtes à la crème'), 'pates');
  assert.equal(iconFor('pommeau'), null);
});

test('l’invisible n’est jamais dessiné', () => {
  for (const nom of ['eau', 'huile d’olive', 'vinaigre balsamique', 'bouillon de légumes', 'vin rouge', 'sauce soja', 'moutarde']) assert.equal(iconFor(nom), null, nom);
});

test('les ingrédients dominants de chaque recette d’exemple', () => {
  const top = (t, n = 6) => pickIngredients(byTitle(t).recette, n).map((x) => x.icon);
  const bolo = top('Spaghetti');
  for (const i of ['viande', 'pates', 'tomate']) assert.ok(bolo.includes(i), `bolognaise : ${i} dans ${bolo}`);
  assert.ok(!bolo.includes('oeuf'));
  const poulet = top('Poulet');
  for (const i of ['poulet', 'patate', 'citron']) assert.ok(poulet.includes(i), `poulet : ${i} dans ${poulet}`);
  assert.equal(top('Gratin')[0], 'courgette');
  const salade = top('Salade');
  for (const i of ['legumineuse', 'cubes', 'tomate']) assert.ok(salade.includes(i), `salade : ${i} dans ${salade}`);
  assert.equal(top('Tarte')[0], 'pomme');
});

test('ni sel, ni huile, ni sucre ne prennent la place d’un vrai ingrédient', () => {
  for (const t of ['Poulet', 'Spaghetti', 'Gratin', 'Salade']) {
    const picks = pickIngredients(byTitle(t).recette, 3).map((x) => x.icon);
    assert.ok(!picks.includes('epice'), `${t} : ${picks}`);
  }
});

test('poids : pièces, cuillères, liquides', () => {
  assert.ok(weightOf({ quantite: 2 }, 'oeuf') > 0);
  assert.equal(weightOf({ quantite: 400, unite: 'g' }, 'tomate'), 400);
  assert.equal(weightOf({ quantite: 1, unite: 'kg' }, 'courgette'), 1000);
  assert.ok(weightOf({ quantite: 1, unite: 'l' }, 'creme') < 1000);
  assert.equal(weightOf({ quantite: null }, 'epice'), 3);
});

test('mise en scène : tarte, bol ou assiette', () => {
  assert.equal(dishForm({ titre: 'Tarte aux pommes' }), 'pie');
  assert.equal(dishForm({ titre: 'Quiche lorraine' }), 'pie');
  assert.equal(dishForm({ titre: 'Pizza margherita' }), 'pie');
  assert.equal(dishForm({ titre: 'Soupe de potiron' }), 'bowl');
  assert.equal(dishForm({ titre: 'Velouté de champignons' }), 'bowl');
  assert.equal(dishForm({ titre: 'Smoothie banane–fraise' }), 'bowl');
  assert.equal(dishForm({ titre: 'Crêpes au sucre' }), 'stack');
  assert.equal(dishForm({ titre: 'Gratin de courgettes' }), 'plate');
  assert.equal(dishForm({ titre: 'Tartare de saumon' }), 'plate'); // « tartare » n'est pas une tarte
});
