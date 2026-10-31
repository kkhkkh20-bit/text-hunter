// Run with the installed Playwright: node tests/browser-smoke.cjs
// Start first: python3 -m http.server 8000 --bind 127.0.0.1
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.TEXT_HUNTER_URL || 'http://127.0.0.1:8000';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  let passed = 0;
  const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const snapshot = () => page.evaluate(() => window.__TEXT_HUNTER_TEST__.snapshot());
    await check('real page renders and starts', async () => {
      assert.equal((await page.goto(base)).status(), 200);
      assert.equal((await snapshot()).mode, 'playing');
      assert.ok(await page.locator('#scrim').isHidden());
      assert.equal((await snapshot()).mode, 'playing');
      assert.deepEqual(await page.locator('button:visible').allTextContents(), ['일시정지']);
    });
    await check('idle notepad waits for first input and keeps the caret in an empty cell', async () => {
      const initial=await snapshot();await page.waitForTimeout(650);const idle=await snapshot();
      assert.equal(idle.started,false);assert.deepEqual(idle.enemies,initial.enemies);
      assert.deepEqual(idle.caret,{x:43,y:31});assert.equal(idle.map[idle.caret.y][idle.caret.x],' ');
      assert.equal((await page.request.get(base+'/icon.svg')).status(),200);
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.screenshot({path:'/tmp/text-hunter-notepad-desktop.png'});
      await page.emulateMedia({reducedMotion:'no-preference'});
    });
    await check('rear absorption survives pause during animation; growth and record persist', async () => {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      assert.equal((await snapshot()).mode, 'absorbing');
      await page.click('#btnPause');
      assert.equal((await snapshot()).mode, 'paused');
      const frozen = (await snapshot()).time;
      await page.waitForTimeout(350);
      assert.equal((await snapshot()).time, frozen);
      await page.click('#btnPrimary');
      await page.waitForFunction(() => window.__TEXT_HUNTER_TEST__.snapshot().kills === 1);
      const s = await snapshot();
      assert.deepEqual(s.unlocks, ['@']); assert.equal(s.ink, 1);
      assert.equal(s.speed, 1.07);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('text-hunter-v030-best')).kills), 1);
      assert.equal(await page.locator('#btnWrite').isEnabled(), true);
    });
    await check('erase @ gate opens outer maze and gives newly active enemies grace', async () => {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      const s = await snapshot();
      assert.equal(s.x, 47); assert.equal(s.stage, 1); assert.equal(s.map[31][47], ' ');
      assert.ok(s.enemies.filter(e => e.zone === 1).every(e => e.wake > s.time));
    });
    await check('written wall and combo clock freeze across pause; resume does not reset AI', async () => {
      await page.keyboard.press('Space');
      assert.equal((await snapshot()).walls.length, 1);
      await page.click('#btnPause');
      const before = await snapshot();
      await page.waitForTimeout(400);
      assert.equal((await snapshot()).time, before.time);
      assert.deepEqual((await snapshot()).walls, before.walls);
      await page.click('#btnPause');
      assert.deepEqual((await snapshot()).enemies.map(e => e.wake), before.enemies.map(e => e.wake));
    });
    await check('map, mobile layout, restart and damaged saved record', async () => {
      await page.keyboard.press('Tab'); assert.equal((await snapshot()).overview, true);
      await page.keyboard.press('Tab'); assert.equal((await snapshot()).overview, false);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.locator('.controls').isVisible());
      const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.width);
      for (const value of ['null', '{broken', '{"kills":"bad","combo":null}']) {
        await page.evaluate(v => localStorage.setItem('text-hunter-v030-best', v), value);
        await page.reload();
        assert.equal((await snapshot()).mode, 'playing');
        assert.ok(!(await page.locator('.score').textContent()).includes('NaN'));
      }
      await page.keyboard.press('KeyR'); assert.equal((await snapshot()).kills, 0);
    });

    await check('real mobile touch holds movement and releases cleanly', async () => {
      const mobile = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
      try {
        const touch = await mobile.newPage(); await touch.goto(base);
        const pad=touch.locator('#dragPad');await pad.scrollIntoViewIfNeeded();
        const box=await pad.boundingBox();const cdp=await mobile.newCDPSession(touch);
        const x=box.x+box.width/2,y=box.y+box.height/2;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+48,y}]});
        await touch.waitForTimeout(200);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        const before=await touch.evaluate(()=>__TEXT_HUNTER_TEST__.snapshot());
        assert.ok(before.x>42);
        await touch.waitForTimeout(180);
        assert.equal((await touch.evaluate(()=>__TEXT_HUNTER_TEST__.snapshot())).x,before.x);
      } finally {await mobile.close();}
    });

    // Inject a fixture seam into the served response only. Production source remains
    // untouched; controlled positions make AI timing/collision regressions repeatable.
    const fixture = await browser.newPage();
    fixture.on('pageerror', e => errors.push(e.message));
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    await fixture.route('**/fixture.html', route => route.fulfill({ contentType: 'text/html', body: html.replace('  // Small deterministic hook', '  window.scenario={state,aiStep,canEat,navigate,updateWalls,movePlayer,gameNow,playerSpeed,updateUI,hasStraightSight,hearEvent,clearSight,reveal};\n  // Small deterministic hook') }));
    await fixture.goto(`${base}/fixture.html`);
    await check('AI announces turn without instantly changing vulnerable rear', async () => {
      const r = await fixture.evaluate(() => {
        const {state:s,aiStep,canEat,gameNow}=scenario;
        s.enemies.forEach(e=>e.alive=false);
        const e=s.enemies[1]; Object.assign(e,{alive:true,x:42,y:31,dir:'right',turn:null,wake:0,goal:{x:42,y:30},seenUntil:1e9});
        Object.assign(s.player,{x:41,y:31});
        aiStep(e,gameNow()); const announced={dir:e.dir,turn:e.turn,rear:canEat(e,41,31)};
        aiStep(e,gameNow()+e.speed); return {announced,committed:e.dir};
      });
      assert.deepEqual(r.announced,{dir:'right',turn:'up',rear:true}); assert.equal(r.committed,'up');
    });
    await check('front attack warns for an AI beat; death explains the actual cause', async () => {
      const r=await fixture.evaluate(()=>{
        const {state:s,aiStep,gameNow}=scenario; const e=s.enemies[1];
        Object.assign(e,{x:42,y:31,dir:'right',turn:null,windup:0,wake:0});
        Object.assign(s.player,{x:43,y:31});s.mode='playing';
        const now=gameNow()+100;aiStep(e,now);const warned=s.mode==='playing'&&e.alertUntil>now;
        aiStep(e,now+e.speed);return {warned,mode:s.mode,body:document.querySelector('#dialogBody').textContent};
      });
      assert.ok(r.warned);assert.equal(r.mode,'dead');assert.ok(r.body.includes('경고'));
    });
    await check('temporary wall changes AI route and expiry restores it', async () => {
      const r=await fixture.evaluate(()=>{
        const {state:s,navigate,updateWalls}=scenario;s.mode='playing';s.enemies.forEach(e=>e.alive=false);
        const e={x:42,y:31}; const goal={x:46,y:31};const direct=navigate(e,goal);
        s.map[31][43]='+';s.walls=[{x:43,y:31,until:1000}];const detour=navigate(e,goal);
        updateWalls(1001);return {direct,detour,restored:navigate(e,goal)};
      });
      assert.equal(r.direct,'right');assert.notEqual(r.detour,null);assert.notEqual(r.detour,'right');assert.equal(r.restored,'right');
    });
    await check('AI loses sight at a wall and retains last observed target; speed matches cap', async () => {
      const r=await fixture.evaluate(()=>{
        const {state:s,aiStep,gameNow,hasStraightSight,playerSpeed}=scenario;s.mode='playing';s.trail=[];
        const e=s.enemies[1];Object.assign(e,{alive:true,x:42,y:31,dir:'right',turn:null,wake:0,goal:null,style:'hunter'});
        Object.assign(s.player,{x:46,y:31});s.map[31][43]=' ';
        const visible=hasStraightSight(e);aiStep(e,gameNow());const observed={...e.goal};
        s.map[31][44]='+';Object.assign(s.player,{x:46,y:32});
        const hidden=!hasStraightSight(e);aiStep(e,gameNow()+1);const remembered={...e.goal};
        s.kills=13;s.surgeUntil=0;const normal=playerSpeed();s.surgeUntil=1e9;
        return {visible,hidden,observed,remembered,normal,boosted:playerSpeed()};
      });
      assert.ok(r.visible&&r.hidden);assert.deepEqual(r.observed,{x:46,y:31});assert.deepEqual(r.remembered,r.observed);
      assert.equal(r.normal,1.4);assert.ok(Math.abs(r.boosted-1.55)<1e-9);
    });
    await check('pointer ownership, cancellation and background pause', async () => {
      await fixture.keyboard.press('KeyR');
      const held=await fixture.evaluate(()=>{
        const pad=document.querySelector('#dragPad');pad.setPointerCapture=()=>{};
        const send=(type,id,x,y)=>pad.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,button:0,bubbles:true}));
        send('pointerdown',1,100,100);send('pointermove',1,140,100);
        send('pointerdown',2,100,100);send('pointerup',2,100,100);
        const active=scenario.state.held;send('pointercancel',1,140,100);return {active,released:scenario.state.held};
      });
      assert.deepEqual(held,{active:'right',released:null});
      await fixture.evaluate(()=>window.dispatchEvent(new Event('blur')));
      assert.equal(await fixture.evaluate(()=>scenario.state.mode),'paused');
    });
    assert.deepEqual(errors, []);
    console.log(`${passed} checks passed; no JavaScript page errors.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
