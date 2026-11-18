---
name: recettes-recetteur
description: Écrit ou convertit des recettes (texte, lien Jow ou blog, photo) au format JSON « recetteur/v1 » pour l'appli Recetteur : menu, courses, pas à pas. À utiliser pour toute recette à ranger.
---

# Recettes pour Recetteur

Recetteur est une application personnelle qui stocke les recettes, compose le menu de la semaine, calcule la
liste de courses et guide la cuisson pas à pas en **ajustant les quantités au nombre de personnes**. Elle ne lit
que du JSON au format `recetteur/v1`. Ton rôle : produire ce JSON, juste et complet, en plus de la recette
elle-même.

La référence complète des champs est dans [references/format.md](references/format.md) ; un exemple réel dans
[references/exemple.json](references/exemple.json). **Lis la référence avant de produire la première recette.**

## Déroulé

1. **Comprendre la demande.** Recette précise, idée à inventer, texte/lien/photo à convertir, ou série de recettes
   (« 5 plats rapides pour la semaine »). Si le nombre de personnes n'est pas donné, écris pour **4** et dis-le.
   Ne pose une question que si elle change vraiment la recette (allergie, matériel, contrainte forte).
2. **Écrire la recette** avec des quantités réalistes et cohérentes pour le nombre de portions annoncé
   (une recette d'amateur, pas une approximation : poids de viande par personne, ratios de pâte, temps de cuisson).
3. **La mettre au format** en respectant les règles ci-dessous.
4. **Vérifier** (si tu peux exécuter du code) : écris le JSON dans un fichier de travail (pas dans le dossier du
   skill, en lecture seule), puis lance le validateur fourni, **en utilisant le chemin réel de ce skill** :
   `node <dossier-du-skill>/scripts/validate-cli.js /tmp/recettes.json` (Node ≥ 18, aucune dépendance).
   Corrige jusqu'à « OK » **et** sans avertissement, sauf avertissement volontaire. L'option `--normaliser`
   écrit sur la sortie standard le JSON nettoyé, prêt à livrer. Sans exécution de code, relis la check-list en fin
   de document : ne prétends jamais avoir validé ce que tu n'as pas exécuté.
5. **Rendre le résultat** — l'utilisateur copie-colle le JSON dans l'application, donc :
   - un court résumé lisible *avant* (titre, portions, temps, une phrase) ; **ne recopie pas la recette en prose**
     en plus du JSON : le JSON est la recette ;
   - le JSON dans **un seul bloc de code** ```json, complet, rien d'autre à l'intérieur (pas de commentaire, pas de
     virgule finale), jamais coupé en plusieurs blocs ;
   - si tu peux créer un fichier, joins aussi `recettes.json` (déposable tel quel dans l'application) ;
   - une dernière ligne : « Collez ce JSON dans Recetteur → Recettes → Ajouter ».
   Plusieurs recettes : **un seul** JSON enveloppe (voir plus bas), pas un bloc par recette.
   Si l'utilisateur demande une modification d'une recette déjà produite, renvoie le JSON **complet** corrigé
   (l'importeur propose de remplacer la version existante), pas un extrait.

## Format en bref

```json
{
  "format": "recetteur/v1",
  "recettes": [
    {
      "titre": "Gratin de courgettes",
      "description": "Une phrase appétissante.",
      "type": "plat",
      "portions": 6,
      "portions_unite": "personnes",
      "temps_preparation": 20,
      "temps_cuisson": 40,
      "difficulte": "facile",
      "cuisine": "française",
      "tags": ["végétarien", "four"],
      "ingredients": [
        { "id": "courgettes", "nom": "courgettes", "quantite": 1.2, "unite": "kg", "rayon": "fruits-legumes" },
        { "id": "oeufs", "nom": "œuf", "nom_pluriel": "œufs", "quantite": 2, "rayon": "cremerie" },
        { "id": "sel", "nom": "sel", "quantite": null, "basique": true }
      ],
      "etapes": [
        { "titre": "Les courgettes", "texte": "Faites revenir {{courgettes}} de courgettes 10 minutes.", "duree": 10, "ingredients": ["courgettes"] },
        { "texte": "Battez {{oeufs}} œufs avec le sel.", "ingredients": ["oeufs", "sel"] }
      ]
    }
  ]
}
```

Une recette seule (objet sans enveloppe) ou un tableau sont aussi acceptés, mais **préfère l'enveloppe**
`{ "format": "recetteur/v1", "recettes": [...] }`.

## Règles qui comptent (elles pilotent le calcul des quantités)

- **Quantités = nombres JSON** (`1.5`, jamais `"1/2"` ni `"une demi"`). Tout ce qui se compte ou se pèse a
  `quantite` ; ce qui est « au goût » (sel, poivre, huile pour la poêle) a `"quantite": null`.
- **Unités** : uniquement `g`, `kg`, `ml`, `cl`, `dl`, `l`, `c. à soupe`, `c. à café`, `cm`, ou un mot comme `gousse`,
  `pincée`, `tranche`, `botte`, `brin`, `feuille`, `sachet`, `boîte`, `pot`, `tête`, `morceau`, `noix`…
  Pour des pièces entières (2 oignons, 4 œufs), **n'indique pas d'unité**.
- **`nom` sans la quantité ni la préparation** : « oignon », pas « 2 gros oignons émincés » (la préparation va
  dans `note`: `"note": "émincé"`). Avec une unité de poids/volume, écris le nom tel qu'il suit « de » :
  `{"quantite": 400, "unite": "g", "nom": "tomates pelées"}` → « 400 g de tomates pelées ». Sans unité, écris le
  **singulier** (`"nom": "oignon"`) et ajoute `nom_pluriel` si le pluriel est irrégulier ou composé
  (`"œufs"`, `"pommes de terre"`, `"oignons rouges"`).
- **Un nom = un ingrédient, toujours écrit pareil** d'une recette à l'autre (« huile d'olive », pas « huile
  d'olive extra vierge » ici et « huile olive » là) : la liste de courses additionne les ingrédients de même nom.
- **`id`** : court, unique dans la recette, minuscules sans accents (`a-z`, `0-9`, `-`, `_`).
- **`rayon`** (parcours de magasin) : `fruits-legumes`, `boulangerie`, `viandes-poissons`, `cremerie`,
  `epicerie`, `epicerie-sucree`, `condiments-epices`, `surgeles`, `boissons`, `autre`.
- **`basique: true`** pour les produits qu'on a presque toujours chez soi (sel, poivre, huile, farine, sucre,
  eau…) : ils vont dans « Placard à vérifier » plutôt que dans la liste d'achats.
- **`fixe: true`** quand la quantité **ne double pas** avec le nombre de convives (1 feuille de laurier, la
  poêle à graisser, 1 pâte brisée pour un moule, un poulet entier). Sans cela la quantité est proportionnelle.
- **Étapes** : chaque étape est autonome et dit quoi faire, combien de temps, à quelle température.
  - **N'écris jamais une quantité à la main dans le texte** quand elle dépend du nombre de personnes : utilise
    `{{id}}`, remplacé à l'affichage par la quantité ajustée avec son unité : « Ajoutez {{boeuf}} de viande
    hachée » devient « Ajoutez 600 g de viande hachée ». Pour un ingrédient sans unité : « Battez {{oeufs}} œufs ».
  - Les durées et températures restent en clair (« 45 minutes », « 180 °C »).
  - `duree` (minutes) sur une étape propose un minuteur (en mode cuisine et sur la fiche) ; mets-la seulement
    quand il y a une vraie attente à chronométrer (cuisson, repos, mijotage).
  - Pour **plusieurs attentes dans la même étape**, ajoute `minuteurs` : une liste de
    `{ "minutes": 3, "libelle": "Côté 1" }` (libellé court à l'impératif : « Retourner », « Arroser », « Sortir »).
    Exemples : « 3 minutes de chaque côté » → deux minuteurs `Côté 1` et `Côté 2` ; « enfournez 1 h 15 en arrosant
    toutes les 20 minutes » → `Arroser` (20) et `Fin de cuisson` (75). `minuteurs` remplace `duree` pour les minuteurs ;
    garde `duree` pour la durée totale de l'étape. Les minutes peuvent être décimales (`0.5` = 30 s). 6 au maximum.
    Ces minuteurs peuvent sonner sur une enceinte connectée : ne les multiplie pas pour des durées sans attente.
  - `ingredients` : les `id` utilisés à cette étape (affichés en rappel). **Chaque ingrédient doit apparaître dans
    au moins une étape.**
- **`type`** : `entree`, `plat`, `accompagnement`, `dessert`, `petit-dejeuner`, `gouter`, `apero`, `boisson`,
  `sauce`, `autre`. Le menu de la semaine pioche surtout dans `plat`.
- **`tags`** : 3 à 6 mots-clés en minuscules, utiles pour rechercher et varier le menu : ingrédient vedette
  (`poulet`, `pâtes`), régime (`végétarien`, `sans gluten`), contexte (`rapide`, `familial`, `batch cooking`),
  mode de cuisson (`four`, `one pot`), saison (`été`). Réutilise les mêmes mots d'une recette à l'autre.
- **Temps** en minutes entières : `temps_preparation`, `temps_cuisson`, `temps_repos` (marinade, pâte qui lève…).
- Texte en **français**, sans Markdown dans les champs (pas de `**gras**`, pas de listes à tirets).
- N'invente pas de `source` ; mets l'URL ou le nom du livre seulement s'ils sont fournis. **Quand la recette vient d'un lien, mets toujours l'adresse de la page dans `source`** : Recetteur s'en sert pour reconnaître une recette déjà importée.

## Plusieurs recettes d'un coup

Une seule enveloppe, des recettes indépendantes (pas de renvois de l'une à l'autre). Pour un plan de repas
(« 5 dîners »), varie les protéines et les modes de cuisson, et privilégie des ingrédients communs entre les
recettes quand c'est naturel : cela allège la liste de courses.

## Conversion d'une recette existante

Respecte fidèlement les quantités et les étapes de la source ; ne « corrige » rien en silence. Si une information
manque (portions, temps), déduis-la raisonnablement et signale-le dans ta réponse (hors JSON). Convertis les
mesures anglo-saxonnes (cups, oz, °F) en mesures métriques arrondies proprement.

## Recettes données par liens (Jow, blog, site de cuisine)

1. **Lis chaque page** et relève : titre, nombre de personnes, ingrédients avec leurs quantités, étapes, temps. Convertis au format
   comme pour une conversion ci-dessus ; les quantités sont celles affichées pour le nombre de personnes de la page (indique-le dans
   `portions`). Reformule les étapes avec tes mots plutôt que de les recopier mot à mot ; les listes d'ingrédients et les durées se
   reprennent telles quelles.
2. **`source` = l'adresse de la page** (sans paramètres de suivi). Si la page ne se lit pas (contenu chargé par JavaScript, accès
   refusé), demande à l'utilisateur de coller le texte de la recette ou une capture : n'invente rien.
3. **Si le connecteur Recetteur est disponible** (outils `ajouter_recettes`, `planifier_repas`…), n'envoie pas de JSON à copier :
   appelle `ajouter_recettes` une seule fois avec toutes les recettes (mode `ignorer`). Une recette déjà présente — même sous un titre
   différent, grâce à `source` — n'est pas dupliquée et la réponse donne son `id`. Planifie ensuite chaque recette, nouvelle ou
   déjà présente, avec `planifier_repas` (jour, repas midi/soir, nombre de personnes) ; demande ces choix s'ils ne sont pas donnés.
   Résume à la fin : ajoutées, déjà présentes, placées au menu.

## Check-list avant de répondre

- [ ] JSON valide (guillemets doubles, pas de commentaire, pas de virgule finale)
- [ ] `format`, `titre`, `portions`, `ingredients` (≥ 1), `etapes` (≥ 1)
- [ ] quantités numériques ; unités de la liste ; pas d'unité pour les pièces entières
- [ ] chaque `{{id}}` et chaque `ingredients: [...]` d'étape correspond à un `id` existant
- [ ] chaque ingrédient est utilisé dans au moins une étape
- [ ] minuteurs : `duree` / `minuteurs` seulement pour de vraies attentes, avec un libellé court
- [ ] aucune quantité « en dur » dans le texte quand elle dépend du nombre de convives
- [ ] `rayon` renseigné ; `basique` sur sel/poivre/huile…; `fixe` quand ça ne s'ajuste pas
- [ ] tout est dans un seul bloc ```json
