/* ============================================================================
   LAST SECTOR — 20-FEATURE EXPANSION  (v2: fully wired into the game engine)
   Loaded after script.js. Everything here hooks the real game functions
   (fire, updatePlayer, updateEnemies, hurtPlayer, startWave, startLevel ...).
   Keys:  [ ] lean   ·  C while sprinting = slide  ·  U use / open / search
          N flashlight  ·  (all older keys unchanged)
   ============================================================================ */
(()=>{
'use strict';
if(typeof P==='undefined'||typeof enemies==='undefined'||typeof updateEnemies!=='function'){
  console.warn('[Expansion] game engine not found — expansion not installed'); return;
}
const LSX={version:2};
window.LSX=LSX;
const TAU=Math.PI*2;
const safe=(name,fn)=>function(...a){ try{ return fn.apply(this,a); }catch(err){ if(!safe.seen[name]){ safe.seen[name]=1; console.error('[Expansion:'+name+']',err); } } };
safe.seen={};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const angDiff=(a,b)=>{ let d=a-b; while(d>Math.PI)d-=TAU; while(d<-Math.PI)d+=TAU; return d; };

/* ------------------------------------------------------------------ profile */
const KEY='lastSectorExpansionV2';
const MAX_LEVEL=50;
const defaults=()=>({
  xp:0,level:1,prestige:0,blueprints:[],equipped:{},docs:[],
  cosmetic:{hue:null,finish:true},
  stats:{kills:0,headshots:0,shots:0,hits:0,missions:0,survival:0,longestRun:0,bestWave:0,bestLastStand:0,deaths:0,stealthKills:0,tacReloads:0,slides:0,secrets:0,weaponKills:{},weaponShots:{}},
  daily:{day:'',list:[]},weekly:{week:'',list:[]},
  settings:{adaptive:true,awareness:true,lsEnv:'Open Ground',flashlightHint:true},
  ngCarry:[]
});
function merge(base,src){
  if(!src||typeof src!=='object')return base;
  for(const k of Object.keys(base)){
    if(!(k in src))continue;
    if(base[k]&&typeof base[k]==='object'&&!Array.isArray(base[k]))base[k]=merge(base[k],src[k]);
    else base[k]=src[k];
  }
  return base;
}
let X=defaults();
try{
  const raw=localStorage.getItem(KEY);
  if(raw)X=merge(defaults(),JSON.parse(raw));
  else{ // migrate the old (v1) panel save
    const old=JSON.parse(localStorage.getItem('lastSectorExpansionV1')||'null');
    if(old){ X.level=Math.min(MAX_LEVEL,old.level||1); X.xp=old.xp||0; X.prestige=old.prestige||0; }
  }
}catch(err){ X=defaults(); }
let saveT=0;
function save(now){ if(now){ try{ localStorage.setItem(KEY,JSON.stringify(X)); }catch(e){} return; } clearTimeout(saveT); saveT=setTimeout(()=>save(true),400); }
addEventListener('beforeunload',()=>save(true));
LSX.data=()=>X;

/* ------------------------------------------------------------------ XP / levels / prestige */
const needXP=l=>100+l*45;
const PRESTIGE=[
  {title:'RECRUIT',badge:'',hue:null,cos:'—'},
  {title:'VETERAN',badge:'★',hue:45,cos:'Gold crosshair + gold weapon finish'},
  {title:'ELITE',badge:'★★',hue:190,cos:'Cyan crosshair + frost finish'},
  {title:'SPECIALIST',badge:'★★★',hue:300,cos:'Violet crosshair + nebula finish'},
  {title:'WARDEN',badge:'◆',hue:120,cos:'Green crosshair + toxic finish'},
  {title:'PHANTOM',badge:'◆◆',hue:0,cos:'Crimson crosshair + ember finish'},
  {title:'LEGEND',badge:'◆◆◆',hue:60,cos:'Lime crosshair + prism finish'},
  {title:'SECTOR LORD',badge:'♛',hue:20,cos:'Orange crosshair + royal finish'}
];
const prestigeInfo=n=>PRESTIGE[Math.min(n,PRESTIGE.length-1)];
function title(){ const p=prestigeInfo(X.prestige); return (p.badge?p.badge+' ':'')+p.title; }
function addXP(n,why){
  if(!n)return;
  n=Math.round(n*(1+(typeof ngPlus==='number'?ngPlus:0)*.25));
  if(X.level>=MAX_LEVEL){ X.xp=0; save(); return; }
  X.xp+=n;
  let up=0;
  while(X.level<MAX_LEVEL&&X.xp>=needXP(X.level)){ X.xp-=needXP(X.level); X.level++; up++; }
  if(X.level>=MAX_LEVEL)X.xp=0;
  if(up){ say('LEVEL '+X.level+(X.level>=MAX_LEVEL?' · MAX — PRESTIGE AVAILABLE':''),'#ffd37a'); try{ Audio_.tone({freq:520,slide:900,dur:.25,vol:.2,type:'square'}); }catch(e){} }
  save();
}
function doPrestige(){
  if(X.level<MAX_LEVEL)return false;
  X.prestige++; X.level=1; X.xp=0;
  const p=prestigeInfo(X.prestige);
  if(p.hue!==null&&X.cosmetic.hue===null)X.cosmetic.hue=p.hue;
  save(true); applyCosmetics();
  say('PRESTIGE '+X.prestige+' · '+p.title+' · unlocked: '+p.cos,'#ffd37a');
  return true;
}
function applyCosmetics(){
  try{ if(X.cosmetic.hue!==null&&X.cosmetic.hue!==undefined&&typeof gfx!=='undefined')gfx.chHue=X.cosmetic.hue; }catch(e){}
}

/* ------------------------------------------------------------------ on-screen messages */
let msgEl=null,msgT=0;
function say(text,col,ms){
  try{
    if(!msgEl){ msgEl=document.createElement('div'); msgEl.id='lsxMsg'; (document.getElementById('stage')||document.body).appendChild(msgEl); }
    msgEl.textContent=text; msgEl.style.color=col||'#e6ebef'; msgEl.classList.add('on');
    clearTimeout(msgT); msgT=setTimeout(()=>msgEl.classList.remove('on'),ms||2600);
  }catch(e){}
}
LSX.say=say;

/* ------------------------------------------------------------------ challenges */
const CH_POOL=[
  {id:'kills',  text:'Defeat {n} enemies',          ev:'kill',      d:50, w:250},
  {id:'mission',text:'Complete {n} missions',        ev:'mission',   d:3,  w:12},
  {id:'head',   text:'Achieve {n} headshots',        ev:'headshot',  d:20, w:100},
  {id:'waves',  text:'Survive {n} enemy waves',      ev:'wave',      d:5,  w:25},
  {id:'tac',    text:'Perform {n} tactical reloads', ev:'tacreload', d:10, w:50},
  {id:'slide',  text:'Slide {n} times',              ev:'slide',     d:8,  w:40},
  {id:'stealth',text:'Take down {n} enemies that never noticed you', ev:'stealth', d:6, w:30},
  {id:'secret', text:'Discover {n} secret rooms',    ev:'secret',    d:1,  w:4}
];
function seededPick(seed,n){
  let s=seed|0||1; const rnd=()=>{ s=(s*1664525+1013904223)|0; return ((s>>>0)%100000)/100000; };
  const idx=CH_POOL.map((_,i)=>i); const out=[];
  while(out.length<n&&idx.length){ out.push(idx.splice(Math.floor(rnd()*idx.length),1)[0]); }
  return out;
}
const dayKey=()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
function weekKey(){ const d=new Date(); const dow=(d.getDay()+6)%7; d.setDate(d.getDate()-dow); return d.getFullYear()+'-W'+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); }
function seedOf(str){ let h=7; for(const c of str)h=(h*31+c.charCodeAt(0))|0; return h; }
function refreshChallenges(){
  const dk=dayKey(), wk=weekKey();
  if(X.daily.day!==dk){ X.daily={day:dk,list:seededPick(seedOf(dk),3).map(i=>({id:CH_POOL[i].id,prog:0,done:false}))}; }
  if(X.weekly.week!==wk){ X.weekly={week:wk,list:seededPick(seedOf(wk)+99,3).map(i=>({id:CH_POOL[i].id,prog:0,done:false}))}; }
}
refreshChallenges();
const chDef=id=>CH_POOL.find(c=>c.id===id);
function emit(ev,n){
  n=n||1; refreshChallenges();
  for(const [kind,set] of [['d',X.daily.list],['w',X.weekly.list]]){
    for(const c of set){
      const def=chDef(c.id); if(!def||def.ev!==ev||c.done)continue;
      const goal=kind==='d'?def.d:def.w;
      c.prog=Math.min(goal,c.prog+n);
      if(c.prog>=goal){
        c.done=true;
        if(kind==='d'){ addXP(300,'daily'); say('DAILY CHALLENGE COMPLETE · +300 XP','#7fe0a0'); }
        else{ addXP(1500,'weekly'); const bp=grantBlueprint(true); say('WEEKLY CHALLENGE COMPLETE · +1500 XP'+(bp?' · BLUEPRINT: '+bp.name:''),'#7fe0a0'); }
      }
    }
  }
  save();
}
LSX.emit=emit;

/* ------------------------------------------------------------------ blueprints */
const BLUEPRINTS=[
  {id:'phantom',   name:'MK-4 Phantom',        w:'rifle',   hue:200,desc:'Ghost-blue finish · −12% recoil, tighter hip spread',        m:{recoil:.88,kick:.9,spread:.9}},
  {id:'inferno',   name:'MK-4 Inferno',        w:'rifle',   hue:20, desc:'Ember finish · +8% damage, +10% magazine',                   m:{dmg:1.08,mag:1.1}},
  {id:'carbon',    name:'M90 Carbon Breacher', w:'shotgun', hue:140,desc:'Green carbon finish · tighter pellets, faster pump',         m:{spread:.85,adsSpread:.85,reload:.92}},
  {id:'hammer',    name:'M90 Hammer',          w:'shotgun', hue:340,desc:'Crimson finish · +12% damage, +1 shell',                     m:{dmg:1.12,mag:1}},
  {id:'sentinel',  name:'P-17 Sentinel',       w:'pistol',  hue:280,desc:'Violet finish · +10% magazine, −15% recoil',                 m:{mag:1.1,recoil:.85}},
  {id:'quicksilver',name:'P-17 Quicksilver',   w:'pistol',  hue:170,desc:'Mint finish · faster reload, faster follow-up shots',        m:{reload:.82,rpm:.9}},
  {id:'nightfall', name:'V-9 Nightfall',       w:'smg',     hue:240,desc:'Midnight finish · +15% reserve ammo, steadier spray',        m:{maxRes:1.15,recoil:.9}},
  {id:'vandal',    name:'V-9 Vandal',          w:'smg',     hue:90, desc:'Lime finish · +10% damage',                                  m:{dmg:1.1}},
  {id:'longwatch', name:'LR-50 Longwatch',     w:'sniper',  hue:160,desc:'Jade finish · +12% range, less sway',                        m:{range:1.12,sway:.7}},
  {id:'reaper',    name:'LR-50 Reaper',        w:'sniper',  hue:0,  desc:'Blood finish · +10% damage, faster bolt',                    m:{dmg:1.1,rpm:.92}}
];
const bpDef=id=>BLUEPRINTS.find(b=>b.id===id);
function grantBlueprint(announce,wantWeapon){
  const left=BLUEPRINTS.filter(b=>!X.blueprints.includes(b.id)&&(!wantWeapon||b.w===wantWeapon));
  const pool=left.length?left:BLUEPRINTS.filter(b=>!X.blueprints.includes(b.id));
  if(!pool.length){ addXP(200); if(announce)say('All blueprints collected · +200 XP','#c9a0ff'); return null; }
  const bp=pool[(Math.random()*pool.length)|0];
  X.blueprints.push(bp.id); if(!X.equipped[bp.w])X.equipped[bp.w]=bp.id;
  save(true);
  if(announce)say('BLUEPRINT FOUND · '+bp.name,'#c9a0ff');
  return bp;
}
function applyBlueprints(){
  if(typeof guns==='undefined'||!guns)return;
  for(const g of guns){
    const id=X.equipped[g.id]; const bp=id&&bpDef(id); if(!bp||!X.blueprints.includes(id))continue;
    for(const [k,v] of Object.entries(bp.m)){
      if(k==='sway')continue;
      if(k==='mag'){ g.mag=Math.max(g.mag,Math.round(g.mag*v)+(v===1?1:0)); g.ammo=g.mag; }
      else if(typeof g[k]==='number')g[k]*=v;
    }
    g.maxRes=Math.round(g.maxRes); g.res=Math.min(g.maxRes,Math.round(g.res));
    g._bp=bp;
  }
}

/* ============================================================================
   1–5  ADVANCED COMBAT
   ============================================================================ */
const run={shots:0,hits:0,dmgTaken:0,waveStart:0,adapt:1,t0:0,startedAt:0,alive:0};
let hitFlag=false;
if(typeof Audio_!=='undefined'&&Audio_.hitmark){ const o=Audio_.hitmark.bind(Audio_); Audio_.hitmark=function(){ hitFlag=true; return o(); }; }

/* ---- 1. recoil patterns, burst build-up and weapon sway ---- */
const PATTERN={
  rifle:  [[0,1],[.15,1],[-.2,1.05],[.35,1.1],[.1,1],[-.5,1.1],[-.3,1],[.45,1.15],[.6,1],[-.2,1.1]],
  smg:    [[.2,.7],[-.3,.75],[.5,.8],[-.5,.8],[.3,.9],[-.6,.85],[.7,.8],[-.2,.9]],
  shotgun:[[0,1.5]],
  pistol: [[.1,1.2],[-.2,1.1]],
  sniper: [[0,1.8]]
};
const SWAY_MUL={rifle:1,smg:1.1,shotgun:.85,pistol:.7,sniper:1.9};
let burst=0,lastShotT=-9,recoilBank=0,swayYaw=0,swayPitch=0,swayPh=0;
const swayOf=(g)=> (SWAY_MUL[g.id]||1)*((g._bp&&g._bp.m.sway)||1)*(ads?.22:1)*(crouching?.6:1)*(moving?(sprinting?1.8:1.3):1);

const _fire=fire;
fire=function(){
  const g=guns[curGun]; if(!g)return _fire();
  const a0=g.ammo, k0=kills; hitFlag=false;
  const sp0=g.spread, asp0=g.adsSpread;
  const stack=1+Math.min(burst,14)*.045;        // spread blooms while you keep the trigger down
  g.spread=sp0*stack; g.adsSpread=asp0*stack;
  // weapon sway genuinely bends the aim a little
  const dx0=P.dx, dy0=P.dy, ca=Math.cos(swayYaw), sa=Math.sin(swayYaw);
  P.dx=dx0*ca-dy0*sa; P.dy=dx0*sa+dy0*ca;
  // lean: shoot from the leaned position
  const lo=leanOffset(); const px0=P.x, py0=P.y;
  if(lo.on){ P.x+=lo.x; P.y+=lo.y; }
  let r; try{ r=_fire(); } finally{ P.x=px0; P.y=py0; P.dx=dx0; P.dy=dy0; g.spread=sp0; g.adsSpread=asp0; }
  if(g.ammo<a0){
    // a real shot was taken
    run.shots++; X.stats.shots++; X.stats.weaponShots[g.id]=(X.stats.weaponShots[g.id]||0)+1;
    if(hitFlag){ run.hits++; X.stats.hits++; }
    if(hitFlag&&(hitKind==='crit'||(hitKind==='kill'&&dmgSrcCause==='crit'))){ X.stats.headshots++; emit('headshot'); addXP(6); }
    burst=(time-lastShotT<Math.max(.35,g.rpm*3.2))?Math.min(Math.floor(burst)+1,20):1; lastShotT=time;
    const pat=PATTERN[g.id]||PATTERN.rifle, st=pat[Math.max(0,Math.floor(burst)-1)%pat.length]||pat[0];
    const m=(1+burst*.085)*(ads?.55:1)*(crouching?.8:1)*(moving?1.12:1)*(leanAbs()>.3?.9:1);
    const dp=st[1]*g.recoil*.0034*m, dyw=st[0]*g.recoil*.0042*m*(Math.random()<.5?1:-1)*.7+st[0]*g.recoil*.0016*m;
    P.pitch=clamp(P.pitch+dp,-1.3,1.3); recoilBank+=dp; rotate(dyw);
    recoilKick*=(1+Math.min(burst,12)*.035);
    noise(P.x,P.y,noiseRadius(g)*(g._bp&&g._bp.id==='quicksilver'?1:1),'shot');
  }
  return r;
};

/* recoil recovery + sway drift (runs every frame while playing) */
function combatFrame(dt){
  const g=guns[curGun];
  if(time-lastShotT>.28){ burst=Math.max(0,burst-dt*9); const rec=Math.min(recoilBank,recoilBank*dt*5+.0004); P.pitch-=rec; recoilBank-=rec; if(recoilBank<1e-4)recoilBank=0; }
  swayPh+=dt;
  if(g){ const a=swayOf(g); swayYaw=(Math.sin(swayPh*1.3)*.5+Math.sin(swayPh*2.9)*.3)*.011*a; swayPitch=(Math.sin(swayPh*1.7+1)*.5+Math.sin(swayPh*3.3)*.3)*.008*a; }
}
const _uct=updateCameraTransform;
updateCameraTransform=function(){
  _uct();
  try{
    if(!camera||povMode==='tp')return;
    camera.rotateY(swayYaw*.7); camera.rotateX(swayPitch*.7);
    const lo=leanOffset();
    if(leanAmt!==0){ camera.position.x+=lo.x; camera.position.z+=lo.y; camera.rotateZ(-leanAmt*.2); }
    if(slideT>0){ camera.rotateZ(slideDir*.035*Math.min(1,slideT*4)); }
  }catch(e){}
};

/* ---- 2. tactical reloading ---- */
const _startReload=startReload;
startReload=function(){
  const g=guns[curGun];
  if(!g||reloading>0||swapT>0||g.ammo>=g.mag||g.res<=0)return _startReload();
  if(g._baseReload===undefined)g._baseReload=g.reload;
  const partial=g.ammo>0;
  g.reload=g._baseReload*(partial?.72:1.12);       // dropping a part-empty mag is quicker than racking an empty gun
  g._tac=partial; g._rlStyle=g.id;
  const before=reloading; _startReload();
  if(reloading>before&&partial)say('TACTICAL RELOAD','#9fd2ff');
  else if(reloading>before)say('EMPTY RELOAD · +'+Math.round((g.reload/g._baseReload-1)*100)+'% time','#e6ebef');
};
const _finishReload=finishReload;
finishReload=function(){
  const g=guns[curGun]; const wasTac=g&&g._tac;
  _finishReload();
  if(g&&wasTac&&g.ammo>=g.mag&&g.res>0){ g.ammo++; g.res--; X.stats.tacReloads++; emit('tacreload'); addXP(3); floatText(P.x+P.dx,P.y+P.dy,1.2,'+1 CHAMBERED','pk'); updateHUD(); }
  if(g)g._tac=false;
};
/* per-weapon reload animation on the 2D viewmodel */
const _dvm=drawViewmodel;
drawViewmodel=function(){
  const g=guns[curGun];
  if(!g){ return _dvm(); }
  vctx.save();
  try{
    const s=Math.min(CW,CH*1.6)/900, px=CW*.7, py=CH;
    let ex=0,ey=0,er=0;
    if(reloading>0){
      const p=clamp(1-reloading/g.reload,0,1), bell=Math.sin(p*Math.PI);
      switch(g.id){
        case 'rifle':   ex=-bell*40; ey=bell*70+Math.sin(p*Math.PI*2)*18; er=-bell*.35; break;          // tilt, mag out / in
        case 'smg':     ex=bell*24;  ey=bell*55+Math.sin(p*Math.PI*4)*12; er=bell*.3; break;             // quick rock
        case 'pistol':  ex=-bell*60; ey=bell*40; er=-bell*.7; break;                                     // canted reload
        case 'shotgun': ey=Math.abs(Math.sin(p*Math.PI*5))*46*(p<.86?1:0); ex=-bell*20; er=-.12*bell; break; // shell by shell
        case 'sniper':  ex=Math.sin(p*Math.PI*2)*-55; ey=bell*30; er=Math.sin(p*Math.PI*2)*.22; break;   // bolt work
      }
    }
    vctx.translate(px,py); vctx.rotate(er); vctx.translate(-px+ex*s,-py+ey*s);
    // cosmetic finish: blueprint hue, or prestige hue
    const bp=g._bp; let hue=null;
    if(X.cosmetic.finish){ if(bp)hue=bp.hue; else if(X.prestige>0&&X.cosmetic.hue!==null)hue=X.cosmetic.hue; }
    if(hue!==null&&'filter' in vctx)vctx.filter='hue-rotate('+hue+'deg) saturate(1.6) brightness(1.12)';
    _dvm();
  }catch(e){ }
  vctx.filter='none'; vctx.restore();
};

/* ---- 3. lean & peek  ( [ and ] ) ---- */
let leanAmt=0,leanTarget=0,leanFree=1;
const leanAbs=()=>Math.abs(leanAmt);
function leanOffset(){
  if(Math.abs(leanAmt)<.02)return {on:false,x:0,y:0};
  const rx=-P.dy, ry=P.dx, side=Math.sign(leanAmt)||1;
  // never push the camera inside a wall: shrink the lean until the spot is free
  let off=.62*Math.abs(leanAmt)*leanFree;
  for(let i=0;i<7&&off>.02;i++){
    const tx=P.x+rx*side*(off+.14), ty=P.y+ry*side*(off+.14);
    if(!solid(tx,ty)&&!solid(P.x+rx*side*off*.5,P.y+ry*side*off*.5))break;
    off-=.09;
  }
  off=Math.max(0,off);
  return {on:off>.03,x:rx*side*off,y:ry*side*off};
}
/* enemies see the part of you that sticks out */
function exposedPos(){ const lo=leanOffset(); return lo.on?{x:P.x+lo.x,y:P.y+lo.y}:P; }

/* ---- 4. sprint / crouch / slide ---- */
let slideT=0,slideCd=0,slideDir=1,slideVX=0,slideVY=0,moveScale=1;
let cPre=false;
addEventListener('keydown',e=>{ if(e.code==='KeyC')cPre=crouching; },true);
addEventListener('keydown',e=>{
  if(!running||e.repeat)return;
  // runs after the engine's own C handler: it just toggled crouch ON while we were sprinting → slide
  if(e.code==='KeyC'&&slideCd<=0&&slideT<=0&&grounded&&!cPre&&crouching&&sprintAmt>.55&&(keys['KeyW']||stick&&stick.id!==null)){
    slideT=.85; slideCd=1.6; slideVX=P.dx; slideVY=P.dy; slideDir=Math.random()<.5?-1:1;
    X.stats.slides++; emit('slide');
    try{ Audio_.burst({dur:.35,vol:.16,freq:320,decay:.7}); }catch(_){}
    noise(P.x,P.y,7,'slide');
  }
});
const _updatePlayer=updatePlayer;
updatePlayer=function(dt){
  const px=P.x, py=P.y;
  moveScale=1;
  environmentMoveScale(dt);
  // lean input
  leanTarget=(keys['BracketLeft']?-1:0)+(keys['BracketRight']?1:0);
  leanAmt+=(leanTarget-leanAmt)*Math.min(1,dt*9);
  if(Math.abs(leanAmt)<.003&&leanTarget===0)leanAmt=0;
  if(slideT>0){ crouching=true; }
  _updatePlayer(dt);
  if(leanTarget!==0){ const bx=P.x-(P.x-px)*.4, by=P.y-(P.y-py)*.4; P.x=bx; P.y=by; }   // slower while leaning
  if(moveScale<1){ P.x=px+(P.x-px)*moveScale; P.y=py+(P.y-py)*moveScale; }
  if(slideT>0){
    slideT-=dt;
    if(!crouching){ slideT=0; }                      // player cancelled the slide with C
    const k=Math.max(0,slideT/.85), sp=P.speed*3.1*k*k*dt+P.speed*.4*k*dt;
    const mx=slideVX*sp, my=slideVY*sp, r=.26;
    if(!solid(P.x+mx+Math.sign(mx)*r,P.y))P.x+=mx;
    if(!solid(P.x,P.y+my+Math.sign(my)*r))P.y+=my;
    sprinting=false; ads=false;
    if(slideT<=0){ slideT=0; crouching=false; const b=$('btnCrouch'); if(b)b.classList.remove('active'); }
  }
  slideCd=Math.max(0,slideCd-dt);
  safe('combatFrame',combatFrame)(dt);
  safe('interact',interactFrame)(dt);
  safe('flash',flashFrame)(dt);
  updateCameraTransform();                           // re-apply with lean / sway
};
function playerNoiseRadius(){
  if(slideT>0)return 7; if(sprinting)return 8; if(crouching)return moving?1.6:0; return moving?3.4:.6;
}

/* ---- 5. damage feedback ---- */
let hitFx=null, lowFx=null;
function mkFx(){
  const st=$('stage')||document.body;
  hitFx=document.createElement('div'); hitFx.id='lsxHit'; st.appendChild(hitFx);
  lowFx=document.createElement('div'); lowFx.id='lsxLow'; st.appendChild(lowFx);
}
let lastHurt={armor:0,hp:0,t:-9};
const _hurtPlayer=hurtPlayer;
hurtPlayer=function(amount,src){
  if(!P.alive||trainingOn)return _hurtPlayer(amount,src);
  const a0=P.armor||0, h0=P.health, n0=dmgDirs.length;
  _hurtPlayer(amount,src);
  const aLoss=a0-(P.armor||0), hLoss=h0-P.health;
  run.dmgTaken+=Math.max(0,hLoss+aLoss);
  try{
    if(!hitFx)mkFx();
    const armorOnly=aLoss>0&&hLoss<=.5, mixed=aLoss>0&&hLoss>.5;
    hitFx.className=''; void hitFx.offsetWidth;
    hitFx.classList.add(armorOnly?'armor':mixed?'mixed':'health','go');
    hitFx.style.setProperty('--hit',Math.min(1,.35+(aLoss+hLoss)/30));
    if(dmgDirs.length>n0){ const d=dmgDirs[dmgDirs.length-1]; d.kind=armorOnly?'armor':'health'; d.amt=aLoss+hLoss; d.t=1.6; }
    if(armorOnly){                                 // plates soak it: sparks, metallic ping, barely any flinch
      Audio_.tone({freq:1350,slide:-500,dur:.07,vol:.13,type:'square'});
      shake=Math.max(0,shake-.25);
    } else {                                       // flesh: stronger flinch + camera kick
      P.pitch=clamp(P.pitch-Math.min(.05,hLoss*.0028),-1.3,1.3);
      hurtRoll=clamp(hurtRoll+(Math.random()<.5?-1:1)*Math.min(.09,hLoss*.004),-.14,.14);
      shake=Math.max(shake,.55+Math.min(.5,hLoss/40));
    }
    if(a0>0&&(P.armor||0)<=0)say('ARMOR BROKEN','#8fc3ff');
    lastHurt={armor:aLoss,hp:hLoss,t:time};
  }catch(e){}
};
const _drawReticle=drawReticle;
drawReticle=function(){
  _drawReticle();
  try{
    const cx=CW/2, cy=CH/2;
    for(const d of dmgDirs){
      if(!d.kind)continue;
      const rel=Math.atan2(d.y-P.y,d.x-P.x)-Math.atan2(P.dy,P.dx);
      const al=clamp(d.t/1.6,0,1);
      vctx.save(); vctx.translate(cx,cy); vctx.rotate(rel+Math.PI/2);
      vctx.globalAlpha=al*.95; vctx.fillStyle=d.kind==='armor'?'#6fb0ff':'#ff4a3a';
      const r=128+(1-al)*10, w=10+Math.min(14,(d.amt||8)*.7);
      vctx.beginPath(); vctx.moveTo(0,-r-18); vctx.lineTo(w,-r+8); vctx.lineTo(0,-r); vctx.lineTo(-w,-r+8); vctx.closePath(); vctx.fill();
      vctx.restore();
    }
  }catch(e){}
};
function lowHealthFx(dt){
  if(!lowFx)mkFx();
  const hp=P.health/P.maxHealth, low=P.alive&&hp<.4;
  const k=low?clamp((.4-hp)/.4,0,1):0;
  lowFx.style.opacity=k?(.35+k*.55)*(.75+.25*Math.sin(time*(5+k*5))):0;
  const gl=$('glview'); if(gl)gl.style.filter=k>0?'saturate('+(1-k*.55).toFixed(2)+') contrast('+(1+k*.08).toFixed(2)+')':'';
}

/* ============================================================================
   6–10  SMARTER ENEMIES
   ============================================================================ */
if(!TYPES.commander){
  TYPES.commander={hp:170,speed:1.35,radius:.45,scale:1.12,dmg:11,fireGap:1.05,acc:.76,label:'COMMANDER',range:15,base:'grunt',tint:[1.45,1.15,.45]};
}
TYPES.grunt.label='ASSAULT'; TYPES.heavy.label='HEAVY'; if(TYPES.sniper)TYPES.sniper.label='SNIPER';
/* class table: vis = sight multiplier, hear = hearing multiplier, armor = flat damage reduction */
const CLASS={
  grunt:{name:'ASSAULT',vis:1,hear:1,armor:0},
  runner:{name:'SCOUT',vis:2.0,hear:1.5,armor:0},                 // spots you from much farther away
  sniper:{name:'SNIPER',vis:1.15,hear:1,armor:0},
  heavy:{name:'HEAVY',vis:.9,hear:.75,armor:.30},                  // high health + armour
  medic:{name:'MEDIC',vis:1,hear:1,armor:0},
  commander:{name:'COMMANDER',vis:1.3,hear:1.25,armor:.12,radio:true},
  flamer:{name:'FLAMER',vis:.8,hear:1,armor:.1},
  charger:{name:'CHARGER',vis:1.2,hear:1.3,armor:0},
  drone:{name:'DRONE',vis:1.6,hear:1.2,armor:0},
  stealth:{name:'SHADE',vis:1.2,hear:1.4,armor:0},
  elite:{name:'ELITE',vis:1.1,hear:1,armor:.2},
  sniperElite:{name:'ELITE SNIPER',vis:1.2,hear:1,armor:.1}
};
const STATES=['unaware','suspicious','alerted','combat','searching'];
let alarm=null, alarmsThisWave=0, pressureT=0, lastCall=-9, noiseStepT=0, orderT=0;
const liveEnemies=()=>enemies.filter(e=>!e.dead&&!e.dummy);
const awOn=()=>!!X.settings.awareness;

function noiseRadius(g){
  const base={rifle:18,shotgun:20,pistol:13,smg:16,sniper:24}[g.id]||16;
  return base*(g._bp&&g._bp.id==='quicksilver'?.9:1)*(ads?.9:1);
}
function noise(x,y,r,kind){
  if(!awOn()||r<=0)return;
  for(const e of enemies){
    if(e.dead||e.dummy||e.boss||!e.aw)continue;
    const aw=e.aw; if(aw.state==='combat'||aw.state==='alerted')continue;
    const d=Math.hypot(e.x-x,e.y-y);
    const rr=r*((e.cls&&e.cls.hear)||1)*(lineClear(e.x,e.y,x,y)?1:.62);
    if(d>rr)continue;
    aw.inv={x,y}; aw.waitT=0; aw.meter=Math.max(aw.meter,.5);
    if(aw.state==='unaware'||aw.state==='searching'){
      if((kind==='shot'||kind==='boom')&&d<rr*.5){ aw.state='alerted'; aw.last={x,y}; aw.alertT=0; aw.delay=d*.03; }
      else{ aw.state='suspicious'; }
    }
  }
}
const _xBlast=xBlast;
xBlast=function(x,y,r,dmg){ const out=_xBlast(x,y,r,dmg); noise(x,y,20,'boom'); return out; };

/* ---- enemy setup: awareness, class, armour, adaptive scaling ---- */
function initEnemy(e){
  const cls=CLASS[e.type]||CLASS[e.base]||{name:e.label,vis:1,hear:1,armor:0};
  e.cls=cls;
  const m=X.settings.adaptive?run.adapt:1;
  if(!e.boss){ e.maxHp*=m; e.hp*=m; }
  e.acc=clamp(e.acc*(.92+.14*m),.2,.97); e.speed*=1+(m-1)*.22; e.aggr=m;
  const aw={state:'unaware',meter:0,face:Math.random()*TAU,wp:null,wpWait:rand(.2,2),last:null,inv:null,waitT:0,lastSeen:-99,engaged:false,delay:0,roamT:0,searchDur:8,alertT:0,hpPrev:e.hp,stuckT:0};
  e.aw=aw;
  if(!awOn()||e.boss||e.dummy){ aw.state='combat'; aw.engaged=true; }
  else if(mode==='laststand'){ if(Math.random()<Math.min(.9,.4+wave*.07)){ aw.state='alerted'; aw.last={x:P.x,y:P.y}; } }
  else if(Math.random()<Math.min(.5,.12+difficulty()*.03)){ aw.state='alerted'; aw.last={x:P.x,y:P.y}; }
  if(cls.armor){                                    // armour: incoming damage from ANY source is reduced
    let hp=e.hp;
    Object.defineProperty(e,'hp',{configurable:true,enumerable:true,get(){return hp;},set(v){ if(v<hp)v=hp-(hp-v)*(1-cls.armor); hp=v; }});
  }
}
const _spawnEnemy=spawnEnemy;
spawnEnemy=function(type){
  const n0=enemies.length; const r=_spawnEnemy(type);
  if(enemies.length>n0){ try{ initEnemy(enemies[enemies.length-1]); }catch(err){ console.error('[Expansion:initEnemy]',err); } }
  return r;
};
/* the 3D rig normally always faces you — unaware enemies should face where they walk */
const _stepRig=stepEnemyRig;
stepEnemyRig=function(e,dt){
  _stepRig(e,dt);
  try{ if(e.aw&&e.rig&&e.aw.state!=='combat'&&e.aw.state!=='alerted')e.rig.group.rotation.y=Math.PI/2-e.aw.face; }catch(err){}
};

/* ---- communication ---- */
function engage(e,silent){
  const aw=e.aw; if(!aw||aw.state==='combat')return;
  aw.state='combat'; aw.engaged=true; aw.meter=1; aw.lastSeen=time; aw.last={x:P.x,y:P.y};
  if(!silent&&time-lastCall>2.2){ lastCall=time; try{ calloutAlert(e.type==='commander'?'COMMANDER: CONTACT!':'CONTACT!',e,'#ff8a4a'); }catch(err){} }
  // 7. nearby enemies hear the shout and converge on you
  const R=e.type==='commander'?24:e.type==='runner'?15:13;
  for(const o of enemies){
    if(o===e||o.dead||o.dummy||!o.aw||o.aw.state==='combat'||o.boss)continue;
    const d=Math.hypot(o.x-e.x,o.y-e.y); if(d>R)continue;
    if(d>R*.6&&!lineClear(e.x,e.y,o.x,o.y))continue;
    o.aw.state='alerted'; o.aw.last={x:P.x,y:P.y}; o.aw.alertT=0; o.aw.delay=d*.05; o.aw.meter=Math.max(o.aw.meter,.8);
  }
  // 9. radio for reinforcements
  if(!alarm&&inWave&&alarmsThisWave<2&&(wave>=2||mode==='campaign'&&levelIndex>0)&&liveEnemies().length<11&&(e.cls&&e.cls.radio||Math.random()<.18)){
    alarm={t:8,caller:e}; alarmsThisWave++;
    say('ALARM RAISED · REINFORCEMENTS IN 8s — KILL THE RADIO OPERATOR','#ff8a4a');
    try{ Audio_.tone({freq:620,slide:-120,dur:.5,vol:.2,type:'sawtooth'}); }catch(err){}
  }
}
function updateAlarm(dt){
  if(!alarm)return;
  if(alarm.caller.dead){ say('RADIO CUT · REINFORCEMENTS CANCELLED','#7fe0a0'); score+=150; addXP(25); alarm=null; return; }
  alarm.t-=dt;
  if(alarm.t>0)return;
  alarm=null;
  const n=Math.min(5,2+Math.floor(difficulty()/3));
  const kinds=['grunt','runner','grunt','heavy','sniper'];
  for(let i=0;i<n&&liveEnemies().length<15;i++){
    const before=enemies.length; spawnEnemy(kinds[(i+wave)%kinds.length]);
    const ne=enemies[enemies.length-1]; if(enemies.length>before&&ne.aw&&!ne.boss){ ne.aw.state='alerted'; ne.aw.last={x:P.x,y:P.y}; ne.aw.alertT=0; }
  }
  banner('REINFORCEMENTS','HOSTILES INBOUND'); try{ Audio_.wave(); }catch(err){}
}
function haltAlarm(){ alarm=null; }

/* ---- perception ---- */
function envDarkness(){ return typeof lightDark==='function'?lightDark():0; }
function visionRange(e,dist){
  let v=Math.max(10,e.range*1.15)*((e.cls&&e.cls.vis)||1);
  const shooting=time-lastShotT<1.1, lit=flashOn&&flashBattery>0;
  let k=1;
  if(slideT>0)k*=.55; else if(crouching)k*=moving?.55:.45; else if(sprinting)k*=1.3; else if(!moving)k*=.85;
  if(shooting)k*=1.35; if(lit)k*=1.25;
  const dk=envDarkness(); if(dk>0&&!shooting&&!lit)k*=1-.55*dk;
  k*=WEATHER[weather].vis;
  return Math.min(40,v*k);
}
function senseMeter(e,dt,dist,los,vr){
  const aw=e.aw;
  const cone=aw.state==='unaware'||aw.state==='suspicious'?.42:aw.state==='searching'?0:-1;
  let inCone=true;
  if(cone>-1){ const toP=Math.atan2(P.y-e.y,P.x-e.x); inCone=Math.cos(angDiff(toP,aw.face))>=cone||dist<2.2; }
  const sees=los&&dist<vr&&inCone;
  if(sees){ aw.meter=Math.min(1.2,aw.meter+(1.5+(1-dist/vr)*2.4)*(e.aggr||1)*dt); aw.lastSeen=time; aw.last={x:P.x,y:P.y}; }
  else aw.meter=Math.max(0,aw.meter-dt*(aw.state==='unaware'?.45:.2));
  return sees;
}

function pickWP(e,cx,cy,R){
  for(let t=0;t<14;t++){
    const a=rand(0,TAU), r=rand(2,R), x=cx+Math.cos(a)*r, y=cy+Math.sin(a)*r;
    if(x<1.6||y<1.6||x>MW-1.6||y>MH-1.6||solid(x,y))continue;
    if(!lineClear(e.x,e.y,x,y))continue;
    return {x,y};
  }
  return null;
}
function stepE(e,vx,vy,sp,dt){
  const m=sp*dt, nx=e.x+vx*m, ny=e.y+vy*m;
  if(!solid(nx+Math.sign(vx)*e.radius,e.y))e.x=nx;
  if(!solid(e.x,ny+Math.sign(vy)*e.radius))e.y=ny;
}
function goTo(e,tx,ty,speedMul,dt){
  const dx=tx-e.x, dy=ty-e.y, d=Math.hypot(dx,dy);
  if(d<.25)return d;
  const vx=dx/d, vy=dy/d;
  stepE(e,vx,vy,e.speed*speedMul,dt);
  e.aw.face=Math.atan2(vy,vx);
  e.stepT+=dt*e.speed*speedMul*2.4; if(e.stepT>.26){ e.stepT=0; e.step=!e.step; }
  return d;
}

/* ---- the new enemy update (replaces the engine's, adds awareness states) ---- */
const _origUpdateEnemies=updateEnemies;
updateEnemies=function(dt){
  if(!X.settings.awareness&&!enemies.some(e=>e.aw))return _origUpdateEnemies(dt);
  try{ updateEnemiesX(dt); }
  catch(err){ if(!safe.seen.ue){ safe.seen.ue=1; console.error('[Expansion:updateEnemies] falling back to engine AI',err); } X.settings.awareness=false; for(const e of enemies)if(e.aw)e.aw.state='combat'; return _origUpdateEnemies(dt); }
};
function updateEnemiesX(dt){
  noiseStepT-=dt;
  if(noiseStepT<=0&&P.alive){ noiseStepT=.5; const r=playerNoiseRadius(); if(r>1&&grounded)noise(P.x,P.y,r,'step'); }
  updateAlarm(dt);
  const pe=exposedPos();
  const cmds=enemies.filter(c=>!c.dead&&c.type==='commander');
  let anyHot=false;
  orderT-=dt;
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    if(e.dead){
      e.deadScale-=dt*1.9;
      if(e.deadScale<=0.05){ enemyGroup.remove(e.sprite); if(e.sprite.material&&e.sprite.material.dispose)e.sprite.material.dispose(); enemies.splice(i,1); continue; }
      const dk=Math.max(.05,e.deadScale);
      if(e.rig){ e.sprite.scale.setScalar(e.scale*(e.type==='drone'?1.4:1)*dk); e.sprite.rotation.x=-(1-dk)*1.3; e.sprite.position.set(e.x,e.type==='drone'?(e.hover||0)*dk:0,e.y); setRigFlash(e.rig,false); }
      else { const h=e.baseHeight*dk; e.sprite.scale.set(h*(SPR_W/SPR_H),h,1); e.sprite.position.set(e.x,h/2,e.y); }
      continue;
    }
    e.hitFlash=Math.max(0,e.hitFlash-dt);
    e.fireFlash=Math.max(0,e.fireFlash-dt);
    if(e.dummy){ syncEnemyVisual(e,dt); if(e.hp<e.maxHp)e.hp=Math.min(e.maxHp,e.hp+dt*20); continue; }
    if(!e.aw)initEnemy(e);
    const aw=e.aw;
    // commander aura: allies near a living commander shoot straighter and faster
    e.buffT=Math.max(0,(e.buffT||0)-dt);
    for(const c of cmds){ if(c!==e&&Math.hypot(c.x-e.x,c.y-e.y)<9&&c.aw&&c.aw.state==='combat'){ e.buffT=.4; break; } }
    // being shot always wakes you up
    if(aw.state!=='combat'&&e.hp<aw.hpPrev-.01){ engage(e); }
    aw.hpPrev=e.hp;
    // enemies open doors they walk into
    if(typeof enemyDoorCheck==='function')enemyDoorCheck(e);

    const dx=pe.x-e.x, dy=pe.y-e.y, dist=Math.hypot(dx,dy)||.001;
    const los=lineClear(e.x,e.y,pe.x,pe.y);
    const vr=visionRange(e,dist);
    if(aw.delay>0){ aw.delay-=dt; syncEnemyVisual(e,dt); continue; }
    const sees=senseMeter(e,dt,dist,los,vr);

    let vx=0,vy=0, fighting=false;
    switch(aw.state){
      case 'unaware':{
        if(aw.meter>=.45){ aw.state='suspicious'; aw.inv=aw.last||{x:P.x,y:P.y}; aw.waitT=0; break; }
        aw.wpWait-=dt;
        if(aw.wp){ const d=goTo(e,aw.wp.x,aw.wp.y,.42,dt); if(d<.35){ aw.wp=null; aw.wpWait=rand(1,3.4); } }
        else{ aw.face+=Math.sin(time*.8+e.id)*dt*.9; if(aw.wpWait<=0)aw.wp=pickWP(e,e.x,e.y,8)||null; if(!aw.wp&&aw.wpWait<=0)aw.wpWait=1.2; }
        break; }
      case 'suspicious':{
        if(aw.meter>=1||(sees&&dist<vr*.4&&aw.meter>.5)){ engage(e); break; }
        aw.alertT+=dt;
        const t=aw.inv||aw.last||{x:P.x,y:P.y};
        const d=goTo(e,t.x,t.y,.7,dt);
        if(d<1.3){ aw.waitT+=dt; aw.face+=Math.sin(time*2+e.id)*dt*1.6; if(aw.waitT>2.4){ aw.state=aw.meter>.2?'searching':'unaware'; aw.roamT=0; aw.searchDur=6; aw.alertT=0; aw.last=t; aw.wp=null; } }
        else if(aw.alertT>9){ aw.state='unaware'; aw.alertT=0; }
        break; }
      case 'alerted':{
        if(sees&&aw.meter>.35){ engage(e,true); break; }
        aw.alertT+=dt;
        const t=aw.last||{x:P.x,y:P.y};
        const d=goTo(e,t.x,t.y,1,dt);
        if(d<1.5||aw.alertT>10){ aw.state='searching'; aw.roamT=0; aw.searchDur=9; aw.wp=null; }
        break; }
      case 'searching':{
        if(sees&&aw.meter>=.6){ engage(e); break; }
        aw.roamT+=dt;
        if(aw.wp){ const d=goTo(e,aw.wp.x,aw.wp.y,.62,dt); if(d<.4)aw.wp=null; }
        else{ aw.face+=dt*1.4; aw.wp=pickWP(e,(aw.last||e).x,(aw.last||e).y,5.5); if(!aw.wp){ aw.roamT+=dt*2; } }
        if(aw.roamT>aw.searchDur){ aw.state='unaware'; aw.meter=0; aw.wp=null; aw.wpWait=1; }
        break; }
      default: fighting=true;
    }
    if(aw.state==='combat'&&!fighting)fighting=true;
    if(!fighting){ syncEnemyVisual(e,dt); continue; }
    anyHot=true;

    /* ---------- combat: the engine's own behaviour ---------- */
    if(los&&dist<vr*1.4){ aw.lastSeen=time; aw.last={x:P.x,y:P.y}; }
    else if(!e.boss&&time-aw.lastSeen>3.4&&awOn()){ aw.state='searching'; aw.roamT=0; aw.searchDur=9; aw.wp=null; syncEnemyVisual(e,dt); continue; }
    aw.face=Math.atan2(dy,dx);
    e.coverCd=(e.coverCd||0)-dt;
    if(!e.boss&&e.type!=='charger'&&e.type!=='drone'&&!e.cover&&e.hp<e.maxHp*.35&&e.coverCd<=0){ e.cover=findCover(e); if(e.cover)e.coverT=rand(2.5,4.5); else e.coverCd=2; }
    if(e.cover){
      const cx0=e.cover.x-e.x, cy0=e.cover.y-e.y, cd=Math.hypot(cx0,cy0)||.001;
      e.coverT-=dt;
      if(cd>.35){ vx=cx0/cd*1.15; vy=cy0/cd*1.15; }
      if(e.coverT<=0||e.hp>e.maxHp*.6){ e.cover=null; e.coverCd=rand(5,8); }
    } else if(los&&dist<e.range*0.75){
      e.strafeT-=dt; if(e.strafeT<=0){ e.strafe*=-1; e.strafeT=rand(.7,2.1); }
      vx=(-dy/dist)*e.strafe*0.75; vy=(dx/dist)*e.strafe*0.75;
      if(dist<3.2){ vx-=dx/dist*.7; vy-=dy/dist*.7; }
    } else if(los&&e.flank&&dist>5){
      vx=dx/dist*.55+(-dy/dist)*e.flank*.85; vy=dy/dist*.55+(dx/dist)*e.flank*.85;
    } else { vx=dx/dist; vy=dy/dist; }
    const sp=e.speed*dt;
    const nx=e.x+vx*sp, ny=e.y+vy*sp;
    if(!solid(nx+Math.sign(vx)*e.radius,e.y))e.x=nx;
    if(!solid(e.x,ny+Math.sign(vy)*e.radius))e.y=ny;
    e.stepT+=dt*(Math.hypot(vx,vy)*e.speed*2.4);
    if(e.stepT>0.26){ e.stepT=0; e.step=!e.step; }
    if(e.type==='charger'&&dist<1.05&&P.alive){ hurtPlayer(30,e); xBlast(e.x,e.y,2.2,0); killEnemy(e); continue; }
    if(e.type==='medic'){ e.healT=(e.healT||0)-dt; if(e.healT<=0){ e.healT=2.2; for(const o of enemies){ if(!o.dead&&o!==e&&o.hp<o.maxHp&&Math.hypot(o.x-e.x,o.y-e.y)<5){ o.hp=Math.min(o.maxHp,o.hp+o.maxHp*.2); floatText(o.x,o.y,o.baseHeight,'+','heal'); } } } }
    if(e.type==='commander'&&orderT<=0){            // 8. commander coordinates: flank orders + keeps allies engaged
      orderT=5;
      for(const o of enemies){ if(o===e||o.dead||o.dummy||o.boss||!o.aw)continue; if(Math.hypot(o.x-e.x,o.y-e.y)>16)continue; if(o.aw.state!=='combat'){ o.aw.state='alerted'; o.aw.last={x:P.x,y:P.y}; o.aw.alertT=0; } else if(Math.random()<.4)o.flank=Math.random()<.5?-1:1; }
    }
    if(e.boss)bossLogic(e,dt,dist);
    e.cool-=dt;
    e.nadeCd=(e.nadeCd===undefined?rand(6,12):e.nadeCd)-dt;
    if(!los&&e.nadeCd<=0&&e.type==='grunt'&&!e.cover&&difficulty()>=2&&dist>4&&dist<12&&P.alive){ e.nadeCd=rand(10,16); throwEnemyGrenade(e); }
    if(los&&!e.warned){
      if(e.type==='sniper'&&dist<e.range&&e.cool<.6){ e.warned=true; calloutAlert('SNIPER LOCKED ON',e,'#6fb0ff'); }
      else if(e.type==='charger'&&dist<9){ e.warned=true; calloutAlert('CHARGER INCOMING',e,'#ff6a4a'); }
      else if(e.type==='flamer'&&dist<5.5){ e.warned=true; calloutAlert('FLAMER CLOSE',e,'#ff9a3c'); }
    }
    const buff=e.buffT>0;
    if(los&&dist<e.range*(selectedPerk===2?.82:1)*WEATHER[weather].vis*(selectedCharacter===1&&hasSkill(2)?.9:1)&&e.cool<=0&&P.alive){
      e.cool=e.fireGap*rand(.75,1.3)*(buff?.88:1); e.warned=false; aw.lastSeen=time;
      e.fireFlash=.1;
      Audio_.enemyShot(dist*(weather==='rain'?1.5:weather==='sand'?1.8:1));
      const chance=e.acc*(buff?1.15:1)*clamp(1.25-dist/e.range,.25,1)*(crouching?.9:1)*(leanAbs()>.3?.92:1);
      if(Math.random()<chance)hurtPlayer(e.dmg*rand(.8,1.2)*(buff?1.1:1),e);
    }
    syncEnemyVisual(e,dt);
  }
  // wave pressure: if nobody is fighting for a while, the survivors converge so waves always finish
  if(inWave&&!toSpawn.length){ pressureT=anyHot?0:pressureT+dt; if(pressureT>24){ pressureT=0; let n=0; for(const e of enemies){ if(e.dead||e.dummy||!e.aw||e.aw.state==='combat'||e.boss)continue; e.aw.state='alerted'; e.aw.last={x:P.x,y:P.y}; e.aw.alertT=0; n++; } if(n)say('HOSTILES CONVERGING ON YOUR POSITION','#ff8a4a'); } } else pressureT=0;
  $('enemyNum').textContent=enemies.filter(e=>!e.dead).length;
}

/* ---- kills: stats, XP, stealth bonus, drops ---- */
const _killEnemy=killEnemy;
killEnemy=function(e){
  const k0=kills, aw=e&&e.aw, wasStealth=!!(aw&&!aw.engaged&&aw.state!=='combat');
  const crit=dmgSrcCause==='crit', wid=dmgSrcWeapon;
  const r=_killEnemy(e);
  try{
    if(kills>k0&&e&&!e.dummy){
      X.stats.kills++; X.stats.weaponKills[wid]=(X.stats.weaponKills[wid]||0)+1;
      emit('kill'); addXP(12+(crit?8:0)+(e.boss?150:0)+(e.type==='commander'?40:0));
      if(wasStealth&&X.settings.awareness){ X.stats.stealthKills++; emit('stealth'); score+=75; credits+=75; addXP(15); floatText(e.x,e.y,e.baseHeight*1.2,'STEALTH +75','crit'); }
      if(e.type==='commander'){ say('COMMANDER DOWN · enemy coordination broken','#7fe0a0'); dropKeycardAt(e.x,e.y); if(Math.random()<.35)grantBlueprint(true); }
      if(e.boss){ grantBlueprint(true); }
      if(alarm&&alarm.caller===e){ /* handled in updateAlarm */ }
    }
  }catch(err){ console.error('[Expansion:kill]',err); }
  return r;
};

/* ---- waves: commanders, adaptive scaling, reinforcement reset ---- */
let waveClock=0, wasInWave=false;
const _startWave=startWave;
startWave=function(){
  // 10. adaptive difficulty — judge the wave we just finished
  if(wave>=1){ try{ adaptRecalc(); }catch(e){} }
  alarmsThisWave=0; alarm=null; pressureT=0;
  const shifting=mode==='laststand'&&!customArena&&(wave+1)>1&&(wave+1)%5===0;
  _startWave();
  try{
    const d=difficulty();
    if(d>=3&&toSpawn.length>3){ toSpawn.splice(Math.min(1,toSpawn.length),0,'commander'); if(d>=8&&toSpawn.length>6)toSpawn.splice(2,0,'commander'); }
    if(d>=5&&toSpawn.length>5)toSpawn.splice(Math.min(3,toSpawn.length),0,'runner');
    run.waveStart=time; waveClock=0;
    if(shifting)setupEnvironment(true);
    if(X.settings.adaptive&&Math.abs(run.adapt-1)>.04)setTimeout(()=>{ if(running)say('ENEMY ADAPTATION ×'+run.adapt.toFixed(2),run.adapt>1?'#ff9a6a':'#9fd2ff'); },1800);
    X.stats.bestWave=Math.max(X.stats.bestWave,wave); if(mode==='laststand')X.stats.bestLastStand=Math.max(X.stats.bestLastStand,wave);
  }catch(err){ console.error('[Expansion:startWave]',err); }
};
function adaptRecalc(){
  if(!X.settings.adaptive){ run.adapt=1; return; }
  const acc=run.shots>=12?run.hits/run.shots:.4;
  const dmgFrac=clamp(run.dmgTaken/(P.maxHealth*1.4),0,1);
  const dur=Math.max(5,time-run.waveStart);
  const speed=clamp(1-(dur-35)/70,0,1);
  const p=.35*clamp((acc-.2)/.45,0,1)+.45*(1-dmgFrac)+.2*speed;     // 0..1 how well the player is doing
  const target=.8+p*.65;                                              // 0.80 (struggling) .. 1.45 (dominating)
  run.adapt=clamp(run.adapt+(target-run.adapt)*.55,.8,1.45);
  run.shots=0; run.hits=0; run.dmgTaken=0;
}
/* wave cleared → progression events */
function waveWatch(dt){
  if(wasInWave&&!inWave&&running&&P.alive){ X.stats.bestWave=Math.max(X.stats.bestWave,wave); emit('wave'); addXP(40+wave*5); }
  wasInWave=inWave;
}

/* ============================================================================
   11–15  MAPS, SECRETS, KEYCARDS, HAZARDS, LIGHTING
   ============================================================================ */
const ENVS=[
 {env:'lab',name:'Abandoned Laboratory',where:'Helix Biotech · sub-level B2 · power cycling',
  brief:'Sterile corridors, broken glass and strip lights that will not stay on. Toxic leaks pool on the floor and cut cables spit live current — find the light panels, watch the arcs, and do not trust the quiet rooms.',
  waves:4,indoor:true,dark:.15,darkOff:.72,weather:'flicker',
  textures:()=>[null,T_panel('#c9d3d8','#8794a0','#e7f0f5'),T_plaster('#b6c4c9','#6a7b84'),T_pipes('#9aa7ae','#4fd0b0','#2a3338'),T_hazard('#c3ced3','#3fd0a0','#26302f')],
  sky:['#7fa5a8','#1f3436'],ground:['#9aa8ad','#d7e2e6'],fog:'#2d4a4a',fogAmt:.5,fogDist:26,ambient:1.05,
  build:{buildings:10,wMin:4,wMax:6,hMin:4,hMax:6,cover:8,types:[1,1,2,3,4],coverTypes:[3,4]},
  mix:['grunt','runner','medic','grunt','sniper'],haz:{elec:3,toxic:3,unstable:2,barrels:1}},
 {env:'bunker',name:'Underground Bunker',where:'Shelter 7 · emergency power only',
  brief:'Long concrete halls and low ceilings. The lights are off and the generators are cold: use the wall panels or your flashlight [N], and listen for footsteps before you step into a corridor.',
  waves:4,indoor:true,dark:.5,darkOff:.88,startOff:true,
  textures:()=>[null,T_plaster('#6a6c68','#30322e'),T_pipes('#5a5d63','#9a7a3c','#222428'),T_panel('#4a5158','#262b30','#7e8790'),T_hazard('#555b61','#d9a53a','#202428')],
  sky:['#262b30','#101316'],ground:['#222629','#51585f'],fog:'#1d1f22',fogAmt:.6,fogDist:22,ambient:.98,
  build:{buildings:6,wMin:8,wMax:12,hMin:3,hMax:5,cover:5,types:[1,1,2,2,3],coverTypes:[3,4]},
  mix:['grunt','heavy','runner','grunt','sniper'],haz:{elec:2,toxic:1,unstable:3,barrels:2}},
 {env:'warehouse',name:'Industrial Warehouse',where:'Dock 14 distribution hall · after hours',
  brief:'Racking, forklifts and stacked pallets under half-dead floodlights. Fuel drums are everywhere — one stray round in the wrong place brings a shelf down on somebody.',
  waves:4,indoor:true,dark:.22,darkOff:.72,
  textures:()=>[null,T_corr('#7a6a4a'),T_panel('#5f6a72','#2f373d','#96a1a9'),T_plank('#8a6a3a','#3f2c18'),T_hazard('#6e7378','#e0b030','#26292c')],
  sky:['#3b4045','#15181b'],ground:['#3d4044','#7c8187'],fog:'#383b3e',fogAmt:.5,fogDist:28,ambient:1.04,
  build:{buildings:7,wMin:6,wMax:9,hMin:5,hMax:7,cover:16,types:[1,2,2,3,4],coverTypes:[3,2,4]},
  mix:['grunt','heavy','grunt','runner','heavy','sniper'],haz:{elec:2,toxic:1,unstable:3,barrels:5}},
 {env:'forest',name:'Forest Military Base',where:'Fort Alder perimeter · pre-dawn mist',
  brief:'Log huts and sandbag lines inside a belt of pines. Mist and rain hide movement, the swamp is toxic, and the guards on this perimeter are used to hearing foxes — not you.',
  waves:4,dark:.32,darkOff:.72,weather:'rain',
  textures:()=>[null,T_plank('#6d5638','#2f2417'),T_panel('#4b5a3f','#2a3324','#7e8f6b'),T_plaster('#59694c','#2c3724'),T_hazard('#55603f','#d8a23c','#2a3324')],
  sky:['#9fb89a','#33493a'],ground:['#3f5230','#6f8a4e'],fog:'#6f8a74',fogAmt:.62,fogDist:24,ambient:1.06,
  build:{buildings:8,wMin:4,wMax:7,hMin:4,hMax:6,cover:24,types:[1,2,2,3,4],coverTypes:[1,3]},
  mix:['grunt','runner','sniper','grunt','heavy','runner'],haz:{elec:1,toxic:3,unstable:2,barrels:3}},
 {env:'desert',name:'Desert Outpost',where:'Relay Station Karam · midday glare',
  brief:'Sun-bleached concrete, radio masts and wind-blown sand. Wide open sight-lines favour snipers; the fuel store is wired to blow and the old shelters are barely standing.',
  waves:4,dark:0,darkOff:.62,weather:'sand',
  textures:()=>[null,T_brick('#d0aa72','#8f6d3f'),T_plaster('#e0c08c','#9a7c52'),T_plank('#a9803f','#4f3a1c'),T_hazard('#d2b283','#d8742a','#6a583f')],
  sky:['#ecd7a8','#86aecb'],ground:['#b99a62','#e4c88c'],fog:'#e6cfa0',fogAmt:.42,fogDist:34,ambient:1.24,
  build:{buildings:6,wMin:5,wMax:8,hMin:4,hMax:6,cover:18,types:[1,2,2,3,4],coverTypes:[3,2]},
  mix:['grunt','sniper','runner','heavy','sniper','grunt'],haz:{elec:1,toxic:0,unstable:3,barrels:5}},
 {env:'city',name:'Abandoned City',where:'Meridian downtown · dusk, power grid down',
  brief:'Collapsed storefronts, dead traffic lights and fallen cables. Whole facades are one hit from coming down — use that on whoever is following you.',
  waves:5,dark:.22,darkOff:.68,weather:'rain',
  textures:()=>[null,T_scorch('#6f6a66','#2b2724'),T_brick('#7c5a4a','#2d211c'),T_plaster('#8a8780','#3a3834'),T_hazard('#6c6862','#d8a23c','#2a2724')],
  sky:['#c6805a','#2b2230'],ground:['#3b3836','#7b7873'],fog:'#8a5a4a',fogAmt:.55,fogDist:26,ambient:1.06,
  build:{buildings:12,wMin:4,wMax:6,hMin:4,hMax:6,cover:16,types:[1,2,2,3,4],coverTypes:[3,2,1]},
  mix:['heavy','grunt','runner','sniper','grunt','heavy'],haz:{elec:2,toxic:1,unstable:4,barrels:3}}
];
const baseLevelCount=LEVELS.length;
if(!LEVELS.some(l=>l.env)){ ENVS.forEach(e=>LEVELS.push(e)); }
try{ if(typeof buildLocationCards==='function'&&$('locGrid')){ buildLocationCards(); } }catch(e){}
/* keep the landing-page copy honest about the new location count */
try{
  const total=LEVELS.length, waves=LEVELS.reduce((n,l)=>n+(l.waves||0),0);
  const spans=document.querySelectorAll('.hero-meta span'); if(spans[0])spans[0].textContent=total; if(spans[2])spans[2].textContent=waves;
  const h=document.querySelector('#locations h2'); if(h)h.textContent=total+' places to lose ground.';
  const hp=document.querySelector('.hero-content > p:nth-of-type(2)'); if(hp)hp.innerHTML=hp.innerHTML.replace('Five locations','Eleven locations');
  const wp=document.querySelector('#winScreen .sub'); if(wp)wp.textContent='All '+total+' locations held. Extraction is inbound.';
}catch(e){}
/* enemies should not be tinted with the Ember District colour on the new maps */
const _levelTint=levelTint;
levelTint=function(){ try{ if(mode==='campaign'&&L&&L.env)return [1,1,1]; }catch(e){} return _levelTint(); };
const _setupWeather=setupWeather;
setupWeather=function(){ _setupWeather(); try{ if(mode==='campaign'&&!trainingOn&&L&&L.env&&L.weather)setWeather(L.weather,true); }catch(e){} };

/* ---- per-level state ---- */
let lvl=null, lightsOn=true, envMeshes=[], sealed=[], useQueued=false, promptTxt='', pingT=0;
const newLvl=()=>({doors:[],switches:[],vault:null,secret:null,unstable:{},elecs:[],toxics:[],hasKey:false,collapse:0});
lvl=newLvl();
function lightDark(){ const on=lightsOn; const d0=(L&&L.dark)||0, d1=(L&&L.darkOff)||Math.max(.5,d0+.2); return on?d0:d1; }
function applyLighting(){
  try{
    if(!scene||!L)return; const dk=lightDark();
    hemiLight.intensity=L.ambient*0.85*(1-.8*dk); ambientLight.intensity=L.ambient*0.32*(1-.75*dk);
    ceilLight.intensity=(L.indoor?.55:0)*(1-.45*dk);
    const sk=hex2rgb(L.sky[1]); scene.background.setRGB(sk[0]/255*(1-.85*dk),sk[1]/255*(1-.85*dk),sk[2]/255*(1-.85*dk));
    updateFog();
  }catch(e){}
}
const _updateFog=updateFog;
updateFog=function(){ _updateFog(); try{ if(scene&&scene.fog&&L){ const dk=lightDark(); if(dk>0)scene.fog.color.multiplyScalar(1-.8*dk); } }catch(e){} };
const _applyTheme=applyTheme;
applyTheme=function(){ _applyTheme(); applyLighting(); };

/* ---- helpers ---- */
const mapIdx=(x,y)=>y*MW+x;
function openCell(x,y){ return x>=1&&y>=1&&x<MW-1&&y<MH-1&&map[mapIdx(x,y)]===0; }
function randOpen(minC,maxC){
  const cx=MW/2,cy=MH/2;
  for(let i=0;i<300;i++){
    const x=2+((Math.random()*(MW-4))|0), y=2+((Math.random()*(MH-4))|0);
    if(!openCell(x,y)||inSealed(x+.5,y+.5))continue;
    const d=Math.hypot(x+.5-cx,y+.5-cy); if(d<(minC||0)||d>(maxC||999))continue;
    if(!openCell(x+1,y)||!openCell(x-1,y)||!openCell(x,y+1)||!openCell(x,y-1))continue;
    return {x:x+.5,y:y+.5};
  }
  return null;
}
function inSealed(x,y){ for(const r of sealed){ if(x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h)return true; } return false; }
function trackMesh(m){ enemyGroup.add(m); envMeshes.push(m); return m; }
function clearEnvMeshes(){ for(const m of envMeshes){ enemyGroup.remove(m); if(m.geometry)m.geometry.dispose(); if(m.material&&m.material.dispose)m.material.dispose(); } envMeshes=[]; }
function spawnLoot(t,x,y){ spawnPickup(t,x,y); const p=pickups[pickups.length-1]; if(p)p.life=1e9; return p; }
Object.assign(PK,{bp:[0xc77dff,'BLUEPRINT'],doc:[0xf5e6a8,'INTEL FILE'],att:[0x5fd0ff,'ATTACHMENT'],key:[0xff3b3b,'KEYCARD'],cache:[0xffd54a,'SUPPLY CACHE']});

/* ---- doors, vault, secret room, switches ---- */
function makeDoors(){
  if(mode==='laststand')return;
  const cand=[];
  for(let y=3;y<MH-3;y++)for(let x=3;x<MW-3;x++){
    if(map[mapIdx(x,y)]!==0)continue;
    const hz=solid(x-1,y)&&solid(x+1,y)&&!solid(x,y-1)&&!solid(x,y+1)&&!mapCover[mapIdx(x-1,y)]&&!mapCover[mapIdx(x+1,y)];
    const vt=solid(x,y-1)&&solid(x,y+1)&&!solid(x-1,y)&&!solid(x+1,y)&&!mapCover[mapIdx(x,y-1)]&&!mapCover[mapIdx(x,y+1)];
    if((hz||vt)&&Math.hypot(x+.5-MW/2,y+.5-MH/2)>5)cand.push({x,y});
  }
  cand.sort(()=>Math.random()-.5);
  for(const c of cand){
    if(lvl.doors.length>=3)break;
    if(lvl.doors.some(d=>Math.hypot(d.x-c.x,d.y-c.y)<7))continue;
    map[mapIdx(c.x,c.y)]=4; mapCover[mapIdx(c.x,c.y)]=0;
    lvl.doors.push({x:c.x,y:c.y,locked:false,open:false,kind:'door'});
  }
}
function findRect(w,h,margin,minC){
  for(let t=0;t<400;t++){
    const x=2+((Math.random()*(MW-w-4))|0), y=2+((Math.random()*(MH-h-4))|0);
    let ok=Math.hypot(x+w/2-MW/2,y+h/2-MH/2)>=minC;
    for(let yy=y-margin;ok&&yy<y+h+margin;yy++)for(let xx=x-margin;xx<x+w+margin;xx++){
      if(xx<1||yy<1||xx>=MW-1||yy>=MH-1||map[mapIdx(xx,yy)]!==0||inSealed(xx+.5,yy+.5)){ ok=false; break; }
    }
    if(ok)return {x,y};
  }
  return null;
}
function makeVault(kind){
  const r=findRect(5,5,1,mode==='laststand'?8:6)||findRect(5,5,0,4); if(!r)return null;
  const wt=(L.build&&L.build.types&&L.build.types[0])||1;
  for(let i=0;i<5;i++){ for(const [xx,yy] of [[r.x+i,r.y],[r.x+i,r.y+4],[r.x,r.y+i],[r.x+4,r.y+i]]){ map[mapIdx(xx,yy)]=wt; mapCover[mapIdx(xx,yy)]=0; } }
  const sides=[[r.x+2,r.y,0,-1],[r.x+2,r.y+4,0,1],[r.x,r.y+2,-1,0],[r.x+4,r.y+2,1,0]];
  const s=sides[(Math.random()*4)|0];
  const door={x:s[0],y:s[1],locked:kind==='locked',open:false,kind,secret:kind==='secret',cx:r.x+2.5,cy:r.y+2.5};
  map[mapIdx(door.x,door.y)]=kind==='locked'?4:wt;
  sealed.push({x:r.x+1,y:r.y+1,w:3,h:3});
  const v={door,room:r,opened:false};
  if(kind==='locked'){ lvl.vault=v; lvl.doors.push(door); } else { lvl.secret=v; }
  return v;
}
function makeSwitches(){
  for(let i=0;i<2;i++){ const p=randOpen(4,18); if(p)lvl.switches.push({x:p.x,y:p.y}); }
}
function placeKeycard(){
  if(!lvl.vault)return;
  const p=randOpen(8,40); if(p){ spawnLoot('key',p.x,p.y); }
}
function dropKeycardAt(x,y){ try{ if(lvl.vault&&!lvl.vault.opened&&!lvl.hasKey&&!trainingOn&&!pickups.some(p=>p.t==='key')){ spawnLoot('key',x,y); say('COMMANDER DROPPED A KEYCARD','#ff6a5a'); } }catch(e){} }

/* ---- hazards ---- */
function addBarrel(x,y){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(.32,.32,.85,10),new THREE.MeshLambertMaterial({color:0xb5402a}));
  m.position.set(x,.42,y); enemyGroup.add(m); barrels.push({x,y,hp:40,m,dead:false});
}
function makeHazards(){
  const h=(L&&L.haz)||{elec:1,toxic:1,unstable:2,barrels:0};
  if(mode==='laststand'&&!(L&&L.haz)){ h.elec=1; h.toxic=1; h.unstable=2; }
  for(let i=0;i<(h.barrels||0);i++){ const p=randOpen(4,40); if(p)addBarrel(p.x,p.y); }
  for(let i=0;i<(h.elec||0);i++){
    const p=randOpen(5,40); if(!p)continue;
    const post=trackMesh(new THREE.Mesh(new THREE.CylinderGeometry(.14,.2,1.15,8),new THREE.MeshLambertMaterial({color:0x2d3640,emissive:0x0a2a33})));
    post.position.set(p.x,.57,p.y);
    const g=new THREE.CircleGeometry(1.5,24); g.rotateX(-Math.PI/2);
    const ring=trackMesh(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x7fe9ff,transparent:true,opacity:.1,depthWrite:false})));
    ring.position.set(p.x,.04,p.y);
    lvl.elecs.push({x:p.x,y:p.y,r:1.5,ph:Math.random()*3.4,post,ring,tick:0,was:false});
  }
  for(let i=0;i<(h.toxic||0);i++){
    const p=randOpen(5,40); if(!p)continue;
    const g=new THREE.CircleGeometry(2.3,28); g.rotateX(-Math.PI/2);
    const m=trackMesh(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x6bff3a,transparent:true,opacity:.3,depthWrite:false})));
    m.position.set(p.x,.035,p.y);
    lvl.toxics.push({x:p.x,y:p.y,r:2.3,m,tick:0});
  }
  // unstable structures: some cover is already cracked and will come down when shot or blasted
  const covers=[]; for(let y=2;y<MH-2;y++)for(let x=2;x<MW-2;x++){ if(mapCover[mapIdx(x,y)]===1&&map[mapIdx(x,y)]>0){ const d=Math.hypot(x+.5-MW/2,y+.5-MH/2); if(d>5&&d<20)covers.push(mapIdx(x,y)); } }
  covers.sort(()=>Math.random()-.5);
  for(let i=0;i<Math.min(h.unstable||0,covers.length);i++)lvl.unstable[covers[i]]=true;
}
function environmentMoveScale(dt){
  for(const t of lvl.toxics){ if(Math.hypot(P.x-t.x,P.y-t.y)<t.r){ moveScale=Math.min(moveScale,.62); break; } }
  for(const e of lvl.elecs){ if(e.on&&Math.hypot(P.x-e.x,P.y-e.y)<e.r){ moveScale=Math.min(moveScale,.5); } }
}
function envFrame(dt){
  for(const e of lvl.elecs){
    const t=(time+e.ph)%3.4, active=t>2.3, warn=t>1.8&&!active;
    e.on=active;
    e.ring.material.opacity=active?.55+.35*Math.random():warn?(Math.random()<.5?.32:.06):.09;
    e.post.material.emissive.setHex(active?0x66e6ff:warn?0x1c6a7a:0x0a2a33);
    if(active&&!e.was){ try{ Audio_.burst({dur:.3,vol:.14,freq:2600,decay:.6}); }catch(_){} noise(e.x,e.y,9,'step'); }
    e.was=active;
    if(!active)continue;
    e.tick-=dt; if(e.tick>0)continue; e.tick=.35;
    if(P.alive&&Math.hypot(P.x-e.x,P.y-e.y)<e.r){ hurtPlayer(11,{x:e.x,y:e.y}); }
    for(const en of enemies){ if(!en.dead&&!en.dummy&&Math.hypot(en.x-e.x,en.y-e.y)<e.r){ en.hp-=32; en.hitFlash=.1; if(en.hp<=0&&!en.dead){ dmgSrcWeapon='hazard'; dmgSrcCause=''; killEnemy(en); } } }
  }
  for(const t of lvl.toxics){
    t.m.material.opacity=.22+Math.sin(time*2.4+t.x)*.08;
    t.tick-=dt; if(t.tick>0)continue; t.tick=.5;
    if(P.alive&&Math.hypot(P.x-t.x,P.y-t.y)<t.r){ hurtPlayer(3.2,{x:t.x,y:t.y}); }
    for(const en of enemies){ if(!en.dead&&!en.dummy&&!en.boss&&Math.hypot(en.x-t.x,en.y-t.y)<t.r){ en.hp-=4; if(en.hp<=0&&!en.dead){ dmgSrcWeapon='hazard'; dmgSrcCause=''; killEnemy(en); } } }
  }
}
const _damageCover=damageCover;
damageCover=function(cx,cy,dmg){ const idx=cy*MW+cx; return _damageCover(cx,cy,lvl&&lvl.unstable[idx]?dmg*3:dmg); };
const _destroyCover=destroyCover;
destroyCover=function(cx,cy){
  const idx=cy*MW+cx, was=lvl&&lvl.unstable[idx]&&mapCover[idx]===1;
  _destroyCover(cx,cy);
  if(!was)return;
  delete lvl.unstable[idx];
  const x=cx+.5,y=cy+.5;
  shake=Math.max(shake,1); try{ Audio_.burst({dur:.7,vol:.55,freq:140,decay:.8}); }catch(e){}
  noise(x,y,18,'boom');
  floatText(x,y,1.1,'COLLAPSE','crit');
  if(P.alive&&Math.hypot(P.x-x,P.y-y)<2.6)hurtPlayer(24,{x,y});
  for(const en of enemies){ if(!en.dead&&!en.dummy&&Math.hypot(en.x-x,en.y-y)<2.8){ en.hp-=75; en.hitFlash=.12; if(en.hp<=0&&!en.dead){ dmgSrcWeapon='hazard'; dmgSrcCause=''; killEnemy(en); } } }
  for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){ const j=(cy+yy)*MW+cx+xx; if((xx||yy)&&lvl.unstable[j]&&mapCover[j]===1)_damageCover(cx+xx,cy+yy,999); }   // chain reaction
};

/* ---- doors / use key ---- */
function openDoor(d,byEnemy){
  if(d.open)return; d.open=true; map[mapIdx(d.x,d.y)]=0; mapCover[mapIdx(d.x,d.y)]=0;
  rebuildWorldMeshes();
  try{ Audio_.burst({dur:.25,vol:.14,freq:210,decay:.6}); }catch(e){}
  noise(d.x+.5,d.y+.5,byEnemy?5:7,'step');
  if(d.kind==='locked'){ lvl.vault.opened=true; fillVault(['bp','cache','doc','att','armor'],true); say('VAULT OPENED','#ffd37a'); addXP(100); }
  else if(d.kind==='secret'){ lvl.secret.found=true; X.stats.secrets++; emit('secret'); addXP(150); fillVault(['doc','ammo','att','armor','cache'],false); say('SECRET ROOM DISCOVERED','#ffd37a'); }
}
function fillVault(types,rich){
  const v=rich?lvl.vault:lvl.secret; if(!v)return; const r=v.room;
  const spots=[[r.x+1.5,r.y+1.5],[r.x+3.5,r.y+1.5],[r.x+1.5,r.y+3.5],[r.x+3.5,r.y+3.5],[r.x+2.5,r.y+2.5]];
  types.forEach((t,i)=>{ const s=spots[i%spots.length]; spawnLoot(t,s[0],s[1]); });
}
function enemyDoorCheck(e){
  for(const d of lvl.doors){ if(!d.open&&!d.locked&&Math.hypot(e.x-(d.x+.5),e.y-(d.y+.5))<1.35)openDoor(d,true); }
}
function toggleLights(sw){
  lightsOn=!lightsOn; applyLighting(); rebuildWorldMeshes();
  try{ Audio_.tone({freq:lightsOn?900:420,dur:.08,vol:.14,type:'square'}); }catch(e){}
  noise(sw.x,sw.y,5,'step');
  say(lightsOn?'LIGHTS ON':'LIGHTS OFF — enemies see less, and so do you · [N] flashlight','#ffe9a8');
}
const _collect=collect;
collect=function(p){
  switch(p.t){
    case 'key':
      if(lvl.hasKey){ credits+=100; say('+100 CR','#ffd37a'); }
      else{ lvl.hasKey=true; say('KEYCARD ACQUIRED · find the locked vault (red door) and press [U]','#ff6a5a',3600); }
      break;
    case 'bp': grantBlueprint(true,guns[curGun]&&Math.random()<.5?guns[curGun].id:undefined); break;
    case 'doc': {
      const left=DOCS.filter((d,i)=>!X.docs.includes(i)); const idx=left.length?DOCS.indexOf(left[(Math.random()*left.length)|0]):(Math.random()*DOCS.length)|0;
      if(!X.docs.includes(idx))X.docs.push(idx); addXP(40); say('INTEL: '+DOCS[idx],'#f5e6a8',5200); break; }
    case 'att': grantAttachment(); break;
    case 'cache': credits+=450; score+=450; addXP(30); say('SUPPLY CACHE · +450 CR','#ffd54a'); break;
    default: return _collect(p);
  }
  try{ Audio_.tone({freq:700,slide:1200,dur:.12,vol:.15,type:'square'}); }catch(e){}
  updateHUD(); save();
};
function grantAttachment(){
  try{
    const g=guns[curGun], saved=lsAttachments(); const have=new Set(saved[g.id]||[]);
    const left=Object.keys(LS_ATTACHMENTS).filter(k=>!have.has(k));
    if(!left.length){ credits+=300; say('ATTACHMENTS COMPLETE · +300 CR','#5fd0ff'); return; }
    const id=left[(Math.random()*left.length)|0]; saved[g.id]=[...have,id]; ls.set('bp_attachments',saved);
    LS_ATTACHMENTS[id].apply(g); g.ammo=Math.min(g.mag,Math.max(g.ammo,0));
    say('ATTACHMENT FITTED · '+LS_ATTACHMENTS[id].name+' on '+g.name,'#5fd0ff',3200);
  }catch(e){ credits+=300; }
}
const DOCS=[
 'Maintenance log: someone propped the east door open on purpose. The cameras that faced it were turned to the wall.',
 'Shift note: if the lights go out, do not follow the sound of the generators — they are not running.',
 'Radio fragment: "Squad leader is carrying the only card. Take him down and the vault is ours."',
 'Supply memo: ammunition crates relocated behind the old panel. Knock twice, then search.',
 'Handwritten: the walls in B-block are hollow. We stored what we could not carry out.',
 'Field report: scouts hear everything. Crouch, stay off the sprint, and kill the lights.',
 'Safety bulletin: cracked masonry and drums do not mix. Keep your distance from both.',
 'Intercept: "If they raise the alarm, we send more. Cut the radio operator first."',
 'Engineer’s diary: the cables are live every few seconds. Count the beats, then run.',
 'Quartermaster: blueprints were split across three sites. One is always behind a locked door.'
];
function lightsHud(){}

/* ---- level setup (called after every level / last-stand start, and after terrain shifts) ---- */
function setupEnvironment(rebuild){
  clearEnvMeshes(); sealed=[];
  const prev=lvl; lvl=newLvl(); if(rebuild&&prev)lvl.hasKey=prev.hasKey;
  if(trainingOn||customArena){ rebuildWorldMeshes(); applyLighting(); return; }
  try{
    makeDoors();
    makeVault('locked'); makeVault('secret');
    makeSwitches(); makeHazards(); placeKeycard();
  }catch(err){ console.error('[Expansion:setupEnvironment]',err); }
  if(!rebuild)lightsOn=!(L&&L.startOff);
  rebuildWorldMeshes(); applyLighting();
}
const _rwm=rebuildWorldMeshes;
rebuildWorldMeshes=function(){
  _rwm();
  try{
    if(!lvl||!worldGroup)return;
    for(const d of lvl.doors){ if(d.open)continue;
      const m=new THREE.Mesh(new THREE.BoxGeometry(1.03,WALL_H*.86,1.03),new THREE.MeshLambertMaterial({color:d.locked?0x9b2222:0x5a7894,emissive:d.locked?0x520e0e:0x0e1c28}));
      m.position.set(d.x+.5,WALL_H*.43,d.y+.5); worldGroup.add(m); }
    for(const s of lvl.switches){
      const m=new THREE.Mesh(new THREE.BoxGeometry(.42,1.1,.3),new THREE.MeshLambertMaterial({color:0x2e353c,emissive:lightsOn?0x1c6a2c:0x6a1c1c}));
      m.position.set(s.x,.55,s.y); worldGroup.add(m); }
    for(const k of Object.keys(lvl.unstable)){ const i=+k; if(mapCover[i]!==1)continue;
      const m=new THREE.Mesh(new THREE.BoxGeometry(1.06,COVER_H+.06,1.06),new THREE.MeshBasicMaterial({color:0xff8a2a,transparent:true,opacity:.28,depthWrite:false}));
      m.position.set((i%MW)+.5,(COVER_H+.06)/2,((i/MW)|0)+.5); worldGroup.add(m); }
  }catch(e){}
};

/* ---- interaction ---- */
addEventListener('keydown',e=>{ if(!running||e.repeat)return; if(e.code==='KeyU'){ useQueued=true; e.preventDefault(); } if(e.code==='KeyN'){ toggleFlash(); e.preventDefault(); } });
function interactFrame(dt){
  pingT-=dt;
  let best=null,bd=9,label='';
  const rel=(x,y)=>{ const dx=x-P.x,dy=y-P.y,d=Math.hypot(dx,dy)||1; return {d,dot:(dx*P.dx+dy*P.dy)/d}; };
  for(const d of lvl.doors){ if(d.open)continue; const c=rel(d.x+.5,d.y+.5); if(c.d<1.9&&c.dot>.3&&c.d<bd){ bd=c.d; best={t:'door',o:d}; label=d.locked?(lvl.hasKey?'[U] USE KEYCARD':'LOCKED — KEYCARD REQUIRED'):'[U] OPEN DOOR'; } }
  const sd=lvl.secret&&!lvl.secret.found?lvl.secret.door:null;
  if(sd){ const c=rel(sd.x+.5,sd.y+.5);
    if(c.d<2&&c.dot>.35&&c.d<bd){ bd=c.d; best={t:'secret',o:sd}; label='HOLLOW WALL — [U] SEARCH'; }
    else if(c.d<4.2&&pingT<=0){ pingT=1.7; try{ Audio_.tone({freq:210,dur:.07,vol:.05,type:'sine'}); }catch(e){} } }
  for(const s of lvl.switches){ const c=rel(s.x,s.y); if(c.d<1.8&&c.dot>.15&&c.d<bd){ bd=c.d; best={t:'switch',o:s}; label=lightsOn?'[U] LIGHTS OFF':'[U] LIGHTS ON'; } }
  promptTxt=best?label:'';
  if(useQueued){
    useQueued=false;
    if(!best)return;
    if(best.t==='door'){ const d=best.o; if(d.locked){ if(lvl.hasKey){ lvl.hasKey=false; d.locked=false; openDoor(d); } else{ say('ACCESS DENIED · keycard required','#ff6a5a'); try{ Audio_.tone({freq:160,dur:.2,vol:.14,type:'sawtooth'}); }catch(e){} } } else openDoor(d); }
    else if(best.t==='secret'){ lvl.secret.door.kind='secret'; openDoor(lvl.secret.door); }
    else if(best.t==='switch')toggleLights(best.o);
  }
}

/* ---- 15. flashlight ---- */
let flashOn=false, flashBattery=100, flashLight=null, _fv=null;
function toggleFlash(){
  if(!flashOn&&flashBattery<8){ say('FLASHLIGHT BATTERY LOW','#ff8a4a'); return; }
  flashOn=!flashOn; try{ Audio_.tone({freq:flashOn?1100:700,dur:.05,vol:.1,type:'square'}); }catch(e){}
}
function flashFrame(dt){
  if(!flashLight&&typeof THREE.SpotLight==='function'&&scene){
    flashLight=new THREE.SpotLight(0xfff0d0,0,28,Math.PI/6.5,.5,1.3); scene.add(flashLight); scene.add(flashLight.target); _fv=new THREE.Vector3();
  }
  if(flashOn){ flashBattery=Math.max(0,flashBattery-dt*(100/120)); if(flashBattery<=0){ flashOn=false; say('FLASHLIGHT DEPLETED · recharging','#ff8a4a'); } }
  else flashBattery=Math.min(100,flashBattery+dt*(100/70));
  if(flashLight&&camera){
    const flick=flashBattery<15&&flashOn?(.55+.45*Math.sin(time*37)):1;
    flashLight.intensity=flashOn?2.6*flick:0;
    camera.getWorldDirection(_fv);
    flashLight.position.copy(camera.position);
    flashLight.target.position.set(camera.position.x+_fv.x*8,camera.position.y+_fv.y*8,camera.position.z+_fv.z*8);
  }
}

/* ---- minimap: doors, vault, switches, hazards, enemy awareness ---- */
const _drawMinimap=drawMinimap;
drawMinimap=function(){
  _drawMinimap();
  try{
    const S=mapC.width,R=9,cell=S/(R*2);
    const mk=(x,y,col,sz,shape)=>{ const dx=x-P.x,dy=y-P.y; if(Math.abs(dx)>R||Math.abs(dy)>R)return; mctx.fillStyle=col; const px=(dx+R)*cell,py=(dy+R)*cell;
      if(shape==='o'){ mctx.beginPath(); mctx.arc(px,py,sz,0,7); mctx.fill(); } else mctx.fillRect(px-sz/2,py-sz/2,sz,sz); };
    for(const d of lvl.doors){ if(!d.open)mk(d.x+.5,d.y+.5,d.locked?'#ff4a4a':'#7fb4e8',6); }
    for(const s of lvl.switches)mk(s.x,s.y,lightsOn?'#6fe08a':'#e07a6f',5);
    for(const e of lvl.elecs)mk(e.x,e.y,e.on?'#ffffff':'#7fe9ff',5,'o');
    for(const t of lvl.toxics){ const dx=t.x-P.x,dy=t.y-P.y; if(Math.abs(dx)<=R+2&&Math.abs(dy)<=R+2){ mctx.strokeStyle='rgba(107,255,58,.7)'; mctx.lineWidth=1.5; mctx.beginPath(); mctx.arc((dx+R)*cell,(dy+R)*cell,t.r*cell,0,7); mctx.stroke(); } }
    for(const k of Object.keys(lvl.unstable)){ const i=+k; if(mapCover[i]===1)mk((i%MW)+.5,((i/MW)|0)+.5,'#ff8a2a',5); }
    for(const e of enemies){
      if(e.dead||!e.aw||e.dummy)continue; const dx=e.x-P.x,dy=e.y-P.y; if(Math.abs(dx)>R||Math.abs(dy)>R)continue;
      const s=e.aw.state; if(s==='unaware')continue;
      mctx.strokeStyle=s==='combat'?'#ff3b30':s==='alerted'?'#ff9a3c':s==='suspicious'?'#ffe066':'#6fb0ff'; mctx.lineWidth=1.6;
      mctx.beginPath(); mctx.arc((dx+R)*cell,(dy+R)*cell,6.5,0,7); mctx.stroke();
    }
  }catch(e){}
};

/* ============================================================================
   HUD, indicators, per-frame hook, run wiring
   ============================================================================ */
let hudEl=null,promptEl=null,alarmEl=null,indEl=null,_pv=null,hudCache='';
const indMap=new Map();
function mkHud(){
  const st=$('stage')||document.body;
  hudEl=document.createElement('div'); hudEl.id='lsxHud'; st.appendChild(hudEl);
  promptEl=document.createElement('div'); promptEl.id='lsxPrompt'; st.appendChild(promptEl);
  alarmEl=document.createElement('div'); alarmEl.id='lsxAlarm'; st.appendChild(alarmEl);
  indEl=document.createElement('div'); indEl.id='lsxInd'; st.appendChild(indEl);
  if(!hitFx)mkFx();
}
const ICON={suspicious:['?','#ffe066'],alerted:['!','#ff9a3c'],combat:['!!','#ff3b30'],searching:['?','#6fb0ff']};
function hudFrame(){
  if(!hudEl)mkHud();
  const pr=prestigeInfo(X.prestige);
  const need=needXP(X.level), pct=X.level>=MAX_LEVEL?100:Math.round(X.xp/need*100);
  const html='<b>'+esc(title())+'</b> · LV '+X.level+' <i style="width:'+pct+'%"></i>'
    +(leanAbs()>.15?' · LEAN '+(leanAmt<0?'◀':'▶'):'')
    +(slideT>0?' · SLIDE':'')
    +' · <span class="'+(flashOn?'on':'')+'">LIGHT '+Math.round(flashBattery)+'%'+(flashOn?' ●':'')+'</span>'
    +(X.settings.adaptive?' · THREAT ×'+run.adapt.toFixed(2):'')
    +(lvl&&lvl.hasKey?' · <span class="on key">KEYCARD</span>':'');
  if(html!==hudCache){ hudCache=html; hudEl.innerHTML=html; }
  promptEl.textContent=promptTxt; promptEl.classList.toggle('on',!!promptTxt);
  if(alarm){ alarmEl.textContent='⚠ REINFORCEMENTS IN '+Math.max(0,alarm.t).toFixed(1)+'s — KILL THE RADIO OPERATOR'; alarmEl.classList.add('on'); } else alarmEl.classList.remove('on');
}
function indicatorFrame(){
  if(!indEl||!camera)return;
  if(!_pv)_pv=new THREE.Vector3();
  const seen=new Set();
  for(const e of enemies){
    if(e.dead||e.dummy||!e.aw||!awOn())continue;
    const st=e.aw.state, ic=ICON[st];
    const showMeter=st==='unaware'&&e.aw.meter>.08;
    if(!ic&&!showMeter)continue;
    const d=Math.hypot(e.x-P.x,e.y-P.y); if(d>34)continue;
    _pv.set(e.x,e.baseHeight*(e.scale>1.3?.98:1.06)+(e.hover||0)+.28,e.y).project(camera);
    let div=indMap.get(e.id);
    if(_pv.z>1||Math.abs(_pv.x)>1.1||Math.abs(_pv.y)>1.1){ if(div)div.style.display='none'; seen.add(e.id); continue; }
    if(!div){ div=document.createElement('div'); div.className='lsx-ind'; indEl.appendChild(div); indMap.set(e.id,div); }
    seen.add(e.id);
    div.style.display='block';
    div.style.left=((_pv.x+1)/2*100)+'%'; div.style.top=((1-_pv.y)/2*100)+'%';
    if(ic){ div.textContent=ic[0]; div.style.color=ic[1]; div.style.opacity=1; div.style.transform='translate(-50%,-100%) scale('+(st==='combat'?1.15:1)+')'; }
    else{ div.textContent='?'; div.style.color='#ffe066'; div.style.opacity=Math.min(1,e.aw.meter*1.6); div.style.transform='translate(-50%,-100%) scale('+(.6+e.aw.meter*.5)+')'; }
  }
  for(const [id,div] of indMap){ if(!seen.has(id)){ div.remove(); indMap.delete(id); } }
}
function clearIndicators(){ for(const [,d] of indMap)d.remove(); indMap.clear(); }

const _updateExtras=updateExtras;
updateExtras=function(dt){
  _updateExtras(dt);
  try{
    if(!P.alive)return;
    X.stats.survival+=dt; run.alive+=dt;
    lowHealthFx(dt); envFrame(dt); waveWatch(dt); hudFrame(); indicatorFrame();
    if((X.stats.survival|0)%15===0)save();
  }catch(err){ if(!safe.seen.hook){ safe.seen.hook=1; console.error('[Expansion:frame]',err); } }
};
setInterval(()=>{
  document.body.classList.toggle('lsx-ingame',!!running);
  if(!running){ if(!paused){ clearIndicators(); } if(promptEl)promptEl.classList.remove('on'); if(alarmEl)alarmEl.classList.remove('on'); if(lowFx)lowFx.style.opacity=0; const gl=$('glview'); if(gl)gl.style.filter=''; }
},400);

/* ---- run lifecycle ---- */
function resetRun(){
  run.shots=0; run.hits=0; run.dmgTaken=0; run.alive=0; run.waveStart=time;
  run.adapt=1+(typeof ngPlus==='number'?ngPlus:0)*.08;
  burst=0; recoilBank=0; leanAmt=0; leanTarget=0; slideT=0; slideCd=0; flashOn=false; flashBattery=100;
  alarm=null; alarmsThisWave=0; pressureT=0; wasInWave=false; clearIndicators();
}
const _newGame=newGame;
newGame=function(i){ resetRun(); applyCosmetics(); return _newGame(i); };
const _startLastStand=startLastStand;
const LS_BASE=Object.assign({},LAST_STAND);
function applyLastStandEnv(){
  const name=X.settings.lsEnv, env=ENVS.find(e=>e.name===name);
  for(const k of ['name','where','textures','sky','ground','fog','fogAmt','fogDist','ambient','dark','darkOff','startOff','haz','indoor','brief'])LAST_STAND[k]=LS_BASE[k];
  LAST_STAND.build=Object.assign({},LS_BASE.build);
  if(!env)return;
  Object.assign(LAST_STAND,{name:env.name,where:'Last Stand · '+env.where,textures:env.textures,sky:env.sky,ground:env.ground,fog:env.fog,fogAmt:env.fogAmt,fogDist:env.fogDist,ambient:env.ambient,dark:env.dark,darkOff:env.darkOff,startOff:env.startOff,haz:env.haz});
  LAST_STAND.build.types=env.build.types; LAST_STAND.build.coverTypes=env.build.coverTypes; LAST_STAND.indoor=false;
}
startLastStand=function(){ resetRun(); applyCosmetics(); try{ applyLastStandEnv(); }catch(e){} _startLastStand(); try{ setupEnvironment(false); }catch(e){ console.error(e); } };
const _startLevel=startLevel;
startLevel=function(){ alarm=null; alarmsThisWave=0; flashOn=false; _startLevel(); try{ setupEnvironment(false); }catch(e){ console.error(e); } };
const _resetGuns=resetGuns;
resetGuns=function(){ _resetGuns(); try{ applyBlueprints(); }catch(e){ console.error(e); } };
const _die=die;
die=function(){ try{ X.stats.deaths++; X.stats.longestRun=Math.max(X.stats.longestRun,run.alive); if(mode==='laststand')X.stats.bestLastStand=Math.max(X.stats.bestLastStand,wave); X.stats.bestWave=Math.max(X.stats.bestWave,wave); addXP(Math.round(wave*8)); save(true); }catch(e){} return _die(); };
const _levelClear=levelClear;
levelClear=function(){
  const was=running&&P.alive;
  const r=_levelClear();
  try{ if(was){ X.stats.missions++; emit('mission'); addXP(250+levelIndex*30); X.stats.longestRun=Math.max(X.stats.longestRun,run.alive); if(levelIndex>=LEVELS.length-1||dailyRun){ addXP(1000); const bp=grantBlueprint(true); if(ngPlus>0)addXP(500*ngPlus); } save(true); } }catch(e){}
  return r;
};

/* ---- 20. New Game Plus carry-over ---- */
const CARRY=[['dmg','Combat upgrades','Keep damage bonuses and movement speed'],['ammo','Full supplies','Start with every reserve maxed'],['armor','Armour & grenades','Start with plates and a full grenade belt'],['health','Hardened','+25 maximum health']];
function openNgCarry(go){
  const old=$('lsxNg'); if(old)old.remove();
  const s=document.createElement('div'); s.id='lsxNg'; s.className='lsx20-backdrop on';
  s.innerHTML='<section class="lsx20-panel" style="max-width:560px"><header><div><small>NEW GAME +</small><h2>Choose what you carry over</h2><p>Your weapons, blueprints, attachments, cosmetics and prestige are always kept. Pick up to two bonuses for NG+ '+(ngPlus+1)+'. Enemies will be tougher and smarter.</p></div></header><div class="lsx2-list" id="lsxNgList">'
    +CARRY.map(c=>'<label class="lsx2-row"><input type="checkbox" data-c="'+c[0]+'"> <b>'+c[1]+'</b><small>'+c[2]+'</small></label>').join('')
    +'</div><div class="lsx2-actions"><button id="lsxNgGo">START NG+</button><button id="lsxNgCancel">CANCEL</button></div></section>';
  document.body.appendChild(s);
  const boxes=[...s.querySelectorAll('input')];
  boxes.forEach(b=>b.onchange=()=>{ if(boxes.filter(x=>x.checked).length>2)b.checked=false; });
  $('lsxNgCancel').onclick=()=>s.remove();
  $('lsxNgGo').onclick=()=>{ const sel=boxes.filter(x=>x.checked).map(x=>x.dataset.c); s.remove(); go(sel); };
}
if($('ngBtn'))$('ngBtn').addEventListener('click',e=>{
  e.stopImmediatePropagation(); e.preventDefault();
  openNgCarry(sel=>{
    const snap={dmg:dmgMul,sp:P.speed,nade:nadeCount,armor:P.armor||0};
    Audio_.init(); ngPlus++; dailyRun=false; trainingOn=false; newGame(0);
    try{
      if(sel.includes('dmg')){ dmgMul=Math.max(dmgMul,snap.dmg); P.speed=Math.max(P.speed,snap.sp); }
      if(sel.includes('ammo'))guns.forEach(g=>{ g.res=g.maxRes; });
      if(sel.includes('armor')){ P.armor=Math.max(P.armor||0,Math.min(armorMax(),Math.max(30,snap.armor))); nadeCount=Math.max(nadeCount,snap.nade,5); }
      if(sel.includes('health')){ P.maxHealth+=25; P.health=P.maxHealth; }
      updateHUD();
    }catch(err){}
    setTimeout(()=>toast('NEW GAME+ '+ngPlus+' — tougher, smarter enemies · progress kept'),2400);
  });
},true);

/* ============================================================================
   16–20  PROGRESSION PANEL (profile, challenges, blueprints, records, settings)
   ============================================================================ */
const SYSTEMS=[
 ['01','Weapon recoil & sway','Combat','Every weapon has its own recoil pattern; holding the trigger builds recoil and spread; aiming (right-click / Z) cuts sway.'],
 ['02','Tactical reloading','Combat','Reload (R) with rounds left to swap mags faster and keep one chambered (+1). Empty reloads are slower. Each weapon has its own reload animation.'],
 ['03','Lean & peek','Combat','Hold [ or ] to lean around corners. You see (and shoot) from the leaned spot — but enemies can see the part of you that sticks out.'],
 ['04','Sprint · crouch · slide','Combat','Shift sprints, C crouches (harder to spot). Press C while sprinting to slide into cover.'],
 ['05','Damage feedback','Combat','Directional arrows (blue = armour, red = health), armour-break warnings, flinch on flesh hits, and a desaturating pulse when low on health.'],
 ['06','Enemy awareness','Enemy AI','Enemies cycle through Unaware, Suspicious (?), Alerted (!), Combat and Searching. Crouch, stay quiet and use the dark to stay unseen.'],
 ['07','Enemy communication','Enemy AI','When one enemy spots you, nearby allies are alerted and converge. Commanders shout farther.'],
 ['08','Enemy classes','Enemy AI','Assault, Sniper, Heavy (armoured), Medic (heals), Scout (sees farther), Commander (buffs and coordinates nearby enemies).'],
 ['09','Dynamic reinforcements','Enemy AI','Spotting enemies may raise an alarm. Kill the radio operator before the countdown ends or reinforcements arrive.'],
 ['10','Adaptive difficulty','Enemy AI','Enemy health, accuracy and aggression scale with how well you play. Can be switched off in Settings.'],
 ['11','Map environments','World','Laboratory, Bunker, Warehouse, Forest Base, Desert Outpost and Abandoned City are in the campaign, and selectable for Last Stand.'],
 ['12','Secret rooms & loot','World','Hollow walls hide rooms with ammo, attachments, intel files and blueprints. Listen for the faint ping near them and press U.'],
 ['13','Doors & keycards','World','Press U to open doors. Red vault doors need a keycard — found on the map or dropped by Commanders.'],
 ['14','Environmental hazards','World','Electric arcs (timed), toxic pools, unstable cover that collapses when shot, and explosive barrels.'],
 ['15','Dynamic lighting','World','Press U at wall panels to switch the lights, N for the flashlight (battery recharges when off). Darkness hides you — and your light gives you away.'],
 ['16','Prestige','Progression','Reach level '+MAX_LEVEL+', then prestige for a new title, badge and cosmetic crosshair / weapon finish.'],
 ['17','Weapon blueprints','Progression','Find blueprints in vaults, from Commanders, bosses and weekly challenges. Each gives a special finish and stat configuration.'],
 ['18','Daily & weekly challenges','Progression','New objectives every day and week. Rewards: XP and blueprints.'],
 ['19','Personal records','Progression','Kills, headshot %, accuracy, missions, survival time, favourite weapon and best wave — saved on this device.'],
 ['20','New Game Plus','Progression','Finish the campaign, then replay with tougher enemies. Choose bonuses to carry over; blueprints and prestige always stay.']
];
let panelTab='systems';
const fmtT=s=>{ s=Math.floor(s); const h=(s/3600)|0, m=((s%3600)/60)|0; return h?h+'h '+m+'m':m+'m '+(s%60)+'s'; };
const WNAME={rifle:'MK-4 CARBINE',shotgun:'M90 BREACHER',pistol:'P-17 SIDEARM',smg:'V-9 SMG',sniper:'LR-50 SNIPER',nade:'GRENADES',melee:'MELEE',hazard:'HAZARDS'};
function favWeapon(){ const k=Object.entries(X.stats.weaponKills).sort((a,b)=>b[1]-a[1])[0]||Object.entries(X.stats.weaponShots).sort((a,b)=>b[1]-a[1])[0]; return k?(WNAME[k[0]]||k[0]):'—'; }
function panelHTML(){
  refreshChallenges();
  const s=X.stats, acc=s.shots?Math.round(s.hits/s.shots*100):0, hs=s.hits?Math.round(s.headshots/s.hits*100):0, p=prestigeInfo(X.prestige);
  const head='<div class="lsx20-stats"><div><b>'+X.level+'</b><span>LEVEL</span></div><div><b>'+(X.level>=MAX_LEVEL?'MAX':X.xp+'/'+needXP(X.level))+'</b><span>XP</span></div><div><b>'+(p.badge||'—')+' '+X.prestige+'</b><span>PRESTIGE</span></div><div><b>'+X.blueprints.length+'/'+BLUEPRINTS.length+'</b><span>BLUEPRINTS</span></div><div><b>'+s.missions+'</b><span>MISSIONS</span></div></div>';
  const tabs=[['systems','20 SYSTEMS'],['profile','PROFILE'],['challenges','CHALLENGES'],['blueprints','BLUEPRINTS'],['records','RECORDS'],['settings','SETTINGS']];
  let body='';
  if(panelTab==='systems'){
    body='<div class="lsx20-cards">'+SYSTEMS.map(f=>'<article class="lsx20-card"><div class="num">'+f[0]+'</div><div><small>'+f[2]+'</small><h3>'+f[1]+'</h3><p>'+f[3]+'</p></div><span class="status ready">LIVE</span></article>').join('')+'</div>'
      +'<p class="lsx20-note"><b>Keys:</b> [ ] lean · C (while sprinting) slide · U use / open / search · N flashlight · R reload · Shift sprint · C crouch</p>';
  } else if(panelTab==='profile'){
    const next=PRESTIGE[Math.min(X.prestige+1,PRESTIGE.length-1)];
    body='<div class="lsx2-box"><h3>'+esc(title())+' · Level '+X.level+'</h3><div class="lsx2-bar"><i style="width:'+(X.level>=MAX_LEVEL?100:Math.round(X.xp/needXP(X.level)*100))+'%"></i></div>'
      +'<p>XP comes from kills, headshots, waves, missions, secrets, intel and challenges. '+(X.level>=MAX_LEVEL?'<b>You are at max level — prestige to reset your level and unlock: '+esc(next.title)+' — '+esc(next.cos)+'.</b>':'Reach level '+MAX_LEVEL+' to unlock Prestige.')+'</p>'
      +'<div class="lsx2-actions"><button id="lsxPrestige" '+(X.level>=MAX_LEVEL?'':'disabled')+'>PRESTIGE'+(X.level>=MAX_LEVEL?' → '+esc(next.title):'')+'</button></div></div>'
      +'<div class="lsx2-box"><h3>Cosmetics</h3><label>Crosshair colour <select id="lsxHue"><option value="">Default</option>'+PRESTIGE.slice(1,X.prestige+1).map(q=>q.hue!==null?'<option value="'+q.hue+'" '+(String(X.cosmetic.hue)===String(q.hue)?'selected':'')+'>'+q.title+' ('+q.cos.split(' + ')[0]+')</option>':'').join('')+'</select></label>'
      +'<label class="lsx20-check"><input type="checkbox" id="lsxFinish" '+(X.cosmetic.finish?'checked':'')+'> Show weapon finishes (blueprints / prestige)</label>'
      +'<p class="lsx20-note">Prestige unlocks: '+PRESTIGE.slice(1).map((q,i)=>(i+1<=X.prestige?'✔ ':'· ')+q.title).join(' &nbsp; ')+'</p></div>';
  } else if(panelTab==='challenges'){
    const row=(c,kind)=>{ const d=chDef(c.id), goal=kind==='d'?d.d:d.w; return '<div class="lsx2-row '+(c.done?'done':'')+'"><b>'+esc(d.text.replace('{n}',goal))+'</b><small>'+(kind==='d'?'+300 XP':'+1500 XP + blueprint')+'</small><div class="lsx2-bar"><i style="width:'+Math.round(c.prog/goal*100)+'%"></i></div><span>'+c.prog+' / '+goal+(c.done?' ✔':'')+'</span></div>'; };
    body='<div class="lsx2-box"><h3>Daily — resets at midnight</h3>'+X.daily.list.map(c=>row(c,'d')).join('')+'</div><div class="lsx2-box"><h3>Weekly — resets Monday</h3>'+X.weekly.list.map(c=>row(c,'w')).join('')+'</div>';
  } else if(panelTab==='blueprints'){
    body='<p class="lsx20-note">Equip one blueprint per weapon. It changes the gun’s finish and stats from the next deployment.</p><div class="lsx20-cards">'+BLUEPRINTS.map(b=>{ const have=X.blueprints.includes(b.id), eq=X.equipped[b.w]===b.id;
      return '<article class="lsx20-card '+(have?'':'locked')+'"><div class="num" style="color:hsl('+b.hue+',80%,62%)">◆</div><div><small>'+(WNAME[b.w]||b.w)+'</small><h3>'+b.name+'</h3><p>'+(have?b.desc:'Not found yet — search vaults, secret rooms, Commanders and bosses.')+'</p></div>'+(have?'<button data-bp="'+b.id+'" class="'+(eq?'on':'')+'">'+(eq?'EQUIPPED':'EQUIP')+'</button>':'<span class="status planned">LOCKED</span>')+'</article>'; }).join('')+'</div>'
      +'<p class="lsx20-note">Intel files collected: '+X.docs.length+' / '+DOCS.length+'</p>';
  } else if(panelTab==='records'){
    const rec=[['Total kills',s.kills.toLocaleString()],['Headshot %',hs+'%  ('+s.headshots+')'],['Accuracy',acc+'%  ('+s.hits+'/'+s.shots+')'],['Missions completed',s.missions],['Total survival time',fmtT(s.survival)],['Longest single run',fmtT(s.longestRun)],['Favourite weapon',favWeapon()],['Highest wave',Math.max(s.bestWave,s.bestLastStand)],['Best Last Stand wave',s.bestLastStand],['Stealth takedowns',s.stealthKills],['Tactical reloads',s.tacReloads],['Slides',s.slides],['Secret rooms found',s.secrets],['Deaths',s.deaths]];
    body='<div class="lsx2-rec">'+rec.map(r=>'<div><span>'+r[0]+'</span><b>'+r[1]+'</b></div>').join('')+'</div>';
  } else {
    body='<div class="lsx2-box"><h3>Gameplay</h3>'
      +'<label class="lsx20-check"><input type="checkbox" id="lsxAdapt" '+(X.settings.adaptive?'checked':'')+'> Adaptive difficulty (enemies scale with your performance)</label>'
      +'<label class="lsx20-check"><input type="checkbox" id="lsxAware" '+(X.settings.awareness?'checked':'')+'> Enemy awareness (patrol / investigate / search). Off = classic “everyone hunts you”.</label>'
      +'<label>Last Stand environment <select id="lsxEnv"><option>Open Ground</option>'+ENVS.map(e=>'<option '+(X.settings.lsEnv===e.name?'selected':'')+'>'+e.name+'</option>').join('')+'</select></label>'
      +'<p class="lsx20-note">Campaign locations 6–11 are the new environments; pick any location in Mission Select.</p></div>'
      +'<div class="lsx2-actions"><button id="lsxExport">EXPORT SAVE</button><label class="lsx20-import">IMPORT SAVE<input id="lsxImport" type="file" accept="application/json"></label><button id="lsxReset" class="danger">RESET EXPANSION SAVE</button></div>';
  }
  return '<section class="lsx20-panel" role="dialog" aria-modal="true"><header><div><small>LAST SECTOR // FIELD SYSTEMS</small><h2>20-FEATURE EXPANSION</h2><p>All systems are live in-game · profile saved on this device</p></div><button id="lsx20Close" aria-label="Close">✕</button></header>'
    +head+'<nav class="lsx20-tabs">'+tabs.map(t=>'<button data-tab="'+t[0]+'" class="'+(panelTab===t[0]?'active':'')+'">'+t[1]+'</button>').join('')+'</nav>'+body+'</section>';
}
function renderPanel(){
  const root=$('lsx20'); if(!root)return;
  root.innerHTML=panelHTML();
  root.querySelector('#lsx20Close').onclick=closePanel;
  root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{ panelTab=b.dataset.tab; renderPanel(); });
  root.querySelectorAll('[data-bp]').forEach(b=>b.onclick=()=>{ const d=bpDef(b.dataset.bp); X.equipped[d.w]=d.id; save(true); renderPanel(); });
  const on=(id,fn,ev)=>{ const n=root.querySelector('#'+id); if(n)n[ev||'onclick']=fn; };
  on('lsxPrestige',()=>{ if(doPrestige())renderPanel(); });
  on('lsxHue',e=>{ X.cosmetic.hue=e.target.value===''?null:+e.target.value; save(true); applyCosmetics(); if(X.cosmetic.hue===null&&typeof gfx!=='undefined')gfx.chHue=360; },'onchange');
  on('lsxFinish',e=>{ X.cosmetic.finish=e.target.checked; save(true); },'onchange');
  on('lsxAdapt',e=>{ X.settings.adaptive=e.target.checked; if(!e.target.checked)run.adapt=1; save(true); },'onchange');
  on('lsxAware',e=>{ X.settings.awareness=e.target.checked; if(!e.target.checked)for(const en of enemies)if(en.aw)en.aw.state='combat'; save(true); },'onchange');
  on('lsxEnv',e=>{ X.settings.lsEnv=e.target.value; save(true); },'onchange');
  on('lsxExport',()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(X,null,2)],{type:'application/json'})); a.download='last-sector-expansion-save.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); });
  on('lsxImport',async e=>{ try{ X=merge(defaults(),JSON.parse(await e.target.files[0].text())); refreshChallenges(); save(true); applyCosmetics(); say('Save imported','#7fe0a0'); renderPanel(); }catch(err){ say('Invalid save file','#ff8a4a'); } },'onchange');
  on('lsxReset',()=>{ if(confirm('Reset all expansion profile data (level, prestige, blueprints, records)?')){ X=defaults(); refreshChallenges(); save(true); renderPanel(); } });
}
function openPanel(tab){ if(tab)panelTab=tab; let root=$('lsx20'); if(!root){ root=document.createElement('div'); root.id='lsx20'; root.className='lsx20-backdrop'; root.addEventListener('mousedown',e=>{ if(e.target===root)closePanel(); }); document.body.appendChild(root); } try{ document.exitPointerLock&&document.exitPointerLock(); }catch(e){} renderPanel(); root.classList.add('on'); }
function closePanel(){ const r=$('lsx20'); if(r)r.classList.remove('on'); }
LSX.open=openPanel;
addEventListener('keydown',e=>{ if(e.code==='Escape'){ const r=$('lsx20'); if(r&&r.classList.contains('on')){ closePanel(); e.stopImmediatePropagation(); } } },true);

function installUI(){
  if(!$('lsx20Open')){
    const b=document.createElement('button'); b.id='lsx20Open'; b.className='lsx20-open'; b.type='button'; b.innerHTML='✦ EXPANSION'; b.title='20-feature expansion: profile, challenges, blueprints, records';
    b.addEventListener('click',()=>openPanel()); document.body.appendChild(b);
  }
  const pp=document.querySelector('#pauseScreen .panel');
  if(pp&&!$('lsxPauseBtn')){
    const b=document.createElement('button'); b.id='lsxPauseBtn'; b.className='cta'; b.type='button'; b.textContent='Expansion · profile & challenges';
    b.style.cssText='margin-top:10px;background:transparent;border:1px solid var(--signal);color:var(--signal)'; b.addEventListener('click',()=>openPanel('profile'));
    const quit=$('quitBtn'); if(quit)pp.insertBefore(b,quit); else pp.appendChild(b);
  }
  const kg=document.querySelector('.keys-grid');
  if(kg&&!kg.querySelector('[data-lsx]')){
    [['[ ]','Lean left / right'],['C','(sprinting) Slide'],['U','Use door / switch / search'],['N','Flashlight']].forEach(k=>{ const li=document.createElement('li'); li.dataset.lsx='1'; li.innerHTML='<kbd>'+esc(k[0])+'</kbd> '+esc(k[1]); kg.appendChild(li); });
  }
}
installUI(); applyCosmetics();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installUI);
setInterval(installUI,2500);

LSX.state=()=>({X,run,lvl,alarm,flashOn,flashBattery,lightsOn,burst,leanAmt,slideT});
console.info('[Last Sector] 20-feature expansion v2 installed');
})();
