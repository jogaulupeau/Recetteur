// Mode cuisine : une étape à la fois, en grand, quantités ajustées, minuteurs, écran maintenu allumé.
import { h, icon, stepper, stars, toast, clear, append } from '../dom.js';
import { api } from '../api.js';
import { entry, patchEntry } from '../state.js';
import { defaultServings } from '../cards.js';
import { fmtTime } from '../format.js';
import { formatIngredient } from '../../shared/quantity.js';
import { stepSegments } from '../../shared/steps.js';
import { today } from '../../shared/dates.js';

// ------------------------------------------------------------------ minuteurs
// Exprimés en date de fin (et non en compteur) : exacts même si l'onglet dort un moment.
const timers = [];
let timerSeq = 0;
let audio;

function beep() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < 3; i++) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.35 + 0.25);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + i * 0.35);
      o.stop(audio.currentTime + i * 0.35 + 0.3);
    }
  } catch { /* pas d'audio : le visuel suffit */ }
  navigator.vibrate?.([300, 150, 300, 150, 300]);
}

// Minuteur : { state: 'running', end } | { state: 'paused', left } | { state: 'ring' }
const remaining = (t) => (t.state === 'running' ? Math.max(0, Math.ceil((t.end - Date.now()) / 1000)) : t.state === 'paused' ? t.left : 0);
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function render({ params: [id], query, root }) {
  const e = entry(id);
  if (!e) {
    root.append(h('div', { class: 'card empty' }, h('h2', {}, 'Recette introuvable'), h('a', { class: 'btn', href: '#/recettes' }, 'Retour')));
    return;
  }
  const r = e.recette;
  const repasId = query.get('repas');
  let portions = Number(query.get('p')) || defaultServings(r);
  const n = r.etapes.length;
  // 0 = mise en place · 1..n = étapes · n+1 = fin
  let idx = Math.min(Math.max(Number(query.get('e')) || 0, 0), n + 1);
  const gathered = new Set();
  const visited = new Set([0]);
  let rating = e.etoiles || 0;

  // ---- squelette
  const titleEl = h('h1', {}, r.titre);
  const barFill = h('i');
  const body = h('div', { class: 'cook-body' });
  const dots = h('div', { class: 'dots', role: 'tablist', 'aria-label': 'Étapes' });
  const prev = h('button', { class: 'btn', onclick: () => go(idx - 1) }, icon('left', 22), 'Précédent');
  const next = h('button', { class: 'btn primary', onclick: () => go(idx + 1) });
  const tray = h('div', { class: 'timer-tray', 'aria-live': 'polite' });
  const stepperHost = h('div', {});
  const page = h('div', { class: 'cook' },
    h('div', { class: 'cook-top' },
      h('a', { class: 'icon-btn', href: `#/recette/${encodeURIComponent(e.id)}`, title: 'Quitter le mode cuisine', 'aria-label': 'Quitter' }, icon('x', 22)),
      titleEl, stepperHost),
    h('div', { class: 'cook-bar' }, barFill),
    body, h('div', { class: 'cook-nav-wrap' }, dots, h('div', { class: 'cook-nav' }, prev, next)), tray);
  root.append(page);

  function drawStepper() {
    clear(stepperHost).append(stepper(portions, (v) => { portions = v; drawBody(); }, { label: r.portions_unite, unit: r.portions_unite === 'personnes' ? 'pers.' : r.portions_unite }));
  }

  // ---- étapes
  const ingLine = (ing) => formatIngredient(ing, r.portions, portions);

  function drawBody() {
    clear(body);
    const total = n + 2;
    barFill.style.width = `${(idx / (total - 1)) * 100}%`;
    prev.disabled = idx === 0;
    clear(next);
    if (idx === n + 1) next.append(icon('check', 22), 'Terminer');
    else next.append(idx === 0 ? 'Commencer' : idx === n ? 'Dernière étape faite' : 'Étape suivante', icon('right', 22));
    clear(dots).append(...Array.from({ length: total }, (_, i) =>
      h('button', { type: 'button', role: 'tab', 'aria-label': i === 0 ? 'Ingrédients' : i === n + 1 ? 'Fin' : `Étape ${i}`, class: i === idx ? 'on' : visited.has(i) ? 'done' : '', onclick: () => go(i) })));

    if (idx === 0) {
      append(body, [
        h('div', { class: 'cook-kicker' }, 'Mise en place'),
        h('h2', { style: { margin: 0 } }, `Pour ${portions} ${r.portions_unite}`),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Cochez ce que vous avez sorti.'),
        ...r.ingredients.map((ing) => {
          const cb = h('input', { type: 'checkbox', checked: gathered.has(ing.id), onchange: () => {
            cb.checked ? gathered.add(ing.id) : gathered.delete(ing.id);
            lab.classList.toggle('on', cb.checked);
          } });
          const lab = h('label', { class: `check-ing ${gathered.has(ing.id) ? 'on' : ''}` }, cb, h('span', {}, ingLine(ing)));
          return lab;
        }),
        r.materiel?.length ? h('p', { class: 'muted' }, `Matériel : ${r.materiel.join(', ')}`) : null]);
    } else if (idx <= n) {
      const s = r.etapes[idx - 1];
      const ings = s.ingredients.map((x) => r.ingredients.find((i) => i.id === x)).filter(Boolean);
      append(body, [
        h('div', { class: 'cook-kicker' }, `Étape ${idx} sur ${n}${s.titre ? ` · ${s.titre}` : ''}`),
        h('p', { class: 'cook-text' }, stepSegments(s.texte, r, portions).map((seg) => (seg.qte ? h('span', { class: 'q' }, seg.qte) : seg.texte))),
        s.duree ? timerButton(s, idx) : null,
        ings.length ? h('div', { class: 'cook-ings' }, h('strong', {}, 'À utiliser'), h('ul', {}, ings.map((i) => h('li', {}, ingLine(i))))) : null]);
    } else {
      append(body, [
        h('div', { class: 'cook-kicker' }, 'Terminé'),
        h('h2', { style: { fontSize: '2rem' } }, 'Bon appétit ! 🍽️'),
        h('div', { class: 'stack tight' }, h('p', { class: 'muted', style: { margin: 0 } }, 'Qu’en avez-vous pensé ?'),
          stars(rating, async (v) => { rating = v; patchEntry(await api.patch(`recettes/${e.id}`, { etoiles: v })); drawBody(); })),
        r.conservation ? h('div', { class: 'card flat' }, h('strong', {}, 'Conservation'), h('p', { style: { margin: 0 } }, r.conservation)) : null,
        r.notes ? h('div', { class: 'card flat' }, h('strong', {}, 'Notes'), h('p', { style: { margin: 0, whiteSpace: 'pre-line' } }, r.notes)) : null]);
    }
  }

  async function finish() {
    try {
      if (repasId) await api.patch(`menu/${repasId}`, { fait: true });
      else await api.post(`recettes/${e.id}/cuisinee`, { date: today() });
      patchEntry(await api.get(`recettes/${e.id}`));
      toast('Recette notée comme cuisinée.', { type: 'ok' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
    location.hash = `#/recette/${encodeURIComponent(e.id)}`;
  }

  function go(i) {
    if (i > n + 1) return finish();
    idx = Math.max(0, i);
    visited.add(idx);
    drawBody();
    window.scrollTo({ top: 0 });
  }

  // ---- minuteurs
  function timerButton(step, stepNo) {
    const mine = timers.find((t) => t.stepNo === stepNo && t.recipe === e.id);
    if (mine) return h('p', { class: 'muted', style: { margin: 0 } }, `Minuteur lancé (${step.duree} min) — voir en haut à droite.`);
    return h('button', { class: 'btn lg', style: { justifySelf: 'start' }, onclick: () => {
      timers.push({ id: ++timerSeq, recipe: e.id, stepNo, label: `Étape ${stepNo}`, total: step.duree * 60, end: Date.now() + step.duree * 60000, state: 'running' });
      // Le son n'est autorisé qu'après un geste de l'utilisateur : on prépare l'audio maintenant.
      try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* sans son */ }
      drawBody();
      drawTimers();
    } }, icon('timer', 22), `Lancer le minuteur · ${fmtTime(step.duree)}`);
  }

  function drawTimers() {
    clear(tray);
    for (const t of timers) {
      const left = remaining(t);
      tray.append(h('div', { class: `timer ${t.state === 'ring' ? 'ring' : ''}`, role: t.state === 'ring' ? 'alert' : undefined },
        h('div', {}, h('b', {}, t.state === 'ring' ? 'Terminé !' : mmss(left)), h('small', {}, t.label)),
        t.state !== 'ring' ? h('button', { class: 'icon-btn', title: t.state === 'running' ? 'Pause' : 'Reprendre', onclick: () => {
          if (t.state === 'running') Object.assign(t, { state: 'paused', left, end: null });
          else Object.assign(t, { state: 'running', end: Date.now() + t.left * 1000 });
          drawTimers();
        } }, icon(t.state === 'running' ? 'pause' : 'play', 16)) : null,
        h('button', { class: 'icon-btn', title: 'Arrêter', onclick: () => { timers.splice(timers.indexOf(t), 1); drawTimers(); drawBody(); } }, icon('x', 16))));
    }
  }

  const tick = setInterval(() => {
    let changed = false;
    for (const t of timers) {
      if (t.state === 'running' && t.end <= Date.now()) {
        t.state = 'ring';
        changed = true;
        beep();
        toast(`⏱️ ${t.label} : le minuteur est terminé.`, { ms: 8000 });
      }
    }
    if (timers.length || changed) drawTimers();
  }, 1000);

  // ---- écran allumé, clavier, glissement
  let lock;
  const acquire = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* refusé : tant pis */ } };
  const onVis = () => document.visibilityState === 'visible' && acquire();
  acquire();
  document.addEventListener('visibilitychange', onVis);

  const onKey = (ev) => {
    if (ev.target.matches?.('input,textarea,select')) return;
    if (ev.key === 'ArrowRight' || ev.key === ' ') { ev.preventDefault(); go(idx + 1); }
    else if (ev.key === 'ArrowLeft') go(idx - 1);
    else if (ev.key === 'Escape') location.hash = `#/recette/${encodeURIComponent(e.id)}`;
  };
  window.addEventListener('keydown', onKey);
  let sx = 0, sy = 0;
  const onStart = (ev) => ((sx = ev.touches[0].clientX), (sy = ev.touches[0].clientY));
  const onEnd = (ev) => {
    const dx = ev.changedTouches[0].clientX - sx, dy = ev.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) go(idx + (dx < 0 ? 1 : -1));
  };
  body.addEventListener('touchstart', onStart, { passive: true });
  body.addEventListener('touchend', onEnd, { passive: true });

  drawStepper();
  drawBody();
  drawTimers();

  return () => {
    clearInterval(tick);
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    lock?.release?.().catch(() => {});
  };
}
