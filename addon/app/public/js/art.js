// Illustrations d'assiette générées : une composition unique par recette (graine = titre),
// dessinée d'après ses ingrédients (rayon → forme). Aucune photo, aucune image à stocker.
// Le SVG n'insère jamais de texte de l'utilisateur : uniquement des nombres et des couleurs.
import { h } from './dom.js';

const C = { tomato: '#e2482b', herb: '#2f7a4d', leaf: '#5aa469', butter: '#f4c542', blush: '#f2a99b', plum: '#8a4a73', cream: '#fff7e4', brown: '#b9683b', sky: '#5aa7c4', ink: '#1d2b24', orange: '#f08a24' };

function hash(str) {
  let x = 2166136261;
  for (const ch of String(str)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return x >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n) => Math.round(n * 10) / 10;

// Une forme par famille d'ingrédients ; chaque fonction dessine autour de (0,0), à l'échelle s.
const SHAPES = {
  'fruits-legumes': (s, r) => {
    const pick = r();
    if (pick < 0.4) return `<circle r="${f(s)}" fill="${C.tomato}"/><path d="M${f(-s * 0.4)},${f(-s * 0.85)} q${f(s * 0.4)},${f(-s * 0.35)} ${f(s * 0.8)},0 q${f(-s * 0.4)},${f(s * 0.3)} ${f(-s * 0.8)},0z" fill="${C.herb}"/><circle cx="${f(-s * 0.35)}" cy="${f(-s * 0.3)}" r="${f(s * 0.18)}" fill="#fff" opacity=".35"/>`;
    const col = pick < 0.75 ? C.leaf : C.herb;
    return `<path d="M0,${f(-s * 1.2)} C${f(s * 1.1)},${f(-s * 0.6)} ${f(s * 1.1)},${f(s * 0.6)} 0,${f(s * 1.2)} C${f(-s * 1.1)},${f(s * 0.6)} ${f(-s * 1.1)},${f(-s * 0.6)} 0,${f(-s * 1.2)}z" fill="${col}"/><path d="M0,${f(-s)} V${f(s)}" stroke="${C.ink}" stroke-opacity=".35" stroke-width="1.4" stroke-linecap="round"/>`;
  },
  'viandes-poissons': (s) => `<rect x="${f(-s * 1.1)}" y="${f(-s * 0.65)}" width="${f(s * 2.2)}" height="${f(s * 1.3)}" rx="${f(s * 0.6)}" fill="${C.brown}"/><path d="M${f(-s * 0.6)},${f(-s * 0.15)} q${f(s * 0.6)},${f(-s * 0.4)} ${f(s * 1.2)},0" stroke="${C.cream}" stroke-opacity=".6" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  cremerie: (s) => `<circle r="${f(s)}" fill="${C.cream}" stroke="${C.ink}" stroke-opacity=".25" stroke-width="1.5"/><circle r="${f(s * 0.45)}" fill="${C.butter}"/>`,
  epicerie: (s, r) => Array.from({ length: 6 }, (_, i) => `<ellipse cx="${f((r() - 0.5) * s * 2.2)}" cy="${f((r() - 0.5) * s * 2)}" rx="${f(s * 0.32)}" ry="${f(s * 0.2)}" transform="rotate(${Math.round(r() * 180)})" fill="${i % 3 ? C.butter : C.orange}"/>`).join(''),
  'epicerie-sucree': (s) => `<circle r="${f(s)}" fill="${C.blush}"/><circle cx="${f(-s * 0.3)}" cy="${f(-s * 0.3)}" r="${f(s * 0.25)}" fill="#fff" opacity=".5"/>`,
  'condiments-epices': (s, r) => Array.from({ length: 5 }, () => `<circle cx="${f((r() - 0.5) * s * 2.2)}" cy="${f((r() - 0.5) * s * 2.2)}" r="${f(s * 0.2)}" fill="${C.orange}"/>`).join(''),
  boulangerie: (s) => `<path d="M${f(-s * 1.1)},${f(s * 0.4)} A${f(s * 1.1)},${f(s * 1.1)} 0 0 1 ${f(s * 1.1)},${f(s * 0.4)} Q0,${f(-s * 0.1)} ${f(-s * 1.1)},${f(s * 0.4)}z" fill="${C.orange}"/>`,
  surgeles: (s) => `<circle r="${f(s * 0.9)}" fill="${C.sky}" opacity=".8"/>`,
  boissons: (s) => `<circle r="${f(s * 0.8)}" fill="${C.plum}" opacity=".85"/>`,
  autre: (s) => `<circle r="${f(s * 0.7)}" fill="${C.butter}"/>`,
};

/** SVG (chaîne) de l'assiette d'une recette. */
export function plateSvg(recette) {
  const r = rng(hash(recette.titre));
  const cx = 100, cy = 62;
  // Familles présentes, par ordre d'importance (ingrédients principaux d'abord).
  const kinds = [];
  for (const ing of recette.ingredients) if (!ing.basique && !kinds.includes(ing.rayon)) kinds.push(ing.rayon);
  const picks = [];
  const n = Math.min(5, Math.max(3, recette.ingredients.length > 6 ? 5 : 4));
  for (let i = 0; i < n; i++) picks.push(kinds[i % Math.max(kinds.length, 1)] ?? 'autre');
  const offset = r() * 360;
  const food = picks.map((k, i) => {
    const ang = ((offset + i * 137.5) * Math.PI) / 180;
    const rad = i === 0 ? 8 + r() * 6 : 20 + r() * 14;
    const s = i === 0 ? 13 + r() * 4 : 8 + r() * 5;
    const shape = (SHAPES[k] ?? SHAPES.autre)(s, r);
    return `<g transform="translate(${f(cx + Math.cos(ang) * rad)} ${f(cy + Math.sin(ang) * rad)}) rotate(${Math.round(r() * 360)})">${shape}</g>`;
  }).join('');
  const confetti = Array.from({ length: 14 }, () => {
    const x = r() * 200, y = r() * 124;
    return Math.hypot(x - cx, y - cy) > 58 ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.2 + r() * 2.2)}" fill="var(--t)" opacity="${f(0.25 + r() * 0.35)}"/>` : '';
  }).join('');
  const fork = `<g transform="translate(26 62)" fill="${C.ink}" opacity=".85"><rect x="-1.6" y="-4" width="3.2" height="38" rx="1.6"/><rect x="-7" y="-30" width="2.6" height="26" rx="1.3"/><rect x="-1.3" y="-30" width="2.6" height="26" rx="1.3"/><rect x="4.4" y="-30" width="2.6" height="26" rx="1.3"/><rect x="-7" y="-8" width="14" height="6" rx="3"/></g>`;
  const knife = `<g transform="translate(174 62)" fill="${C.ink}" opacity=".85"><rect x="-1.6" y="-2" width="3.2" height="36" rx="1.6"/><path d="M-1,-34 C9,-30 9,-6 -1,-2z"/></g>`;
  return `<svg viewBox="0 0 200 124" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<rect width="200" height="124" style="fill:var(--p,var(--t-soft))"/>${confetti}${fork}${knife}
<circle cx="${cx}" cy="${cy + 3}" r="52" fill="${C.ink}" opacity=".12"/>
<circle cx="${cx}" cy="${cy}" r="51" fill="${C.cream}" stroke="${C.ink}" stroke-width="2.5"/>
<circle cx="${cx}" cy="${cy}" r="39" fill="none" stroke="${C.ink}" stroke-opacity=".14" stroke-width="2"/>${food}</svg>`;
}

/**
 * Élément illustré. `data-type` fournit les couleurs (--t, --t-soft) définies en CSS.
 * @param {object} recette
 * @param {{className?:string}} [o]
 */
export function plate(recette, { className = '', fit } = {}) {
  const el = h('span', { class: `plate ${className}`, 'data-type': recette.type, 'data-tint': tintOf(recette) });
  el.innerHTML = plateSvg(recette);
  // Bannière large : assiette entière (« meet »). Pastille ou héros : on zoome sur l'assiette (« slice »).
  const slice = (fit ?? (className.includes('avatar') ? 'slice' : 'meet')) === 'slice';
  el.firstElementChild.setAttribute('preserveAspectRatio', slice ? 'xMidYMid slice' : 'xMidYMid meet');
  return el;
}

/** Assiette « de bienvenue » pour les écrans vides. */
export function emptyPlate() {
  const ing = ['fruits-legumes', 'cremerie', 'epicerie', 'viandes-poissons', 'fruits-legumes', 'condiments-epices'].map((rayon) => ({ rayon }));
  return plate({ titre: 'Bienvenue', type: 'plat', ingredients: ing }, { className: 'empty-art' });
}

/** Teinte de fond propre à la recette (0–5) : varie la grille indépendamment du type de plat. */
export const tintOf = (recette) => hash(`${recette.titre}#`) % 6;
