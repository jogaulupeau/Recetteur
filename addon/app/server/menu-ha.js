// Publie dans Home Assistant le menu DU JOUR, sous forme de deux capteurs : midi et soir.
//
// Les capteurs sont écrits par l'API REST (POST /states/<entity>) : ils n'ont pas d'identifiant unique, n'apparaissent pas dans le
// registre des entités et ne survivent pas à un redémarrage de Home Assistant. C'est pourquoi l'app les republie au démarrage, à
// chaque changement du menu ou d'une recette, au changement de jour, et au moins toutes les 10 minutes.
import { totalTime } from '../shared/recipe.js';
import { today } from '../shared/dates.js';

export const ENTITIES = { midi: 'sensor.recetteur_menu_midi', soir: 'sensor.recetteur_menu_soir' };
export const EMPTY = 'Rien de prévu';
const META = {
  midi: { nom: 'Menu du midi', icon: 'mdi:white-balance-sunny' },
  soir: { nom: 'Menu du soir', icon: 'mdi:weather-night' },
};
const MAX_STATE = 255; // limite de Home Assistant pour l'état d'une entité

/**
 * Liens vers l'app dans Home Assistant. `base` : chemin du panneau de l'app (« /<slug> » : Home Assistant enregistre le panneau de chaque app sous son identifiant, voir components/hassio/addon_panel.py ; ou la valeur de l'option
 * `ha_lien_base`). L'ingress ne transmet pas de chemin : la page voulue est dans le fragment (#/…), que l'app lit dans l'adresse
 * de la page parente (voir public/js/deeplink.js). Sans `base`, aucun lien n'est publié.
 */
export function links(base) {
  if (!base) return null;
  const b = String(base).replace(/\/+$/, '');
  return {
    app: b,
    recette: (id) => `${b}#/recette/${encodeURIComponent(id)}`,
    cuisine: (id, personnes, repas) => `${b}#/recette/${encodeURIComponent(id)}/cuisiner?p=${Number(personnes) || 4}&repas=${Number(repas) || 0}`,
  };
}

/** États et attributs des deux capteurs pour un jour donné (AAAA-MM-JJ). */
export function snapshot({ menu, recettes, date, linkBase = null }) {
  const L = links(linkBase);
  const out = {};
  for (const slot of Object.keys(ENTITIES)) {
    const meals = menu.data.repas
      .filter((r) => r.date === date && r.slot === slot)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    const items = meals.map((m) => {
      const r = Object.hasOwn(recettes.data.recettes, m.recipeId) ? recettes.data.recettes[m.recipeId].recette : null;
      const item = { id: m.recipeId, titre: r?.titre ?? 'Recette supprimée', personnes: m.servings, duree_minutes: r ? totalTime(r) : 0, fait: !!m.fait };
      if (L && r) { item.lien = L.recette(m.recipeId); item.lien_cuisine = L.cuisine(m.recipeId, m.servings, m.id); }
      return item;
    });
    let state = items.length ? items.map((i) => i.titre).join(' + ') : EMPTY;
    if (state.length > MAX_STATE) state = `${state.slice(0, MAX_STATE - 1)}…`;
    out[slot] = {
      entity: ENTITIES[slot],
      state,
      attributes: {
        friendly_name: META[slot].nom,
        icon: META[slot].icon,
        date,
        repas: slot,
        nombre: items.length,
        titres: items.map((i) => i.titre),
        recettes: items,
        ...(L ? { lien_app: L.app } : {}),
      },
    };
  }
  return out;
}

/**
 * @param {object} o
 * @param {{ setState: Function }} o.ha
 * @param {boolean} o.enabled  faux hors Home Assistant ou si l'option est désactivée : tout est inerte
 * @param {number} [o.debounceMs]  regroupe les modifications rapprochées (ajouter 7 repas = une seule écriture)
 */
export function createMenuPublisher({ ha, menu, recettes, log, enabled, linkBase = '', debounceMs = 1000, refreshMs = 10 * 60_000, tickMs = 60_000, getToday = today }) {
  let started = false;
  let lastDate = null;
  let lastPush = 0;
  let failing = false;
  let debounce = null;
  let ticker = null;
  let chain = Promise.resolve();

  // Chemin de l'app dans Home Assistant : option `ha_lien_base`, sinon « /<slug> » d'après le Supervisor (mémorisé).
  let base = linkBase || null;
  async function resolveBase() {
    if (base) return base;
    try {
      base = `/${await ha.selfSlug()}`;
    } catch (e) {
      if (!slugFailed) log.info(`Capteurs du menu : liens vers l'app non publiés (${e.message}). Renseignez l'option « ha_lien_base » pour les activer.`);
      slugFailed = true;
    }
    return base;
  }
  let slugFailed = false;

  async function push(date) {
    try {
      const b = await resolveBase();
      for (const s of Object.values(snapshot({ menu, recettes, date, linkBase: b }))) await ha.setState(s.entity, s.state, s.attributes);
      lastDate = date;
      lastPush = Date.now();
      if (failing) log.info('Capteurs du menu : Home Assistant répond de nouveau, capteurs republiés.');
      failing = false;
      return true;
    } catch (e) {
      // On ne journalise que le premier échec : Home Assistant peut démarrer après l'app, l'essai suivant réussira.
      if (!failing) log.error(`Capteurs du menu : écriture dans Home Assistant impossible (${e.message}). Nouvel essai dans quelques minutes.`);
      failing = true;
      return false;
    }
  }

  /** Publie maintenant (écritures mises en file : jamais deux publications en même temps). */
  function publish(date = getToday()) {
    if (!enabled) return Promise.resolve(false);
    chain = chain.then(() => push(date));
    return chain;
  }

  /** À appeler après toute modification du menu ou des recettes. Sans effet tant que `start()` n'a pas été appelé. */
  function schedule() {
    if (!enabled || !started) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => { publish(); }, debounceMs);
    debounce.unref?.();
  }

  function start() {
    if (!enabled || started) return;
    started = true;
    log.info(`Capteurs du menu du jour : ${ENTITIES.midi} et ${ENTITIES.soir}.`);
    publish();
    ticker = setInterval(() => {
      if (getToday() !== lastDate || Date.now() - lastPush >= refreshMs) publish();
    }, tickMs);
    ticker.unref?.();
  }

  function stop() {
    started = false;
    clearTimeout(debounce);
    clearInterval(ticker);
  }

  return { enabled, start, stop, publish, schedule, snapshot: (date = getToday()) => snapshot({ menu, recettes, date }) };
}
