import asyncio, json
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8770/inkbody-depot/'
A=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=A)
        pg=await b.new_page(viewport={'width':1200,'height':900}); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_function('window.InkBody && InkBody.S.project && InkBody.Body.nV>0',timeout=120000)
        await pg.click('.modal footer button'); await pg.evaluate('() => InkBody.Importer.samples()'); await pg.wait_for_function('InkBody.S.project.library.length==3',timeout=30000)
        r=await pg.evaluate("""async () => { const {S,Body}=InkBody; const lib=S.project.library[0]; const out=[]; const sx=Math.sign(Body.bones.upperarm_r.a.x);
          for (const side of ['r','l']) for (const z of ['epaule','biceps','bras-int','coude','avant-bras','avant-bras-int','poignet','main','cuisse','mollet','tibia','cheville','pec','cotes','ventre','omoplate','dos','nuque']) {
            await InkBody.Placer.addAt(lib,z,side); const t=S.selected; const s=Body.surface(t.anchor);
            out.push([side,z,t.region,Math.sign(s.p.x)===(side==='r'?sx:-sx)||Math.abs(s.p.x)<0.03,t.mode,t.widthCm,t.heightCm]); }
          return out; }""")
        bad=[x for x in r if not x[3] or (x[1] in ('epaule','biceps','bras-int','coude','avant-bras','avant-bras-int','poignet','main') and not any(k in x[2] for k in ('arm','hand','torso')))]
        for x in r[:18]: print(x)
        print('mauvais côté / zone :', bad)
        # molette = taille en mode Déplacer
        w0=await pg.evaluate("() => { const t=InkBody.S.selected; InkBody.setMode('move'); InkBody.App.select(t.id); return t.widthCm; }")
        print(await pg.evaluate('() => [InkBody.S.mode, !!InkBody.S.selected, InkBody.S.selected.locked, InkBody.S.selected.visible, document.elementFromPoint(600,450).id || document.elementFromPoint(600,450).className]')); await pg.evaluate("() => document.querySelectorAll('.toast').forEach(n=>n.remove())"); await pg.mouse.move(420,650); await pg.mouse.wheel(0,-400); await pg.wait_for_timeout(600)
        w1=await pg.evaluate("() => InkBody.S.selected.widthCm"); print('molette taille', w0, '->', w1)
        pin=await pg.evaluate("""async () => { const cv=InkBody.Engine.canvas, t=InkBody.S.selected; const w0=t.widthCm, r0=t.rotation;
          const ev=(type,id,x,y)=>cv.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,bubbles:true,pointerType:'touch',isPrimary:id===1}));
          ev('pointerdown',1,400,500); ev('pointerdown',2,500,500); await new Promise(r=>setTimeout(r,50)); window.__dbg=[InkBody.Interact.pointers.size, !!InkBody.Interact.pinch, InkBody.S.mode, InkBody.S.selected&&InkBody.S.selected.id]; ev('pointermove',2,600,560); await new Promise(r=>setTimeout(r,100)); window.__dbg.push(t.widthCm, InkBody.Interact.pinch && InkBody.Interact.pinch.t===t, JSON.stringify([...InkBody.Interact.pointers.entries()])); ev('pointerup',2,600,560); ev('pointerup',1,400,500);
          await new Promise(r=>setTimeout(r,300)); return [w0,InkBody.S.selected.widthCm,r0,InkBody.S.selected.rotation, InkBody.Engine.controls.enabled]; }""")
        print('pincer/tourner', pin)
        print('errs', errs); await b.close()
asyncio.run(main())
