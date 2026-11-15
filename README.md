# InkBody

**Version 3.** **En ligne :** https://inkbody-production.up.railway.app (Railway, redéploiement automatique à chaque push sur `main`) · https://alexrst77.github.io/inkbody/ (GitHub Pages)

Préparation de projets de tatouage sur un avatar 3D, entièrement dans le navigateur : sans compte, sans abonnement, sans clé d'API. Les projets et les images restent sur l'appareil (IndexedDB).

## Hébergement
- **Railway** : service Node relié au dépôt (`npm start` → `server.js`, serveur statique sans dépendance, région EU West). Chaque push sur `main` redéploie.
- **GitHub Pages** : branche `main`, dossier racine.

## Mise en ligne sur GitHub Pages (autre dépôt)
1. Créez un dépôt (par ex. `inkbody`) et déposez-y **tout le contenu** de ce dossier (`index.html`, `assets/`, `.nojekyll`, etc.) à la racine.
2. Dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Après une minute, le site est disponible sur `https://votre-utilisateur.github.io/inkbody/`.

Tous les chemins sont relatifs : le site fonctionne dans un sous-dossier. Aucune compilation ni serveur Node n'est nécessaire.

Pour tester en local, il faut un petit serveur HTTP (les modules JavaScript ne se chargent pas depuis `file://`) :
`python3 -m http.server 8000` puis http://localhost:8000/

## Contenu
- `index.html` : l'application (HTML, CSS et JavaScript intégrés).
- `assets/lib/` : three.js r170 et three-mesh-bvh 0.8.3, embarqués et figés (aucun CDN).
- `assets/models/human.*` : corps humain issu de **MakeHuman** (maillage, poids de peau et morphologies, licence CC0), converti par `tools/build-human.mjs` (0,5 Mo compressé). Le navigateur applique les morphologies puis une subdivision Catmull-Clark (≈ 107 000 triangles lissés).
- `sw.js`, `manifest.webmanifest` : mode hors ligne et installation.
- `assets/samples/` : 3 motifs d'exemple (SVG).
- `serverless/` : service IA **optionnel** à déployer séparément (voir `serverless/README.md`).

Aucun téléchargement initial n'est à faire : tout ce qu'il faut est dans le dossier.

## Compatibilité
Chrome, Edge, Firefox récents ; Safari 15+ (iPhone/iPad sous iOS/iPadOS 15 ou plus récent, testé en simulation iPadOS 15.7). Pas d'« import map » ni d'API récente obligatoire : sur iOS 15, le mannequin est chargé en version brute (5,5 Mo) faute de décompression native. WebGL obligatoire.
Sur iPad en portrait : 3D plein écran et panneaux en tiroirs latéraux ; en paysage : disposition ordinateur.
**Hors ligne** : après un premier chargement en https (GitHub Pages), l'application et le mannequin sont mis en cache (service worker `sw.js`) et fonctionnent sans réseau. Installable sur l'écran d'accueil (Partager → « Sur l'écran d'accueil » sur iPhone).
**Mise à jour du site** : changez `VERSION` dans `sw.js` à chaque publication pour renouveler le cache.

## Nouveautés de la version 3
- **Corps humain réaliste** (MakeHuman, CC0) : vrai visage avec yeux, lèvres et sourcils, mains à cinq doigts, pieds détaillés ; morphologies réelles homme/femme, poids, musculature, poitrine, carrure, membres ; couleur des yeux.
- **Extraction d'encre v2** : peau de référence estimée localement (ombres, courbure), modèle d'encre transmissif qui conserve les couleurs, nettoyage des points isolés, aperçu en direct.

## Nouveautés de la version 2
- **Projection « Épouse la peau »** (par défaut) : carte géodésique depuis le point d'ancrage ; un grand motif passe de l'épaule au torse, du flanc au dos, sans couture ni étirement plan. Les plis (aisselle, cou, entrejambe) sont coupés proprement avec un avertissement. Modes « Enroulée » et « Plane » toujours disponibles.
- **Photo de tatouage sur la peau** : redressement de perspective (4 coins), déroulage de la courbure d'un bras/jambe, extraction de l'encre par différence avec la couleur de peau, couleurs conservées, puis retouche au pinceau.
- **Mannequin affiné** : 275 000 triangles, doigts séparés, chargé compressé (≈ 2 Mo).
- **Hors ligne et installable** (PWA).

## Limites restantes
- Corps générique : ce n'est pas un scan de votre corps ; les morphologies MakeHuman sont amplifiées pour être lisibles. Import GLB possible (seule la taille est alors ajustable).
- Pas de segmentation par IA : l'extraction d'encre gère ombres douces et courbure, mais pas les reflets brillants, poils, cicatrices ou encre très délavée proche de la couleur de peau (retouche au pinceau).
- Corrections de perspective et de courbure géométriques, donc approximatives.
- Mesures estimatives ; une capture n'est jamais un stencil à taille réelle.
- Vider les données du navigateur efface les projets : exportez une sauvegarde.
- L'IA nécessite le service à déployer (`serverless/`) et un fournisseur payant.

## Licences
Voir `LICENSES.md`.

## Création de tatouages par IA (v3.2)

Le serveur Railway intègre un service de génération (`/api/ai/health`, `/api/ai/generate`, fichier `ai.js`).
La clé n'est **jamais** dans le site : elle se règle dans les variables Railway du service.

| Variable | Rôle |
|---|---|
| `OPENAI_API_KEY` | clé OpenAI (côté serveur uniquement) |
| `ACCESS_CODE` | code personnel demandé dans l'app (sans lui, personne ne peut consommer le crédit) |
| `OPENAI_IMAGE_MODEL` | facultatif : `gpt-image-2` par défaut, repli automatique sur gpt-image-2.5-flare, gpt-image-1.5, gpt-image-1 |
| `IMAGE_QUALITY` | facultatif : `low`, `medium` (défaut), `high` |
| `MAX_PER_IP_PER_DAY` / `MAX_PER_DAY` | quotas (30 / 120 par défaut) |

Modes : **manchette complète** (planche verticale épaule → poignet, enroulée automatiquement autour du bras),
**motif** (posé au centre de la vue), **compléter la zone visible** (vue + masque, tatouages existants protégés).
Les images de référence ne partent qu'après accord explicite.
