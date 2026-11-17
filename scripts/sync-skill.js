// Copie dans le skill les modules dont le validateur a besoin, pour qu'il soit autonome une fois
// téléversé dans Claude. Un test vérifie que les copies sont à jour.
//   npm run sync-skill
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL = path.join(ROOT, 'skill', 'recettes-recetteur');
export const SHARED_FILES = ['vocab.js', 'text.js', 'quantity.js', 'aisles.js', 'recipe.js', 'import.js', 'validate-cli.js'];

export function expected() {
  const files = new Map();
  for (const f of SHARED_FILES) files.set(path.join('scripts', f), fs.readFileSync(path.join(ROOT, 'shared', f)));
  files.set(path.join('scripts', 'package.json'), Buffer.from('{ "type": "module" }\n'));
  const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'recettes-exemple.json'), 'utf8'));
  const sample = { format: all.format, recettes: all.recettes.slice(0, 2) };
  files.set(path.join('references', 'exemple.json'), Buffer.from(JSON.stringify(sample, null, 2) + '\n'));
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [rel, content] of expected()) {
    const dest = path.join(SKILL, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    console.log('  ', path.relative(ROOT, dest));
  }
}
