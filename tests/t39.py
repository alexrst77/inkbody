import asyncio, sys
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8770/inkbody-depot/'
A=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
P=sys.argv[1] if len(sys.argv)>1 else 'p'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=A)
        c=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=3,has_touch=True,is_mobile=True,user_agent=UA); pg=await c.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_function('window.InkBody && InkBody.S.project && InkBody.Body.nV>0',timeout=120000)
        await pg.wait_for_timeout(800); await pg.screenshot(path=f'{P}_1_guide.png')
        await pg.tap('.modal footer button'); await pg.wait_for_timeout(500); await pg.screenshot(path=f'{P}_2_home.png')
        await pg.tap('#bottombar [data-bb=left]'); await pg.wait_for_timeout(500); await pg.screenshot(path=f'{P}_3_lib.png')
        await pg.tap('text=Exemples'); await pg.wait_for_function('InkBody.S.project.library.length==3',timeout=30000); await pg.wait_for_timeout(400)
        await pg.tap('.lib-item >> nth=1'); await pg.wait_for_timeout(300); await pg.screenshot(path=f'{P}_4_libsel.png')
        await pg.tap('text=Placer sur le corps'); await pg.wait_for_timeout(400); await pg.screenshot(path=f'{P}_5_picker.png')
        await pg.tap('text=Avant-bras (dessus)'); await pg.wait_for_timeout(1500); await pg.screenshot(path=f'{P}_6_placed.png')
        await pg.evaluate("() => { const {S,App}=InkBody; App.update(S.tattoos[0],{status:'existing'}); localStorage.setItem('inkbody.ai.code','x'); InkBody.AI.st=null; InkBody.AI.open(); }"); await pg.wait_for_timeout(1200)
        await pg.fill('.modal textarea','gros tournesol sur l’épaule, feuillage autour'); await pg.evaluate("() => { InkBody.AI.st.main=null; InkBody.AI.render(InkBody.AI.bodyEl, InkBody.AI.modal); }"); await pg.wait_for_timeout(1500)
        await pg.evaluate("() => document.querySelector('.modal .sec').scrollIntoView()"); await pg.wait_for_timeout(300); await pg.screenshot(path=f'{P}_7_ai.png')
        print(await pg.evaluate("() => ({dpr: devicePixelRatio, pr: InkBody.Engine.renderer.getPixelRatio(), tris: InkBody.Body.nF, w: innerWidth})"), errs)
        await b.close()
asyncio.run(main())
