// Dates calendaires « locales » manipulées comme des chaînes AAAA-MM-JJ.
export const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export const today = () => toISO(new Date());
export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
/** Lundi de la semaine contenant `iso`. */
export function weekStart(iso) {
  const d = fromISO(iso);
  const dow = (d.getDay() + 6) % 7; // lundi = 0
  return addDays(iso, -dow);
}
export const weekDays = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}
// Noms écrits en dur : `Intl` dépend des données de langue installées dans l'image (Alpine sans `icu-data-full` répond en anglais).
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const dayName = (iso, style = 'long') => { const d = fromISO(iso).getDay(); return style === 'short' ? JOURS_COURTS[d] : JOURS[d]; };
export const dayMonth = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MOIS[d.getMonth()]}`; };
export const dayShort = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MOIS_COURTS[d.getMonth()]}`; };
export function weekLabel(monday) {
  const sun = addDays(monday, 6);
  const a = fromISO(monday), b = fromISO(sun);
  const sameMonth = a.getMonth() === b.getMonth();
  return sameMonth
    ? `${a.getDate()} – ${dayMonth(sun)}`
    : `${dayShort(monday)} – ${dayShort(sun)}`;
}
