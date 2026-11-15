# InkBody — après build-human.mjs : textures des proxys en niveaux de gris recolorables (WebP) + cartes de détail de peau.
# Sources : MakeHuman system assets (CC0) via le paquet npm makehuman-data. Usage : python3 tools/convert-assets.py
import glob, os, numpy as np
from PIL import Image
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'models')
SK = os.environ.get('SKINS', '/tmp/npmx/ex/package/public/data/skins/')
for f in glob.glob(os.path.join(OUT, 'px', '*.src.png')):
    n = f[:-8]; im = Image.open(f).convert('RGBA')
    if max(im.size) > 1024: im = im.resize((1024, 1024), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]; al = a[..., 3]
    m = lum[al > 0.5].mean() if (al > 0.5).any() else 0.5
    L = np.clip(lum / (m * 2), 0, 1)  # luminance moyenne → 0,5 : la couleur choisie dans l'app devient la teinte moyenne
    Image.fromarray((np.dstack([L, L, L, al]) * 255).astype(np.uint8), 'RGBA').save(n + '.webp', 'WEBP', quality=88, method=6)
    os.remove(f)
for tag, f in [('m', 'young_caucasian_male/textures/young_lightskinned_male_diffuse.png'), ('f', 'young_caucasian_female/textures/young_lightskinned_female_diffuse.png')]:
    a = np.asarray(Image.open(SK + f).convert('RGB')).astype(np.float32)
    ref = np.median(a[60:300, 120:300].reshape(-1, 3), axis=0)
    Image.fromarray((np.clip(a / ref * 0.5, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'skin_' + tag + '.jpg'), quality=90)
