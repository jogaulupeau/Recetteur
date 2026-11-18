# Changelog

## 0.3.0

- Photo pour chaque recette : depuis la fiche (bouton ou glisser-déposer) et, à la fin d'une recette en mode
  cuisine, « Photographier mon plat ». Elle remplace l'illustration dans les listes, le menu et le mode cuisine.
- Les photos sont redimensionnées et recompressées par le navigateur avant l'envoi (≈ 300 Ko, plus une vignette) ;
  les métadonnées EXIF, position GPS comprise, sont supprimées. Stockage dans `/data/photos`.
- Illustrations générées d'après les ingrédients réels de la recette.

## 0.2.0

- Minuteurs côté serveur : visibles sur toutes les pages, conservés au rechargement et au redémarrage,
  partagés entre appareils ; pause, +1 min, annulation.
- Plusieurs minuteurs par étape (champ `minuteurs`), lançables depuis la fiche recette comme en mode cuisine.
- Alerte de fin de minuteur sur un lecteur multimédia Home Assistant : annonce vocale (`alerte_voix`, entité
  `tts.*`) ou son (`alerte_son`), même si l'écran est éteint. Bouton « Tester ».

## 0.1.0

- Première version : bibliothèque de recettes (import JSON `recetteur/v1`), recherche,
  menu de la semaine avec proposition automatique, liste de courses par rayon,
  mode cuisine pas à pas avec minuteurs, envoi des courses vers une liste « todo ».
