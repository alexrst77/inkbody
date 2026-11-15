# Service IA optionnel d'InkBody

InkBody fonctionne entièrement **sans** ce service. Il ne sert qu'au panneau « Assistant IA ».
GitHub Pages n'héberge que des fichiers statiques : la clé d'API ne doit **jamais** être dans le site, le dépôt public ou le navigateur. Elle vit ici, comme secret du Worker.

## Ce que fait le service
- `GET /health` : vérifie que le service répond.
- `POST /generate` : reçoit `{ mode, prompt, style, references[], zoneImage?, mask?, n }`, valide tout, appelle l'API Images d'OpenAI (`/v1/images/generations` ou `/v1/images/edits`) et renvoie `{ images: [dataURL PNG] }`.
- Protections : origines autorisées, code d'accès (`X-Access-Code`), limiteur de débit par IP, quota quotidien par IP et global (KV), taille max 4 Mo par image, vérification de la signature des fichiers, texte limité à 800 caractères.
- **CORS n'empêche pas les abus** (n'importe quel script hors navigateur peut appeler l'URL) : ce sont le code d'accès et les quotas qui plafonnent la dépense.

## Déploiement (Cloudflare Workers, offre gratuite suffisante pour le Worker)
1. Compte Cloudflare + Node.js installé. Dans ce dossier : `npx wrangler login`
2. `npx wrangler kv namespace create QUOTA` → copiez l'`id` dans `wrangler.toml`.
3. Dans `wrangler.toml`, mettez votre origine : `https://votre-utilisateur.github.io`.
4. Secrets : `npx wrangler secret put OPENAI_API_KEY` puis `npx wrangler secret put ACCESS_CODE` (un mot de passe à vous).
5. `npx wrangler deploy` → notez l'URL `https://inkbody-ai.<compte>.workers.dev`.
6. Dans InkBody : Assistant IA → collez l'URL → Enregistrer. Le code d'accès se saisit à chaque session (il n'est jamais stocké).

Si le limiteur `RATE_LIMITER` n'est pas disponible sur votre compte, supprimez le bloc `[[unsafe.bindings]]` : le quota KV reste actif.

## Coûts
- Le Worker et KV tiennent généralement dans l'offre gratuite de Cloudflare pour un usage personnel.
- Chaque image générée est **facturée par OpenAI** selon sa grille (modèle, qualité, taille). Consultez la page tarifs d'OpenAI avant usage, fixez une **limite de dépense** dans votre tableau de bord OpenAI, et réglez `MAX_PER_DAY` / `IMAGE_QUALITY` en conséquence.
- Le nom du modèle est configurable (`OPENAI_IMAGE_MODEL`). Vérifiez dans la documentation officielle d'OpenAI que les paramètres utilisés (`background`, `output_format`, `quality`, `image[]`, `mask`) sont toujours valides pour le modèle choisi.

## Confidentialité
L'application montre les images exactes avant l'envoi et exige une case d'autorisation. Rien n'est envoyé automatiquement. Les images transitent par votre Worker puis par OpenAI, selon leurs conditions.
