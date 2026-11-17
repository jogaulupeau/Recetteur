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

## Vos données

Tout ce que l'app écrit va dans son volume `/data` : `recettes.json`, `menu.json`,
`etat.json` (et une copie `.bak` de la version précédente de chacun). Ce volume
**survit aux redémarrages et aux mises à jour** et est inclus dans les
sauvegardes Home Assistant. Un fichier illisible n'est jamais écrasé : il est
mis de côté sous `*.corrompu`.

## Dépannage

- **« Vers Home Assistant » n'apparaît pas** : le bouton n'existe que dans l'app
  installée. Vérifiez aussi que `ha_todo_entity` correspond à une entité existante
  (*Paramètres → Appareils et services → Entités*, domaine `todo.`).
- **Écran qui s'éteint en cuisine** : le maintien de l'écran allumé dépend du
  navigateur / de l'application mobile Home Assistant ; il exige une connexion HTTPS.
