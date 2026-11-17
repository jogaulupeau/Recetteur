import { TYPES } from '../shared/vocab.js';
import { daysBetween, today } from '../shared/dates.js';

export const fmtTime = (min) => {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};

export function ago(iso) {
  if (!iso) return '';
  const d = daysBetween(iso, today());
  if (d <= 0) return 'aujourd’hui';
  if (d === 1) return 'hier';
  if (d < 14) return `il y a ${d} jours`;
  if (d < 60) return `il y a ${Math.round(d / 7)} sem.`;
  return `il y a ${Math.round(d / 30)} mois`;
}

export const typeLabel = (t) => TYPES[t] ?? t;
export const SLOT_LABELS = { midi: 'Midi', soir: 'Soir' };
