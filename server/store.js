// Stockage en fichiers JSON dans le dossier de données (/data dans l'add-on).
// Écriture atomique (fichier temporaire + rename) et copie .bak de la version précédente.
// Un fichier illisible est mis de côté (.corrompu) au lieu d'être écrasé en silence.
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(file, defaults, log = console) {
    this.file = file;
    this.log = log;
    this.data = this.#load(defaults);
  }

  #load(defaults) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) return structuredClone(defaults);
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...structuredClone(defaults), ...data };
    } catch (e) {
      const aside = `${this.file}.${Date.now()}.corrompu`;
      fs.renameSync(this.file, aside);
      this.log.error(`${path.basename(this.file)} illisible (${e.message}) : mis de côté dans ${path.basename(aside)}`);
      return structuredClone(defaults);
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }

  /** Applique `fn` aux données puis enregistre. */
  update(fn) {
    const out = fn(this.data);
    this.save();
    return out;
  }
}
