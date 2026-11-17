import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedFiles, TARGET } from '../scripts/package-addon.js';
import { expected as skillExpected, SKILL } from '../scripts/sync-skill.js';
import { buildZip, ZIP_PATH } from '../scripts/zip-skill.js';
import { validateBundle } from '../shared/recipe.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('addon/app est à jour : lancer « npm run package » après avoir modifié le code', () => {
  for (const [rel, src] of expectedFiles()) {
    const copy = path.join(TARGET, rel);
    assert.ok(fs.existsSync(copy), `${rel} manquant dans addon/app`);
    assert.ok(fs.readFileSync(copy).equals(fs.readFileSync(src)), `${rel} est périmé dans addon/app`);
  }
});

test('addon/app ne contient ni données ni sauvegardes', () => {
  const stack = [TARGET];
  while (stack.length) {
    for (const e of fs.readdirSync(stack.pop(), { withFileTypes: true })) {
      assert.doesNotMatch(e.name, /\.(bak|tmp|corrompu)$|^(recettes|menu|etat)\.json$|options\.json/);
      if (e.isDirectory()) stack.push(path.join(e.parentPath, e.name));
    }
  }
});

test('le skill embarque des copies à jour des modules : lancer « npm run sync-skill »', () => {
  for (const [rel, content] of skillExpected()) {
    const f = path.join(SKILL, rel);
    assert.ok(fs.existsSync(f), `${rel} manquant dans le skill`);
    assert.ok(fs.readFileSync(f).equals(content), `${rel} est périmé dans le skill`);
  }
});

test('l’archive du skill est à jour : lancer « npm run skill:zip »', () => {
  assert.ok(fs.readFileSync(ZIP_PATH).equals(buildZip()), 'skill/recettes-recetteur.zip périmé');
});

test('l’exemple du skill et les exemples de l’appli sont valides, sans avertissement', () => {
  for (const f of ['skill/recettes-recetteur/references/exemple.json', 'examples/recettes-exemple.json']) {
    const res = validateBundle(JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    for (const r of res) {
      assert.deepEqual(r.errors, [], f);
      assert.deepEqual(r.warnings, [], f);
    }
  }
});

test('skill : en-tête conforme aux limites de claude.ai (name ≤ 64, description ≤ 200, dossier = nom)', () => {
  const md = fs.readFileSync(path.join(ROOT, 'skill', 'recettes-recetteur', 'SKILL.md'), 'utf8');
  const name = md.match(/^name: (.+)$/m)[1];
  const description = md.match(/^description: (.+)$/m)[1];
  assert.equal(name, 'recettes-recetteur');
  assert.ok(name.length <= 64);
  assert.ok(description.length <= 200, `description : ${description.length} caractères (max 200)`);
  assert.match(md, /^---\nname: .+\ndescription: .+\n---\n/);
});

test('config de l’app Home Assistant cohérente', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'addon', 'config.yaml'), 'utf8');
  assert.match(cfg, /ingress: true/);
  assert.match(cfg, /ingress_port: 8099/);
  assert.match(cfg, /homeassistant_api: true/);
  assert.match(fs.readFileSync(path.join(ROOT, 'addon', 'run.sh'), 'utf8'), /PORT=8099/);
  assert.equal(fs.statSync(path.join(ROOT, 'addon', 'run.sh')).mode & 0o100, 0o100, 'run.sh exécutable');
});
