# Cas de la capture : tournesol trop grand, recopie d'un existant, damier, noirs pleins, traits vers le torse
import asyncio, base64, json, io, math, random, sys
from PIL import Image, ImageDraw, ImageChops
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8770/inkbody-depot/'
A=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
G={}; res=[]
def check(n, ok, info=''): res.append(ok); print(('OK  ' if ok else 'FAIL'), n, info)
def du(d): return Image.open(io.BytesIO(base64.b64decode(d.split(',',1)[1]))).convert('RGBA')
def fake(body):
    G['body']=body
    guide=du(body['zoneImage']).convert('RGB'); W,H=guide.size; px=guide.load()
    out=Image.new('RGB',(W,H),(246,242,236)); d=ImageDraw.Draw(out)
    # le modèle « respecte à moitié » : il garde une partie du bleu
    for y in range(0,H,2):
        for x in range(0,W,2):
            r,g,b=px[x,y]
            if b>r+20 and (y//50)%2==0: out.putpixel((x,y),(186,213,255))
    # disque jaune → tournesol 1,7× trop grand, cœur noir plein
    ys=[(x,y) for y in range(0,H,4) for x in range(0,W,4) if px[x,y][0]>240 and px[x,y][2]<200]
    cx=sum(p[0] for p in ys)/len(ys); cy=sum(p[1] for p in ys)/len(ys); R=math.sqrt(len(ys)*16/math.pi)*1.7
    for k in range(22):
        a=k/22*2*math.pi; d.polygon([(cx+math.cos(a-0.12)*R*0.4,cy+math.sin(a-0.12)*R*0.4),(cx+math.cos(a)*R,cy+math.sin(a)*R),(cx+math.cos(a+0.12)*R*0.4,cy+math.sin(a+0.12)*R*0.4)],outline=(30,30,30),width=3,fill=(150,150,150))
    d.ellipse([cx-R*0.4,cy-R*0.4,cx+R*0.4,cy+R*0.4],fill=(12,12,12))
    # feuillage noir plein sur les côtés (zones blanches)
    random.seed(3)
    for _ in range(40):
        x=random.randint(0,W-1); y=random.randint(int(H*0.25),int(H*0.6))
        if px[x,y]==(255,255,255): d.ellipse([x-26,y-12,x+26,y+12],fill=(15,15,15))
    # damier près du coude
    ey=[y for y in range(H) if px[W//2,y]!=(255,255,255) and px[W//2,y][0]<120]
    E=int(G['elbowY']); bx=int(G['damierX'])
    for i in range(6):
        for j in range(6):
            if (i+j)%2==0: d.rectangle([bx+i*14,E-40+j*14,bx+i*14+13,E-40+j*14+13],fill=(10,10,10))
    # copie de l'existant (mandala) dans l'espace libre de l'avant-bras
    m=du(G['mandala']); m=m.resize((120,120)); wb=Image.new('RGB',m.size,(246,242,236)); wb.paste(m,(0,0),m)
    spot=None
    for y in range(int(cy+R/1.7)+40,H-130,10):
        for x in range(0,W-130,10):
            if all(px[x+i,y+j]==(255,255,255) for i in range(0,130,13) for j in range(0,130,13)): spot=(x,y); break
        if spot: break
    G['spot']=spot; out.paste(wb,spot)
    # traits vers le torse : haut de planche, faces avant/arrière (interdit)
    d.line([(int(G['bx0'])+10,8),(int(G['bx0'])+90,60)],fill=(0,0,0),width=6)
    buf=io.BytesIO(); out.save(buf,'PNG'); out.save('t40_fake.png'); return 'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=A)
        ctx=await b.new_context(viewport={'width':1200,'height':900}); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        async def route(r):
            u=r.request.url
            if u.endswith('/health'): return await r.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'ready':True,'model':'mock'}))
            if u.endswith('/check'):
                G['checked']=True; f=[{'what':'chess king','box':[0.3,0.0,0.7,0.2]}] if sys.argv[1:]==['vis'] else []
                return await r.fulfill(status=200,content_type='application/json',body=json.dumps({'found':f}))
            body=json.loads(r.request.post_data); await r.fulfill(status=200,content_type='application/json',body=json.dumps({'images':[fake(body),fake(body)]}))
        await ctx.route('**/api/ai/**',route)
        await pg.goto(URL); await pg.wait_for_function('window.InkBody && InkBody.S.project && InkBody.Body.nV>0',timeout=120000)
        await pg.click('.modal footer button'); await pg.evaluate('() => InkBody.Importer.samples()'); await pg.wait_for_function('InkBody.S.project.library.length==3',timeout=30000)
        info=await pg.evaluate("""async () => { const {S,App,Body,Board,Images}=InkBody; const L=(n)=>S.project.library.find(l=>l.name.startsWith(n));
          const B=Body.bones, out=new B.torso.a.constructor(Math.sign(B.upperarm_r.a.x),0,0.3).normalize(); const at=(bn,f,d=0.12)=>Body.closest(bn.a.clone().lerp(bn.b,f).addScaledVector(out,d));
          for (const [lib,hit,w,h] of [[L('Mandala'),at(B.upperarm_r,0.55),8,8],[L('Rose'),at(B.forearm_r,0.62),7,12]]) { await App.addTattoo(lib,hit); App.update(S.selected,{widthCm:w,heightCm:h,lockRatio:false}); App.update(S.selected,{status:'existing'}); }
          await new Promise(r=>setTimeout(r,500));
          const F=Board.frame('r'); const u=await Images.url(L('Mandala').imageId); const bl=await (await fetch(u)).blob(); const dataUrl=await new Promise(r=>{const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(bl);});
          const yE=F.F.segs[2].cum/F.mpp; return {elbowY:yE, bx0:F.bx0, bw:F.bw, mandala:dataUrl, damierX:F.bx0+F.bw*0.2, copyX:F.bx0+F.bw*0.62, copyY:yE+60}; }""")
        G.update(info)
        await pg.evaluate("() => { const e=InkBody.Engine; }"); await pg.wait_for_timeout(300)
        snap0=await pg.evaluate("async () => JSON.stringify(await InkBody.lockedSnapshot(true))")
        tat0=await pg.evaluate("() => JSON.stringify(InkBody.S.variant.tattoos)")
        CAM="() => { const {Engine,Body}=InkBody; const u=Body.bones.upperarm_r; const c=u.a.clone().lerp(u.b,0.6); Engine.camera.position.set(c.x+0.6*Math.sign(u.a.x),c.y+0.1,c.z+1.0); Engine.controls.target.copy(c); Engine.controls.update(); return Engine.renderOffscreen({width:400,height:600,background:'#222'}).toDataURL('image/png'); }"
        render0=await pg.evaluate(CAM)
        await pg.evaluate("() => { localStorage.setItem('inkbody.ai.code','x'); InkBody.AI.st=null; InkBody.AI.open(); }"); await pg.wait_for_timeout(1500)
        await pg.fill('.modal textarea','gros tournesol sur l’épaule, feuillage d’acanthe large autour du roi, liaison au coude vers l’avant-bras')
        await pg.wait_for_timeout(200)
        await pg.evaluate("() => { const st=InkBody.AI.st; st.main=InkBody.AI.guessMain(st.prompt); st.forbid='mandala, rose'; InkBody.AI.render(InkBody.AI.bodyEl, InkBody.AI.modal); }"); await pg.wait_for_timeout(1500)
        plan=await pg.evaluate("() => { const P=InkBody.AI.st._P; return {main:InkBody.AI.st.main, disc:P.disc, zones:P.zones.map(z=>[z.key,z.areaCm2,z.on])}; }")
        print('plan', plan)
        check('Motif principal déduit de la demande', plan['main']=='tournesol', plan['main'])
        check('Taille du tournesol calculée (disque sur l’épaule)', plan['disc'] is not None and 5<=plan['disc']['dCm']<=13, plan['disc'] and plan['disc']['dCm'])
        await pg.screenshot(path='t40_form.png')
        await pg.click('text=Générer les ajouts'); await pg.wait_for_selector('.ia-bar',timeout=120000); await pg.wait_for_timeout(800)
        bd=G['body']
        check('Prompt : références = style seulement, interdits transmis', 'reuse their motifs' not in json.dumps(bd) and bd.get('forbidden')=='mandala, rose' and bd['plan']['mainCm']>0)
        g=du(bd['zoneImage']).convert('RGB'); 
        pal=[(185,213,255),(255,255,255),(255,241,184)]; far=sum(1 for c in g.resize((256,384)).getdata() if min(sum(abs(a-b) for a,b in zip(c,q)) for q in pal)>60)
        check('Image guide sans aucun dessin de vos tatouages (bleu, blanc, jaune uniquement)', far<256*384*0.01, far)
        r=await pg.evaluate("""() => { const {AI,S,overlapReport,Board}=InkBody; const P=AI.preview; const add=S.tattoos.filter(t=>P.ids.includes(t.id));
          const forbid=document.createElement('canvas'); forbid.width=1024; forbid.height=1536; const g=forbid.getContext('2d'); g.fillRect(0,0,1024,1536); g.globalCompositeOperation='destination-out'; g.drawImage(P.ctx.P.allowed,0,0);
          const shoulder=add.find(t=>/épaule/.test(t.name));
          const a=Board.render(P.ctx.B,add,'ink'); const d=a.getContext('2d').getImageData(0,0,1024,1536).data; let s=0,n=0,full=0; for(let i=3;i<d.length;i+=4) if(d[i]>25){s+=d[i];n++; if(d[i]>235) full++;}
          return {n:add.length, names:add.map(t=>t.name), core:add.map(t=>overlapReport(P.ctx.B,[t],P.ctx.M.core).over), forb:add.map(t=>overlapReport(P.ctx.B,[t],forbid)), why:P.why, checks:P.checks, meanA:s/n/255, full:full/n,
             shoulderH: (()=>{ const ps=P.parts.filter(p=>P.ctx.P.zones[p.zone] && P.ctx.P.zones[p.zone].key==='epaule'); if(!ps.length) return null; const m=ps.sort((a,b)=>b.w*b.h-a.w*a.h)[0]; return Math.max(m.w,m.h)*P.ctx.B.mpp*100; })(), disc:P.ctx.P.disc && P.ctx.P.disc.dCm, ids:[...new Set(add.map(t=>t.imageId))].length, torso:add.map(t=>InkBody.__torso? 0:0)}; }""")
        print(json.dumps({k:v for k,v in r.items() if k!='forb'},ensure_ascii=False)); print('forb',r['forb'])
        if sys.argv[1:]==['vis']:
            check('Contrôle visuel : élément signalé retiré', not any('Tournesol' in n for n in r['names']) and any('chess king' in w for w in r['why']), (r['names'], r['why'])); print('RÉSUMÉ', sum(res),'/',len(res)); await b.close(); return
        check('Ajouts posés (calques par zone)', r['n']>=2, r['names'])
        check('Aucun ajout sur l’encre existante', all(o==0 for o in r['core']))
        check('Rien hors zones autorisées (torse, marge, main)', all(o['over']<=max(30,o['total']*0.03) for o in r['forb']), [o['over'] for o in r['forb']])
        check('Tournesol ramené à la taille calculée', r['shoulderH'] is not None and r['shoulderH']<=r['disc']*1.15, (r['shoulderH'], r['disc']))
        dbg=await pg.evaluate("""async () => { const {AI,Board,extractParts,removeCopies,S}=InkBody; const P=AI.preview; const img=await new Promise(r=>{const i=new Image(); i.onload=()=>r(i); i.src=P.raw;});
           const ex=extractParts(P.ctx.B,P.ctx.M,P.ctx.P,img,{}); const exist=[]; for (const t of Board.tattoosOn(P.ctx.B).filter(t=>!t.pending)) exist.push({t, bm: await InkBody.Images.bitmap(t.imageId)});
           return {parts:ex.parts.map(p=>[p.x0,p.y0,p.w,p.h,p.n]), exist:exist.map(e=>e.t.name), rm:(()=>{const d=[]; removeCopies(P.ctx.B,ex.parts,exist,0.7,d); return d;})()}; }""")
        print('DBG', dbg, 'spot', G.get('spot'))
        bu=await pg.evaluate("() => InkBody.AI.preview.boardUrl"); im=du(bu); bgc=Image.new('RGBA',im.size,(230,200,180,255)); bgc.alpha_composite(im); bgc.convert('RGB').save('t40_board.png')
        imgs=await pg.evaluate("""async () => { const {AI,extractParts,S,Images}=InkBody; const P=AI.preview; const img=await new Promise(r=>{const i=new Image(); i.onload=()=>r(i); i.src=P.raw;});
           const ex=extractParts(P.ctx.B,P.ctx.M,P.ctx.P,img,{}); const p=ex.parts[1]; const c=document.createElement('canvas'); c.width=p.w; c.height=p.h; const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,p.w,p.h); g.drawImage(p.canvas,0,0);
           const t=S.tattoos.find(t=>t.name.startsWith('Mandala')); const bm=await Images.bitmap(t.imageId); const c2=document.createElement('canvas'); c2.width=bm.width; c2.height=bm.height; const g2=c2.getContext('2d'); g2.fillStyle='#f0f'; g2.fillRect(0,0,bm.width,bm.height); g2.drawImage(bm,0,0);
           return [c.toDataURL(), c2.toDataURL(), t.widthCm, t.heightCm, bm.width, bm.height]; }""")
        du(imgs[0]).save('/tmp/part1.png'); du(imgs[1]).save('/tmp/mand.png'); print('mand', imgs[2:])
        check('Copie du mandala existant effacée', any('recopie' in w for w in r['why']), r['why'])
        check('Damier retiré', any('damier' in w for w in r['why']))
        check('Noirs pleins allégés (encre moyenne ≤ 0,62, < 25 % de noir plein)', r['meanA']<=0.63 and r['full']<0.25, (round(r['meanA'],2), round(r['full'],2)))
        check('Pas de calque dupliqué', r['ids']==r['n'])
        check('Contrôle visuel appelé', G.get('checked',False))
        snap1=await pg.evaluate("async () => JSON.stringify(await InkBody.lockedSnapshot(true, InkBody.AI.preview.ids))")
        check('Existants strictement identiques (données + images)', snap0==snap1)
        # torse en 3D
        tor=await pg.evaluate("() => { const {AI,S}=InkBody; const P=AI.preview; return S.tattoos.filter(t=>P.ids.includes(t.id)).map(t=>window.__torso? 0 : 0); }")
        # vues face / profil / dos
        for i,(dx,dy,dz) in enumerate([(0.2,0.1,1.3),(1.3,0.15,0.2),(0.3,0.2,-1.3)]):
            await pg.evaluate("([dx,dy,dz]) => { document.querySelectorAll('.toast,.ia-bar').forEach(n=>n.style.display='none'); const {Body,Engine}=InkBody; const u=Body.bones.upperarm_r; const c=u.a.clone().lerp(u.b,0.6); const s=Math.sign(u.a.x); Engine.camera.position.set(c.x+dx*s*0.9,c.y+dy,c.z+dz*0.9); Engine.controls.target.copy(c); Engine.controls.update(); }",[dx,dy,dz])
            await pg.wait_for_timeout(500); await pg.screenshot(path=f't40_view{i}.png')
        # Autre version : remplace (pas d'empilement)
        await pg.evaluate("() => document.querySelectorAll('.ia-bar').forEach(n=>n.style.display='')")
        n1=await pg.evaluate("() => InkBody.S.tattoos.length"); old=await pg.evaluate("() => (window.__old=InkBody.AI.preview.ids)")
        await pg.click('.ia-bar >> text=Autre version'); await pg.wait_for_function('InkBody.AI.preview && !InkBody.AI.preview.ids.some(i=>window.__old.includes(i))',timeout=90000); await pg.wait_for_timeout(500)
        n2=await pg.evaluate("() => InkBody.S.tattoos.length")
        v2=await pg.evaluate("(old) => { const P=InkBody.AI.preview; return {ids:P.ids, names:InkBody.S.tattoos.map(t=>t.name), why:P.why, oldLeft: InkBody.S.tattoos.filter(t=>old.includes(t.id)).length}; }", old)
        print('v2', v2['names'], v2['why'])
        check('« Autre version » remplace la proposition (pas d’empilement)', v2['oldLeft']==0 and n2==2+len(v2['ids']), (n1,n2))
        # Annuler : état exact
        await pg.click('.ia-bar >> text=Annuler'); await pg.wait_for_timeout(1500)
        tat1=await pg.evaluate("() => JSON.stringify(InkBody.S.variant.tattoos)")
        check('« Annuler » restaure exactement l’état antérieur', tat0==tat1)
        # Garder puis masquer tous les ajouts = avatar d'origine au pixel près
        await pg.evaluate("() => { const st=InkBody.AI.st; InkBody.AI.open(); }"); await pg.wait_for_timeout(1200)
        await pg.click('text=Générer les ajouts'); await pg.wait_for_selector('.ia-bar',timeout=120000); await pg.wait_for_timeout(600)
        await pg.click('.ia-bar >> text=Garder'); await pg.wait_for_timeout(800)
        await pg.evaluate("() => { const {S,App}=InkBody; for (const t of S.tattoos.filter(t=>t.origin==='ia')) App.update(t,{visible:false}); }"); await pg.wait_for_timeout(800)
        render1=await pg.evaluate(CAM); render0b=None
        a=du(render0).convert('RGB'); bb=du(render1).convert('RGB'); diff=ImageChops.difference(a,bb).getbbox()
        check('Ajouts masqués = avatar et tatouages d’origine (rendu identique au pixel)', diff is None, diff)
        print('errs',errs); print('RÉSUMÉ', sum(res),'/',len(res)); await b.close()
asyncio.run(main())
