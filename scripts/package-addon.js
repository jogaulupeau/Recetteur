// Assemble addon/app/ : le code que le Dockerfile de l'app embarque. Rien d'autre —
// ni données, ni tests, ni sauvegardes. À relancer (npm run package) après toute modification du code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET = path.join(ROOT, 'addon', 'app');
export const TO_COPY = ['server', 'shared', 'public', 'examples'];
const FORBIDDEN = ['.tmp', '.bak', '.corrompu', 'node_modules', '.DS_Store', 'options.json'];
const forbidden = (name) => FORBIDDEN.some((m) => name.includes(m));

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (forbidden(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

/** Liste des fichiers attendus dans addon/app (chemin relatif → contenu source). */
export function expectedFiles() {
  const files = new Map();
  for (const name of TO_COPY) for (const rel of walk(path.join(ROOT, name))) files.set(path.join(name, rel), path.join(ROOT, name, rel));
  return files;
}

export function packageAddon() {
  fs.rmSync(TARGET, { recursive: true, force: true }); // on ne vide que le dossier d'assemblage
  const files = expectedFiles();
  for (const [rel, src] of files) {
    fs.mkdirSync(path.dirname(path.join(TARGET, rel)), { recursive: true });
    fs.copyFileSync(src, path.join(TARGET, rel));
  }
  return [...files.keys()];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = packageAddon();
  for (const d of TO_COPY) console.log(`  ${(d + '/').padEnd(12)} ${list.filter((f) => f.startsWith(d + path.sep)).length} fichiers`);
  console.log(`\n${list.length} fichiers assemblés dans addon/app/ — aucune donnée embarquée (elles vivent dans /data).`);
}
