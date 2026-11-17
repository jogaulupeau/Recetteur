import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecipe, validateBundle, parseNumber } from '../shared/recipe.js';
import { exemples } from './helpers.js';

const base = () => ({
  titre: 'Test',
  portions: 2,
  ingredients: [{ id: 'a', nom: 'farine', quantite: 100, unite: 'g' }],
  etapes: [{ texte: 'Mélanger {{a}}.', ingredients: ['a'] }],
});

test('exemples valides, sans avertissement', () => {
  assert.equal(exemples.length, 5);
});

test('recette minimale valide, avec valeurs par défaut', () => {
  const { recipe, errors } = validateRecipe(base());
  assert.deepEqual(errors, []);
  assert.equal(recipe.type, 'plat');
  assert.equal(recipe.portions_unite, 'personnes');
  assert.equal(recipe.ingredients[0].rayon, 'epicerie');
});

test('erreurs bloquantes, avec chemin', () => {
  const { recipe, errors } = validateRecipe({ portions: 0, ingredients: [], etapes: [] });
  assert.equal(recipe, null);
  assert.ok(errors.some((e) => e.startsWith('titre')));
  assert.ok(errors.some((e) => e.startsWith('portions')));
  assert.ok(errors.some((e) => e.startsWith('ingredients')));
  assert.ok(errors.some((e) => e.startsWith('etapes')));
});

test('référence inconnue dans une étape = erreur', () => {
  const r = base();
  r.etapes[0].texte = 'Ajouter {{inconnu}}';
  r.etapes[0].ingredients = ['zzz'];
  const { errors } = validateRecipe(r);
  assert.equal(errors.length, 2);
});

test('corrections douces : unités, quantités textuelles, type, id en double', () => {
  const r = base();
  r.type = 'Plat principal';
  r.ingredients = [
    { id: 'a', nom: 'sucre', quantite: '1/2', unite: 'cuillère à soupe' },
    { id: 'a', nom: 'lait', quantite: '1,5', unite: 'litre' },
    { nom: 'machin', quantite: 'beaucoup' },
  ];
  r.etapes = [{ texte: 'Tout mélanger.' }];
  const { recipe, errors, warnings } = validateRecipe(r);
  assert.deepEqual(errors, []);
  assert.equal(recipe.type, 'plat');
  assert.equal(recipe.ingredients[0].quantite, 0.5);
  assert.equal(recipe.ingredients[0].unite, 'c. à soupe');
  assert.equal(recipe.ingredients[1].quantite, 1.5);
  assert.equal(recipe.ingredients[1].unite, 'l');
  assert.equal(recipe.ingredients[1].id, 'a-2');
  assert.equal(recipe.ingredients[2].quantite, null);
  assert.ok(warnings.length >= 2);
});

test('avertit des ingrédients jamais utilisés dans les étapes', () => {
  const r = base();
  r.ingredients.push({ id: 'b', nom: 'sucre', quantite: 10, unite: 'g' });
  const { warnings } = validateRecipe(r);
  assert.ok(warnings.some((w) => w.includes('sucre') && w.includes('aucune étape')));
});

test('formats d’import : objet, tableau, enveloppe', () => {
  assert.equal(validateBundle(base()).length, 1);
  assert.equal(validateBundle([base(), base()]).length, 2);
  assert.equal(validateBundle({ format: 'recetteur/v1', recettes: [base()] }).length, 1);
});

test('parseNumber', () => {
  assert.equal(parseNumber('1 1/2'), 1.5);
  assert.equal(parseNumber('2,5'), 2.5);
  assert.ok(Number.isNaN(parseNumber('abc')));
});
