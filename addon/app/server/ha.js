// Appels à l'API Home Assistant depuis l'app (jeton fourni par le Supervisor).
// Hors Home Assistant (pas de jeton), tout est désactivé proprement.

export class HaError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {object} o
 * @param {string|null} o.token   SUPERVISOR_TOKEN
 * @param {string} o.base         http://supervisor/core/api
 * @param {typeof fetch} o.fetch
 * @param {{alerte_media_player?:string, alerte_voix?:string, alerte_son?:string}} o.cfg
 */
export function createHa({ token, base, fetch: doFetch, cfg }) {
  /** Appelle un service : call('todo/add_item', { entity_id, item }). */
  async function call(service, data) {
    const res = await doFetch(`${base}/services/${service}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  /** « voix » (annonce parlée via une entité TTS), « son » (fichier audio), ou null si rien n'est configuré. */
  const alertMode = () => {
    if (!token || !cfg.alerte_media_player) return null;
    if (cfg.alerte_voix) return 'voix';
    if (cfg.alerte_son) return 'son';
    return null;
  };

  /** Joue l'alerte sur le lecteur multimédia configuré. `message` n'est lu qu'en mode voix. */
  async function announce(message) {
    if (!token) throw new HaError('Disponible uniquement lorsque l’app tourne dans Home Assistant.', 501);
    const mode = alertMode();
    if (!cfg.alerte_media_player) throw new HaError('Aucun lecteur configuré : renseignez l’option « alerte_media_player ».', 400);
    if (!mode) throw new HaError('Renseignez « alerte_voix » (entité tts.…) ou « alerte_son » (fichier audio) dans les options.', 400);
    try {
      if (mode === 'voix') {
        await call('tts/speak', { entity_id: cfg.alerte_voix, media_player_entity_id: cfg.alerte_media_player, message });
      } else {
        await call('media_player/play_media', {
          entity_id: cfg.alerte_media_player,
          media_content_id: cfg.alerte_son,
          media_content_type: 'music',
          announce: true,
        });
      }
    } catch (e) {
      const cible = mode === 'voix' ? `${cfg.alerte_voix} → ${cfg.alerte_media_player}` : cfg.alerte_media_player;
      throw new HaError(`Home Assistant a refusé l’alerte (${e.message}). Vérifiez que « ${cible} » existe.`);
    }
    return mode;
  }

  return { available: !!token, call, alertMode, announce };
}
