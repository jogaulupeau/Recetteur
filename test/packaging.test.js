import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedFiles, TARGET } from '../scripts/package-addon.js';
import { expected as skillExpected, SKILL } from '../scripts/sync-skill.js';
import { buildZip, ZIP_PATH } from '../scripts/zip-skill.js';
import { validateBundle } from '../shared/recipe.js';
import { buildTools } from '../server/mcp.js';

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

test('intégration Home Assistant recetteur_mcp : manifeste, HACS et traductions cohérents', () => {
  const dir = path.join(ROOT, 'custom_components', 'recetteur_mcp');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.domain, 'recetteur_mcp');
  assert.equal(manifest.config_flow, true);
  assert.deepEqual(manifest.dependencies, ['webhook']);
  assert.deepEqual(manifest.requirements, []); // aucune dépendance à installer
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const hacs = JSON.parse(fs.readFileSync(path.join(ROOT, 'hacs.json'), 'utf8'));
  assert.ok(hacs.name && hacs.homeassistant);
  // mêmes clés de traduction en français et en anglais
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  const fr = JSON.parse(fs.readFileSync(path.join(dir, 'translations', 'fr.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'translations', 'en.json'), 'utf8'));
  assert.deepEqual(keys(fr), keys(en));
  assert.match(fr.config.step.done.description, /\{url\}/);
  // l'intégration n'est pas embarquée dans l'image de l'app (elle s'installe dans Home Assistant, pas dans le conteneur)
  assert.equal(fs.existsSync(path.join(ROOT, 'addon', 'app', 'custom_components')), false);
  // et la documentation en parle
  assert.match(fs.readFileSync(path.join(ROOT, 'addon', 'DOCS.md'), 'utf8'), /custom_components\/recetteur_mcp/);
});

test('chaque outil MCP est documenté dans DOCS.md', () => {
  const docs = fs.readFileSync(path.join(ROOT, 'addon', 'DOCS.md'), 'utf8');
  const names = buildTools({ dispatch: async () => ({ status: 200, body: {} }), stores: { recettes: { data: { recettes: {} } } }, cfg: {} }).map((t) => t.name);
  assert.equal(names.length, 17);
  for (const n of names) assert.ok(docs.includes(`\`${n}\``), `${n} absent de DOCS.md`);
  assert.match(docs, /17 outils/);
});

test('config de l’app Home Assistant cohérente', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'addon', 'config.yaml'), 'utf8');
  assert.match(cfg, /ingress: true/);
  assert.match(cfg, /ingress_port: 8099/);
  assert.match(cfg, /homeassistant_api: true/);
  assert.match(cfg, /ingress_only: true/);
  assert.match(cfg, /mcp_token: ""/);
  assert.match(cfg, /mcp_token: password/);
  assert.match(cfg, /8100\/tcp: null/);
  assert.match(fs.readFileSync(path.join(ROOT, 'addon', 'run.sh'), 'utf8'), /RECETTEUR_MCP_PORT=8100/);
  assert.match(fs.readFileSync(path.join(ROOT, 'addon', 'run.sh'), 'utf8'), /RECETTEUR_ALLOWED_PEERS=172\.30\.32\.2/);
  assert.match(fs.readFileSync(path.join(ROOT, 'addon', 'run.sh'), 'utf8'), /PORT=8099/);
  assert.equal(fs.statSync(path.join(ROOT, 'addon', 'run.sh')).mode & 0o100, 0o100, 'run.sh exécutable');
});
