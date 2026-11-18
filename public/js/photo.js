// Photos de recettes : choix du fichier, redimensionnement dans le navigateur, envoi, affichage.
// Une photo de téléphone (5–10 Mo) devient ≈ 300 Ko (1500 px) + une vignette ≈ 30 Ko (520 px) pour les listes.
// Le ré-encodage par canvas supprime aussi les métadonnées EXIF (dont la position GPS).
import { api } from './api.js';
import { h, icon, toast, fill } from './dom.js';
import { patchEntry } from './state.js';
import { plate } from './art.js';

const BASE = new URL('../api/', import.meta.url);

/** URL de la photo (ou null). `v` change à chaque envoi : l'URL est mise en cache à vie par le navigateur. */
export function photoUrl(e, { thumb = false } = {}) {
  if (!e.photo?.full) return null;
  return new URL(`recettes/${encodeURIComponent(e.id)}/photo?v=${e.photo.v}${thumb && e.photo.thumb ? '&t=vignette' : ''}`, BASE).href;
}

/**
 * Élément visuel d'une recette : sa photo si elle en a une, sinon l'image indiquée dans la recette (`image`),
 * sinon l'assiette illustrée. Si l'image ne se charge pas, on retombe sur l'illustration.
 */
export function visual(e, { className = '', fit, thumb = true } = {}) {
  // `image` : seules les adresses http(s) sont affichées (le serveur le garantit aussi, mais d'anciennes données ont pu être enregistrées avant).
  const src = photoUrl(e, { thumb }) ?? (/^https?:\/\//i.test(e.recette.image ?? '') ? e.recette.image : null);
  if (!src) return plate(e.recette, { className, fit });
  const img = h('img', { class: `${className} photo`.trim(), src, alt: '', loading: 'lazy', decoding: 'async', onerror: () => img.replaceWith(plate(e.recette, { className, fit })) });
  return img;
}

// ---------------------------------------------------------------- traitement de l'image
async function decode(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* on retente avec <img> */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => (URL.revokeObjectURL(url), resolve(img));
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('Image illisible. Les photos HEIC ne sont pas lues par tous les navigateurs : essayez un JPEG ou PNG.')));
    img.src = url;
  });
}

function toJpeg(src, maxSide, quality) {
  const w0 = src.width ?? src.naturalWidth, h0 = src.height ?? src.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w0 * k));
  canvas.height = Math.max(1, Math.round(h0 * k));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // les PNG transparents deviennent blancs plutôt que noirs
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Compression de l’image impossible.'))), 'image/jpeg', quality));
}

/** Redimensionne et envoie (vignette d'abord, puis version complète). Met `e` à jour sur place. */
export async function uploadPhoto(e, file) {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error('Ce fichier n’est pas une image.');
  const src = await decode(file);
  const [thumb, full] = [await toJpeg(src, 520, 0.8), await toJpeg(src, 1500, 0.85)];
  src.close?.();
  await api.putRaw(`recettes/${encodeURIComponent(e.id)}/photo?t=vignette`, thumb);
  const updated = await api.putRaw(`recettes/${encodeURIComponent(e.id)}/photo`, full);
  Object.assign(e, updated);
  return patchEntry(e);
}

export async function removePhoto(e) {
  Object.assign(e, await api.del(`recettes/${encodeURIComponent(e.id)}/photo`));
  return patchEntry(e);
}

/** Ouvre le sélecteur de fichier (sur mobile : appareil photo ou galerie, au choix de l'utilisateur). */
export function pickPhoto() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
    const done = (f) => (input.remove(), resolve(f));
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.append(input);
    input.click();
  });
}

/** Envoi avec retour à l'utilisateur ; `onChange` est rappelé après succès. */
export async function sendPhoto(e, file, onChange) {
  try {
    await uploadPhoto(e, file);
    toast('Photo enregistrée. 📸', { type: 'ok' });
    onChange?.();
  } catch (err) {
    toast(err.message, { type: 'error', ms: 7000 });
  }
}

/** Boutons « Ajouter / Changer / Retirer la photo » d'une recette. */
export function photoActions(e, { onChange, size = 'sm' } = {}) {
  const box = h('div', { class: 'photo-actions' });
  const draw = () => {
    const has = !!e.photo?.full;
    fill(box,
      h('button', { class: `btn ${size}`, type: 'button', onclick: async (ev) => {
        const btn = ev.currentTarget;
        const file = await pickPhoto();
        if (!file) return;
        btn.disabled = true;
        box.closest('.hero-media')?.classList.add('busy');
        await sendPhoto(e, file, onChange);
        box.closest('.hero-media')?.classList.remove('busy');
        draw();
      } }, icon('camera', 16), has ? 'Changer la photo' : 'Ajouter une photo'),
      has ? h('button', { class: `btn ${size} ghost`, type: 'button', onclick: async () => {
        await removePhoto(e);
        toast('Photo retirée.');
        onChange?.();
        draw();
      } }, icon('trash', 16), 'Retirer') : null);
  };
  draw();
  return box;
}
