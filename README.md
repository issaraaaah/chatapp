# Chat en temps réel (Node.js + WebSocket)

## Lancer le projet
1. Installer Node.js 18+ : https://nodejs.org
2. Dans ce dossier :
   npm install
   npm start
3. Ouvrir http://localhost:3000 dans deux onglets pour tester.

## Fonctionnalités
- Pseudo unique, liste des utilisateurs en ligne
- Messages en temps réel, historique des 50 derniers messages
- Indicateur "est en train d'écrire", reconnexion automatique
- Thème clair/sombre automatique

## Structure
- server.js : serveur HTTP + WebSocket (bibliothèque `ws`)
- public/index.html : interface (HTML, CSS, JS)

## Pistes d'évolution
- Salons de discussion, messages privés
- Base de données (SQLite, MongoDB) pour conserver l'historique
- Authentification (comptes, mots de passe hashés)
- Déploiement (Render, Railway, VPS) avec HTTPS
