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

**Non vérifié ici (à contrôler dans Home Assistant)** : l'adresse de l'ingress (172.30.32.2) et le comportement de `ingress_only` ;
la transmission des en-têtes `Sec-Fetch-*` par le proxy d'ingress (s'ils sont absents, la protection repose sur l'exigence de
`Content-Type: application/json`, qui suffit seule contre les formulaires et `fetch` « simples »).

**Pistes non retenues** (inutiles à cette échelle) : base de données, virtualisation complète du DOM, bundling du JavaScript.
