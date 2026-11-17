import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchRecipes, tagCounts } from '../shared/search.js';
import { suggest, autofill } from '../shared/suggest.js';
import { weekStart, addDays, weekDays, daysBetween } from '../shared/dates.js';
import { entrees, byTitle } from './helpers.js';

test('recherche : accents, pluriels, ingrédients, ET entre les mots', () => {
  const t = (q, f = {}) => searchRecipes(entrees, { q, ...f }).map((e) => e.recette.titre);
  assert.deepEqual(t('tarte'), ['Tarte aux pommes']);
  assert.deepEqual(t('gouter'), ['Tarte aux pommes']); // tag « goûter »
  assert.deepEqual(t('lentille'), ['Salade de lentilles, feta et noix']);
  assert.ok(t('courgette').includes('Gratin de courgettes'));
  assert.deepEqual(t('pate boeuf'), ['Spaghetti bolognaise']);
  assert.deepEqual(t('zzz'), []);
  assert.equal(t('', { type: 'dessert' }).length, 1);
  assert.deepEqual(t('', { tags: ['four', 'végétarien'] }), ['Gratin de courgettes']);
  assert.ok(t('', { maxTemps: 45 }).includes('Salade de lentilles, feta et noix'));
  assert.ok(!t('', { maxTemps: 45 }).includes('Spaghetti bolognaise'));
});

test('tags comptés', () => {
  assert.equal(tagCounts(entrees).find(([t]) => t === 'four')[1], 3);
});

test('suggestions : types, filtres, exclusions, ingrédients disponibles', () => {
  const rng = () => 0.5;
  const base = { today: '2026-11-17', rng, n: 10 };
  const titres = (o) => suggest(entrees, { ...base, ...o }).map((s) => s.entry.recette.titre);
  assert.ok(!titres({}).includes('Tarte aux pommes'));
  assert.deepEqual(titres({ type: 'dessert' }), ['Tarte aux pommes']);
  assert.ok(!titres({ sansTags: ['végétarien'] }).includes('Gratin de courgettes'));
  assert.ok(!titres({ excludeIds: [byTitle('Poulet').id] }).includes('Poulet rôti aux pommes de terre'));
  const top = suggest(entrees, { ...base, have: ['courgettes', 'crème', 'gruyère', 'oeufs'], n: 1 })[0];
  assert.equal(top.entry.recette.titre, 'Gratin de courgettes');
});

test('suggestions : une recette cuisinée hier passe derrière', () => {
  const e = entrees.map((x) => ({ ...x }));
  e.find((x) => x.recette.titre.startsWith('Poulet')).derniere_cuisson = '2026-11-16';
  const r = suggest(e, { today: '2026-11-17', rng: () => 0.5, n: 10 });
  assert.equal(r.at(-1).entry.recette.titre, 'Poulet rôti aux pommes de terre');
});

test('remplissage de la semaine : pas de doublon tant qu’il y a du choix', () => {
  const creneaux = ['2026-11-16|soir', '2026-11-17|soir', '2026-11-18|soir'];
  const plan = autofill(entrees, { creneaux, today: '2026-11-16', portions: 4, rng: () => 0.3 });
  assert.equal(plan.length, 3);
  assert.equal(new Set(plan.map((p) => p.recipeId)).size, 3);
  assert.ok(plan.every((p) => p.servings === 4));
  const six = autofill(entrees, { creneaux: [...creneaux, '2026-11-19|soir', '2026-11-20|soir', '2026-11-21|soir'], today: '2026-11-16', rng: () => 0.3 });
  assert.equal(six.length, 6); // 4 plats seulement : on répète plutôt que de laisser vide
});

test('dates : semaine du lundi', () => {
  assert.equal(weekStart('2026-11-17'), '2026-11-16'); // mardi → lundi
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // dimanche
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(weekDays('2026-11-16')[6], '2026-11-22');
  assert.equal(daysBetween('2026-11-10', '2026-11-17'), 7);
});
