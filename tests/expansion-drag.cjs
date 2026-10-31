// Run alongside browser-smoke.cjs with the local static server running.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=process.env.TEXT_HUNTER_URL||'http://127.0.0.1:8000';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const errors=[];let count=0;
 const check=async(name,fn)=>{await fn();console.log('PASS '+name);count++};
 try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  await page.route('**/fixture.html',route=>route.fulfill({contentType:'text/html',body:html.replace('  // Small deterministic hook','  window.scenario={state,movePlayer,aiStep,hearEvent,reveal,gameNow};\n  // Small deterministic hook')}));
  await page.goto(base+'/fixture.html');
  await check('four progressive areas, locked outer network, valid and reachable enemy spawns',async()=>{
   const results=await page.evaluate(()=>{
    const s=__TEXT_HUNTER_TEST__.snapshot();
    return ['','@','@&','@&%'].map(unlock=>{
     const q=[[42,31]],seen=new Set(['42,31']);
     for(let i=0;i<q.length;i++){const[x,y]=q[i];for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,t=s.map[ny]?.[nx],k=nx+','+ny;if(t!==undefined&&(t===' '||unlock.includes(t))&&!seen.has(k)){seen.add(k);q.push([nx,ny])}}}
     return {cells:seen.size,enemies:s.enemies.filter(e=>seen.has(e.x+','+e.y)).map(e=>e.id),exit:seen.has('42,3'),invalid:s.enemies.filter(e=>s.map[e.y][e.x]!==' ')};
    });
   });
   assert.deepEqual(results.map(r=>r.cells),[43,336,607,1162]);
   assert.deepEqual(results.map(r=>r.enemies.length),[2,7,12,16]);
   assert.deepEqual(results.map(r=>r.exit),[false,false,false,true]);
   assert.deepEqual(results[3].invalid,[]);
  });
  // All route tests invoke the real movePlayer on the real generated map. Only
  // enemy positions / unlocks are controlled, without replacing movement logic.
  await page.evaluate(()=>{
   window.travel=(tx,ty)=>{
    const {state:s,movePlayer}=scenario;const key=(x,y)=>x+','+y;
    const start=key(s.player.x,s.player.y),q=[[s.player.x,s.player.y]],came=new Map([[start,null]]);
    for(let i=0;i<q.length&&!came.has(key(tx,ty));i++){
     const[x,y]=q[i];for(const[dir,dx,dy]of[['up',0,-1],['right',1,0],['down',0,1],['left',-1,0]]){
      const nx=x+dx,ny=y+dy,t=s.map[ny]?.[nx],k=key(nx,ny);
      if(t!==undefined&&(t===' '||s.unlocks.has(t))&&!came.has(k)){came.set(k,{previous:key(x,y),dir});q.push([nx,ny])}
     }
    }
    if(!came.has(key(tx,ty)))throw Error('unreachable waypoint '+key(tx,ty));
    let cursor=key(tx,ty);const route=[];while(cursor!==start){const step=came.get(cursor);route.push(step.dir);cursor=step.previous}
    for(const dir of route.reverse())if(!movePlayer(dir))throw Error('movement rejected '+dir);
    return route.length;
   };
  });
  await check('A to B to C to A completes a chosen regional loop with real gate erasure',async()=>{
   const r=await page.evaluate(()=>{
    const s=scenario.state;s.enemies.forEach(e=>e.alive=false);s.unlocks.add('@');
    const steps=[travel(42,14),travel(54,14),travel(66,31),travel(42,31)];
    return {steps,x:s.player.x,y:s.player.y,gates:[[42,27],[54,14],[47,31]].map(([x,y])=>s.map[y][x]),other:s.map[27][40]};
   });
   assert.ok(r.steps.every(n=>n>0));assert.equal(r.x,42);assert.equal(r.y,31);
   assert.deepEqual(r.gates,[' ',' ',' ']);assert.equal(r.other,'@');
  });
  await check('second B exit independently returns to a different A junction',async()=>{
   await page.keyboard.press('KeyR');
   const r=await page.evaluate(()=>{
    const s=scenario.state;s.enemies.forEach(e=>e.alive=false);s.unlocks.add('@');
    travel(42,14);travel(38,20);travel(40,24);travel(40,28);travel(42,31);
    return {gates:[s.map[27][42],s.map[27][40]],stillClosed:s.map[14][54],position:[s.player.x,s.player.y]};
   });
   assert.deepEqual(r.gates,[' ',' ']);assert.equal(r.stillClosed,'@');assert.deepEqual(r.position,[42,31]);
  });
  await check('route through other districts reaches the pursuing enemy rear and absorbs',async()=>{
   await page.keyboard.press('KeyR');
   await page.evaluate(()=>{
    const {state:s,aiStep,gameNow}=scenario;s.enemies.forEach(e=>e.alive=false);s.unlocks.add('@');
    const e=s.enemies[1];Object.assign(e,{alive:true,x:43,y:31,prevX:43,prevY:31,dir:'left',wake:0,turn:null,style:'hunter'});
    aiStep(e,gameNow()+10); // The player was actually observed before the route.
    if(e.goal.x!==42||e.goal.y!==31)throw Error('no sight memory');
    travel(42,14);travel(54,14);travel(66,31);travel(44,31);
    if(!scenario.movePlayer('left'))throw Error('rear approach rejected');
   });
   assert.equal(await page.evaluate(()=>scenario.state.mode),'absorbing');
   await page.waitForFunction(()=>scenario.state.kills===1);
   assert.equal(await page.evaluate(()=>scenario.state.mode),'playing');
  });
  await check('wall blocks sound when the actual corridor detour exceeds hearing distance',async()=>{
   await page.keyboard.press('KeyR');
   const r=await page.evaluate(()=>{
    const {state:s,hearEvent,gameNow}=scenario;s.enemies.forEach(e=>e.alive=false);
    const e=s.enemies[1];Object.assign(e,{alive:true,x:12,y:10,goal:null,zone:0});
    s.map=Array.from({length:67},()=>Array(85).fill('#'));
    for(let y=10;y<=15;y++){s.map[y][10]=' ';s.map[y][12]=' '}s.map[15][11]=' ';
    hearEvent(10,10,gameNow());const blocked=e.goal===null;
    s.map[10][11]=' ';hearEvent(10,10,gameNow());return {blocked,heard:e.goal};
   });
   assert.ok(r.blocked);assert.deepEqual(r.heard,{x:10,y:10});
  });
  await check('lost observation expires instead of reacquiring a hidden player',async()=>{
   await page.keyboard.press('KeyR');
   const r=await page.evaluate(()=>{
    const {state:s,aiStep,gameNow}=scenario;s.enemies.forEach(e=>e.alive=false);s.trail=[];
    const e=s.enemies[1];Object.assign(e,{alive:true,x:42,y:31,dir:'right',turn:null,wake:0,goal:{x:46,y:31},seenUntil:gameNow()-1});
    Object.assign(s.player,{x:40,y:28});aiStep(e,gameNow()+10);return e.goal;
   });
   assert.equal(r,null);
  });
  await check('outer exit wins without requiring every enemy to be hunted',async()=>{
   await page.keyboard.press('KeyR');
   const r=await page.evaluate(()=>{
    const s=scenario.state;s.enemies.forEach(e=>e.wake=1e9);s.unlocks=new Set(['@','&','%']);
    travel(42,14);travel(42,3);return {mode:s.mode,kills:s.kills,stage:s.stage};
   });
   assert.deepEqual(r,{mode:'won',kills:0,stage:3});
  });
  await check('actual touch: deadzone, continuous drag, turn, release and resize on canvas',async()=>{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   try{
    const mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base);
    const session=await context.newCDPSession(mobile),box=await mobile.locator('#board').boundingBox();
    const x=box.x+box.width/2,y=box.y+box.height/2;
    const send=(type,points)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:points});
    const snap=()=>mobile.evaluate(()=>__TEXT_HUNTER_TEST__.snapshot());
    await send('touchStart',[{x,y}]);await send('touchMove',[{x:x+5,y}]);await mobile.waitForTimeout(180);assert.equal((await snap()).x,42);
    await send('touchMove',[{x:x+42,y}]);await mobile.waitForTimeout(160);assert.ok((await snap()).x>42);
    await send('touchMove',[{x,y:y+45}]);await mobile.waitForFunction(()=>__TEXT_HUNTER_TEST__.snapshot().held==='down',{},{timeout:1500});assert.equal((await snap()).held,'down');
    await send('touchEnd',[]);assert.equal((await snap()).held,null);
    const stopped=await snap();await mobile.waitForTimeout(180);assert.deepEqual([(await snap()).x,(await snap()).y],[stopped.x,stopped.y]);
    await send('touchStart',[{x,y}]);await send('touchMove',[{x:x-40,y}]);
    await mobile.setViewportSize({width:844,height:390});await mobile.waitForTimeout(100);assert.equal((await snap()).held,null);
    await send('touchEnd',[]);
    const landscape=await mobile.locator('#board').boundingBox();assert.ok(landscape.y+landscape.height<=390);
    assert.equal(await mobile.locator('.dir').count(),0);
    await mobile.screenshot({path:'/tmp/text-hunter-drag-landscape.png'});
   }finally{await context.close()}
  });
  await check('holding a drag continues after absorption without lifting the finger',async()=>{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   try{
    const mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base);
    const box=await mobile.locator('#dragPad').boundingBox(),session=await context.newCDPSession(mobile);
    const x=box.x+box.width/2,y=box.y+box.height/2;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+40,y}]});
    await mobile.waitForFunction(()=>__TEXT_HUNTER_TEST__.snapshot().kills===1);
    await mobile.waitForFunction(()=>__TEXT_HUNTER_TEST__.snapshot().x>=46);
    assert.equal(await mobile.evaluate(()=>__TEXT_HUNTER_TEST__.snapshot().held),'right');
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.equal(await mobile.evaluate(()=>__TEXT_HUNTER_TEST__.snapshot().held),null);
   }finally{await context.close()}
  });
  assert.deepEqual(errors,[]);console.log(`${count} checks passed; no JavaScript page errors.`);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
