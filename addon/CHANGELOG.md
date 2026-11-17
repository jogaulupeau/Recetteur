# Changelog

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
