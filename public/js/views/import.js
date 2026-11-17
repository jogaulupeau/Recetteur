import { h, icon, toast, fill } from '../dom.js';
import { api } from '../api.js';
import { reloadRecettes } from '../state.js';
import { loadExamples } from '../cards.js';
import { extractJson } from '../../shared/import.js';

const PROMPT = `Utilise le skill « recettes-recetteur » pour mettre cette recette au format Recetteur (JSON), puis donne-moi le JSON à copier :

[colle ici ta recette, ou décris ce que tu veux cuisiner]`;

export function render({ root }) {
  const text = h('textarea', { rows: 10, class: 'code', placeholder: 'Collez ici le JSON produit par Claude (les ```json … ``` autour sont acceptés).', 'aria-label': 'JSON des recettes', spellcheck: false });
  const files = h('input', { type: 'file', accept: '.json,application/json,.txt', multiple: true, class: 'sr-only', id: 'file-in' });
  const drop = h('label', { class: 'dropzone', for: 'file-in' }, icon('upload', 22), h('div', {}, 'Déposez un ou plusieurs fichiers .json ici, ou cliquez pour les choisir'));
  const out = h('div', { class: 'stack' });
  const modeSel = h('select', { 'aria-label': 'Si la recette existe déjà' },
    [['ignorer', 'Si elle existe déjà : l’ignorer'], ['remplacer', 'Si elle existe déjà : la remplacer'], ['dupliquer', 'Si elle existe déjà : en faire une copie']].map(([v, l]) => h('option', { value: v }, l)));
  let payload = null;

  async function readFiles(list) {
    const parts = [];
    for (const f of list) {
      try { parts.push(extractJson(await f.text())); } catch (e) { toast(`${f.name} : ${e.message}`, { type: 'error', ms: 6000 }); }
    }
    if (!parts.length) return;
    text.value = JSON.stringify(parts.length === 1 ? parts[0] : parts.flatMap((p) => (Array.isArray(p) ? p : p.recettes ?? [p])), null, 2);
    analyse();
  }
  files.addEventListener('change', () => readFiles([...files.files]));
  drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles([...e.dataTransfer.files]); });

  async function analyse() {
    out.replaceChildren();
    payload = null;
    try {
      payload = extractJson(text.value);
    } catch (e) {
      out.append(h('div', { class: 'status bad' }, h('strong', {}, 'Lecture impossible'), h('span', {}, e.message)));
      return;
    }
    try {
      const res = await api.post(`import?apercu=1&mode=${modeSel.value}`, payload);
      drawPreview(res);
    } catch (e) {
      out.append(h('div', { class: 'status bad' }, h('strong', {}, 'Erreur'), h('span', {}, e.message)));
    }
  }

  const BADGE = { nouveau: ['Nouvelle', 'ok'], ignore: ['Déjà présente', 'warn'], remplace: ['Remplacera l’existante', 'warn'], invalide: ['Invalide', 'danger'] };
  function drawPreview(res) {
    const { resume } = res;
    const importable = resume.nouveaux + resume.remplaces;
    fill(out, 
      h('h2', { style: { margin: 0 } }, 'Aperçu'),
      h('div', { class: 'statuses' }, res.resultats.map((r) => {
        const [label, kind] = BADGE[r.statut];
        return h('div', { class: `status ${r.statut === 'invalide' ? 'bad' : ''}` },
          h('div', { class: 'row between' }, h('strong', {}, r.titre ?? `Recette n°${r.index + 1}`), h('span', { class: `badge ${kind}` }, label)),
          r.erreurs.length || r.avertissements.length ? h('ul', {}, r.erreurs.map((x) => h('li', { class: 'err' }, x)), r.avertissements.map((x) => h('li', { class: 'warn' }, x))) : null);
      })),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', disabled: !importable, onclick: doImport }, icon('check', 18), importable ? `Importer ${importable} recette${importable > 1 ? 's' : ''}` : 'Rien à importer'),
        resume.invalides ? h('span', { class: 'small muted' }, `${resume.invalides} invalide(s) seront ignorée(s).`) : null));
  }

  async function doImport() {
    try {
      const res = await api.post(`import?mode=${modeSel.value}`, payload);
      await reloadRecettes();
      const n = res.resume.nouveaux + res.resume.remplaces;
      toast(`${n} recette${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}.`, { type: 'ok' });
      const first = res.resultats.find((r) => r.id);
      location.hash = n === 1 && first ? `#/recette/${encodeURIComponent(first.id)}` : '#/recettes';
    } catch (e) {
      toast(e.message, { type: 'error' });
    }
  }

  modeSel.addEventListener('change', () => payload && analyse());
  root.append(
    h('a', { class: 'btn ghost sm', href: '#/recettes' }, icon('left', 16), 'Recettes'),
    h('div', { class: 'page-head' }, h('h1', {}, 'Ajouter des recettes')),
    h('div', { class: 'stack' },
      h('section', { class: 'card stack' },
        h('h2', { style: { margin: 0 } }, 'Importer du JSON'),
        text, drop, files,
        h('div', { class: 'row' }, modeSel, h('button', { class: 'btn primary', onclick: analyse }, 'Analyser'))),
      out,
      h('section', { class: 'card stack' },
        h('h2', { style: { margin: 0 } }, 'Créer des recettes avec Claude'),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Installez le skill « recettes-recetteur » (dossier skill/ du dépôt) dans Claude, puis demandez une recette comme d’habitude : Claude répond avec un JSON au bon format, à coller ci-dessus. Vous pouvez aussi demander plusieurs recettes d’un coup.'),
        h('pre', { class: 'code card flat', style: { margin: 0, overflow: 'auto' } }, PROMPT),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: async () => { await navigator.clipboard.writeText(PROMPT); toast('Texte copié.', { type: 'ok' }); } }, icon('copy', 16), 'Copier le message'),
          h('button', { class: 'btn sm', onclick: async (ev) => { ev.currentTarget.disabled = true; await loadExamples(); location.hash = '#/recettes'; } }, 'Charger 5 recettes d’exemple')))));
}
