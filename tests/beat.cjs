const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const E=require('../beat-engine.js');
const base=(process.env.TEXT_HUNTER_URL||'http://127.0.0.1:8000')+'/beat.html';
const keys={up:'ArrowUp',right:'ArrowRight',down:'ArrowDown',left:'ArrowLeft'};
let count=0;
const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name)};
function solve(){
 const start=E.initial(),key=s=>JSON.stringify([s.player.x,s.player.y,s.map,s.enemies.map(e=>[e.alive,e.x,e.y,e.dir,e.next,e.intent]),s.unlocks]);
 const queue=[{s:start,path:[]}],seen=new Set([key(start)]);
 for(let i=0;i<queue.length&&i<50000;i++){
  const {s,path}=queue[i];
  for(const dir of Object.keys(E.dirs)){
   const next=E.advance(s,dir);if(next===s||next.mode==='dead')continue;
   if(next.mode==='won')return [...path,dir];
   const k=key(next);if(!seen.has(k)){seen.add(k);queue.push({s:next,path:[...path,dir]})}
  }
 }
 throw Error('no complete route found');
}
(async()=>{
 await check('one successful step executes exactly the previously announced enemy actions',()=>{
  const old=E.initial(),saved=JSON.stringify(old),next=E.advance(old,'right');
  assert.equal(next.turn,1);assert.equal(next.player.x,4);
  for(const e of old.enemies.filter(e=>e.intent.type==='move')){
   const actual=next.enemies.find(a=>a.id===e.id);assert.deepEqual([actual.x,actual.y],[e.intent.x,e.intent.y]);
  }
  assert.equal(JSON.stringify(old),saved);
 });
 await check('blocked input spends no turn and turns never also move',()=>{
  let s=E.initial();s=E.advance(s,'left');s=E.advance(s,'left');
  assert.equal(E.advance(s,'left'),s);
  s=E.advance(E.advance(E.initial(),'right'),'right');
  const turners=s.enemies.filter(e=>e.alive&&e.intent.type==='turn');assert.ok(turners.length);
  const next=E.advance(s,'left');
  for(const e of turners){const n=next.enemies.find(a=>a.id===e.id);assert.deepEqual([n.x,n.y],[e.x,e.y]);assert.equal(n.dir,e.intent.dir)}
 });
 await check('rear absorption unlocks matching walls; front and side contact are fatal',()=>{
  const caught=E.advance(E.advance(E.initial(),'right'),'right');assert.equal(caught.kills,1);assert.deepEqual(caught.unlocks,['@']);
  for(const [x,y,dir] of [[6,7,'left'],[5,8,'up']]){
   const s=E.initial();s.player={x,y,dir};assert.equal(E.advance(s,dir).mode,'dead');
  }
  const locked=E.initial();locked.player={x:7,y:3,dir:'right'};assert.equal(E.advance(locked,'right'),locked);
  locked.unlocks=['@'];const erased=E.advance(locked,'right');assert.equal(erased.map[3][8],' ');assert.equal(erased.turn,1);
 });
 const solution=solve();
 await check('the unmodified three-enemy board has a complete winning route',()=>{
  let s=E.initial();for(const dir of solution)s=E.advance(s,dir);
  assert.equal(s.mode,'won');assert.equal(s.kills,3);assert.ok(solution.length<80);
  console.log('Winning route: '+solution.length+' steps');
 });
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const errors=[];
 try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await check('opens without a tutorial; idle time never advances the board',async()=>{
   assert.equal((await page.goto(base)).status(),200);await page.waitForFunction(()=>!!window.__BEAT_TEST__);
   assert.ok(await page.locator('#overlay').isHidden());const first=await page.evaluate(()=>__BEAT_TEST__.snapshot());
   await page.waitForTimeout(900);assert.deepEqual(await page.evaluate(()=>__BEAT_TEST__.snapshot()),first);
  });
  await check('a full keyboard playthrough wins without state injection',async()=>{
   for(const dir of solution){await page.keyboard.press(keys[dir]);await page.waitForTimeout(25)}
   assert.equal(await page.evaluate(()=>__BEAT_TEST__.snapshot().mode),'won');
   assert.ok(await page.locator('#retry').isVisible());await page.click('#retry');
   assert.equal(await page.evaluate(()=>__BEAT_TEST__.snapshot().turn),0);
  });
  await check('invalid keyboard input does not move enemies',async()=>{
   await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
   const before=await page.evaluate(()=>__BEAT_TEST__.snapshot());await page.keyboard.press('ArrowLeft');
   assert.deepEqual(await page.evaluate(()=>__BEAT_TEST__.snapshot()),before);
  });
  await check('mobile drag holds the beat; release, cancel and blur freeze the board',async()=>{
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
   try{
    const mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base);
    const box=await mobile.locator('#board').boundingBox(),session=await context.newCDPSession(mobile);
    const x=box.x+box.width/2,y=box.y+box.height/2;
    const send=(type,points)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:points});
    await send('touchStart',[{x,y}]);await send('touchMove',[{x:x+50,y}]);
    await mobile.waitForFunction(()=>__BEAT_TEST__.snapshot().turn>=2);
    await send('touchEnd',[]);await mobile.waitForTimeout(50);
    const stopped=await mobile.evaluate(()=>__BEAT_TEST__.snapshot());assert.ok(stopped.kills>=1);
    await mobile.waitForTimeout(700);assert.deepEqual(await mobile.evaluate(()=>__BEAT_TEST__.snapshot()),stopped);
    await mobile.keyboard.press('KeyR');
    await send('touchStart',[{x,y}]);await send('touchMove',[{x,y:y-40}]);await send('touchCancel',[]);
    await mobile.waitForTimeout(50);const cancelled=await mobile.evaluate(()=>__BEAT_TEST__.snapshot());
    await mobile.waitForTimeout(400);assert.deepEqual(await mobile.evaluate(()=>__BEAT_TEST__.snapshot()),cancelled);
    await mobile.keyboard.down('ArrowDown');await mobile.evaluate(()=>window.dispatchEvent(new Event('blur')));
    const blurred=await mobile.evaluate(()=>__BEAT_TEST__.snapshot());await mobile.waitForTimeout(400);
    assert.deepEqual(await mobile.evaluate(()=>__BEAT_TEST__.snapshot()),blurred);await mobile.keyboard.up('ArrowDown');
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await mobile.screenshot({path:'/tmp/text-hunter-beat-mobile.png'});
   }finally{await context.close()}
  });
  assert.deepEqual(errors,[]);console.log(`${count} checks passed; no JavaScript page errors.`);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
