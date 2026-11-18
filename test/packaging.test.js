import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedFiles, TARGET, MCP_TARGET, expectedMcpFiles } from '../scripts/package-addon.js';
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
  assert.deepEqual([...manifest.dependencies].sort(), ['persistent_notification', 'webhook']);
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
  assert.match(fs.readFileSync(path.join(ROOT, 'addon', 'DOCS.md'), 'utf8'), /Recetteur MCP/);
});

test('app « Recetteur MCP » : la copie embarquée de l’intégration est à jour (npm run package)', () => {
  for (const [rel, src] of expectedMcpFiles()) {
    const copy = path.join(MCP_TARGET, rel);
    assert.ok(fs.existsSync(copy), `${rel} manquant dans addon-mcp`);
    assert.ok(fs.readFileSync(copy).equals(fs.readFileSync(src)), `${rel} est périmé dans addon-mcp`);
  }
  // pas de fichier en trop (hors sources) : ni cache Python ni reste
  const found = [];
  const stack = [MCP_TARGET];
  while (stack.length) {
    for (const e of fs.readdirSync(stack.pop(), { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(path.join(e.parentPath, e.name));
      else found.push(path.relative(MCP_TARGET, path.join(e.parentPath, e.name)));
    }
  }
  assert.deepEqual(found.sort(), [...expectedMcpFiles().keys()].sort());
  assert.ok(!fs.existsSync(path.join(ROOT, 'addon-mcp', 'app', '__pycache__')));
});

test('app « Recetteur MCP » : un seul privilège (écrire la config HA), aucun port ni API', () => {
  const dir = path.join(ROOT, 'addon-mcp');
  const cfg = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
  const code = cfg.replace(/#.*$/gm, ''); // les commentaires peuvent citer ce qui est absent
  assert.match(code, /slug: recetteur_mcp/);
  assert.match(code, /type: homeassistant_config\n\s+read_only: false/);
  for (const forbidden of ['host_network', 'privileged', 'full_access', 'homeassistant_api', 'hassio_api', 'hassio_role', 'auth_api', 'docker_api', 'ports:', 'ingress', 'devices', 'apparmor: false'])
    assert.ok(!code.includes(forbidden), `${forbidden} ne doit pas figurer dans la config de l'app`);
  assert.match(code, /recetteur_url: url/);
  for (const f of ['Dockerfile', 'build.yaml', 'run.sh', 'README.md', 'DOCS.md', 'CHANGELOG.md', 'icon.png', 'logo.png', 'app/start.py'])
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} manquant`);
  assert.equal(fs.statSync(path.join(dir, 'run.sh')).mode & 0o100, 0o100, 'run.sh exécutable');
  const docs = fs.readFileSync(path.join(dir, 'DOCS.md'), 'utf8');
  assert.match(docs, /custom_components\/recetteur_mcp/);
  assert.match(docs, /recetteur_mcp\.json/);
  assert.match(docs, /[Rr]edémarr\w+\s+Home\s+Assistant/);
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
