// Minuteurs : l'état vit sur le serveur (ils survivent au rechargement, se partagent entre appareils et
// peuvent faire sonner un lecteur multimédia Home Assistant). Ici : affichage, sonnerie locale, commandes.
import { api } from './api.js';
import { h, icon, toast, fill } from './dom.js';
import { state } from './state.js';
import { stepTimers } from '../shared/steps.js';
import { fmtTime } from './format.js';

const S = { list: [], offset: 0, beeped: new Set(), subs: new Set() };
let tray, audio;

const now = () => Date.now() + S.offset; // horloge du serveur : insensible à l'heure du téléphone
const mmss = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
export const remaining = (t) => (t.etat === 'en_cours' ? Math.max(0, Math.ceil((t.fin - now()) / 1000)) : t.etat === 'pause' ? t.reste : 0);
const isRinging = (t) => t.etat === 'sonne' || (t.etat === 'en_cours' && t.fin <= now());

// ---------------------------------------------------------------- son local
export function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
  } catch { /* sans son : le visuel et l'alerte Home Assistant restent */ }
}
function beep() {
  unlockAudio();
  try {
    for (let i = 0; i < 3; i++) {
      const t0 = audio.currentTime + i * 0.35;
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(audio.destination);
      o.start(t0);
      o.stop(t0 + 0.3);
    }
  } catch { /* ignoré */ }
  navigator.vibrate?.([300, 150, 300, 150, 300]);
}

// ---------------------------------------------------------------- état
const notify = () => S.subs.forEach((fn) => fn());
export function onTimersChange(fn) {
  S.subs.add(fn);
  return () => S.subs.delete(fn);
}
export const timerFor = (cle) => S.list.find((t) => t.cle === cle);

async function refresh() {
  try {
    const r = await api.get('minuteurs');
    S.offset = r.maintenant - Date.now();
    S.list = r.minuteurs;
    draw();
    notify();
  } catch { /* serveur momentanément injoignable : on réessaie au prochain tour */ }
}

function upsert(t) {
  S.list = [...S.list.filter((x) => x.id !== t.id && !(t.cle && x.cle === t.cle)), t];
  draw();
  notify();
}

export async function startTimer(def) {
  unlockAudio();
  upsert(await api.post('minuteurs', def));
}
const command = async (t, action, body) => upsert(await api.post(`minuteurs/${t.id}/${action}`, body));
async function stop(t) {
  S.list = S.list.filter((x) => x.id !== t.id);
  draw();
  notify();
  await api.del(`minuteurs/${t.id}`).catch(() => {});
}

// ---------------------------------------------------------------- préférence « annoncer sur l'enceinte »
const KEY = 'recetteur.alerte';
export const alertAvailable = () => !!state.config.alerte?.mode;
export function alertEnabled() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
function setAlertEnabled(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* stockage indisponible */ }
}

/** Case « Annoncer sur <lecteur> » + test, si une alerte Home Assistant est configurée. */
export function alertControl() {
  if (!alertAvailable()) return null;
  const { mode, lecteur } = state.config.alerte;
  const btn = h('button', { type: 'button', class: `chip ${alertEnabled() ? 'on' : ''}`, 'aria-pressed': String(alertEnabled()),
    title: mode === 'voix' ? 'Une annonce vocale sera diffusée à la fin du minuteur' : 'Un son sera joué à la fin du minuteur',
    onclick: () => { setAlertEnabled(!alertEnabled()); btn.classList.toggle('on', alertEnabled()); btn.setAttribute('aria-pressed', String(alertEnabled())); } },
  icon('timer', 14), `Alerte sur ${lecteur.replace(/^media_player\./, '')}`);
  const test = h('button', { type: 'button', class: 'btn sm ghost', onclick: async () => {
    test.disabled = true;
    try { await api.post('alerte/test'); toast('Alerte envoyée au lecteur.', { type: 'ok' }); } catch (e) { toast(e.message, { type: 'error', ms: 7000 }); }
    test.disabled = false;
  } }, 'Tester');
  return h('div', { class: 'row', style: { gap: '.4rem' } }, btn, test);
}

// ---------------------------------------------------------------- boutons d'une étape
/**
 * Boutons « Lancer le minuteur » d'une étape (un par minuteur). Se met à jour tout seul.
 * @param {{id:string, recette:object}} entry
 */
export function stepTimerButtons(entry, stepNo, step, { size = 'lg' } = {}) {
  const defs = stepTimers(step);
  if (!defs.length) return null;
  const host = h('div', { class: 'stack tight', style: { justifyItems: 'start' } });
  const draw = () => {
    fill(host, defs.map((d, i) => {
      const cle = `${entry.id}:${stepNo}:${i}`;
      const label = d.libelle || (defs.length > 1 ? `${step.titre || `Étape ${stepNo}`} (${i + 1})` : step.titre || `Étape ${stepNo}`);
      const running = timerFor(cle);
      return h('button', { class: `btn ${size}`, type: 'button', disabled: running && running.etat !== 'sonne' ? true : undefined, onclick: () => startTimer({
        secondes: Math.round(d.minutes * 60), libelle: label, recipeId: entry.id, etape: stepNo, cle, alerte: alertEnabled(),
      }).catch((e) => toast(e.message, { type: 'error' })) },
      icon('timer', size === 'lg' ? 22 : 16),
      running && running.etat !== 'sonne' ? `${label} — en cours` : `${d.libelle ? `${d.libelle} · ` : ''}${fmtTime(d.minutes) || `${Math.round(d.minutes * 60)} s`}`);
    }));
  };
  draw();
  const off = onTimersChange(() => (host.isConnected ? draw() : off()));
  return host;
}

// ---------------------------------------------------------------- barre des minuteurs en cours
function timerEl(t) {
  const ring = isRinging(t);
  const left = remaining(t);
  const href = t.recipeId ? `#/recette/${encodeURIComponent(t.recipeId)}/cuisiner${t.etape ? `?e=${t.etape}` : ''}` : null;
  const label = h(href ? 'a' : 'span', { href, class: 'timer-label', title: t.recette_titre ?? '' }, h('small', {}, t.libelle), t.recette_titre ? h('small', { class: 'sub' }, t.recette_titre) : null);
  const note = ring && t.alerte_envoyee ? h('small', { class: 'sub' }, 'annoncé sur l’enceinte') : ring && t.alerte_erreur ? h('small', { class: 'sub', title: t.alerte_erreur }, 'alerte enceinte échouée') : null;
  return h('div', { class: `timer ${ring ? 'ring' : ''} ${t.etat === 'pause' ? 'paused' : ''}`, role: ring ? 'alert' : undefined, 'data-id': t.id },
    h('div', { class: 'timer-main' }, h('b', {}, ring ? 'Terminé !' : mmss(left)), label, note),
    !ring ? h('button', { class: 'icon-btn', title: t.etat === 'en_cours' ? 'Pause' : 'Reprendre', 'aria-label': t.etat === 'en_cours' ? 'Mettre en pause' : 'Reprendre',
      onclick: () => command(t, t.etat === 'en_cours' ? 'pause' : 'reprendre') }, icon(t.etat === 'en_cours' ? 'pause' : 'play', 16)) : null,
    h('button', { class: 'icon-btn plus', title: ring ? 'Encore 1 minute' : '+ 1 minute', 'aria-label': '1 minute de plus', onclick: () => command(t, 'ajouter', { secondes: 60 }) }, '+1'),
    h('button', { class: 'icon-btn', title: ring ? 'Arrêter la sonnerie' : 'Annuler le minuteur', 'aria-label': ring ? 'Arrêter la sonnerie' : 'Annuler le minuteur', onclick: () => stop(t) }, icon('x', 16)));
}

// Réconciliation : un minuteur garde le même élément DOM tant que son état ne change pas ; chaque seconde,
// seul le chiffre est mis à jour. (Reconstruire la barre à chaque tick ferait « perdre » les clics.)
const els = new Map(); // id → { el, sig, digits }
const signature = (t) => [t.etat, isRinging(t), t.libelle, t.recette_titre, t.alerte_envoyee, t.alerte_erreur].join('|');

function draw() {
  if (!tray) return;
  const order = S.list.slice().sort((a, b) => Number(isRinging(b)) - Number(isRinging(a)) || (t0(a) - t0(b)));
  const alive = new Set(order.map((t) => t.id));
  for (const [id, x] of els) if (!alive.has(id)) (x.el.remove(), els.delete(id));
  order.forEach((t, i) => {
    let x = els.get(t.id);
    const sig = signature(t);
    if (!x || x.sig !== sig) {
      const el = timerEl(t);
      if (x) x.el.replaceWith(el);
      x = { el, sig };
      els.set(t.id, x);
    }
    const digits = x.el.querySelector('.timer-main b');
    const text = isRinging(t) ? 'Terminé !' : mmss(remaining(t));
    if (digits && digits.textContent !== text) digits.textContent = text;
    if (tray.children[i] !== x.el) tray.insertBefore(x.el, tray.children[i] ?? null);
  });
}
const t0 = (t) => remaining(t);

export function initTimers() {
  tray = h('div', { class: 'timer-tray', 'aria-label': 'Minuteurs', 'aria-live': 'polite' });
  // Sur mobile la barre est dans le flux, juste sous l'en-tête (elle ne recouvre pas la recette) ; sur grand écran, CSS la place en surimpression.
  const header = document.querySelector('.topbar');
  if (header) header.after(tray);
  else document.body.append(tray);
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  setInterval(() => {
    for (const t of S.list) {
      if (isRinging(t) && !S.beeped.has(t.id)) {
        S.beeped.add(t.id);
        beep();
        toast(`⏱️ ${t.libelle} : terminé !`, { ms: 8000 });
      }
    }
    if (S.list.length) draw();
  }, 1000);
  setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  refresh();
}
