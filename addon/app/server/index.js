// Démarrage : lit les options de l'add-on (/data/options.json), puis écoute.
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';

const dataDir = process.env.RECETTEUR_DATA_DIR || path.resolve('data');
const port = Number(process.env.PORT || 8099);
// Hors Home Assistant on n'écoute que sur la machine locale ; dans l'add-on (HOST=0.0.0.0),
// seul l'ingress du Supervisor atteint le port, aucun port n'est publié.
const host = process.env.HOST || '127.0.0.1';

const LEVELS = ['trace', 'debug', 'info', 'warning', 'error', 'fatal'];
let options = {};
try {
  options = JSON.parse(fs.readFileSync(process.env.RECETTEUR_OPTIONS || '/data/options.json', 'utf8'));
} catch { /* hors Home Assistant : valeurs par défaut */ }
const level = LEVELS.indexOf(options.log_level ?? 'info');
const stamp = () => new Date().toISOString().slice(11, 19);
const log = {
  info: (...a) => level <= 2 && console.log(stamp(), 'INFO', ...a),
  error: (...a) => console.error(stamp(), 'ERREUR', ...a),
};

// Qui peut se connecter ?
//  - dans l'app Home Assistant : uniquement l'ingress du Supervisor (172.30.32.2), jamais un autre add-on ni le réseau
//    (run.sh renseigne RECETTEUR_ALLOWED_PEERS ; option « ingress_only » pour le désactiver) ;
//  - lancé en local (127.0.0.1) : on vérifie l'en-tête Host, ce qui empêche une page web hostile de joindre l'app
//    par « DNS rebinding » (RECETTEUR_ALLOWED_HOSTS pour ajouter un nom, par exemple derrière un reverse proxy).
const list = (v) => String(v ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const allowedPeers = list(process.env.RECETTEUR_ALLOWED_PEERS).length ? new Set(list(process.env.RECETTEUR_ALLOWED_PEERS)) : null;
const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host);
const allowedHosts = loopback || process.env.RECETTEUR_ALLOWED_HOSTS ? new Set(['localhost', '127.0.0.1', '[::1]', ...list(process.env.RECETTEUR_ALLOWED_HOSTS)]) : null;

const { server, stores } = createApp({ dataDir, options, log, allowedPeers, allowedHosts, supervisorToken: process.env.SUPERVISOR_TOKEN || null,
  // Pour simuler Home Assistant en développement (par défaut : l'API du Supervisor).
  haBase: process.env.HA_API_BASE || undefined });
server.listen(port, host, () => {
  log.info(`Recetteur : http://${host}:${port}/ — ${Object.keys(stores.recettes.data.recettes).length} recette(s), données dans ${dataDir}`);
});

// Une erreur imprévue (disque plein, bug…) est journalisée sans arrêter l'app : minuteurs et alertes continuent.
process.on('unhandledRejection', (e) => log.error('Promesse rejetée non gérée :', e?.stack || e));
process.on('uncaughtException', (e) => log.error('Exception non gérée :', e?.stack || e));

// Arrêt propre : on referme aussi les connexions « keep-alive », sinon server.close() attend leur expiration.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
