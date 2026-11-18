# Changelog

## 0.2.0

- **Correctif important** : Home Assistant ne charge pas une intégration qui n'a ni entrée de configuration ni ligne dans
  `configuration.yaml` ; l'import automatique ne se déclenchait donc jamais et le webhook n'existait pas (réponse `200` vide).
  Il faut désormais ajouter l'intégration **une fois** (*Appareils et services → Ajouter une intégration → Recetteur MCP*, sans saisie : l'adresse
  et le secret écrits par l'app sont repris), ou ajouter `recetteur_mcp:` à `configuration.yaml` pour l'import automatique.
- Intégration 0.3.0 : assistant sans saisie en mode géré, ligne YAML `recetteur_mcp:` acceptée.

## 0.1.3

- Intégration 0.2.2 : journalise l'enregistrement du webhook et les échecs d'import ; n'annonce l'URL (notification) que si la configuration a bien été importée.

## 0.1.2

- Intégration 0.2.1 : le relais journalise une ligne par requête dans le journal de Home Assistant (« Relais MCP : POST → 401,
  en-tête Authorization absent, agent … »), sans jeton ni contenu. À consulter dans *Paramètres → Système → Journaux*.

## 0.1.1

- Correction : l'enregistrement des options échouait (« expected a URL ») car le Supervisor refuse une valeur vide pour un champ de type `url`. `remote_url` est désormais un texte libre, facultatif, contrôlé par l'app.

## 0.1.0

- Première version : installe l'intégration `recetteur_mcp` dans Home Assistant, génère l'identifiant secret du webhook, écrit le fichier
  de configuration importé par l'intégration, surveille le serveur MCP de Recetteur.
