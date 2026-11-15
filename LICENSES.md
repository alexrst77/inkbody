# Licences des ressources

| Ressource | Emplacement | Licence |
|---|---|---|
| three.js r170 | `assets/lib/three.module.min.js`, `assets/lib/addons/*` | MIT — `assets/lib/LICENSE-three.txt` |
| three-mesh-bvh 0.8.3 | `assets/lib/three-mesh-bvh.module.js` | MIT — `assets/lib/LICENSE-three-mesh-bvh.txt` |
| Mannequin 3D | `assets/models/` | CC0 1.0 — généré procéduralement par `tools/build-mannequin.mjs` (aucun modèle tiers) |
| Motifs d'exemple | `assets/samples/*.svg` | CC0 1.0 — dessinés pour InkBody |
| Icônes | `assets/icons/` | CC0 1.0 |
| Code de l'application | `index.html`, `tools/`, `serverless/` | MIT (vous pouvez la changer pour votre dépôt) |

Seul fichier modifié parmi les dépendances : dans `assets/lib/addons/GLTFLoader.js`, le chemin d'import de `BufferGeometryUtils.js` a été adapté au dossier local.

Aucune police, image ou modèle externe n'est chargé à l'exécution.
