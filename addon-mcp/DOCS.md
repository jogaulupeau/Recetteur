# Recetteur MCP — accès distant pour Claude

Le serveur MCP de l'app **Recetteur** permet à Claude de créer des recettes, planifier le menu, calculer les courses… Pour que
Claude (qui se connecte depuis le cloud d'Anthropic) y accède **sans ouvrir de port**, cette app installe dans Home Assistant une
petite intégration qui relaie un **webhook** de votre adresse Nabu Casa (`https://….ui.nabu.casa/api/webhook/<secret>`) vers le
serveur MCP de Recetteur, joint par le réseau interne.

## Installation

1. Dans l'app **Recetteur**, renseignez l'option `mcp_token` (24 caractères minimum, par exemple `openssl rand -hex 24`).
   Ne publiez pas le port 8100 : le relais passe par le réseau interne.
2. Installez et configurez cette app :
   - `recetteur_url` : adresse **interne** du serveur MCP, `http://<nom d'hôte de l'app Recetteur>:8100/mcp`. Le nom d'hôte est
     affiché sur la page *Informations* de l'app Recetteur (du type `xxxxxxxx-recetteur`).
   - `remote_url` (facultatif) : votre adresse externe, seulement pour afficher l'URL complète dans le journal.
3. Démarrez l'app : elle installe l'intégration et écrit sa configuration. Le journal indique de **redémarrer Home Assistant**.
4. Après le redémarrage, **ajoutez l'intégration une seule fois** : *Paramètres → Appareils et services → Ajouter une intégration →
   « Recetteur MCP »*. Aucune saisie : l'adresse et le secret sont déjà configurés par l'app ; l'assistant affiche l'URL à donner à Claude,
   qui reste la même d'un redémarrage à l'autre. (Home Assistant ne charge pas une intégration qui n'a ni entrée de configuration ni ligne
   dans `configuration.yaml` : sans cette étape, le webhook n'existe pas et répond `200` vide.)
   *Variante sans clic* : ajoutez la ligne `recetteur_mcp:` à votre `configuration.yaml` ; l'intégration s'importera alors seule à chaque démarrage.
5. Dans Claude : connecteur personnalisé vers cette URL, avec l'en-tête de requête `Authorization: Bearer <votre jeton mcp_token>`.

L'app reste active pour surveiller que le serveur MCP de Recetteur répond (journal : « actif et protégé » = tout va bien).

## Ce que l'app écrit dans votre configuration Home Assistant

Cette app demande un privilège que l'app Recetteur n'a pas : **écrire dans le dossier de configuration de Home Assistant**. C'est la raison
d'être d'une app séparée. Elle ne touche qu'à **deux emplacements**, et ne lit rien d'autre :

| Emplacement | Contenu |
| --- | --- |
| `custom_components/recetteur_mcp/` | l'intégration (relais) — recopiée si elle est absente ou différente |
| `recetteur_mcp.json` | `{ "url": …, "webhook_id": … }`, lu par l'intégration (droits 600) |

Le code est celui du dépôt : `addon-mcp/app/start.py` (une centaine de lignes, bibliothèque standard) et `custom_components/recetteur_mcp/`.

## Sécurité

- Deux secrets sont nécessaires pour utiliser le MCP : l'identifiant du webhook (256 bits, tiré une fois, conservé dans `/data/webhook_id.txt`)
  et votre jeton `mcp_token`, que le serveur MCP vérifie lui-même (le relais ne le contourne pas). Ne partagez pas l'URL.
- Le relais ne transmet que quelques en-têtes, refuse les requêtes de navigateur (`Origin`), n'accepte que `POST`, limite la taille à 4 Mo
  et ne révèle aucune adresse interne en cas de panne.
- **Changer le secret du webhook** : supprimez `/data/webhook_id.txt` (par exemple en réinstallant l'app), redémarrez l'app puis Home
  Assistant. L'ancienne URL cesse de fonctionner immédiatement au redémarrage de Home Assistant.

## Désinstaller proprement

Activez l'option `retirer_integration` et démarrez l'app : elle retire l'intégration et son fichier puis s'arrête. Redémarrez Home
Assistant, supprimez l'entrée « Recetteur MCP » (*Appareils et services*) si elle existe, puis désinstallez l'app.

## Dépannage

- *« Dossier de configuration de Home Assistant introuvable »* : l'app n'a pas pu monter la configuration ; relancez-la après mise à jour du Supervisor.
- *« injoignable »* : vérifiez le nom d'hôte de `recetteur_url`, que l'app Recetteur tourne, et que son option `mcp_token` est renseignée
  (sans jeton, le serveur MCP est désactivé).
- `curl` sans jeton : `200` **vide** = webhook non enregistré (étape 4 non faite, ou erreur d'import : cherchez « Recetteur MCP » dans les journaux de
  Home Assistant) ; `401` avec un corps JSON = tout fonctionne.
- Aucune notification après le redémarrage : normal tant que l'étape 4 n'est pas faite ; l'assistant affiche l'URL.
