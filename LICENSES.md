# Licences des ressources

| Ressource | Emplacement | Licence |
|---|---|---|
| three.js r170 | `assets/vendor/three.module.min.js`, `assets/vendor/addons/*` | MIT — `assets/vendor/LICENSE-three.txt` |
| three-mesh-bvh 0.8.3 | `assets/vendor/three-mesh-bvh.module.js` | MIT — `assets/vendor/LICENSE-three-mesh-bvh.txt` |
| Mannequin 3D | `assets/models/` | CC0 1.0 — généré procéduralement par `tools/build-mannequin.mjs` (aucun modèle tiers) |
| Motifs d'exemple | `assets/samples/*.svg` | CC0 1.0 — dessinés pour InkBody |
| Icônes | `assets/icons/` | CC0 1.0 |
| Code de l'application | `index.html`, `tools/`, `serverless/` | MIT (vous pouvez la changer pour votre dépôt) |

Seul fichier modifié parmi les dépendances : dans `assets/vendor/addons/GLTFLoader.js`, le chemin d'import de `BufferGeometryUtils.js` a été adapté au dossier local.

Aucune police, image ou modèle externe n'est chargé à l'exécution.
