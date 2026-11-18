# Changelog

## 0.1.2

- Intégration 0.2.1 : le relais journalise une ligne par requête dans le journal de Home Assistant (« Relais MCP : POST → 401,
  en-tête Authorization absent, agent … »), sans jeton ni contenu. À consulter dans *Paramètres → Système → Journaux*.

## 0.1.1

- Correction : l'enregistrement des options échouait (« expected a URL ») car le Supervisor refuse une valeur vide pour un champ de type `url`. `remote_url` est désormais un texte libre, facultatif, contrôlé par l'app.

## 0.1.0

- Première version : installe l'intégration `recetteur_mcp` dans Home Assistant, génère l'identifiant secret du webhook, écrit le fichier
  de configuration importé par l'intégration, surveille le serveur MCP de Recetteur.
