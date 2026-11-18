// Démarrage : lit les options de l'add-on (/data/options.json), puis écoute.
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { createMcp, MIN_TOKEN } from './mcp.js';

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

const app = createApp({ dataDir, options, log, allowedPeers, allowedHosts, supervisorToken: process.env.SUPERVISOR_TOKEN || null,
  // Pour simuler Home Assistant en développement (par défaut : l'API du Supervisor).
  haBase: process.env.HA_API_BASE || undefined });
const { server, stores } = app;
server.listen(port, host, () => {
  log.info(`Recetteur : http://${host}:${port}/ — ${Object.keys(stores.recettes.data.recettes).length} recette(s), données dans ${dataDir}`);
});

// Serveur MCP (Claude) : sur son propre port, uniquement si un jeton est configuré. Il n'est PAS derrière l'ingress de
// Home Assistant : le jeton est donc la seule barrière (≥ 24 caractères, voir DOCS.md).
const mcpToken = String(options.mcp_token ?? process.env.RECETTEUR_MCP_TOKEN ?? '').trim();
let mcp = null;
if (mcpToken && mcpToken.length < MIN_TOKEN) {
  log.error(`MCP désactivé : le jeton fait ${mcpToken.length} caractères, ${MIN_TOKEN} minimum (générez-en un avec « openssl rand -hex 24 »).`);
} else if (mcpToken) {
  const readOnly = options.mcp_lecture_seule === true || process.env.RECETTEUR_MCP_READONLY === '1';
  const mcpPort = Number(process.env.RECETTEUR_MCP_PORT || 8100);
  mcp = createMcp({ app, token: mcpToken, readOnly, version: process.env.RECETTEUR_VERSION || 'dev', log });
  mcp.server.listen(mcpPort, host, () => log.info(`MCP : http://${host}:${mcpPort}/mcp — ${mcp.engine.tools.length} outils${readOnly ? ' (lecture seule)' : ''}.`));
}

// Une erreur imprévue (disque plein, bug…) est journalisée sans arrêter l'app : minuteurs et alertes continuent.
process.on('unhandledRejection', (e) => log.error('Promesse rejetée non gérée :', e?.stack || e));
process.on('uncaughtException', (e) => log.error('Exception non gérée :', e?.stack || e));

// Arrêt propre : on referme aussi les connexions « keep-alive », sinon server.close() attend leur expiration.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    mcp?.server.close();
    mcp?.server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
