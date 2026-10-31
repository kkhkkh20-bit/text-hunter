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
      assert.equal((await snapshot()).mode, 'intro');
      await page.click('#btnPrimary');
      assert.equal((await snapshot()).mode, 'playing');
      assert.deepEqual(await page.locator('button:visible').allTextContents(), ['일시정지']);
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
      assert.equal(s.x, 19); assert.equal(s.stage, 1); assert.equal(s.map[11][19], ' ');
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
        await page.reload(); await page.click('#btnPrimary');
        assert.equal((await snapshot()).mode, 'playing');
        assert.ok(!(await page.locator('.score').textContent()).includes('NaN'));
      }
      await page.keyboard.press('KeyR'); assert.equal((await snapshot()).kills, 0);
    });

    await check('real mobile touch holds movement and releases cleanly', async () => {
      const mobile = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
      try {
        const touch = await mobile.newPage(); await touch.goto(base); await touch.tap('#btnPrimary');
        const button=touch.locator('[data-dir=right]');await button.scrollIntoViewIfNeeded();
        const box=await button.boundingBox();const cdp=await mobile.newCDPSession(touch);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
        await touch.waitForTimeout(180);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        const before=await touch.evaluate(()=>__TEXT_HUNTER_TEST__.snapshot());
        assert.ok(before.x>14);
        await touch.waitForTimeout(180);
        assert.equal((await touch.evaluate(()=>__TEXT_HUNTER_TEST__.snapshot())).x,before.x);
      } finally {await mobile.close();}
    });

    // Inject a fixture seam into the served response only. Production source remains
    // untouched; controlled positions make AI timing/collision regressions repeatable.
    const fixture = await browser.newPage();
    fixture.on('pageerror', e => errors.push(e.message));
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    await fixture.route('**/fixture.html', route => route.fulfill({ contentType: 'text/html', body: html.replace('  // Small deterministic hook', '  window.scenario={state,aiStep,canEat,navigate,updateWalls,movePlayer,gameNow,playerSpeed,updateUI,hasStraightSight};\n  // Small deterministic hook') }));
    await fixture.goto(`${base}/fixture.html`);
    await fixture.click('#btnPrimary');
    await check('AI announces turn without instantly changing vulnerable rear', async () => {
      const r = await fixture.evaluate(() => {
        const {state:s,aiStep,canEat,gameNow}=scenario;
        s.enemies.forEach(e=>e.alive=false);
        const e=s.enemies[1]; Object.assign(e,{alive:true,x:14,y:11,dir:'right',turn:null,wake:0,goal:{x:14,y:10},seenUntil:1e9});
        Object.assign(s.player,{x:13,y:11});
        aiStep(e,gameNow()); const announced={dir:e.dir,turn:e.turn,rear:canEat(e,13,11)};
        aiStep(e,gameNow()+e.speed); return {announced,committed:e.dir};
      });
      assert.deepEqual(r.announced,{dir:'right',turn:'up',rear:true}); assert.equal(r.committed,'up');
    });
    await check('front attack warns for an AI beat; death explains the actual cause', async () => {
      const r=await fixture.evaluate(()=>{
        const {state:s,aiStep,gameNow}=scenario; const e=s.enemies[1];
        Object.assign(e,{x:14,y:11,dir:'right',turn:null,windup:0,wake:0});
        Object.assign(s.player,{x:15,y:11});s.mode='playing';
        const now=gameNow()+100;aiStep(e,now);const warned=s.mode==='playing'&&e.alertUntil>now;
        aiStep(e,now+e.speed);return {warned,mode:s.mode,body:document.querySelector('#dialogBody').textContent};
      });
      assert.ok(r.warned);assert.equal(r.mode,'dead');assert.ok(r.body.includes('경고 !'));
    });
    await check('temporary wall changes AI route and expiry restores it', async () => {
      const r=await fixture.evaluate(()=>{
        const {state:s,navigate,updateWalls}=scenario;s.mode='playing';s.enemies.forEach(e=>e.alive=false);
        const e={x:14,y:11}; const goal={x:18,y:11};const direct=navigate(e,goal);
        s.map[11][15]='+';s.walls=[{x:15,y:11,until:1000}];const detour=navigate(e,goal);
        updateWalls(1001);return {direct,detour,restored:navigate(e,goal)};
      });
      assert.equal(r.direct,'right');assert.notEqual(r.detour,null);assert.notEqual(r.detour,'right');assert.equal(r.restored,'right');
    });
    await check('AI loses sight at a wall and retains last observed target; speed matches cap', async () => {
      const r=await fixture.evaluate(()=>{
        const {state:s,aiStep,gameNow,hasStraightSight,playerSpeed}=scenario;s.mode='playing';s.trail=[];
        const e=s.enemies[1];Object.assign(e,{alive:true,x:14,y:11,dir:'right',turn:null,wake:0,goal:null,style:'hunter'});
        Object.assign(s.player,{x:18,y:11});s.map[11][15]=' ';
        const visible=hasStraightSight(e);aiStep(e,gameNow());const observed={...e.goal};
        s.map[11][16]='+';Object.assign(s.player,{x:18,y:12});
        const hidden=!hasStraightSight(e);aiStep(e,gameNow()+1);const remembered={...e.goal};
        s.kills=13;s.surgeUntil=0;const normal=playerSpeed();s.surgeUntil=1e9;
        return {visible,hidden,observed,remembered,normal,boosted:playerSpeed()};
      });
      assert.ok(r.visible&&r.hidden);assert.deepEqual(r.observed,{x:18,y:11});assert.deepEqual(r.remembered,r.observed);
      assert.equal(r.normal,1.4);assert.ok(Math.abs(r.boosted-1.55)<1e-9);
    });
    await check('pointer ownership, cancellation and background pause', async () => {
      await fixture.keyboard.press('KeyR');
      const held=await fixture.evaluate(()=>{
        for(const b of document.querySelectorAll('.dir'))b.setPointerCapture=()=>{};
        const send=(dir,type,id)=>document.querySelector(`[data-dir="${dir}"]`).dispatchEvent(new PointerEvent(type,{pointerId:id,bubbles:true}));
        send('right','pointerdown',1);send('down','pointerdown',2);send('right','pointerup',1);
        const active=scenario.state.held;send('down','pointercancel',2);return {active,released:scenario.state.held};
      });
      assert.deepEqual(held,{active:'down',released:null});
      await fixture.evaluate(()=>window.dispatchEvent(new Event('blur')));
      assert.equal(await fixture.evaluate(()=>scenario.state.mode),'paused');
    });
    assert.deepEqual(errors, []);
    console.log(`${passed} checks passed; no JavaScript page errors.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
