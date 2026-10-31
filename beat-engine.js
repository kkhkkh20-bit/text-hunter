/* Shared deterministic rules: no timers, randomness, or DOM in the simulation. */
(function(root){
  'use strict';
  const dirs={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]};
  function initial(){
    const map=Array.from({length:13},()=>Array(17).fill('#'));
    const line=(x,y,tx,ty)=>{const dx=Math.sign(tx-x),dy=Math.sign(ty-y);for(;;){map[y][x]=' ';if(x===tx&&y===ty)break;x+=dx;y+=dy}};
    const rect=(x,y,tx,ty)=>{line(x,y,tx,y);line(tx,y,tx,ty);line(tx,ty,x,ty);line(x,ty,x,y)};
    rect(1,1,7,11);rect(3,3,5,9);line(3,1,3,11);line(5,1,5,11);line(1,5,7,5);line(1,7,7,7);
    rect(9,1,15,11);rect(11,3,13,9);line(11,1,11,11);line(13,1,13,11);line(9,3,15,3);line(9,9,15,9);line(9,5,15,5);line(11,7,13,7);
    line(7,3,9,3);line(7,9,9,9);map[3][8]='@';map[9][8]='@';map[6][11]='&';map[6][13]='&';
    const enemies=[
      {id:1,ch:'@',x:5,y:7,dir:'right',route:[],next:0,alive:true},
      {id:2,ch:'&',x:11,y:3,dir:'right',route:[[13,3],[13,5],[11,5],[11,3]],next:0,alive:true},
      {id:3,ch:'%',x:13,y:9,dir:'left',route:[[11,9],[11,7],[13,7],[13,9]],next:0,alive:true}
    ];
    const state={map:map.map(row=>row.join('')),player:{x:3,y:7,dir:'right'},enemies,unlocks:[],turn:0,kills:0,mode:'playing',last:null};
    for(const e of enemies)e.intent=plan(state,e);
    return state;
  }
  function floor(s,x,y){return s.map[y]?.[x]===' '}
  function plan(s,e){
    if(!e.route.length)return {type:'wait'};
    let next=e.next;
    if(e.x===e.route[next][0]&&e.y===e.route[next][1])next=(next+1)%e.route.length;
    const [x,y]=e.route[next],dx=Math.sign(x-e.x),dy=Math.sign(y-e.y);
    const dir=dx?(dx>0?'right':'left'):(dy>0?'down':'up');
    if(e.dir!==dir)return {type:'turn',dir,next};
    return {type:'move',x:e.x+dx,y:e.y+dy,next};
  }
  function advance(before,dir){
    if(before.mode!=='playing'||!dirs[dir])return before;
    const [dx,dy]=dirs[dir],p=before.player,x=p.x+dx,y=p.y+dy,t=before.map[y]?.[x];
    // A blocked input does not spend a beat or rotate any opponent.
    if(t===undefined||t==='#'||(t!==' '&&!before.unlocks.includes(t)))return before;
    const s=JSON.parse(JSON.stringify(before));s.last=null;s.player.dir=dir;
    const prey=s.enemies.find(e=>e.alive&&e.x===x&&e.y===y);
    if(prey){
      const [fx,fy]=dirs[prey.dir];
      if(p.x!==prey.x-fx||p.y!==prey.y-fy){s.mode='dead';s.last={type:'collision',x,y};return s}
      prey.alive=false;s.kills++;if(!s.unlocks.includes(prey.ch))s.unlocks.push(prey.ch);
      s.last={type:'eat',x,y,ch:prey.ch};
    }else if(t!==' '){s.map[y]=s.map[y].slice(0,x)+' '+s.map[y].slice(x+1);s.last={type:'erase',x,y,ch:t}}
    s.player.x=x;s.player.y=y;s.turn++;
    if(s.kills===3){s.mode='won';return s}
    // Execute only the previously visible intentions, once per successful step.
    const occupied=new Set(s.enemies.filter(e=>e.alive).map(e=>e.x+','+e.y));
    for(const e of s.enemies){
      if(!e.alive)continue;
      const intent=e.intent;
      if(intent.type==='turn'){e.dir=intent.dir;e.next=intent.next}
      else if(intent.type==='move'){
        const key=intent.x+','+intent.y;
        if(!floor(s,intent.x,intent.y)||occupied.has(key))continue;
        if(intent.x===s.player.x&&intent.y===s.player.y){s.mode='dead';s.last={type:'attack',x:intent.x,y:intent.y};return s}
        occupied.delete(e.x+','+e.y);occupied.add(key);e.x=intent.x;e.y=intent.y;e.next=intent.next;
      }
    }
    for(const e of s.enemies)if(e.alive)e.intent=plan(s,e);
    return s;
  }
  const api={initial,advance,dirs};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BeatEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
