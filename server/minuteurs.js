// Minuteurs côté serveur : ils survivent au rechargement de la page, se partagent entre appareils
// (téléphone, tablette) et peuvent déclencher une alerte sur un lecteur multimédia Home Assistant
// même si plus aucun navigateur n'est ouvert.
import crypto from 'node:crypto';

const MAX_SECONDES = 24 * 3600;
const MAX_MINUTEURS = 50;
const GARDE_SONNERIE_MS = 30 * 60 * 1000; // une sonnerie non acquittée disparaît après 30 min
const RATTRAPAGE_MS = 5 * 60 * 1000; // au redémarrage, on sonne encore un minuteur échu depuis moins de 5 min

/**
 * @param {object} o
 * @param {{data:{minuteurs:object[]}, save:()=>void}} o.store
 * @param {(id:string)=>string|undefined} o.titreRecette
 * @param {{alertMode:()=>string|null, announce:(m:string)=>Promise<string>}} o.ha
 * @param {{info:Function, error:Function}} o.log
 * @param {()=>number} [o.now]
 */
export function createTimers({ store, titreRecette, ha, log, now = Date.now }) {
  const handles = new Map();
  const all = () => store.data.minuteurs;
  const find = (id) => all().find((t) => t.id === id);

  // Appelée depuis des minuteries : une erreur disque (plein, droits) est journalisée, jamais propagée.
  function safeSave() {
    try {
      store.save();
    } catch (e) {
      log.error(`Écriture des minuteurs impossible : ${e.message}`);
    }
  }

  function arm(t) {
    clearTimeout(handles.get(t.id));
    handles.delete(t.id);
    if (t.etat !== 'en_cours') return;
    const delay = Math.max(0, t.fin - now());
    // setTimeout plafonne à ~24,8 jours ; nos minuteurs durent 24 h au plus.
    const h = setTimeout(() => ring(t.id), delay);
    h.unref?.();
    handles.set(t.id, h);
  }

  const message = (t) => `Minuteur terminé : ${t.libelle}${t.recette_titre && !t.libelle.includes(t.recette_titre) ? `, ${t.recette_titre}` : ''}.`;

  async function ring(id, { alert = true } = {}) {
    const t = find(id);
    if (!t || t.etat !== 'en_cours') return;
    t.etat = 'sonne';
    t.fin = Math.min(t.fin, now());
    t.sonne_a = now();
    safeSave();
    log.info(`Minuteur terminé : ${t.libelle}`);
    if (t.alerte && alert && ha.alertMode()) {
      try {
        t.alerte_envoyee = await ha.announce(message(t));
      } catch (e) {
        t.alerte_erreur = e.message;
        log.error(`Alerte du minuteur « ${t.libelle} » : ${e.message}`);
      }
      safeSave();
    }
  }

  function purge() {
    const limite = now() - GARDE_SONNERIE_MS;
    const keep = all().filter((t) => !(t.etat === 'sonne' && t.sonne_a < limite));
    if (keep.length !== all().length) {
      store.data.minuteurs = keep;
      store.save();
    }
  }

  function check(body) {
    const secondes = Math.round(Number(body?.secondes));
    if (!(secondes >= 1 && secondes <= MAX_SECONDES)) {
      const e = new Error('secondes : entier de 1 à 86400.');
      e.status = 400;
      throw e;
    }
    return secondes;
  }

  return {
    /** Appelé au démarrage : réarme les minuteurs persistés. */
    restore() {
      purge();
      for (const t of [...all()]) {
        if (t.etat !== 'en_cours') continue;
        if (t.fin <= now()) ring(t.id, { alert: now() - t.fin < RATTRAPAGE_MS });
        else arm(t);
      }
    },

    list() {
      purge();
      return { maintenant: now(), minuteurs: all() };
    },

    create(body) {
      const secondes = check(body);
      const cle0 = body.cle ? String(body.cle).slice(0, 120) : null;
      if (all().filter((x) => x.cle !== cle0 || !cle0).length >= MAX_MINUTEURS) {
        const e = new Error(`Trop de minuteurs en cours (${MAX_MINUTEURS} au maximum).`);
        e.status = 400;
        throw e;
      }
      const recipeId = body.recipeId ? String(body.recipeId) : null;
      const etape = Number.isInteger(body.etape) ? body.etape : null;
      const titre = recipeId ? titreRecette(recipeId) : undefined;
      const libelle = String(body.libelle ?? '').trim().slice(0, 80) || (etape ? `Étape ${etape}` : 'Minuteur');
      const cle = body.cle ? String(body.cle).slice(0, 120) : null;
      // Relancer le « même » minuteur (même cle) remplace l'ancien plutôt que d'en empiler un second.
      if (cle) for (const old of all().filter((x) => x.cle === cle)) this.remove(old.id);
      const t = {
        id: crypto.randomUUID().slice(0, 8), cle, libelle, recipeId, etape, recette_titre: titre ?? null,
        total: secondes, fin: now() + secondes * 1000, reste: null, etat: 'en_cours',
        alerte: body.alerte !== false && !!ha.alertMode(), cree_a: now(),
      };
      all().push(t);
      store.save();
      arm(t);
      return t;
    },

    pause(id) {
      const t = find(id);
      if (!t) return null;
      if (t.etat === 'en_cours') {
        t.reste = Math.max(1, Math.ceil((t.fin - now()) / 1000));
        t.fin = null;
        t.etat = 'pause';
        arm(t);
        store.save();
      }
      return t;
    },

    resume(id) {
      const t = find(id);
      if (!t) return null;
      if (t.etat === 'pause') {
        t.fin = now() + t.reste * 1000;
        t.reste = null;
        t.etat = 'en_cours';
        arm(t);
        store.save();
      }
      return t;
    },

    /** Ajoute (ou retire) du temps : « +1 min ». */
    add(id, body) {
      const t = find(id);
      if (!t) return null;
      const delta = Math.round(Number(body?.secondes));
      if (!Number.isFinite(delta) || Math.abs(delta) > 3600) {
        const e = new Error('secondes : entre -3600 et 3600.');
        e.status = 400;
        throw e;
      }
      if (t.etat === 'en_cours') t.fin = Math.max(now() + 1000, t.fin + delta * 1000);
      else if (t.etat === 'pause') t.reste = Math.max(1, t.reste + delta);
      else {
        // Une sonnerie qu'on prolonge repart pour la durée demandée.
        Object.assign(t, { etat: 'en_cours', fin: now() + Math.max(1, delta) * 1000, sonne_a: undefined, alerte_envoyee: undefined, alerte_erreur: undefined });
      }
      t.total = Math.max(t.total, 1);
      arm(t);
      store.save();
      return t;
    },

    remove(id) {
      const t = find(id);
      if (!t) return false;
      clearTimeout(handles.get(id));
      handles.delete(id);
      store.data.minuteurs = all().filter((x) => x.id !== id);
      store.save();
      return true;
    },

    close() {
      for (const h of handles.values()) clearTimeout(h);
      handles.clear();
    },
  };
}
