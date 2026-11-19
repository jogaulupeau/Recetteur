// Lien profond depuis Home Assistant. L'ingress n'accepte pas de chemin : une carte du tableau de bord pointe vers
// « /hassio/ingress/<app>#/recette/<id> ». Le fragment reste dans l'adresse de la page PARENTE (l'interface de Home Assistant), que
// l'app, chargée dans un iframe de même origine, peut lire. Seules les pages « recette » et « cuisiner » sont reprises.
const ALLOWED = /^#\/recette\/[^/?#\s]+(?:\/cuisiner(?:\?[A-Za-z0-9_=&-]*)?)?$/;

/** Le fragment s'il désigne une page autorisée, sinon null. */
export const deepLink = (hash) => (typeof hash === 'string' && hash.length <= 300 && ALLOWED.test(hash) ? hash : null);

/** À appeler au démarrage : si l'app est ouverte sans page précise dans un iframe, reprend celle du fragment parent. */
export function adoptParentHash(win = window) {
  try {
    if (win.parent === win || win.location.hash.replace('#', '').replace('/', '')) return false;
    const link = deepLink(win.parent.location.hash);
    if (!link) return false;
    win.location.hash = link;
    return true;
  } catch {
    return false; // page parente d'une autre origine : rien à reprendre
  }
}
