# InkBody

Préparation de projets de tatouage sur un avatar 3D, entièrement dans le navigateur : sans compte, sans abonnement, sans clé d'API. Les projets et les images restent sur l'appareil (IndexedDB).

## Mise en ligne sur GitHub Pages
1. Créez un dépôt (par ex. `inkbody`) et déposez-y **tout le contenu** de ce dossier (`index.html`, `assets/`, `.nojekyll`, etc.) à la racine.
2. Dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Après une minute, le site est disponible sur `https://votre-utilisateur.github.io/inkbody/`.

Tous les chemins sont relatifs : le site fonctionne dans un sous-dossier. Aucune compilation ni serveur Node n'est nécessaire.

Pour tester en local, il faut un petit serveur HTTP (les modules JavaScript ne se chargent pas depuis `file://`) :
`python3 -m http.server 8000` puis http://localhost:8000/

## Contenu
- `index.html` : l'application (HTML, CSS et JavaScript intégrés).
- `assets/vendor/` : three.js r170 et three-mesh-bvh 0.8.3, embarqués et figés (aucun CDN).
- `assets/models/` : le mannequin 3D (275 000 triangles, zones et poids de déformation), compressé `.gz` avec version brute de secours. Régénérable avec `node tools/build-mannequin.mjs`.
- `sw.js`, `manifest.webmanifest` : mode hors ligne et installation.
- `assets/samples/` : 3 motifs d'exemple (SVG).
- `serverless/` : service IA **optionnel** à déployer séparément (voir `serverless/README.md`).

Aucun téléchargement initial n'est à faire : tout ce qu'il faut est dans le dossier.

## Compatibilité
Chrome, Edge, Firefox récents ; Safari 16.4+ (iPhone/iPad iOS 16.4+). WebGL obligatoire.
**Hors ligne** : après un premier chargement en https (GitHub Pages), l'application et le mannequin sont mis en cache (service worker `sw.js`) et fonctionnent sans réseau. Installable sur l'écran d'accueil (Partager → « Sur l'écran d'accueil » sur iPhone).
**Mise à jour du site** : changez `VERSION` dans `sw.js` à chaque publication pour renouveler le cache.

## Nouveautés de la version 2
- **Projection « Épouse la peau »** (par défaut) : carte géodésique depuis le point d'ancrage ; un grand motif passe de l'épaule au torse, du flanc au dos, sans couture ni étirement plan. Les plis (aisselle, cou, entrejambe) sont coupés proprement avec un avertissement. Modes « Enroulée » et « Plane » toujours disponibles.
- **Photo de tatouage sur la peau** : redressement de perspective (4 coins), déroulage de la courbure d'un bras/jambe, extraction de l'encre par différence avec la couleur de peau, couleurs conservées, puis retouche au pinceau.
- **Mannequin affiné** : 275 000 triangles, doigts séparés, chargé compressé (≈ 2 Mo).
- **Hors ligne et installable** (PWA).

## Limites restantes
- Mannequin stylisé (visage simplifié) ; import GLB possible (seule la taille est alors ajustable).
- Pas de segmentation par IA : l'extraction d'encre suppose une peau assez uniforme ; ombres fortes et reflets demandent une retouche au pinceau.
- Corrections de perspective et de courbure géométriques, donc approximatives.
- Mesures estimatives ; une capture n'est jamais un stencil à taille réelle.
- Vider les données du navigateur efface les projets : exportez une sauvegarde.
- L'IA nécessite le service à déployer (`serverless/`) et un fournisseur payant.

## Licences
Voir `LICENSES.md`.
