// Illustrations d'assiette générées d'après les ingrédients RÉELS de la recette (voir shared/visual.js) :
// une carotte donne une carotte, des lentilles des lentilles, un saumon un poisson. Les plus gros ingrédients
// dominent l'assiette ; une tarte est dessinée en tarte, une soupe en bol. Aucune photo, rien à stocker.
// Le SVG n'insère jamais de texte de l'utilisateur : uniquement des nombres et des couleurs.
import { h } from './dom.js';
import { pickIngredients, dishForm } from '../shared/visual.js';

const K = { red: '#e2482b', redDeep: '#bf3219', orange: '#f08a24', carrot: '#ee7a1c', yellow: '#f4c542', lemon: '#f6dd5a', green: '#5aa469', greenDeep: '#2f7a4d', lime: '#b5d46a',
  purple: '#8a4a73', eggplant: '#5b2a63', cream: '#fff7e4', white: '#fffdf6', beige: '#e9d3a6', tan: '#d9b073', brown: '#b9683b', brownDeep: '#7a4426', pink: '#f2a99b',
  salmon: '#f08a6a', gold: '#e0a24f', ink: '#1d2b24', blue: '#5aa7c4' };

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
const has = (name, re) => re.test(String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
const circ = (cx, cy, r, fill, extra = '') => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}" ${extra}/>`;
const ell = (cx, cy, rx, ry, fill, rot = 0, extra = '') => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" transform="rotate(${rot} ${f(cx)} ${f(cy)})" ${extra}/>`;
const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (d, stroke, w = 1.4, op = 0.4) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-opacity="${op}" stroke-linecap="round"/>`;
const shine = (x, y, r) => circ(x, y, r, '#fff', 'opacity=".38"');
const leaf = (x, y, len, wid, rot, fill) => `<path d="M0,0 C${f(wid)},${f(-len * 0.3)} ${f(wid)},${f(-len * 0.8)} 0,${f(-len)} C${f(-wid)},${f(-len * 0.8)} ${f(-wid)},${f(-len * 0.3)} 0,0z" fill="${fill}" transform="translate(${f(x)} ${f(y)}) rotate(${rot})"/>`;

// Chaque icône : un dessin centré en (0,0) de rayon ≈ s, et sa couleur dominante (« tone », pour tartes et bols).
const ICONS = {
  tomate: { tone: K.red, draw: (s) => circ(0, 0, s, K.red) + path(`M${-s * 0.5},${-s * 0.75} l${s * 0.5},${s * 0.18} l${s * 0.5},${-s * 0.18} l${-s * 0.22},${s * 0.34} l${s * 0.22},${s * 0.28} l${-s * 0.5},${-s * 0.16} l${-s * 0.5},${s * 0.16} l${s * 0.22},${-s * 0.28}z`, K.greenDeep) + shine(-s * 0.4, -s * 0.2, s * 0.17) },
  carotte: { tone: K.carrot, draw: (s) => path(`M${-s * 1.35},0 C${-s * 0.5},${-s * 0.6} ${s * 0.7},${-s * 0.5} ${s * 1.1},0 C${s * 0.7},${s * 0.5} ${-s * 0.5},${s * 0.6} ${-s * 1.35},0z`, K.carrot) + line(`M${-s * 0.6},${-s * 0.15} l${s * 0.25},${s * 0.1} M${s * 0.1},${s * 0.2} l${s * 0.25},${-s * 0.08}`, K.brownDeep, 1.4, 0.45) + leaf(s * 1.05, 0, s * 0.8, s * 0.22, 70, K.green) + leaf(s * 1.05, 0, s * 0.8, s * 0.22, 110, K.greenDeep) },
  courgette: { tone: K.greenDeep, draw: (s) => [[-s * 0.45, -s * 0.15, s * 0.8], [s * 0.5, s * 0.25, s * 0.75]].map(([x, y, r]) => circ(x, y, r, K.greenDeep) + circ(x, y, r * 0.8, '#e6f2bf') + circ(x, y, r * 0.5, '#f3f9d6') + [0, 1, 2, 3, 4].map((i) => circ(x + Math.cos(i * 1.256) * r * 0.32, y + Math.sin(i * 1.256) * r * 0.32, r * 0.07, K.lime)).join('')).join('') },
  aubergine: { tone: K.eggplant, draw: (s) => path(`M${-s * 1.25},${s * 0.2} C${-s * 1.25},${-s * 0.75} ${s * 0.3},${-s * 0.85} ${s * 1.1},${-s * 0.2} C${s * 1.3},${s * 0.4} ${s * 0.5},${s * 0.85} ${-s * 0.4},${s * 0.7} C${-s * 0.95},${s * 0.65} ${-s * 1.25},${s * 0.5} ${-s * 1.25},${s * 0.2}z`, K.eggplant) + path(`M${s * 0.95},${-s * 0.35} l${s * 0.35},${-s * 0.25} l${s * 0.15},${s * 0.3} l${s * 0.25},${s * 0.1} l${-s * 0.35},${s * 0.2}z`, K.greenDeep) + line(`M${-s * 0.8},${-s * 0.25} C${-s * 0.3},${-s * 0.5} ${s * 0.3},${-s * 0.55} ${s * 0.7},${-s * 0.35}`, '#fff', 2, 0.4) },
  poivron: { tone: K.red, draw: (s, r, name) => { const c = has(name, /jaune/) ? K.yellow : has(name, /vert/) ? K.green : has(name, /orange/) ? K.orange : K.red; return path(`M0,${-s * 0.85} C${s * 0.5},${-s * 1.05} ${s * 1.1},${-s * 0.6} ${s},${s * 0.1} C${s * 0.95},${s * 0.8} ${s * 0.4},${s * 1.05} 0,${s * 0.9} C${-s * 0.4},${s * 1.05} ${-s * 0.95},${s * 0.8} ${-s},${s * 0.1} C${-s * 1.1},${-s * 0.6} ${-s * 0.5},${-s * 1.05} 0,${-s * 0.85}z`, c) + line(`M0,${-s * 0.8} C${-s * 0.3},${-s * 0.2} ${-s * 0.3},${s * 0.5} 0,${s * 0.9}`, K.ink, 1.3, 0.25) + path(`M${-s * 0.18},${-s * 1.0} h${s * 0.36} l${s * 0.08},${-s * 0.3} h${-s * 0.52}z`, K.greenDeep) + shine(-s * 0.55, -s * 0.2, s * 0.15); } },
  piment: { tone: K.red, draw: (s) => path(`M${-s * 1.2},${-s * 0.3} C${-s * 0.2},${-s * 0.55} ${s * 0.9},${-s * 0.2} ${s * 1.3},${s * 0.55} C${s * 0.4},${s * 0.3} ${-s * 0.6},${s * 0.35} ${-s * 1.2},${-s * 0.3}z`, K.redDeep) + path(`M${-s * 1.2},${-s * 0.3} l${-s * 0.3},${-s * 0.2} l${s * 0.1},${s * 0.35}z`, K.greenDeep) },
  oignon: { tone: K.beige, draw: (s, r, name) => { const c = has(name, /rouge|echalote/) ? K.purple : K.gold; return circ(0, 0, s, c) + circ(0, 0, s * 0.82, K.white) + circ(0, 0, s * 0.62, 'none', `stroke="${c}" stroke-opacity=".5" stroke-width="1.6"`) + circ(0, 0, s * 0.38, 'none', `stroke="${c}" stroke-opacity=".5" stroke-width="1.6"`); } },
  ail: { tone: K.cream, draw: (s) => path(`M0,${-s * 1.15} C${s * 0.3},${-s * 0.6} ${s},${-s * 0.4} ${s * 0.95},${s * 0.2} C${s * 0.9},${s * 0.85} ${s * 0.3},${s} 0,${s * 0.95} C${-s * 0.3},${s} ${-s * 0.9},${s * 0.85} ${-s * 0.95},${s * 0.2} C${-s},${-s * 0.4} ${-s * 0.3},${-s * 0.6} 0,${-s * 1.15}z`, K.white) + line(`M0,${-s * 0.55} C${-s * 0.25},${s * 0.1} ${-s * 0.25},${s * 0.5} 0,${s * 0.9} M${-s * 0.1},${-s * 0.5} C${s * 0.45},${s * 0.1} ${s * 0.45},${s * 0.55} ${s * 0.15},${s * 0.9}`, K.brown, 1.3, 0.45) },
  poireau: { tone: K.lime, draw: (s) => [[-s * 0.5, 0], [s * 0.45, s * 0.1]].map(([x, y]) => circ(x, y, s * 0.62, K.green) + circ(x, y, s * 0.46, K.lime) + circ(x, y, s * 0.28, '#f3f9d6') + circ(x, y, s * 0.12, K.white)).join('') },
  patate: { tone: K.tan, draw: (s) => path(`M${-s * 1.15},${s * 0.1} C${-s * 1.15},${-s * 0.6} ${-s * 0.3},${-s * 0.9} ${s * 0.4},${-s * 0.8} C${s * 1.1},${-s * 0.7} ${s * 1.35},${-s * 0.1} ${s},${s * 0.5} C${s * 0.7},${s} ${-s * 0.4},${s * 0.95} ${-s * 0.8},${s * 0.7} C${-s},${s * 0.55} ${-s * 1.15},${s * 0.35} ${-s * 1.15},${s * 0.1}z`, K.tan) + circ(-s * 0.4, -s * 0.15, s * 0.07, K.brownDeep, 'opacity=".6"') + circ(s * 0.35, s * 0.2, s * 0.07, K.brownDeep, 'opacity=".6"') + circ(s * 0.6, -s * 0.35, s * 0.06, K.brownDeep, 'opacity=".6"') + shine(-s * 0.55, -s * 0.45, s * 0.14) },
  champignon: { tone: K.tan, draw: (s) => `<rect x="${f(-s * 0.38)}" y="0" width="${f(s * 0.76)}" height="${f(s * 0.9)}" rx="${f(s * 0.25)}" fill="#f1e6d2"/>` + path(`M${-s * 1.05},${s * 0.1} A${s * 1.05},${s * 0.95} 0 0 1 ${s * 1.05},${s * 0.1}z`, '#c79a6b') + line(`M${-s * 0.55},${-s * 0.35} q${s * 0.3},${-s * 0.3} ${s * 0.7},${-s * 0.25}`, '#fff', 1.6, 0.45) },
  brocoli: { tone: K.greenDeep, draw: (s) => `<rect x="${f(-s * 0.3)}" y="${f(s * 0.1)}" width="${f(s * 0.6)}" height="${f(s * 0.95)}" rx="${f(s * 0.2)}" fill="${K.lime}"/>` + [[-0.55, -0.15, 0.55], [0.55, -0.15, 0.55], [0, -0.55, 0.6], [-0.25, 0.1, 0.5], [0.3, 0.1, 0.5]].map(([x, y, r], i) => circ(x * s, y * s, r * s, i % 2 ? K.greenDeep : K.green)).join('') },
  feuilles: { tone: K.green, draw: (s, r, name) => { const c = has(name, /epinard|chou|blette|kale/) ? K.greenDeep : K.green; return [0, 120, 240].map((a, i) => leaf(0, 0, s * 1.35, s * 0.62, a + 20, i === 1 ? K.lime : c) + `<path d="M0,0 V${f(-s * 1.1)}" stroke="${K.ink}" stroke-opacity=".3" stroke-width="1.2" transform="rotate(${a + 20})"/>`).join(''); } },
  herbes: { tone: K.green, draw: (s) => line(`M${-s * 1.1},${s * 0.8} L${s * 1.1},${-s * 0.8}`, K.greenDeep, 1.8, 0.9) + [-0.7, -0.25, 0.2, 0.65].map((t, i) => leaf(t * s, -t * s * 0.73, s * 0.7, s * 0.28, i % 2 ? 40 : -50, i % 2 ? K.green : K.greenDeep)).join('') },
  citron: { tone: K.lemon, draw: (s, r, name) => { const c = has(name, /vert|lime/) ? K.lime : has(name, /orange|mandarine/) ? K.orange : K.lemon; return circ(0, 0, s, c) + circ(0, 0, s * 0.86, '#fff3c4') + [0, 1, 2, 3, 4, 5].map((i) => `<path d="M0,0 L${f(Math.cos(i * 1.047) * s * 0.78)},${f(Math.sin(i * 1.047) * s * 0.78)}" stroke="${c}" stroke-width="1.8" stroke-opacity=".8"/>`).join('') + circ(0, 0, s * 0.1, c); } },
  orange: { tone: K.orange, draw: (s) => circ(0, 0, s, K.orange) + circ(0, 0, s * 0.86, '#ffd9a0') + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M0,0 L${f(Math.cos(i * 0.785) * s * 0.8)},${f(Math.sin(i * 0.785) * s * 0.8)}" stroke="${K.orange}" stroke-width="1.6" stroke-opacity=".75"/>`).join('') },
  pomme: { tone: '#f0e3a8', slice: (s) => path(`M${-s},${s * 0.1} A${s},${s} 0 0 1 ${s},${s * 0.1} A${s * 0.75},${s * 0.5} 0 0 0 ${-s},${s * 0.1}z`, '#f7e8a6') + line(`M${-s * 0.9},${-s * 0.05} A${s * 0.95},${s * 0.95} 0 0 1 ${s * 0.9},${-s * 0.05}`, K.red, 2.4, 0.9), draw: (s, r, name) => { const c = has(name, /golden|verte|granny|reinette/) ? '#b9d45a' : K.red; return circ(0, 0, s, c) + circ(-s * 0.3, s * 0.05, s * 0.55, K.white, 'opacity=".12"') + line(`M0,${-s * 0.85} q${s * 0.05},${-s * 0.45} ${s * 0.35},${-s * 0.6}`, K.brownDeep, 1.8, 0.9) + leaf(s * 0.2, -s * 0.8, s * 0.55, s * 0.2, 60, K.green) + shine(-s * 0.45, -s * 0.3, s * 0.16); } },
  poire: { tone: K.lime, draw: (s) => path(`M0,${-s * 1.0} C${s * 0.3},${-s * 1.0} ${s * 0.35},${-s * 0.4} ${s * 0.6},${-s * 0.1} C${s * 1.1},${s * 0.4} ${s * 0.8},${s * 1.0} 0,${s * 1.0} C${-s * 0.8},${s * 1.0} ${-s * 1.1},${s * 0.4} ${-s * 0.6},${-s * 0.1} C${-s * 0.35},${-s * 0.4} ${-s * 0.3},${-s} 0,${-s}z`, '#c9d65a') + line(`M0,${-s} v${-s * 0.35}`, K.brownDeep, 1.8, 0.9) + shine(-s * 0.4, s * 0.2, s * 0.15) },
  banane: { tone: K.yellow, draw: (s) => path(`M${-s * 1.2},${-s * 0.5} C${-s * 0.8},${s * 0.9} ${s * 0.8},${s * 1.0} ${s * 1.3},${-s * 0.2} C${s * 0.8},${s * 0.35} ${-s * 0.5},${s * 0.35} ${-s * 1.2},${-s * 0.5}z`, K.yellow) + circ(-s * 1.2, -s * 0.5, s * 0.1, K.brownDeep) },
  baies: { tone: K.redDeep, draw: (s, r, name) => { const c = has(name, /myrtille|mure|cassis/) ? '#4b3d7a' : has(name, /cerise/) ? '#9c1f2e' : K.red; return [[-0.5, -0.3], [0.5, -0.35], [0, 0.45], [0.05, -0.15]].map(([x, y], i) => circ(x * s, y * s, s * 0.52, c) + shine((x - 0.15) * s, (y - 0.15) * s, s * 0.1)).join(''); } },
  fruit: { tone: K.orange, draw: (s) => circ(0, 0, s, '#f6a54a') + circ(-s * 0.25, -s * 0.15, s * 0.5, '#fff', 'opacity=".14"') + leaf(0, -s * 0.9, s * 0.5, s * 0.2, 20, K.green) },
  avocat: { tone: K.lime, draw: (s) => ell(0, 0, s * 0.8, s * 1.1, K.greenDeep, 25) + ell(0, 0, s * 0.64, s * 0.95, '#d7e68a', 25) + circ(s * 0.05, s * 0.15, s * 0.36, K.brown) + shine(-s * 0.05, s * 0.05, s * 0.1) },
  courge: { tone: K.orange, draw: (s) => circ(0, 0, s, K.orange) + [-0.55, 0, 0.55].map((x) => line(`M${f(x * s)},${f(-s * 0.9)} C${f(x * s * 1.5)},${f(-s * 0.3)} ${f(x * s * 1.5)},${f(s * 0.3)} ${f(x * s)},${f(s * 0.9)}`, K.brownDeep, 1.5, 0.35)).join('') + `<rect x="${f(-s * 0.1)}" y="${f(-s * 1.12)}" width="${f(s * 0.2)}" height="${f(s * 0.3)}" rx="2" fill="${K.greenDeep}"/>` },
  betterave: { tone: K.purple, draw: (s, r, name) => { const c = has(name, /radis/) ? '#e0527f' : K.purple; return circ(0, 0, s * 0.9, c) + path(`M${-s * 0.1},${s * 0.85} h${s * 0.2} l${-s * 0.1},${s * 0.4}z`, K.white) + leaf(0, -s * 0.8, s * 0.7, s * 0.22, -20, K.greenDeep) + leaf(0, -s * 0.8, s * 0.7, s * 0.22, 25, K.green) + shine(-s * 0.35, -s * 0.2, s * 0.15); } },
  mais: { tone: K.yellow, draw: (s) => `<g transform="rotate(-25)">${`<rect x="${f(-s * 1.2)}" y="${f(-s * 0.45)}" width="${f(s * 2.4)}" height="${f(s * 0.9)}" rx="${f(s * 0.45)}" fill="${K.yellow}"/>`}${[-0.8, -0.4, 0, 0.4, 0.8].map((x) => [-0.2, 0.2].map((y) => circ(x * s, y * s, s * 0.1, '#e0a800')).join('')).join('')}</g>` + leaf(s * 0.9, s * 0.5, s * 0.8, s * 0.25, 120, K.green) },
  gousses: { tone: K.green, draw: (s) => [-0.5, 0, 0.5].map((y, i) => line(`M${-s * 1.2},${f(y * s)} C${-s * 0.3},${f(y * s + (i - 1) * s * 0.3)} ${s * 0.4},${f(y * s - s * 0.2)} ${s * 1.2},${f(y * s + s * 0.1)}`, K.green, s * 0.34, 1)).join('') },
  legumineuse: { tone: K.tan, draw: (s, r, name) => { const c = has(name, /lentille/) ? '#7a8f4a' : has(name, /rouge/) ? '#8a2a2a' : has(name, /blanc|flageolet/) ? '#f3ead2' : has(name, /noir/) ? '#2e2a2a' : '#e2c27a'; return Array.from({ length: 11 }, (_, i) => circ(Math.cos(i * 2.4) * s * (0.2 + (i % 4) * 0.22), Math.sin(i * 2.4) * s * (0.2 + (i % 4) * 0.22), s * 0.2, c, `stroke="${K.ink}" stroke-opacity=".3" stroke-width=".8"`)).join(''); } },
  oeuf: { tone: K.yellow, draw: (s) => path(`M${-s * 0.9},${-s * 0.1} C${-s * 1.1},${-s * 0.85} ${-s * 0.1},${-s * 1.05} ${s * 0.5},${-s * 0.85} C${s * 1.2},${-s * 0.7} ${s * 1.1},${s * 0.2} ${s * 0.9},${s * 0.6} C${s * 0.6},${s * 1.05} ${-s * 0.3},${s * 1.0} ${-s * 0.75},${s * 0.65} C${-s * 1.1},${s * 0.35} ${-s * 0.8},${s * 0.2} ${-s * 0.9},${-s * 0.1}z`, K.white) + circ(0, 0, s * 0.42, K.yellow) + shine(-s * 0.12, -s * 0.12, s * 0.11) },
  cubes: { tone: K.white, draw: (s) => [[-0.55, -0.35, 12], [0.5, -0.2, -15], [-0.05, 0.55, 5]].map(([x, y, a]) => `<rect x="${f(x * s - s * 0.45)}" y="${f(y * s - s * 0.45)}" width="${f(s * 0.9)}" height="${f(s * 0.9)}" rx="${f(s * 0.14)}" fill="${K.white}" transform="rotate(${a} ${f(x * s)} ${f(y * s)})"/>`).join('') },
  boule: { tone: K.white, draw: (s) => circ(0, 0, s, K.white) + circ(-s * 0.3, -s * 0.3, s * 0.2, '#fff', 'opacity=".9"') + line(`M${-s * 0.5},${s * 0.45} q${s * 0.5},${s * 0.35} ${s},0`, K.ink, 1.3, 0.2) },
  fromage: { tone: K.yellow, draw: (s) => path(`M${-s * 1.2},${s * 0.7} L${s * 1.2},${s * 0.7} L${s * 1.2},${-s * 0.5} Z`, K.yellow) + circ(s * 0.5, s * 0.25, s * 0.17, '#e0a800') + circ(s * 0.85, -s * 0.05, s * 0.1, '#e0a800') + circ(s * 0.1, s * 0.5, s * 0.1, '#e0a800') },
  beurre: { tone: K.lemon, draw: (s) => `<rect x="${f(-s * 1.1)}" y="${f(-s * 0.6)}" width="${f(s * 2.2)}" height="${f(s * 1.2)}" rx="${f(s * 0.2)}" fill="#f9e27d"/><rect x="${f(-s * 1.1)}" y="${f(-s * 0.6)}" width="${f(s * 2.2)}" height="${f(s * 0.4)}" rx="${f(s * 0.2)}" fill="#fff3b0"/>` },
  creme: { tone: K.white, draw: (s) => circ(0, 0, s, K.white) + circ(0, 0, s * 0.78, '#eaf2f4') + line(`M${-s * 0.45},0 a${s * 0.45},${s * 0.45} 0 1 1 ${s * 0.45},${s * 0.45}`, K.blue, 2, 0.5) },
  coco: { tone: K.white, draw: (s) => circ(0, 0, s, K.brownDeep) + circ(0, 0, s * 0.8, K.white) + circ(0, 0, s * 0.4, '#f3ede0') },
  poulet: { tone: K.gold, draw: (s) => `<g transform="rotate(-20)">` + `<rect x="${f(s * 0.55)}" y="${f(-s * 0.13)}" width="${f(s * 0.95)}" height="${f(s * 0.26)}" rx="${f(s * 0.13)}" fill="${K.white}" stroke="${K.ink}" stroke-opacity=".3"/>` + circ(s * 1.5, -s * 0.15, s * 0.2, K.white) + circ(s * 1.5, s * 0.15, s * 0.2, K.white) + ell(-s * 0.35, 0, s * 1.0, s * 0.78, K.gold) + line(`M${-s * 1},${-s * 0.2} q${s * 0.6},${-s * 0.4} ${s * 1.2},${-s * 0.1}`, '#fff', 2, 0.45) + `</g>` },
  viande: { tone: K.brown, draw: (s, r, name) => has(name, /hache|boulette|burger/)
    ? circ(0, 0, s, K.brown) + [0, 1, 2, 3, 4, 5, 6].map((i) => circ(Math.cos(i * 2.1) * s * 0.55, Math.sin(i * 2.1) * s * 0.55, s * 0.12, K.brownDeep, 'opacity=".5"')).join('') + shine(-s * 0.35, -s * 0.35, s * 0.15)
    : path(`M${-s * 1.2},${s * 0.1} C${-s * 1.3},${-s * 0.6} ${-s * 0.3},${-s * 0.95} ${s * 0.5},${-s * 0.8} C${s * 1.3},${-s * 0.6} ${s * 1.4},${s * 0.2} ${s * 0.9},${s * 0.65} C${s * 0.2},${s * 1.0} ${-s * 0.8},${s * 0.9} ${-s * 1.2},${s * 0.1}z`, '#c4604a') + line(`M${-s * 0.7},${-s * 0.1} q${s * 0.5},${-s * 0.35} ${s * 1.1},${-s * 0.05} M${-s * 0.3},${s * 0.35} q${s * 0.5},${-s * 0.2} ${s * 0.9},${s * 0.05}`, '#fff', 1.8, 0.45) },
  porc: { tone: K.pink, draw: (s) => `<rect x="${f(-s * 1.15)}" y="${f(-s * 0.6)}" width="${f(s * 2.3)}" height="${f(s * 1.2)}" rx="${f(s * 0.5)}" fill="${K.pink}"/>` + line(`M${-s * 0.9},${-s * 0.2} H${s * 0.9} M${-s * 0.9},${s * 0.2} H${s * 0.9}`, '#fff', 2.2, 0.75) },
  saucisse: { tone: K.brown, draw: (s) => [[-0.5, -2], [0.45, 4]].map(([y, a]) => `<rect x="${f(-s * 1.15)}" y="${f(y * s - s * 0.35)}" width="${f(s * 2.3)}" height="${f(s * 0.7)}" rx="${f(s * 0.35)}" fill="${K.brown}" transform="rotate(${a} 0 ${f(y * s)})"/>` + line(`M${-s * 0.8},${f(y * s - s * 0.15)} H${s * 0.5}`, '#fff', 1.6, 0.4)).join('') },
  poisson: { tone: K.salmon, draw: (s, r, name) => { const c = has(name, /saumon/) ? K.salmon : has(name, /thon/) ? '#c4584a' : has(name, /sardine|maquereau|anchois/) ? '#7fa3b8' : '#e8dcc4'; return path(`M${s * 0.6},0 L${s * 1.45},${-s * 0.6} L${s * 1.45},${s * 0.6}z`, c) + ell(-s * 0.1, 0, s * 1.0, s * 0.62, c) + circ(-s * 0.7, -s * 0.1, s * 0.1, K.ink) + line(`M${-s * 0.2},${-s * 0.4} q${s * 0.3},${s * 0.4} 0,${s * 0.8}`, '#fff', 1.6, 0.5); } },
  crevette: { tone: K.salmon, draw: (s) => `<path d="M${-s * 0.9},${-s * 0.5} C${-s * 0.2},${-s * 1.3} ${s * 1.1},${-s * 0.6} ${s * 0.9},${s * 0.3} C${s * 0.8},${s * 0.8} ${s * 0.2},${s * 0.9} ${-s * 0.1},${s * 0.6}" fill="none" stroke="${K.salmon}" stroke-width="${f(s * 0.7)}" stroke-linecap="round"/>` + [0, 1, 2].map((i) => line(`M${f(-s * 0.2 + i * s * 0.4)},${f(-s * 0.95 + i * s * 0.1)} l${f(s * 0.1)},${f(s * 0.5)}`, '#fff', 1.4, 0.5)).join('') + circ(-s * 0.9, -s * 0.5, s * 0.08, K.ink) },
  pates: { tone: '#f2d48a', draw: (s) => [1, 0.8, 0.6, 0.4, 0.2].map((k, i) => circ(0, 0, s * k, 'none', `stroke="${i % 2 ? '#f2d48a' : '#e8bd5e'}" stroke-width="${f(s * 0.2)}" stroke-linecap="round"`)).join('') + circ(0, 0, s * 0.12, '#e8bd5e') },
  riz: { tone: K.white, draw: (s) => circ(0, 0, s, '#f6f1e6') + Array.from({ length: 16 }, (_, i) => ell(Math.cos(i * 2.4) * s * (0.15 + (i % 5) * 0.16), Math.sin(i * 2.4) * s * (0.15 + (i % 5) * 0.16), s * 0.2, s * 0.08, K.white, i * 37, `stroke="${K.ink}" stroke-opacity=".25" stroke-width=".7"`)).join('') },
  graines: { tone: K.beige, draw: (s) => circ(0, 0, s, K.beige) + Array.from({ length: 22 }, (_, i) => circ(Math.cos(i * 2.4) * s * (0.1 + (i % 6) * 0.14), Math.sin(i * 2.4) * s * (0.1 + (i % 6) * 0.14), s * 0.07, K.brown, 'opacity=".7"')).join('') },
  pain: { tone: K.gold, draw: (s) => ell(0, 0, s * 1.25, s * 0.6, K.gold, -20) + [-0.55, 0, 0.55].map((x) => line(`M${f(x * s - s * 0.15)},${f(-x * s * 0.35 - s * 0.35)} l${f(s * 0.3)},${f(s * 0.45)}`, K.brownDeep, 1.8, 0.5)).join('') },
  pate: { tone: K.beige, draw: (s) => circ(0, 0, s, '#ebd2a0') + circ(0, 0, s * 0.88, 'none', `stroke="${K.brown}" stroke-opacity=".5" stroke-width="2" stroke-dasharray="${f(s * 0.3)} ${f(s * 0.22)}"`) },
  noix: { tone: K.brown, draw: (s) => [[-0.4, -0.3], [0.5, 0.2]].map(([x, y]) => circ(x * s, y * s, s * 0.62, '#c9955a') + line(`M${f(x * s)},${f(y * s - s * 0.6)} q${f(s * 0.25)},${f(s * 0.6)} 0,${f(s * 1.2)}`, K.brownDeep, 1.5, 0.6)).join('') },
  chocolat: { tone: K.brownDeep, draw: (s) => `<rect x="${f(-s * 1.1)}" y="${f(-s * 0.7)}" width="${f(s * 2.2)}" height="${f(s * 1.4)}" rx="${f(s * 0.15)}" fill="#5a3320"/>` + line(`M${-s * 0.37},${-s * 0.7} V${s * 0.7} M${s * 0.37},${-s * 0.7} V${s * 0.7} M${-s * 1.1},0 H${s * 1.1}`, '#2e180e', 1.6, 0.9) },
  miel: { tone: K.gold, draw: (s) => path(`M0,${-s * 1.1} C${s * 0.5},${-s * 0.3} ${s * 0.9},${s * 0.1} ${s * 0.8},${s * 0.4} C${s * 0.7},${s * 0.9} ${-s * 0.7},${s * 0.9} ${-s * 0.8},${s * 0.4} C${-s * 0.9},${s * 0.1} ${-s * 0.5},${-s * 0.3} 0,${-s * 1.1}z`, '#e8a317') + shine(-s * 0.25, s * 0.15, s * 0.15) },
  farine: { tone: K.white, draw: (s) => circ(0, 0, s, '#f6f1e6') + Array.from({ length: 12 }, (_, i) => circ(Math.cos(i * 2.4) * s * 0.55, Math.sin(i * 2.4) * s * 0.55, s * 0.06, '#d8d0bd')).join('') },
  olive: { tone: K.greenDeep, draw: (s) => ell(-s * 0.4, -s * 0.2, s * 0.55, s * 0.4, '#6b8f3a', -20) + circ(-s * 0.1, -s * 0.35, s * 0.12, K.red) + ell(s * 0.45, s * 0.4, s * 0.55, s * 0.4, '#2e2a2a', 15) },
  epice: { tone: K.orange, draw: (s) => Array.from({ length: 10 }, (_, i) => circ(Math.cos(i * 2.4) * s * (0.2 + (i % 4) * 0.2), Math.sin(i * 2.4) * s * (0.2 + (i % 4) * 0.2), s * 0.13, [K.orange, K.red, K.yellow][i % 3])).join('') },
};

// Quand une recette n'a pas assez d'ingrédients reconnaissables : formes génériques selon le rayon.
const GENERIC = {
  'fruits-legumes': { tone: K.green, draw: (s) => leaf(0, s * 0.6, s * 1.5, s * 0.6, 0, K.green) },
  'viandes-poissons': ICONS.viande, cremerie: ICONS.creme, epicerie: ICONS.graines, 'epicerie-sucree': ICONS.miel,
  'condiments-epices': ICONS.epice, boulangerie: ICONS.pain, autre: { tone: K.yellow, draw: (s) => circ(0, 0, s * 0.7, K.yellow) },
};

const wrap = (inner) => `<g stroke="${K.ink}" stroke-opacity=".5" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">${inner}</g>`;
const at = (x, y, rot, inner) => `<g transform="translate(${f(x)} ${f(y)}) rotate(${Math.round(rot)})">${wrap(inner)}</g>`;

/** Contenu de l'assiette : liste de { icon, x, y, size, rot } + couleur du plat, d'après les ingrédients réels. */
export function composition(recette) {
  const r = rng(hash(recette.titre));
  const picks = pickIngredients(recette, 5);
  // Complète avec des formes génériques (d'après le rayon) si la recette est pauvre en ingrédients reconnaissables.
  const items = picks.map((p) => ({ ...p, def: ICONS[p.icon] }));
  for (const ing of recette.ingredients) {
    if (items.length >= 3) break;
    if (ing.basique || items.some((i) => i.generic === ing.rayon)) continue;
    const def = GENERIC[ing.rayon];
    if (def && !picks.some((p) => ICONS[p.icon] === def)) items.push({ icon: `~${ing.rayon}`, share: 0.1, name: ing.nom, def, generic: ing.rayon });
  }
  return { items, r, form: dishForm(recette) };
}

// Une illustration ne change que si la recette change : on ne la recalcule pas à chaque filtre ou chaque retour sur la liste.
const SVG_CACHE = new WeakMap();
const cachedSvg = (recette) => {
  let svg = SVG_CACHE.get(recette);
  if (!svg) SVG_CACHE.set(recette, (svg = plateSvg(recette)));
  return svg;
};

/** SVG (chaîne) de l'assiette d'une recette. */
export function plateSvg(recette) {
  const { items, r, form } = composition(recette);
  const cx = 100, cy = 62;
  const hero = items[0];
  const rest = items.slice(1);
  const offset = r() * 360;
  let scene = '';

  if (form === 'pie') {
    // Fond de la tarte : sauce tomate si la recette en contient beaucoup, sinon l'appareil (œuf, crème) ou le fruit dominant.
    const tomato = items.find((i) => i.icon === 'tomate' && i.share > 0.2);
    const custard = items.some((i) => ['oeuf', 'creme'].includes(i.icon)) && !items.some((i) => ['pomme', 'poire', 'baies', 'fruit'].includes(i.icon));
    const base = tomato ? K.red : custard ? '#f6df8a' : hero?.def?.tone ?? K.beige;
    const tone = base === K.white ? '#f6ecd0' : base;
    scene += circ(cx, cy, 40, K.gold, `stroke="${K.ink}" stroke-width="2"`) + circ(cx, cy, 38.5, 'none', `stroke="#c78530" stroke-width="3.2" stroke-dasharray="5 3.6"`) + circ(cx, cy, 31, tone, 'opacity=".95"');
    const toppings = items.filter((i) => i.icon !== 'pate' && !(tomato && i === tomato));
    const star = toppings[0];
    if (star && star.share > 0.3 && ['pomme', 'poire', 'baies', 'fruit', 'citron', 'champignon', 'courgette', 'tomate', 'oignon', 'poireau'].includes(star.icon)) {
      // Une tarte aux pommes se dessine en rosace de pommes.
      for (let i = 0; i < 7; i++) { const ang = ((offset + i * 51.4) * Math.PI) / 180; scene += at(cx + Math.cos(ang) * 18, cy + Math.sin(ang) * 18, offset + i * 51.4 + 90, (star.def.slice ?? star.def.draw)(9.5, r, star.name)); }
      toppings.slice(1, 3).forEach((it, i) => { scene += at(cx + (i ? 3 : -3), cy + (i ? 3 : -3), r() * 360, it.def.draw(5.5, r, it.name)); });
    } else {
      toppings.slice(0, 4).forEach((it, i) => {
        const ang = ((offset + i * 90 + 45) * Math.PI) / 180, rad = i === 0 && toppings.length > 1 ? 0 : 17;
        scene += at(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, r() * 360, it.def.draw(i === 0 ? 11 : 8, r, it.name));
      });
    }
  } else if (form === 'stack') {
    // Crêpes : une pile de disques dorés, une noix de beurre, et la garniture sucrée si la recette en a.
    [[-3, 5], [2, 1], [-1, -4]].forEach(([dx, dy], i) => { scene += circ(cx + dx, cy + dy, 33, i === 2 ? '#f0c777' : K.gold, `stroke="${K.ink}" stroke-opacity=".6" stroke-width="1.6"`); });
    scene += circ(cx - 1, cy - 4, 26, '#f6d68f', 'opacity=".9"') + [[-10, -12], [8, -8], [-4, 6], [12, 7], [-14, 4]].map(([x, y]) => circ(cx + x, cy + y, 2.2, '#d8963a', 'opacity=".55"')).join('');
    const garnish = items.filter((i) => ['miel', 'citron', 'baies', 'banane', 'chocolat', 'fruit', 'pomme', 'beurre'].includes(i.icon)).slice(0, 2);
    garnish.forEach((it, i) => { scene += at(cx - 1 + (i ? 12 : -9), cy - 4 + (i ? 6 : -4), r() * 60, it.def.draw(7.5, r, it.name)); });
    if (!garnish.some((g) => g.icon === 'beurre')) scene += at(cx + 2, cy - 7, -8, ICONS.beurre.draw(6, r));
  } else if (form === 'bowl') {
    const tone = hero?.def?.tone && hero.icon !== 'creme' ? hero.def.tone : K.orange;
    scene += circ(cx, cy, 43, K.white, `stroke="${K.ink}" stroke-width="2.2"`) + circ(cx, cy, 35, tone, 'opacity=".85"') + circ(cx, cy, 35, 'none', `stroke="${K.ink}" stroke-opacity=".25" stroke-width="2"`) + `<path d="M${cx - 22},${cy - 8} q10,-9 20,0 t20,0" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2.2" stroke-linecap="round"/>`;
    items.slice(1, 4).forEach((it, i) => {
      const ang = ((offset + i * 120) * Math.PI) / 180;
      scene += at(cx + Math.cos(ang) * 17, cy + Math.sin(ang) * 15 + 4, r() * 360, it.def.draw(7.5, r, it.name));
    });
  } else {
    // Assiette : l'ingrédient dominant au centre, les autres en couronne, leur taille suit leur importance.
    rest.forEach((it, i) => {
      const ang = ((offset + (i * 360) / Math.max(rest.length, 1) + r() * 24) * Math.PI) / 180;
      const rad = 27 + r() * 4;
      scene += at(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, r() * 360, it.def.draw(8 + Math.sqrt(it.share) * 9, r, it.name));
    });
    if (hero) scene += at(cx - 1, cy + 1, r() * 50 - 25, hero.def.draw(14 + Math.sqrt(hero.share) * 8, r, hero.name));
  }

  const confetti = Array.from({ length: 14 }, () => {
    const x = r() * 200, y = r() * 124;
    return Math.hypot(x - cx, y - cy) > 58 ? circ(x, y, 1.2 + r() * 2.2, 'var(--t)', `opacity="${f(0.25 + r() * 0.35)}"`) : '';
  }).join('');
  const fork = `<g transform="translate(26 62)" fill="${K.ink}" opacity=".85"><rect x="-1.6" y="-4" width="3.2" height="38" rx="1.6"/><rect x="-7" y="-30" width="2.6" height="26" rx="1.3"/><rect x="-1.3" y="-30" width="2.6" height="26" rx="1.3"/><rect x="4.4" y="-30" width="2.6" height="26" rx="1.3"/><rect x="-7" y="-8" width="14" height="6" rx="3"/></g>`;
  const knife = `<g transform="translate(174 62)" fill="${K.ink}" opacity=".85"><rect x="-1.6" y="-2" width="3.2" height="36" rx="1.6"/><path d="M-1,-34 C9,-30 9,-6 -1,-2z"/></g>`;
  return `<svg viewBox="0 0 200 124" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<rect width="200" height="124" style="fill:var(--p,var(--t-soft))"/>${confetti}${fork}${knife}
<circle cx="${cx}" cy="${cy + 3}" r="52" fill="${K.ink}" opacity=".12"/>
<circle cx="${cx}" cy="${cy}" r="51" fill="${K.cream}" stroke="${K.ink}" stroke-width="2.5"/>
<circle cx="${cx}" cy="${cy}" r="${form === 'plate' ? 44 : 47}" fill="none" stroke="${K.ink}" stroke-opacity=".12" stroke-width="2"/>${scene}</svg>`;
}

/** Texte d'accessibilité : ce que montre l'illustration. */
export function describePlate(recette) {
  const names = composition(recette).items.filter((i) => !i.generic).map((i) => i.name.toLowerCase());
  return names.length ? `Illustration : ${names.join(', ')}` : '';
}

/**
 * Élément illustré. `data-type` fournit les couleurs (--t, --t-soft) définies en CSS.
 * @param {object} recette
 * @param {{className?:string, fit?:'meet'|'slice'}} [o]
 */
export function plate(recette, { className = '', fit } = {}) {
  const el = h('span', { class: `plate ${className}`, 'data-type': recette.type, 'data-tint': tintOf(recette), role: 'img', 'aria-label': describePlate(recette) || undefined });
  el.innerHTML = cachedSvg(recette);
  // Bannière large : assiette entière (« meet »). Pastille ou héros : on zoome sur l'assiette (« slice »).
  const slice = (fit ?? (className.includes('avatar') ? 'slice' : 'meet')) === 'slice';
  el.firstElementChild.setAttribute('preserveAspectRatio', slice ? 'xMidYMid slice' : 'xMidYMid meet');
  return el;
}

/** Assiette « de bienvenue » pour les écrans vides. */
export function emptyPlate() {
  const ing = ['tomate', 'oeuf', 'feuilles', 'carotte', 'pain'].map((nom) => ({ nom, quantite: 1, rayon: 'autre' }));
  return plate({ titre: 'Bienvenue', type: 'plat', ingredients: ing }, { className: 'empty-art' });
}

/** Teinte de fond propre à la recette (0–5) : varie la grille indépendamment du type de plat. */
export const tintOf = (recette) => hash(`${recette.titre}#`) % 6;
