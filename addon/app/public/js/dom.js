// Mini-bibliothèque DOM : pas de framework, pas d'étape de build.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'innerHTML' || k === 'outerHTML') continue; // jamais de HTML brut depuis h() : le texte passe toujours par des nœuds texte
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && !k.includes('-') && k !== 'list' && k !== 'role') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const clear = (el) => (el.replaceChildren(), el);
/** Remplace le contenu : ignore null/false et aplatit les tableaux (contrairement à replaceChildren natif). */
export const fill = (el, ...kids) => append(clear(el), kids);

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  book: 'M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z M8 8h7 M8 12h7',
  calendar: 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M16 2v4 M8 2v4 M3 10h18',
  cart: 'M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 7H6 M9 20.5a1 1 0 1 0 2 0 1 1 0 1 0-2 0 M16 20.5a1 1 0 1 0 2 0 1 1 0 1 0-2 0',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12 M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-4.3-4.3',
  heart: 'M12 20.5S4 15.5 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 6-8 11-8 11z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14 M16 5v14',
  shuffle: 'M16 3h5v5 M4 20 21 3 M21 16v5h-5 M15 15l6 6 M4 4l5 5',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z M14 6l4 4',
  copy: 'M9 9h11v11H9z M5 15V4h11',
  share: 'M12 3v12 M7 8l5-5 5 5 M5 14v6h14v-6',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 9v4l2 2 M9 2h6',
  refresh: 'M20 11a8 8 0 0 0-14-4L4 9 M4 4v5h5 M4 13a8 8 0 0 0 14 4l2-2 M20 20v-5h-5',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  ha: 'M3 11.5 12 4l9 7.5 M5.5 10v10h13V10 M12 20v-5',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};

export function icon(name, size = 20) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  for (const d of (ICONS[name] ?? '').split(' M').map((x, i) => (i ? 'M' + x : x))) {
    if (!d) continue;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// ---------------------------------------------------------------- toasts
let toastBox;
export function toast(message, { type = 'info', ms = 3500 } = {}) {
  toastBox ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast ${type}` }, message);
  toastBox.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------------------------------------------------------- modales
/**
 * @returns {{ close: (value?:any)=>void, el: HTMLDialogElement, done: Promise<any> }}
 */
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const dlg = h('dialog', { class: `modal ${wide ? 'wide' : ''}` });
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const close = (v) => {
    if (dlg.open) dlg.close();
    dlg.remove();
    onClose?.();
    resolve(v);
  };
  dlg.addEventListener('cancel', (e) => (e.preventDefault(), close(undefined)));
  dlg.addEventListener('click', (e) => e.target === dlg && close(undefined));
  append(dlg, [
    h('header', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', title: 'Fermer', 'aria-label': 'Fermer', onclick: () => close(undefined) }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('footer', { class: 'modal-foot' }, actions) : null,
  ]);
  document.body.append(dlg);
  dlg.showModal();
  return { close, el: dlg, done };
}

export function confirmDialog(message, { ok = 'Confirmer', danger = false, title = 'Confirmation' } = {}) {
  let m;
  m = modal({
    title,
    body: h('p', {}, message),
    actions: [
      h('button', { class: 'btn', onclick: () => m.close(false) }, 'Annuler'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => m.close(true) }, ok),
    ],
  });
  return m.done.then(Boolean);
}

// ---------------------------------------------------------------- composants
export function stepper(value, onChange, { min = 1, max = 100, label = 'personnes', unit } = {}) {
  const out = h('output', { class: 'stepper-val' });
  const render = () => {
    out.textContent = `${value}`;
    minus.disabled = value <= min;
    plus.disabled = value >= max;
  };
  const set = (v) => {
    value = Math.min(max, Math.max(min, v));
    render();
    onChange(value);
  };
  const minus = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Moins de ${label}`, onclick: () => set(value - 1) }, icon('minus', 18));
  const plus = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Plus de ${label}`, onclick: () => set(value + 1) }, icon('plus', 18));
  render();
  return h('div', { class: 'stepper' }, minus, out, h('span', { class: 'stepper-unit' }, unit ?? label), plus);
}

export const stars = (n, onPick) =>
  h('div', { class: 'stars', role: 'group', 'aria-label': 'Note' },
    [1, 2, 3, 4, 5].map((i) =>
      h('button', { type: 'button', class: `star ${i <= n ? 'on' : ''}`, 'aria-label': `${i} étoile${i > 1 ? 's' : ''}`, onclick: () => onPick(i === n ? 0 : i) }, icon('star', 20))));

export function empty(titre, texte, ...actions) {
  return h('div', { class: 'empty card' }, h('h3', {}, titre), texte && h('p', { class: 'muted' }, texte), actions.length && h('div', { class: 'row center' }, actions));
}

export const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => (clearTimeout(t), (t = setTimeout(() => fn(...a), ms)));
};
