# Recetteur — app Home Assistant

Recetteur range vos recettes, compose le menu de la semaine, prépare la liste
de courses et vous guide **pas à pas** en cuisine, avec des quantités qui
s'ajustent au nombre de personnes.

L'interface apparaît dans la barre latérale de Home Assistant (ingress) : ni
port à ouvrir, ni mot de passe supplémentaire.

## Installation

**Depuis GitHub (recommandé)** : *Paramètres → Apps (Modules complémentaires) →
Boutique*, menu `⋮` → **Dépôts**, ajouter
`https://github.com/jogaulupeau/recetteur`, puis installer « Recetteur ».

**En local** : copier le dossier `addon/` dans `/addons/recetteur/` (partage
Samba `\\homeassistant\addons\` ou « Advanced SSH & Web Terminal »), puis
*Boutique → ⋮ → Vérifier les mises à jour*. « Recetteur » apparaît dans
« Add-ons locaux ». Le dossier doit contenir `app/`, produit par
`npm run package` depuis le dépôt.

## Options

| Option | Rôle |
| --- | --- |
| `portions_defaut` | Nombre de personnes de votre foyer : valeur proposée pour les recettes « pour N personnes » et pour chaque repas du menu. |
| `ha_todo_entity` | Liste « todo » de Home Assistant qui reçoit les courses (`todo.shopping_list` par défaut). |
| `alerte_media_player` | Lecteur multimédia qui sonne à la fin d'un minuteur (`media_player.cuisine`, une enceinte Sonos, Google Nest…). Vide = pas d'alerte sur enceinte. |
| `alerte_voix` | Entité de synthèse vocale (`tts.home_assistant_cloud`, `tts.piper`…) : le lecteur annonce « Minuteur terminé : cuisson des pâtes ». |
| `alerte_son` | À la place de la voix : un son à jouer (`media-source://media_source/local/ding.mp3` ou une URL). Si `alerte_voix` est aussi renseignée, la voix est prioritaire. |
| `mcp_token` | Active le **serveur MCP** (voir ci-dessous) : jeton d'accès de 24 caractères minimum. Vide = MCP désactivé. |
| `mcp_lecture_seule` | Avec le MCP : n'expose que les outils de lecture (rien ne peut être créé, modifié ni supprimé). |
| `ingress_only` | Activée par défaut : l'app n'accepte que les connexions venant de l'ingress de Home Assistant (adresse 172.30.32.2), jamais d'un autre add-on ni du réseau. Si l'interface ne s'ouvre plus après une mise à jour de Home Assistant, décochez-la. |
| `log_level` | Niveau de détail des journaux. |

## Ajouter des recettes (avec Claude)

1. Téléversez le skill **recettes-recetteur** dans votre Claude (voir ci-dessous).
2. Demandez une recette comme d'habitude, ou donnez-lui une recette à convertir ;
   Claude répond avec un bloc JSON.
3. Dans Recetteur : **Recettes → Ajouter**, collez le JSON (les ``` autour sont
   acceptés) ou déposez un fichier `.json`, vérifiez l'aperçu, importez.

**Installer le skill** : `skill/recettes-recetteur.zip` (dans le dépôt GitHub) →
claude.ai, *Réglages → Capacités → Skills → Téléverser un skill* (l'exécution de code doit
être activée dans les capacités). Il s'active ensuite tout seul dès que vous parlez de
recette. Dans Claude Code : dézipper dans `~/.claude/skills/`.

Chaque recette est vérifiée avant l'import : les erreurs bloquantes et les
corrections automatiques sont listées. Une recette déjà présente (même titre)
peut être ignorée, remplacée ou copiée.

## Utilisation

- **Recettes** : recherche (titre, ingrédient, mot-clé), filtres par type, durée, favoris.
  Sur une fiche, le nombre de personnes ajuste ingrédients **et** texte des étapes.
- **Menu** : une semaine à la fois, midi et soir, plusieurs plats par repas.
  *Proposer un menu* remplit les créneaux libres en favorisant les recettes
  pas faites depuis longtemps, vos favorites et les ingrédients communs
  (moins de courses). Chaque proposition peut être relancée avant validation.
- **Courses** : somme des ingrédients des repas choisis, converties (g/kg, ml/l),
  rangées par rayon. Cases à cocher mémorisées ; « toujours en stock » masque un
  article ; sel, huile et autres produits de placard sont à part.
  **Vers Home Assistant** ajoute les articles restants à votre liste « todo ».
- **Cuisiner** : une étape à la fois en grand, mise en place cochable, minuteurs
  multiples (sonnerie + vibration), écran maintenu allumé, flèches du clavier ou
  glissement du doigt pour avancer.

## Piloter Recetteur depuis Claude (MCP)

Le serveur **MCP** intégré permet à Claude de travailler directement dans votre carnet, sans copier-coller :
« ajoute cette recette », « qu'est-ce que je cuisine ce soir avec des courgettes ? », « planifie la semaine pour 4 personnes
et donne-moi la liste de courses », « mets un minuteur de 12 minutes pour les pâtes ». Chaque action passe par les mêmes
validations et les mêmes limites que l'interface.

| Outil | Rôle |
| --- | --- |
| `rechercher_recettes`, `lire_recette`, `proposer_recettes` | Chercher, lire (quantités ajustées au nombre de personnes), suggérer |
| `ajouter_recettes`, `modifier_recette` | Créer (avec aperçu et erreurs détaillées) ou modifier des recettes |
| `modifier_suivi_recette`, `marquer_cuisinee`, `supprimer_recette` | Favori, note, historique ; suppression (confirmation obligatoire) |
| `voir_menu`, `planifier_repas`, `remplir_menu`, `retirer_repas` | Menu de la semaine (`remplir_menu` propose d'abord, n'enregistre qu'avec `appliquer=true`) |
| `liste_de_courses`, `envoyer_courses_vers_home_assistant` | Courses de la semaine, envoi vers la liste « todo » |
| `lancer_minuteur`, `lister_minuteurs`, `arreter_minuteur` | Minuteurs (avec alerte sur l'enceinte) |

La ressource `recetteur://format` donne à Claude la référence du format des recettes : le skill n'est pas nécessaire pour créer
une recette par ce canal.

**Activer** (3 étapes)
1. Générez un jeton : `openssl rand -hex 24` (ou votre gestionnaire de mots de passe) et saisissez-le dans l'option `mcp_token`.
2. Onglet **Réseau** de l'app : donnez un numéro au port `8100/tcp` (par exemple 8100). Sans cela, le serveur n'est pas joignable
   depuis votre réseau.
3. Redémarrez l'app. Le journal affiche « MCP : … 17 outils ».

**Se connecter**
- **Claude Code** (sur un ordinateur de votre réseau) :
  `claude mcp add --transport http recetteur http://homeassistant.local:8100/mcp --header "Authorization: Bearer VOTRE_JETON"`
- **claude.ai, application mobile, Claude Desktop** : les connecteurs personnalisés sont appelés **depuis le cloud d'Anthropic**
  (pas depuis votre téléphone) : l'adresse doit donc être **publique et en HTTPS**. Un `homeassistant.local` ne convient pas, et
  l'ingress de Home Assistant non plus (il exige une session de navigateur). Deux solutions :
  1. **Avec Nabu Casa, sans ouvrir de port** : l'intégration *Recetteur MCP*, voir la section suivante.
  2. **Un tunnel ou un reverse proxy HTTPS** vers le port 8100 (Cloudflare Tunnel, Tailscale Funnel, Nginx Proxy Manager…).
  Dans les deux cas, ajoutez un connecteur personnalisé vers l'adresse obtenue ; d'après la documentation de Claude, un jeton fixe se
  transmet comme **en-tête de requête** (`Authorization: Bearer VOTRE_JETON`, sans connexion OAuth). Une fois configuré sur le
  web, le connecteur est utilisable aussi depuis l'application mobile.

### Accès distant par Nabu Casa : l'intégration « Recetteur MCP »

L'adresse `https://….ui.nabu.casa` ne relaie que Home Assistant (port 8123), pas les ports des apps. Mais Home Assistant sait
recevoir des **webhooks** sur cette même adresse : `https://….ui.nabu.casa/api/webhook/<secret>`. L'intégration *Recetteur MCP*
(dossier `custom_components/recetteur_mcp` du dépôt) y branche un relais vers le serveur MCP de l'app, joint **par le réseau interne**
de Home Assistant : le port 8100 n'a donc **pas besoin d'être publié** (laissez-le désactivé dans l'onglet Réseau).

**Méthode recommandée : l'app « Recetteur MCP »** (dossier `addon-mcp/` du même dépôt, à installer depuis la même boutique). Elle dépose
l'intégration et sa configuration dans Home Assistant à votre place, sans HACS, et garde le privilège « écrire dans la configuration »
**hors** de l'app Recetteur, qui n'en a aucun.

1. L'option `mcp_token` doit être renseignée dans l'app Recetteur (sans jeton, le serveur MCP est désactivé).
2. Installer l'app **Recetteur MCP**, renseigner `recetteur_url` : `http://<nom d'hôte de l'app Recetteur>:8100/mcp` (le nom d'hôte est
   affiché sur la page *Informations* de l'app Recetteur, du type `xxxxxxxx-recetteur`), puis la démarrer et **redémarrer Home Assistant**.
3. Une fois : *Paramètres → Appareils et services → Ajouter une intégration → « Recetteur MCP »* (aucune saisie). L'assistant affiche l'**URL
   à saisir dans Claude** : connecteur personnalisé avec l'en-tête `Authorization: Bearer VOTRE_JETON`. (Ou la ligne `recetteur_mcp:` dans
   `configuration.yaml` pour l'import automatique à chaque démarrage.)

*Autre méthode, sans app* : dans HACS, *Dépôts personnalisés* → `https://github.com/jogaulupeau/recetteur` (type *Intégration*), ou copie de
`custom_components/recetteur_mcp` dans `/config/custom_components/` ; après redémarrage, *Appareils et services → Ajouter une
intégration → Recetteur MCP*, avec la même adresse interne.

Sécurité : il faut **deux secrets** pour utiliser le MCP, l'identifiant (aléatoire, 64 caractères) dans l'URL du webhook, et le jeton, que le
serveur MCP vérifie lui-même (le relais ne le contourne pas). Le relais ne transmet que quelques en-têtes (ni cookies ni en-têtes
arbitraires), refuse les requêtes de navigateur (`Origin`), n'accepte que `POST`, limite la taille à 4 Mo, et ne révèle aucune adresse
interne en cas de panne. Ne partagez pas l'URL. Pour supprimer l'accès distant : option `retirer_integration` de l'app Recetteur MCP (ou suppression de l'intégration : le webhook disparaît).
*Limite connue* : tous les accès passent par Home Assistant, donc le blocage d'adresse du serveur MCP (10 jetons faux en 1 minute)
s'applique à l'ensemble des clients distants ; il est sans effet sur l'accès local direct.

### Si Claude n'arrive pas à se connecter

Le serveur MCP et le relais journalisent chaque requête : le journal de l'app Recetteur contient des lignes `MCP POST /mcp → 401 [sans
en-tête Authorization] agent="…"`, et celui de Home Assistant des lignes `Relais MCP : POST → …`. Lisez-les d'abord :

- **Aucune ligne** : la requête n'atteint pas Recetteur. Attention : **Home Assistant répond `200` avec un corps vide à un webhook qui n'existe
  pas** (pour ne rien révéler). Un `curl` sans jeton qui renvoie `200` vide signifie donc que l'intégration n'a pas enregistré le webhook
  (Home Assistant non redémarré, intégration absente de *Appareils et services*, ou erreur d'import : cherchez « Recetteur MCP » dans les
  journaux de Home Assistant). Le bon résultat est `401` avec un corps JSON. Testez le `curl`
  décrit plus haut depuis votre ordinateur.
- **`401 [sans en-tête Authorization]`** : Claude joint bien le serveur mais n'envoie pas le jeton. Dans la boîte de dialogue
  « Ajouter un connecteur personnalisé » de claude.ai (réglages avancés), l'authentification doit être **Sans connexion** et le jeton
  doit être saisi dans **En-têtes de requête** : nom `authorization`, valeur `Bearer <jeton>` (Claude envoie la valeur telle quelle,
  sans ajouter `Bearer`). Cette section est en **bêta et réservée à certaines organisations** : si elle n'apparaît pas, ce compte ne peut
  pas envoyer de jeton statique. Les réglages d'authentification ne se modifient pas : supprimez le connecteur et recréez-le.
- **`401 [jeton invalide]`** : le jeton saisi dans Claude diffère de l'option `mcp_token`.
- **`200`** : la connexion fonctionne ; le problème est ailleurs.

D'après la documentation de Claude, la connexion se fait depuis le cloud d'Anthropic (IPv4 uniquement, plage `160.79.104.0/21`),
et l'en-tête `Authorization` est perdu si l'adresse du connecteur redirige vers une autre adresse : saisissez l'URL finale.


**Sécurité** : c'est le seul accès à l'app qui ne passe pas par l'ingress de Home Assistant, donc **le jeton est la seule
barrière**. Il est exigé à chaque requête (comparaison en temps constant), l'en-tête `Origin` est refusé (protection des
navigateurs), l'adresse est bloquée une minute après 10 jetons faux, le débit est limité, et aucune route de l'app n'est exposée par
ce port. Ne publiez jamais le port sans HTTPS (le jeton circule en clair sinon). En cas de doute, activez `mcp_lecture_seule`, et
changez le jeton si vous pensez qu'il a fuité (redémarrage de l'app). Le MCP en lecture seule ne permet de rien modifier, mais
expose bien le contenu de vos recettes, de votre menu et de vos courses.

## Photos

Chaque recette peut avoir sa photo : sur la fiche, **Ajouter une photo** (sur téléphone : appareil photo ou
galerie) ou glissez une image sur la zone de l'image ; à la fin d'une recette en mode cuisine,
**Photographier mon plat**. La photo remplace l'assiette illustrée partout (liste, menu, accueil, mode cuisine).

- Avant l'envoi, le navigateur **réduit et recompresse** l'image (1500 px, ≈ 300 Ko ; une vignette de 520 px sert aux
  listes). Ce ré-encodage **supprime les métadonnées EXIF**, dont la position GPS de la prise de vue.
- Formats acceptés : JPEG, PNG, WebP (les photos HEIC sont lues par Safari ; ailleurs, convertissez-les d'abord).
- Les photos sont dans `/data/photos`, donc **dans les sauvegardes Home Assistant**. Elles ne sont **pas** incluses dans
  l'export JSON d'une recette (qui ne contient que le texte) : une recette réimportée garde sa photo si elle existe déjà
  (mode « remplacer »), mais une photo ne voyage pas d'une installation à l'autre.
- Supprimer une recette supprime ses photos. « Retirer » rend l'illustration.
- Le champ `image` d'une recette (une adresse web) reste possible ; une photo envoyée a toujours la priorité.

## Minuteurs et alerte sur une enceinte

Les étapes qui comportent une attente (cuisson, repos, mijotage) proposent un bouton **Lancer le
minuteur**, sur la fiche recette comme en mode cuisine. Une étape peut en avoir plusieurs (« 3 min de
chaque côté », « arroser toutes les 20 min »).

- Les minuteurs vivent **dans l'app, pas dans le navigateur** : ils restent affichés (en haut à
  droite) sur toutes les pages, survivent à un rechargement, à un écran éteint et même au redémarrage
  de l'app, et sont visibles depuis tous vos appareils. Pause, « +1 » minute et annulation à tout moment.
- Le navigateur sonne et vibre s'il est ouvert. Si un lecteur est configuré, l'app envoie en plus,
  **à l'échéance, depuis le serveur**, l'alerte à Home Assistant : vous l'entendez dans la cuisine
  même téléphone en poche.
- La case **Alerte sur <lecteur>** (mode cuisine, ou fiche recette) active ou non l'annonce pour les
  prochains minuteurs de cet appareil ; **Tester** envoie un message immédiat pour vérifier le réglage.
- Les noms d'entités se trouvent dans *Outils de développement → États* (filtres `media_player.` et `tts.`).
- Après un redémarrage, un minuteur échu depuis moins de 5 minutes est encore annoncé ; au-delà il est
  simplement marqué terminé.

Exemple pour une enceinte Sonos avec Piper : `alerte_media_player: media_player.cuisine`,
`alerte_voix: tts.piper`.

## Vos données

Tout ce que l'app écrit va dans son volume `/data` : `recettes.json`, `menu.json`,
`etat.json` (courses cochées, minuteurs en cours), chacun avec une copie `.bak` de sa version précédente, et le dossier
`photos/`. Ce volume
**survit aux redémarrages et aux mises à jour** et est inclus dans les
sauvegardes Home Assistant. Un fichier illisible n'est jamais écrasé : il est
mis de côté sous `*.corrompu`.

## Dépannage

- **L'alerte ne sonne pas** : utilisez le bouton **Tester** (il affiche l'erreur de Home Assistant). Vérifiez
  que `alerte_media_player` et `alerte_voix` (ou `alerte_son`) sont de vraies entités, que l'enceinte est allumée,
  et que la case « Alerte » est activée pour cet appareil.
- **« Vers Home Assistant » n'apparaît pas** : le bouton n'existe que dans l'app
  installée. Vérifiez aussi que `ha_todo_entity` correspond à une entité existante
  (*Paramètres → Appareils et services → Entités*, domaine `todo.`).
- **Écran qui s'éteint en cuisine** : le maintien de l'écran allumé dépend du
  navigateur / de l'application mobile Home Assistant ; il exige une connexion HTTPS.
