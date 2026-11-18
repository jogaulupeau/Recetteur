import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayName, dayMonth, dayShort, weekLabel } from '../shared/dates.js';

test('dates en français, indépendantes des données de langue du système', () => {
  assert.equal(dayName('2026-11-16'), 'lundi');
  assert.equal(dayName('2026-11-22'), 'dimanche');
  assert.equal(dayName('2026-11-18', 'short'), 'mer.');
  assert.equal(dayMonth('2026-01-01'), '1 janvier');
  assert.equal(dayMonth('2026-12-31'), '31 décembre');
  assert.equal(dayShort('2026-07-01'), '1 juil.');
  assert.equal(weekLabel('2026-11-16'), '16 – 22 novembre');
  assert.equal(weekLabel('2026-11-30'), '30 nov. – 6 déc.');
});

test('mêmes résultats que Intl lorsque la langue française est disponible', () => {
  const ref = (o, iso) => new Intl.DateTimeFormat('fr-FR', o).format(new Date(`${iso}T12:00:00`));
  if (ref({ weekday: 'long' }, '2026-11-16') !== 'lundi') return; // Node sans données de langue : seul le test ci-dessus compte
  for (let i = 0; i < 366; i++) {
    const d = new Date(2026, 0, 1 + i, 12);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(dayName(iso), ref({ weekday: 'long' }, iso), iso);
    assert.equal(dayName(iso, 'short'), ref({ weekday: 'short' }, iso), iso);
    assert.equal(dayMonth(iso), ref({ day: 'numeric', month: 'long' }, iso), iso);
    assert.equal(dayShort(iso), ref({ day: 'numeric', month: 'short' }, iso), iso);
  }
});
