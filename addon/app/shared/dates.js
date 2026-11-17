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
const fmt = (o) => new Intl.DateTimeFormat('fr-FR', o);
export const dayName = (iso, style = 'long') => fmt({ weekday: style }).format(fromISO(iso));
export const dayMonth = (iso) => fmt({ day: 'numeric', month: 'long' }).format(fromISO(iso));
export const dayShort = (iso) => fmt({ day: 'numeric', month: 'short' }).format(fromISO(iso));
export function weekLabel(monday) {
  const sun = addDays(monday, 6);
  const a = fromISO(monday), b = fromISO(sun);
  const sameMonth = a.getMonth() === b.getMonth();
  return sameMonth
    ? `${a.getDate()} – ${dayMonth(sun)}`
    : `${dayShort(monday)} – ${dayShort(sun)}`;
}
