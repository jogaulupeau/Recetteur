# Audit sécurité & performance

Méthode : chaque risque suspecté a d'abord été **reproduit** sur le code existant (exploit ou mesure), puis corrigé, puis
couvert par un test automatique (`test/security.test.js`, `test/photos.test.js`, `test/minuteurs.test.js`). Un fuzzing de
5 000 requêtes aux corps aberrants sur toutes les routes ne produit aucune erreur 5xx, aucun arrêt, aucune pollution.

## Sécurité

| # | Constat (reproduit) | Gravité | Correction |
|---|---|---|---|
| 1 | `GET /%E0%A4%A` : `decodeURIComponent` levait hors du `try`, la promesse rejetée **arrêtait le processus** | haute | Tout le traitement dans un `try` ; filet de sécurité sur chaque requête ; `unhandledRejection`/`uncaughtException` journalisées |
| 2 | `PATCH /api/recettes/__proto__` : `({}).favori === true` dans tout le serveur (pollution de prototype) ; `constructor` traité comme une recette | haute | Accès par `Object.hasOwn` partout |
| 3 | Import de 30 000 ingrédients de même id (1 Mo) : **29 s de CPU**, événements (minuteurs) bloqués | haute | Unicité des ids en temps amorti constant ; plafonds : 300 ingrédients, 200 étapes, textes bornés, 500 recettes par import |
| 4 | CSRF : `POST` « simple » (`text/plain`) d'un autre site acceptés (courses → Home Assistant, minuteurs, menu, import) | moyenne (haute hors ingress) | `Content-Type: application/json` exigé ; `Sec-Fetch-Site` ≠ same-origin refusé ; aucun en-tête CORS |
| 5 | Corps JSON `null` / scalaire : 500 avec message interne (`Cannot use 'in' operator…`) | moyenne | Corps validé (400) ; erreurs inattendues = message générique, détail journalisé |
| 6 | Aucun en-tête de sécurité | moyenne | CSP stricte (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`), `nosniff`, `Referrer-Policy: no-referrer` ; photos : `default-src 'none'; sandbox` + CORP |
| 7 | Port de l'add-on joignable par un autre add-on / le réseau interne, sans authentification | moyenne | Option `ingress_only` (par défaut) : seule l'IP de l'ingress (172.30.32.2) est acceptée |
| 8 | Lancement local : DNS rebinding possible | basse | Contrôle de l'en-tête `Host` quand l'app écoute en loopback |
| 9 | Minuteurs et repas illimités ; tampon d'upload non unique | basse | 50 minuteurs, 5 000 repas ; nom temporaire unique par envoi ; `slowloris` : délais d'en-têtes/requête |
| 10 | Champ `image` : n'importe quel schéma | basse | http(s) uniquement (validateur et affichage) |
| 11 | Une erreur d'écriture disque dans un minuteur pouvait devenir une promesse rejetée | basse | Écriture protégée, erreur journalisée |

**Régression évitée par la vérification** : la première CSP bloquait les images `blob:` (repli de décodage d'une photo choisie, utilisé
par Safari et pour le HEIC). Détectée en rejouant l'envoi de photo avec surveillance des violations de CSP ; `blob:` est désormais autorisé
dans `img-src` et un test le garantit.

**Résiste (vérifié)** : traversée de chemin (`%2e%2e`, `..%2f`, octets nuls) ; injection HTML (un seul `innerHTML`, SVG fait de
nombres et de couleurs ; tout texte passe par des nœuds texte) ; liens (`encodeURIComponent`, `https?://`) ; secrets (aucun dans le
dépôt, jeton Supervisor jamais renvoyé ni journalisé) ; envois de fichiers (format vérifié sur les octets, nom dérivé d'un id
`[a-z0-9-]`) ; privilèges Docker (aucun élargi) ; dépendances npm (aucune).

**Risques acceptés / à connaître**
- Le conteneur s'exécute en root (comme la plupart des add-ons : les images de base Home Assistant l'exigent). Il n'écrit que dans `/data`.
- Hors Home Assistant (`npm start`), il n'y a pas d'authentification : l'app écoute sur `127.0.0.1` uniquement. Ne l'exposez pas sur
  Internet sans reverse proxy authentifié (`HOST` et `RECETTEUR_ALLOWED_HOSTS`).
- Les écritures sont synchrones : une erreur disque (plein) fait échouer la requête (500 générique) après modification en mémoire.

## Serveur MCP (ajouté en 0.4.0)

Modèle de menace : c'est le seul accès qui ne passe pas par l'ingress, donc le jeton est la seule barrière.

| Risque | Parade (testée dans `test/mcp.test.js`) |
|---|---|
| Accès sans jeton / jeton deviné | Bearer obligatoire (minimum 24 caractères, sinon MCP désactivé), comparaison en temps constant, blocage 1 min après 10 échecs, 300 requêtes/min |
| Page web hostile → serveur local (DNS rebinding) | Tout en-tête `Origin` refusé (exigence de la spécification MCP) |
| Accès aux routes de l'app par ce port | Une seule URL (`/mcp`), aucune route de l'API ni fichier statique |
| Un outil abuse de l'app | Les outils passent par `dispatch` : mêmes validations et mêmes limites (300 ingrédients, 500 recettes…) que l'API |
| Action destructrice par erreur | `supprimer_recette` exige `confirmer=true` ; annotations `destructiveHint` ; mode `mcp_lecture_seule` qui retire tous les outils d'écriture |
| Arguments piégés (`__proto__`, types faux) | Validation de schéma stricte (paramètres inconnus refusés), `Object.hasOwn` pour les identifiants |
| Fuite par les erreurs | Erreur interne = message générique ; le jeton n'est jamais journalisé |
| Corps énorme / lent | 4 Mo max, délais d'en-têtes et de requête |

**Accès distant par webhook** (`custom_components/recetteur_mcp`) : l'ingress ne convient pas (session de navigateur obligatoire), le webhook est
la seule porte non authentifiée de Home Assistant sur l'adresse Nabu Casa. Mesures (testées dans `tests_ha/` avec un vrai Home Assistant
de test et le vrai serveur Node) : identifiant secret de 64 caractères (256 bits) + jeton Bearer vérifié par le serveur MCP (le relais ne l'examine pas) ;
liste blanche d'en-têtes dans les deux sens (ni cookies, ni `X-Forwarded-For`, ni en-têtes internes) ; `Origin` refusé ; `POST` seul ;
4 Mo ; pas de redirection suivie ; erreurs réseau sans adresse interne. Le décompte d'échecs d'authentification de Home Assistant (IP ban)
ne s'applique qu'aux écrans de connexion, pas aux webhooks : les `401` du serveur MCP peuvent traverser sans risque de bannissement.

**Capteurs du menu du jour** (0.6.0) : l'app écrit deux entités par `POST /states/<entité>` avec le jeton du Supervisor, sans nouveau privilège (`homeassistant_api` était déjà demandé). Les noms d'entités sont fixes (aucune valeur fournie par un utilisateur ne sert à les construire), le contenu est un simple texte de titres de recettes ; un échec de Home Assistant est journalisé une seule fois et n'affecte pas l'app.

**App « Recetteur MCP »** (`addon-mcp/`) : installe l'intégration sans HACS. Choix de conception : le privilège
`homeassistant_config` en écriture est le plus sensible de l'ensemble ; il est donc porté par une app séparée d'une centaine de lignes
(bibliothèque standard), et l'app Recetteur n'a aucun privilège élargi. L'app n'écrit que dans `custom_components/recetteur_mcp/` et
`recetteur_mcp.json` (test : aucun autre fichier de la configuration n'est créé ni modifié), ne suit jamais un lien symbolique à ces
emplacements, écrit le fichier en 0600 de façon atomique, ne déclare ni port, ni API Home Assistant/Supervisor, ni réseau hôte
(test de packaging). L'intégration n'accepte le fichier que si l'identifiant est de 64 caractères [A-Za-z0-9_-] et l'URL en http(s) sans
identifiants. Un défaut trouvé par les tests : après rotation du secret, l'ancien webhook restait actif ; corrigé (0.2.0).

Interopérabilité vérifiée avec le client officiel `@modelcontextprotocol/sdk` 1.32.2 (connexion, 17 outils, ressource, appels).

## Performance (600 recettes, Chromium)

| Mesure | Avant | Après |
|---|---|---|
| `GET /api/recettes` | 865 Ko | 53 Ko (gzip) |
| Transfert à l'ouverture de la liste | 1 215 Ko | 288 Ko |
| Nœuds DOM de la liste | 51 963 | 3 429 |
| Ouverture de la liste — bureau | 778 ms | 177 ms |
| Ouverture de la liste — mobile (CPU ×4) | 2 494 ms | 506 ms |
| Recherche — mobile (CPU ×4) | 1 019 ms | 305 ms |
| Retour à la liste complète — mobile | 2 077 ms | 259 ms |
| Écriture d'une recette (clic sur un cœur) | 8,9 ms (32 max) ; 2 × 1,7 Mo réécrits | 5,8 ms (22 max) ; 0,9 Mo, copie `.bak` toutes les 10 min |
| Import de 1 Mo d'ingrédients | 29 136 ms | 58 ms (refusé) |

**Testé sans effet, retiré** : `<link rel="modulepreload">` des 30 modules (aucun gain mesuré, même à 250 ms de latence).

**Non vérifié ici (à contrôler dans Home Assistant)** : la construction de l'image de l'app Recetteur MCP (pas de Docker ici ; le script est testé hors conteneur) et le point de montage `homeassistant_config` (le script détecte `/homeassistant` ou `/config`) ; l'adresse de l'ingress (172.30.32.2) et le comportement de `ingress_only` ;
la transmission des en-têtes `Sec-Fetch-*` par le proxy d'ingress (s'ils sont absents, la protection repose sur l'exigence de
`Content-Type: application/json`, qui suffit seule contre les formulaires et `fetch` « simples »).

**Pistes non retenues** (inutiles à cette échelle) : base de données, virtualisation complète du DOM, bundling du JavaScript.
