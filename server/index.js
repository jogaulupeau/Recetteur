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

const { server, stores } = createApp({ dataDir, options, log, supervisorToken: process.env.SUPERVISOR_TOKEN || null,
  // Pour simuler Home Assistant en développement (par défaut : l'API du Supervisor).
  haBase: process.env.HA_API_BASE || undefined });
server.listen(port, host, () => {
  log.info(`Recetteur : http://${host}:${port}/ — ${Object.keys(stores.recettes.data.recettes).length} recette(s), données dans ${dataDir}`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
