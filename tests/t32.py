# Vérification « ajouts IA » : tatouages existants intacts, masquage = état antérieur, pas d'empiètement, vues, sauvegarde/réouverture, réponse tardive
import asyncio, base64, json, io, sys
from PIL import Image, ImageDraw, ImageChops
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8770/inkbody-depot/'
VP={'width':1200,'height':900}; TOUCH=False
A=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
res=[]
async def consent(pg):
    await pg.wait_for_timeout(300)
    if await pg.locator('.modal >> text=J’autorise').count(): await pg.click('.modal >> text=J’autorise'); await pg.click('text=Envoyer')
def check(name, ok, info=''): ok=bool(ok); res.append(ok); print(('OK  ' if ok else 'FAIL'), name, '' if ok else info)
def du(d): return Image.open(io.BytesIO(base64.b64decode(d.split(',',1)[1]))).convert('RGBA')
def fake_model(body, variant=0):
    """Simule un modèle qui redessine l'existant (et le modifie !) et ajoute des éléments, dont un qui empiète."""
    board=du(body['zoneImage']).convert('RGB'); mask=du(body['mask'])
    out=board.copy(); d=ImageDraw.Draw(out)
    a=mask.split()[3]; W,H=a.size
    # « modèle » qui altère un tatouage existant : gros pâté sur une zone protégée encrée
    bb=board.convert('L').point(lambda v: 255 if v<128 else 0).getbbox()
    if bb: d.rectangle([bb[0]+10,bb[1]+10,bb[0]+60,bb[1]+60], fill=(0,0,0))
    # ajouts dans des zones libres (masque transparent) : feuilles larges
    free=[(x,y) for y in range(60,H-60,40) for x in range(40,W-40,40) if a.getpixel((x,y))==0 and all(a.getpixel((min(W-1,max(0,x+dx)),min(H-1,max(0,y+dy))))==0 for dx in (-35,0,35) for dy in (-35,0,35))]
    import random; random.seed(3+variant)
    picks=[]; 
    for p in random.sample(free, min(len(free),40)):
        if all(abs(p[0]-q[0])>90 or abs(p[1]-q[1])>90 for q in picks): picks.append(p)
        if len(picks)==3: break
    for (x,y) in picks:
        d.ellipse([x-30,y-18,x+30,y+18], fill=(30,30,30)); d.line([x-30,y,x+30,y], fill=(240,240,240), width=2)
    # élément qui chevauche légèrement le bord d'une zone protégée (doit être décalé ou rejeté, jamais posé sur l'existant)
    edge=[(x,y) for y in range(80,H-80,8) for x in range(60,W-60,8) if a.getpixel((x,y))==0 and a.getpixel((x+14,y))==255]
    if edge: x,y=edge[len(edge)//2]; d.ellipse([x-14,y-10,x+14,y+10], fill=(20,20,20))
    buf=io.BytesIO(); out.save(buf,'PNG'); return 'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode(), len(picks)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=A)
        ctx=await b.new_context(viewport=VP, has_touch=TOUCH); pg=await ctx.new_page(); errs=[]; delay={'s':0}; calls=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        async def route(r):
            u=r.request.url
            if u.endswith('/health'): return await r.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'ready':True,'model':'mock'}))
            body=json.loads(r.request.post_data); calls.append(body)
            i1,n=fake_model(body,0); i2,_=fake_model(body,1)
            if delay['s']: await asyncio.sleep(delay['s'])
            await r.fulfill(status=200,content_type='application/json',body=json.dumps({'images':[i1,i2]}))
        await ctx.route('**/api/ai/**',route)
        await pg.goto(URL); await pg.wait_for_function('window.InkBody && InkBody.S.project && InkBody.Body.nV>0',timeout=120000)
        await pg.click('.modal footer button'); await pg.click('text=Exemples'); await pg.wait_for_function('InkBody.S.project.library.length==3',timeout=30000)
        # tatouages existants sur le bras droit : haut du bras, avant-bras, main
        await pg.evaluate("""async () => { const {S,App,Body}=InkBody; const L=(n)=>S.project.library.find(l=>l.name.startsWith(n));
          const B=Body.bones, out=new B.torso.a.constructor(Math.sign(B.upperarm_r.a.x),0,0.3).normalize();
          const at=(bn,f,d=0.12)=>Body.closest(bn.a.clone().lerp(bn.b,f).addScaledVector(out,d));
          for (const [lib,hit,w,h,mode] of [[L('Mandala'),at(B.upperarm_r,0.5),9,9,'surface'],[L('Rose'),at(B.forearm_r,0.5),10,22,'surface'],[L('Hirondelle'),at(B.hand_r,0.4,0.08),5,4,'surface']]) {
            await App.addTattoo(lib,hit); const t=S.selected; App.update(t,{widthCm:w,heightCm:h,lockRatio:false,mode}); App.update(t,{status:'existing'}); }
          await new Promise(r=>setTimeout(r,800)); return S.tattoos.map(t=>[t.region,t.locked]); }""")
        st=await pg.evaluate("() => InkBody.S.tattoos.map(t=>[t.region,t.locked,t.status])"); print(st)
        check('Existants verrouillés par défaut', all(x[1] for x in st), st)
        # verrou dans le code : modification / suppression refusées
        g=await pg.evaluate("""() => { const {S,App}=InkBody; const t=S.tattoos[0]; const before=JSON.stringify(t); App.update(t,{widthCm:30,rotation:40}); App.remove(t.id); App.nudge(t,2,2); return [before===JSON.stringify(t), S.tattoos.includes(t)]; }""")
        check('Verrou appliqué par le code (update/remove/nudge refusés)', g==[True,True], g)
        cam="() => { document.querySelectorAll('.toast').forEach(n=>n.remove()); document.getElementById('hint').style.visibility='hidden';  const {Body,Engine}=InkBody; const u=Body.bones.upperarm_r; const t=u.b.clone(); Engine.flyTo(t,t.clone().add(new t.constructor(Math.sign(u.a.x)*1.2,0.1,0.6)),false); InkBody.App.select(null); }"
        await pg.evaluate(cam); await pg.wait_for_timeout(700); await pg.screenshot(path='a_before.png')
        snap0=await pg.evaluate("async () => JSON.stringify(await InkBody.lockedSnapshot())")
        # flux utilisateur : panneau IA, mode « Compléter autour », envoi
        await pg.evaluate("() => InkBody.AI.open()"); await pg.wait_for_timeout(1500)
        txt=await pg.inner_text('.modal')
        check('Mode « Compléter mon bras » proposé par défaut', 'générer les ajouts' in txt.lower(), txt[:200])
        await pg.screenshot(path='a_panel.png')
        await pg.fill('.modal textarea','grande rose sur l épaule, acanthe large autour du roi, liaison au coude')
        await (pg.fill('.modal input[type=password]','code') if await pg.locator('.modal input[type=password]').first.is_visible() else asyncio.sleep(0))
        await pg.click('text=Générer les ajouts'); await pg.wait_for_timeout(500)
        await consent(pg)
        await pg.wait_for_selector('.ia-bar',timeout=60000); await pg.wait_for_timeout(1500)
        bar=await pg.inner_text('.ia-bar'); print('barre :', bar.replace(chr(10),' | '), await pg.evaluate('() => InkBody.AI.preview.why'))
        sent=calls[0]; check('Envoyé : planche du bras + masque + mode ajouts', sent['mode']=='ajouts' and sent.get('zoneImage') and sent.get('mask'), list(sent.keys()))
        info=await pg.evaluate("""() => { const {S}=InkBody; const add=S.tattoos.filter(t=>t.origin==='ia'); return add.map(t=>({id:t.id,region:t.region,mode:t.mode,pending:t.pending,w:t.widthCm,h:t.heightCm})); }""")
        print(info)
        check('Ajouts posés en calques indépendants (aperçu)', len(info)>=1 and all(x['pending'] and x['mode']=='limb' for x in info), info)
        check('Ajouts sur le bras droit uniquement', all(x['region'] in ('upperarm_r','forearm_r','hand_r') for x in info), info)
        snap1=await pg.evaluate("async () => JSON.stringify(await InkBody.lockedSnapshot())")
        check('Tatouages existants identiques (paramètres + empreinte SHA-256 des images)', snap0==snap1)
        ov=await pg.evaluate("""() => { const {AI,overlapReport,S}=InkBody; const P=AI.preview; const add=S.tattoos.filter(t=>P.ids.includes(t.id)); return add.map(t=>overlapReport(P.ctx.B,[t],P.ctx.M.core)); }""")
        check('Aucun ajout sur l’encre/emprise existante (empreinte réelle recalculée)', all(o['over']==0 for o in ov), ov)
        ovm=await pg.evaluate("""() => { const {AI,overlapReport,S}=InkBody; const P=AI.preview; const add=S.tattoos.filter(t=>P.ids.includes(t.id)); return add.map(t=>overlapReport(P.ctx.B,[t],P.ctx.M.protect)); }""")
        check('Marge de protection respectée (≤ 1,5 % de rééchantillonnage en bord de marge)', all(o['over']<=max(8,o['total']*0.015) for o in ovm), ovm)
        halo=await pg.evaluate("""() => { const {AI,Board,S}=InkBody; const P=AI.preview; const c=Board.render(P.ctx.B,S.tattoos.filter(t=>P.ids.includes(t.id)),'ink'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let ink=0,white=0,clear=0;
          for(let i=0;i<d.length;i+=4){ if(d[i+3]===0) clear++; if(d[i+3]>128){ ink++; if(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]>200) white++; } } return {ink,white,clear,n:d.length/4}; }""")
        check('Ajouts : vraie transparence autour, aucun halo blanc (lisible sur fond clair et foncé)', halo['clear']/halo['n']>0.9 and halo['white']<=halo['ink']*0.02, halo)
        await pg.evaluate(cam); await pg.wait_for_timeout(700); await pg.screenshot(path='a_after.png')
        for i,(dx,dy,dz) in enumerate([(1.2,0.1,0.6),(0.2,0.1,1.3),(-0.3,0.2,-1.2)]):
            await pg.evaluate("([dx,dy,dz]) => { const {Body,Engine}=InkBody; const u=Body.bones.upperarm_r; const s=Math.sign(u.a.x); const t=u.b.clone(); Engine.flyTo(t,t.clone().add(new t.constructor(s*dx,dy,dz)),false); }", [dx,dy,dz])
            await pg.wait_for_timeout(500); await pg.screenshot(path=f'a_view{i}.png')
        # positions stables quand on tourne : géométrie des ajouts attachée au bras (près de l'axe), côté droit
        geo=await pg.evaluate("""() => { const {S,Decals,Body,Board}=InkBody; const B=Board.frame('r'); const add=S.tattoos.filter(t=>t.origin==='ia'); let far=0,tot=0; const s=Math.sign(Body.bones.upperarm_r.a.x);
          for (const t of add){ const P=Decals.objects.get(t.id).mesh.geometry.attributes.position.array; for(let i=0;i<P.length;i+=9){ tot++; const c=Board.coords(B,P[i],P[i+1],P[i+2]); if(c.r>0.12 || Math.sign(P[i])!==s) far++; } } return [far,tot]; }""")
        check('Ajouts collés au bras droit (aucun triangle hors du membre)', geo[0]==0 and geo[1]>0, geo)
        # validation puis masquage des ajouts → rendu identique à l'état antérieur
        await pg.click('.ia-bar >> text=Garder'); await pg.wait_for_timeout(400)
        await pg.evaluate("() => { const {S,App}=InkBody; for (const t of S.tattoos) if (t.origin==='ia') App.update(t,{visible:false}); }")
        await pg.evaluate(cam); await pg.wait_for_timeout(900); await pg.screenshot(path='a_hidden.png')
        dimg=ImageChops.difference(Image.open('a_before.png').convert('RGB'), Image.open('a_hidden.png').convert('RGB')); diff=dimg.crop((300,150,1150,900)).getbbox(); dimg.point(lambda v: 255 if v else 0).save('a_diff.png')
        check('Masquer les ajouts restitue exactement le rendu antérieur', diff is None, diff)
        await pg.evaluate("() => { const {S,App}=InkBody; for (const t of S.tattoos) if (t.origin==='ia') App.update(t,{visible:true}); }")
        # sauvegarde puis réouverture
        before=await pg.evaluate("async () => { await InkBody.Save.flush(); return JSON.stringify(InkBody.S.tattoos.map(t=>({id:t.id,a:t.anchor.f,b:t.anchor.b,w:t.widthCm,h:t.heightCm,m:t.mode,img:t.imageId,o:t.origin,l:t.locked}))); }")
        await pg.reload(); await pg.wait_for_function('window.InkBody && InkBody.S.project && InkBody.Body.nV>0 && InkBody.S.tattoos.length>3',timeout=120000); await pg.wait_for_timeout(1500)
        after=await pg.evaluate("() => JSON.stringify(InkBody.S.tattoos.map(t=>({id:t.id,a:t.anchor.f,b:t.anchor.b,w:t.widthCm,h:t.heightCm,m:t.mode,img:t.imageId,o:t.origin,l:t.locked})))")
        built=await pg.evaluate("() => InkBody.S.tattoos.every(t=>InkBody.Decals.objects.get(t.id))")
        check('Sauvegarde puis réouverture : calques et placements identiques', before==after and built)
        snap2=await pg.evaluate("async () => JSON.stringify(await InkBody.lockedSnapshot())")
        check('Existants toujours identiques après réouverture', json.loads(snap2)==json.loads(snap0))
        # retouche d'un seul ajout : les autres calques ne bougent pas
        others=await pg.evaluate("() => JSON.stringify(InkBody.S.tattoos.filter((t,i)=>t.origin!=='ia' || i!==InkBody.S.tattoos.findIndex(x=>x.origin==='ia')))")
        tid=await pg.evaluate("() => InkBody.S.tattoos.find(t=>t.origin==='ia').id")
        await pg.evaluate("id => InkBody.AI.open({mode:'retouche',targets:[id],side:'r',prompt:'feuillage plus large'})", tid); await pg.wait_for_timeout(1500)
        await (pg.fill('.modal input[type=password]','code') if await pg.locator('.modal input[type=password]').first.is_visible() else asyncio.sleep(0)); await pg.click('.modal button.primary:has-text("Refaire cet ajout")'); await pg.wait_for_timeout(400)
        await consent(pg); await pg.wait_for_selector('.ia-bar',timeout=60000); await pg.wait_for_timeout(800)
        await pg.click('.ia-bar >> text=Garder'); await pg.wait_for_timeout(400)
        now=await pg.evaluate("id => ({gone: !InkBody.S.tattoos.some(t=>t.id===id), others: JSON.stringify(InkBody.S.tattoos.filter(t=>t.origin!=='ia' || !t.batch || true).filter(t=>t.id!==id))})", tid)
        o1=[t for t in json.loads(others)]; o2=json.loads(now['others']); ids2={t['id']:t for t in o2}
        check('Retouche : seul l’ajout ciblé est remplacé, le reste est intact', now['gone'] and all(t['id'] in ids2 and json.dumps(ids2[t['id']],sort_keys=True)==json.dumps(t,sort_keys=True) for t in o1 if t['id']!=tid), now['gone'])
        # réponse tardive : un projet changé entre-temps n'est pas écrasé
        delay['s']=3
        await pg.evaluate("() => InkBody.AI.open({mode:'ajouts',side:'r'})"); await pg.wait_for_timeout(1200)
        await (pg.fill('.modal input[type=password]','code') if await pg.locator('.modal input[type=password]').first.is_visible() else asyncio.sleep(0)); await pg.fill('.modal textarea','test'); await pg.click('text=Générer les ajouts'); await pg.wait_for_timeout(400)
        await consent(pg); await pg.wait_for_timeout(500)
        n0=await pg.evaluate("() => { InkBody.AI.reqId++; return InkBody.S.tattoos.length; }")  # une demande plus récente part entre-temps
        await pg.wait_for_timeout(4500)
        n1=await pg.evaluate("() => [InkBody.S.tattoos.length, !!document.querySelector('.ia-bar')]")
        check('Réponse tardive ignorée (rien n’est ajouté ni écrasé)', n1[0]==n0 and not n1[1], (n0,n1))
        snap3=await pg.evaluate("async () => JSON.stringify(await InkBody.lockedSnapshot())")
        check('Existants identiques en fin de parcours', json.loads(snap3)==json.loads(snap0))
        check('Aucune erreur JS', not errs, errs[:3])
        print('RÉSUMÉ', sum(1 for r in res if r is True), '/', len(res)); await b.close()
asyncio.run(main())
