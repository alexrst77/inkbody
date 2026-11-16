# Modèle « réaliste » simulé : papier crème bruité, dessin d'ornements sur toute la planche (y compris sur les zones bleues)
import asyncio, base64, json, io, random
from PIL import Image, ImageFilter, ImageChops, ImageOps
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8770/inkbody-depot/'
A=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
ART=Image.open('/mnt/user-data/uploads/a5bd3499-image.png').convert('L')
def du(d): return Image.open(io.BytesIO(base64.b64decode(d.split(',',1)[1]))).convert('RGBA')
def fake(body):
    board=du(body['zoneImage']).convert('RGB'); W,H=board.size
    art=ART.resize((int(H*ART.width/ART.height*1.25),H)); out=Image.new('RGB',(W,H),(244,238,226))
    a=Image.new('L',(W,H),255); a.paste(art,((W-art.width)//2,0)); out=ImageChops.multiply(out, Image.merge('RGB',[a,a,a]))
    # le modèle « respecte » à moitié le bleu : on remet du bleu sur 60 % des zones occupées
    blue=board.split()[2].point(lambda v:255 if v>240 else 0); r=board.split()[0].point(lambda v:255 if v<200 else 0)
    occ=ImageChops.multiply(blue,r).filter(ImageFilter.GaussianBlur(3)).point(lambda v: 255 if v>100 else 0)
    keep=Image.new('L',(W,H),0); 
    for y in range(0,H,40):
        if random.random()<0.6: keep.paste(255,(0,y,W,y+40))
    m=ImageChops.multiply(occ,keep); out.paste((186,213,255),mask=m)
    noise=Image.effect_noise((W,H),8).convert('RGB'); out=ImageChops.add(out,noise,1,-8)
    buf=io.BytesIO(); out.save(buf,'PNG'); out.save('fake_out.png'); return 'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
async def main():
    random.seed(4)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=A)
        ctx=await b.new_context(viewport={'width':1200,'height':900}); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        async def route(r):
            if r.request.url.endswith('/health'): return await r.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'ready':True,'model':'mock'}))
            body=json.loads(r.request.post_data); i=fake(body); await r.fulfill(status=200,content_type='application/json',body=json.dumps({'images':[i]}))
        await ctx.route('**/api/ai/**',route)
        await pg.goto(URL); await pg.wait_for_function('window.InkBody && InkBody.S.project && InkBody.Body.nV>0',timeout=120000)
        await pg.click('.modal footer button'); await pg.evaluate('() => InkBody.Importer.samples()'); await pg.wait_for_function('InkBody.S.project.library.length==3',timeout=30000)
        await pg.evaluate("""async () => { const {S,App,Body}=InkBody; const L=(n)=>S.project.library.find(l=>l.name.startsWith(n));
          const B=Body.bones, out=new B.torso.a.constructor(Math.sign(B.upperarm_r.a.x),0,0.3).normalize(); const at=(bn,f,d=0.12)=>Body.closest(bn.a.clone().lerp(bn.b,f).addScaledVector(out,d));
          for (const [lib,hit,w,h] of [[L('Mandala'),at(B.upperarm_r,0.55),8,8],[L('Rose'),at(B.forearm_r,0.55),10,18]]) { await App.addTattoo(lib,hit); App.update(S.selected,{widthCm:w,heightCm:h,lockRatio:false}); App.update(S.selected,{status:'existing'}); } }""")
        snap0=await pg.evaluate("async () => JSON.stringify(await InkBody.lockedSnapshot())")
        await pg.evaluate("() => { localStorage.setItem('inkbody.ai.code','x'); InkBody.AI.open(); }"); await pg.wait_for_timeout(1200)
        await pg.fill('.modal textarea','gros tournesol sur l épaule, feuillage autour'); await pg.click('text=Générer les ajouts'); await pg.wait_for_timeout(400)
        await pg.click('.modal >> text=J’autorise'); await pg.click('text=Envoyer'); await pg.wait_for_selector('.ia-bar',timeout=90000); await pg.wait_for_timeout(1500)
        print('barre :', (await pg.inner_text('.ia-bar')).split('\n')[0], await pg.evaluate('() => InkBody.AI.preview.why'))
        r=await pg.evaluate("""() => { const {AI,overlapReport,S}=InkBody; const P=AI.preview; const add=S.tattoos.filter(t=>P.ids.includes(t.id)); return {n:add.length, core:add.map(t=>overlapReport(P.ctx.B,[t],P.ctx.M.core)), dims:add.map(t=>[t.widthCm,t.heightCm,t.mode,t.region])}; }""")
        print(r)
        snap1=await pg.evaluate("async () => JSON.stringify(await InkBody.lockedSnapshot())")
        print('existants identiques:', snap0==snap1, '| encre ajoutée hors existants:', all(o['over']==0 for o in r['core']) and r['n']>0)
        for i,(dx,dy,dz) in enumerate([(1.2,0.1,0.6),(0.4,0.1,1.2),(-0.3,0.3,-1.2)]):
            await pg.evaluate("([dx,dy,dz]) => { document.querySelectorAll('.toast,.ia-bar').forEach(n=>n.style.display='none'); const {Body,Engine}=InkBody; const u=Body.bones.upperarm_r; const s=Math.sign(u.a.x); const t=u.b.clone(); Engine.flyTo(t,t.clone().add(new t.constructor(s*dx,dy,dz)),false); }", [dx,dy,dz])
            await pg.wait_for_timeout(600); await pg.screenshot(path=f'r_view{i}.png')
        print('errs',errs); await b.close()
asyncio.run(main())
