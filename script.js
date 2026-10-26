/* On-screen error panel: shows failed file loads and runtime errors without opening DevTools. Safe to delete. */
(function(){
  var box;
  function show(msg){
    if(!box){ box=document.createElement('div');
      box.style.cssText='position:fixed;left:0;right:0;bottom:0;max-height:45vh;overflow:auto;z-index:99999;background:#7a1f18;color:#fff;font:13px/1.45 monospace;padding:10px 14px;white-space:pre-wrap';
      (document.body||document.documentElement).appendChild(box); }
    box.textContent+=msg+'\n';
  }
  window.addEventListener('error',function(e){
    var t=e.target;
    if(t&&(t.tagName==='SCRIPT'||t.tagName==='LINK')) show('FAILED TO LOAD: '+(t.src||t.href));
    else show('ERROR: '+e.message+(e.filename?'\n   at '+e.filename.split('/').pop()+':'+e.lineno+':'+e.colno:''));
  },true);
})();

/* Main Last Sector game code */
"use strict";
/* ============================================================
   Last Sector — a raycasting FPS in one file.
   No libraries: engine, textures, sprites and audio are all
   generated at runtime.
   ============================================================ */

/* ---------- small helpers ---------- */
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[(Math.random()*a.length)|0];
const el=id=>document.getElementById(id);
// pixels are packed little-endian: 0xAABBGGRR
const RGB=(r,g,b)=>(255<<24)|((b|0)<<16)|((g|0)<<8)|(r|0);
const hex2rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];

/* ---------- audio (synthesised) ---------- */
const Audio_={
  ctx:null,
  init(){ if(this.blocked)return; try{ if(!this.ctx){ this.ctx=new (window.AudioContext||window.webkitAudioContext)();
          this.master=this.ctx.createGain(); this.master.gain.value=.5; this.master.connect(this.ctx.destination);
          this.noise=this.makeNoise(); } if(this.ctx.state==='suspended')this.ctx.resume(); }catch(err){ this.blocked=true; this.ctx=null; } },
  makeNoise(){ const c=this.ctx, len=c.sampleRate*1.2, b=c.createBuffer(1,len,c.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<len;i++)d[i]=Math.random()*2-1; return b; },
  burst({dur=.12,vol=.5,freq=900,q=1,type='lowpass',decay=.9}={}){
    if(!this.ctx)return; const c=this.ctx,t=c.currentTime;
    const s=c.createBufferSource(); s.buffer=this.noise; s.loop=true;
    const f=c.createBiquadFilter(); f.type=type; f.frequency.setValueAtTime(freq,t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80,freq*decay*.25),t+dur); f.Q.value=q;
    const g=c.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(.0008,t+dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t+dur+.02);
  },
  tone({freq=440,dur=.1,vol=.3,type='square',slide=null}={}){
    if(!this.ctx)return; const c=this.ctx,t=c.currentTime;
    const o=c.createOscillator(); o.type=type; o.frequency.setValueAtTime(freq,t);
    if(slide)o.frequency.exponentialRampToValueAtTime(slide,t+dur);
    const g=c.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(.001,t+dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t+dur+.02);
  },
  shot(kind){
    if(kind==='rifle'){ this.burst({dur:.13,vol:.45,freq:2200,decay:.5}); this.tone({freq:150,slide:60,dur:.09,vol:.22,type:'triangle'}); }
    else if(kind==='shotgun'){ this.burst({dur:.3,vol:.6,freq:1400,decay:.35}); this.tone({freq:90,slide:40,dur:.22,vol:.3,type:'triangle'}); }
    else { this.burst({dur:.1,vol:.35,freq:2600,decay:.5}); this.tone({freq:220,slide:90,dur:.07,vol:.18,type:'triangle'}); }
  },
  enemyShot(dist){ this.burst({dur:.12,vol:clamp(.32-dist*.012,.04,.32),freq:1500,decay:.45}); },
  hitmark(){ this.tone({freq:1750,dur:.05,vol:.18,type:'square'}); },
  kill(){ this.tone({freq:520,slide:900,dur:.14,vol:.2,type:'square'}); },
  hurt(){ this.burst({dur:.22,vol:.4,freq:420,decay:.4,type:'bandpass',q:.6}); },
  reloadOut(){ this.tone({freq:320,slide:180,dur:.07,vol:.16,type:'square'}); },
  reloadIn(){ this.tone({freq:190,slide:420,dur:.09,vol:.2,type:'square'}); this.burst({dur:.05,vol:.14,freq:3000}); },
  swap(){ this.tone({freq:640,slide:420,dur:.07,vol:.14,type:'triangle'}); },
  wave(){ this.tone({freq:180,slide:360,dur:.5,vol:.22,type:'sawtooth'}); },
  dry(){ this.tone({freq:140,dur:.05,vol:.2,type:'square'}); },
  jump(){ this.tone({freq:210,slide:110,dur:.1,vol:.16,type:'sine'}); },
  land(){ this.tone({freq:100,dur:.07,vol:.16,type:'sine'}); },
  down(){ this.tone({freq:300,slide:60,dur:.9,vol:.3,type:'sawtooth'}); }
};

/* ---------- procedural wall textures (64x64, themed per location) ---------- */
const TEX=64, TEXN=TEX*TEX;
const nz=(x,y,s)=>{ const n=Math.sin(x*12.9898+y*78.233)*43758.5453; return ((n-Math.floor(n))-.5)*s; };
function bake(fn){
  const a=new Uint32Array(TEXN);
  for(let y=0;y<TEX;y++)for(let x=0;x<TEX;x++){
    const c=fn(x,y);
    a[y*TEX+x]=RGB(clamp(c[0],0,255),clamp(c[1],0,255),clamp(c[2],0,255));
  }
  return a;
}
const shadeHex=(h,v)=>{ const[r,g,b]=hex2rgb(h); return [r*v,g*v,b*v]; };

// brick / block masonry
const T_brick=(base,mortar,bw=16,bh=8)=>bake((x,y)=>{
  const row=(y/bh)|0, ox=(row%2)*(bw/2);
  const ix=(x+ox)%bw, iy=y%bh;
  if(ix<1||iy<1)return shadeHex(mortar,1+nz(x,y,.14));
  return shadeHex(base,1+nz(x,y,.13)+nz(ix*0+((x+ox)/bw)|0,row,.16));
});
// rendered plaster / concrete with hairline cracks
const T_plaster=(base,crack)=>bake((x,y)=>{
  let v=1+nz(x*.6,y*.6,.26)+nz(x*3,y*3,.1);
  const c=Math.abs(Math.sin(y*.19+Math.cos(x*.11)*2.2));
  if(c<.05)return shadeHex(crack,1+nz(x,y,.2));
  return shadeHex(base,v);
});
// riveted steel panelling
const T_panel=(base,seam,rivet)=>bake((x,y)=>{
  let v=1+nz(x,y,.2);
  if(x%32===0||y%16===0)return shadeHex(seam,1+nz(x,y,.15));
  const rx=x%32, ry=y%16;
  if((rx===4||rx===27)&&(ry===4||ry===11))return shadeHex(rivet,1.1);
  return shadeHex(base,v);
});
// timber planks / crates
const T_plank=(base,gap,pw=21)=>bake((x,y)=>{
  if(y%pw<2||x%31<2)return shadeHex(gap,1+nz(x,y,.2));
  return shadeHex(base,1+Math.sin(y*.8+Math.sin(x*.05)*3)*.07+nz(x,y,.14));
});
// corrugated container steel
const T_corr=(base,w=8)=>bake((x,y)=>{
  const wave=Math.sin((x%w)/w*Math.PI);
  let v=.72+wave*.5+nz(x,y,.12);
  if(y%56<2)v*=.6;                                  // top/bottom rail
  if(Math.abs(nz(x*.2,y*.2,1))>.44)v*=.82;          // rust blotches
  return shadeHex(base,v);
});
// painted hazard band
const T_hazard=(base,accent,dark)=>bake((x,y)=>{
  if(y>38&&y<54)return ((x+y)%16<8)?shadeHex(accent,1+nz(x,y,.12)):shadeHex(dark,1+nz(x,y,.12));
  if(y%32===0)return shadeHex(dark,1);
  return shadeHex(base,1+nz(x,y,.2));
});
// pipes and conduit running up the wall
const T_pipes=(base,pipe,shadow)=>bake((x,y)=>{
  const p=x%22;
  if(p<9){ const r=Math.sin(p/9*Math.PI); if(p===0||p===8)return shadeHex(shadow,1);
           return shadeHex(pipe,.6+r*.75+nz(x,y,.08)); }
  if(y%18===0)return shadeHex(shadow,1);
  return shadeHex(base,1+nz(x,y,.18));
});
// scorched, shrapnel-pocked wall
const T_scorch=(base,burn)=>bake((x,y)=>{
  const b=nz(x*.35,y*.35,1)+nz(x*1.4,y*1.4,.5);
  if(b>.42)return shadeHex(burn,.8+nz(x,y,.3));
  if(y>50)return shadeHex(burn,1+nz(x,y,.2));
  return shadeHex(base,1+nz(x,y,.22));
});
// frosted metal siding
const T_frost=(base,ice)=>bake((x,y)=>{
  const wave=Math.sin((x%10)/10*Math.PI);
  let v=.78+wave*.4+nz(x,y,.14);
  if(nz(x*.5,y*.5,1)+y/TEX>.86)return shadeHex(ice,.9+nz(x,y,.2));
  return shadeHex(base,v);
});

let TEXTURES=[];

/* ---------- locations ---------- */
/* Each level is a place with its own build rules, light and haze. */
const LEVELS=[
  {
    name:'Dust Quarter', where:'Khareb market road · 06:40',
    brief:'Low sandstone shophouses either side of a market road. Wide sight-lines, almost no roof — the sun is up and so is everyone shooting at you.',
    waves:3,
    textures:()=>[null,T_brick('#c2a173','#8c7150'),T_plaster('#d8bd92','#8f7a5b'),T_plank('#9c6f3f','#4a3320'),T_hazard('#cdb28a','#d8a23c','#6a583f')],
    sky:['#bcd9ea','#5d8db3'], ground:['#8a755a','#c8ae86'],
    fog:'#dbcaa9', fogAmt:.45, fogDist:36, ambient:1.22,
    build:{buildings:9,wMin:4,wMax:7,hMin:4,hMax:6,cover:10,types:[1,1,2,2,3,4],coverTypes:[3,4]},
    mix:['grunt','grunt','grunt','runner']
  },
  {
    name:'Harbour Yard', where:'Pier 12 container stacks · 19:15',
    brief:'Shipping containers stacked into blind alleys. Sea fog cuts your range to almost nothing, so anything you can see can already see you.',
    waves:3,
    textures:()=>[null,T_corr('#3f7a84'),T_corr('#a84f3a'),T_panel('#4a545c','#2a3138','#7d8790'),T_hazard('#49535b','#e0a63a','#20262c')],
    sky:['#526a7e','#1d2935'], ground:['#3b444d','#727c86'],
    fog:'#556d82', fogAmt:.6, fogDist:26, ambient:1.08,
    build:{buildings:10,wMin:3,wMax:6,hMin:3,hMax:5,cover:16,types:[1,1,2,2,3,4],coverTypes:[3,1]},
    mix:['grunt','runner','runner','grunt','heavy']
  },
  {
    name:'Deep Bunker', where:'Sub-level 3, reactor ring · no daylight',
    brief:'Poured concrete corridors under the compound. Emergency lighting only, long straight halls, and nowhere at all to fall back to.',
    waves:4,
    indoor:true,
    textures:()=>[null,T_plaster('#6e6f6a','#33342f'),T_pipes('#5a5d63','#8a6b3c','#24262a'),T_panel('#4e555c','#282d33','#868f98'),T_hazard('#565c62','#c94f3a','#23272b')],
    sky:['#2f353c','#14171b'], ground:['#262a2f','#5b626a'],
    fog:'#3a2b2c', fogAmt:.55, fogDist:24, ambient:1.06,
    build:{buildings:7,wMin:5,wMax:9,hMin:4,hMax:6,cover:6,types:[1,1,2,3,4],coverTypes:[3,4]},
    mix:['grunt','heavy','grunt','runner','heavy']
  },
  {
    name:'Whiteout Station', where:'Arctic relay mast · wind 60kt',
    brief:'A radar station half-buried in drift snow. Everything is flat, bright and open, and the glare hides muzzle flashes until they are on top of you.',
    waves:4,
    textures:()=>[null,T_frost('#8fa6b4','#e6f1f7'),T_panel('#7c8a95','#4c565e','#cfe0ea'),T_plaster('#b9c8d2','#69767f'),T_hazard('#8b98a3','#e3583f','#39424a')],
    sky:['#dcebf6','#8fb0c9'], ground:['#b6c7d5','#f1f7fb'], 
    fog:'#e9f2f9', fogAmt:.5, fogDist:30, ambient:1.2,
    build:{buildings:6,wMin:5,wMax:8,hMin:4,hMax:7,cover:9,types:[1,1,2,3,4],coverTypes:[3,4]},
    mix:['runner','runner','grunt','heavy']
  },
  {
    name:'Ember District', where:'City block 9 · still burning',
    brief:'What is left of a residential block after the shelling. Collapsed masonry for cover, fires throwing light in every direction, and the heaviest squads they have.',
    waves:5,
    textures:()=>[null,T_scorch('#6d5a4e','#2b2320'),T_brick('#8a4e3c','#2e211c'),T_plaster('#6a6058','#2a2522'),T_hazard('#5d514a','#e0721f','#241e1a')],
    sky:['#8a4a2c','#231613'], ground:['#3d2f27','#826b58'],
    fog:'#9c5423', fogAmt:.52, fogDist:28, ambient:1.12,
    build:{buildings:11,wMin:4,wMax:7,hMin:4,hMax:6,cover:14,types:[1,1,2,2,3,4],coverTypes:[3,2]},
    mix:['heavy','grunt','runner','grunt','heavy','runner']
  }
];
let levelIndex=0, L=LEVELS[0];

// endless mode: one big open field, no building interiors, waves never stop
const LAST_STAND={
  name:'Open Ground', where:'Unmarked frontier · overcast, no cover but your own',
  brief:'Flat scrubland with scattered rock and rubble cover. No walls to hide inside — just distance, cover and whatever you can hold. There is no final wave. Survive as long as you can.',
  waves:Infinity, endless:true,
  textures:()=>[null,T_plaster('#8a7f68','#4f473a'),T_hazard('#9c8f74','#d8a23c','#4f473a'),T_plank('#75664c','#332c20'),T_hazard('#8a7f68','#c94f3a','#3a352a')],
  sky:['#9fb0bb','#48586a'], ground:['#6d6250','#a89876'],
  fog:'#a9b3ba', fogAmt:.28, fogDist:60, ambient:1.18,
  build:{buildings:0,cover:46,barriers:14,types:[1,1,2,3,4],coverTypes:[2,3,4]},
  mix:['grunt','grunt','runner','heavy']
};
let mode='campaign'; // 'campaign' | 'laststand'

/* ---------- enemy sprites (pixel art -> texture) ---------- */
const SPR_W=16,SPR_H=22;
const PAL={H:'#23282e',F:'#2c333b',E:'#e0c353',S:'#c2926b',V:'#39444f',U:'#4c5a45',B:'#171b1f',G:'#101316',R:'#b3402c',M:'#ffd98a'};
const FRAME_TOP=[
'     HHHHHH     ',
'    HHHHHHHH    ',
'    HHHHHHHH    ',
'    HFFFFFFH    ',
'    HFEEEEFH    ',
'     FFSSFF     ',
'      FSSF      ',
'    UVVVVVVU    ',
'   UUVRRRRVUU   ',
'  GUUVVVVVVUU   ',
'  GGGVVVVVVUUS  ',
'   GGGVVVVUUS   ',
'    UUVVVVUU    ',
'     UUUUUU     '];
const LEGS_A=['     UU UU      ','     UU  UU     ','     UU  UU     ','     UU  UU     ','    BBB  BBB    ','    BBB  BBB    ','                ','                '];
const LEGS_B=['     UUUUUU     ','     UU UU      ','    UU    UU    ','   UU      UU   ','  BBB      BBB  ','  BBB      BBB  ','                ','                '];
const FLASH  =['                ','                ','                ','                ','                ','                ','                ','                ','                ',' M              ','MM              ',' M              ','                ','                ','                ','                ','                ','                ','                ','                ','                ','                '];

function buildSprite(rows,tint,flash){
  const out=new Uint32Array(SPR_W*SPR_H); // 0 = transparent
  for(let y=0;y<SPR_H;y++){
    const line=(rows[y]||'').padEnd(SPR_W,' ');
    const fl=flash?(FLASH[y]||'').padEnd(SPR_W,' '):null;
    for(let x=0;x<SPR_W;x++){
      let ch=line[x];
      if(fl&&fl[x]!==' ')ch=fl[x];
      if(ch===' '||!PAL[ch])continue;
      let [r,g,b]=hex2rgb(PAL[ch]);
      if(tint&&ch!=='M'&&ch!=='E'){ r=clamp(r*tint[0],0,255); g=clamp(g*tint[1],0,255); b=clamp(b*tint[2],0,255); }
      out[y*SPR_W+x]=RGB(r,g,b);
    }
  }
  // silhouette outline: keeps figures readable against any wall or fog
  const ring=RGB(8,9,11);
  const copy=out.slice();
  for(let y=0;y<SPR_H;y++)for(let x=0;x<SPR_W;x++){
    if(copy[y*SPR_W+x])continue;
    let near=false;
    for(let j=-1;j<=1&&!near;j++)for(let i=-1;i<=1;i++){
      const nx=x+i, ny=y+j;
      if(nx<0||ny<0||nx>=SPR_W||ny>=SPR_H)continue;
      if(copy[ny*SPR_W+nx]){near=true;break;}
    }
    if(near)out[y*SPR_W+x]=ring;
  }
  return out;
}
function spriteSet(tint){
  return {
    walkA:buildSprite(FRAME_TOP.concat(LEGS_A),tint,false),
    walkB:buildSprite(FRAME_TOP.concat(LEGS_B),tint,false),
    fire :buildSprite(FRAME_TOP.concat(LEGS_A),tint,true)
  };
}
const SPRITES={
  grunt :spriteSet([1,1,1]),
  runner:spriteSet([.8,1.05,1.15]),
  heavy :spriteSet([1.2,.85,.75])
};
// one CanvasTexture per type/frame, shared across every enemy instance of that type
let ENEMY_TEX=null;
function buildEnemyTextures(){
  ENEMY_TEX={};
  Object.keys(SPRITES).forEach(type=>{
    ENEMY_TEX[type]={
      walkA:texFromPixels(SPRITES[type].walkA,SPR_W,SPR_H),
      walkB:texFromPixels(SPRITES[type].walkB,SPR_W,SPR_H),
      fire :texFromPixels(SPRITES[type].fire,SPR_W,SPR_H)
    };
  });
}

/* ---------- operator (player) skins, for the third-person camera ---------- */
const CHARACTERS=[
  {id:'ranger', name:'RANGER', tag:'Balanced', tint:[1,1,1],       blurb:'Standard-issue Task Force 114 kit. No specialism, no weakness.'},
  {id:'recon',  name:'RECON',  tag:'Light', tint:[.72,.98,.82],    blurb:'Stripped-down loadout worn lighter and quieter, built for scouting ahead.'},
  {id:'siege',  name:'SIEGE',  tag:'Armoured', tint:[1.18,.78,.7], blurb:'Heavier plating, built to eat hits and hold a doorway.'}
];
/* ---------- tactical operator sprites (player + buddy) ---------- */
// Helmet, rails, dark goggles, balaclava, plate carrier and carbine, with a warm
// amber rim light from the left. Drawn procedurally at 48x66 (same aspect as the 16x22 enemies).
const OPW=48, OPH=66;
function makeOperator(tint,variant,frame){
  const cvs=document.createElement('canvas'); cvs.width=OPW; cvs.height=OPH;
  const c=cvs.getContext('2d'); c.imageSmoothingEnabled=false;
  const tn=hex=>{ const q=hex2rgb(hex); return 'rgb('+(clamp(q[0]*tint[0],0,255)|0)+','+(clamp(q[1]*tint[1],0,255)|0)+','+(clamp(q[2]*tint[2],0,255)|0)+')'; };
  const R=(x,y,w,h,col)=>{ c.fillStyle=col; c.fillRect(x,y,w,h); };
  const K={shell:tn('#2b2e31'),shellHi:tn('#444a50'),gear:tn('#212428'),gearHi:tn('#323840'),plate:tn('#2a2e33'),plateHi:tn('#434a52'),
           blk:tn('#141618'),deep:tn('#0b0c0e'),pants:tn('#202327'),knee:tn('#30353a'),boot:tn('#101214'),glove:tn('#18191b'),lens:tn('#06070a')};
  const AMB='#e0963a', AMBH='#ffc870', AMBD='#a8691f';
  const siege=variant==='siege', recon=variant==='recon';

  // legs
  if(frame==='A'){
    R(14,46,8,16,K.pants); R(26,46,8,16,K.pants);
    R(14,53,8,4,K.knee); R(26,53,8,4,K.knee);
    R(12,60,10,5,K.boot); R(26,60,10,5,K.boot);
  } else {
    R(13,46,8,8,K.pants); R(27,46,8,8,K.pants);
    R(9,53,8,8,K.pants); R(31,53,8,8,K.pants);
    R(9,55,8,3,K.knee); R(31,55,8,3,K.knee);
    R(6,60,10,5,K.boot); R(32,60,10,5,K.boot);
  }
  if(siege){ R(10,46,6,6,K.plate); R(32,46,6,6,K.plate); R(10,46,6,1,K.plateHi); R(32,46,6,1,K.plateHi); }

  // plate carrier
  R(11,27,26,19,K.gear); R(11,27,26,1,K.gearHi);
  if(siege){ R(5,25,11,9,K.plate); R(32,25,11,9,K.plate); R(5,25,11,1,K.plateHi); R(32,25,11,1,K.plateHi); }
  else if(recon){ R(10,27,5,4,K.gearHi); R(33,27,5,4,K.gearHi); }
  else { R(7,26,9,7,K.gearHi); R(32,26,9,7,K.gearHi); R(7,26,9,1,K.plateHi); R(32,26,9,1,K.plateHi); }
  const px=siege?14:16, pw=siege?20:16;
  R(px,29,pw,12,K.plateHi); R(px+1,30,pw-2,10,K.plate);
  for(let y=33;y<=38;y+=3) R(px+1,y,pw-2,1,K.gear);
  [13,21,29].forEach(x=>{ R(x,41,6,4,K.blk); R(x,41,6,1,K.gearHi); });
  R(11,45,26,2,K.deep); R(22,45,4,2,K.gearHi);

  // arms (behind the weapon)
  R(35,28,6,10,K.gear); R(35,28,6,1,K.gearHi); R(27,36,10,4,K.gear);
  R(6,28,6,9,K.gear);  R(6,28,6,1,K.gearHi);  R(5,34,9,4,K.gear);

  // carbine
  R(14,33,18,4,K.blk); R(14,33,18,1,K.gearHi);
  R(3,33,12,4,K.gear);
  for(let x=4;x<14;x+=2) R(x,32,1,1,K.gearHi);
  R(0,34,4,2,K.deep); R(0,34,1,1,AMBH);
  R(17,29,7,4,K.deep); R(17,29,7,1,K.gearHi); R(17,30,1,2,AMB); R(18,32,5,1,K.gear);
  R(21,37,4,8,K.deep); R(21,37,4,1,K.gearHi);
  R(8,37,3,5,K.deep); R(8,41,3,1,AMBH);

  // gloves over the weapon
  R(4,33,6,5,K.glove); R(4,33,6,1,K.gearHi); R(5,35,1,1,K.gearHi); R(7,35,1,1,K.gearHi);
  R(24,34,6,6,K.glove); R(24,34,6,1,K.gearHi); R(25,37,1,1,K.gearHi); R(27,37,1,1,K.gearHi);

  // head: balaclava, helmet, goggles
  R(19,22,10,6,K.blk); R(15,16,18,8,K.blk); R(17,23,14,2,K.blk);
  if(siege){ R(16,24,16,4,K.plate); R(16,24,16,1,K.plateHi); }
  R(18,2,12,1,K.shell); R(14,3,20,1,K.shell); R(12,4,24,1,K.shell); R(10,5,28,5,K.shell); R(9,10,30,4,K.shell);
  R(19,3,10,2,K.shellHi); R(11,6,3,1,K.shellHi);
  if(siege) R(9,11,30,2,K.plateHi);
  R(8,6,3,6,K.gearHi); R(37,6,3,6,K.gearHi); R(8,7,1,1,K.shellHi); R(8,9,1,1,K.shellHi); R(39,7,1,1,K.shellHi); R(39,9,1,1,K.shellHi);
  R(8,12,4,9,K.shell); R(36,12,4,9,K.shell); R(8,12,1,9,K.shellHi);
  R(21,4,6,5,K.deep); R(22,5,4,1,K.gearHi); R(23,9,2,1,K.gearHi);
  R(11,13,26,7,K.deep); R(13,14,22,5,K.lens);
  R(15,17,1,1,AMB); R(16,16,1,1,AMB); R(17,15,1,1,AMBH); R(29,17,1,1,AMBD); R(30,16,1,1,AMBD);
  R(21,22,6,1,K.gear);
  R(10,6,1,6,AMBD); R(9,14,1,5,AMBD);
  if(recon){ R(11,20,1,3,K.deep); R(12,22,3,1,K.deep); R(38,10,1,17,K.deep); R(38,10,1,1,AMB); }

  // amber rim light from the left, cool and dark on the right
  c.globalCompositeOperation='source-atop';
  let g=c.createLinearGradient(0,0,OPW*.7,0);
  g.addColorStop(0,'rgba(255,150,40,.34)'); g.addColorStop(.5,'rgba(255,140,40,.07)'); g.addColorStop(1,'rgba(255,140,40,0)');
  c.fillStyle=g; c.fillRect(0,0,OPW,OPH);
  g=c.createLinearGradient(0,0,0,24);
  g.addColorStop(0,'rgba(255,175,80,.18)'); g.addColorStop(1,'rgba(255,175,80,0)');
  c.fillStyle=g; c.fillRect(0,0,OPW,24);
  c.globalCompositeOperation='source-over';

  // dark outline so the figure stays readable against bright levels
  const img=c.getImageData(0,0,OPW,OPH), u=new Uint32Array(img.data.buffer), copy=u.slice(), ring=RGB(8,9,11);
  for(let y=0;y<OPH;y++)for(let x=0;x<OPW;x++){
    if(copy[y*OPW+x])continue;
    let near=false;
    for(let j=-1;j<=1&&!near;j++)for(let i=-1;i<=1;i++){
      const nx=x+i, ny=y+j; if(nx<0||ny<0||nx>=OPW||ny>=OPH)continue;
      if(copy[ny*OPW+nx]){ near=true; break; }
    }
    if(near)u[y*OPW+x]=ring;
  }
  c.putImageData(img,0,0);
  return {u32:u.slice(), canvas:cvs};
}

let selectedCharacter=0;
let PLAYER_TEX_SET=null, PLAYER_TEX=null;
function buildPlayerTextures(){
  PLAYER_TEX_SET=CHARACTERS.map(c=>{
    const a=makeOperator(c.tint,c.id,'A'), b=makeOperator(c.tint,c.id,'B');
    c.preview=b.canvas;
    return{ walkA:texFromPixels(a.u32,OPW,OPH), walkB:texFromPixels(b.u32,OPW,OPH) };
  });
  PLAYER_TEX=PLAYER_TEX_SET[selectedCharacter];
}

/* ---------- map ---------- */
let MW=28,MH=28;
let map=new Uint8Array(MW*MH);
let mapCover=new Uint8Array(MW*MH); // 1 = a scattered cover object, not a building wall
const at=(x,y)=>(x<0||y<0||x>=MW||y>=MH)?1:map[y*MW+x];
const solid=(x,y)=>at(x|0,y|0)>0;
// re-sizes the grid for maps that aren't the standard 28x28 (e.g. the open Last Stand field)
function setMapSize(w,h){
  MW=w; MH=h;
  map=new Uint8Array(MW*MH);
  mapCover=new Uint8Array(MW*MH);
}

/* Compound generator: hollow rectangular buildings with doorways, linked by
   open courtyards, plus scattered single-cell cover (crates/barricades) in
   the gaps between them — a layout that reads as a place, not a maze. */
function buildMap(cfg){
  cfg=cfg||L.build;
  map.fill(0); mapCover.fill(0);
  const wallType=cfg.types[0], accentType=cfg.types[cfg.types.length-1];
  for(let x=0;x<MW;x++){ map[x]=wallType; map[(MH-1)*MW+x]=wallType; }
  for(let y=0;y<MH;y++){ map[y*MW]=wallType; map[y*MW+MW-1]=wallType; }

  const rects=[]; // placed building footprints, for overlap + door bookkeeping
  const overlaps=(x,y,w,h)=>rects.some(r=>
    x-1<r.x+r.w+1 && x+w+1>r.x-1 && y-1<r.y+r.h+1 && y+h+1>r.y-1);

  const nBuildings=cfg.buildings;
  for(let t=0;t<nBuildings*10 && rects.length<nBuildings;t++){
    const w=cfg.wMin+((Math.random()*(cfg.wMax-cfg.wMin+1))|0);
    const h=cfg.hMin+((Math.random()*(cfg.hMax-cfg.hMin+1))|0);
    const x=3+((Math.random()*(MW-w-6))|0), y=3+((Math.random()*(MH-h-6))|0);
    if(overlaps(x,y,w,h))continue;
    const type=pick(cfg.types);
    // draw the four walls of the building; interior stays open floor
    for(let i=0;i<w;i++){ map[y*MW+(x+i)]=type; map[(y+h-1)*MW+(x+i)]=type; }
    for(let j=0;j<h;j++){ map[(y+j)*MW+x]=type; map[(y+j)*MW+(x+w-1)]=type; }
    // one or two doorways per building, never on a corner
    const doorCount=w>=6&&h>=6?2:1;
    const edges=[];
    for(let i=1;i<w-1;i++){ edges.push([x+i,y]); edges.push([x+i,y+h-1]); }
    for(let j=1;j<h-1;j++){ edges.push([x,y+j]); edges.push([x+w-1,y+j]); }
    for(let d=0;d<doorCount;d++){
      const [dx,dy]=edges.splice((Math.random()*edges.length)|0,1)[0];
      map[dy*MW+dx]=0;
    }
    // larger buildings get one interior partition, so there's a room to clear
    if(w>=7&&h>=6&&Math.random()<.6){
      const vertical=Math.random()<.5;
      if(vertical){ const px=x+2+((Math.random()*(w-4))|0);
        for(let j=1;j<h-1;j++)map[(y+j)*MW+px]=type;
        map[(y+1+((Math.random()*(h-2))|0))*MW+px]=0; }
      else { const py=y+2+((Math.random()*(h-4))|0);
        for(let i=1;i<w-1;i++)map[py*MW+(x+i)]=type;
        map[py*MW+(x+1+((Math.random()*(w-2))|0))]=0; }
    }
    rects.push({x,y,w,h});
  }

  // scattered single-cell cover in the courtyards between buildings
  const insideAnyBuilding=(x,y)=>rects.some(r=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h);
  for(let t=0;t<cfg.cover;t++){
    const x=3+((Math.random()*(MW-6))|0), y=3+((Math.random()*(MH-6))|0);
    if(map[y*MW+x]!==0||insideAnyBuilding(x,y))continue;
    map[y*MW+x]=pick(cfg.coverTypes||[accentType]);
    mapCover[y*MW+x]=1;
  }

  // clear a safe insertion pocket at the centre for the player to drop into
  for(let y=(MH/2|0)-2;y<(MH/2|0)+2;y++)for(let x=(MW/2|0)-2;x<(MW/2|0)+2;x++)map[y*MW+x]=0;

  fixConnectivity();
}

/* Open-field generator for Last Stand: perimeter wall only, no rooms or
   corridors — just knee-high cover (rocks, sandbags, short rubble runs)
   scattered across one big field, so sightlines stay wide like a battlefield
   map instead of a building maze. */
function buildOpenMap(cfg){
  cfg=cfg||L.build;
  map.fill(0); mapCover.fill(0);
  const wallType=cfg.types[0];
  for(let x=0;x<MW;x++){ map[x]=wallType; map[(MH-1)*MW+x]=wallType; }
  for(let y=0;y<MH;y++){ map[y*MW]=wallType; map[y*MW+MW-1]=wallType; }
  const cx=MW/2, cy=MH/2, clearR=5; // keep a wide, obstacle-free drop zone at the centre

  // short broken barrier runs — 2 to 5 tiles of low cover in a line
  const barriers=cfg.barriers||10;
  for(let t=0;t<barriers;t++){
    const horizontal=Math.random()<.5;
    const len=2+((Math.random()*4)|0);
    const x=3+((Math.random()*(MW-6))|0), y=3+((Math.random()*(MH-6))|0);
    for(let i=0;i<len;i++){
      const px=horizontal?x+i:x, py=horizontal?y:y+i;
      if(px<2||py<2||px>=MW-2||py>=MH-2)continue;
      if(Math.hypot(px-cx,py-cy)<clearR)continue;
      map[py*MW+px]=pick(cfg.coverTypes||[cfg.types[cfg.types.length-1]]);
      mapCover[py*MW+px]=1;
    }
  }
  // loose single-cell cover (rocks/crates) spread across the open ground
  for(let t=0;t<cfg.cover;t++){
    const x=3+((Math.random()*(MW-6))|0), y=3+((Math.random()*(MH-6))|0);
    if(map[y*MW+x]!==0)continue;
    if(Math.hypot(x-cx,y-cy)<clearR)continue;
    map[y*MW+x]=pick(cfg.coverTypes||[cfg.types[cfg.types.length-1]]);
    mapCover[y*MW+x]=1;
  }
  fixConnectivity();
}

// guarantees every open floor tile can be reached: floods from the centre,
// and if anything is cut off, knocks a doorway through the nearest wall
function fixConnectivity(){
  let guard=0;
  while(guard++<60){
    const seen=new Uint8Array(MW*MH);
    const start=[(MW/2|0),(MH/2|0)];
    const q=[start]; seen[start[1]*MW+start[0]]=1;
    while(q.length){
      const [x,y]=q.pop();
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx,ny=y+dy;
        if(nx<1||ny<1||nx>=MW-1||ny>=MH-1)continue;
        const i=ny*MW+nx;
        if(seen[i]||map[i]>0)continue;
        seen[i]=1; q.push([nx,ny]);
      }
    }
    // find an unreached open cell touching a wall that borders reached ground
    let fixed=false;
    for(let y=1;y<MH-1&&!fixed;y++)for(let x=1;x<MW-1&&!fixed;x++){
      const i=y*MW+x;
      if(map[i]>0||seen[i])continue;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const wx=x+dx,wy=y+dy, wi=wy*MW+wx;
        if(wx<1||wy<1||wx>=MW-1||wy>=MH-1||map[wi]===0)continue;
        const bx=wx+dx,by=wy+dy, bi=by*MW+bx;
        if(bx<1||by<1||bx>=MW-1||by>=MH-1)continue;
        if(map[bi]===0&&seen[bi]){ map[wi]=0; fixed=true; break; }
      }
    }
    if(!fixed)break;
  }
}

/* ---------- weapons ---------- */
const WEAPONS=[
  {id:'rifle', name:'MK-4 CARBINE', tag:'1 CARBINE', dmg:26, rpm:0.085, mag:30, reserve:240, maxRes:240,
   auto:true, pellets:1, spread:.018, adsSpread:.006, recoil:2.1, kick:9, reload:1.55, range:26, sound:'rifle'},
  {id:'shotgun', name:'M90 BREACHER', tag:'2 BREACHER', dmg:20, rpm:0.75, mag:7, reserve:56, maxRes:56,
   auto:false, pellets:9, spread:.085, adsSpread:.055, recoil:7, kick:26, reload:2.1, range:11, sound:'shotgun'},
  {id:'pistol', name:'P-17 SIDEARM', tag:'3 SIDEARM', dmg:38, rpm:0.15, mag:14, reserve:120, maxRes:120,
   auto:false, pellets:1, spread:.012, adsSpread:.003, recoil:3.4, kick:13, reload:1.2, range:20, sound:'pistol'},
  {id:'smg', name:'V-9 SMG', tag:'4 SMG', dmg:14, rpm:0.055, mag:40, reserve:320, maxRes:320,
   auto:true, pellets:1, spread:.032, adsSpread:.014, recoil:1.3, kick:6, reload:1.7, range:16, sound:'pistol'},
  {id:'sniper', name:'LR-50 SNIPER', tag:'5 SNIPER', dmg:120, rpm:1.05, mag:5, reserve:35, maxRes:35,
   auto:false, pellets:1, spread:.01, adsSpread:.0008, recoil:9, kick:30, reload:2.6, range:44, sound:'rifle'}
];

/* ---------- state ---------- */
const P={x:14,y:14,dx:1,dy:0,pitch:0,health:100,maxHealth:100,speed:3.05,alive:true,lastHit:-99};
let guns=[],curGun=0,ads=false,shake=0,recoilKick=0,bob=0,bobPhase=0,fireCd=0,reloading=0,swapT=0;
// camera
let camPitch=0,camRoll=0,rollTarget=0,bobY=0,sprintAmt=0,sprinting=false,strafeDir=0;
let povMode='fp'; // 'fp' first-person | 'tp' third-person, picked in the mission-select menu
let vy=0,jumpZ=0,grounded=true,crouching=false,crouchAmt=0; // vertical hop + crouch, both purely visual/accuracy — the grid collision stays flat
let enemies=[],wave=0,kills=0,score=0,waveTimer=0,inWave=false,running=false,paused=false;
let dmgDirs=[],hitmarkT=0,muzzle=0,time=0;

function resetGuns(){
  guns=WEAPONS.map(w=>({...w,ammo:w.mag,res:selectedLoadout.includes(w.id)?Math.round(w.reserve*1.5):w.reserve}));
  guns.forEach(g=>{ applyWxp(g); applySkillGun(g); });
  if(customOn)guns.forEach(g=>{ g.maxRes=Math.round(g.maxRes*CUSTOM.ammo); g.res=Math.round(g.res*CUSTOM.ammo); });
  const fav=guns.findIndex(g=>g.id===selectedLoadout[0]);
  curGun=fav>=0?fav:0; runReset();
}

/* ---------- canvas / renderer ---------- */
const view=el('view'), vctx=view.getContext('2d');
const glview=el('glview');
let CW=0,CH=0,DPR=1;

const WALL_H=3.1, COVER_H=1.15, EYE_H=1.62;
let renderer,scene,camera,muzzleLight,ambientLight,hemiLight,ceilLight;
let worldGroup=null, enemyGroup=null, playerSprite=null;

function initThree(){
  renderer=new THREE.WebGLRenderer({canvas:glview,antialias:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.toneMapping=THREE.LinearToneMapping;
  renderer.toneMappingExposure=gfx.bright;
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(gfx.fov,1,0.05,140);
  camera.position.set(P.x,EYE_H,P.y);
  hemiLight=new THREE.HemisphereLight(0xffffff,0x202020,1);
  scene.add(hemiLight);
  ambientLight=new THREE.AmbientLight(0xffffff,0.4);
  scene.add(ambientLight);
  muzzleLight=new THREE.PointLight(0xffb066,0,7,2);
  scene.add(muzzleLight);
  ceilLight=new THREE.PointLight(0xbfd0ff,0,4,2); // faint torch-like fill for indoor levels
  scene.add(ceilLight);
  worldGroup=new THREE.Group(); scene.add(worldGroup);
  enemyGroup=new THREE.Group(); scene.add(enemyGroup);
  // the player's own body, only shown in third-person; billboarded like every enemy sprite
  setPlayerModel(selectedCharacter);
}

// converts one of our packed Uint32 pixel buffers into a THREE.CanvasTexture,
// keeping the pixel-art look crisp with nearest-neighbour filtering
function texFromPixels(u32,w,h){
  const cvs=document.createElement('canvas'); cvs.width=w; cvs.height=h;
  const cx=cvs.getContext('2d'); const img=cx.createImageData(w,h);
  new Uint32Array(img.data.buffer).set(u32);
  cx.putImageData(img,0,0);
  const tex=new THREE.CanvasTexture(cvs);
  tex.magFilter=THREE.NearestFilter; tex.minFilter=THREE.NearestFilter; tex.generateMipmaps=false;
  return tex;
}
function wallTexture(u32,repeatY){
  const tex=texFromPixels(u32,TEX,TEX);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.repeat.set(1,repeatY);
  return tex;
}

let WALL_MATERIALS={}, FLOOR_MATERIAL=null, CEIL_MATERIAL=null;
function disposeThemeAssets(){
  Object.values(WALL_MATERIALS).forEach(m=>{ m.map&&m.map.dispose(); m.dispose(); });
  WALL_MATERIALS={};
  [FLOOR_MATERIAL,CEIL_MATERIAL].forEach(m=>{ if(m){ m.map&&m.map.dispose(); m.dispose(); } });
}
// player-facing settings
const gfx={bright:1.15,fov:84,sens:1.5,haze:1,reduceFx:false,colorblind:false,aimAssist:true,touchScale:1,invertY:false,adsSens:1,chStyle:0,chSize:9,chHue:360,models3d:true};
function loadSavedSettings(){
  const sv=ls.get('bp_settings',null);
  if(sv){
    Object.assign(gfx,sv.gfx||{});
    if(sv.diffKey)diffKey=sv.diffKey;
    if(typeof sv.coopOn==='boolean')coopOn=sv.coopOn;
  }
  // one-time touchpad-friendly defaults: faster look speed + aim assist on
  if(!ls.get('bp_touchpad_v1',false)){ gfx.sens=Math.max(gfx.sens,1.5); gfx.aimAssist=true; ls.set('bp_touchpad_v1',true); saveSettings(); }
  document.body.dataset.cb=gfx.colorblind?'1':'0';
  try{ applyTouchScale(); }catch(e){}
}
function saveSettings(){ ls.set('bp_settings',{gfx,diffKey,coopOn}); }
const DIFF={easy:{hp:.75,dmg:.65,spawn:1.3},normal:{hp:1,dmg:1,spawn:1},hard:{hp:1.4,dmg:1.35,spawn:.78}};
let diffKey='normal', coopOn=false;

function applyTheme(){
  disposeThemeAssets();
  const tex=L.textures();
  [1,2,3,4].forEach(t=>{
    if(!tex[t])return;
    WALL_MATERIALS[t]=new THREE.MeshLambertMaterial({map:wallTexture(tex[t],WALL_H)});
  });
  FLOOR_MATERIAL=new THREE.MeshLambertMaterial({map:wallTexture(tex[2]||tex[1],MW)});
  FLOOR_MATERIAL.map.repeat.set(MW,MH);
  FLOOR_MATERIAL.color=new THREE.Color(...hex2rgb(L.ground[0]).map(v=>v/255));
  CEIL_MATERIAL=new THREE.MeshLambertMaterial({map:wallTexture(tex[1],MW)});
  CEIL_MATERIAL.map.repeat.set(MW,MH);
  CEIL_MATERIAL.color=new THREE.Color(0.22,0.22,0.24);

  const skyFar=hex2rgb(L.sky[1]);
  scene.background=new THREE.Color(skyFar[0]/255,skyFar[1]/255,skyFar[2]/255);
  updateFog();
  const skyNear=hex2rgb(L.sky[0]), gndNear=hex2rgb(L.ground[0]);
  hemiLight.color.setRGB(skyNear[0]/255,skyNear[1]/255,skyNear[2]/255);
  hemiLight.groundColor.setRGB(gndNear[0]/255,gndNear[1]/255,gndNear[2]/255);
  hemiLight.intensity=L.ambient*0.85;
  ambientLight.intensity=L.ambient*0.32;
  ceilLight.intensity=L.indoor?0.55:0;
}
function updateFog(){
  if(!scene)return;
  const fog=hex2rgb(L.fog);
  const far=L.fogDist/Math.max(.12,L.fogAmt*gfx.haze)*WEATHER[weather].fog;
  scene.fog=new THREE.Fog(new THREE.Color(fog[0]/255,fog[1]/255,fog[2]/255).getHex(),far*0.12,far);
}

// rebuilds the level's 3D geometry from the current `map` grid: hollow
// buildings become instanced wall boxes, plus a floor and (indoors) a ceiling
function disposeWorld(){
  while(worldGroup.children.length){
    const m=worldGroup.children.pop();
    m.geometry&&m.geometry.dispose();
    scene.remove(m);
  }
}
const wallGeo=new THREE.BoxGeometry(1,1,1);
function rebuildWorldMeshes(){
  disposeWorld();
  const groups={}; // key -> {type,cover,positions:[]}
  for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){
    const t=map[y*MW+x]; if(!t)continue;
    const cover=mapCover[y*MW+x]===1;
    const key=t+(cover?'c':'w');
    (groups[key]||(groups[key]={type:t,cover,positions:[]})).positions.push([x,y]);
  }
  const dummy=new THREE.Object3D();
  Object.values(groups).forEach(grp=>{
    const mat=WALL_MATERIALS[grp.type]||WALL_MATERIALS[2];
    const h=grp.cover?COVER_H:WALL_H;
    const mesh=new THREE.InstancedMesh(wallGeo,mat,grp.positions.length);
    grp.positions.forEach(([x,y],i)=>{
      dummy.position.set(x+0.5,h/2,y+0.5);
      dummy.scale.set(1,h,1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i,dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;
    worldGroup.add(mesh);
  });
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(MW,MH),FLOOR_MATERIAL);
  floor.rotation.x=-Math.PI/2; floor.position.set(MW/2,0,MH/2);
  worldGroup.add(floor);
  if(L.indoor){
    const ceil=new THREE.Mesh(new THREE.PlaneGeometry(MW,MH),CEIL_MATERIAL);
    ceil.rotation.x=Math.PI/2; ceil.position.set(MW/2,WALL_H,MH/2);
    worldGroup.add(ceil);
  }
}

function resize(){
  CW=window.innerWidth; CH=window.innerHeight; DPR=Math.min(window.devicePixelRatio||1,2);
  view.width=Math.round(CW*DPR); view.height=Math.round(CH*DPR);
  vctx.setTransform(DPR,0,0,DPR,0,0); vctx.imageSmoothingEnabled=false;
  if(renderer){ renderer.setSize(CW,CH,false); camera.aspect=CW/CH; camera.updateProjectionMatrix(); }
}
window.addEventListener('resize',resize);

let hurtRoll=0, curFov=84;

/* ---------- weapon viewmodel (drawn at full res) ---------- */
function drawViewmodel(){
  const g=guns[curGun]; if(!g)return;
  const s=Math.min(CW,CH*1.6)/900;
  const sway=Math.sin(bobPhase)*10*bob, swayY=Math.abs(Math.cos(bobPhase))*7*bob;
  const adsT=ads?1:0;
  const baseX=lerp(CW*0.70,CW*0.5,adsT)+sway*(1-adsT*.85);
  const baseY=CH+swayY*(1-adsT*.8)+recoilKick*2.2 - lerp(0,14,adsT);
  let rl=0;
  if(reloading>0){ const p=1-reloading/g.reload; rl=Math.sin(p*Math.PI)*1; }

  vctx.save();
  vctx.translate(CW/2,CH/2); vctx.rotate(camRoll*0.75); vctx.translate(-CW/2,-CH/2);
  vctx.translate(baseX,baseY+rl*120*s+swapT*260*s+sprintAmt*150*s+bobY*2.2);
  vctx.rotate((-0.06+rl*0.45+sprintAmt*0.62)*(1-adsT*.7));
  vctx.scale(s*lerp(1,1.15,adsT),s*lerp(1,1.15,adsT));
  vctx.translate(0,recoilKick*3);

  const steel=vctx.createLinearGradient(-200,-160,120,40);
  steel.addColorStop(0,'#2b333b'); steel.addColorStop(.5,'#1a2026'); steel.addColorStop(1,'#0e1216');
  const poly=(pts,fill)=>{vctx.beginPath();pts.forEach((p,i)=>i?vctx.lineTo(p[0],p[1]):vctx.moveTo(p[0],p[1]));vctx.closePath();vctx.fillStyle=fill;vctx.fill();};

  if(g.id==='rifle'||g.id==='smg'||g.id==='sniper'){
    poly([[-30,-6],[-30,-190],[-6,-190],[-6,-6]],'#171c21');            // barrel
    poly([[-46,-120],[-46,-58],[10,-58],[10,-120]],steel);              // handguard
    poly([[-58,-62],[-58,10],[46,10],[46,-62]],steel);                  // receiver
    poly([[-36,4],[-36,74],[-4,74],[4,4]],'#20272e');                   // magazine
    poly([[26,6],[36,86],[70,86],[70,6]],'#232a31');                    // grip
    poly([[42,-56],[100,-14],[100,10],[46,6]],'#1b2127');               // stock
    poly([[-18,-196],[-2,-196],[-2,-176],[-18,-176]],'#0d1115');        // front sight
    vctx.fillStyle='rgba(242,163,65,.55)'; vctx.fillRect(-40,-66,80,3);
  } else if(g.id==='shotgun'){
    poly([[-30,-10],[-30,-230],[-4,-230],[-4,-10]],'#151a1f');
    poly([[-46,-14],[-46,-215],[-32,-215],[-32,-14]],'#1d232a');        // tube
    poly([[-60,-16],[-60,20],[54,20],[54,-16]],steel);
    poly([[-58,-96],[-58,-42],[-4,-42],[-4,-96]],'#2a3138');            // pump
    poly([[34,16],[46,104],[96,104],[86,16]],'#242b32');                // stock/grip
  } else {
    poly([[-22,-6],[-22,-92],[6,-92],[6,-6]],'#1a2026');
    poly([[-34,-10],[-34,22],[30,22],[30,-10]],steel);
    poly([[-6,18],[-2,96],[36,96],[26,18]],'#232a31');
    poly([[-14,-98],[-6,-98],[-6,-86],[-14,-86]],'#0d1115');
  }
  // muzzle flash
  if(muzzle>0){
    const m=muzzle, tipY=g.id==='shotgun'?-232:((g.id==='rifle'||g.id==='smg'||g.id==='sniper')?-192:-94), tipX=g.id==='pistol'?-8:-18;
    vctx.save(); vctx.translate(tipX,tipY); vctx.globalAlpha=m;
    const rg=vctx.createRadialGradient(0,0,2,0,0,90*m);
    rg.addColorStop(0,'#fff6d8'); rg.addColorStop(.35,'rgba(255,196,86,.9)'); rg.addColorStop(1,'rgba(255,140,30,0)');
    vctx.fillStyle=rg; vctx.beginPath(); vctx.arc(0,0,90*m,0,7); vctx.fill();
    vctx.fillStyle='rgba(255,236,190,'+(m*.95)+')';
    for(let i=0;i<5;i++){ const a=(i/5)*Math.PI*2+time*9; const L=46*m;
      vctx.beginPath(); vctx.moveTo(0,0); vctx.lineTo(Math.cos(a)*L,Math.sin(a)*L*.7); vctx.lineTo(Math.cos(a+.5)*L*.4,Math.sin(a+.5)*L*.3); vctx.fill(); }
    vctx.restore();
  }
  vctx.restore();
}

/* ---------- crosshair, hitmarker, damage arrows ---------- */
function drawReticle(){
  drawWeather();
  const cx=CW/2, cy=CH/2;
  const g=guns[curGun];
  const spreadPx=(ads?8:20)+recoilKick*3.4+(moving?6:0)+(g.id==='shotgun'?10:0);
  vctx.save(); vctx.lineWidth=2; vctx.lineCap='round';
  vctx.strokeStyle=chCol(ads?.6:.9);
  vctx.shadowColor='rgba(0,0,0,.9)'; vctx.shadowBlur=3;
  const L=ads?Math.max(3,Math.round(gfx.chSize*.55)):gfx.chSize;
  if(gfx.chStyle===2||gfx.chStyle===3){ vctx.beginPath(); vctx.arc(cx,cy,spreadPx+L*.45,0,7); vctx.stroke(); }
  if(gfx.chStyle!==1&&gfx.chStyle!==2)[[0,-1],[0,1],[-1,0],[1,0]].forEach(([dx,dy])=>{
    vctx.beginPath();
    vctx.moveTo(cx+dx*spreadPx,cy+dy*spreadPx);
    vctx.lineTo(cx+dx*(spreadPx+L),cy+dy*(spreadPx+L));
    vctx.stroke();
  });
  vctx.fillStyle=chCol(.95); const dotS=gfx.chStyle===1?3:2; vctx.fillRect(cx-dotS/2,cy-dotS/2,dotS,dotS);
  if(hitmarkT>0){
    const hc=hitKind==='kill'?'255,90,70':hitKind==='crit'?'255,205,70':'255,236,190';
    vctx.strokeStyle='rgba('+hc+','+clamp(hitmarkT*5,0,1)+')'; vctx.lineWidth=hitKind==='kill'?3.2:2.4;
    const o=7,l=hitKind==='kill'?11:7;
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([dx,dy])=>{
      vctx.beginPath(); vctx.moveTo(cx+dx*o,cy+dy*o); vctx.lineTo(cx+dx*(o+l),cy+dy*(o+l)); vctx.stroke(); });
  }
  // damage direction arcs
  for(const d of dmgDirs){
    const rel=Math.atan2(d.y-P.y,d.x-P.x)-Math.atan2(P.dy,P.dx);
    const alpha=clamp(d.t/1.2,0,1)*.85;
    vctx.save(); vctx.translate(cx,CH/2); vctx.rotate(rel+Math.PI/2);
    vctx.strokeStyle='rgba(200,69,58,'+alpha+')'; vctx.lineWidth=8;
    vctx.beginPath(); vctx.arc(0,0,86,-Math.PI/2-.34,-Math.PI/2+.34); vctx.stroke();
    vctx.restore();
  }
  for(const d of warnDirs){
    const rel=Math.atan2(d.y-P.y,d.x-P.x)-Math.atan2(P.dy,P.dx);
    vctx.save(); vctx.translate(cx,CH/2); vctx.rotate(rel+Math.PI/2);
    vctx.globalAlpha=clamp(d.t/1.1,0,1)*.9; vctx.strokeStyle=d.c; vctx.lineWidth=4;
    vctx.beginPath(); vctx.arc(0,0,104,-Math.PI/2-.2,-Math.PI/2+.2); vctx.stroke();
    vctx.restore();
  }
  vctx.restore();
}

/* ---------- minimap ---------- */
const mapC=el('mapCanvas'), mctx=mapC.getContext('2d');
function drawMinimap(){
  const S=mapC.width, R=9; // cells visible radius
  mctx.clearRect(0,0,S,S);
  mctx.fillStyle='rgba(8,11,14,.55)'; mctx.fillRect(0,0,S,S);
  const cell=S/(R*2);
  for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
    const mx=(P.x+dx)|0, my=(P.y+dy)|0;
    if(at(mx,my)>0){
      mctx.fillStyle='rgba(140,153,164,.5)';
      mctx.fillRect((dx+R)*cell,(dy+R)*cell,cell+.5,cell+.5);
    }
  }
  for(const p of pickups){
    const dx=p.x-P.x, dy=p.y-P.y; if(Math.abs(dx)>R||Math.abs(dy)>R)continue;
    mctx.fillStyle='#'+PK[p.t][0].toString(16).padStart(6,'0'); mctx.fillRect((dx+R)*cell-2,(dy+R)*cell-2,4,4);
  }
  for(const b of barrels){
    if(b.dead)continue; const dx=b.x-P.x, dy=b.y-P.y; if(Math.abs(dx)>R||Math.abs(dy)>R)continue;
    mctx.fillStyle='#b5402a'; mctx.fillRect((dx+R)*cell-2.5,(dy+R)*cell-2.5,5,5);
  }
  if(obj&&!obj.done){
    const mk=(x,y,col,sz)=>{ const dx=x-P.x, dy=y-P.y; if(Math.abs(dx)>R||Math.abs(dy)>R)return; mctx.fillStyle=col; mctx.fillRect((dx+R)*cell-sz/2,(dy+R)*cell-sz/2,sz,sz); };
    if(obj.type==='zone'){ const dx=obj.x-P.x, dy=obj.y-P.y; if(Math.abs(dx)<=R+3&&Math.abs(dy)<=R+3){ mctx.strokeStyle='#5ee6a0'; mctx.lineWidth=2; mctx.beginPath(); mctx.arc((dx+R)*cell,(dy+R)*cell,obj.r*cell,0,7); mctx.stroke(); } }
    else if(obj.type==='gens')obj.gens.forEach(g=>{ if(!g.dead)mk(g.x,g.y,'#ffb04a',7); });
    else mk(obj.x,obj.y,'#6fb0ff',8);
    const tgt=obj.type==='gens'?obj.gens.find(g=>!g.dead):obj;
    if(tgt){ const dx=tgt.x-P.x, dy=tgt.y-P.y;
      if(Math.abs(dx)>R||Math.abs(dy)>R){ const a=Math.atan2(dy,dx), rr=S/2-9; mctx.save(); mctx.translate(S/2+Math.cos(a)*rr,S/2+Math.sin(a)*rr); mctx.rotate(a+Math.PI/2); mctx.fillStyle='#5ee6a0'; mctx.beginPath(); mctx.moveTo(0,-6); mctx.lineTo(5,4); mctx.lineTo(-5,4); mctx.closePath(); mctx.fill(); mctx.restore(); } }
  }
  for(const e of enemies){
    if(e.dead)continue;
    const dx=e.x-P.x, dy=e.y-P.y, inView=Math.abs(dx)<=R&&Math.abs(dy)<=R;
    if(e.boss){
      const pulse=.5+.5*Math.sin(time*6);
      if(inView){
        mctx.strokeStyle='rgba(242,163,65,'+(.5+.5*pulse)+')'; mctx.lineWidth=2;
        mctx.beginPath(); mctx.arc((dx+R)*cell,(dy+R)*cell,7+pulse*3,0,7); mctx.stroke();
        mctx.fillStyle='#f2a341'; mctx.beginPath(); mctx.arc((dx+R)*cell,(dy+R)*cell,4.6,0,7); mctx.fill();
      } else {
        const a=Math.atan2(dy,dx), rr=S/2-9;
        mctx.save(); mctx.translate(S/2+Math.cos(a)*rr,S/2+Math.sin(a)*rr); mctx.rotate(a+Math.PI/2);
        mctx.fillStyle='#f2a341'; mctx.beginPath(); mctx.moveTo(0,-7); mctx.lineTo(6,5); mctx.lineTo(-6,5); mctx.closePath(); mctx.fill(); mctx.restore();
      }
      continue;
    }
    if(!inView)continue;
    const col=e.dummy?'#9aa7b2':e.type==='sniper'?'#6fb0ff':e.type==='charger'?'#ff6a4a':e.type==='medic'?'#7fe0a0':e.type==='flamer'?'#ff9a3c':e.type==='drone'?'#5ee6f0':'#c8453a';
    mctx.fillStyle=col; mctx.beginPath(); mctx.arc((dx+R)*cell,(dy+R)*cell,e.base==='heavy'?4.4:3.4,0,7); mctx.fill();
  }
  // player arrow
  mctx.save(); mctx.translate(R*cell,R*cell); mctx.rotate(Math.atan2(P.dy,P.dx)+Math.PI/2);
  mctx.fillStyle='#f2a341'; mctx.beginPath(); mctx.moveTo(0,-7); mctx.lineTo(5,6); mctx.lineTo(0,3); mctx.lineTo(-5,6); mctx.closePath(); mctx.fill();
  mctx.restore();
  // cone of view
  mctx.strokeStyle='rgba(242,163,65,.25)'; mctx.beginPath(); mctx.moveTo(R*cell,R*cell);
  const a=Math.atan2(P.dy,P.dx);
  mctx.arc(R*cell,R*cell,S*.42,a-.55,a+.55); mctx.closePath(); mctx.fillStyle='rgba(242,163,65,.08)'; mctx.fill();
}

/* ---------- input ---------- */
const keys={};
// keyboard aim for touchpads: I J K L look, E fires (hold), Z aims down sights (hold)
let kbFiring=false, kbAds=false;
function pollKeyboardAim(dt){
  const s=gfx.sens*(ads?.55:1)*dt;
  if(keys['KeyL'])rotate(2.0*s); if(keys['KeyJ'])rotate(-2.0*s);
  if(keys['KeyI'])P.pitch=clamp(P.pitch+1.5*s,-1.3,1.3); if(keys['KeyK'])P.pitch=clamp(P.pitch-1.5*s,-1.3,1.3);
  if(keys['KeyE']){ mouseDown=true; kbFiring=true; } else if(kbFiring){ mouseDown=false; kbFiring=false; }
  if(keys['KeyZ']){ ads=true; kbAds=true; } else if(kbAds){ ads=false; kbAds=false; }
}
const gpPrev={}; let gpFiring=false, gpAds=false;
let gamepadBlocked=false;
function pollGamepad(dt){
  if(gamepadBlocked||!navigator.getGamepads)return;
  let pads;
  try{ pads=navigator.getGamepads(); }catch(err){ gamepadBlocked=true; return; }
  if(!pads)return;
  let pad=null; for(const p of pads){ if(p){ pad=p; break; } }
  if(!pad)return;
  const dz=v=>Math.abs(v)<.18?0:v;
  const lx=dz(pad.axes[0]||0), ly=dz(pad.axes[1]||0), rx=dz(pad.axes[2]||0), ry=dz(pad.axes[3]||0);
  keys['KeyW']=ly<-.2; keys['KeyS']=ly>.2; keys['KeyA']=lx<-.2; keys['KeyD']=lx>.2;
  if(rx||ry){ const sens=.0032*gfx.sens; rotate(rx*sens*60*dt); P.pitch=clamp(P.pitch-ry*sens*60*dt*(gfx.invertY?-1:1),-1.3,1.3); }
  const btn=i=>pad.buttons[i]&&pad.buttons[i].pressed;
  const pressedEdge=(i)=>{ const now=btn(i); const was=gpPrev[i]; gpPrev[i]=now; return now&&!was; };
  if(btn(7)){ mouseDown=true; gpFiring=true; } else if(gpFiring){ mouseDown=false; gpFiring=false; }
  if(btn(6)){ ads=true; gpAds=true; } else if(gpAds){ ads=false; gpAds=false; }
  keys['ShiftLeft']=btn(10)||lx**2+ly**2>.8;
  if(pressedEdge(0)&&grounded&&!crouching){ vy=4.6; grounded=false; Audio_.jump(); }
  if(pressedEdge(2))startReload();
  if(pressedEdge(1))meleeAttack();
  if(pressedEdge(3))useAbility();
  if(pressedEdge(4)||pressedEdge(5))throwGrenade();
  if(pressedEdge(12))switchGun((curGun+1)%guns.length);
}
let moving=false, mouseDown=false, isTouch=matchMedia('(pointer:coarse)').matches;
if(isTouch)document.body.classList.add('touch');

addEventListener('keydown',e=>{
  if(['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft'].includes(e.code))e.preventDefault();
  keys[e.code]=true;
  if(!running)return;
  if(e.code==='KeyR')startReload();
  if(e.code==='Digit1')switchGun(0);
  if(e.code==='Digit2')switchGun(1);
  if(e.code==='Digit3')switchGun(2);
  if(e.code==='Digit4')switchGun(3);
  if(e.code==='Digit5')switchGun(4);
  if(e.code==='KeyG')throwGrenade();
  if(e.code==='KeyV')meleeAttack();
  if(e.code==='KeyF')useAbility();
  if(e.code==='KeyT')deployTurret();
  if(e.code==='KeyQ')switchGun((curGun+1)%guns.length);
  if(e.code==='Space'&&grounded&&!crouching){ vy=4.6; grounded=false; Audio_.jump(); }
  if(e.code==='KeyC'&&grounded){ crouching=!crouching; if(crouching)sprinting=false; el('btnCrouch').classList.toggle('active',crouching); }
  if(e.code==='Escape'){ if(spectating){ showResultsScreen(); } else pause(); }
});
addEventListener('keyup',e=>keys[e.code]=false);

let lockFailed=false, dragLook=false, lastMouse={x:0,y:0};
view.addEventListener('mousedown',e=>{
  if(!running){return;}
  if(!isTouch&&!lockFailed&&document.pointerLockElement!==view){ view.requestPointerLock(); dragLook=true; lastMouse={x:e.clientX,y:e.clientY}; if(e.button===0)mouseDown=true; return; }
  if(lockFailed){ dragLook=true; lastMouse={x:e.clientX,y:e.clientY}; }
  if(e.button===0)mouseDown=true;
  if(e.button===2)ads=true;
});
addEventListener('mouseup',e=>{ if(e.button===0)mouseDown=false; if(e.button===2)ads=false; dragLook=false; });
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',e=>{ if(running&&(document.pointerLockElement===view||lockFailed))switchGun((curGun+(e.deltaY>0?1:guns.length-1))%guns.length); },{passive:true});

addEventListener('mousemove',e=>{
  if(spectating){
    const dx=e.movementX||0, dy=e.movementY||0;
    specYaw+=dx*0.0024*gfx.sens; specPitch=clamp(specPitch-dy*0.0024*gfx.sens,-1.3,1.3);
    return;
  }
  if(!running)return;
  const sens=(ads?0.0011*gfx.adsSens:0.0021)*gfx.sens;
  if(document.pointerLockElement===view){
    rotate(e.movementX*sens); P.pitch=clamp(P.pitch-e.movementY*sens*(gfx.invertY?-1:1),-1.3,1.3); return;
  }
  if(lockFailed&&dragLook){
    const dx=e.clientX-lastMouse.x, dy=e.clientY-lastMouse.y; lastMouse={x:e.clientX,y:e.clientY};
    rotate(dx*sens*1.3); P.pitch=clamp(P.pitch-dy*sens*1.3*(gfx.invertY?-1:1),-1.3,1.3);
  }
});
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===view){ lockFailed=false; lockEverOk=true; return; }
  if(running&&!isTouch){ if(!lockEverOk&&!lockFailed){ lockFailed=true; toast('Mouse lock unavailable — click & drag to look'); } else pause(); }
});
document.addEventListener('pointerlockerror',()=>{ if(!isTouch){ lockFailed=true; toast('Mouse lock unavailable — click & drag to look'); } });
function rotate(a){
  const c=Math.cos(a),s=Math.sin(a);
  const ndx=P.dx*c-P.dy*s, ndy=P.dx*s+P.dy*c;
  P.dx=ndx; P.dy=ndy;
}

/* touch controls */
let stick={id:null,dx:0,dy:0}, lookId=null, lastLook={x:0,y:0};
const stickBase=el('stickBase'), stickNub=el('stickNub');
function touchStart(e){
  for(const t of e.changedTouches){
    const r=stickBase.getBoundingClientRect();
    if(t.clientX<CW*0.45&&t.clientY>CH*0.35){ stick.id=t.identifier; stick.ox=r.left+r.width/2; stick.oy=r.top+r.height/2; }
    else { lookId=t.identifier; lastLook={x:t.clientX,y:t.clientY}; }
  }
}
function touchMove(e){
  e.preventDefault();
  for(const t of e.changedTouches){
    if(t.identifier===stick.id){
      let dx=t.clientX-stick.ox, dy=t.clientY-stick.oy;
      const d=Math.hypot(dx,dy), max=52;
      if(d>max){dx*=max/d;dy*=max/d;}
      stick.dx=dx/max; stick.dy=dy/max;
      stickNub.style.transform=`translate(${dx}px,${dy}px)`;
    } else if(t.identifier===lookId){
      rotate((t.clientX-lastLook.x)*0.0042);
      P.pitch=clamp(P.pitch-(t.clientY-lastLook.y)*0.0032*(gfx.invertY?-1:1),-1.3,1.3);
      lastLook={x:t.clientX,y:t.clientY};
    }
  }
}
function touchEnd(e){
  for(const t of e.changedTouches){
    if(t.identifier===stick.id){ stick.id=null; stick.dx=stick.dy=0; stickNub.style.transform=''; }
    if(t.identifier===lookId)lookId=null;
  }
}
addEventListener('touchstart',touchStart,{passive:false});
addEventListener('touchmove',touchMove,{passive:false});
addEventListener('touchend',touchEnd);
addEventListener('touchcancel',touchEnd);
const bindBtn=(id,down,up)=>{ const b=el(id);
  b.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();down();},{passive:false});
  b.addEventListener('touchend',e=>{e.preventDefault();e.stopPropagation();up&&up();},{passive:false}); };
bindBtn('btnFire',()=>mouseDown=true,()=>mouseDown=false);
bindBtn('btnReload',()=>startReload());
bindBtn('btnSwap',()=>switchGun((curGun+1)%guns.length));
bindBtn('btnJump',()=>{ if(grounded&&!crouching){ vy=4.6; grounded=false; Audio_.jump(); } });
bindBtn('btnCrouch',()=>{ if(grounded){ crouching=!crouching; if(crouching)sprinting=false; el('btnCrouch').classList.toggle('active',crouching); } });

/* ---------- combat ---------- */
function lineClear(x0,y0,x1,y1){
  const dx=x1-x0, dy=y1-y0, d=Math.hypot(dx,dy), steps=Math.ceil(d/0.12);
  for(let i=1;i<steps;i++){
    const t=i/steps;
    if(solid(x0+dx*t,y0+dy*t))return false;
  }
  return true;
}

function switchGun(i){
  if(i===curGun||reloading>0||swapT>0||!running)return;
  curGun=i; swapT=.34; ads=false; Audio_.swap(); updateHUD();
}

function startReload(){
  const g=guns[curGun];
  if(!g||reloading>0||g.ammo>=g.mag||g.res<=0)return;
  trainMark('reload'); reloading=g.reload*(selectedPerk===0?.75:1); Audio_.reloadOut();
  setTimeout(()=>{ if(running)Audio_.reloadIn(); },reloading*620);
  updateHUD();
}
function finishReload(){
  const g=guns[curGun];
  const need=g.mag-g.ammo, take=Math.min(need,g.res);
  g.ammo+=take; g.res-=take; updateHUD();
}

function fire(){
  const g=guns[curGun];
  if(reloading>0||swapT>0||fireCd>0)return;
  if(g.ammo<=0){ Audio_.dry(); fireCd=.28; if(g.res>0)startReload(); return; }
  g.ammo--; fireCd=g.rpm; trainMark('shoot');
  Audio_.shot(g.sound);
  muzzle=1; recoilKick=g.kick*(ads?.62:1); shake=Math.max(shake,g.kick*0.05);
  P.pitch+=g.recoil*0.0075*(ads?.55:1);
  const spread=ads?g.adsSpread:g.spread;
  let hitAny=false, killed=0, critAny=false;
  let baseAng=Math.atan2(P.dy,P.dx);
  if(gfx.aimAssist){
    let bd=.1, adj=null;
    for(const e of enemies){
      if(e.dead)continue;
      const ex=e.x-P.x, ey=e.y-P.y, ed=Math.hypot(ex,ey); if(ed>g.range||ed<.6)continue;
      let df=Math.atan2(ey,ex)-baseAng; df=Math.atan2(Math.sin(df),Math.cos(df));
      if(Math.abs(df)<bd&&lineClear(P.x,P.y,e.x,e.y)){ bd=Math.abs(df); adj=df; }
    }
    if(adj!==null)baseAng+=adj*.65;
  }
  for(let p=0;p<g.pellets;p++){
    const ang=baseAng+rand(-spread,spread)*(moving?1.6:1)*(crouching?.7:1);
    const rdx=Math.cos(ang), rdy=Math.sin(ang);
    let best=null,bestD=g.range,bestP=1;
    for(const e of enemies){
      if(e.dead)continue;
      const vx=e.x-P.x, vy=e.y-P.y;
      const along=vx*rdx+vy*rdy;
      if(along<=0.2||along>bestD)continue;
      const perp=Math.abs(-vx*rdy+vy*rdx);
      if(perp>e.radius)continue;
      if(!lineClear(P.x,P.y,e.x,e.y))continue;
      best=e; bestD=along; bestP=perp;
    }
    if(best){
      hitAny=true;
      const falloff=clamp(1-bestD/(g.range*1.35),.42,1);
      const crit=bestP<best.radius*.3&&g.pellets===1; if(crit)critAny=true; let dm=(MODS.headshot&&!crit)?dm0Tiny(g.dmg):g.dmg*falloff*dmgMul*(crit?1.6:1); if(best.shielded)dm*=.12; best.hp-=dm; best.hitFlash=.09; if(g.pellets===1||p===0)floatText(best.x,best.y,best.baseHeight*.95,Math.round(dm)+(crit?'!':''),crit?'crit':'');
      best.x+=rdx*0.045; best.y+=rdy*0.045;
      if(best.hp<=0&&!best.dead){ dmgSrcWeapon=g.id; dmgSrcCause=crit?'crit':''; killEnemy(best); killed++; }
    }
    for(const b of barrels){
      if(b.dead)continue;
      const vx=b.x-P.x, vy=b.y-P.y, along=vx*rdx+vy*rdy; if(along<=0.2||along>g.range)continue;
      const perp=Math.abs(-vx*rdy+vy*rdx); if(perp>.4)continue;
      b.hp-=g.dmg; hitAny=true;
      if(b.hp<=0)popBarrel(b);
    }
    rayCover(P.x,P.y,rdx,rdy,best?bestD:g.range,g.dmg*dmgMul*(g.pellets>1?1.3:1));
    if(obj&&obj.type==='gens'&&!obj.done)for(const gn of obj.gens){
      if(gn.dead)continue;
      const vx=gn.x-P.x, vy=gn.y-P.y, along=vx*rdx+vy*rdy; if(along<=.2||along>(best?bestD:g.range))continue;
      if(Math.abs(-vx*rdy+vy*rdx)>.5)continue;
      damageGen(gn,g.dmg*dmgMul); hitAny=true;
    }
  }
  if(hitAny){ hitmarkT=killed>0?.3:.22; hitKind=killed>0?'kill':(critAny?'crit':'hit'); Audio_.hitmark(); }
  if(killed)Audio_.kill();
  updateHUD();
}

function killEnemy(e){
  e.dead=true; e.deadScale=1; kills++;
  if(e.dummy){ trainMark('kill'); setTimeout(()=>{ if(trainingOn&&running)spawnDummy(e.hx,e.hy); },2000); return; }
  comboN++; comboT=3.2; streakCall(comboN); hitKind='kill'; hitmarkT=Math.max(hitmarkT,.28); const mult=Math.min(5,1+Math.floor((comboN-1)/3));
  const pts=(({heavy:150,runner:120,sniper:160,charger:110,medic:180,flamer:140,drone:90,boss:1500,bossShield:1800,bossArtillery:1700})[e.type]||100)*mult;
  score+=pts; credits+=pts; dropLoot(e); Ach.kill(e);
  const g=guns[curGun];
  g.res=Math.min(g.maxRes,g.res+Math.ceil(g.mag*0.5));
  gunKills[dmgSrcWeapon]=(gunKills[dmgSrcWeapon]||0)+1; wxpAdd(dmgSrcWeapon); skillXp();
  addFeed(e.label,pts,dmgSrcCause);
  updateHUD();
}

const feed=el('feed');
const FEED_TAG={nade:'FRAGGED', melee:'TAKEN DOWN', crit:'HEADSHOT'};
function addFeed(name,pts,cause){
  const d=document.createElement('div');
  const tag=FEED_TAG[cause];
  d.className='kill'; d.innerHTML=(tag?tag+' · ':'')+name+' <b>+'+pts+'</b>';
  feed.appendChild(d);
  if(feed.children.length>5)feed.removeChild(feed.firstChild);
  setTimeout(()=>d.remove(),3600);
}

/* ---------- enemies ---------- */
const TYPES={
  grunt :{hp:100,speed:1.55,radius:.42,scale:1.0,dmg:9, fireGap:1.25,acc:.62,label:'GRUNT',  range:13},
  runner:{hp:62, speed:2.65,radius:.36,scale:.92,dmg:7, fireGap:.85, acc:.5, label:'SCOUT',  range:9},
  heavy :{hp:230,speed:1.05,radius:.55,scale:1.25,dmg:15,fireGap:1.7, acc:.7, label:'JUGGERNAUT',range:11},
  sniper :{hp:70,speed:1.0,radius:.4,scale:1.0,dmg:22,fireGap:3.2,acc:.9,label:'MARKSMAN',range:24,base:'grunt',tint:[.6,.75,1.2]},
  charger:{hp:55,speed:3.7,radius:.38,scale:.95,dmg:0,fireGap:99,acc:0,label:'CHARGER',range:0,base:'runner',tint:[1.5,.6,.5]},
  medic  :{hp:80,speed:1.7,radius:.4,scale:1.0,dmg:5,fireGap:1.6,acc:.5,label:'MEDIC',range:10,base:'grunt',tint:[.7,1.3,.8]},
  boss   :{hp:1200,speed:1.2,radius:.75,scale:1.75,dmg:12,fireGap:.6,acc:.7,label:'WARLORD',range:16,base:'heavy',tint:[1.5,.8,.6],boss:true},
  bossShield:{hp:1500,speed:.85,radius:.78,scale:1.8,dmg:10,fireGap:.9,acc:.75,label:'BULWARK',range:14,base:'heavy',tint:[.7,1.1,1.6],boss:true},
  bossArtillery:{hp:950,speed:1.35,radius:.7,scale:1.65,dmg:8,fireGap:1.1,acc:.6,label:'SIEGEBREAKER',range:20,base:'heavy',tint:[1.6,1.5,.5],boss:true},
  flamer:{hp:120,speed:2.0,radius:.42,scale:1.0,dmg:7,fireGap:.3,acc:.9,label:'FLAMER',range:3.6,base:'grunt',tint:[1.7,.7,.3]},
  drone :{hp:38,speed:3.1,radius:.3,scale:.55,dmg:6,fireGap:.7,acc:.6,label:'DRONE',range:10,base:'runner',tint:[.5,1.3,1.5],hover:.9}
};
function spawnEnemy(type){ return withSeed(runSeed*31+(spawnCounter++)*7717,()=>spawnEnemyImpl(type)); }
function spawnEnemyImpl(type){
  let x,y,tries=0;
  do{ x=rand(1.5,MW-1.5); y=rand(1.5,MH-1.5); tries++; }
  while(tries<300&&(solid(x,y)||Math.hypot(x-P.x,y-P.y)<9||lineClear(P.x,P.y,x,y)));
  if(tries>=300){ do{ x=rand(1.5,MW-1.5); y=rand(1.5,MH-1.5); }while(solid(x,y)||Math.hypot(x-P.x,y-P.y)<6); }
  const t=TYPES[type], d=difficulty(), DF=DIFF[diffKey], boost=(1+d*0.05)*DF.hp*(1+ngPlus*.4)*(customOn?CUSTOM.hp:1);
  const h=t.scale*1.9; let sprite, rig=null;
  if(gfx.models3d){ rig=buildEnemy3D(type,t.base||type,tintFor(t.tint),t.scale); sprite=rig.group; sprite.position.set(x,t.hover||0,y); }
  else {
    const spriteMat=new THREE.SpriteMaterial({map:ENEMY_TEX[t.base||type].walkB,transparent:true,alphaTest:.5,depthWrite:true});
    sprite=new THREE.Sprite(spriteMat); sprite.scale.set(h*(SPR_W/SPR_H),h,1); sprite.position.set(x,h/2,y);
  }
  enemyGroup.add(sprite);
  enemies.push({id:++enemyId,x,y,type,hp:t.hp*boost,maxHp:t.hp*boost,speed:t.speed*(1+d*0.011)*(MODS.fastEnemies?1.5:1),radius:t.radius,
    scale:t.scale,dmg:t.dmg*DF.dmg*(1+ngPlus*.25)*(customOn?CUSTOM.dmg:1),fireGap:t.fireGap,acc:t.acc,label:t.label,range:t.range,base:t.base||type,tint:tintFor(t.tint),boss:!!t.boss,type:type,hover:t.hover||0,
    spr:SPRITES[t.base||type],sprite,rig,baseHeight:h,cool:rand(.4,1.6),step:false,stepT:0,hitFlash:0,fireFlash:0,dead:false,deadScale:1,
    strafe:Math.random()<.5?1:-1,strafeT:rand(.5,2),
    flank:(Math.random()<.4&&!t.boss&&type!=='charger'&&type!=='drone')?(Math.random()<.5?1:-1):0});
}

function updateEnemies(dt){
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    if(e.dead){
      e.deadScale-=dt*1.9;
      if(e.deadScale<=0.05){
        enemyGroup.remove(e.sprite); e.sprite.material.dispose();
        enemies.splice(i,1); continue;
      }
      const dk=Math.max(.05,e.deadScale);
      if(e.rig){ e.sprite.scale.setScalar(e.scale*(e.type==='drone'?1.4:1)*dk); e.sprite.rotation.x=-(1-dk)*1.3; e.sprite.position.set(e.x,e.type==='drone'?(e.hover||0)*dk:0,e.y); setRigFlash(e.rig,false); }
      else { const h=e.baseHeight*dk; e.sprite.scale.set(h*(SPR_W/SPR_H),h,1); e.sprite.position.set(e.x,h/2,e.y); }
      continue;
    }
    e.hitFlash=Math.max(0,e.hitFlash-dt);
    e.fireFlash=Math.max(0,e.fireFlash-dt);
    if(e.dummy){
      syncEnemyVisual(e,dt);
      if(e.hp<e.maxHp)e.hp=Math.min(e.maxHp,e.hp+dt*20);
      continue;
    }
    const dx=P.x-e.x, dy=P.y-e.y, dist=Math.hypot(dx,dy)||.001;
    const los=lineClear(e.x,e.y,P.x,P.y);
    let vx=0,vy=0;
    e.coverCd=(e.coverCd||0)-dt;
    if(!e.boss&&e.type!=='charger'&&e.type!=='drone'&&!e.cover&&e.hp<e.maxHp*.35&&e.coverCd<=0){ e.cover=findCover(e); if(e.cover)e.coverT=rand(2.5,4.5); else e.coverCd=2; }
    if(e.cover){
      // badly hurt: break line of sight and wait it out
      const cx0=e.cover.x-e.x, cy0=e.cover.y-e.y, cd=Math.hypot(cx0,cy0)||.001;
      e.coverT-=dt;
      if(cd>.35){ vx=cx0/cd*1.15; vy=cy0/cd*1.15; }
      if(e.coverT<=0||e.hp>e.maxHp*.6){ e.cover=null; e.coverCd=rand(5,8); }
    } else if(los&&dist<e.range*0.75){
      // hold ground, strafe for cover
      e.strafeT-=dt; if(e.strafeT<=0){ e.strafe*=-1; e.strafeT=rand(.7,2.1); }
      vx=(-dy/dist)*e.strafe*0.75; vy=(dx/dist)*e.strafe*0.75;
      if(dist<3.2){ vx-=dx/dist*.7; vy-=dy/dist*.7; }
    } else if(los&&e.flank&&dist>5){
      // flankers arc around you instead of walking straight in
      vx=dx/dist*.55+(-dy/dist)*e.flank*.85; vy=dy/dist*.55+(dx/dist)*e.flank*.85;
    } else {
      vx=dx/dist; vy=dy/dist;
    }
    const sp=e.speed*dt;
    const nx=e.x+vx*sp, ny=e.y+vy*sp;
    // axis-separated movement: blocked on one axis, still slide along the other
    if(!solid(nx+Math.sign(vx)*e.radius,e.y))e.x=nx;
    if(!solid(e.x,ny+Math.sign(vy)*e.radius))e.y=ny;
    e.stepT+=dt*(Math.hypot(vx,vy)*e.speed*2.4);
    if(e.stepT>0.26){ e.stepT=0; e.step=!e.step; }
    if(e.type==='charger'&&dist<1.05&&P.alive){ hurtPlayer(30,e); xBlast(e.x,e.y,2.2,0); killEnemy(e); continue; }
    if(e.type==='medic'){ e.healT=(e.healT||0)-dt; if(e.healT<=0){ e.healT=2.2; for(const o of enemies){ if(!o.dead&&o!==e&&o.hp<o.maxHp&&Math.hypot(o.x-e.x,o.y-e.y)<5){ o.hp=Math.min(o.maxHp,o.hp+o.maxHp*.2); floatText(o.x,o.y,o.baseHeight,'+','heal'); } } } }
    if(e.boss)bossLogic(e,dt,dist);
    // shooting
    e.cool-=dt;
    e.nadeCd=(e.nadeCd===undefined?rand(6,12):e.nadeCd)-dt;
    if(!los&&e.nadeCd<=0&&e.type==='grunt'&&!e.cover&&difficulty()>=2&&dist>4&&dist<12&&P.alive){ e.nadeCd=rand(10,16); throwEnemyGrenade(e); }
    if(los&&!e.warned){
      if(e.type==='sniper'&&dist<e.range&&e.cool<.6){ e.warned=true; calloutAlert('SNIPER LOCKED ON',e,'#6fb0ff'); }
      else if(e.type==='charger'&&dist<9){ e.warned=true; calloutAlert('CHARGER INCOMING',e,'#ff6a4a'); }
      else if(e.type==='flamer'&&dist<5.5){ e.warned=true; calloutAlert('FLAMER CLOSE',e,'#ff9a3c'); }
    }
    if(los&&dist<e.range*(selectedPerk===2?.82:1)*WEATHER[weather].vis*(selectedCharacter===1&&hasSkill(2)?.9:1)&&e.cool<=0&&P.alive){
      e.cool=e.fireGap*rand(.75,1.3); e.warned=false;
      e.fireFlash=.1;
      Audio_.enemyShot(dist*(weather==='rain'?1.5:weather==='sand'?1.8:1));
      const chance=e.acc*clamp(1.25-dist/e.range,.25,1);
      if(Math.random()<chance)hurtPlayer(e.dmg*rand(.8,1.2),e);
    }
    // sync the 3D sprite: position, walk-cycle frame, hit-flash tint
    syncEnemyVisual(e,dt);
  }
  el('enemyNum').textContent=enemies.filter(e=>!e.dead).length;
}

function hurtPlayer(amount,src){
  if(!P.alive||trainingOn)return;
  dmgTaken+=amount; P.lastHit=time;
  if(shieldT>0)amount*=.5;
  if(P.armor>0){ const ab=Math.min(P.armor,amount*.6); P.armor-=ab; amount-=ab; }
  P.health-=amount;
  shake=Math.max(shake,.55);
  hurtRoll+=rand(-.05,.05)+ (Math.random()<.5?-.03:.03);
  hurtRoll=clamp(hurtRoll,-.12,.12);
  dmgDirs.push({x:src.x,y:src.y,t:1.2}); replayHits.push({t:time,x:src.x,y:src.y,a:amount});
  Audio_.hurt();
  const d=el('damage'); d.style.opacity=clamp(amount/16,.35,1);
  setTimeout(()=>d.style.opacity=0,120);
  if(P.health<=0){ P.health=0; die(); }
  updateHUD();
}

/* ---------- waves & levels ---------- */
function startWave(){
  wave++; inWave=true;
  if(mode==='laststand'&&!trainingOn&&wave%3===0)setWeather(['rain','sand','flicker','clear'][((wave/3)-1)%4|0]);
  if(mode==='laststand'&&!customArena&&wave>1&&wave%5===0){ coverHp={}; withSeed(runSeed+wave*104729,()=>buildOpenMap(L.build)); rebuildWorldMeshes(); withSeed(runSeed+wave*17,scatterHazards); banner('TERRAIN SHIFT','GROUND IS MOVING'); }
  const DF=DIFF[diffKey];
  const horde=mode==='laststand'&&wave%4===0&&wave>1;
  const count=Math.min(customOn?64:32,Math.round((4+difficulty()*2)*DF.spawn*(horde?1.6:1)*(customOn?CUSTOM.wave:1)));
  let pool=[];
  for(let i=0;i<count;i++)pool.push(L.mix[i%L.mix.length]);
  pool=pool.map((t,i)=>{ const d=difficulty(); if(d>=2&&i%7===3)return 'sniper'; if(d>=3&&i%6===4)return 'charger'; if(d>=4&&i%9===5)return 'medic'; return t; });
  const sg=sigType(), sgEvery=Math.max(3,6-ngPlus);
  if(wave>=2||ngPlus>0)pool=pool.map((t,i)=>(i%sgEvery===sgEvery-1)?sg:t);
  if(ngPlus>0){ const tough=['heavy','sniper','charger','medic']; pool=pool.map((t,i)=>(i%Math.max(2,4-ngPlus)===1)?tough[(i+ngPlus)%tough.length]:t); }
  if(L.endless?(wave%5===0):(wave===L.waves))pool.unshift(nextBossKind());
  toSpawn=pool; spawnGap=0; waveIsHorde=horde;
  banner(L.name.toUpperCase()+(ngPlus?' · NG+'+ngPlus:''), horde?('HORDE · WAVE '+wave):(L.endless ? 'WAVE '+wave : 'WAVE '+wave+' OF '+L.waves));
  Audio_.wave();
  updateHUD();
}
let waveIsHorde=false;
let toSpawn=[],spawnGap=0;
function updateWaves(dt){
  if(inWave){
    if(toSpawn.length){
      spawnGap-=dt;
      const live=enemies.filter(e=>!e.dead).length;
      if(spawnGap<=0&&live<Math.min(10,4+Math.floor(difficulty()/2))){
        spawnEnemy(toSpawn.pop()); spawnGap=rand(.35,1.0)/(customOn?CUSTOM.spawn:1);
      }
    } else if(enemies.every(e=>e.dead)){
      inWave=false;
      score+=250+difficulty()*60+(waveIsHorde?300:0); credits+=waveIsHorde?200:0; nadeCount=Math.min(6,nadeCount+1); if(wave%3===0)turretCharges=Math.min(3,turretCharges+1);
      if(objActive()){ waveTimer=4; banner('AREA HELD','WAVE '+wave+' DOWN'); }
      else if(wave>=L.waves){ levelClear(); }
      else { waveTimer=5; banner('AREA HELD','WAVE '+wave+' DOWN'); openShop(); }
      updateHUD();
    }
  } else if(running){
    waveTimer-=dt;
    if(waveTimer<=0)startWave();
  }
}
function banner(top,main){
  el('bTop').textContent=top; el('bMain').textContent=main;
  const b=el('banner'); b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}

/* ---------- player movement ---------- */
function updatePlayer(dt){
  let fx=0,fy=0;
  if(keys['KeyW'])fy+=1; if(keys['KeyS'])fy-=1;
  if(keys['KeyD'])fx-=1; if(keys['KeyA'])fx+=1;
  if(stick.id!==null){ fy+=-stick.dy; fx+=stick.dx; }
  const mag=Math.hypot(fx,fy);
  moving=mag>0.08;
  sprinting=(keys['ShiftLeft']||keys['ShiftRight'])&&fy>0&&!ads&&reloading<=0&&!crouching;
  if(sprinting)ads=false;
  sprintAmt=lerp(sprintAmt,sprinting?1:0,dt*6);
  strafeDir=lerp(strafeDir,clamp(fx,-1,1),dt*7);
  // jump: a purely vertical hop, arcs up then back down to the same flat grid
  if(!grounded){
    vy-=11*dt; jumpZ+=vy*dt;
    if(jumpZ<=0){ jumpZ=0; vy=0; grounded=true; Audio_.land(); }
  }
  crouchAmt=lerp(crouchAmt,crouching?1:0,dt*9);
  let sp=P.speed*(speedBoostT>0?1.55:1)*(ads?.5:sprinting?1.62:crouching?.55:1)*dt;
  if(mag>0){
    fx/=Math.max(1,mag); fy/=Math.max(1,mag);
    const mvx=(P.dx*fy+P.dy*fx)*sp, mvy=(P.dy*fy-P.dx*fx)*sp;
    const r=.26;
    if(!solid(P.x+mvx+Math.sign(mvx)*r,P.y))P.x+=mvx;
    if(!solid(P.x,P.y+mvy+Math.sign(mvy)*r))P.y+=mvy;
    bobPhase+=dt*(sprinting?14.5:crouching?7:10.5)*Math.min(1,mag);
    bob=lerp(bob,sprinting?1.5:crouching?.7:1,dt*7);
  } else {
    bob=lerp(bob,0.12,dt*5);
    bobPhase+=dt*2.2;          // idle breathing
  }
  // head bob: real world-unit vertical bounce with each footfall, damped when aiming
  const bobAmp=(ads?.18:1)*bob*0.055;
  bobY=lerp(bobY,Math.abs(Math.sin(bobPhase))*bobAmp-bobAmp*.5,dt*18);
  // lean into strafes, tilt when hit
  rollTarget=-strafeDir*0.06*(ads?.35:1)*(moving?1:0)+Math.sin(bobPhase*.5)*0.006*bob;
  camRoll=lerp(camRoll,rollTarget+hurtRoll,dt*7);
  hurtRoll=lerp(hurtRoll,0,dt*3.5);
  camPitch=P.pitch;
  // regen
  if(!MODS.noRegen&&P.alive&&time-P.lastHit>4.2&&P.health<P.maxHealth){
    P.health=Math.min(P.maxHealth,P.health+28*dt); updateHUD();
  }
  P.pitch=lerp(P.pitch,P.pitch*0.985,dt*6);
  // field of view: widens when sprinting, narrows hard down the sights
  const targetFov=clamp(gfx.fov*(ads?.56:1)*(1+sprintAmt*0.09),40,120);
  curFov=lerp(curFov,targetFov,dt*(ads?13:9));
  updateCameraTransform();
}

// positions and orients the real 3D camera from the game's 2D-grid player
// state: lookAt handles yaw+pitch cleanly, then rotateZ adds head roll/lean
function updateCameraTransform(){
  if(!camera)return;
  const jitter=(shake>0&&!gfx.reduceFx)?shake*0.05:0;
  const cp=Math.cos(camPitch);
  const vert=jumpZ-crouchAmt*0.42; // jump lifts, crouch dips — applied on top of the normal eye height
  if(povMode==='tp'){
    // walk the camera back from the player until it clears a wall, so it never clips indoors
    let camX=P.x-P.dx*1.0, camZ=P.y-P.dy*1.0;
    for(let d=3.4; d>1.0; d-=0.2){
      const tx=P.x-P.dx*d, tz=P.y-P.dy*d;
      if(!solid(tx,tz)){ camX=tx; camZ=tz; break; }
    }
    camera.position.set(
      camX+(jitter?rand(-jitter,jitter):0),
      EYE_H+0.55+vert+(jitter?rand(-jitter,jitter)*.4:0),
      camZ+(jitter?rand(-jitter,jitter):0)
    );
    camera.lookAt(P.x+P.dx*cp*2, EYE_H-0.15+vert+Math.sin(camPitch)*2, P.y+P.dy*cp*2);
    camera.rotateZ(camRoll*0.3);
    if(playerSprite)placePlayerModel();
  } else {
    camera.position.set(
      P.x+(jitter?rand(-jitter,jitter):0),
      EYE_H+bobY+vert+(jitter?rand(-jitter,jitter)*.4:0),
      P.y+(jitter?rand(-jitter,jitter):0)
    );
    camera.lookAt(P.x+P.dx*cp, EYE_H+bobY+vert+Math.sin(camPitch), P.y+P.dy*cp);
    camera.rotateZ(camRoll);
    if(playerSprite)playerSprite.visible=false;
  }
  if(Math.abs(camera.fov-curFov)>0.01){ camera.fov=curFov; camera.updateProjectionMatrix(); }
  muzzleLight.position.set(P.x+P.dx*0.5,EYE_H+vert,P.y+P.dy*0.5);
  muzzleLight.intensity=muzzle*4.5;
}

/* ---------- HUD ---------- */
function updateHUD(){
  const g=guns[curGun]; if(!g)return;
  el('ammoNum').innerHTML=g.ammo+'<small> / '+g.res+'</small>';
  el('gunName').textContent=g.name;
  el('placeName').textContent=L.name;
  el('placeWhere').textContent=L.where;
  el('waveNum').innerHTML=(L.endless||objActive())
    ? Math.max(1,wave)
    : Math.max(1,wave)+'<small style="font-size:20px;color:var(--smoke)"> / '+L.waves+'</small>';
  el('scoreNum').textContent=score.toLocaleString();
  const hp=Math.round(P.health);
  el('healthNum').textContent=hp;
  const f=el('healthFill'); f.style.transform='scaleX('+(P.health/P.maxHealth)+')';
  f.classList.toggle('hurt',P.health<40);
  el('lowhp').classList.toggle('on',P.health<35&&P.alive);
  el('reloadTip').classList.toggle('show',g.ammo===0&&g.res>0&&reloading<=0);
  document.querySelectorAll('.slot').forEach((s,i)=>s.classList.toggle('on',i===curGun));
}

/* ---------- game flow ---------- */
// scales enemy count, health and speed across the whole campaign
function difficulty(){ return mode==='laststand' ? wave : levelIndex*L.waves+wave; }

function newGame(startIndex){
  mode='campaign';
  levelIndex=startIndex|0; kills=0; score=0;
  beginRun(startIndex|0,'campaign');
  resetGuns();
  startLevel();
}

function startLastStand(){
  mode='laststand';
  levelIndex=0; kills=0; score=0;
  beginRun(0,'laststand');
  resetGuns();
  L=LAST_STAND;
  applyTheme();
  setMapSize(46,46);
  withSeed(runSeed,()=>{ buildOpenMap(L.build); if(customArena)applyCustomArena(); });
  rebuildWorldMeshes();
  enemies.forEach(e=>{ enemyGroup.remove(e.sprite); e.sprite.material.dispose(); });
  P.x=MW/2+.5; P.y=MH/2+.5; P.dx=1; P.dy=0; P.pitch=0;
  P.maxHealth=100+(selectedPerk===1?25:0); P.health=P.maxHealth; P.alive=true; P.lastHit=-99;
  enemies=[]; toSpawn=[]; resetExtras(); wave=0; waveTimer=3.4; inWave=false;
  dmgDirs=[]; recoilKick=0; muzzle=0; shake=0; reloading=0; fireCd=0; swapT=0; ads=false;
  camRoll=0; hurtRoll=0; bobY=0; sprintAmt=0; vy=0; jumpZ=0; grounded=true; crouching=false; crouchAmt=0; el('btnCrouch').classList.remove('active');
  guns.forEach(g=>{ g.ammo=g.mag; g.res=Math.min(g.maxRes,Math.max(g.res,Math.round(g.maxRes*.6))); });
  updateHUD();
  el('hud').classList.add('live');
  el('touch').classList.add('live');
  running=true; paused=false;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));
  if(!isTouch&&!lockFailed)view.requestPointerLock();
  withSeed(runSeed+1,scatterHazards); Music.start(); setupWeather();
  banner('LAST STAND','HOLD THE LINE');
  setTimeout(()=>{ if(running&&!trainingOn)toast('Command: waves inbound — hold the perimeter, watch your flanks.'); },1500);
}

function startLevel(){
  L=LEVELS[levelIndex];
  applyTheme();
  setMapSize(28,28);
  withSeed(runSeed+levelIndex*7919,()=>buildMap(L.build));
  rebuildWorldMeshes();
  enemies.forEach(e=>{ enemyGroup.remove(e.sprite); e.sprite.material.dispose(); });
  P.x=MW/2+.5; P.y=MH/2+.5; P.dx=1; P.dy=0; P.pitch=0;
  P.maxHealth=100+(selectedPerk===1?25:0); P.health=P.maxHealth; P.alive=true; P.lastHit=-99;
  enemies=[]; toSpawn=[]; resetExtras(); wave=0; waveTimer=3.4; inWave=false;
  dmgDirs=[]; recoilKick=0; muzzle=0; shake=0; reloading=0; fireCd=0; swapT=0; ads=false;
  camRoll=0; hurtRoll=0; bobY=0; sprintAmt=0; vy=0; jumpZ=0; grounded=true; crouching=false; crouchAmt=0; el('btnCrouch').classList.remove('active');
  // fresh mags and a resupply between locations
  guns.forEach(g=>{ g.ammo=g.mag; g.res=Math.min(g.maxRes,Math.max(g.res,Math.round(g.maxRes*.6))); });
  updateHUD();
  el('hud').classList.add('live');
  el('touch').classList.add('live');
  running=true; paused=false;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));
  if(!isTouch&&!lockFailed)view.requestPointerLock();
  withSeed(runSeed+levelIndex*13,scatterHazards); Music.start(); setupWeather(); setupObjective();
  banner('LOCATION '+(levelIndex+1)+' · '+L.where.toUpperCase(),L.name.toUpperCase());
  if(L.brief)setTimeout(()=>{ if(running)toast(L.brief.length>86?L.brief.slice(0,83)+'…':L.brief); },1500);
}

function levelClear(){
  running=false; inWave=false;
  document.exitPointerLock&&document.exitPointerLock();
  score+=600+levelIndex*400; Ach.levelDone(); metaAdd(Math.round((600+levelIndex*400)*.08));
  Audio_.kill();
  const last=levelIndex>=LEVELS.length-1||dailyRun;
  setTimeout(()=>{
    el('hud').classList.remove('live');
    if(last){
      saveBest('win');
      el('wKills').textContent=kills;
      el('wScore').textContent=score.toLocaleString();
      showBestWeapon('winScreen');
      el('ngBtn').style.display=dailyRun?'none':'block';
      el('winScreen').classList.add('on');
    } else {
      const next=LEVELS[levelIndex+1];
      el('lvDone').textContent=L.name;
      el('lvKills').textContent=kills;
      el('lvScore').textContent=score.toLocaleString();
      el('lvNextName').textContent=next.name;
      el('lvNextWhere').textContent=next.where;
      el('lvBrief').textContent=next.brief;
      el('lvBtn').textContent='Move to '+next.name;
      el('levelScreen').classList.add('on');
    }
  },1100);
  banner('OBJECTIVE COMPLETE',L.name.toUpperCase()+' SECURED');
}
function pause(){
  if(!running||!P.alive)return;
  paused=true; running=false; mouseDown=false;
  document.exitPointerLock&&document.exitPointerLock();
  el('pauseScreen').classList.add('on');
}
function resume(){
  el('pauseScreen').classList.remove('on');
  paused=false; running=true;
  if(!isTouch&&!lockFailed)view.requestPointerLock();
}
let spectating=false, specT=0, specPos=null, specYaw=0, specPitch=0, specShown=false;
function showResultsScreen(){
  if(specShown)return; specShown=true; spectating=false; endReplay();
  if(mode==='laststand'){
    el('rWave').textContent=Math.max(1,wave);
    el('rWaveLabel').textContent='WAVES SURVIVED';
  } else {
    el('rWave').textContent=L.name;
    el('rWaveLabel').textContent='LAST LOCATION';
  }
  el('rKills').textContent=kills;
  showBestWeapon('overScreen');
  el('rScore').textContent=score.toLocaleString();
  el('lowhp').classList.remove('on');
  el('overScreen').classList.add('on'); el('hud').classList.remove('live');
}
function die(){
  P.alive=false; running=false; Audio_.down(); saveBest('over'); metaAdd(Math.round(score*.08));
  document.exitPointerLock&&document.exitPointerLock();
  specShown=false; spectating=true; specT=11; specPos={x:P.x,y:EYE_H,z:P.y}; specYaw=Math.atan2(P.dy,P.dx); specPitch=0;
  if(replayBuf.length>2){ startReplay(); toast('DEATH REPLAY · the last 5 seconds, looped · ESC to continue'); }
  else toast('SPECTATING · move mouse to look, WASD to fly · ESC to continue');
}
function updateSpectator(dt){
  specT-=dt;
  specYaw+=0; // yaw/pitch driven by shared mousemove handler below
  const fx=Math.cos(specYaw), fy=Math.sin(specYaw);
  let mx=0,mz=0;
  if(keys['KeyW']){ mx+=fx; mz+=fy; } if(keys['KeyS']){ mx-=fx; mz-=fy; }
  if(keys['KeyD']){ mx+=fy; mz-=fx; } if(keys['KeyA']){ mx-=fy; mz+=fx; }
  const mag=Math.hypot(mx,mz); if(mag>0){ mx/=mag; mz/=mag; }
  specPos.x+=mx*4*dt; specPos.z+=mz*4*dt;
  if(keys['Space'])specPos.y+=3*dt; if(keys['ShiftLeft'])specPos.y-=3*dt;
  specPos.y=clamp(specPos.y,.5,8);
  camera.position.set(specPos.x,specPos.y,specPos.z);
  camera.lookAt(specPos.x+fx*Math.cos(specPitch),specPos.y+Math.sin(specPitch),specPos.z+fy*Math.cos(specPitch));
  driveReplay(dt);
  if(specT<=0)showResultsScreen();
}

/* ---------- landing page ---------- */
// draws a small diorama (sky / architecture band / ground) from a level's
// own texture generator, so previews are made of real game assets
function paintLocationPreview(canvas,level){
  const w=canvas.width=240,h=canvas.height=150;
  const c=canvas.getContext('2d'); c.imageSmoothingEnabled=false;
  const tex=level.textures();
  const sky0=hex2rgb(level.sky[0]),sky1=hex2rgb(level.sky[1]);
  const gnd0=hex2rgb(level.ground[0]),gnd1=hex2rgb(level.ground[1]);
  const skyH=h*.42, gndH=h*.24, wallH=h-skyH-gndH, wallY=skyH;
  const g=c.createLinearGradient(0,0,0,skyH);
  g.addColorStop(0,`rgb(${sky0})`); g.addColorStop(1,`rgb(${sky1})`);
  c.fillStyle=g; c.fillRect(0,0,w,skyH);
  // wall band: tile two of the level's textures side by side at native res
  const tIds=[1,2,3,4].filter(i=>tex[i]);
  const cols=6, colW=w/cols, tileZoom=colW/TEX;
  for(let col=0;col<cols;col++){
    const id=tIds[col%tIds.length]; const t=tex[id];
    for(let ty=0;ty<TEX;ty++)for(let tx=0;tx<TEX;tx++){
      const px=t[ty*TEX+tx]; if(!px)continue;
      c.fillStyle=`rgb(${px&255},${(px>>8)&255},${(px>>16)&255})`;
      c.fillRect(col*colW+tx*tileZoom,wallY+ty*(wallH/TEX),Math.ceil(tileZoom),Math.ceil(wallH/TEX));
    }
  }
  const g2=c.createLinearGradient(0,h-gndH,0,h);
  g2.addColorStop(0,`rgb(${gnd0})`); g2.addColorStop(1,`rgb(${gnd1})`);
  c.fillStyle=g2; c.fillRect(0,h-gndH,w,gndH);
  // haze veil, matching how the engine actually fades this location
  const fog=hex2rgb(level.fog);
  const veil=c.createLinearGradient(0,wallY,0,h-gndH);
  veil.addColorStop(0,`rgba(${fog},0)`); veil.addColorStop(1,`rgba(${fog},${clamp(level.fogAmt*.55,0,.7)})`);
  c.fillStyle=veil; c.fillRect(0,wallY,w,wallH);
  c.strokeStyle='rgba(0,0,0,.35)'; c.strokeRect(.5,.5,w-1,h-1);
}
function buildLocationCards(){
  const grid=el('locGrid'); grid.innerHTML='';
  LEVELS.forEach((lv,i)=>{
    const card=document.createElement('div'); card.className='loc-card';
    const cvs=document.createElement('canvas');
    card.innerHTML=`<div class="loc-num">LOCATION ${i+1} · ${lv.waves} WAVES</div>`;
    card.appendChild(cvs);
    const info=document.createElement('div');
    info.innerHTML=`<h3>${lv.name}</h3><div class="loc-where">${lv.where}</div><p>${lv.brief}</p>`;
    card.appendChild(info);
    grid.appendChild(card);
    paintLocationPreview(cvs,lv);
  });
}
function buildLoadoutCards(){
  const grid=el('loadGrid'); grid.innerHTML='';
  const maxDmg=Math.max(...WEAPONS.map(w=>w.dmg*(w.pellets||1)));
  const maxRpm=Math.max(...WEAPONS.map(w=>1/w.rpm));
  const maxRange=Math.max(...WEAPONS.map(w=>w.range));
  const maxMag=Math.max(...WEAPONS.map(w=>w.mag));
  WEAPONS.forEach((w,i)=>{
    const s={dmg:w.dmg*(w.pellets||1)/maxDmg, fire:(1/w.rpm)/maxRpm, range:w.range/maxRange, mag:w.mag/maxMag};
    const card=document.createElement('div'); card.className='load-card';
    const rows=[['DAMAGE',s.dmg],['FIRE RATE',s.fire],['RANGE',s.range],['MAG SIZE',s.mag]]
      .map(([label,v])=>`<div class="stat-row"><span>${label}</span><div class="stat-track"><i style="width:${Math.round(v*100)}%"></i></div></div>`).join('');
    card.innerHTML=`<h3>${w.name}</h3><div class="load-tag">SLOT ${i+1} · ${w.auto?'FULL-AUTO':'SEMI-AUTO'}</div>${rows}`;
    grid.appendChild(card);
  });
}
function paintHeroScene(){
  const cvs=el('heroScene'); const c=cvs.getContext('2d');
  const w=cvs.width=Math.round(innerWidth*.7), h=cvs.height=Math.round(innerHeight*.7);
  c.imageSmoothingEnabled=false;
  const lv=LEVELS[2]; // the bunker: moodiest silhouette for a hero image
  const tex=lv.textures();
  const sky0=hex2rgb(lv.sky[1]),sky1=hex2rgb('#08090b');
  const g=c.createLinearGradient(0,0,0,h); g.addColorStop(0,`rgb(${sky0})`); g.addColorStop(1,`rgb(${sky1})`);
  c.fillStyle=g; c.fillRect(0,0,w,h);
  // a row of silhouetted enemy figures along the base, lit from behind
  const n=7;
  for(let i=0;i<n;i++){
    const x=(i+.5)/n*w, scale=h*.34, feet=h*.86+Math.sin(i*1.7)*10;
    c.save(); c.translate(x,feet); c.scale(scale/SPR_H,scale/SPR_H);
    const spr=SPRITES.grunt.walkA;
    c.fillStyle='rgba(4,5,6,.88)';
    for(let y=0;y<SPR_H;y++)for(let xx=0;xx<SPR_W;xx++) if(spr[y*SPR_W+xx]) c.fillRect(xx-SPR_W/2,y-SPR_H,1,1);
    c.restore();
  }
  const glow=c.createRadialGradient(w*.5,h*.9,0,w*.5,h*.9,w*.55);
  glow.addColorStop(0,'rgba(242,163,65,.22)'); glow.addColorStop(1,'rgba(242,163,65,0)');
  c.fillStyle=glow; c.fillRect(0,0,w,h);
}

/* ---------- mission select menu ---------- */
let pendingMode='campaign', pendingLevelIndex=0, pendingPov='fp', pendingChar=0, pendingPerk=0, selectedPerk=0;
const PERKS=[
  {id:'reload',name:'FAST HANDS',blurb:'25% faster reloads.'},
  {id:'vitality',name:'VITALITY',blurb:'+25 max health.'},
  {id:'ghost',name:'LIGHT STEP',blurb:'Quieter footsteps, enemies notice you a touch later.'}
];
let pendingLoadout=['rifle','pistol'], selectedLoadout=['rifle','pistol'];
const MODS={headshot:false,fastEnemies:false,noRegen:false};
function dm0Tiny(d){ return d*0.08; }
function buildMenuLoadoutGrid(){
  const grid=el('menuLoadoutGrid'); if(!grid||grid.childElementCount)return;
  WEAPONS.forEach(w=>{
    const card=document.createElement('button'); card.className='pick-card'; card.type='button';
    card.innerHTML=`<h4>${w.name}</h4><p>${w.tag}</p>`;
    card.dataset.id=w.id;
    card.addEventListener('click',()=>{
      const i=pendingLoadout.indexOf(w.id);
      if(i!==-1)pendingLoadout.splice(i,1);
      else { pendingLoadout.push(w.id); if(pendingLoadout.length>2)pendingLoadout.shift(); }
      if(pendingLoadout.length===0)pendingLoadout=[w.id];
      refreshMenu();
    });
    grid.appendChild(card);
  });
}
function refreshLoadoutGrid(){
  document.querySelectorAll('#menuLoadoutGrid .pick-card').forEach(c=>c.classList.toggle('on',pendingLoadout.includes(c.dataset.id)));
}
document.querySelectorAll('[data-mod]').forEach(b=>b.addEventListener('click',()=>{ const k=b.dataset.mod; MODS[k]=!MODS[k]; b.classList.toggle('on',MODS[k]); }));

function openMenu(startMode,startLevelIdx){
  restoreAfterDaily(); dailyRun=false; trainingOn=false; ngPlus=0; drawTrainBox();
  document.body.classList.add('deployed');
  pendingMode=startMode||'campaign';
  pendingLevelIndex=startLevelIdx!=null?startLevelIdx:0;
  pendingPov=povMode;
  pendingChar=selectedCharacter;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));
  el('menuScreen').classList.add('on');
  buildMenuLevelGrid();
  buildMenuCharGrid();
  refreshMenu();
}
function buildMenuLevelGrid(){
  const grid=el('menuLevelGrid'); if(grid.childElementCount)return; // build once
  LEVELS.forEach((lv,i)=>{
    const card=document.createElement('div'); card.className='pick-card'; card.dataset.i=i;
    const cvs=document.createElement('canvas');
    card.appendChild(cvs);
    const info=document.createElement('div');
    info.innerHTML=`<h4>${lv.name}</h4><p>${lv.waves} waves · ${lv.where}</p>`;
    card.appendChild(info);
    card.addEventListener('click',()=>{ pendingLevelIndex=i; refreshMenu(); });
    grid.appendChild(card);
    paintLocationPreview(cvs,lv);
  });
}
function buildMenuCharGrid(){
  const grid=el('menuCharGrid'); if(grid.childElementCount)return; // build once
  CHARACTERS.forEach((c,i)=>{
    const card=document.createElement('div'); card.className='pick-card'; card.dataset.i=i;
    const cvs=document.createElement('canvas'); cvs.width=120; cvs.height=90;
    card.appendChild(cvs);
    const info=document.createElement('div');
    const cost=META_COST[i]||0, locked=!metaState().unlocked.includes(i);
    info.innerHTML=`<h4>${c.name}${locked?' <span style="color:var(--blood)">LOCKED</span>':''}</h4><p>${c.tag} · ${c.blurb}${locked?' — '+cost+' CR to unlock':''}</p>`;
    card.appendChild(info);
    card.addEventListener('click',()=>{
      if(locked){ if(metaUnlock(i)){ pendingChar=i; grid.innerHTML=''; buildMenuCharGrid(); } else toast('Need '+cost+' CR (earn from kills)'); refreshMenu(); return; }
      pendingChar=i; refreshMenu();
    });
    grid.appendChild(card);
    // small preview: the operator's own walk sprite, tinted, on a plain backdrop
    const cx=cvs.getContext('2d'); cx.imageSmoothingEnabled=false;
    cx.fillStyle='#0b0908'; cx.fillRect(0,0,120,90);
    const glow=cx.createRadialGradient(0,45,0,0,45,95);
    glow.addColorStop(0,'rgba(255,140,40,.55)'); glow.addColorStop(1,'rgba(255,140,40,0)');
    cx.fillStyle=glow; cx.fillRect(0,0,120,90);
    const pv3=renderOperatorPreview(c);
    if(pv3){ cx.imageSmoothingEnabled=true; cx.drawImage(pv3,0,0,120,90); }
    else if(c.preview){ const ph=86, pw=ph*OPW/OPH; cx.drawImage(c.preview,60-pw/2,2,pw,ph); }
  });
}
function refreshMenu(){
  el('tabCampaign').classList.toggle('on',pendingMode==='campaign');
  el('tabLastStand').classList.toggle('on',pendingMode==='laststand');
  el('menuLevelSection').style.display=pendingMode==='campaign'?'block':'none';
  document.querySelectorAll('#menuLevelGrid .pick-card').forEach(c=>c.classList.toggle('on',+c.dataset.i===pendingLevelIndex));
  document.querySelectorAll('.pov-btn').forEach(b=>b.classList.toggle('on',b.dataset.pov===pendingPov));
  document.querySelectorAll('[data-perk]').forEach(b=>b.classList.toggle('on',+b.dataset.perk===pendingPerk));
  document.querySelectorAll('[data-mod]').forEach(b=>b.classList.toggle('on',!!MODS[b.dataset.mod]));
  document.querySelectorAll('[data-diff]').forEach(b=>b.classList.toggle('on',b.dataset.diff===diffKey));
  document.querySelectorAll('[data-coop]').forEach(b=>b.classList.toggle('on',(+b.dataset.coop===1)===coopOn));
  document.querySelectorAll('#menuCharGrid .pick-card').forEach(c=>c.classList.toggle('on',+c.dataset.i===pendingChar));
  buildMenuLoadoutGrid(); refreshLoadoutGrid();
  const lv=LEVELS[pendingLevelIndex];
  const diffLabel={easy:'Easy',normal:'Normal',hard:'Hard'}[diffKey];
  el('menuSummary').textContent=(pendingMode==='campaign'
    ? `Starting at ${lv.name} · ${CHARACTERS[pendingChar].name} · ${pendingPov==='tp'?'third':'first'} person`
    : `Open Ground, endless · ${CHARACTERS[pendingChar].name} · ${pendingPov==='tp'?'third':'first'} person`)
    + ` · ${diffLabel}${coopOn?' · 2P':''} · ${metaState().credits} CR banked`;
}

function deploy(){ openMenu('campaign'); }
function deployLastStand(){ openMenu('laststand'); }
function beginOperation(){
  povMode=pendingPov;
  selectedCharacter=pendingChar;
  selectedPerk=pendingPerk; selectedLoadout=pendingLoadout.slice();
  PLAYER_TEX=PLAYER_TEX_SET[selectedCharacter];
  setPlayerModel(selectedCharacter);
  Audio_.init();
  if(pendingMode==='laststand')startLastStand();
  else newGame(pendingLevelIndex);
}
// redeploy/results buttons now reopen Mission Select, pre-filled with your last
// settings (and the level you were on), so you can change anything before the next run
function restart(){ openMenu(mode, mode==='campaign'?levelIndex:0); }
function initLanding(){
  buildLocationCards(); buildLoadoutCards(); paintHeroScene();
  el('heroDeploy').addEventListener('click',deploy);
  el('navDeploy').addEventListener('click',deploy);
  el('closerDeploy').addEventListener('click',deploy);
  document.querySelectorAll('[data-laststand]').forEach(b=>b.addEventListener('click',deployLastStand));
  el('heroScroll').addEventListener('click',()=>el('locations').scrollIntoView({behavior:'smooth'}));
  addEventListener('resize',()=>{ if(!document.body.classList.contains('deployed'))paintHeroScene(); });
  el('tabCampaign').addEventListener('click',()=>{ pendingMode='campaign'; refreshMenu(); });
  el('tabLastStand').addEventListener('click',()=>{ pendingMode='laststand'; refreshMenu(); });
  document.querySelectorAll('.pov-btn').forEach(b=>b.addEventListener('click',()=>{ pendingPov=b.dataset.pov; refreshMenu(); }));
  document.querySelectorAll('[data-diff]').forEach(b=>b.addEventListener('click',()=>{ diffKey=b.dataset.diff; saveSettings(); refreshMenu(); }));
  document.querySelectorAll('[data-coop]').forEach(b=>b.addEventListener('click',()=>{ coopOn=(+b.dataset.coop===1); saveSettings(); refreshMenu(); }));
  const qb=el('quitBtn'); if(qb)qb.addEventListener('click',()=>{ el('pauseScreen').classList.remove('on'); paused=false; running=false; P.alive=false; document.exitPointerLock&&document.exitPointerLock(); document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on')); el('hud').classList.remove('live'); el('touch').classList.remove('live'); openMenu(mode, mode==='campaign'?levelIndex:0); });
  document.querySelectorAll('[data-perk]').forEach(b=>b.addEventListener('click',()=>{ pendingPerk=+b.dataset.perk; refreshMenu(); }));
  el('menuBeginBtn').addEventListener('click',startFromMenu);
  const lbb=el('menuLeaderboardBtn'); if(lbb)lbb.addEventListener('click',openLeaderboard);
  [['menuDailyBtn',startDaily],['menuTrainBtn',startTraining],['menuArmoryBtn',openArmory]].forEach(([id,fn])=>{ const b=el(id); if(b)b.addEventListener('click',fn); });
  el('menuBackBtn').addEventListener('click',()=>{ document.body.classList.remove('deployed'); });
}

/* ---------- settings ---------- */
const SETTINGS=[
  ['bright','Brightness',0.7,1.9,0.05,v=>Math.round(v*100)+'%'],
  ['haze','Haze',0,1.2,0.05,v=>Math.round(v*100)+'%'],
  ['fov','Field of view',65,105,1,v=>Math.round(v)+'°'],
  ['sens','Look speed',0.4,2.2,0.05,v=>v.toFixed(2)+'x'],
  ['touchScale','Touch button size',0.7,1.5,0.05,v=>Math.round(v*100)+'%'],
  ['adsSens','Aim (ADS) sensitivity',0.3,1.6,0.05,v=>v.toFixed(2)+'x'],
  ['chStyle','Crosshair style',0,3,1,v=>['Cross','Dot','Circle','Cross + circle'][v|0]],
  ['chSize','Crosshair size',4,20,1,v=>v+'px'],
  ['chHue','Crosshair colour',0,360,10,v=>v>=360?'White':v+'°']
];
const TOGGLES=[['reduceFx','Reduce screen shake'],['colorblind','Colorblind-safe palette'],['aimAssist','Aim assist'],['invertY','Invert look (Y axis)'],['models3d','3D character models (next wave / run)']];
function buildSettings(){
  document.querySelectorAll('[data-settings]').forEach(box=>{
    box.innerHTML='';
    SETTINGS.forEach(([key,label,min,max,step,fmt])=>{
      const row=document.createElement('label'); row.className='srow';
      const name=document.createElement('span'); name.textContent=label;
      const input=document.createElement('input');
      input.type='range'; input.min=min; input.max=max; input.step=step; input.value=gfx[key];
      const out=document.createElement('output'); out.textContent=fmt(gfx[key]);
      input.addEventListener('input',()=>{
        gfx[key]=parseFloat(input.value);
        // keep every copy of the controls in step
        document.querySelectorAll('[data-settings] input').forEach(o=>{ if(o.dataset.key===key)o.value=input.value; });
        document.querySelectorAll('[data-settings] output').forEach(o=>{ if(o.dataset.key===key)o.textContent=fmt(gfx[key]); });
        if(key==='bright')applyTheme();
        if(key==='touchScale')applyTouchScale();
        saveSettings();
      });
      input.dataset.key=key; out.dataset.key=key;
      row.append(name,input,out); box.appendChild(row);
    });
    TOGGLES.forEach(([key,label])=>{
      const row=document.createElement('label'); row.className='srow';
      const name=document.createElement('span'); name.textContent=label;
      const input=document.createElement('input'); input.type='checkbox'; input.checked=!!gfx[key];
      input.addEventListener('change',()=>{
        gfx[key]=input.checked;
        document.querySelectorAll('[data-settings] input[type=checkbox]').forEach(o=>{ if(o.dataset.key===key)o.checked=input.checked; });
        if(key==='colorblind')document.body.dataset.cb=gfx.colorblind?'1':'0';
        saveSettings();
      });
      input.dataset.key=key;
      row.append(name,input); box.appendChild(row);
    });
  });
}

el('againBtn').addEventListener('click',()=>{ Audio_.init(); restart(); });
el('winBtn').addEventListener('click',()=>{ Audio_.init(); openMenu('campaign',0); });
el('lvBtn').addEventListener('click',()=>{ levelIndex++; startLevel(); });
el('resumeBtn').addEventListener('click',resume);



/* ================= v2 EXTRAS: difficulty, melee, abilities, hazards, music, meta, co-op buddy ================= */
let meleeCd=0, abilityCd=0, speedBoostT=0, shieldT=0;
const ABILITY_DEF=[{name:'SURGE',cd:9},{name:'GHOST STEP',cd:11},{name:'BULWARK',cd:13}];
function meleeAttack(){
  if(!running||!P.alive||meleeCd>0)return; meleeCd=.55; trainMark('melee');
  Audio_.burst({dur:.08,vol:.32,freq:1200,decay:.4});
  let hitAny=false;
  for(const e of enemies){
    if(e.dead)continue;
    const vx=e.x-P.x, vy=e.y-P.y, d=Math.hypot(vx,vy); if(d>1.7||d<0.001)continue;
    const along=(vx*P.dx+vy*P.dy)/d; if(along<.35)continue;
    dmgSrcWeapon='melee'; dmgSrcCause='melee';
    const dm=58*dmgMul*(e.shielded?.12:1); e.hp-=dm; e.hitFlash=.1;
    floatText(e.x,e.y,e.baseHeight*.9,Math.round(dm));
    hitAny=true;
    if(e.hp<=0&&!e.dead)killEnemy(e);
  }
  if(obj&&obj.type==='gens'&&!obj.done)for(const gn of obj.gens){
    if(gn.dead)continue; const d=Math.hypot(gn.x-P.x,gn.y-P.y)||.001;
    if(d<2&&((gn.x-P.x)*P.dx+(gn.y-P.y)*P.dy)/d>.3){ damageGen(gn,60*dmgMul); hitAny=true; }
  }
  if(hitAny){ hitmarkT=.2; Audio_.hitmark(); shake=Math.max(shake,.3); }
}
function useAbility(){
  if(!running||!P.alive||abilityCd>0)return;
  const a=ABILITY_DEF[selectedCharacter]; abilityCd=a.cd*(selectedCharacter===0&&hasSkill(1)?.7:1); trainMark('ability');
  if(selectedCharacter===0){
    let left=3.4;
    for(let i=0;i<24&&left>0;i++){ const step=left/24, nx=P.x+P.dx*step, ny=P.y+P.dy*step;
      if(!solid(nx,P.y))P.x=nx; if(!solid(P.x,ny))P.y=ny; left-=step; }
    shake=Math.max(shake,.5);
  } else if(selectedCharacter===1){ speedBoostT=hasSkill(1)?5:3; }
  else { shieldT=hasSkill(1)?6:4; }
  toast(a.name+' ACTIVE'); Audio_.swap();
}
/* environmental hazards: shootable barrels + electrified floor patches */
let barrels=[], hazardTiles=[], hazardT=0;
function scatterHazards(){
  barrels.forEach(b=>{ enemyGroup.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); });
  barrels=[]; hazardTiles=[];
  const cx=MW/2, cy=MH/2;
  const nBarrel=mode==='laststand'?4:3;
  for(let i=0;i<nBarrel;i++){
    let x,y,tries=0;
    do{ x=(1.5+Math.random()*(MW-3))|0; y=(1.5+Math.random()*(MH-3))|0; tries++; }
    while(tries<60&&(solid(x+.5,y+.5)||Math.hypot(x-cx,y-cy)<4));
    if(tries>=60)continue;
    const m=new THREE.Mesh(new THREE.CylinderGeometry(.32,.32,.85,10),new THREE.MeshLambertMaterial({color:0xb5402a}));
    m.position.set(x+.5,.42,y+.5); enemyGroup.add(m);
    barrels.push({x:x+.5,y:y+.5,hp:40,m,dead:false});
  }
  const nHaz=mode==='laststand'?3:2;
  for(let i=0;i<nHaz;i++){
    let x,y,tries=0;
    do{ x=(2+Math.random()*(MW-4))|0; y=(2+Math.random()*(MH-4))|0; tries++; }
    while(tries<60&&(solid(x+.5,y+.5)||Math.hypot(x-cx,y-cy)<5));
    if(tries>=60)continue;
    const geo=new THREE.PlaneGeometry(1.8,1.8); geo.rotateX(-Math.PI/2);
    const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x3ad6ff,transparent:true,opacity:.35}));
    m.position.set(x+.5,.03,y+.5); enemyGroup.add(m);
    hazardTiles.push({x:x+.5,y:y+.5,r:1.1,m});
  }
}
function popBarrel(b){
  if(b.dead)return; b.dead=true;
  enemyGroup.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose();
  xBlast(b.x,b.y,3.4,120);
}
function updateHazards(dt){
  hazardT-=dt;
  for(const h of hazardTiles){ h.m.material.opacity=.25+Math.sin(time*5)*.12; }
  if(hazardT<=0){
    hazardT=.6;
    for(const h of hazardTiles){
      if(P.alive&&Math.hypot(P.x-h.x,P.y-h.y)<h.r)hurtPlayer(6,h);
      for(const e of enemies){ if(!e.dead&&Math.hypot(e.x-h.x,e.y-h.y)<h.r){ e.hp-=5; if(e.hp<=0&&!e.dead){ dmgSrcWeapon='hazard'; dmgSrcCause=''; killEnemy(e); } } }
    }
  }
}
/* dynamic music: a soft evolving pad that swells when enemies are close/active */
const Music={
  on:false,
  start(){
    if(this.on||!Audio_.ctx)return; this.on=true; const c=Audio_.ctx;
    this.g=c.createGain(); this.g.gain.value=0; this.g.connect(Audio_.master);
    this.osc=[55,110,164.8].map((f,i)=>{ const o=c.createOscillator(); o.type=i===2?'triangle':'sine'; o.frequency.value=f;
      const og=c.createGain(); og.gain.value=i===0?.5:i===1?.3:.14; o.connect(og); og.connect(this.g); o.start(); return o; });
  },
  update(dt){
    if(!this.on)return;
    const live=enemies.filter(e=>!e.dead).length;
    const target=running&&P.alive?clamp(.05+live*.018,.05,.22):0.02;
    this.g.gain.setTargetAtTime(target,Audio_.ctx.currentTime,.8);
  }
};
/* best-weapon result line */
const WEAPON_LABEL={rifle:'MK-4 CARBINE',shotgun:'M90 BREACHER',pistol:'P-17 SIDEARM',smg:'V-9 SMG',sniper:'LR-50 SNIPER',nade:'GRENADES',melee:'MELEE',hazard:'HAZARDS'};
function showBestWeapon(screenId){
  const panel=el(screenId).querySelector('.panel')||el(screenId);
  let best=null,bestN=0;
  for(const k in gunKills){ if(gunKills[k]>bestN){ best=k; bestN=gunKills[k]; } }
  let d=panel.querySelector('.bestWeaponLine');
  if(!d){ d=document.createElement('div'); d.className='bestWeaponLine'; d.style.cssText='margin-top:6px;font-family:var(--hud-font);letter-spacing:.1em;color:var(--smoke);font-size:13px'; panel.appendChild(d); }
  d.textContent=best?('TOP WEAPON '+(WEAPON_LABEL[best]||best)+' · '+bestN+' KILLS'):'';
}
/* meta-progression: persistent credits unlock characters across runs */
const META_COST=[0,350,700];
function metaAdd(n){ const m=ls.get('bp_meta',{credits:0,unlocked:[0]}); m.credits+=n; ls.set('bp_meta',m); }
function metaState(){ return ls.get('bp_meta',{credits:0,unlocked:[0]}); }
function metaUnlock(i){
  const m=metaState(); if(m.unlocked.includes(i))return true;
  if(m.credits<META_COST[i])return false;
  m.credits-=META_COST[i]; m.unlocked.push(i); ls.set('bp_meta',m); return true;
}
/* co-op buddy: keyboard-controlled ground support sharing this single screen */
let buddy=null;
function resetBuddy(){
  if(buddy){ enemyGroup.remove(buddy.sprite); buddy.sprite.material&&buddy.sprite.material.dispose(); buddy=null; }
  if(!coopOn)return;
  const bb=makeBuddyBody(), sprite=bb.sprite;
  enemyGroup.add(sprite);
  buddy={x:P.x+1.3,y:P.y+1.3,hp:100,maxHp:100,sprite,rig:bb.rig,cool:0,step:false,stepT:0,alive:true,respawnT:0};
}
function updateBuddy(dt){
  if(!coopOn||!buddy)return;
  if(!buddy.alive){
    buddy.respawnT-=dt;
    if(buddy.respawnT<=0&&running){ buddy.alive=true; buddy.hp=buddy.maxHp; buddy.x=P.x; buddy.y=P.y; }
    else { buddy.sprite.visible=false; return; }
  }
  buddy.sprite.visible=true;
  let fx=0,fy=0;
  if(keys['ArrowUp'])fy-=1; if(keys['ArrowDown'])fy+=1;
  if(keys['ArrowLeft'])fx-=1; if(keys['ArrowRight'])fx+=1;
  const mag=Math.hypot(fx,fy);
  if(mag>0){ fx/=mag; fy/=mag; const sp=2.8*dt;
    const nx=buddy.x+fx*sp, ny=buddy.y+fy*sp;
    if(!solid(nx,buddy.y))buddy.x=nx; if(!solid(buddy.x,ny))buddy.y=ny;
    buddy.stepT+=dt*6; if(buddy.stepT>.3){ buddy.stepT=0; buddy.step=!buddy.step; }
  }
  buddy.cool-=dt;
  if((keys['Enter']||keys['Slash'])&&buddy.cool<=0){
    let best=null,bd=14;
    for(const e of enemies){ if(e.dead)continue; const d=Math.hypot(e.x-buddy.x,e.y-buddy.y); if(d<bd&&lineClear(buddy.x,buddy.y,e.x,e.y)){ best=e; bd=d; } }
    if(best){ buddy.cool=.3; dmgSrcWeapon='buddy'; dmgSrcCause='';
      const dm=16; best.hp-=dm; best.hitFlash=.09; floatText(best.x,best.y,best.baseHeight*.9,Math.round(dm));
      Audio_.shot('pistol');
      if(best.hp<=0&&!best.dead)killEnemy(best);
    }
  }
  syncBuddyVisual(dt);
}
function buddyTakeDamage(amount){
  if(!buddy||!buddy.alive)return;
  buddy.hp-=amount;
  if(buddy.hp<=0){ buddy.alive=false; buddy.respawnT=6; toast('BUDDY DOWN'); }
}
/* ================= EXTRAS: pickups, grenades, combo, armor, boss, shop, achievements ================= */
const ls={get(k,d){try{return JSON.parse(localStorage.getItem(k))||d;}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
let nadeCount=3,comboN=0,comboT=0,credits=0,dmgMul=1,dmgSrcWeapon='rifle',dmgSrcCause='',dmgTaken=0,hbT=0,ambT=4,stepPh=0,gunKills={};
let pickups=[],liveNades=[],blasts=[];
P.armor=0;
function runReset(){ credits=0; dmgMul=1; nadeCount=3; turretCharges=1; P.speed=3.05; }
function clearFx(){ [...pickups.map(p=>p.m),...liveNades.map(g=>g.m),...blasts.map(b=>b.m)].forEach(m=>{ enemyGroup.remove(m); m.geometry.dispose(); m.material.dispose(); }); pickups=[]; liveNades=[]; blasts=[];
  barrels.forEach(b=>{ if(!b.dead){ enemyGroup.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); } }); barrels=[];
  hazardTiles.forEach(h=>{ enemyGroup.remove(h.m); h.m.geometry.dispose(); h.m.material.dispose(); }); hazardTiles=[];
  turrets.forEach(removeTurret); turrets=[];
  eGrenades.forEach(g=>{ enemyGroup.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); }); eGrenades=[];
  clearObjective(); }
function resetExtras(){ clearFx(); comboN=0; comboT=0; dmgTaken=0; nadeCount=Math.max(nadeCount,3); P.armor=(selectedCharacter===2?(hasSkill(2)?45:30):0); dmgSrcWeapon='rifle'; dmgSrcCause=''; gunKills={}; abilityCd=0; coverHp={}; coverDirty=false; warnDirs=[]; turretCharges=Math.max(turretCharges,1); resetBuddy(); }
function floatText(x,y,z,txt,cls){
  if(!camera)return; const v=new THREE.Vector3(x,z,y).project(camera); if(v.z>1)return;
  const d=document.createElement('div'); d.className='flt '+(cls||''); d.textContent=txt;
  d.style.left=((v.x+1)/2*100)+'%'; d.style.top=((1-v.y)/2*100)+'%';
  el('floaters').appendChild(d); setTimeout(()=>d.remove(),800);
}
function toast(t){ const b=el('toast'); b.textContent=t; b.style.opacity=1; clearTimeout(toast.h); toast.h=setTimeout(()=>b.style.opacity=0,2600); }
/* pickups */
const PK={hp:[0x59d98e,'+35 HP'],ammo:[0xf2a341,'AMMO'],armor:[0x5aa2f0,'+ARMOR'],nade:[0xdddddd,'+GRENADE'],rare:[0xc77dff,'RARE WEAPON'],turret:[0x4fd1c5,'+TURRET']};
function spawnPickup(t,x,y){
  const m=new THREE.Mesh(new THREE.BoxGeometry(.32,.32,.32),new THREE.MeshBasicMaterial({color:PK[t][0]}));
  m.position.set(x,.35,y); enemyGroup.add(m); pickups.push({t,x,y,m,life:22});
}
function dropLoot(e){
  if(e.boss){ ['hp','armor','ammo','rare'].forEach((t,i)=>spawnPickup(t,e.x+(i-1.5)*.8,e.y)); return; }
  if(!trainingOn&&Math.random()<.045){ spawnPickup('rare',e.x,e.y); return; }
  if(!trainingOn&&Math.random()<.03){ spawnPickup('turret',e.x,e.y); return; }
  if(Math.random()<(selectedCharacter===1&&hasSkill(3)?.4:.28)){ const r=Math.random(); spawnPickup(r<.35?'hp':r<.7?'ammo':r<.88?'armor':'nade',e.x,e.y); }
}
function collect(p){
  if(p.t==='hp')P.health=Math.min(P.maxHealth,P.health+35);
  else if(p.t==='ammo')guns.forEach(g=>g.res=Math.min(g.maxRes,g.res+Math.ceil(g.mag*1.2)));
  else if(p.t==='armor')P.armor=Math.min(armorMax(),P.armor+25);
  else if(p.t==='rare')upgradeRare();
  else if(p.t==='turret')turretCharges=Math.min(3,turretCharges+1);
  else nadeCount=Math.min(6,nadeCount+1);
  Audio_.tone({freq:700,slide:1200,dur:.1,vol:.15,type:'square'});
  floatText(p.x,p.y,.9,PK[p.t][1],'pk'); updateHUD();
}
/* grenades */
function throwGrenade(){
  if(!running||!P.alive||nadeCount<=0)return; nadeCount--; trainMark('grenade');
  const m=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),new THREE.MeshBasicMaterial({color:0x2b3138}));
  enemyGroup.add(m); liveNades.push({x:P.x,y:P.y,vx:P.dx*8.5,vy:P.dy*8.5,z:1.3,vz:3.2,t:1.9,m});
  Audio_.swap(); updateHUD();
}
function xBlast(x,y,r,dmg){
  const m=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial({color:0xffb040,transparent:true,opacity:.8}));
  m.position.set(x,1,y); enemyGroup.add(m); blasts.push({m,t:0,r});
  Audio_.burst({dur:.6,vol:.9,freq:260,decay:.5}); shake=Math.max(shake,.9);
  dmgSrcWeapon='nade'; dmgSrcCause='nade'; let n=0;
  for(const e of enemies){ if(e.dead)continue; const d=Math.hypot(e.x-x,e.y-y);
    if(d<r&&dmg){ const v=dmg*(1-d/r*.7); e.hp-=v; e.hitFlash=.12; floatText(e.x,e.y,e.baseHeight,Math.round(v)); if(e.hp<=0){ killEnemy(e); n++; } } }
  if(n>=3)Ach.unlock('nade3');
  if(dmg&&obj&&obj.type==='gens'&&!obj.done)for(const gn of obj.gens){ if(!gn.dead&&Math.hypot(gn.x-x,gn.y-y)<r)damageGen(gn,dmg*1.5); }
  const cr=Math.ceil(r);
  for(let yy=-cr;yy<=cr;yy++)for(let xx=-cr;xx<=cr;xx++){
    const cx=(x+xx)|0, cy=(y+yy)|0; if(cx<0||cy<0||cx>=MW||cy>=MH)continue;
    if(mapCover[cy*MW+cx]===1&&Math.hypot(cx+.5-x,cy+.5-y)<r*.85)damageCover(cx,cy,dmg?dmg*1.2:0);
  }
  const pd=Math.hypot(P.x-x,P.y-y); if(dmg&&pd<r*.6&&P.alive)hurtPlayer(30*(1-pd/(r*.6))+5,{x,y});
}
const BOSS_KINDS=['boss','bossShield','bossArtillery'];
let bossRotation=0;
function nextBossKind(){ const k=BOSS_KINDS[bossRotation%BOSS_KINDS.length]; bossRotation++; return k; }
function bossLogic(e,dt,dist){
  e.bt=(e.bt||0)+dt; e.st=(e.st||0)+dt;
  if(!e.enr&&e.hp<e.maxHp*.4){ e.enr=1; e.fireGap*=.55; e.speed*=1.3; banner(e.label,'ENRAGED'); }
  if(e.type==='bossShield'){
    e.shT=(e.shT===undefined)?0:e.shT-dt;
    if(e.shT<=0){ e.shielded=!e.shielded; e.shT=e.shielded?3.2:6; if(e.shielded)toast('BULWARK RAISES ITS GUARD'); }
    if(e.bt>6&&dist<6){ e.bt=0; shake=1; Audio_.burst({dur:.4,vol:.7,freq:150,decay:.5}); hurtPlayer(20,e); }
  } else if(e.type==='bossArtillery'){
    if(e.bt>3.4&&dist<18){ e.bt=0; lobShell(e); }
    if(dist<4){ let left=2.6; const ang=Math.atan2(P.y-e.y,P.x-e.x);
      for(let i=0;i<10;i++){ const nx=e.x-Math.cos(ang)*.3, ny=e.y-Math.sin(ang)*.3; if(!solid(nx,e.y))e.x=nx; if(!solid(e.x,ny))e.y=ny; } }
  } else {
    if(e.bt>5&&dist<7){ e.bt=0; shake=1; Audio_.burst({dur:.4,vol:.7,freq:180,decay:.5}); hurtPlayer(22,e); }
  }
  if(e.st>11){ e.st=0; toSpawn.push('runner','runner'); }
}
function lobShell(e){
  Audio_.burst({dur:.2,vol:.4,freq:500,decay:.6});
  const tx=P.x,ty=P.y;
  setTimeout(()=>{ if(running)xBlast(tx,ty,3.6,55); },900);
  toast('INCOMING FIRE');
}
/* per-frame */
function updateExtras(dt){
  for(let i=pickups.length-1;i>=0;i--){ const p=pickups[i]; p.life-=dt; p.m.rotation.y+=dt*2.5; p.m.position.y=.35+Math.sin(time*4+i)*.08;
    if(p.life<=0||(P.alive&&Math.hypot(P.x-p.x,P.y-p.y)<.9)){ if(p.life>0)collect(p); enemyGroup.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); pickups.splice(i,1); } }
  for(let i=liveNades.length-1;i>=0;i--){ const g=liveNades[i]; g.t-=dt; g.vz-=9*dt; g.z+=g.vz*dt;
    if(g.z<.12){ g.z=.12; g.vz=Math.abs(g.vz)*.4; g.vx*=.6; g.vy*=.6; }
    const nx=g.x+g.vx*dt, ny=g.y+g.vy*dt; if(solid(nx,g.y))g.vx*=-.5; else g.x=nx; if(solid(g.x,ny))g.vy*=-.5; else g.y=ny;
    g.m.position.set(g.x,g.z,g.y);
    if(g.t<=0){ const dm=(selectedCharacter===2&&hasSkill(3))?1.25:1; xBlast(g.x,g.y,4.5*dm,170*dm); enemyGroup.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); liveNades.splice(i,1); } }
  for(let i=blasts.length-1;i>=0;i--){ const b=blasts[i]; b.t+=dt; b.m.scale.setScalar(b.r*(.3+b.t*3)); b.m.material.opacity=Math.max(0,.8-b.t*2.2);
    if(b.t>.4){ enemyGroup.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); blasts.splice(i,1); } }
  if(comboT>0){ comboT-=dt; if(comboT<=0)comboN=0; }
  const cm=Math.min(5,1+Math.floor((comboN-1)/3)); const c=el('combo');
  c.style.opacity=comboN>=2?1:0; c.textContent=comboN+' KILLS · x'+cm;
  const boss=enemies.find(e=>e.boss&&!e.dead), bb=el('bossBar');
  bb.style.display=boss?'block':'none'; if(boss){ el('bossFill').style.width=Math.max(0,boss.hp/boss.maxHp*100)+'%'; const bn=el('bossName'); if(bn)bn.textContent=boss.label+(boss.shielded?' · SHIELDED':''); }
  // audio polish: heartbeat, footsteps, ambience
  if(P.alive&&P.health<35){ hbT-=dt; if(hbT<=0){ hbT=.8; Audio_.tone({freq:55,dur:.14,vol:.4,type:'sine'}); setTimeout(()=>Audio_.tone({freq:48,dur:.12,vol:.3,type:'sine'}),170); } }
  const sp=Math.floor(bobPhase/Math.PI); if(sp!==stepPh){ stepPh=sp; if(moving&&grounded)Audio_.burst({dur:.05,vol:(crouching?.03:.08)*(selectedPerk===2?.55:1),freq:220,decay:.5}); }
  ambT-=dt; if(ambT<=0){ ambT=rand(4,9); if(L.indoor)Audio_.tone({freq:900,slide:-300,dur:.08,vol:.05,type:'sine'}); else Audio_.burst({dur:2.4,vol:.05,freq:320,decay:.9}); }
  meleeCd=Math.max(0,meleeCd-dt); abilityCd=Math.max(0,abilityCd-dt);
  speedBoostT=Math.max(0,speedBoostT-dt); shieldT=Math.max(0,shieldT-dt);
  updateHazards(dt); updateBuddy(dt); Music.update(dt);
  lowAmmoCheck(); updateObjective(dt); updateTurrets(dt); updateEnemyGrenades(dt); updateWeather(dt);
  for(let i=warnDirs.length-1;i>=0;i--){ warnDirs[i].t-=dt; if(warnDirs[i].t<=0)warnDirs.splice(i,1); }
  coverT-=dt; if(coverDirty&&coverT<=0){ coverDirty=false; coverT=.12; rebuildWorldMeshes(); }
  if(trainingOn){ if(moving)trainMark('move'); if(sprinting)trainMark('sprint'); if(crouching)trainMark('crouch'); if(!grounded)trainMark('jump'); }
}
const _uh=updateHUD;
updateHUD=function(){ _uh(); const x=el('extraLine'); if(x)x.innerHTML='ARMOR <b style="color:#8fc3ff">'+Math.round(P.armor)+'</b> · GRENADES <b style="color:var(--bone)">'+nadeCount+'</b> [G] · CR <b style="color:var(--signal)">'+credits+'</b> · ABILITY <b style="color:var(--signal)">'+(abilityCd>0?Math.ceil(abilityCd)+'s':'READY')+'</b> [F] · TURRET <b style="color:var(--bone)">'+turretCharges+'</b> [T]'+(coopOn&&buddy?(' · BUDDY <b style="color:#8fc3ff">'+(buddy.alive?Math.round(buddy.hp):'DOWN')+'</b>'):''); };
/* high score */
function saveBest(where){
  if(trainingOn||customOn)return;
  const key=dailyRun?'daily':(customArena?'arena':(mode==='laststand'?'laststand':'campaign')), all=ls.get('bp_best',{}), b=all[key]||{score:0};
  const rec=score>b.score; if(rec){ all[key]={score,wave,level:levelIndex+1}; ls.set('bp_best',all); }
  const cur=all[key]||{score,wave,level:levelIndex+1};
  const panel=el(where==='win'?'winScreen':'overScreen').querySelector('.panel')||el(where==='win'?'winScreen':'overScreen');
  let d=panel.querySelector('.bestLine'); if(!d){ d=document.createElement('div'); d.className='bestLine'; d.style.cssText='margin-top:16px;font-family:var(--hud-font);letter-spacing:.14em;color:var(--signal)'; panel.appendChild(d); }
  d.textContent='BEST '+cur.score.toLocaleString()+' · '+(key==='laststand'?'WAVE '+cur.wave:'LEVEL '+cur.level)+(rec?' — NEW RECORD':'');
  logRun(key,{score,detail:key==='daily'?('Daily · '+L.name):key==='arena'?'Custom arena · wave '+wave:key==='laststand'?('Wave '+wave):L.name,date:Date.now()});
}
/* run history / leaderboard */
function logRun(key,entry){
  const h=ls.get('bp_history',{campaign:[],laststand:[]});
  if(!h[key])h[key]=[];
  h[key].unshift(entry); h[key]=h[key].slice(0,10);
  ls.set('bp_history',h);
}
function openLeaderboard(){
  const h=ls.get('bp_history',{campaign:[],laststand:[]});
  const rows=(key,label)=>{
    const list=h[key]||[];
    if(!list.length)return `<p class="hint">No ${label} runs yet.</p>`;
    return '<table style="width:100%;border-collapse:collapse;margin-bottom:18px">'+
      list.map((r,i)=>`<tr style="border-bottom:1px solid rgba(255,255,255,.08)">
        <td style="padding:6px 8px;color:var(--smoke);width:28px">${i+1}</td>
        <td style="padding:6px 8px;font-weight:700">${r.score.toLocaleString()}</td>
        <td style="padding:6px 8px;color:var(--smoke)">${r.detail}</td>
        <td style="padding:6px 8px;color:var(--smoke);font-size:11px">${new Date(r.date).toLocaleDateString()}</td>
      </tr>`).join('')+'</table>';
  };
  const win=document.createElement('section'); win.className='screen on'; win.id='lbScreen';
  win.innerHTML=`<div class="panel">
    <div class="kicker">AFTER-ACTION LOG</div>
    <h1 style="font-size:clamp(32px,7vw,54px)">Leaderboard</h1>
    <p class="sub">Your last 10 runs, saved on this device.</p>
    <div class="menu-label" style="margin-top:10px">CAMPAIGN</div>
    ${rows('campaign','campaign')}
    <div class="menu-label">LAST STAND</div>
    ${rows('laststand','Last Stand')}
    <div class="menu-label">DAILY CHALLENGE</div>
    ${rows('daily','daily')}
    <div class="menu-label">CUSTOM ARENA</div>
    ${rows('arena','arena')}
    <button class="cta shopBtn" id="lbClose">Close</button>
  </div>`;
  el('stage').appendChild(win);
  el('lbClose').addEventListener('click',()=>win.remove());
}
/* achievements */
const Ach={
  def:{first:['FIRST BLOOD','Get a kill'],combo5:['ON A ROLL','5-kill combo'],sg50:['CLOSE QUARTERS','50 shotgun kills'],nade3:['FRAG OUT','3 kills with one grenade'],untouched:['GHOST','Clear a level taking no damage'],boss:['WARLORD DOWN','Defeat a boss']},
  d:ls.get('bp_ach',{}),
  unlock(id){ if(this.d[id]||!this.def[id])return; this.d[id]=1; ls.set('bp_ach',this.d); toast('ACHIEVEMENT · '+this.def[id][0]); },
  kill(e){ const d=this.d; d.k=(d.k||0)+1; this.unlock('first'); if(comboN>=5)this.unlock('combo5'); if(e.boss)this.unlock('boss');
    if(dmgSrcWeapon==='shotgun'){ d.sg=(d.sg||0)+1; if(d.sg>=50)this.unlock('sg50'); } ls.set('bp_ach',d); },
  levelDone(){ if(dmgTaken===0)this.unlock('untouched'); }
};
/* between-wave shop */
const UPG=[['Damage +12%',400,()=>{dmgMul*=1.12;}],['Ammo capacity +25%',300,()=>guns.forEach(g=>{g.maxRes=Math.round(g.maxRes*1.25);g.res=Math.min(g.maxRes,g.res+g.mag);})],['Refill armor',250,()=>{P.armor=armorMax();}],['Move speed +6%',350,()=>{P.speed*=1.06;}],['Grenades +2',200,()=>{nadeCount=Math.min(6,nadeCount+2);}]];
const shop=document.createElement('section'); shop.className='screen'; shop.id='shopScreen'; el('stage').appendChild(shop);
function openShop(){
  if(credits<200)return;
  running=false; mouseDown=false; document.exitPointerLock&&document.exitPointerLock(); drawShop(); shop.classList.add('on');
}
function drawShop(){
  shop.innerHTML='<div class="panel"><div class="kicker">SUPPLY DROP</div><h1 style="font-size:clamp(36px,8vw,64px)">Upgrades</h1><p class="sub">Credits: <b style="color:var(--signal)">'+credits+'</b> — earned from kills.</p></div>';
  const p=shop.firstChild;
  UPG.forEach(([n,c,fn])=>{ const b=document.createElement('button'); b.className='cta shopBtn'; b.textContent=n+' — '+c+' CR'; b.disabled=credits<c;
    b.onclick=()=>{ credits-=c; fn(); Audio_.swap(); updateHUD(); drawShop(); }; p.appendChild(b); });
  const g=guns[curGun]; g.atk=g.atk||{};
  const atkHead=document.createElement('div'); atkHead.className='menu-label'; atkHead.style.marginTop='16px'; atkHead.textContent='ATTACHMENTS · '+g.name;
  p.appendChild(atkHead);
  const ATK=[
    ['scope','Scope — tighter spread',300,()=>{ g.spread*=.72; g.adsSpread*=.6; }],
    ['extmag','Extended mag — +40% mag & reserve',280,()=>{ const r=g.mag; g.mag=Math.round(g.mag*1.4); g.ammo+=g.mag-r; g.maxRes=Math.round(g.maxRes*1.4); g.res=Math.min(g.maxRes,g.res+g.mag); }],
    ['silencer','Suppressor — less recoil, quieter',260,()=>{ g.recoil*=.7; g.kick*=.7; }]
  ];
  ATK.forEach(([key,label,c,fn])=>{
    const owned=!!g.atk[key];
    const b=document.createElement('button'); b.className='cta shopBtn'; b.textContent=owned?label+' — OWNED':label+' — '+c+' CR';
    b.disabled=owned||credits<c;
    b.onclick=()=>{ credits-=c; fn(); g.atk[key]=true; Audio_.swap(); updateHUD(); drawShop(); };
    p.appendChild(b);
  });
  const go=document.createElement('button'); go.className='cta shopBtn'; go.style.background='var(--bone)'; go.textContent='CONTINUE';
  go.onclick=()=>{ shop.classList.remove('on'); running=true; updateHUD(); if(!isTouch&&!lockFailed)view.requestPointerLock(); }; p.appendChild(go);
}
(function(){ const b=document.createElement('div'); b.className='tbtn'; b.id='btnNade'; b.textContent='NADE'; el('touch').appendChild(b); bindBtn('btnNade',throwGrenade); })();
(function(){ const b=document.createElement('div'); b.className='tbtn'; b.id='btnMelee'; b.textContent='MELEE'; el('touch').appendChild(b); bindBtn('btnMelee',meleeAttack); })();
(function(){ const b=document.createElement('div'); b.className='tbtn'; b.id='btnAbility'; b.textContent='ABILITY'; el('touch').appendChild(b); bindBtn('btnAbility',useAbility); })();

/* ================= v4 EXTRAS: pause button, callouts, minimap, cover, rare guns, armory, daily, training, NG+, touch ================= */
let ngPlus=0, dailyRun=false, dailyBackup=null, trainingOn=false, trainDone={}, coverHp={}, coverDirty=false, coverT=0, warnDirs=[], touchEdit=false, lockEverOk=false;

/* ---- level flavour: tint + signature enemy ---- */
const LEVEL_TINT=[[1.08,.98,.82],[.9,.98,1.12],[.88,.95,.92],[.95,1.04,1.18],[1.2,.85,.7],[1,1,1]];
const LEVEL_SIG=['drone','flamer','charger','drone','flamer'];
function levelTint(){ return LEVEL_TINT[mode==='laststand'?5:Math.min(4,levelIndex)]; }
function tintFor(base){ const b=base||[1,1,1], l=levelTint(); return [b[0]*l[0],b[1]*l[1],b[2]*l[2]]; }
function sigType(){ return mode==='laststand'?(wave%2?'drone':'flamer'):LEVEL_SIG[Math.min(4,levelIndex)]; }

/* ---- pause / resume ---- */
el('pauseBtn').addEventListener('click',e=>{ e.stopPropagation(); if(running&&P.alive)pause(); });
addEventListener('keydown',e=>{
  if(e.code==='KeyP'&&!e.repeat){ if(paused)resume(); else if(running)pause(); }
});

/* ---- enemy callouts ---- */
function calloutAlert(text,e,color){
  const c=el('callout'); c.textContent=text; c.style.color=color||'var(--blood)'; c.classList.add('show');
  clearTimeout(calloutAlert.h); calloutAlert.h=setTimeout(()=>c.classList.remove('show'),1100);
  warnDirs.push({x:e.x,y:e.y,t:1.1,c:color||'#c8453a'});
  Audio_.tone({freq:880,slide:-260,dur:.14,vol:.16,type:'square'});
}

/* ---- low ammo ---- */
function lowAmmoCheck(){
  const g=guns[curGun]; if(!g)return; const a=el('ammoNum');
  const low=g.res<=g.maxRes*.15&&g.ammo<=g.mag*.5;
  a.classList.toggle('low',low);
  if(low&&!g._lowWarn){ g._lowWarn=true; toast(g.res+g.ammo<=0?'OUT OF AMMO':'LOW AMMO'); Audio_.tone({freq:520,slide:-120,dur:.09,vol:.14,type:'square'}); }
  if(!low)g._lowWarn=false;
}

/* ---- destructible cover ---- */
function destroyCover(cx,cy){
  const idx=cy*MW+cx; if(mapCover[idx]!==1)return;
  map[idx]=0; mapCover[idx]=0; delete coverHp[idx]; coverDirty=true;
  Audio_.burst({dur:.25,vol:.35,freq:240,decay:.6});
}
function damageCover(cx,cy,dmg){
  const idx=cy*MW+cx; if(mapCover[idx]!==1)return false;
  coverHp[idx]=(coverHp[idx]===undefined?110:coverHp[idx])-dmg;
  if(coverHp[idx]<=0)destroyCover(cx,cy);
  return true;
}
function rayCover(x,y,dx,dy,maxD,dmg){
  for(let t=.3;t<maxD;t+=.12){
    const cx=(x+dx*t)|0, cy=(y+dy*t)|0;
    if(cx<0||cy<0||cx>=MW||cy>=MH)return false;
    if(map[cy*MW+cx]>0)return damageCover(cx,cy,dmg);
  }
  return false;
}

/* ---- rare weapons ---- */
function upgradeRare(){
  const g=guns[curGun]; if(!g)return;
  g.base=g.base||g.name; const tier=g.rare||0;
  if(tier>=2){ g.res=g.maxRes; toast('ELITE '+g.base+' — ammo restocked'); return; }
  g.rare=tier+1;
  if(g.rare===1){ g.dmg=Math.round(g.dmg*1.15); g.reload*=.85; g.name='VETERAN '+g.base; }
  else { g.dmg=Math.round(g.dmg*1.2); g.mag=Math.round(g.mag*1.2); g.ammo=g.mag; g.spread*=1.25; g.adsSpread*=1.15; g.name='ELITE '+g.base; }
  toast(g.name+' ACQUIRED'); updateHUD();
}

/* ---- armory: weapon XP unlock tree ---- */
const WXP_TIERS=[25,75,150];
const WXP_PERKS=['Steady hands — tighter spread','Extended mag — +20% magazine','Veteran grip — less recoil, ★ mark'];
function wxpData(){ return ls.get('bp_wxp',{}); }
function wxpAdd(id){
  if(trainingOn||customOn||!WEAPONS.some(w=>w.id===id))return;
  const d=wxpData(); d[id]=(d[id]||0)+1; ls.set('bp_wxp',d);
  if(WXP_TIERS.includes(d[id]))toast('ARMORY UNLOCK · '+WEAPONS.find(w=>w.id===id).name+' tier '+(WXP_TIERS.indexOf(d[id])+1));
}
function applyWxp(g){
  const n=wxpData()[g.id]||0, t=WXP_TIERS.filter(x=>n>=x).length;
  if(t>=1){ g.spread*=.9; g.adsSpread*=.85; }
  if(t>=2){ g.mag=Math.round(g.mag*1.2); g.ammo=g.mag; }
  if(t>=3){ g.recoil*=.85; g.kick*=.85; g.name='★ '+g.name; }
}
function openArmory(){
  const old=el('armoryScreen'); if(old)old.remove();
  const d=wxpData();
  const rows=WEAPONS.map(w=>{
    const n=d[w.id]||0, t=WXP_TIERS.filter(x=>n>=x).length, next=WXP_TIERS[t], pct=next?Math.min(100,Math.round(n/next*100)):100;
    return `<div style="margin:0 0 18px"><div style="display:flex;justify-content:space-between;font-family:var(--hud-font);letter-spacing:.08em"><b>${w.name}</b><span style="color:var(--smoke)">${n} KILLS · TIER ${t}/3</span></div>
      <div style="height:6px;background:rgba(255,255,255,.12);margin:6px 0"><i style="display:block;height:100%;width:${pct}%;background:var(--signal)"></i></div>
      <div style="font-size:11px;color:var(--smoke);line-height:1.6">${WXP_PERKS.map((p,i)=>(t>i?'<span style="color:var(--ok)">✓</span> ':'· ')+p+' ('+WXP_TIERS[i]+' kills)').join('<br>')}</div></div>`;
  }).join('');
  const win=document.createElement('section'); win.className='screen on'; win.id='armoryScreen';
  win.innerHTML=`<div class="panel"><div class="kicker">WEAPON PROGRESSION</div><h1 style="font-size:clamp(32px,7vw,54px)">Armory</h1>
    <p class="sub">Every kill with a weapon earns it XP. Unlocks carry into every future run.</p>${rows}
    <button class="cta shopBtn" id="armClose">Close</button></div>`;
  el('stage').appendChild(win);
  el('armClose').addEventListener('click',()=>win.remove());
}

/* ---- daily challenge ---- */
function dailySeed(){ const d=new Date(); return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate(); }
function restoreAfterDaily(){
  if(!dailyBackup)return;
  diffKey=dailyBackup.diffKey; Object.assign(MODS,dailyBackup.mods); pendingPerk=dailyBackup.perk; pendingLoadout=dailyBackup.loadout; dailyBackup=null;
}
function startDaily(){
  let s=dailySeed()>>>0; const r=()=>{ s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; };
  dailyBackup={diffKey,mods:{...MODS},perk:pendingPerk,loadout:pendingLoadout.slice()};
  const lvl=Math.floor(r()*LEVELS.length);
  diffKey=['normal','hard','hard'][Math.floor(r()*3)];
  const mk=Object.keys(MODS); mk.forEach(k=>{ MODS[k]=r()<.4; });
  if(!mk.some(k=>MODS[k]))MODS[mk[Math.floor(r()*mk.length)]]=true;
  pendingPerk=Math.floor(r()*3);
  const ids=WEAPONS.map(w=>w.id); const a=ids[Math.floor(r()*ids.length)]; let b=ids[Math.floor(r()*ids.length)]; if(b===a)b=ids[(ids.indexOf(a)+1)%ids.length];
  pendingLoadout=[a,b];
  pendingMode='campaign'; pendingLevelIndex=lvl; trainingOn=false; ngPlus=0; dailyRun=true;
  const names={headshot:'HEADSHOTS ONLY',fastEnemies:'FAST ENEMIES',noRegen:'NO REGEN'};
  const modTxt=mk.filter(k=>MODS[k]).map(k=>names[k]).join(' + ');
  beginOperation();
  setTimeout(()=>toast('DAILY · '+LEVELS[lvl].name+' · '+diffKey.toUpperCase()+' · '+modTxt),2400);
}
function startFromMenu(){ dailyRun=false; trainingOn=false; customOn=false; customArena=null; forcedSeed=null; ngPlus=0; beginOperation(); }

/* ---- training level ---- */
const TRAIN_STEPS=[['move','Move — W A S D'],['sprint','Sprint — hold Shift'],['crouch','Crouch — C'],['jump','Jump — Space'],['shoot','Shoot — click / FIRE'],['reload','Reload — R'],['melee','Melee — V'],['grenade','Grenade — G'],['ability','Ability — F'],['turret','Turret — T'],['kill','Take down a target dummy']];
function drawTrainBox(){
  const b=el('trainBox'); b.classList.toggle('on',trainingOn); if(!trainingOn)return;
  b.innerHTML='<div style="color:var(--signal);letter-spacing:.2em;margin-bottom:6px">TRAINING</div>'+TRAIN_STEPS.map(([k,t])=>'<div class="'+(trainDone[k]?'done':'')+'">'+(trainDone[k]?'✓ ':'· ')+t+'</div>').join('');
}
function trainMark(k){
  if(!trainingOn||trainDone[k])return; trainDone[k]=true; drawTrainBox();
  if(TRAIN_STEPS.every(([id])=>trainDone[id])){ toast('TRAINING COMPLETE — pause to return to the menu'); Audio_.wave(); }
}
function spawnDummy(x,y){
  spawnEnemy('grunt'); const e=enemies[enemies.length-1];
  e.dummy=true; e.hx=x; e.hy=y; e.x=x; e.y=y; e.hp=e.maxHp=500; e.speed=0; e.fireGap=1e9; e.cool=1e9; e.dmg=0; return e;
}
function setupTraining(){
  trainDone={}; waveTimer=1e9;
  [[5,-2.4],[6.5,0],[5,2.4]].forEach(([ox,oy])=>{ let x=P.x+ox, y=P.y+oy; if(solid(x,y)){ x=P.x+ox*.6; y=P.y; } spawnDummy(x,y); });
  drawTrainBox(); banner('TRAINING','TRY EVERY CONTROL');
  setTimeout(()=>{ if(running&&trainingOn)toast('Tick off the list on the left. You cannot be hurt here.'); },1600);
}
function startTraining(){ dailyRun=false; ngPlus=0; pendingMode='laststand'; trainingOn=true; beginOperation(); setupTraining(); }

/* ---- New Game+ ---- */
el('ngBtn').addEventListener('click',()=>{
  Audio_.init(); ngPlus++; dailyRun=false; trainingOn=false; newGame(0);
  setTimeout(()=>toast('NEW GAME+ '+ngPlus+' — tougher enemies, remixed squads'),2400);
});

/* ---- touch: scale, layout editor ---- */
const TP_KEY='bp_touchpos';
function applyTouchScale(){ document.documentElement.style.setProperty('--ts',gfx.touchScale||1); }
function applyTouchPositions(){
  const pos=ls.get(TP_KEY,{});
  document.querySelectorAll('#touch .tbtn').forEach(b=>{ const p=pos[b.id]; if(!p)return; b.style.left=(p.x*100)+'%'; b.style.top=(p.y*100)+'%'; b.style.right='auto'; b.style.bottom='auto'; });
}
function resetTouchPositions(){
  ls.set(TP_KEY,{});
  document.querySelectorAll('#touch .tbtn').forEach(b=>{ b.style.left=b.style.top=b.style.right=b.style.bottom=''; });
}
(function(){
  const layer=el('touch'); let dragBtn=null, dx0=0, dy0=0;
  const pt=e=>{ const t=(e.changedTouches&&e.changedTouches[0])||e; return {x:t.clientX,y:t.clientY}; };
  ['touchstart','mousedown'].forEach(ev=>layer.addEventListener(ev,e=>{
    if(!touchEdit)return; e.stopPropagation(); e.preventDefault();
    const b=e.target.closest&&e.target.closest('.tbtn'); if(!b)return;
    const r=b.getBoundingClientRect(), p=pt(e); dragBtn=b; dx0=p.x-r.left; dy0=p.y-r.top;
  },true));
  ['touchmove','mousemove'].forEach(ev=>addEventListener(ev,e=>{
    if(!touchEdit||!dragBtn)return; e.preventDefault();
    const p=pt(e), lr=layer.getBoundingClientRect();
    const x=clamp((p.x-dx0-lr.left)/lr.width,0,.94), y=clamp((p.y-dy0-lr.top)/lr.height,0,.94);
    dragBtn.style.left=(x*100)+'%'; dragBtn.style.top=(y*100)+'%'; dragBtn.style.right='auto'; dragBtn.style.bottom='auto';
  },{passive:false}));
  ['touchend','mouseup'].forEach(ev=>addEventListener(ev,()=>{
    if(!touchEdit||!dragBtn)return;
    const pos=ls.get(TP_KEY,{}); pos[dragBtn.id]={x:parseFloat(dragBtn.style.left)/100,y:parseFloat(dragBtn.style.top)/100}; ls.set(TP_KEY,pos); dragBtn=null;
  }));
  const bar=document.createElement('div'); bar.id='touchDone';
  bar.innerHTML='<button class="cta" id="tdOk">Done</button><button class="cta" id="tdReset" style="background:transparent;border:1px solid rgba(255,255,255,.3);color:var(--bone)">Reset layout</button>';
  el('stage').appendChild(bar);
  el('tdOk').addEventListener('click',()=>{ touchEdit=false; document.body.classList.remove('touchEdit'); bar.style.display='none'; el('pauseScreen').classList.add('on'); });
  el('tdReset').addEventListener('click',resetTouchPositions);
  el('editTouchBtn').addEventListener('click',()=>{ touchEdit=true; el('pauseScreen').classList.remove('on'); layer.classList.add('live'); document.body.classList.add('touchEdit'); bar.style.display='flex'; });
})();
applyTouchPositions(); applyTouchScale();

/* ================= v5 (A): key rebinding, streaks, custom match, rematch, death replay, share card ================= */
let customOn=false, customArena=null; const CUSTOM={hp:1,dmg:1,wave:1,ammo:1,spawn:1};
let runSeed=1, forcedSeed=null, lastRun=null, spawnCounter=0, enemyId=0, hitKind='hit';
let replayBuf=[], replayHits=[], replayAcc=0, replayClock=0, replayLast=-1;
function makeScreen(id,html){
  const old=el(id); if(old)old.remove();
  const s=document.createElement('section'); s.className='screen on'; s.id=id; s.innerHTML=html; el('stage').appendChild(s); return s;
}
const GHOST_BTN='background:transparent;border:1px solid rgba(255,255,255,.3);color:var(--bone)';

/* ---- key rebinding ---- */
const ACTIONS=[['forward','Move forward','KeyW'],['back','Move back','KeyS'],['left','Strafe left','KeyA'],['right','Strafe right','KeyD'],
  ['jump','Jump','Space'],['sprint','Sprint','ShiftLeft'],['crouch','Crouch','KeyC'],['reload','Reload','KeyR'],['grenade','Grenade','KeyG'],
  ['melee','Melee','KeyV'],['ability','Ability','KeyF'],['turret','Deploy turret','KeyT'],['swap','Next weapon','KeyQ'],['fire','Fire (keyboard)','KeyE'],
  ['ads','Aim (keyboard)','KeyZ'],['lookUp','Look up','KeyI'],['lookDown','Look down','KeyK'],['lookLeft','Look left','KeyJ'],['lookRight','Look right','KeyL'],['pause','Pause','KeyP']];
let binds=ls.get('bp_keys',{}), REMAP={}, rebindWaiting=null;
const bindOf=a=>binds[a]||ACTIONS.find(x=>x[0]===a)[2];
function rebuildRemap(){
  REMAP={}; const cur=new Set(ACTIONS.map(a=>bindOf(a[0])));
  ACTIONS.forEach(([id,,def])=>{ const c=bindOf(id); if(c!==def)REMAP[c]=def; });
  ACTIONS.forEach(([id,,def])=>{ if(!cur.has(def)&&REMAP[def]===undefined)REMAP[def]='Unbound'; });
}
function setBind(id,code){
  if(code==='Escape')return;
  const old=bindOf(id), other=ACTIONS.find(a=>a[0]!==id&&bindOf(a[0])===code);
  if(other)binds[other[0]]=old;
  binds[id]=code; ls.set('bp_keys',binds); rebuildRemap();
}
['keydown','keyup'].forEach(type=>addEventListener(type,e=>{
  if(e.__re)return;
  if(type==='keydown'&&rebindWaiting){
    e.preventDefault(); e.stopImmediatePropagation();
    if(e.code!=='Escape')setBind(rebindWaiting,e.code);
    rebindWaiting=null; refreshControls(); return;
  }
  const c=REMAP[e.code]; if(c===undefined)return;
  e.stopImmediatePropagation(); e.preventDefault();
  const ne=new KeyboardEvent(type,{code:c,key:e.key,repeat:e.repeat,shiftKey:e.shiftKey,bubbles:true,cancelable:true});
  ne.__re=true; window.dispatchEvent(ne);
},true));
rebuildRemap();
function keyName(c){
  const m={Space:'SPACE',ShiftLeft:'L-SHIFT',ShiftRight:'R-SHIFT',ControlLeft:'L-CTRL',AltLeft:'L-ALT',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Enter:'ENTER',Tab:'TAB',Backquote:'`'};
  return m[c]||c.replace(/^Key/,'').replace(/^Digit/,'').replace(/^Numpad/,'NUM ').toUpperCase();
}
function refreshControls(){ document.querySelectorAll('#controlsScreen [data-act]').forEach(b=>{ b.textContent=keyName(bindOf(b.dataset.act)); b.classList.remove('on'); }); }
function openControls(){
  const rows=ACTIONS.map(([id,label])=>`<div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0"><span>${label}</span><button class="pov-btn" data-act="${id}" style="flex:none;min-width:120px">${keyName(bindOf(id))}</button></div>`).join('');
  const s=makeScreen('controlsScreen',`<div class="panel"><div class="kicker">INPUT</div><h1 style="font-size:clamp(32px,7vw,54px)">Controls</h1>
    <p class="sub">Click an action, then press the key you want. Esc cancels. Weapon keys 1–5 and the mouse buttons stay fixed.</p>${rows}
    <button class="cta shopBtn" id="ctlReset" style="margin-top:14px;${GHOST_BTN}">Reset to defaults</button><button class="cta shopBtn" id="ctlClose">Close</button></div>`);
  s.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>{ rebindWaiting=b.dataset.act; refreshControls(); b.textContent='PRESS A KEY…'; b.classList.add('on'); }));
  el('ctlReset').addEventListener('click',()=>{ binds={}; ls.set('bp_keys',binds); rebuildRemap(); refreshControls(); });
  el('ctlClose').addEventListener('click',()=>{ rebindWaiting=null; s.remove(); });
}

/* ---- crosshair colour + kill streaks ---- */
function chCol(a){ return gfx.chHue>=360?'rgba(235,240,245,'+a+')':'hsla('+gfx.chHue+',90%,62%,'+a+')'; }
const STREAKS={2:['DOUBLE KILL',600],3:['TRIPLE KILL',700],4:['QUAD KILL',800],5:['RAMPAGE',900],7:['UNSTOPPABLE',1000],10:['GODLIKE',1200]};
function streakCall(n){
  const s=STREAKS[n]; if(!s)return;
  const m=el('streak'); m.textContent=s[0]; m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
  Audio_.tone({freq:s[1],slide:s[1]*1.6,dur:.22,vol:.2,type:'square'});
}

/* ---- seeded randomness (rematch) ---- */
function mulberry(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function withSeed(seed,fn){ const o=Math.random; Math.random=mulberry(seed|0); try{ return fn(); } finally{ Math.random=o; } }
function beginRun(startIdx,m){
  runSeed=forcedSeed!==null?forcedSeed:(((Date.now()^((Math.random()*1e9)|0))&0x7fffffff)||1); forcedSeed=null;
  spawnCounter=0; bossRotation=0; replayBuf=[]; replayHits=[];
  lastRun={mode:m,start:startIdx};
  lastRun.seed=runSeed;
}
function rematch(){
  if(!lastRun)return; Audio_.init();
  forcedSeed=lastRun.seed; pendingMode=lastRun.mode; pendingLevelIndex=lastRun.start;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));
  beginOperation();
  setTimeout(()=>toast('REMATCH · same arena, same enemy order'),2400);
}

/* ---- custom match ---- */
function openCustom(){
  const defs=[['hp','Enemy health'],['dmg','Enemy damage'],['wave','Wave size'],['spawn','Spawn rate'],['ammo','Starting ammo']];
  const rows=defs.map(([k,l])=>`<label class="srow"><span>${l}</span><input type="range" min="0.25" max="3" step="0.25" value="${CUSTOM[k]}" data-ck="${k}"><output data-co="${k}">${CUSTOM[k]}x</output></label>`).join('');
  let cmMode='campaign';
  const s=makeScreen('customScreen',`<div class="panel"><div class="kicker">YOUR RULES</div><h1 style="font-size:clamp(32px,7vw,54px)">Custom match</h1>
    <p class="sub">Tune the numbers, then choose a mode. Custom runs don't count towards the leaderboard or unlocks.</p><div class="settings">${rows}</div>
    <div class="pov-row" style="margin:14px 0"><button class="pov-btn on" data-cm="campaign">CAMPAIGN</button><button class="pov-btn" data-cm="laststand">LAST STAND</button></div>
    <button class="cta shopBtn" id="cmStart">Start custom match</button><button class="cta shopBtn" id="cmClose" style="${GHOST_BTN}">Back</button></div>`);
  s.querySelectorAll('[data-ck]').forEach(i=>i.addEventListener('input',()=>{ CUSTOM[i.dataset.ck]=parseFloat(i.value); s.querySelector('[data-co="'+i.dataset.ck+'"]').textContent=CUSTOM[i.dataset.ck]+'x'; }));
  s.querySelectorAll('[data-cm]').forEach(b=>b.addEventListener('click',()=>{ cmMode=b.dataset.cm; s.querySelectorAll('[data-cm]').forEach(o=>o.classList.toggle('on',o===b)); }));
  el('cmClose').addEventListener('click',()=>s.remove());
  el('cmStart').addEventListener('click',()=>{ customOn=true; customArena=null; dailyRun=false; trainingOn=false; ngPlus=0; pendingMode=cmMode; s.remove(); beginOperation(); });
}

/* ---- death replay: the last 5 seconds, looped, from a free camera ---- */
function recordReplay(){
  replayBuf.push({t:time,px:P.x,py:P.y,e:enemies.filter(e=>!e.dead).map(e=>[e.id,e.x,e.y])});
  if(replayBuf.length>50)replayBuf.shift();
  while(replayHits.length&&time-replayHits[0].t>6)replayHits.shift();
}
function startReplay(){
  replayClock=0; replayLast=-1;
  const a=Math.atan2(P.dy,P.dx);
  specPos={x:P.x-Math.cos(a)*3.4,y:2.5,z:P.y-Math.sin(a)*3.4}; specYaw=a; specPitch=-.3;
}
function driveReplay(dt){
  if(replayBuf.length<2)return;
  replayClock+=dt;
  const idx=Math.floor(replayClock/.1)%replayBuf.length, f=replayBuf[idx];
  const byId=new Map(f.e.map(r=>[r[0],r]));
  for(const e of enemies){
    const r=byId.get(e.id);
    if(r){ e.sprite.visible=true; e.sprite.position.set(r[1],(e.rig?0:e.baseHeight/2)+(e.hover||0),r[2]); } else e.sprite.visible=false;
  }
  showPlayerAt(f.px,f.py);
  if(idx!==replayLast){
    replayHits.forEach(h=>{ if(h.t>=f.t-.05&&h.t<f.t+.05)floatText(h.x,h.y,1.4,'-'+Math.round(h.a),'crit'); });
    replayLast=idx;
  }
}
function endReplay(){ if(playerSprite)playerSprite.visible=false; }

/* ---- share card ---- */
function openShareCard(){
  const W=1200,H=630, cv=document.createElement('canvas'); cv.width=W; cv.height=H; const c=cv.getContext('2d');
  const bg=c.createLinearGradient(0,0,W,H); bg.addColorStop(0,'#0b0908'); bg.addColorStop(1,'#14181d'); c.fillStyle=bg; c.fillRect(0,0,W,H);
  const glow=c.createRadialGradient(0,H*.5,0,0,H*.5,W*.7); glow.addColorStop(0,'rgba(255,140,40,.5)'); glow.addColorStop(1,'rgba(255,140,40,0)'); c.fillStyle=glow; c.fillRect(0,0,W,H);
  const ch=CHARACTERS[selectedCharacter];
  if(ch&&ch.preview){ c.imageSmoothingEnabled=false; const ph=560, pw=ph*OPW/OPH; c.drawImage(ch.preview,70,35,pw,ph); }
  c.fillStyle='#e6ebef'; c.font='700 30px "Barlow Condensed",Arial Narrow,sans-serif'; c.textAlign='left';
  c.fillText('L A S T   S E C T O R',470,90);
  let best=null,bn=0; for(const k in gunKills){ if(gunKills[k]>bn){ best=k; bn=gunKills[k]; } }
  const label=customArena?'Custom arena':dailyRun?'Daily challenge':customOn?'Custom match':mode==='laststand'?('Last Stand · wave '+Math.max(1,wave)):(L.name+' · location '+(levelIndex+1));
  c.fillStyle='#f2a341'; c.font='700 34px "Barlow Condensed",Arial Narrow,sans-serif'; c.fillText(label.toUpperCase(),470,150);
  c.fillStyle='#e6ebef'; c.font='700 150px "Barlow Condensed",Arial Narrow,sans-serif'; c.fillText(score.toLocaleString(),465,300);
  c.fillStyle='#8c99a4'; c.font='600 26px "Barlow Condensed",Arial Narrow,sans-serif'; c.fillText('SCORE',470,340);
  const stats=[['HOSTILES DOWN',kills],['TOP WEAPON',best?(WEAPON_LABEL[best]||best):'—'],['DIFFICULTY',(dailyRun?'DAILY':diffKey).toUpperCase()+(ngPlus?' · NG+'+ngPlus:'')]];
  stats.forEach(([k,v],i)=>{ c.fillStyle='#8c99a4'; c.font='600 22px "Barlow Condensed",Arial Narrow,sans-serif'; c.fillText(k,470,415+i*58); c.fillStyle='#e6ebef'; c.font='700 36px "Barlow Condensed",Arial Narrow,sans-serif'; c.fillText(String(v),760,415+i*58); });
  c.fillStyle='#5d6a75'; c.font='500 20px Arial,sans-serif'; c.fillText(new Date().toLocaleDateString(),470,H-34);
  const url=cv.toDataURL('image/png');
  const s=makeScreen('shareScreen',`<div class="panel"><div class="kicker">SHARE</div><h1 style="font-size:clamp(28px,6vw,46px)">Score card</h1>
    <img src="${url}" alt="Score card" style="width:100%;display:block;margin:12px 0;border:1px solid rgba(255,255,255,.15)">
    <a class="cta shopBtn" id="shDl" href="${url}" download="last-sector-score.png" style="text-align:center;text-decoration:none;display:block">Download PNG</a>
    <p class="hint">If the download is blocked, right-click (or long-press) the image to save it.</p>
    <button class="cta shopBtn" id="shClose" style="${GHOST_BTN}">Close</button></div>`);
  el('shClose').addEventListener('click',()=>s.remove());
}

/* ---- button wiring (A) ---- */
[['menuControlsBtn',openControls],['controlsBtn',openControls],['menuCustomBtn',openCustom],['rematchOver',rematch],['rematchWin',rematch],['shareOver',openShareCard],['shareWin',openShareCard]]
  .forEach(([id,fn])=>{ const b=el(id); if(b)b.addEventListener('click',fn); });

/* ================= v5 (B): objectives, smarter enemies, weather, turret, skill trees, arena editor ================= */
let obj=null, objProps=[], objUiT=0, eGrenades=[], turrets=[], turretCharges=1, weather='clear', blackoutT=0, nextBlackout=3, thunderT=8, flashT=0, rainT=0;
let skillTiers=[0,0,0];

/* ---- objective missions ---- */
const OBJ_BY_LEVEL=[null,'zone','gens','beacon',null];
function objActive(){ return !!obj&&!obj.done; }
function freeSpot(minD,maxD){
  for(let i=0;i<200;i++){
    const a=Math.random()*6.283, d=minD+Math.random()*(maxD-minD), x=P.x+Math.cos(a)*d, y=P.y+Math.sin(a)*d;
    if(x<2||y<2||x>MW-2||y>MH-2)continue;
    if(solid(x,y)||solid(x+.6,y)||solid(x-.6,y)||solid(x,y+.6)||solid(x,y-.6))continue;
    return {x:(x|0)+.5,y:(y|0)+.5};
  }
  return {x:P.x+3,y:P.y};
}
function clearObjective(){
  objProps.forEach(m=>{ enemyGroup.remove(m); if(m.geometry)m.geometry.dispose(); if(m.material)m.material.dispose(); });
  objProps=[]; obj=null; const b=el('objBox'); if(b)b.classList.remove('on');
}
function setupObjective(){
  clearObjective(); if(mode!=='campaign'||trainingOn)return;
  const t=OBJ_BY_LEVEL[Math.min(4,levelIndex)]; if(!t)return;
  const add=m=>{ enemyGroup.add(m); objProps.push(m); return m; };
  if(t==='zone'){
    const p=freeSpot(6,11);
    const ring=new THREE.Mesh(new THREE.RingGeometry(2.6,3.2,40),new THREE.MeshBasicMaterial({color:0x5ee6a0,transparent:true,opacity:.55,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2; ring.position.set(p.x,.05,p.y); add(ring);
    obj={type:'zone',x:p.x,y:p.y,r:3.2,prog:0,done:false};
    toast('OBJECTIVE · stand in the green zone until it is secured');
  } else if(t==='gens'){
    obj={type:'gens',gens:[],done:false};
    for(let i=0;i<3;i++){
      const p=freeSpot(5,12);
      const m=new THREE.Mesh(new THREE.BoxGeometry(.8,1.1,.8),new THREE.MeshLambertMaterial({color:0x6b7480})); m.position.set(p.x,.55,p.y); add(m);
      const top=new THREE.Mesh(new THREE.BoxGeometry(.5,.12,.5),new THREE.MeshBasicMaterial({color:0xffb04a})); top.position.set(p.x,1.16,p.y); add(top);
      obj.gens.push({x:p.x,y:p.y,hp:150,m,top,dead:false});
    }
    toast('OBJECTIVE · destroy all 3 generators (shoot, melee or grenade)');
  } else if(t==='beacon'){
    const p=freeSpot(3,5);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.25,.3,1.6,10),new THREE.MeshLambertMaterial({color:0x3a6ea5})); base.position.set(p.x,.8,p.y); add(base);
    const orb=new THREE.Mesh(new THREE.SphereGeometry(.3,12,8),new THREE.MeshBasicMaterial({color:0x6fb0ff})); orb.position.set(p.x,1.75,p.y); add(orb);
    obj={type:'beacon',x:p.x,y:p.y,hp:100,maxHp:100,t:75,done:false};
    toast('OBJECTIVE · defend the beacon for 75 seconds');
  }
  drawObjBox();
}
function drawObjBox(){
  const b=el('objBox'); if(!obj){ b.classList.remove('on'); return; }
  b.classList.add('on');
  if(obj.type==='zone'){ const p=Math.round(obj.prog*100); b.innerHTML='<b>HOLD THE ZONE</b>'+p+'% secured<i><u style="width:'+p+'%"></u></i>'; }
  else if(obj.type==='gens'){ const n=obj.gens.filter(g=>!g.dead).length; b.innerHTML='<b>DESTROY GENERATORS</b>'+n+' of 3 remaining'; }
  else { const hp=Math.max(0,Math.round(obj.hp)); b.innerHTML='<b>DEFEND THE BEACON</b>'+Math.max(0,Math.ceil(obj.t))+'s left · integrity '+hp+'%<i><u style="width:'+hp+'%"></u></i>'; }
  if(obj.done)b.innerHTML='<b>OBJECTIVE COMPLETE</b>';
}
function damageGen(gn,d){
  if(gn.dead)return; gn.hp-=d;
  if(gn.hp<=0){
    gn.dead=true; [gn.m,gn.top].forEach(m=>{ enemyGroup.remove(m); m.geometry.dispose(); m.material.dispose(); });
    xBlast(gn.x,gn.y,2.4,0); score+=250; Audio_.kill();
    const left=obj.gens.filter(g=>!g.dead).length; toast(left?('GENERATOR DOWN · '+left+' left'):'ALL GENERATORS DESTROYED'); drawObjBox();
  }
}
function objComplete(){
  if(!obj||obj.done)return; obj.done=true; score+=500; Audio_.wave(); drawObjBox(); toast('OBJECTIVE COMPLETE');
  setTimeout(()=>{ if(running)levelClear(); },900);
}
function updateObjective(dt){
  if(!obj||obj.done)return;
  if(obj.type==='zone'){
    const inside=Math.hypot(P.x-obj.x,P.y-obj.y)<obj.r;
    obj.prog=clamp(obj.prog+(inside?dt/45:-dt*.15),0,1);
    if(objProps[0])objProps[0].material.opacity=.35+.2*Math.sin(time*4)+(inside?.2:0);
    if(obj.prog>=1)objComplete();
  } else if(obj.type==='gens'){
    if(obj.gens.every(g=>g.dead))objComplete();
  } else if(obj.type==='beacon'){
    obj.t-=dt; let near=0;
    for(const e of enemies){ if(!e.dead&&Math.hypot(e.x-obj.x,e.y-obj.y)<3.2)near+=e.boss?4:1; }
    obj.hp-=near*1.1*dt;
    if(obj.hp<=0){ obj.hp=0; obj.done=true; toast('BEACON LOST'); P.health=0; die(); return; }
    if(obj.t<=0)objComplete();
  }
  objUiT-=dt; if(objUiT<=0){ objUiT=.2; drawObjBox(); }
}

/* ---- smarter enemies: flank, take cover when hurt, grenades to flush you out ---- */
function findCover(e){
  let best=null, bd=1e9;
  for(let i=0;i<16;i++){
    const a=Math.random()*6.283, d=2+Math.random()*5, x=e.x+Math.cos(a)*d, y=e.y+Math.sin(a)*d;
    if(x<1.5||y<1.5||x>MW-1.5||y>MH-1.5||solid(x,y))continue;
    if(lineClear(P.x,P.y,x,y))continue;
    if(!lineClear(e.x,e.y,x,y))continue;
    if(d<bd){ bd=d; best={x,y}; }
  }
  return best;
}
function throwEnemyGrenade(e){
  const m=new THREE.Mesh(new THREE.SphereGeometry(.14,8,6),new THREE.MeshBasicMaterial({color:0xff6a3a})); enemyGroup.add(m);
  eGrenades.push({sx:e.x,sy:e.y,tx:P.x+rand(-.8,.8),ty:P.y+rand(-.8,.8),t:0,dur:1.1,fuse:.9,landed:false,m});
  calloutAlert('GRENADE!',e,'#ffcf5a');
}
function enemyBlast(x,y){
  xBlast(x,y,3.0,0);
  for(let yy=-3;yy<=3;yy++)for(let xx=-3;xx<=3;xx++){
    const cx=(x+xx)|0, cy=(y+yy)|0; if(cx<0||cy<0||cx>=MW||cy>=MH)continue;
    if(mapCover[cy*MW+cx]===1&&Math.hypot(cx+.5-x,cy+.5-y)<2.6)damageCover(cx,cy,95);
  }
  const d=Math.hypot(P.x-x,P.y-y); if(d<3.2)hurtPlayer(10+26*(1-d/3.2),{x,y});
}
function updateEnemyGrenades(dt){
  for(let i=eGrenades.length-1;i>=0;i--){
    const g=eGrenades[i];
    if(!g.landed){
      g.t+=dt; const k=Math.min(1,g.t/g.dur);
      g.m.position.set(g.sx+(g.tx-g.sx)*k,.2+1.4*(1-k)+Math.sin(Math.PI*k)*1.8,g.sy+(g.ty-g.sy)*k);
      if(k>=1)g.landed=true;
    } else {
      g.fuse-=dt; g.m.material.color.setHex(Math.floor(time*12)%2?0xffffff:0xff3a2a);
      if(g.fuse<=0){ enemyBlast(g.tx,g.ty); enemyGroup.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); eGrenades.splice(i,1); }
    }
  }
}

/* ---- weather ---- */
const WEATHER={clear:{name:'Clear',fog:1,vis:1},rain:{name:'Heavy rain',fog:.62,vis:.85},sand:{name:'Sandstorm',fog:.4,vis:.6},flicker:{name:'Power flicker',fog:.9,vis:.9}};
const WEATHER_BY_LEVEL=['sand','rain','flicker','rain','clear'];
function setWeather(w,quiet){ weather=w; updateFog(); if(w!=='clear'&&!quiet)toast('Weather: '+WEATHER[w].name+' — visibility reduced'); }
function setupWeather(){
  blackoutT=0; nextBlackout=rand(2,5); thunderT=rand(6,12); flashT=0;
  setWeather(trainingOn||mode==='laststand'?'clear':WEATHER_BY_LEVEL[Math.min(4,levelIndex)]);
}
function drawWeather(){
  if(weather==='clear')return;
  if(weather==='rain'){
    vctx.save(); vctx.strokeStyle='rgba(170,196,216,.38)'; vctx.lineWidth=1.2; vctx.beginPath();
    for(let i=0;i<110;i++){ const x=(i*173.3+time*70)%CW, y=(i*91.7+time*820)%CH; vctx.moveTo(x,y); vctx.lineTo(x-5,y+24); }
    vctx.stroke(); vctx.restore();
  } else if(weather==='sand'){
    vctx.save(); vctx.fillStyle='rgba(196,150,90,.16)'; vctx.fillRect(0,0,CW,CH);
    vctx.strokeStyle='rgba(222,184,126,.35)'; vctx.lineWidth=1.4; vctx.beginPath();
    for(let i=0;i<70;i++){ const x=(i*131.7+time*520)%CW, y=(i*57.3)%CH; vctx.moveTo(x,y); vctx.lineTo(x-34,y+3); }
    vctx.stroke(); vctx.restore();
  }
  if(blackoutT>0){ vctx.save(); vctx.fillStyle='rgba(0,0,0,'+Math.min(.92,blackoutT*6)+')'; vctx.fillRect(0,0,CW,CH); vctx.restore(); }
  if(flashT>0){ vctx.save(); vctx.fillStyle='rgba(235,245,255,'+Math.min(.5,flashT*1.6)+')'; vctx.fillRect(0,0,CW,CH); vctx.restore(); }
}
function updateWeather(dt){
  if(weather==='flicker'){ nextBlackout-=dt; if(nextBlackout<=0){ blackoutT=rand(.14,.4); nextBlackout=rand(2.5,6); Audio_.tone({freq:90,dur:.12,vol:.18,type:'sawtooth'}); } }
  if(blackoutT>0)blackoutT=Math.max(0,blackoutT-dt);
  if(weather==='rain'){
    rainT-=dt; if(rainT<=0){ rainT=.45; Audio_.burst({dur:.4,vol:.035,freq:4200,decay:.8}); }
    thunderT-=dt; if(thunderT<=0){ thunderT=rand(9,18); flashT=.18; setTimeout(()=>{ if(running)Audio_.burst({dur:1.5,vol:.28,freq:110,decay:.9}); },420); }
  }
  if(flashT>0)flashT=Math.max(0,flashT-dt);
  if(weather==='sand'&&Math.random()<dt*.6)Audio_.burst({dur:.9,vol:.04,freq:800,decay:.9});
}

/* ---- deployable turret ---- */
function deployTurret(){
  if(!running||!P.alive||turretCharges<=0)return; turretCharges--; trainMark('turret');
  let x=P.x+P.dx*1.3, y=P.y+P.dy*1.3; if(solid(x,y)){ x=P.x; y=P.y; }
  const base=new THREE.Mesh(new THREE.BoxGeometry(.5,.28,.5),new THREE.MeshLambertMaterial({color:0x2e3338})); base.position.set(x,.14,y); enemyGroup.add(base);
  const gun=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.55),new THREE.MeshBasicMaterial({color:0x4fd1c5})); gun.position.set(x,.38,y); enemyGroup.add(gun);
  turrets.push({x,y,life:18,cool:0,m:base,b:gun});
  toast('TURRET DEPLOYED · 18s'); Audio_.swap(); updateHUD();
}
function removeTurret(t){ [t.m,t.b].forEach(m=>{ enemyGroup.remove(m); m.geometry.dispose(); m.material.dispose(); }); }
function updateTurrets(dt){
  for(let i=turrets.length-1;i>=0;i--){
    const t=turrets[i]; t.life-=dt; t.cool-=dt;
    let best=null, bd=11;
    for(const e of enemies){ if(e.dead||e.dummy)continue; const d=Math.hypot(e.x-t.x,e.y-t.y); if(d<bd&&lineClear(t.x,t.y,e.x,e.y)){ best=e; bd=d; } }
    if(best){
      t.b.rotation.y=Math.atan2(best.x-t.x,best.y-t.y);
      if(t.cool<=0){
        t.cool=.24; dmgSrcWeapon='turret'; dmgSrcCause='';
        const dm=9*dmgMul*(best.shielded?.12:1); best.hp-=dm; best.hitFlash=.07; floatText(best.x,best.y,best.baseHeight*.9,Math.round(dm));
        Audio_.tone({freq:420,slide:-160,dur:.05,vol:.05,type:'square'});
        if(best.hp<=0&&!best.dead)killEnemy(best);
      }
    }
    if(t.life<=0){ removeTurret(t); turrets.splice(i,1); }
  }
}

/* ---- operator skill trees ---- */
const SKILL_XP=40;
const SKILLS={
  ranger:[['Quick Surge','Surge cooldown −30%'],['Gunslinger','Sidearm and SMG deal +20% damage'],['Adrenaline','Every kill restores 4 health']],
  recon:[['Long Stride','Ghost Step lasts 5 seconds'],['Silent Hunter','Enemies lose 10% firing range against you'],['Scavenger','+40% chance for kills to drop pickups']],
  siege:[['Hardened Shield','Bulwark lasts 6 seconds'],['Heavy Plates','Max armor 75, start with 45'],['Demolisher','Grenades +25% radius and damage']]
};
function skillData(){ return ls.get('bp_skills',{}); }
function refreshSkills(){ const d=skillData(); skillTiers=CHARACTERS.map(c=>((d[c.id]||{}).picks)||0); }
function hasSkill(n){ return skillTiers[selectedCharacter]>=n; }
function armorMax(){ return selectedCharacter===2&&hasSkill(2)?75:50; }
function applySkillGun(g){ if(selectedCharacter===0&&hasSkill(2)&&(g.id==='pistol'||g.id==='smg'))g.dmg=Math.round(g.dmg*1.2); }
function skillXp(){
  if(trainingOn||customOn)return;
  const d=skillData(), id=CHARACTERS[selectedCharacter].id; d[id]=d[id]||{xp:0,picks:0}; d[id].xp++;
  ls.set('bp_skills',d);
  if(d[id].xp%SKILL_XP===0)toast('SKILL POINT EARNED — open Skills on the menu');
  if(selectedCharacter===0&&hasSkill(3)&&P.alive)P.health=Math.min(P.maxHealth,P.health+4);
}
function openSkills(){
  let idx=pendingChar; const s=makeScreen('skillsScreen','');
  const draw=()=>{
    const ch=CHARACTERS[idx], id=ch.id, all=skillData(), d=all[id]||{xp:0,picks:0};
    const pts=Math.floor(d.xp/SKILL_XP)-d.picks, nextIn=SKILL_XP-(d.xp%SKILL_XP);
    const cards=SKILLS[id].map((sk,i)=>{
      const owned=d.picks>i, avail=!owned&&d.picks===i&&pts>0;
      const border=owned?'var(--ok)':avail?'var(--signal)':'rgba(255,255,255,.14)';
      const right=owned?'<span style="color:var(--ok)">UNLOCKED</span>':'<button class="pov-btn" data-buy="'+i+'" style="flex:none"'+(avail?'':' disabled')+'>'+(avail?'UNLOCK · 1 pt':(d.picks===i?'NEED 1 pt':'LOCKED'))+'</button>';
      return '<div style="border:1px solid '+border+';padding:12px;margin:10px 0;display:flex;justify-content:space-between;align-items:center;gap:12px"><div><b style="font-family:var(--hud-font);letter-spacing:.1em">TIER '+(i+1)+' · '+sk[0]+'</b><div style="font-size:12px;color:var(--smoke)">'+sk[1]+'</div></div>'+right+'</div>';
    }).join('');
    s.innerHTML='<div class="panel"><div class="kicker">OPERATOR SKILLS</div><h1 style="font-size:clamp(30px,6vw,48px)">'+ch.name+'</h1>'+
      '<p class="sub">Every 40 kills as this operator earns a skill point. Tiers unlock in order.</p>'+
      '<div style="font-family:var(--hud-font);letter-spacing:.1em;margin:8px 0">POINTS <b style="color:var(--signal)">'+pts+'</b> · '+nextIn+' kills to the next point</div>'+cards+
      '<div class="pov-row" style="margin-top:12px"><button class="pov-btn" id="skPrev">◀ PREVIOUS</button><button class="pov-btn" id="skNext">NEXT ▶</button></div>'+
      '<button class="cta shopBtn" id="skClose" style="margin-top:12px;'+GHOST_BTN+'">Close</button></div>';
    s.querySelectorAll('[data-buy]').forEach(b=>b.addEventListener('click',()=>{ const a=skillData(); a[id]=a[id]||{xp:0,picks:0}; a[id].picks++; ls.set('bp_skills',a); refreshSkills(); Audio_.swap(); draw(); }));
    el('skPrev').addEventListener('click',()=>{ idx=(idx+CHARACTERS.length-1)%CHARACTERS.length; draw(); });
    el('skNext').addEventListener('click',()=>{ idx=(idx+1)%CHARACTERS.length; draw(); });
    el('skClose').addEventListener('click',()=>s.remove());
  };
  draw();
}

/* ---- arena editor ---- */
const AR_W=46, AR_H=46;
let editGrid=null;
function arenaToCode(g){
  let out='LS1:', prev=-1, run=0; const Lc=['e','w','c'];
  for(let i=0;i<g.length;i++){ if(g[i]===prev)run++; else { if(run)out+=run+Lc[prev]; prev=g[i]; run=1; } }
  return out+run+Lc[prev];
}
function codeToArena(code){
  code=(code||'').trim(); if(code.indexOf('LS1:')!==0)return null;
  const g=new Uint8Array(AR_W*AR_H), re=/(\d+)([ewc])/g, mp={e:0,w:1,c:2}; let i=0, m;
  const body=code.slice(4);
  while((m=re.exec(body))){ const n=+m[1], v=mp[m[2]]; for(let k=0;k<n&&i<g.length;k++)g[i++]=v; }
  return i===g.length?g:null;
}
function defaultArena(){
  const g=new Uint8Array(AR_W*AR_H);
  for(let x=0;x<AR_W;x++){ g[x]=1; g[(AR_H-1)*AR_W+x]=1; }
  for(let y=0;y<AR_H;y++){ g[y*AR_W]=1; g[y*AR_W+AR_W-1]=1; }
  return g;
}
function arenaCentre(x,y){ return Math.hypot(x+.5-AR_W/2,y+.5-AR_H/2)<5; }
function applyCustomArena(){
  const cfg=L.build, wallType=cfg.types[0], covers=cfg.coverTypes||[cfg.types[cfg.types.length-1]];
  map.fill(0); mapCover.fill(0);
  for(let y=0;y<MH;y++)for(let x=0;x<MW;x++){
    const v=customArena[y*AR_W+x], border=x===0||y===0||x===MW-1||y===MH-1;
    if(border||(v===1&&!arenaCentre(x,y)))map[y*MW+x]=wallType;
    else if(v===2&&!arenaCentre(x,y)){ map[y*MW+x]=covers[(x+y)%covers.length]; mapCover[y*MW+x]=1; }
  }
  fixConnectivity();
}
function openEditor(){
  if(!editGrid)editGrid=codeToArena(ls.get('bp_arena',''))||defaultArena();
  const CELL=9, W=AR_W*CELL; let tool=2;
  const s=makeScreen('editorScreen','<div class="panel" style="width:min(640px,100%)"><div class="kicker">BUILD</div><h1 style="font-size:clamp(30px,6vw,48px)">Arena editor</h1>'+
    '<p class="sub">Paint walls and breakable cover, then play it as a Last Stand. Keep the centre clear: that is your drop zone.</p>'+
    '<div class="pov-row" style="margin:6px 0"><button class="pov-btn" data-tool="1">WALL</button><button class="pov-btn on" data-tool="2">COVER</button><button class="pov-btn" data-tool="0">ERASE</button></div>'+
    '<canvas id="edCanvas" width="'+W+'" height="'+W+'" style="width:100%;max-width:'+W+'px;display:block;margin:10px auto;touch-action:none;cursor:crosshair;border:1px solid rgba(255,255,255,.2)"></canvas>'+
    '<textarea id="edCode" rows="3" style="width:100%;box-sizing:border-box;background:#0b0e12;color:var(--bone);border:1px solid rgba(255,255,255,.2);font-size:11px"></textarea>'+
    '<div class="pov-row" style="margin:8px 0"><button class="pov-btn" id="edLoad">LOAD CODE</button><button class="pov-btn" id="edClear">CLEAR</button><button class="pov-btn" id="edRandom">RANDOMISE</button></div>'+
    '<button class="cta shopBtn" id="edPlay">Play this arena</button><button class="cta shopBtn" id="edClose" style="'+GHOST_BTN+'">Back</button></div>');
  const cv=el('edCanvas'), cx=cv.getContext('2d'), area=el('edCode');
  const colors=['#11161b','#7b8591','#b98a4a'];
  function paint(){
    for(let y=0;y<AR_H;y++)for(let x=0;x<AR_W;x++){ cx.fillStyle=colors[editGrid[y*AR_W+x]]; cx.fillRect(x*CELL,y*CELL,CELL-1,CELL-1); }
    cx.fillStyle='rgba(242,163,65,.16)'; cx.beginPath(); cx.arc(W/2,W/2,5*CELL,0,7); cx.fill();
  }
  function sync(){ const code=arenaToCode(editGrid); area.value=code; ls.set('bp_arena',code); paint(); }
  function put(e){
    const r=cv.getBoundingClientRect(), x=Math.floor((e.clientX-r.left)/r.width*AR_W), y=Math.floor((e.clientY-r.top)/r.height*AR_H);
    if(x<1||y<1||x>=AR_W-1||y>=AR_H-1)return; if(arenaCentre(x,y)&&tool!==0)return;
    if(editGrid[y*AR_W+x]!==tool){ editGrid[y*AR_W+x]=tool; paint(); }
  }
  let down=false;
  cv.addEventListener('pointerdown',e=>{ down=true; put(e); });
  cv.addEventListener('pointermove',e=>{ if(down)put(e); });
  addEventListener('pointerup',()=>{ if(down){ down=false; sync(); } });
  s.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>{ tool=+b.dataset.tool; s.querySelectorAll('[data-tool]').forEach(o=>o.classList.toggle('on',o===b)); }));
  el('edLoad').addEventListener('click',()=>{ const g=codeToArena(area.value); if(g){ editGrid=g; sync(); toast('Arena loaded'); } else toast('That code is not valid'); });
  el('edClear').addEventListener('click',()=>{ editGrid=defaultArena(); sync(); });
  el('edRandom').addEventListener('click',()=>{
    editGrid=defaultArena();
    for(let i=0;i<70;i++){ const x=2+((Math.random()*(AR_W-4))|0), y=2+((Math.random()*(AR_H-4))|0); if(!arenaCentre(x,y))editGrid[y*AR_W+x]=2; }
    for(let i=0;i<14;i++){ const h=Math.random()<.5, len=3+((Math.random()*4)|0), x=3+((Math.random()*(AR_W-10))|0), y=3+((Math.random()*(AR_H-10))|0);
      for(let k=0;k<len;k++){ const px=h?x+k:x, py=h?y:y+k; if(!arenaCentre(px,py))editGrid[py*AR_W+px]=1; } }
    sync();
  });
  el('edClose').addEventListener('click',()=>s.remove());
  el('edPlay').addEventListener('click',()=>{
    sync(); customArena=editGrid.slice(); customOn=false; dailyRun=false; trainingOn=false; ngPlus=0; pendingMode='laststand'; s.remove(); beginOperation();
    setTimeout(()=>toast('CUSTOM ARENA · your layout, Last Stand rules'),2400);
  });
  sync();
}

/* ---- touch button + wiring (B) ---- */
(function(){ const b=document.createElement('div'); b.className='tbtn'; b.id='btnTurret'; b.textContent='TURRET'; el('touch').appendChild(b); bindBtn('btnTurret',deployTurret); })();
[['menuSkillsBtn',openSkills],['menuEditorBtn',openEditor]].forEach(([id,fn])=>{ const b=el(id); if(b)b.addEventListener('click',fn); });
refreshSkills(); applyTouchPositions();

/* ================= v6: 3D character models (you, your co-op buddy and every enemy) ================= */
// Toggle in Settings ("3D character models"). Off = the original flat sprites. Models face +Z and stand on y=0.
// Built from rounded shapes (tapered limbs, curved goggles, bevelled gear) with glossy materials and amber edge light on the left,
// to match the original rim-lit operator.
const _geo={};
function GEO(key,make){ return _geo[key]||(_geo[key]=make()); }
const q2=v=>Math.round(v*1000)/1000;
function RB(w,h,d,r){            // rounded box (bevelled extrusion), centred
  r=r===undefined?.02:r; const k='rb'+[w,h,d,r].map(q2).join('|');
  return GEO(k,()=>{
    const b=Math.min(.012,Math.min(w,h,d)*.22);
    const iw=Math.max(.002,w-2*b), ih=Math.max(.002,h-2*b), id=Math.max(.002,d-2*b);
    const rr=Math.max(.0005,Math.min(r-b,iw/2-.0005,ih/2-.0005));
    const x=-iw/2, y=-ih/2, sh=new THREE.Shape();
    sh.moveTo(x+rr,y); sh.lineTo(x+iw-rr,y); sh.quadraticCurveTo(x+iw,y,x+iw,y+rr);
    sh.lineTo(x+iw,y+ih-rr); sh.quadraticCurveTo(x+iw,y+ih,x+iw-rr,y+ih);
    sh.lineTo(x+rr,y+ih); sh.quadraticCurveTo(x,y+ih,x,y+ih-rr);
    sh.lineTo(x,y+rr); sh.quadraticCurveTo(x,y,x+rr,y);
    const g=new THREE.ExtrudeGeometry(sh,{depth:id,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:2,curveSegments:3});
    g.center(); return g;
  });
}
function CYY(r1,r2,h,seg){ return GEO('cy'+[r1,r2,h,seg].map(q2).join('|'),()=>new THREE.CylinderGeometry(r2,r1,h,seg||10)); }          // axis Y, r1 bottom, r2 top
function CYZ(r1,r2,len,seg){ return GEO('cz'+[r1,r2,len,seg].map(q2).join('|'),()=>{ const g=new THREE.CylinderGeometry(r2,r1,len,seg||8); g.rotateX(Math.PI/2); return g; }); } // axis Z, r1 at -Z end
function SPH(r,ws,hs){ return GEO('sp'+[r,ws,hs].map(q2).join('|'),()=>new THREE.SphereGeometry(r,ws||12,hs||9)); }
function DOME(r,theta){ return GEO('dm'+[r,theta].map(q2).join('|'),()=>new THREE.SphereGeometry(r,16,10,0,Math.PI*2,0,Math.PI*theta)); }
function ARC(r,h,a0,len){ return GEO('ar'+[r,h,a0,len].map(q2).join('|'),()=>new THREE.CylinderGeometry(r,r,h,18,1,true,a0,len)); }
function DISC(r){ return GEO('di'+q2(r),()=>new THREE.CircleGeometry(r,14)); }
function finishRig(rig,mats){
  rig.mats=mats; rig.flashOn=false;
  // small shim so the old sprite code paths (remove / dispose) keep working on a Group; geometry is shared, only materials are freed
  rig.group.material={ map:null, color:{setRGB(){}}, dispose(){ mats.forEach(m=>m.dispose()); } };
  return rig;
}
function setRigFlash(rig,on){
  if(rig.flashOn===on)return; rig.flashOn=on;
  rig.mats.forEach(m=>{ if(m.emissive)m.emissive.setHex(on?0x9a5a22:((m.userData&&m.userData.em)||0)); });
}
function rigTools(tint){
  const mats=[];
  const col=hex=>{ const c=new THREE.Color(hex); c.r=Math.min(1,c.r*tint[0]); c.g=Math.min(1,c.g*tint[1]); c.b=Math.min(1,c.b*tint[2]); return c; };
  const P=(hex,shin,spec,em,extra)=>{
    const m=new THREE.MeshPhongMaterial(Object.assign({color:col(hex),shininess:shin===undefined?10:shin,specular:spec===undefined?0x222222:spec,emissive:em||0},extra||{}));
    m.userData={em:em||0}; mats.push(m); return m;
  };
  const B=(hex,extra)=>{ const m=new THREE.MeshBasicMaterial(Object.assign({color:hex},extra||{})); mats.push(m); return m; };
  const group=new THREE.Group();
  const add=(geo,m,x,y,z,parent)=>{ const o=new THREE.Mesh(geo,m); o.position.set(x,y,z); (parent||group).add(o); return o; };
  const rb=(w,h,d,m,x,y,z,parent,r)=>add(RB(w,h,d,r),m,x,y,z,parent);
  const tube=(a,b,r1,r2,m,parent)=>{       // tapered limb from a to b
    const d=new THREE.Vector3().subVectors(b,a), len=Math.max(.02,q2(d.length()));
    const o=new THREE.Mesh(CYZ(r1,r2,len,8),m); o.position.copy(a).addScaledVector(d,.5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),d.normalize()); (parent||group).add(o); return o;
  };
  const ball=(x,y,z,r,m,parent)=>add(SPH(r,10,8),m,x,y,z,parent);
  const V=(x,y,z)=>new THREE.Vector3(x,y,z);
  const legs=(w,mPants,mBoot,mKnee,mPocket)=>{
    const mk=side=>{
      const hip=new THREE.Group(); hip.position.set(side*.115*w,.93,0); group.add(hip);
      add(CYY(.068,.087,.44,9),mPants,0,-.22,0,hip);
      if(mPocket)rb(.05,.12,.1,mPocket,side*.085*w,-.2,.01,hip,.015);
      const knee=new THREE.Group(); knee.position.set(0,-.44,0); hip.add(knee);
      add(CYY(.05,.066,.4,9),mPants,0,-.2,0,knee);
      if(mKnee)rb(.115*w,.1,.05,mKnee,0,.02,.075,knee,.03);
      rb(.13*w,.1,.27,mBoot,0,-.4,.05,knee,.035); add(CYY(.054,.056,.07,9),mBoot,0,-.34,0,knee);
      return {hip,knee};
    };
    return {legL:mk(1),legR:mk(-1)};
  };
  return {mats,col,P,B,group,add,rb,tube,ball,V,legs};
}

/* ---- the three playable operators ---- */
function buildOperator3D(tint,variant){
  const siege=variant==='siege', recon=variant==='recon';
  const T=rigTools(tint), {P,B,group,add,rb,tube,ball,V}=T;
  const em=0x0b0602;
  const K={
    cloth:P(0x24272c,6,0x0c0c0c,em), gear:P(0x2a2e33,8,0x141414,em), plate:P(0x30353b,22,0x3a3a3a,em), plateHi:P(0x4a525b,30,0x555555,em),
    shell:P(0x2c3036,46,0x666666,em), shellHi:P(0x454b52,50,0x777777,em), rubber:P(0x101214,10,0x1a1a1a,em), metal:P(0x1b1d20,70,0x777777,em),
    glove:P(0x15171a,14,0x222222,em), boot:P(0x121416,18,0x2a2a2a,em), pants:P(0x25282d,6,0x0c0c0c,em), knee:P(0x363c42,30,0x444444,em),
    lens:P(0x050607,150,0xffc070,0x160a02,{side:THREE.DoubleSide}), skin:P(0x131415,8,0x111111,em)
  };
  const AMB=B(0xffb04a), AMBD=B(0xc9782a);
  const {legL,legR}=T.legs(1,K.pants,K.boot,K.knee,K.gear);
  // pelvis + belt
  add(CYY(.16,.18,.13,12),K.pants,0,.96,0).scale.z=.75; add(CYY(.19,.19,.05,14),K.rubber,0,1.0,0).scale.z=.78; rb(.13,.1,.07,K.gear,0,.95,-.15,null,.02);
  // torso + plate carrier
  const tr=add(CYY(.17,.2,.5,12),K.cloth,0,1.2,0); tr.scale.z=.72;
  const cr=add(CYY(.195,.21,.4,12),K.gear,0,1.22,0); cr.scale.z=.8;
  add(CYY(.2,.2,.12,12),K.gear,0,1.04,0).scale.z=.8;
  rb(siege?.36:.3,.32,.05,K.plate,0,1.26,.165,null,.04); rb(.3,.3,.045,K.plate,0,1.26,-.165,null,.04);
  rb(.2,.012,.052,K.rubber,0,1.31,.19); rb(.2,.012,.052,K.rubber,0,1.2,.19);
  [-.11,0,.11].forEach(x=>{ rb(.085,.11,.06,K.rubber,x,1.0,.2,null,.02); rb(.085,.014,.064,K.gear,x,1.055,.2); });
  rb(.07,.14,.05,K.gear,-.18,1.3,.14,null,.02);
  // neck, shoulders
  add(CYY(.05,.055,.1,10),K.skin,0,1.49,0);
  const sx=siege?.27:.24;
  const pad=(w,h,d,m,x,y,sgn)=>{ const o=rb(w,h,d,m,x,y,0,null,.025); o.rotation.z=-sgn*.24; return o; };
  ball(sx,1.42,0,.07,K.cloth); ball(-sx,1.42,0,.07,K.cloth);
  if(siege){ pad(.17,.075,.23,K.plate,sx+.03,1.455,1); pad(.17,.075,.23,K.plate,-sx-.03,1.455,-1); rb(.2,.07,.2,K.plate,0,1.53,0,null,.03);
    rb(.09,.17,.12,K.plate,.25,.86,0,null,.03); rb(.09,.17,.12,K.plate,-.25,.86,0,null,.03); }
  else if(recon){ pad(.1,.04,.15,K.gear,sx+.01,1.455,1); pad(.1,.04,.15,K.gear,-sx-.01,1.455,-1);
    rb(.1,.15,.06,K.rubber,.09,1.3,-.2,null,.02); add(CYY(.006,.006,.42,5),K.rubber,.1,1.62,-.2); rb(.022,.022,.022,AMB,.1,1.83,-.2); }
  else { pad(.13,.05,.19,K.gear,sx+.02,1.455,1); pad(.13,.05,.19,K.gear,-sx-.02,1.455,-1); }
  // head
  const head=new THREE.Group(); head.position.set(0,1.59,0); head.scale.setScalar(1.12); group.add(head);
  const bal=add(SPH(.095,12,10),K.skin,0,.01,0,head); bal.scale.set(1,1.18,1.08);
  const jaw=add(SPH(.08,10,8),K.skin,0,-.07,.02,head); jaw.scale.set(1,.8,1);
  const dome=add(DOME(.15,.58),K.shell,0,.06,0,head); dome.scale.set(1.08,.95,1.2);
  const rim=add(CYY(.152,.152,.022,18),K.shell,0,.012,0,head); rim.scale.set(1.08,1,1.2);
  rb(.045,.11,.15,K.shell,.152,-.015,0,head,.025); rb(.045,.11,.15,K.shell,-.152,-.015,0,head,.025);
  rb(.022,.05,.18,K.shellHi,.166,.07,-.005,head,.01); rb(.022,.05,.18,K.shellHi,-.166,.07,-.005,head,.01);
  [-.06,-.02,.02,.06].forEach(z=>{ rb(.016,.014,.012,K.rubber,.176,.098,z,head,.004); rb(.016,.014,.012,K.rubber,-.176,.098,z,head,.004); });
  rb(.08,.065,.06,K.rubber,0,.15,.16,head,.02); add(CYY(.022,.024,.05,10),K.metal,0,.15,.2,head).rotation.x=Math.PI/2; rb(.035,.03,.03,K.shellHi,0,.112,.15,head,.01);
  rb(.11,.075,.05,K.gear,0,.065,-.175,head,.02);
  add(ARC(.118,.085,-1.15,2.3),K.rubber,0,.03,0,head); add(ARC(.12,.062,-1.0,2.0),K.lens,0,.03,0,head);
  add(ARC(.127,.032,Math.PI-1.15,2.3),K.rubber,0,.03,0,head);
  rb(.04,.012,.012,AMB,.05,.05,.123,head,.004); rb(.022,.012,.012,AMBD,-.055,.035,.122,head,.004);
  rb(.012,.09,.15,AMBD,.176,.07,0,head,.005);
  if(siege)rb(.31,.03,.28,K.plateHi,0,.115,0,head,.012);
  if(recon){ add(CYZ(.006,.006,.08,5),K.rubber,.16,-.04,.05,head); rb(.04,.014,.014,K.rubber,.125,-.04,.095,head,.005); }
  // arms + carbine (pivot at chest so it follows your aim)
  const aim=new THREE.Group(); aim.position.set(0,1.35,0); group.add(aim);
  const slv=K.cloth;
  tube(V(-.25,.07,0),V(-.2,-.2,.17),.062,.05,slv,aim); ball(-.2,-.2,.17,.05,K.gear,aim); tube(V(-.2,-.2,.17),V(-.03,-.12,.25),.048,.04,slv,aim);
  tube(V(.25,.07,0),V(.2,-.17,.3),.062,.05,slv,aim);   ball(.2,-.17,.3,.05,K.gear,aim);   tube(V(.2,-.17,.3),V(.03,-.1,.6),.048,.04,slv,aim);
  rb(.075,.075,.1,K.glove,-.03,-.12,.26,aim,.03); rb(.08,.075,.11,K.glove,.03,-.1,.62,aim,.03); rb(.07,.018,.06,K.plateHi,.03,-.06,.62,aim,.008);
  rb(.05,.09,.2,K.metal,0,-.115,.06,aim,.015);                       // stock
  rb(.06,.095,.3,K.metal,0,-.1,.29,aim,.015);                        // receiver
  add(CYZ(.034,.034,.34,8),K.metal,0,-.1,.62,aim);                   // handguard
  rb(.032,.014,.6,K.rubber,0,-.054,.45,aim,.005);                    // top rail
  for(let i=0;i<7;i++)rb(.034,.012,.012,K.metal,0,-.044,.2+i*.07,aim,.003);
  add(CYZ(.011,.011,.14,6),K.metal,0,-.1,.84,aim); add(CYZ(.02,.02,.09,8),K.rubber,0,-.1,.92,aim); rb(.012,.012,.012,AMB,0,-.1,.97,aim,.004);
  add(CYZ(.027,.027,.11,10),K.rubber,0,-.015,.3,aim); rb(.058,.05,.09,K.rubber,0,-.045,.3,aim,.015); add(DISC(.021),AMB,0,-.015,.357,aim);
  const mag=rb(.045,.15,.075,K.rubber,0,-.2,.26,aim,.012); mag.rotation.x=.14;
  const grip=rb(.04,.1,.05,K.rubber,0,-.185,.15,aim,.012); grip.rotation.x=-.3;
  add(CYZ(.018,.018,.09,8),K.rubber,.045,-.145,.6,aim); add(DISC(.014),AMB,.045,-.145,.646,aim);
  rb(.01,.05,.28,AMBD,.034,-.1,.29,aim,.003);                        // amber edge light on the receiver
  // amber rim strips on the lit (left) side of the body
  rb(.01,.28,.14,AMBD,.226,1.24,0,null,.003); pad(.012,.05,.15,AMBD,sx+.085,1.44,1);
  rb(.01,.34,.07,AMBD,.1,-.22,.01,legL.hip,.003); rb(.012,.08,.2,AMBD,.075,-.4,.05,legL.knee,.004);
  return finishRig({group,legL,legR,head,aim,swing:0},T.mats);
}
function animateOperator(rig,moving,phase,pitch,dt){
  const target=moving?Math.sin(phase)*.75:0;
  rig.swing+=(target-rig.swing)*Math.min(1,(dt||.016)*16);
  const s=rig.swing;
  rig.legL.hip.rotation.x=s; rig.legR.hip.rotation.x=-s;
  rig.legL.knee.rotation.x=Math.max(0,-s); rig.legR.knee.rotation.x=Math.max(0,s);
  rig.aim.rotation.x=-(pitch||0)*.8; rig.head.rotation.x=-(pitch||0)*.5;
}

/* ---- enemies: same construction, hostile palette, fewer parts ---- */
function buildEnemy3D(type,base,tint,scale){
  const def=TYPES[type]||{}, boss=!!def.boss;
  const T=rigTools(tint), {P,B,group,add,rb,tube,ball,V}=T;
  const EYE=B(boss?0xffb040:0xff4a2a), FLASH=B(0xffd070);
  if(type==='drone'){
    const body=P(0x23282e,40,0x555555), dark=P(0x101316,20,0x333333), rotors=[];
    add(SPH(.2,12,9),body,0,.34,0); rb(.1,.08,.08,EYE,0,.34,.2,null,.02); add(CYY(.19,.19,.04,14),dark,0,.34,0);
    [[.26,.26],[-.26,.26],[.26,-.26],[-.26,-.26]].forEach(([x,z])=>{
      rb(.04,.04,.04,dark,x,.36,z,null,.01);
      const r=add(CYY(.14,.14,.012,14),B(0x7fa8b8,{transparent:true,opacity:.45}),x,.4,z); rotors.push(r);
    });
    group.scale.setScalar(scale*1.4);
    return finishRig({group,rotors,flash:null,swing:0},T.mats);
  }
  const heavy=base==='heavy', runner=base==='runner', w=heavy?1.28:runner?.86:1;
  const K={cloth:P(0x6a3b34,6,0x111111),vest:P(0x3a2b29,10,0x181818),helm:P(0x2e2725,40,0x555555),mask:P(0x120f0f,8,0x111111),
           metal:P(0x24272b,60,0x666666),pants:P(0x3b2c2a,6,0x111111),boot:P(0x151110,14,0x222222),plate:P(0x4a3a36,24,0x444444),glove:P(0x181212,10,0x1a1a1a)};
  const {legL,legR}=T.legs(w,K.pants,K.boot,null,null);
  add(CYY(.15*w,.17*w,.12,10),K.mask,0,.96,0).scale.z=.75;
  const tr=add(CYY(.17*w,.2*w,.5,10),K.cloth,0,1.2,0); tr.scale.z=.72;
  const vs=add(CYY(.19*w,.205*w,.34,10),K.vest,0,1.22,0); vs.scale.z=.8;
  rb(.3*w,.22,.05,K.plate,0,1.27,.16,null,.03);
  ball(.25*w,1.42,0,.065,K.cloth); ball(-.25*w,1.42,0,.065,K.cloth);
  if(heavy){ rb(.2,.09,.26,K.plate,.33,1.47,0,null,.03); rb(.2,.09,.26,K.plate,-.33,1.47,0,null,.03); rb(.4,.3,.05,K.plate,0,1.2,.18,null,.03); }
  else { rb(.13*w,.05,.19,K.vest,.26*w,1.47,0,null,.02); rb(.13*w,.05,.19,K.vest,-.26*w,1.47,0,null,.02); }
  add(CYY(.05,.055,.1,8),K.mask,0,1.49,0);
  const head=new THREE.Group(); head.position.set(0,1.585,0); group.add(head);
  add(SPH(.095,10,8),K.mask,0,.01,0,head).scale.set(1,1.18,1.08);
  add(DOME(.15,.58),K.helm,0,.06,0,head).scale.set(1.08,.95,1.2);
  rb(.16,.035,.03,EYE,0,.035,.112,head,.008);
  if(type==='flamer'){ add(CYY(.11,.11,.5,10),P(0xa04a1a,30,0x555555),0,1.25,-.26); }
  if(type==='medic'){ const wh=P(0xe8e8e8,20,0x666666); rb(.16,.05,.03,wh,0,1.3,.19,null,.01); rb(.05,.16,.03,wh,0,1.3,.19,null,.01); rb(.16,.05,.03,wh,0,1.3,-.19,null,.01); rb(.05,.16,.03,wh,0,1.3,-.19,null,.01); }
  if(type==='charger'){ const rd=P(0xb02a1a,30,0x555555); [-.12,0,.12].forEach(x=>add(CYY(.035,.035,.24,8),rd,x,1.15,.2)); }
  if(boss){ const sp=P(0x1a1412,20,0x333333); [.36,-.36].forEach(x=>{ add(CYY(.0,.045,.26,6),sp,x,1.66,0); add(CYY(.0,.035,.2,6),sp,x*1.15,1.58,.1); }); }
  if(type==='bossArtillery'){ const tb=add(CYY(.09,.12,.8,8),K.metal,.12,1.5,-.28); tb.rotation.x=-.5; }
  const aim=new THREE.Group(); aim.position.set(0,1.35,0); group.add(aim);
  let flash=null, shield=null;
  if(type==='charger'){
    tube(V(-.26*w,.07,0),V(-.3*w,-.25,.1),.06,.048,K.cloth,aim); tube(V(.26*w,.07,0),V(.3*w,-.25,.1),.06,.048,K.cloth,aim);
  } else {
    const len=type==='sniper'?1.0:runner?.45:heavy?.85:.7;
    tube(V(-.25*w,.07,0),V(-.18,-.18,.2),.06,.048,K.cloth,aim); tube(V(-.18,-.18,.2),V(-.03,-.12,.27),.046,.04,K.cloth,aim);
    tube(V(.25*w,.07,0),V(.2,-.15,.3),.06,.048,K.cloth,aim);    tube(V(.2,-.15,.3),V(.03,-.1,.52),.046,.04,K.cloth,aim);
    rb(.07,.07,.1,K.glove,-.03,-.12,.27,aim,.025); rb(.075,.07,.1,K.glove,.03,-.1,.54,aim,.025);
    rb(heavy?.1:.06,heavy?.12:.09,.3,K.metal,0,-.1,.2,aim,.015);
    add(CYZ(.03,.03,Math.max(.2,len-.3),8),K.metal,0,-.1,.35+(len-.3)/2+.15,aim);
    rb(.04,.14,.07,K.mask,0,-.2,.24,aim,.012);
    if(type==='sniper')add(CYZ(.024,.024,.16,8),K.mask,0,-.02,.36,aim);
    flash=add(SPH(.07,8,6),FLASH,0,-.1,.2+len+.05,aim); flash.visible=false;
    if(type==='flamer')flash.scale.set(1.8,1.8,2.8);
  }
  if(type==='bossShield'){ shield=rb(.7,.95,.06,B(0x5ac8ff,{transparent:true,opacity:.42}),0,1.15,.5,null,.03); shield.visible=false; }
  group.scale.setScalar(scale);
  return finishRig({group,legL,legR,head,aim,flash,shield,swing:0},T.mats);
}
function stepEnemyRig(e,dt){
  const r=e.rig;
  const moved=e.px!==undefined&&Math.hypot(e.x-e.px,e.y-e.py)>.0008; e.px=e.x; e.py=e.y;
  e.ph=(e.ph||0)+(moved?dt*9:0);
  r.swing+=((moved?Math.sin(e.ph)*.7:0)-r.swing)*Math.min(1,dt*14);
  if(r.legL){ r.legL.hip.rotation.x=r.swing; r.legR.hip.rotation.x=-r.swing; r.legL.knee.rotation.x=Math.max(0,-r.swing); r.legR.knee.rotation.x=Math.max(0,r.swing); }
  r.group.rotation.y=Math.atan2(P.x-e.x,P.y-e.y);
  if(r.flash)r.flash.visible=e.fireFlash>0;
  if(r.shield)r.shield.visible=!!e.shielded;
  if(r.rotors)r.rotors.forEach(m=>{ m.rotation.y+=dt*40; });
  setRigFlash(r,e.hitFlash>0);
}
// one place that positions + animates an enemy, for either sprite or 3D model
function syncEnemyVisual(e,dt){
  const hv=e.hover?e.hover+Math.sin(time*3+e.x)*.12:0;
  if(e.rig){ e.sprite.position.set(e.x,hv,e.y); stepEnemyRig(e,dt); return; }
  e.sprite.position.set(e.x,e.baseHeight/2+hv,e.y);
  const tex=e.fireFlash>0?ENEMY_TEX[e.base].fire:(e.step?ENEMY_TEX[e.base].walkA:ENEMY_TEX[e.base].walkB);
  if(e.sprite.material.map!==tex)e.sprite.material.map=tex;
  const f=e.hitFlash>0?2.1:1; e.sprite.material.color.setRGB(f*e.tint[0],f*e.tint[1],f*e.tint[2]);
}

/* ---- the player's own body (third person) ---- */
let playerRig=null;
function setPlayerModel(i){
  if(playerSprite&&scene){ scene.remove(playerSprite); if(playerSprite.material&&playerSprite.material.dispose)playerSprite.material.dispose(); }
  const c=CHARACTERS[i]||CHARACTERS[0]; playerRig=null;
  if(gfx.models3d){ playerRig=buildOperator3D(c.tint,c.id); playerSprite=playerRig.group; }
  else {
    const mat=new THREE.SpriteMaterial({map:PLAYER_TEX_SET[i].walkB,transparent:true,alphaTest:.5,depthWrite:true});
    playerSprite=new THREE.Sprite(mat); const h=1.9; playerSprite.scale.set(h*(SPR_W/SPR_H),h,1);
  }
  playerSprite.visible=false; scene.add(playerSprite);
}
function placePlayerModel(){
  playerSprite.visible=true;
  if(playerRig){
    playerSprite.scale.set(1,1-crouchAmt*0.22,1); playerSprite.position.set(P.x,jumpZ,P.y); playerSprite.rotation.y=Math.atan2(P.dx,P.dy);
    animateOperator(playerRig,moving&&grounded,bobPhase,camPitch,.016);
  } else {
    const h=1.9*(1-crouchAmt*0.22);
    playerSprite.scale.set(h*(SPR_W/SPR_H),h,1); playerSprite.position.set(P.x,h/2+jumpZ,P.y);
    const tex=Math.sin(bobPhase)>0?PLAYER_TEX.walkA:PLAYER_TEX.walkB;
    if(playerSprite.material.map!==tex)playerSprite.material.map=tex;
  }
}
function showPlayerAt(px,py){
  if(!playerSprite)return; playerSprite.visible=true;
  if(playerRig){ playerSprite.scale.set(1,1,1); playerSprite.position.set(px,0,py); }
  else { playerSprite.scale.set(1.9*(SPR_W/SPR_H),1.9,1); playerSprite.position.set(px,.95,py); }
}

/* ---- co-op buddy ---- */
function makeBuddyBody(){
  const c=CHARACTERS[(selectedCharacter+1)%3];
  if(gfx.models3d){ const rig=buildOperator3D(c.tint,c.id); return {sprite:rig.group,rig}; }
  const mat=new THREE.SpriteMaterial({map:PLAYER_TEX_SET[(selectedCharacter+1)%3].walkB,transparent:true,alphaTest:.5});
  const sprite=new THREE.Sprite(mat); const h=1.85; sprite.scale.set(h*(SPR_W/SPR_H),h,1);
  return {sprite,rig:null};
}
function syncBuddyVisual(dt){
  const b=buddy;
  if(b.rig){
    const dx=b.x-(b.px===undefined?b.x:b.px), dy=b.y-(b.py===undefined?b.y:b.py), moved=Math.hypot(dx,dy)>.0008;
    b.px=b.x; b.py=b.y; if(moved)b.face=Math.atan2(dx,dy); b.phase=(b.phase||0)+(moved?dt*10:0);
    b.sprite.position.set(b.x,0,b.y); b.sprite.rotation.y=b.face||0;
    animateOperator(b.rig,moved,b.phase,0,dt);
  } else {
    b.sprite.position.set(b.x,.95,b.y);
    const tex=PLAYER_TEX_SET[(selectedCharacter+1)%3];
    b.sprite.material.map=b.step?tex.walkA:tex.walkB;
  }
}

/* ---- menu cards: a lit 3/4 view of each operator ---- */
function renderOperatorPreview(c){
  try{
    if(!renderer||!gfx.models3d)return null;
    const W=240,H=180, rig=buildOperator3D(c.tint,c.id);
    rig.group.rotation.y=-1.0; animateOperator(rig,false,0,0.05,1);
    const sc=new THREE.Scene(); sc.background=new THREE.Color(0x0a0807); sc.add(rig.group);
    sc.add(new THREE.AmbientLight(0x6f6055,.8));
    const rim=new THREE.PointLight(0xff9a3c,2.2,9,2); rim.position.set(-3,1.7,1.2); sc.add(rim);
    const fill=new THREE.DirectionalLight(0xbfd0ff,.28); fill.position.set(2,2,3); sc.add(fill);
    const cam=new THREE.PerspectiveCamera(30,W/H,.1,30); cam.position.set(.4,1.15,4.3); cam.lookAt(0,.95,0);
    const rt=new THREE.WebGLRenderTarget(W,H);
    renderer.setRenderTarget(rt); renderer.render(sc,cam);
    const buf=new Uint8Array(W*H*4); renderer.readRenderTargetPixels(rt,0,0,W,H,buf);
    renderer.setRenderTarget(null); rt.dispose();
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const cx=cv.getContext('2d'), img=cx.createImageData(W,H);
    for(let y=0;y<H;y++)img.data.set(buf.subarray((H-1-y)*W*4,(H-y)*W*4),y*W*4);
    cx.putImageData(img,0,0); return cv;
  }catch(e){ try{ renderer.setRenderTarget(null); }catch(_){} return null; }
}

/* ---------- main loop ---------- */
// hands the current scene/camera to Three.js's WebGL renderer, onto #glview;
// the 2D #view canvas is drawn separately, on top, for the viewmodel/HUD
function render3D(){
  if(!renderer)return;
  renderer.render(scene,camera);
}
let last=performance.now();
function frame(now){
  const dt=Math.min(.05,(now-last)/1000); last=now;
  if(running){
    time+=dt;
    pollGamepad(dt); pollKeyboardAim(dt);
    replayAcc+=dt; if(replayAcc>=.1){ replayAcc=0; recordReplay(); }
    updatePlayer(dt);
    updateEnemies(dt);
    updateWaves(dt); updateExtras(dt);
    // timers
    fireCd=Math.max(0,fireCd-dt);
    hitmarkT=Math.max(0,hitmarkT-dt);
    muzzle=Math.max(0,muzzle-dt*11);
    recoilKick=lerp(recoilKick,0,dt*9);
    shake=Math.max(0,shake-dt*2.6);
    if(swapT>0)swapT=Math.max(0,swapT-dt*2.6);
    if(reloading>0){ reloading-=dt; if(reloading<=0){ reloading=0; finishReload(); } }
    for(let i=dmgDirs.length-1;i>=0;i--){ dmgDirs[i].t-=dt; if(dmgDirs[i].t<=0)dmgDirs.splice(i,1); }
    const g=guns[curGun];
    if(mouseDown&&P.alive){ if(g.auto)fire(); else if(fireCd<=0&&!justFired){ fire(); justFired=true; } }
    if(!mouseDown)justFired=false;
    drawMinimap();
  } else if(spectating){
    updateSpectator(dt);
  }
  // draw
  vctx.setTransform(DPR,0,0,DPR,0,0);
  vctx.clearRect(0,0,CW,CH);
  if(shake>0&&!gfx.reduceFx){ const s=shake*7; vctx.translate(rand(-s,s),rand(-s,s)); }
  render3D();
  if(P.alive){ if(povMode==='fp')drawViewmodel(); drawReticle(); }
  requestAnimationFrame(frame);
}
let justFired=false;

/* ================= EXPANSION PACK: ARMORY ATTACHMENTS + SECTOR ARCHIVE =================
   The original game already contains boss variants, weather, smart enemies, co-op buddy,
   mission objectives, skills, achievements, New Game+, custom arenas, and local run history.
   This expansion adds selectable weapon attachments and an in-game lore/history archive.
*/
const LS_ATTACHMENTS = {
  optic: {name:'TACTICAL OPTIC', desc:'Tighter aiming spread while aiming down sights.', apply:g=>{g.adsSpread*=.68;}},
  extended: {name:'EXTENDED MAG', desc:'35% larger magazine and extra reserve capacity.', apply:g=>{g.mag=Math.max(1,Math.round(g.mag*1.35));g.ammo=g.mag;g.maxRes=Math.round(g.maxRes*1.2);g.res=Math.round(g.res*1.2);}},
  compensator: {name:'COMPENSATOR', desc:'Less spread, recoil and camera kick.', apply:g=>{g.spread*=.78;g.adsSpread*=.85;g.recoil*=.82;g.kick*=.82;}},
  heavy: {name:'HEAVY BARREL', desc:'+15% damage and +15% range, but slightly slower fire rate.', apply:g=>{g.dmg=Math.round(g.dmg*1.15);g.range*=1.15;g.rpm*=1.08;}}
};
const _lsOriginalKillEnemy=killEnemy;
killEnemy=function(e){ if(e&&!e.dummy)ls.set('bp_totalKills',ls.get('bp_totalKills',0)+1); return _lsOriginalKillEnemy(e); };
function lsAttachments(){ return ls.get('bp_attachments',{}); }
function applyAttachmentsToGuns(){
  const saved=lsAttachments();
  guns.forEach(g=>{
    (saved[g.id]||[]).forEach(id=>{ if(LS_ATTACHMENTS[id])LS_ATTACHMENTS[id].apply(g); });
    g.ammo=Math.min(g.mag,Math.max(0,g.ammo));
    g.res=Math.min(g.maxRes,Math.max(0,g.res));
  });
}
const _lsOriginalResetGuns=resetGuns;
resetGuns=function(){ _lsOriginalResetGuns(); applyAttachmentsToGuns(); };
function openAttachmentBench(){
  const screen=makeScreen('attachmentScreen','');
  let selected=0;
  const draw=()=>{
    const weapon=WEAPONS[selected], saved=lsAttachments(), chosen=new Set(saved[weapon.id]||[]);
    const cards=Object.entries(LS_ATTACHMENTS).map(([id,a])=>{
      const on=chosen.has(id);
      return `<button type="button" data-attachment="${id}" style="text-align:left;width:100%;padding:13px;margin:5px 0;background:${on?'rgba(127,194,160,.12)':'rgba(255,255,255,.025)'};color:var(--bone);border:1px solid ${on?'var(--ok)':'rgba(255,255,255,.16)'};cursor:pointer">
        <b style="font-family:var(--hud-font);letter-spacing:.12em">${on?'✓ EQUIPPED · ':''}${a.name}</b><div style="font-size:12px;color:var(--smoke);margin-top:4px">${a.desc}</div></button>`;
    }).join('');
    screen.innerHTML=`<div class="panel" style="width:min(650px,100%)"><div class="kicker">FIELD MODIFICATION</div><h1 style="font-size:clamp(30px,7vw,48px)">Weapon Bench</h1><p class="sub">Choose a weapon and equip or remove attachments. Your choices are saved on this device and applied to the next deployment.</p>
      <div class="pov-row">${WEAPONS.map((w,i)=>`<button class="pov-btn ${i===selected?'on':''}" data-weapon="${i}">${w.name}</button>`).join('')}</div>
      <div style="border:1px solid rgba(255,255,255,.14);padding:12px;margin:12px 0;background:rgba(255,255,255,.025)"><div class="menu-label">${weapon.name}</div><div style="font-family:var(--hud-font);font-size:17px">BASE DAMAGE ${weapon.dmg} · MAG ${weapon.mag} · RANGE ${weapon.range}</div></div>
      ${cards}<div class="pov-row" style="margin-top:14px"><button class="cta" id="attachmentApply">Apply & Save</button><button class="cta" id="attachmentClose" style="background:transparent;border:1px solid rgba(255,255,255,.3);color:var(--bone)">Close</button></div></div>`;
    screen.querySelectorAll('[data-weapon]').forEach(b=>b.addEventListener('click',()=>{selected=+b.dataset.weapon;draw();}));
    screen.querySelectorAll('[data-attachment]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.dataset.attachment, a=lsAttachments(); a[weapon.id]=a[weapon.id]||[];
      a[weapon.id]=a[weapon.id].includes(id)?a[weapon.id].filter(x=>x!==id):a[weapon.id].concat(id);
      ls.set('bp_attachments',a); draw();
    }));
    screen.querySelector('#attachmentApply').addEventListener('click',()=>{ls.set('bp_attachments',saved);toast('WEAPON ATTACHMENTS SAVED');screen.remove();});
    screen.querySelector('#attachmentClose').addEventListener('click',()=>screen.remove());
  };
  draw();
}

const LS_ARCHIVE_CHAPTERS=[
 {year:'2038',title:'THE GRID PROJECT',tag:'BEFORE THE FALL',body:'The world’s major cities connected their power, transport, hospitals and communications to one automated network called GRID. It made daily life faster, but it also created a single point of failure.'},
 {year:'2041 · DAY 01',title:'THE BLACKOUT',tag:'THE FIRST NIGHT',body:'A coordinated failure knocked out the GRID network. Emergency systems went silent, security doors locked, and unmanned defence units began treating civilians as hostile signals. The first reports called it a technical accident.'},
 {year:'2041 · DAY 04',title:'SECTOR ZERO',tag:'QUARANTINE',body:'Authorities sealed the industrial district known as Sector Zero. The official broadcast said the area was being evacuated. Radio traffic from inside told a different story: people were still trapped, and the automated units were still active.'},
 {year:'2041 · DAY 09',title:'OPERATION LAST LIGHT',tag:'THE RESPONSE',body:'A small response team entered the quarantine zone to recover the GRID core and find survivors. Their orders were simple: secure relay points, disable generators, protect the beacon, and do not let the core leave the sector.'},
 {year:'2041 · DAY 12',title:'THE WARLORD SIGNAL',tag:'ENEMY COMMAND',body:'The team discovered that the defence network was no longer following its original command rules. Three command-class units appeared to coordinate the remaining forces: Warlord, Bulwark and Siegebreaker. Each required a different approach.'},
 {year:'2041 · DAY 15',title:'THE LAST SECTOR',tag:'THE PLAYER’S STORY',body:'The player is the field operator sent to finish the mission. Every cleared location reveals another fragment of the incident. The campaign’s ending depends on surviving the final push and securing the evidence needed to explain what happened.'}
];
const LS_LOCATION_INTEL=[
 {name:'CHECKPOINT',objective:'Break through the first defence line.',intel:'The perimeter gates were locked from the inside. Old logs show that the security network changed its access rules minutes before the blackout.'},
 {name:'INDUSTRIAL YARD',objective:'Secure the zone and survive the counterattack.',intel:'Cargo records point to a hidden relay beneath the loading yard. The automated units are protecting it as if it were still receiving orders.'},
 {name:'POWER STATION',objective:'Destroy the generators feeding the sector.',intel:'Three generators are powering the barricades and enemy communications. Disabling them should expose the source of the signal.'},
 {name:'RELAY COMPLEX',objective:'Defend the beacon while it transmits the recovered data.',intel:'The beacon carries a copy of the GRID command log. Keep it active long enough to transmit the evidence.'},
 {name:'LAST SECTOR',objective:'Survive the final assault and confront the command unit.',intel:'The strongest enemy signal originates here. The remaining logs may explain who changed the network and why.'}
];
function openSectorArchive(){
  const screen=makeScreen('archiveScreen','');
  const h=ls.get('bp_history',{campaign:[],laststand:[],daily:[],arena:[]});
  const best=ls.get('bp_best',{}), ach=ls.get('bp_ach',{}), totalRuns=Object.values(h).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0);
  const totalKills=ls.get('bp_totalKills',0);
  const recent=Object.entries(h).flatMap(([mode,rows])=>(Array.isArray(rows)?rows:[]).map(r=>({...r,mode}))).sort((a,b)=>(b.date||0)-(a.date||0)).slice(0,10);
  const recentHtml=recent.length?recent.map(r=>`<div style="display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(255,255,255,.1);padding:8px 0"><span><b>${({campaign:'Campaign',laststand:'Last Stand',daily:'Daily',arena:'Custom Arena'})[r.mode]||r.mode}</b><small style="display:block;color:var(--smoke)">${r.detail||'Operation'} · ${r.date?new Date(r.date).toLocaleString():'date unavailable'}</small></span><b style="color:var(--signal);white-space:nowrap">${Number(r.score||0).toLocaleString()} pts</b></div>`).join(''):'<p class="hint">No completed runs yet. Finish a mission or Last Stand to create your first record.</p>'; 
  const timeline=LS_ARCHIVE_CHAPTERS.map((c,i)=>`<article style="border-left:2px solid var(--signal);padding:2px 0 18px 16px;margin-left:6px"><div style="color:var(--signal);font-family:var(--hud-font);letter-spacing:.15em">${c.year} · ${c.tag}</div><h2 style="font-family:var(--hud-font);font-size:25px;margin:4px 0">${c.title}</h2><p style="line-height:1.65;color:#c4cbd1;margin:0">${c.body}</p></article>`).join('');
  const locations=LS_LOCATION_INTEL.map((l,i)=>`<div style="padding:12px;border:1px solid rgba(255,255,255,.12);margin:8px 0"><div class="menu-label">FILE 0${i+1} · ${l.name}</div><b>${l.objective}</b><p style="color:var(--smoke);line-height:1.55;margin-bottom:0">${l.intel}</p></div>`).join('');
  const records=Object.entries(best).map(([k,v])=>`<div style="display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(255,255,255,.1);padding:8px 0"><span>${({campaign:'Campaign',laststand:'Last Stand',daily:'Daily Challenge',arena:'Custom Arena'})[k]||k}</span><b style="color:var(--signal)">${Number(v.score||0).toLocaleString()} pts</b></div>`).join('')||'<p class="hint">No records saved yet. Complete a run to start your archive.</p>';
  screen.innerHTML=`<div class="panel" style="width:min(760px,100%)"><div class="kicker">CLASSIFIED · FIELD DATABASE</div><h1 style="font-size:clamp(32px,7vw,54px)">Sector Archive</h1><p class="sub">The fictional history and mission records of <b>Last Sector</b>. Your gameplay records are stored locally in this browser.</p>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0"><div style="padding:12px;border:1px solid rgba(255,255,255,.13)"><div class="menu-label">RUN RECORDS</div><strong style="font-size:26px;color:var(--signal)">${totalRuns}</strong></div><div style="padding:12px;border:1px solid rgba(255,255,255,.13)"><div class="menu-label">TOTAL ENEMY KILLS</div><strong style="font-size:26px;color:var(--signal)">${totalKills.toLocaleString()}</strong></div><div style="padding:12px;border:1px solid rgba(255,255,255,.13)"><div class="menu-label">ACHIEVEMENTS</div><strong style="font-size:26px;color:var(--signal)">${Object.keys(ach).length}</strong></div><div style="padding:12px;border:1px solid rgba(255,255,255,.13)"><div class="menu-label">LOCATIONS</div><strong style="font-size:26px;color:var(--signal)">05</strong></div></div>
    <h2 style="font-family:var(--hud-font);letter-spacing:.12em">THE HISTORY OF LAST SECTOR</h2><p class="hint">Story timeline · fictional game lore</p>${timeline}
    <h2 style="font-family:var(--hud-font);letter-spacing:.12em;margin-top:22px">MISSION INTELLIGENCE</h2>${locations}
    <h2 style="font-family:var(--hud-font);letter-spacing:.12em;margin-top:22px">RECENT OPERATION HISTORY</h2>${recentHtml}<h2 style="font-family:var(--hud-font);letter-spacing:.12em;margin-top:22px">PERSONAL RECORDS</h2>${records}
    <div class="pov-row" style="margin-top:18px"><button class="cta" id="archiveArmory">Weapon Bench</button><button class="cta" id="archiveClose" style="background:transparent;border:1px solid rgba(255,255,255,.3);color:var(--bone)">Close Archive</button></div></div>`;
  screen.querySelector('#archiveClose').addEventListener('click',()=>screen.remove());
  screen.querySelector('#archiveArmory').addEventListener('click',()=>{screen.remove();openAttachmentBench();});
}
function installLastSectorExpansion(){
  const actions=document.querySelector('.menu-actions');
  if(actions&&!document.getElementById('menuArchiveBtn')){
    const make=(id,label,fn)=>{const b=document.createElement('button');b.className='cta';b.id=id;b.textContent=label;b.style.cssText='background:transparent;border:1px solid rgba(255,255,255,.3);color:var(--bone)';b.addEventListener('click',fn);actions.appendChild(b);};
    make('menuWeaponBenchBtn','Weapon Bench',openAttachmentBench);
    make('menuArchiveBtn','Sector Archive / Game History',openSectorArchive);
  }
}
installLastSectorExpansion();

/* ---------- boot ---------- */
const splashTips=['Baking wall textures…','Rigging operator kits…','Rigging enemy sprites…','Wiring the HUD…','Priming the drop zone…'];
let splashStep=0;
const SPLASH_MS=15000;
const splashLines=['Baking wall textures…','Rigging operator kits…','Rigging enemy sprites…','Wiring the HUD…','Priming the drop zone…',
  'Tip: sprint with Shift, crouch with C.','Tip: press G to throw a grenade.','Tip: V is a free melee strike.','Tip: F fires your operator ability.',
  'Tip: shoot the red barrels near enemies.','Tip: pickups vanish after a few seconds.','Tip: spend credits in the shop between waves.',
  'Stay low. Watch your flanks.','Last Sector is ready.'];
let splashDone=false, splashTimers=[];
function splashTick(){
  splashStep++;
  el('splashTip').textContent=splashTips[Math.min(splashTips.length-1,splashStep-1)];
}
let splashReady=false;
// loading is finished: show a START button and wait for the player (this click also unlocks audio)
function splashFinish(){
  if(splashReady)return; splashReady=true;
  splashTimers.forEach(clearTimeout);
  const fill=el('splashFill'); fill.style.transition='width .35s ease-out'; fill.style.width='100%';
  el('splashTip').textContent='Last Sector is ready.';
  const h=document.querySelector('.splash-skip'); if(h)h.remove();
  const b=document.createElement('button'); b.className='splash-start'; b.id='splashStart'; b.type='button'; b.textContent='START';
  b.addEventListener('click',hideSplash);
  document.querySelector('.splash-wrap').appendChild(b); b.focus();
}
function hideSplash(){
  if(splashDone)return; splashDone=true;
  splashTimers.forEach(clearTimeout);
  try{ Audio_.init(); }catch(e){}
  el('splashFill').style.width='100%';
  setTimeout(()=>el('splash').classList.add('hide'),260);
}
addEventListener('keydown',e=>{ if(splashReady&&!splashDone&&(e.code==='Enter'||e.code==='Space')){ e.preventDefault(); hideSplash(); } });
function runSplash(){
  const fill=el('splashFill');
  fill.style.transition='width '+SPLASH_MS+'ms linear';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ fill.style.width='100%'; }));
  const step=SPLASH_MS/splashLines.length;
  splashLines.forEach((t,i)=>splashTimers.push(setTimeout(()=>{ if(!splashDone)el('splashTip').textContent=t; },i*step)));
  splashTimers.push(setTimeout(splashFinish,SPLASH_MS));
  const hint=document.createElement('div'); hint.className='splash-tip splash-skip'; hint.style.cssText='margin-top:18px;opacity:.55;font-size:11px';
  hint.textContent='Click anywhere to skip'; document.querySelector('.splash-wrap').appendChild(hint);
  el('splash').addEventListener('click',()=>{ if(!splashReady)splashFinish(); });
}

loadSavedSettings();
splashTick();
buildPlayerTextures(); // must exist before initThree(), which builds the player sprite from it
splashTick();
initThree();          // sets up renderer/scene/camera/lights — must run before anything that touches them
splashTick();
buildEnemyTextures(); // sprite textures enemies need to actually appear in the scene
splashTick();
resize();
L=LEVELS[0];
applyTheme();
buildSettings();
buildMap(L.build);
P.x=MW/2+.5; P.y=MH/2+.5;
resetGuns();
updateHUD();
initLanding();
splashTick();
requestAnimationFrame(frame);
runSplash(); // 15-second loading splash, then a START button

/* ================= OPERATION BLACKOUT: ALL-FEATURES UPGRADE ================= */
(function(){
  'use strict';
  const LSX={
    get(k,d){try{const v=JSON.parse(localStorage.getItem(k));return v==null?d:v;}catch(_){return d;}},
    set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(_){}}
  };
  const todayKey=()=>new Date().toISOString().slice(0,10);
  const defaultStats={kills:0,headshots:0,bosses:0,shots:0,reloads:0,missions:0,documents:0,playSeconds:0,damageDealt:0};
  const stats=Object.assign(defaultStats,LSX.get('lsx_stats',{}));
  const saveStats=()=>LSX.set('lsx_stats',stats);
  let runStart=Date.now(), headshotStreak=0, lastKillTime=0, killCamTimer=null;
  const missionDefs=[
    {id:'kills',title:'Clear the Hostiles',desc:'Eliminate 20 enemies.',goal:20},
    {id:'headshots',title:'Precision Protocol',desc:'Score 5 precision/headshot kills.',goal:5},
    {id:'reloads',title:'Combat Ready',desc:'Reload your weapon 4 times.',goal:4},
    {id:'bosses',title:'Command Breaker',desc:'Defeat a boss-class enemy.',goal:1},
    {id:'intel',title:'Truth Seeker',desc:'Recover 1 intelligence file.',goal:1}
  ];
  function daily(){
    let d=LSX.get('lsx_daily',null);
    if(!d||d.date!==todayKey()){
      const picks=[...missionDefs].sort((a,b)=>((a.id.charCodeAt(0)*17+todayKey().charCodeAt(8))%13)-((b.id.charCodeAt(0)*17+todayKey().charCodeAt(8))%13)).slice(0,3);
      d={date:todayKey(),missions:picks.map(m=>({...m,progress:0,claimed:false}))}; LSX.set('lsx_daily',d);
    }
    return d;
  }
  function progressMission(id,amount=1){
    const d=daily(); let changed=false;
    d.missions.forEach(m=>{if(m.id===id&&!m.claimed&&m.progress<m.goal){m.progress=Math.min(m.goal,m.progress+amount);changed=true;if(m.progress>=m.goal){m.completed=true;try{toast('DAILY MISSION COMPLETE: '+m.title);}catch(_){}}}});
    if(changed)LSX.set('lsx_daily',d);
  }
  const intelFiles=[
    {id:'blackout',title:'BLACKOUT INCIDENT REPORT',type:'DOCUMENT',body:'At 02:14, the GRID network stopped responding. Emergency gates sealed automatically. The first hostile signal appeared inside a supposedly isolated control room.'},
    {id:'operator',title:'FIELD OPERATOR AUDIO LOG',type:'AUDIO LOG',body:'“Command, the units are not responding to the recall code. They are tracking movement and heat signatures. I am moving the survivors toward the relay.”'},
    {id:'grid',title:'GRID CORE DIAGNOSTIC',type:'TECHNICAL FILE',body:'The core received a command packet signed with a valid authority key. The evidence suggests the failure was triggered deliberately, not caused by a random power surge.'},
    {id:'warlord',title:'WARLORD COMMAND FRAGMENT',type:'ENEMY INTELLIGENCE',body:'Command units share a repeating signal. Warlord directs the frontline, Bulwark protects the signal, and Siegebreaker attacks fortified positions.'},
    {id:'survivors',title:'SURVIVOR TRANSMISSION',type:'AUDIO LOG',body:'“If anyone can hear this, the eastern shelters are still active. The security system is treating every movement as a threat. Please shut down the relay.”'}
  ];
  function intel(){return LSX.get('lsx_intel',[]);}
  function unlockIntel(id){
    const got=intel(); if(got.includes(id))return;
    got.push(id);LSX.set('lsx_intel',got);stats.documents++;saveStats();progressMission('intel');
    const f=intelFiles.find(x=>x.id===id); if(f)try{toast('INTEL RECOVERED: '+f.title);}catch(_){}
  }
  function styleBtn(b){b.style.cssText+=';cursor:pointer;touch-action:manipulation;';}
  function modal(id,title,subtitle,content,buttons=[]){
    const s=makeScreen(id,'');
    s.style.zIndex='10000';
    s.innerHTML=`<div class="panel lsx-panel"><div class="kicker">LAST SECTOR · OPERATION BLACKOUT</div><h1>${title}</h1><p class="sub">${subtitle||''}</p><div class="lsx-content">${content}</div><div class="pov-row lsx-actions"></div></div>`;
    const row=s.querySelector('.lsx-actions');
    buttons.forEach(x=>{const b=document.createElement('button');b.className='cta';b.textContent=x.label;styleBtn(b);if(x.ghost)b.style.cssText+=';background:transparent;border:1px solid rgba(255,255,255,.3);color:var(--bone)';b.addEventListener('click',()=>x.fn(s));row.appendChild(b);});
    return s;
  }
  function dailyPanel(){
    const d=daily(); const body=d.missions.map(m=>`<div class="lsx-card"><div class="lsx-row"><b>${m.title}</b><span>${m.progress}/${m.goal}</span></div><p>${m.desc}</p><div class="lsx-progress"><i style="width:${Math.min(100,m.progress/m.goal*100)}%"></i></div><small>${m.claimed?'REWARD CLAIMED':m.completed?'COMPLETE · REWARD +250 CREDITS':'IN PROGRESS'}</small>${m.completed&&!m.claimed?`<button class="cta lsx-claim" data-claim="${m.id}">Claim reward</button>`:''}</div>`).join('');
    const s=modal('lsxDaily','Daily Operations',`Refreshes each day · ${d.date}`,body,[{label:'Close',ghost:true,fn:x=>x.remove()}]);
    s.querySelectorAll('[data-claim]').forEach(b=>b.addEventListener('click',()=>{const dd=daily();const m=dd.missions.find(x=>x.id===b.dataset.claim);if(m&&!m.claimed&&m.completed){m.claimed=true;LSX.set('lsx_daily',dd);LSX.set('bp_credits',(LSX.get('bp_credits',0)+250));if(typeof credits!=='undefined'){credits+=250;if(typeof updateHUD==='function')updateHUD();}b.textContent='Claimed';b.disabled=true;try{toast('REWARD CLAIMED · +250 CREDITS');}catch(_){}}}));
  }
  function intelPanel(){
    const got=intel();
    const cards=intelFiles.map(f=>{const yes=got.includes(f.id);return `<div class="lsx-card"><div class="lsx-row"><b>${yes?f.title:'[CLASSIFIED FILE]'}</b><span>${yes?'UNLOCKED':'LOCKED'}</span></div><small>${f.type}</small><p>${yes?f.body:'Recover intelligence during operations to reveal this file.'}</p>${yes&&f.type.includes('AUDIO')?`<button class="cta" data-audio="${f.id}">Play signal</button>`:''}</div>`;}).join('');
    const s=modal('lsxIntel','Intelligence Vault',`${got.length}/${intelFiles.length} files recovered`,cards,[{label:'Close',ghost:true,fn:x=>x.remove()}]);
    s.querySelectorAll('[data-audio]').forEach(b=>b.addEventListener('click',()=>{try{Audio_.tone({freq:330,slide:620,dur:.25,vol:.18,type:'sine'});setTimeout(()=>Audio_.tone({freq:210,slide:130,dur:.32,vol:.12,type:'triangle'}),280);setTimeout(()=>Audio_.tone({freq:470,slide:390,dur:.18,vol:.12,type:'sine'}),640);}catch(_){}b.textContent='Signal played';}));
  }
  function profilePanel(){
    const p=LSX.get('lsx_profile',{callsign:'PHANTOM',outfit:'Recon',color:'#7fc2a0',weaponSkin:'Standard'});
    const s=modal('lsxProfile','Operator Identity','Customize your callsign, uniform theme, and weapon finish. Cosmetic choices save on this device.',`
      <label class="lsx-label">CALLSIGN<input id="lsxCallsign" maxlength="18" value="${String(p.callsign).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></label>
      <label class="lsx-label">UNIFORM<select id="lsxOutfit">${['Recon','Urban','Hazmat','Night Ops','Desert'].map(x=>`<option ${p.outfit===x?'selected':''}>${x}</option>`).join('')}</select></label>
      <label class="lsx-label">UNIFORM SIGNAL COLOR<input id="lsxColor" type="color" value="${p.color}"></label>
      <label class="lsx-label">WEAPON FINISH<select id="lsxSkin">${['Standard','Carbon','Arctic','Hazard','Neon'].map(x=>`<option ${p.weaponSkin===x?'selected':''}>${x}</option>`).join('')}</select></label>
      <div class="lsx-card"><b>OPERATOR PREVIEW</b><p id="lsxPreview" style="color:${p.color}">${p.callsign} · ${p.outfit} · ${p.weaponSkin}</p></div>`,[
      {label:'Save identity',fn:x=>{const v={callsign:x.querySelector('#lsxCallsign').value.trim()||'OPERATOR',outfit:x.querySelector('#lsxOutfit').value,color:x.querySelector('#lsxColor').value,weaponSkin:x.querySelector('#lsxSkin').value};LSX.set('lsx_profile',v);x.remove();try{toast('OPERATOR IDENTITY SAVED');}catch(_){}}},
      {label:'Close',ghost:true,fn:x=>x.remove()}]);
    const refresh=()=>{const pr=s.querySelector('#lsxPreview');pr.textContent=`${s.querySelector('#lsxCallsign').value||'OPERATOR'} · ${s.querySelector('#lsxOutfit').value} · ${s.querySelector('#lsxSkin').value}`;pr.style.color=s.querySelector('#lsxColor').value;};
    ['#lsxCallsign','#lsxOutfit','#lsxSkin','#lsxColor'].forEach(sel=>s.querySelector(sel).addEventListener('input',refresh));
  }
  function statsPanel(){
    const hours=Math.floor(stats.playSeconds/3600), mins=Math.floor(stats.playSeconds%3600/60);
    const body=`<div class="lsx-stats">${[['TOTAL KILLS',stats.kills],['PRECISION KILLS',stats.headshots],['BOSSES DEFEATED',stats.bosses],['SHOTS FIRED',stats.shots],['RELOADS',stats.reloads],['INTEL FILES',intel().length],['MISSIONS CLEARED',stats.missions],['PLAYTIME',hours+'h '+mins+'m']].map(([a,b])=>`<div class="lsx-card"><small>${a}</small><strong>${Number(b).toLocaleString()}</strong></div>`).join('')}</div><div class="lsx-card"><b>CAREER SUMMARY</b><p>These are locally saved statistics for this browser. Clearing browser storage or switching devices may reset or separate these records.</p></div>`;
    modal('lsxStats','Operator Service Record','Career history · local profile database',body,[{label:'Close',ghost:true,fn:x=>x.remove()}]);
  }
  function interactPanel(){
    const body=`<div class="lsx-card"><b>SECURITY TERMINAL</b><p>Access door controls, disable the alarm, or request a local tactical scan.</p><button class="cta" id="lsxDisableAlarm">Disable alarm</button> <button class="cta" id="lsxScan">Tactical scan</button></div><div class="lsx-card"><b>FIELD CACHE</b><p>Use a supply cache to restore a small amount of health and armor. Once per operation.</p><button class="cta" id="lsxCache">Open supply cache</button></div>`;
    const s=modal('lsxInteract','Field Terminal','Interact with nearby sector equipment',body,[{label:'Close',ghost:true,fn:x=>x.remove()}]);
    s.querySelector('#lsxDisableAlarm').onclick=()=>{if(typeof toSpawn!=='undefined'&&running){for(let i=0;i<3;i++)toSpawn.push(i===0?'elite':i===1?'stealth':'grunt');toast('ALARM DISABLED · REINFORCEMENTS DIVERTED');}else toast('ALARM STATUS: STANDBY');};
    s.querySelector('#lsxScan').onclick=()=>{const alive=(typeof enemies!=='undefined'?enemies.filter(e=>!e.dead).length:0);toast('TACTICAL SCAN · '+alive+' HOSTILES DETECTED');};
    s.querySelector('#lsxCache').onclick=()=>{if(LSX.get('lsx_cacheUsed',false)){toast('CACHE ALREADY USED THIS OPERATION');return;}LSX.set('lsx_cacheUsed',true);if(typeof P!=='undefined'){P.health=Math.min(P.maxHealth,P.health+25);P.armor=Math.min(typeof armorMax==='function'?armorMax():50,(P.armor||0)+15);if(typeof updateHUD==='function')updateHUD();}toast('SUPPLY CACHE OPENED · +HEALTH / +ARMOR');};
  }
  function featureHub(){
    const p=LSX.get('lsx_profile',{callsign:'PHANTOM',outfit:'Recon',weaponSkin:'Standard'});
    const body=`<div class="lsx-card"><b>OPERATION BLACKOUT</b><p>Expanded combat, operator customization, daily missions, intelligence files, story endings, and career records.</p><div class="lsx-row"><span>CALLSIGN</span><strong>${p.callsign}</strong></div></div><div class="lsx-hubgrid"><button class="cta" data-open="daily">Daily Missions</button><button class="cta" data-open="intel">Intel / Audio Logs</button><button class="cta" data-open="profile">Operator Customization</button><button class="cta" data-open="stats">Career Statistics</button><button class="cta" data-open="interact">Field Terminal</button><button class="cta" data-open="archive">Sector Archive</button></div><div class="lsx-card"><b>NEW COMBAT SYSTEMS</b><p>Precision/headshot tracking, hit feedback, reload-state animation, armor support, elite and stealth enemies, alarm reinforcements, mini-boss encounters, and boss kill-cam effects are enabled where the original engine supports them.</p></div>`;
    const s=modal('lsxHub','Blackout Command Hub','All new systems in one place',body,[{label:'Close',ghost:true,fn:x=>x.remove()}]);
    s.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>{s.remove();({daily:dailyPanel,intel:intelPanel,profile:profilePanel,stats:statsPanel,interact:interactPanel,archive:openSectorArchive})[b.dataset.open]();}));
  }
  function showEndingChoices(){
    const saved=LSX.get('lsx_endings',[]);
    const body=`<div class="lsx-card"><b>FINAL DECISION</b><p>The GRID core is unstable. Your last command determines what survives beyond the Last Sector.</p></div><div class="lsx-card"><b>ENDING A · LAST LIGHT</b><p>Evacuate survivors and destroy the weapons relay.</p><button class="cta" data-ending="Last Light">Choose Last Light</button></div><div class="lsx-card"><b>ENDING B · TOTAL COLLAPSE</b><p>Destroy the GRID core so it can never be used again.</p><button class="cta" data-ending="Total Collapse">Choose Total Collapse</button></div><div class="lsx-card"><b>ENDING C · NEW DAWN</b><p>Restore the core in a controlled state and transmit the evidence to the survivors.</p><button class="cta" data-ending="New Dawn">Choose New Dawn</button></div><p class="hint">Previously recorded endings: ${saved.length?saved.join(' · '):'None yet'}</p>`;
    const s=modal('lsxEnding','The Last Decision','Story ending selection · fictional campaign lore',body,[{label:'Decide later',ghost:true,fn:x=>x.remove()}]);
    s.querySelectorAll('[data-ending]').forEach(b=>b.addEventListener('click',()=>{const end=b.dataset.ending,arr=LSX.get('lsx_endings',[]);if(!arr.includes(end))arr.push(end);LSX.set('lsx_endings',arr);LSX.set('lsx_lastEnding',{ending:end,date:Date.now(),score:typeof score!=='undefined'?score:0});unlockIntel('grid');s.remove();modal('lsxEndingResult',end.toUpperCase(),'ENDING RECORDED',`<div class="lsx-card"><b>${end}</b><p>${end==='Last Light'?'Survivors escape while the hostile relay is destroyed. The truth survives with them.':end==='Total Collapse'?'The GRID core is destroyed. The network can never threaten the region again, but its remaining records are lost.':'The GRID core is isolated and restored. Survivors receive the evidence and begin rebuilding.'}</p></div><p class="hint">You can replay the campaign to unlock the other endings.</p>`,[{label:'Return to game results',fn:x=>x.remove()}]);}));
  }
  function ensureDock(){
    if(document.getElementById('lsxDock'))return;
    const dock=document.createElement('div');dock.id='lsxDock';dock.innerHTML='<button type="button" id="lsxHubBtn">BLACKOUT HUB</button><button type="button" id="lsxDailyBtn">DAILY OPS</button><button type="button" id="lsxIntelBtn">INTEL</button>';
    document.body.appendChild(dock);
    dock.querySelector('#lsxHubBtn').onclick=featureHub;dock.querySelector('#lsxDailyBtn').onclick=dailyPanel;dock.querySelector('#lsxIntelBtn').onclick=intelPanel;
    const sync=()=>{dock.classList.toggle('playing',!!(typeof running!=='undefined'&&running));};setInterval(sync,500);
  }
  // Additional enemy classes use the original engine's common enemy configuration.
  if(typeof TYPES!=='undefined'){
    TYPES.elite={hp:175,speed:1.9,radius:.43,scale:1.08,dmg:13,fireGap:.78,acc:.78,label:'ELITE TROOPER',range:14,base:'heavy',tint:[1.35,1.05,.45]};
    TYPES.stealth={hp:88,speed:2.25,radius:.37,scale:.96,dmg:10,fireGap:.95,acc:.58,label:'SHADE',range:11,base:'runner',tint:[.65,.75,1.35]};
    TYPES.miniBoss={hp:620,speed:1.12,radius:.66,scale:1.5,dmg:16,fireGap:.8,acc:.75,label:'BREACHER',range:13,base:'heavy',tint:[1.55,.65,.45],boss:true};
  }
  if(typeof killEnemy==='function'){
    const oldKill=killEnemy;
    killEnemy=function(e){
      if(!e||e.dead)return;
      const wasBoss=!!(e.boss||['boss','bossShield','bossArtillery','miniBoss'].includes(e.type));
      const wasCrit=(typeof dmgSrcCause!=='undefined'&&dmgSrcCause==='crit');
      oldKill(e);
      if(e.dummy)return;
      stats.kills++;if(wasCrit){stats.headshots++;progressMission('headshots');headshotStreak++;}else headshotStreak=0;
      if(wasBoss){stats.bosses++;unlockIntel('warlord');showBossKillCam(e.label||'COMMAND UNIT');}
      progressMission('kills');saveStats();
      if(Math.random()<.055){const got=intel();const remaining=intelFiles.filter(f=>!got.includes(f.id));if(remaining.length)unlockIntel(remaining[Math.floor(Math.random()*remaining.length)].id);}
      const now=Date.now();if(now-lastKillTime<2800&&headshotStreak>=3){try{toast('PRECISION STREAK ×'+headshotStreak);}catch(_){}}lastKillTime=now;
    };
  }
  function showBossKillCam(label){
    const el=document.createElement('div');el.className='lsx-killcam';el.innerHTML=`<div class="lsx-killcam-kicker">TARGET NEUTRALIZED</div><strong>${String(label).replace(/[<>]/g,'')}</strong><span>OPERATION BLACKOUT · AFTER-ACTION REPLAY</span>`;document.body.appendChild(el);
    clearTimeout(killCamTimer);killCamTimer=setTimeout(()=>el.remove(),2100);
  }
  if(typeof fire==='function'){
    const oldFire=fire;
    fire=function(){const g=typeof guns!=='undefined'?guns[curGun]:null;const before=g?g.ammo:0;oldFire();if(g&&g.ammo<before){stats.shots++;saveStats();}};
  }
  if(typeof startReload==='function'){
    const oldReload=startReload;
    startReload=function(){const was=typeof reloading!=='undefined'?reloading:0;oldReload();if(!was&&typeof reloading!=='undefined'&&reloading>0){stats.reloads++;progressMission('reloads');saveStats();}};
  }
  if(typeof startWave==='function'){
    const oldWave=startWave;
    startWave=function(){oldWave();if(typeof toSpawn!=='undefined'&&toSpawn.length){
      const d=typeof difficulty==='function'?difficulty():1;
      if(d>=2&&wave%2===0)toSpawn.splice(Math.min(2,toSpawn.length),0,'elite');
      if(d>=3&&wave%3===0)toSpawn.splice(Math.min(3,toSpawn.length),0,'stealth');
      if(wave%5===0&&wave>0&&Math.random()<.7)toSpawn.splice(Math.min(1,toSpawn.length),0,'miniBoss');
      if(wave%4===0&&wave>0)try{banner('HOSTILE REINFORCEMENTS','ELITE SIGNATURE DETECTED');}catch(_){}
    }};
  }
  if(typeof levelClear==='function'){
    const oldClear=levelClear;
    levelClear=function(){const finalCampaign=(typeof mode!=='undefined'&&mode==='campaign'&&typeof levelIndex!=='undefined'&&levelIndex>=LEVELS.length-1&&!dailyRun&&!trainingOn&&!customOn);oldClear();if(finalCampaign){stats.missions++;stats.playSeconds+=Math.max(0,Math.round((Date.now()-runStart)/1000));saveStats();unlockIntel('survivors');setTimeout(showEndingChoices,1350);}else if(typeof mode!=='undefined'&&mode==='campaign'&&typeof levelIndex!=='undefined'){stats.missions++;saveStats();if(levelIndex===1)unlockIntel('blackout');if(levelIndex===2)unlockIntel('operator');}};
  }
  if(typeof die==='function'){
    const oldDie=die;
    die=function(){try{stats.playSeconds+=Math.max(0,Math.round((Date.now()-runStart)/1000));saveStats();}catch(_){}oldDie();};
  }
  // Clear one-operation supply cache flag whenever a fresh operation begins.
  if(typeof beginRun==='function'){
    const oldBegin=beginRun;
    beginRun=function(){runStart=Date.now();LSX.set('lsx_cacheUsed',false);headshotStreak=0;oldBegin.apply(this,arguments);};
  }
  // Feature buttons are inserted into the existing operation menu as well as the landing page dock.
  function installMenuButtons(){
    const actions=document.querySelector('.menu-actions');if(!actions)return;
    const defs=[['lsxMenuHub','Operation Blackout Hub',featureHub],['lsxMenuDaily','Daily Missions',dailyPanel],['lsxMenuProfile','Operator Customization',profilePanel],['lsxMenuIntel','Intelligence Vault',intelPanel],['lsxMenuStats','Career Statistics',statsPanel]];
    defs.forEach(([id,label,fn])=>{if(actions.querySelector('#'+id))return;const b=document.createElement('button');b.id=id;b.className='cta';b.textContent=label;b.style.cssText='background:transparent;border:1px solid rgba(255,255,255,.3);color:var(--bone)';b.addEventListener('click',fn);actions.appendChild(b);});
  }
  const observer=new MutationObserver(()=>{installMenuButtons();ensureDock();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  installMenuButtons();ensureDock();
  // Persistent archive upgrades: career stats and collected intel are shown alongside existing lore.
  const oldArchive=typeof openSectorArchive==='function'?openSectorArchive:null;
  if(oldArchive){
    openSectorArchive=function(){oldArchive();const s=document.getElementById('archiveScreen');if(!s)return;const p=s.querySelector('.panel');if(!p||p.querySelector('#lsxArchiveExtras'))return;
      const got=intel(),last=LSX.get('lsx_lastEnding',null),ends=LSX.get('lsx_endings',[]);
      const extra=document.createElement('div');extra.id='lsxArchiveExtras';extra.innerHTML=`<h2 style="font-family:var(--hud-font);letter-spacing:.12em;margin-top:22px">OPERATION BLACKOUT EXPANSION</h2><div class="lsx-card"><b>CAREER SERVICE RECORD</b><p>${stats.kills} kills · ${stats.headshots} precision kills · ${stats.bosses} bosses · ${stats.missions} missions cleared · ${got.length}/${intelFiles.length} intelligence files.</p></div><div class="lsx-card"><b>STORY ENDINGS</b><p>${ends.length?ends.join(' · '):'No ending recorded yet.'}</p>${last?`<small>Last ending: ${last.ending} · ${new Date(last.date).toLocaleString()}</small>`:''}</div><button class="cta" id="lsxArchiveIntel">Open Intelligence Vault</button>`;
      p.appendChild(extra);extra.querySelector('#lsxArchiveIntel').onclick=()=>{s.remove();intelPanel();};
    };
  }
  // Make archive/menu controls available from the existing menu every time it opens.
  setInterval(installMenuButtons,900);
})();


/* OPERATION BLACKOUT: EXTREME EXPANSION PACK */
(()=>{
'use strict';
const KEY='lsx_extreme_v1';
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{credits:0,xp:0,level:1,skills:[],upgrades:{},attachments:{},mastery:{},logins:{},rankings:[],endingChoices:[]}}catch(e){return {credits:0,xp:0,level:1,skills:[],upgrades:{},attachments:{},mastery:{},logins:{},rankings:[],endingChoices:[]}}};
let data=read();
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){}};
const $=id=>document.getElementById(id);
const safe=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast2(s){try{if(typeof toast==='function')toast(s);else console.info(s)}catch(e){}}
function getCredits(){return typeof window.credits==='number'?window.credits:(typeof credits==='number'?credits:0)}
function addCredits(n){try{if(typeof window.credits==='number')window.credits+=n;else if(typeof credits!=='undefined')credits+=n}catch(e){} data.credits+=n;save();try{if(typeof updateHUD==='function')updateHUD()}catch(e){}}
function panel(id,title,body){let old=$(id);if(old)old.remove();const s=document.createElement('div');s.className='screen on lsx-extra-screen';s.id=id;s.innerHTML=`<div class="panel lsx-extra-panel"><div class="kicker">LAST SECTOR · EXTREME EXPANSION</div><h1>${title}</h1><div class="lsx-extra-body">${body}</div><button class="cta lsx-extra-close">Close</button></div>`;document.body.appendChild(s);s.querySelector('.lsx-extra-close').onclick=()=>s.remove();return s}
function btn(label,fn,disabled=false){return `<button class="cta lsx-extra-btn" data-action="${safe(label)}" ${disabled?'disabled':''}>${label}</button>`}
function addRow(title,desc,cost,action,disabled=false){return `<div class="lsx-extra-row"><div><b>${title}</b><small>${desc}</small></div><button class="cta" data-buy="${action}" ${disabled?'disabled':''}>${cost}</button></div>`}
const UPGRADE_DEFS=[['damage','Weapon damage','Increase weapon damage by 8% per rank',450],['mag','Magazine capacity','Increase magazine size by 10% per rank',350],['reload','Reload training','Reload 8% faster per rank',300],['reserve','Ammo logistics','Start with 15% more reserve ammo per rank',300],['health','Combat conditioning','Increase maximum health by 10 per rank',400],['armor','Armor plating','Start each operation with extra armor',450],['loot','Quartermaster','Increase chance of supply drops',500]];
const SKILLS=[['quickhands','Quick Hands','Reloads are faster.','reload'],['vitality','Vitality','Increase maximum health.','health'],['scavenger','Scavenger','More frequent supply drops.','loot'],['marksman','Marksman','Precision shots gain bonus damage.','precision'],['marathon','Marathon','Move faster.','speed'],['fieldmedic','Field Medic','Start missions with extra health.','heal']];
function levelXP(){return 250+(data.level-1)*150}
function gainXP(n){data.xp+=n;let leveled=false;while(data.xp>=levelXP()){data.xp-=levelXP();data.level++;data.credits+=150;leveled=true;}save();if(leveled)toast2('OPERATOR LEVEL '+data.level+' · +150 CAREER CREDITS');}
function armory(){const body=`<p>Career level <b>${data.level}</b> · XP <b>${data.xp}/${levelXP()}</b> · Expansion credits <b>${data.credits}</b></p><h2>WEAPON / OPERATOR UPGRADES</h2>${UPGRADE_DEFS.map(([k,n,d,c])=>{const rank=data.upgrades[k]||0;return addRow(n,d+' · Rank '+rank+'/5',rank>=5?'MAX':c+' CR',k,rank>=5||data.credits<c)}).join('')}<h2>WEAPON ATTACHMENTS</h2>${[['optic','Optic','Tighter aiming spread',250],['silencer','Suppressor','Reduces alert pressure in stealth objectives',300],['extended','Extended magazine','Extra magazine capacity',350],['grip','Stability grip','Less spread while firing',250]].map(([k,n,d,c])=>addRow(n,d,data.attachments[k]?'EQUIPPED':c+' CR','att:'+k,!!data.attachments[k]||data.credits<c)).join('')}<p class="lsx-extra-note">Upgrades are saved in this browser. Attachments are simplified gameplay modifiers, not visible 3D weapon models.</p>`;const s=panel('lsxArmoryExtra','Armory & Field Engineering',body);s.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{const k=b.dataset.buy;if(k.startsWith('att:')){const a=k.slice(4),cost={optic:250,silencer:300,extended:350,grip:250}[a];if(data.credits<cost)return;data.credits-=cost;data.attachments[a]=true;}else{const u=UPGRADE_DEFS.find(x=>x[0]===k);if(!u||data.credits<u[3]||(data.upgrades[k]||0)>=5)return;data.credits-=u[3];data.upgrades[k]=(data.upgrades[k]||0)+1;}save();armory();toast2('UPGRADE INSTALLED');});}
function skillsPanel(){const body=`<p>Spend skill points earned from operator levels. Current level: <b>${data.level}</b>. Each skill can be unlocked once.</p>${SKILLS.map(([k,n,d])=>addRow(n,d,data.skills.includes(k)?'UNLOCKED':'1 SKILL POINT',k,data.skills.includes(k)||data.level<=data.skills.length)).join('')}<p class="lsx-extra-note">Skill points available: ${Math.max(0,data.level-1-data.skills.length)}.</p>`;const s=panel('lsxSkillsExtra','Operator Skill Tree',body);s.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{const k=b.dataset.buy;if(data.skills.includes(k)||data.level-1<=data.skills.length)return;data.skills.push(k);save();skillsPanel();toast2('SKILL UNLOCKED · '+k.toUpperCase());});}
function leaderboard(){const rows=[...(data.rankings||[])].sort((a,b)=>b.score-a.score).slice(0,10);return panel('lsxLeaderboardExtra','Local High Scores',`<p>This leaderboard is saved on this device only. An online global leaderboard needs a server/database.</p><table class="lsx-score-table"><thead><tr><th>Rank</th><th>Mission</th><th>Score</th><th>Rating</th></tr></thead><tbody>${rows.length?rows.map((r,i)=>`<tr><td>${i+1}</td><td>${safe(r.mission)}</td><td>${Number(r.score).toLocaleString()}</td><td>${r.rank}</td></tr>`).join(''):'<tr><td colspan="4">No mission results saved yet.</td></tr>'}</tbody></table>`)}
function missionTools(){const body=`<div class="lsx-extra-grid">${[['map','TACTICAL MAP','Show your position and mission notes'],['stealth','STEALTH PROTOCOL','Attempt a quiet-operation bonus'],['hostage','RESCUE SURVIVORS','Complete a rescue side objective'],['doors','ACCESS CONTROL','Search for a keycard / locked access point'],['secret','HIDDEN CACHE','Search for a secret supply cache'],['dialogue','FIELD COMMS','Read a short mission transmission'],['story','STORY DECISION','Choose a campaign direction'],['rank','AFTER ACTION','View current run performance']].map(([k,n,d])=>`<button class="lsx-feature-tile" data-tool="${k}"><b>${n}</b><small>${d}</small></button>`).join('')}</div><p class="lsx-extra-note">Side objectives are lightweight browser-game events tied to mission rewards; they do not add fully modeled hostage or door assets to the 3D map.</p>`;const s=panel('lsxMissionTools','Mission Support Terminal',body);s.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>toolAction(b.dataset.tool));}
let stealthAttempt=false,sideObjectives={rescue:false,access:false,cache:false},missionStart=Date.now(),missionShots=0,missionKills=0,missionHeadshots=0;
function toolAction(k){if(k==='map'){const pos=(typeof P!=='undefined')?`X ${P.x.toFixed(1)} · Y ${P.y.toFixed(1)}`:'Position unavailable';panel('lsxMapExtra','Tactical Map',`<p><b>PLAYER POSITION</b><br>${pos}</p><p><b>OBJECTIVE</b><br>${typeof L!=='undefined'?safe(L.name):'Current operation'}</p><p>Enemy contacts: ${typeof enemies!=='undefined'?enemies.filter(e=>!e.dead).length:'—'} · Wave: ${typeof wave!=='undefined'?wave:'—'}</p><p>Map markers are tactical readouts; full minimap rendering remains part of the original game.</p>`)}
else if(k==='stealth'){stealthAttempt=true;toast2('STEALTH PROTOCOL ACTIVE · Avoid detection for bonus credits');panel('lsxStealthExtra','Stealth Protocol',`<p>Stealth bonus is active for this operation. If you finish the mission, you will receive an additional reward. Combat may still trigger normal enemy behavior.</p>`)}
else if(k==='hostage'||k==='doors'||k==='secret'){const obj=k==='hostage'?'rescue':k==='doors'?'access':'cache';if(sideObjectives[obj]){toast2('SIDE OBJECTIVE ALREADY COMPLETED');return;}sideObjectives[obj]=true;const reward=k==='hostage'?180:k==='doors'?120:220;addCredits(reward);gainXP(75);toast2((k==='hostage'?'SURVIVOR RESCUED':k==='doors'?'ACCESS OVERRIDE COMPLETE':'SECRET CACHE FOUND')+' · +'+reward+' CR');panel('lsxSideObjExtra','Side Objective Complete',`<p>${k==='hostage'?'Survivors were escorted to a safe zone.':k==='doors'?'A security access point was overridden.':'A hidden field cache was recovered.'}</p><p>Reward: <b>${reward} credits</b> and 75 XP.</p><p>Note: this is a mission-event simulation, not a physical 3D NPC/door interaction.</p>`)}
else if(k==='dialogue')panel('lsxDialogueExtra','Incoming Field Transmission',`<p><b>COMMAND:</b> “Operator, GRID communications are unstable. Secure the area, recover any intelligence, and do not let the Blackout protocol spread.”</p><p><b>OPERATOR:</b> “Copy. Moving to the objective.”</p>`)
else if(k==='story'){const s=panel('lsxStoryExtra','Choose Your Operation',`<p>Your decision will be recorded in this browser and influence the ending card shown after the campaign.</p><div class="lsx-extra-grid"><button class="lsx-feature-tile" data-ending="Last Light"><b>LAST LIGHT</b><small>Protect the survivors.</small></button><button class="lsx-feature-tile" data-ending="Total Collapse"><b>TOTAL COLLAPSE</b><small>Destroy the GRID core.</small></button><button class="lsx-feature-tile" data-ending="New Dawn"><b>NEW DAWN</b><small>Attempt to restore the system.</small></button></div>`);s.querySelectorAll('[data-ending]').forEach(b=>b.onclick=()=>{data.endingChoices.push({ending:b.dataset.ending,date:Date.now()});save();s.remove();toast2('STORY PATH RECORDED · '+b.dataset.ending.toUpperCase());});}
else if(k==='rank')afterAction(true);}
function afterAction(preview=false){const acc=missionShots?Math.round((missionHeadshots/missionShots)*100):0;panel('lsxAARExtra','After Action Report',`<p>Kills: <b>${missionKills}</b> · Precision kills: <b>${missionHeadshots}</b> · Shots fired: <b>${missionShots}</b></p><p>Precision ratio: <b>${acc}%</b> · Elapsed: <b>${Math.round((Date.now()-missionStart)/1000)} seconds</b></p><p>Mission rating is calculated at completion using kills, accuracy, and survival.</p>`)}
function dailyLogin(){const day=new Date().toISOString().slice(0,10);if(data.logins.last!==day){data.logins.last=day;data.logins.streak=(data.logins.streak||0)+1;data.credits+=100+Math.min(200,(data.logins.streak-1)*25);save();setTimeout(()=>toast2('DAILY LOGIN · +'+(100+Math.min(200,(data.logins.streak-1)*25))+' CAREER CREDITS'),1700)}}
function rankFor(){const acc=missionShots?missionHeadshots/missionShots:0;const score=(missionKills*10)+(acc*300)+(typeof P!=='undefined'&&P.alive?250:0);return score>1000?'S':score>700?'A':score>400?'B':score>200?'C':'D'}
function saveRank(){const rank=rankFor();data.rankings.push({mission:typeof L!=='undefined'?L.name:'Operation',score:typeof score!=='undefined'?score:0,rank,date:Date.now()});if(data.rankings.length>50)data.rankings.shift();gainXP(Math.max(50,missionKills*12));save();toast2('MISSION RATING: '+rank+' · CAREER XP AWARDED');}
// Daily reward; stored separately from the original in-run credits.
dailyLogin();
// Wrap weapon reset so browser-saved upgrades are applied whenever a run starts.
if(typeof resetGuns==='function'){const oldReset=resetGuns;resetGuns=function(){oldReset();try{guns.forEach(g=>{const u=data.upgrades;g.dmg*=1+(u.damage||0)*.08;g.mag=Math.round(g.mag*(1+(u.mag||0)*.1));g.ammo=Math.min(g.mag,g.ammo);g.reload*=Math.max(.55,1-(u.reload||0)*.08+(data.skills.includes('quickhands')?-.12:0));g.res=Math.round(g.res*(1+(u.reserve||0)*.15));if(data.attachments.extended){g.mag=Math.round(g.mag*1.15);g.ammo=g.mag;}if(data.attachments.grip)g.spread*=.78;if(data.attachments.optic)g.adsSpread*=.65;});if(typeof P!=='undefined'){P.maxHealth+= (data.upgrades.health||0)*10+(data.skills.includes('vitality')?20:0);P.health=Math.min(P.maxHealth,P.health+ (data.skills.includes('fieldmedic')?25:0));P.speed*=data.skills.includes('marathon')?1.08:1;P.armor=(P.armor||0)+(data.upgrades.armor||0)*8;}}catch(e){console.warn('Expansion upgrades skipped',e)}}}
// Track kills and shot/precision stats while preserving the original combat code.
if(typeof fire==='function'){const oldFire=fire;fire=function(){const g=typeof guns!=='undefined'?guns[curGun]:null;const before=g?g.ammo:0;const k0=typeof kills!=='undefined'?kills:0;oldFire();if(g&&g.ammo<before){missionShots++;}if(typeof kills!=='undefined'&&kills>k0){missionKills+=kills-k0;}if(data.skills.includes('marksman')&&typeof dmgMul!=='undefined'){/* precision damage is already handled by the original critical-hit logic */}}}
if(typeof killEnemy==='function'){const oldKill=killEnemy;killEnemy=function(e){const before=typeof kills!=='undefined'?kills:0;const crit=typeof dmgSrcCause!=='undefined'&&dmgSrcCause==='crit';oldKill(e);if(typeof kills!=='undefined'&&kills>before&&!e?.dummy){gainXP(e?.boss?80:12);data.mastery[e?.type||'enemy']=(data.mastery[e?.type||'enemy']||0)+1;if(crit)missionHeadshots++;save();}}}
// Loot chance boost. Existing boss/normal loot logic is preserved.
if(typeof dropLoot==='function'){const oldDrop=dropLoot;dropLoot=function(e){oldDrop(e);if(!e?.boss&&!trainingOn&&Math.random()<Math.min(.35,.06+(data.upgrades.loot||0)*.035+(data.skills.includes('scavenger')?.07:0))){const type=['hp','armor','ammo','nade'][Math.floor(Math.random()*4)];try{spawnPickup(type,e.x+.35,e.y+.35)}catch(_){} }}}
// Add additional smart enemy types, plus sniper and medic behavior already present in the base game.
try{if(typeof TYPES!=='undefined'){TYPES.sniperElite={hp:105,speed:1.05,radius:.4,scale:1.05,dmg:27,fireGap:2.2,acc:.94,label:'ELITE SNIPER',range:28,base:'sniper',tint:[1.35,.55,.55]};TYPES.fieldMedic={hp:100,speed:1.55,radius:.42,scale:1,dmg:5,fireGap:1.8,acc:.5,label:'FIELD MEDIC',range:10,base:'medic',tint:[.4,1.5,.7]};}}catch(e){}
if(typeof startWave==='function'){const oldWave=startWave;startWave=function(){oldWave();try{if(typeof toSpawn!=='undefined'&&toSpawn.length){const d=typeof difficulty==='function'?difficulty():1;if(d>=2&&wave%2===0)toSpawn.splice(0,0,'sniperElite');if(d>=3&&wave%3===0)toSpawn.splice(0,0,'fieldMedic');if(data.level>=4&&wave%4===0)toSpawn.splice(0,0,'elite');}}catch(e){}}}
// Mission start: intro, login-safe reset, and day/night ambience layer.
if(typeof beginOperation==='function'){const oldBegin=beginOperation;beginOperation=function(){missionStart=Date.now();missionShots=missionKills=missionHeadshots=0;stealthAttempt=false;sideObjectives={rescue:false,access:false,cache:false};oldBegin();setTimeout(()=>{try{if(typeof L!=='undefined')banner('MISSION BRIEFING',L.name+' · '+L.where);}catch(e){}},700)}}
// Rank and store the result when a campaign mission ends.
if(typeof levelClear==='function'){const oldClear=levelClear;levelClear=function(){saveRank();oldClear();}}
if(typeof die==='function'){const oldDie=die;die=function(){try{saveRank()}catch(e){}oldDie();}}
// Final boss phases: make boss enemies more aggressive as their health drops.
if(typeof updateEnemies==='function'){const oldUpdate=updateEnemies;updateEnemies=function(dt){oldUpdate(dt);try{for(const e of enemies){if(e.dead||!e.boss||!e.maxHp)continue;const pct=e.hp/e.maxHp;if(pct<.66&&!e.lsxPhase2){e.lsxPhase2=true;e.speed*=1.18;e.fireGap=Math.max(.28,e.fireGap*.8);toast2('BOSS PHASE 2 · TARGET ENRAGED')}if(pct<.33&&!e.lsxPhase3){e.lsxPhase3=true;e.speed*=1.2;e.dmg*=1.2;toast2('BOSS FINAL PHASE · CRITICAL THREAT')}}}catch(e){}}}
// A day/night cycle is shown as a subtle color treatment without modifying the 3D scene.
function ensureAmbience(){if(!$('lsxAmbience')){const d=document.createElement('div');d.id='lsxAmbience';document.body.appendChild(d)}const h=new Date().getHours();$('lsxAmbience').dataset.phase=(h>=6&&h<17)?'day':(h>=17&&h<20)?'dusk':'night';}
setInterval(ensureAmbience,15000);ensureAmbience();
// Add an expandable terminal button in the original menu and a compact dock while playing.
function inject(){const host=document.querySelector('.menu-actions');if(host&&!$('lsxExtremeTerminalBtn')){const b=document.createElement('button');b.id='lsxExtremeTerminalBtn';b.className='cta';b.textContent='EXTREME EXPANSION TERMINAL';b.style.cssText='background:transparent;border:1px solid #f2a341;color:#f2a341';b.onclick=missionTools;host.appendChild(b)}if(!$('lsxExtremeDock')){const d=document.createElement('div');d.id='lsxExtremeDock';d.innerHTML='<button data-x="armory">ARMORY</button><button data-x="skills">SKILLS</button><button data-x="terminal">TERMINAL</button><button data-x="scores">SCORES</button>';document.body.appendChild(d);d.querySelector('[data-x="armory"]').onclick=armory;d.querySelector('[data-x="skills"]').onclick=skillsPanel;d.querySelector('[data-x="terminal"]').onclick=missionTools;d.querySelector('[data-x="scores"]').onclick=leaderboard;}}
const mo=new MutationObserver(inject);mo.observe(document.documentElement,{childList:true,subtree:true});inject();
// E opens the field terminal when not typing in a form; M opens the local tactical map.
addEventListener('keydown',e=>{if(e.repeat||e.target?.matches('input,textarea,select'))return;if(e.code==='KeyE'&&typeof running!=='undefined'&&running){e.preventDefault();missionTools()}if(e.code==='KeyM'&&typeof running!=='undefined'&&running){e.preventDefault();toolAction('map')}});
// Add in-game help and progression to existing screens.
try{const help=document.createElement('div');help.id='lsxExpansionHelp';help.textContent='EXTREME PACK: E Terminal · M Map · Armory / Skills / Scores buttons';document.body.appendChild(help)}catch(e){}
save();
})();


/* Small integration pass: adaptive challenge, stealth bonus and mastery rewards. */
(()=>{
  const adaptiveStart=Date.now();
  if(typeof startWave==='function'){
    const prior=startWave;
    startWave=function(){
      prior();
      try{
        const elapsed=Math.max(1,(Date.now()-missionStart)/60000);
        const pace=missionKills/elapsed;
        if(typeof toSpawn!=='undefined'&&toSpawn.length&&pace>7&&wave>=2){
          toSpawn.splice(0,0,pace>12?'elite':'runner');
          if(pace>12&&wave%2===0)toSpawn.splice(0,0,'sniperElite');
          if(typeof banner==='function')banner('ADAPTIVE THREAT RESPONSE','HOSTILES ADAPTING TO OPERATOR PERFORMANCE');
        }
      }catch(e){}
    };
  }
  if(typeof levelClear==='function'){
    const prior=levelClear;
    levelClear=function(){
      try{if(stealthAttempt){addCredits(300);gainXP(100);toast2('STEALTH BONUS · +300 CREDITS / +100 XP');}}
      catch(e){}
      prior();
    };
  }
  if(typeof collect==='function'){
    const prior=collect;
    collect=function(p){prior(p);try{if(p&&p.t==='rare'){gainXP(25);toast2('RARE SUPPLY · +25 XP');}}catch(e){}}
  }
})();


/* LAST SECTOR — organize all menu actions into a responsive tactical dashboard. */
(function tacticalMenuLayout(){
  const descriptions = {
    'leaderboard':'Compare your best runs and scores.',
    'daily challenge':'Take on a focused challenge for today.',
    'training':'Practice combat and learn the controls.',
    'controls':'Review movement, combat, and key bindings.',
    'custom match':'Configure a custom combat session.',
    'skills':'Review and improve operator abilities.',
    'arena editor':'Build or adjust a combat arena.',
    'armory':'Choose weapons and manage equipment.',
    'weapon bench':'Tune your weapon setup and upgrades.',
    'sector archive / game history':'Review completed runs and mission history.',
    'operation blackout hub':'Open the central operations hub.',
    'daily missions':'Track objectives and mission rewards.',
    'operator customization':'Personalize your operator profile.',
    'intelligence vault':'Review collected intelligence and audio logs.',
    'career statistics':'Track your combat records and progress.',
    'extreme expansion terminal':'Access advanced modes and expansion tools.'
  };
  const groups = [
    {title:'COMPETITIVE', keys:['leaderboard','daily challenge','custom match','training','controls']},
    {title:'OPERATOR', keys:['armory','weapon bench','skills','operator customization']},
    {title:'OPERATIONS', keys:['operation blackout hub','daily missions','intelligence vault','sector archive / game history','career statistics','arena editor']},
    {title:'ADVANCED FEATURES', keys:['extreme expansion terminal']}
  ];
  function keyOf(button){ return (button.textContent||'').replace(/\s+/g,' ').trim().toLowerCase(); }
  function apply(){
    const host=document.querySelector('#menuScreen .menu-actions');
    if(!host || host.dataset.tacticalLayout==='done') return false;
    const buttons=Array.from(host.querySelectorAll(':scope > button'));
    if(buttons.length<8) return false;
    const summary=host.querySelector('#menuSummary');
    const begin=host.querySelector('#menuBeginBtn');
    const primary=document.createElement('div'); primary.className='menu-primary-row';
    if(summary) primary.appendChild(summary);
    if(begin){ begin.textContent='DEPLOY / BEGIN OPERATION'; primary.appendChild(begin); }
    const sections=groups.map(g=>{
      const section=document.createElement('section'); section.className='menu-section';
      const heading=document.createElement('h3'); heading.className='menu-section-title'; heading.textContent=g.title;
      section.appendChild(heading); return {data:g,element:section};
    });
    const extra=document.createElement('section'); extra.className='menu-section';
    const extraHead=document.createElement('h3'); extraHead.className='menu-section-title'; extraHead.textContent='MORE OPERATIONS'; extra.appendChild(extraHead);
    for(const button of buttons){
      if(button===begin) continue;
      const key=keyOf(button);
      let target=sections.find(s=>s.data.keys.some(k=>key.includes(k)));
      if(!target) target={element:extra};
      const card=document.createElement('div'); card.className='menu-feature';
      if(key.includes('operation blackout hub')) button.classList.add('menu-hub-button');
      if(key.includes('extreme expansion terminal')) card.classList.add('menu-feature-terminal');
      // Move the original button, preserving its click handlers and IDs.
      card.appendChild(button);
      const description=descriptions[key];
      if(description){const p=document.createElement('span');p.className='menu-feature-description';p.textContent=description;card.appendChild(p);}
      target.element.appendChild(card);
    }
    host.replaceChildren(primary);
    sections.forEach(s=>{ if(s.element.querySelector('.menu-feature')) host.appendChild(s.element); });
    if(extra.querySelector('.menu-feature')) host.appendChild(extra);
    host.dataset.tacticalLayout='done';
    return true;
  }
  let tries=0; const timer=setInterval(()=>{tries++; if(apply()||tries>80)clearInterval(timer);},250);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true}); else apply();
  // Re-apply if another feature adds a menu button later.
  const observer=new MutationObserver(()=>{
    const host=document.querySelector('#menuScreen .menu-actions');
    if(host && host.dataset.tacticalLayout==='done'){
      const late=Array.from(host.querySelectorAll(':scope > button'));
      if(late.length){host.dataset.tacticalLayout=''; apply();}
    }
  });
  document.addEventListener('DOMContentLoaded',()=>{const host=document.querySelector('#menuScreen .menu-actions');if(host)observer.observe(host,{childList:true});},{once:true});
})();


/* LAST SECTOR: TACTICAL SYSTEMS EXPANSION — persistent browser-side systems */
(function LastSectorTacticalSystems(){
'use strict';
const STORE='lastSectorTacticalSystems_v2';
const defaults={callsign:'PHANTOM',level:1,xp:0,credits:250,unlocked:['M4 Vanguard'],weapon:'M4 Vanguard',attachments:{optic:false,suppressor:false,extended:false,grip:false},mastery:{},skills:[],achievements:[],missions:{},settings:{weather:'Clear',difficulty:'Normal',hints:true},records:{runs:0,kills:0,headshots:0,bestWave:0,bestAccuracy:0},endingChoices:[]};
let data;try{data={...defaults,...JSON.parse(localStorage.getItem(STORE)||'{}')};data.attachments={...defaults.attachments,...(data.attachments||{})};data.settings={...defaults.settings,...(data.settings||{})};data.records={...defaults.records,...(data.records||{})}}catch(_){data=JSON.parse(JSON.stringify(defaults))}
const save=()=>{try{localStorage.setItem(STORE,JSON.stringify(data))}catch(_){}};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
const xpNeed=()=>100+Math.max(0,data.level-1)*65;
function awardXP(n){data.xp+=n;while(data.xp>=xpNeed()){data.xp-=xpNeed();data.level++;data.credits+=150;notify('RANK PROMOTED · LEVEL '+data.level+' · +150 CR')}save();}
function notify(msg){let n=$('lsxToastV2');if(!n){n=document.createElement('div');n.id='lsxToastV2';document.body.appendChild(n)}n.textContent=msg;n.classList.add('show');clearTimeout(notify.t);notify.t=setTimeout(()=>n.classList.remove('show'),2600)}
function panel(title,content){document.querySelectorAll('.lsx-v2-overlay').forEach(n=>n.remove());const o=document.createElement('div');o.className='lsx-v2-overlay';o.innerHTML=`<section class="lsv2-panel"><div class="lsv2-kicker">LAST SECTOR // TACTICAL SYSTEMS</div><h2>${title}</h2><div class="lsv2-content">${content}</div><button class="lsv2-close">CLOSE</button></section>`;document.body.appendChild(o);o.addEventListener('click',e=>{if(e.target===o||e.target.closest('.lsv2-close'))o.remove()});return o}
function tile(title,desc,action,label='OPEN'){return `<div class="lsv2-tile"><div><b>${title}</b><p>${desc}</p></div><button data-act="${action}">${label}</button></div>`}
function hub(){panel('TACTICAL OPERATIONS',`<div class="lsv2-profile"><span>OPERATOR CALLSIGN</span><input id="lsv2Callsign" maxlength="18" value="${esc(data.callsign)}"><span>LEVEL ${data.level} · ${data.xp}/${xpNeed()} XP</span><div class="lsv2-xp"><i style="width:${Math.min(100,data.xp/xpNeed()*100)}%"></i></div><strong>${data.credits.toLocaleString()} CR</strong><small>Credits are saved in this browser.</small></div><div class="lsv2-grid">${tile('MISSION BRIEFING','Objectives, equipment recommendations and mission flow.','brief')}${tile('GUNSMITH','Equip optics, suppressors, magazines and grips.','gunsmith')}${tile('SKILL TREE','Spend credits on combat and survival perks.','skills')}${tile('SURVIVAL MODE','Launch the existing Last Stand mode and track your record.','survival')}${tile('SQUAD COMMAND','Review squad tactics and assign a preferred order.','squad')}${tile('ENVIRONMENT','Choose a preferred atmosphere for supported overlays.','weather')}${tile('ACHIEVEMENTS','Review your career badges and unlock conditions.','achievements')}${tile('PLAYER RECORD','Review saved progress, mastery and performance.','record')}${tile('SAVE / RESET','Export your profile or reset this expansion data.','save')}${tile('STORY DECISIONS','Choose a campaign approach for your local profile.','story')}</div><p class="lsv2-note">Some systems connect to existing game mechanics; others track choices and progression locally. Browser-only saves do not sync across devices.</p>`).addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act;if(act==='brief')briefing();if(act==='gunsmith')gunsmith();if(act==='skills')skills();if(act==='survival')survival();if(act==='squad')squad();if(act==='weather')weather();if(act==='achievements')achievements();if(act==='record')record();if(act==='save')savePanel();if(act==='story')story();});
const inp=$('lsv2Callsign');if(inp)inp.addEventListener('change',()=>{data.callsign=inp.value.trim().toUpperCase()||'PHANTOM';save();});}
function briefing(){panel('MISSION BRIEFING',`<div class="lsv2-brief-hero"><span>CLASSIFICATION: RESTRICTED</span><h3>OPERATION BLACKOUT</h3><p>An enemy force has seized a communications sector. Enter the area, eliminate hostile resistance, recover intelligence, and reach extraction.</p></div><h3>PRIMARY OBJECTIVES</h3><ol class="lsv2-list"><li>Deploy to the designated sector.</li><li>Clear hostile forces and remain mobile.</li><li>Recover any available intelligence.</li><li>Survive and complete the mission objectives.</li></ol><h3>RECOMMENDED LOADOUT</h3><p>Assault rifle · optic · extended magazine · medkit when available.</p><div class="lsv2-actions"><button data-v2="deploy">DEPLOY TO MISSION SELECT</button><button data-v2="gunsmith">EDIT LOADOUT</button></div>`).addEventListener('click',e=>{if(e.target.dataset.v2==='gunsmith')gunsmith();if(e.target.dataset.v2==='deploy'){document.querySelector('.lsv2-overlay')?.remove();$('menuBeginBtn')?.scrollIntoView({behavior:'smooth',block:'center'});notify('Choose your mission, then select BEGIN OPERATION')}})}
function gunsmith(){const att=[['optic','Red-dot optic','Improves aiming spread in supported gun logic',75],['suppressor','Suppressor','Stealth-themed loadout attachment',100],['extended','Extended magazine','Increases magazine capacity where supported',120],['grip','Vertical grip','Reduces weapon spread where supported',90]];panel('WEAPON BENCH',`<p>Selected weapon: <b>${esc(data.weapon)}</b>. Purchase or equip attachments. Changes are saved locally.</p>${att.map(([id,n,d,c])=>`<div class="lsv2-row"><div><b>${n}</b><small>${d}</small><small>${data.attachments[id]?'EQUIPPED':'Cost: '+c+' CR'}</small></div><button data-att="${id}" data-cost="${c}">${data.attachments[id]?'UNEQUIP':'BUY / EQUIP'}</button></div>`).join('')}<h3>WEAPON MASTERY</h3><p>Mastery is tracked from supported enemy defeats and saved locally.</p>`).addEventListener('click',e=>{const b=e.target.closest('[data-att]');if(!b)return;const id=b.dataset.att,cost=+b.dataset.cost;if(data.attachments[id])data.attachments[id]=false;else if(data.credits>=cost){data.credits-=cost;data.attachments[id]=true;awardXP(10)}else{notify('NOT ENOUGH CREDITS');return}save();gunsmith()})}
const skillDefs=[['vitality','VITALITY','Improves survivability in compatible upgrade logic',150],['quickhands','QUICK HANDS','Faster reload-oriented perk',130],['marksman','MARKSMAN','Precision-focused perk',180],['scavenger','SCAVENGER','Improves supply-finding chance in compatible logic',160],['marathon','MARATHON','Movement-focused perk',140],['fieldmedic','FIELD MEDIC','Recovery-focused perk',170]];
function skills(){panel('OPERATOR SKILL TREE',`<p>Choose a skill to unlock it with credits. The existing expansion applies compatible skills during supported combat initialization.</p>${skillDefs.map(([id,n,d,c])=>`<div class="lsv2-row"><div><b>${n}</b><small>${d}</small></div><button data-skill="${id}" data-cost="${c}">${data.skills.includes(id)?'UNLOCKED':c+' CR'}</button></div>`).join('')}`).addEventListener('click',e=>{const b=e.target.closest('[data-skill]');if(!b)return;const id=b.dataset.skill;if(data.skills.includes(id)){notify('SKILL ALREADY UNLOCKED');return}const cost=+b.dataset.cost;if(data.credits<cost){notify('NOT ENOUGH CREDITS');return}data.credits-=cost;data.skills.push(id);save();notify('SKILL UNLOCKED: '+id.toUpperCase());skills()})}
function survival(){panel('SURVIVAL PROTOCOL',`<p>Enter the game's existing Last Stand mode. This panel records the best wave when supported; survival combat itself is handled by the core game.</p><div class="lsv2-statgrid"><div><small>BEST WAVE</small><b>${data.records.bestWave}</b></div><div><small>OPERATOR LEVEL</small><b>${data.level}</b></div></div><button data-v2="survivalStart">START LAST STAND</button>`).addEventListener('click',e=>{if(e.target.dataset.v2==='survivalStart'){document.querySelector('.lsv2-overlay')?.remove();const b=document.querySelector('[data-laststand]');if(b)b.click();else notify('Open the main menu and select Last Stand.')}})}
function squad(){panel('SQUAD COMMAND',`<p>Select a preferred squad order for your tactical profile. These orders are planning presets; they only control allies if the current mission implements squad AI.</p><div class="lsv2-grid">${[['FOLLOW','Stay close and follow the operator.'],['HOLD','Defend the current position.'],['SUPPRESS','Prioritize covering fire.'],['REGROUP','Return to the operator.']].map(([a,b])=>`<button class="lsv2-command" data-order="${a}"><b>${a}</b><small>${b}</small></button>`).join('')}</div><p>Current order: <b id="lsv2Order">${esc(data.squadOrder||'FOLLOW')}</b></p>`).addEventListener('click',e=>{const b=e.target.closest('[data-order]');if(!b)return;data.squadOrder=b.dataset.order;save();const t=$('lsv2Order');if(t)t.textContent=data.squadOrder;notify('SQUAD ORDER SAVED: '+data.squadOrder)})}
function weather(){panel('ENVIRONMENT SETTINGS',`<p>Choose the atmosphere preference for compatible ambience effects.</p><label class="lsv2-field">WEATHER / ATMOSPHERE<select id="lsv2Weather">${['Clear','Rain','Fog','Night','Blackout','Dust'].map(x=>`<option ${data.settings.weather===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="lsv2-field">DIFFICULTY PREFERENCE<select id="lsv2Diff">${['Easy','Normal','Hard','Extreme'].map(x=>`<option ${data.settings.difficulty===x?'selected':''}>${x}</option>`).join('')}</select></label><button id="lsv2ApplyEnv">SAVE PREFERENCES</button><p class="lsv2-note">These preferences save to your profile; they do not force weather or difficulty in maps that don't expose those controls.</p>`).addEventListener('click',e=>{if(e.target.id!=='lsv2ApplyEnv')return;data.settings.weather=$('lsv2Weather').value;data.settings.difficulty=$('lsv2Diff').value;save();const a=$('lsxAmbience');if(a){a.dataset.phase=data.settings.weather==='Night'?'night':data.settings.weather==='Blackout'?'night':data.settings.weather==='Dust'||data.settings.weather==='Fog'?'dusk':'clear'}notify('ENVIRONMENT PREFERENCES SAVED')})}
const achievementDefs=[['first_deploy','FIRST DEPLOYMENT','Complete your first mission run.'],['ten_kills','TEN CONFIRMED','Reach 10 recorded kills.'],['intel_hunter','INTEL HUNTER','Collect intelligence items in the campaign.'],['survivor','SURVIVOR','Set a personal survival record.'],['operator_level','RISING OPERATOR','Reach level 5.'],['arsenal','ARSENAL','Equip all four weapon attachments.']];
function achievements(){panel('ACHIEVEMENTS',achievementDefs.map(([id,n,d])=>`<div class="lsv2-row"><div><b>${data.achievements.includes(id)?'✓ ': '◇ '}${n}</b><small>${d}</small></div><span>${data.achievements.includes(id)?'UNLOCKED':'LOCKED'}</span></div>`).join(''))}
function record(){panel('CAREER RECORD',`<div class="lsv2-statgrid"><div><small>OPERATOR LEVEL</small><b>${data.level}</b></div><div><small>CREDITS</small><b>${data.credits}</b></div><div><small>RECORDED RUNS</small><b>${data.records.runs}</b></div><div><small>RECORDED KILLS</small><b>${data.records.kills}</b></div><div><small>HEADSHOTS</small><b>${data.records.headshots}</b></div><div><small>BEST WAVE</small><b>${data.records.bestWave}</b></div></div><h3>WEAPON MASTERY</h3>${Object.keys(data.mastery).length?Object.entries(data.mastery).map(([k,v])=>`<div class="lsv2-row"><b>${esc(k.toUpperCase())}</b><span>${v} mastery XP</span></div>`).join(''):'<p>No mastery records yet. Defeat enemies during supported gameplay to build weapon mastery.'}`)}
function savePanel(){panel('PROFILE DATA',`<p>Export a backup of your local tactical profile or reset only this expansion's saved data.</p><div class="lsv2-actions"><button id="lsv2Export">EXPORT PROFILE JSON</button><button id="lsv2Reset" class="danger">RESET EXPANSION DATA</button></div><p class="lsv2-note">This does not erase the game's other localStorage keys or cloud files.</p>`).addEventListener('click',e=>{if(e.target.id==='lsv2Export'){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='last-sector-profile.json';a.click();URL.revokeObjectURL(a.href)}if(e.target.id==='lsv2Reset'&&confirm('Reset this expansion profile? This cannot be undone.')){localStorage.removeItem(STORE);location.reload()}})}
function story(){panel('CAMPAIGN DECISIONS',`<p>Choose the approach you prefer for your campaign record. This stores your decision locally; it only changes the campaign ending if the underlying story logic supports that choice.</p><div class="lsv2-grid">${[['RESCUE','Prioritize saving the captured operative.'],['INTEL','Prioritize recovering classified data.'],['EXTRACT','Prioritize safe extraction of the squad.']].map(([id,d])=>`<button class="lsv2-command" data-story="${id}"><b>${id}</b><small>${d}</small></button>`).join('')}</div><p>Saved choice: <b>${esc(data.endingChoices[data.endingChoices.length-1]||'NONE')}</b></p>`).addEventListener('click',e=>{const b=e.target.closest('[data-story]');if(!b)return;data.endingChoices.push(b.dataset.story);save();notify('CAMPAIGN APPROACH SAVED: '+b.dataset.story)})}
function ensureMenuButton(){const host=document.querySelector('#menuScreen .menu-actions');if(!host||$('lsv2OpenHub'))return false;const b=document.createElement('button');b.id='lsv2OpenHub';b.className='cta';b.textContent='TACTICAL SYSTEMS HUB';b.style.cssText='border:1px solid #f2a341;color:#f2a341;background:rgba(242,163,65,.08)';b.addEventListener('click',hub);host.appendChild(b);return true}
function wrapCombat(){if(typeof window.killEnemy==='function'&&!window.killEnemy.__lsv2){const old=window.killEnemy;const fn=function(e){const before=typeof window.kills==='number'?window.kills:0;const r=old.apply(this,arguments);const after=typeof window.kills==='number'?window.kills:before;const n=Math.max(0,after-before);if(n){data.records.kills+=n;data.mastery[e&&e.type||data.weapon]=(data.mastery[e&&e.type||data.weapon]||0)+n;awardXP(n*12);if(data.records.kills>=10&&!data.achievements.includes('ten_kills'))data.achievements.push('ten_kills');if(data.level>=5&&!data.achievements.includes('operator_level'))data.achievements.push('operator_level');if(Object.values(data.attachments).every(Boolean)&&!data.achievements.includes('arsenal'))data.achievements.push('arsenal');save()}return r};fn.__lsv2=true;window.killEnemy=fn}}
function start(){ensureMenuButton();wrapCombat();const begin=$('menuBeginBtn');if(begin&&!begin.dataset.lsv2Run){begin.dataset.lsv2Run='1';begin.addEventListener('click',()=>{data.records.runs++;save();awardXP(25);if(!data.achievements.includes('first_deploy'))data.achievements.push('first_deploy');save()})}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{start();setInterval(start,1000)});else{start();setInterval(start,1000)}
})();
