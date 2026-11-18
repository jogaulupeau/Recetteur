# Changelog

## 0.4.1

- Documentation : accès distant au MCP sans ouvrir de port, par l'intégration Home Assistant `recetteur_mcp` (relais par webhook,
  donc par l'adresse Nabu Casa). L'app elle-même n'a pas changé.

## 0.4.0

- **Serveur MCP** : Claude peut créer des recettes, les lire (quantités ajustées), planifier le menu, calculer les courses et lancer des
  minuteurs directement dans Recetteur. 17 outils, ressource `recetteur://format`, port dédié `8100/tcp` protégé par un jeton
  (options `mcp_token` et `mcp_lecture_seule`). Désactivé tant qu'aucun jeton n'est défini.

## 0.3.1 — audit de sécurité et de performance

Sécurité
- **Un `GET /%E0%A4%A` (URL mal formée) arrêtait tout le serveur** : corrigé, aucune requête ne peut plus faire tomber l'app.
- Pollution de prototype (`PATCH /api/recettes/__proto__`) : corrigée.
- Import démesuré (1 Mo d'ingrédients identiques : serveur bloqué 29 s) : limites de taille et validation en temps linéaire.
- Protection CSRF : `Content-Type: application/json` exigé en écriture, requêtes inter-sites refusées (`Sec-Fetch-Site`).
- Nouvelle option `ingress_only` (activée) : seules les connexions de l'ingress de Home Assistant sont acceptées.
- En-têtes de sécurité (CSP, nosniff, pas de Referer) ; photos servies en bac à sable ; erreurs internes génériques côté client.
- Adresse `image` limitée à http(s) ; plafonds (300 ingrédients, 50 minuteurs, 5 000 repas…).

Performance (600 recettes)
- API compressée (865 → 53 Ko) ; fichiers statiques en gzip ; polices en cache d'une semaine.
- Liste de recettes à rendu progressif : ouverture 2,5 s → 0,5 s sur mobile modeste, 52 000 → 3 400 nœuds DOM.
- Écritures plus légères : JSON compact, copie `.bak` au plus toutes les 10 min pour `recettes.json`.

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
