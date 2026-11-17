// Fabrique skill/recettes-recetteur.zip, à téléverser dans Claude (Réglages → Capacités → Skills).
// Zip écrit à la main (aucune dépendance) et déterministe : mêmes fichiers → mêmes octets,
// ce qui permet à un test de vérifier que l'archive est à jour.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_DIR = path.join(ROOT, 'skill', 'recettes-recetteur');
export const ZIP_PATH = path.join(ROOT, 'skill', 'recettes-recetteur.zip');
const NAME = 'recettes-recetteur';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.') || e.name.endsWith('.zip')) return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  }).sort();
}

export function buildZip() {
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // 2026-01-01 : date fixe
  const locals = [], centrals = [];
  let offset = 0;
  for (const rel of walk(SKILL_DIR)) {
    const data = fs.readFileSync(path.join(SKILL_DIR, rel));
    const name = Buffer.from(`${NAME}/${rel}`);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(8, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, deflated);
    centrals.push(central, name);
    offset += local.length + name.length + deflated.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(ZIP_PATH, buildZip());
  console.log(`  ${path.relative(ROOT, ZIP_PATH)} (${fs.statSync(ZIP_PATH).size} octets) :`);
  walk(SKILL_DIR).forEach((f) => console.log(`    ${NAME}/${f}`));
}
