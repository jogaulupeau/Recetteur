// Stockage en fichiers JSON dans le dossier de données (/data dans l'add-on).
// Écriture atomique (fichier temporaire + rename) et copie .bak de la version précédente.
// Un fichier illisible est mis de côté (.corrompu) au lieu d'être écrasé en silence.
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  /**
   * @param {object} [o]
   * @param {boolean} [o.pretty=true]    JSON indenté (lisible) ou compact (-50 % pour les gros fichiers)
   * @param {number} [o.bakEveryMs=0]    ne rafraîchit la copie .bak que si elle a plus de N ms (évite de recopier un gros
   *                                     fichier à chaque clic ; la copie reste un point de retour utile)
   */
  constructor(file, defaults, log = console, { pretty = true, bakEveryMs = 0 } = {}) {
    this.file = file;
    this.log = log;
    this.pretty = pretty;
    this.bakEveryMs = bakEveryMs;
    this.data = this.#load(defaults);
    this.listeners = [];
  }

  /** `fn()` est appelée après chaque enregistrement réussi (une erreur du récepteur ne bloque jamais l'écriture). */
  onChange(fn) {
    this.listeners.push(fn);
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
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, this.pretty ? 2 : 0));
    if (fs.existsSync(this.file)) {
      const bak = `${this.file}.bak`;
      let age = Infinity;
      try { age = Date.now() - fs.statSync(bak).mtimeMs; } catch { /* pas encore de copie */ }
      // `<= 0` : sans limitation on copie toujours (l'âge peut être légèrement négatif si l'horodatage tombe dans la même milliseconde)
      if (this.bakEveryMs <= 0 || age >= this.bakEveryMs) fs.copyFileSync(this.file, bak);
    }
    fs.renameSync(tmp, this.file);
    for (const fn of this.listeners) {
      try { fn(); } catch (e) { this.log.error(`${path.basename(this.file)} : récepteur de modifications en erreur (${e.message})`); }
    }
  }

  /** Applique `fn` aux données puis enregistre. */
  update(fn) {
    const out = fn(this.data);
    this.save();
    return out;
  }
}
