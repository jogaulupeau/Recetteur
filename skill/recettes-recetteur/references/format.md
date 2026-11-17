# Format `recetteur/v1` — référence

Fichier d'import : un objet `{ "format": "recetteur/v1", "recettes": [ … ] }`. (Une recette seule ou un tableau
de recettes sont aussi acceptés.) Tout champ inconnu est ignoré. Le validateur (`scripts/validate-cli.js`)
**refuse** ce qui est inexploitable (« erreur ») et **corrige** ce qui est évident (« avertissement »).

## Recette

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `titre` | texte | oui | Nom de la recette (200 caractères max). Sert aussi à détecter les doublons à l'import. |
| `description` | texte | non | Une ou deux phrases. |
| `type` | texte | non (`plat`) | `entree`, `plat`, `accompagnement`, `dessert`, `petit-dejeuner`, `gouter`, `apero`, `boisson`, `sauce`, `autre`. |
| `portions` | entier 1–100 | **oui** | Nombre de portions pour lesquelles **toutes** les quantités sont écrites. |
| `portions_unite` | texte | non (`personnes`) | `personnes`, `parts`, `crêpes`, `pots`… Pour autre chose que `personnes`, l'appli n'applique pas la taille du foyer par défaut. |
| `temps_preparation`, `temps_cuisson`, `temps_repos` | entier ≥ 0 (minutes) | non | Le total est calculé. |
| `difficulte` | texte | non | `facile`, `moyen`, `difficile`. |
| `cuisine` | texte | non | Origine : `italienne`, `japonaise`… |
| `tags` | liste de textes | non | Mots-clés en minuscules (recherche, variété du menu). |
| `ingredients` | liste | **oui** | Voir ci-dessous. |
| `etapes` | liste | **oui** | Voir ci-dessous. |
| `materiel` | liste de textes | non | `["fouet", "moule de 24 cm"]`. |
| `notes` | texte | non | Astuces, variantes. |
| `conservation` | texte | non | Durée et mode de conservation. |
| `source` | texte | non | URL ou référence, uniquement si fournie. |
| `image` | URL | non | Adresse d'une photo. |

## Ingrédient

| Champ | Type | Description |
|---|---|---|
| `id` | texte | Identifiant court, unique dans la recette (`a-z`, `0-9`, `-`, `_`). Généré s'il manque, mais **toujours le fournir** : les étapes s'y réfèrent. |
| `nom` | texte (**obligatoire**) | Nom nu, sans quantité. Avec une unité de poids/volume, tel qu'il suit « de » (`tomates pelées`) ; sans unité, au singulier (`oignon`). |
| `nom_pluriel` | texte | Pour les ingrédients comptés sans unité dont le pluriel n'est pas régulier (`œufs`, `pommes de terre`). |
| `quantite` | nombre ou `null` | `null` = « au goût ». Jamais de texte (`"1/2"` est toléré mais à éviter : écris `0.5`). |
| `quantite_max` | nombre | Fourchette : `quantite: 2, quantite_max: 3` → « 2 à 3 ». |
| `unite` | texte | `g`, `kg`, `ml`, `cl`, `dl`, `l`, `c. à soupe`, `c. à café`, `cm`, `pincée`, `gousse`, `tranche`, `botte`, `bouquet`, `branche`, `brin`, `feuille`, `sachet`, `boîte`, `verre`, `tasse`, `pot`, `tête`, `morceau`, `poignée`, `filet`, `noix`, `cube`, `bâton`, `rouleau`, `paquet`, `barquette`, `bocal`, `carré`, `trait`. Vide pour des pièces. Les écritures usuelles (`cuillère à soupe`, `cs`, `gr`, `litre`…) sont reconnues. |
| `note` | texte | Préparation : `émincé`, `à température ambiante`. Affichée après le nom. |
| `rayon` | texte | `fruits-legumes`, `boulangerie`, `viandes-poissons`, `cremerie`, `epicerie`, `epicerie-sucree`, `condiments-epices`, `surgeles`, `boissons`, `autre`. Deviné s'il manque, mais toujours le fournir. |
| `basique` | booléen | Produit de placard (sel, poivre, huile, farine, sucre…) : listé à part dans les courses. |
| `fixe` | booléen | La quantité **ne change pas** avec le nombre de convives. |
| `optionnel` | booléen | Affiché « (facultatif) ». |
| `groupe` | texte | Sous-titre dans la liste des ingrédients (`Pour la pâte`, `Vinaigrette`). Mets les ingrédients d'un même groupe côte à côte. |

### Comment les quantités sont affichées

À 6 personnes pour une recette écrite pour 4 : `400 g` → `600 g` ; `1 oignon` → `1½ oignon` ; `2 c. à soupe` →
`3 c. à soupe` ; `500 g` pour 10 → `1¼ kg`. Les valeurs sont arrondies « à la cuisine » (multiples de 5 g, quarts de
cuillère, demis pour les pièces). Le pluriel commence à 2. La liste de courses additionne les mêmes ingrédients de
plusieurs recettes et convertit `g`↔`kg`, `ml`/`cl`/`dl`↔`l`.

## Étape

| Champ | Type | Description |
|---|---|---|
| `texte` | texte (**obligatoire**) | Instruction complète. `{{id}}` y est remplacé par la quantité ajustée de l'ingrédient (avec son unité). |
| `titre` | texte | Intitulé court (`Le fond de sauce`). |
| `duree` | entier (minutes) | Attente chronométrable : un minuteur est proposé en mode cuisine. |
| `ingredients` | liste d'`id` | Ingrédients de l'étape, rappelés en haut de l'étape avec leurs quantités ajustées. |

Une étape peut aussi être donnée comme simple texte (`"etapes": ["Mélanger.", "Cuire."]`), mais sans minuteur ni
rappel d'ingrédients : à éviter.

## Erreurs fréquentes

| Problème | Conséquence | Correction |
|---|---|---|
| Quantité écrite en dur dans l'étape (« 400 g de viande ») | Ne s'ajuste pas au nombre de personnes | Utiliser `{{boeuf}}` |
| `{{id}}` inexistant | Erreur de validation | Vérifier l'orthographe de l'`id` |
| Ingrédient jamais cité dans les étapes | Avertissement | L'utiliser dans une étape (ou le retirer) |
| `"quantite": "2 gros"` | Quantité ignorée (« au goût ») | `"quantite": 2` + `"note": "gros"` |
| Unité `"pièces"`, `"unité"` | Convertie en « pas d'unité » | Laisser `unite` vide |
| Noms différents pour le même produit | Deux lignes séparées dans les courses | Garder exactement le même nom |
