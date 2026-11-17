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
`etat.json` (courses cochées, minuteurs en cours) (et une copie `.bak` de la version précédente de chacun). Ce volume
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
