#!/usr/bin/env node
// Vérifie un fichier de recettes au format recetteur/v1.
//   node validate-cli.js recettes.json            rapport lisible (code de sortie 1 s'il y a des erreurs)
//   node validate-cli.js recettes.json --normaliser   écrit sur stdout le JSON normalisé, prêt à importer
//   cat recettes.json | node validate-cli.js -    lecture sur l'entrée standard
import fs from 'node:fs';
import { validateBundle } from './recipe.js';
import { extractJson } from './import.js';
import { FORMAT } from './vocab.js';

const args = process.argv.slice(2);
const normaliser = args.includes('--normaliser');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage : node validate-cli.js <fichier.json | -> [--normaliser]');
  process.exit(2);
}

let data;
try {
  data = extractJson(fs.readFileSync(file === '-' ? 0 : file, 'utf8'));
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}

const results = validateBundle(data);
let bad = 0;
const log = normaliser ? console.error : console.log;
for (const r of results) {
  const name = r.recipe?.titre ?? `recette n°${r.index + 1}`;
  if (r.errors.length) {
    bad++;
    log(`✗ ${name}`);
    r.errors.forEach((e) => log(`    erreur : ${e}`));
  } else log(`✓ ${name}${r.warnings.length ? '' : ' — OK'}`);
  r.warnings.forEach((w) => log(`    avertissement : ${w}`));
}
log(`\n${results.length - bad}/${results.length} recette(s) valide(s).`);
if (normaliser && !bad) console.log(JSON.stringify({ format: FORMAT, recettes: results.map((r) => r.recipe) }, null, 2));
process.exit(bad ? 1 : 0);
