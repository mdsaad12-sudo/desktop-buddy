'use strict';
/* =====================================================================
   Desktop Buddy — Hometown engine v3 (shared by docked + wallpaper pages)
   640x360 scene → 3x @1080p, 4x @1440p, 6x @4K (crisp integer scaling)
   Real-time day cycle (sunrise/sunset) + real weather (Open-Meteo)
   ===================================================================== */
const TW=640, TH=360;
const WALL=document.body.dataset.mode==='wallpaper';          // real wallpaper: live agent data, 30 fps
const AGENT=location.protocol==='file:'?'http://127.0.0.1:8770':''; // the agent serves this page
const FPS_CAP=WALL?30:0;
const view=document.getElementById('view');
const vctx=view.getContext('2d');
function mk(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w));c.height=Math.max(1,Math.ceil(h));return [c,c.getContext('2d')];}
const [scC,sc]=mk(TW,TH);      // final composed frame
const [wlC,ctx]=mk(TW,TH);     // world layer (tinted by daylight/weather)
const [mkC,mkx]=mk(TW,TH);     // alpha mask helper
let upC=null,upX=null,BLIT={s:1,ox:0,oy:0};

/* ---------- utils ---------- */
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const R=(c,x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));};
function disc(c,cx,cy,r,col){r=Math.round(r);cx=Math.round(cx);cy=Math.round(cy);c.fillStyle=col;for(let dy=-r;dy<=r;dy++){const w=Math.round(Math.sqrt(Math.max(0,r*r-dy*dy)));c.fillRect(cx-w,cy+dy,w*2+1,1);}}
function oval(c,cx,cy,rx,ry,col){c.fillStyle=col;for(let dy=-ry;dy<=ry;dy++){const w=Math.round(rx*Math.sqrt(Math.max(0,1-(dy*dy)/(ry*ry))));c.fillRect(Math.round(cx-w),Math.round(cy+dy),w*2+1,1);}}
const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const hx=h=>{const n=parseInt(h.slice(1),16);return[n>>16&255,n>>8&255,n&255];};
const toHex=a=>'#'+a.map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');
const mix=(a,b,t)=>{const A=hx(a),B=hx(b);return toHex(A.map((v,i)=>lerp(v,B[i],t)));};
const mulHex=(a,b)=>{const A=hx(a),B=hx(b);return toHex(A.map((v,i)=>v*B[i]/255));};
const _sh={},_li={};
const shade=c=>_sh[c]||(_sh[c]=mix(c,'#000000',0.28));
const lighten=c=>_li[c]||(_li[c]=mix(c,'#ffffff',0.25));
const pick=a=>a[Math.floor(Math.random()*a.length)];
const pk=(r,a)=>a[Math.floor(r()*a.length)];
const fmt=m=>{m=((Math.floor(m)%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

/* ---------- glyphs & bubbles ---------- */
const GL={
  '!':['1','1','1','0','1'],'?':['111','001','011','000','010'],dots:['10101'],
  heart:['01010','11111','11111','01110','00100'],note:['0110','0101','0100','1100','1100'],
  z:['1111','0010','0100','1111'],mail:['11111','11011','10101','10001','11111'],
  idea:['0110','1111','1111','0110','0110'],coin:['0110','1101','1101','0110'],
};
const BCOL={'!':'#d63a2f','?':'#3a6ab0',dots:'#3a3a4a',heart:'#e0457a',note:'#7a4ad0',idea:'#d89a00'};
function glyph(c,g,x,y,col){c.fillStyle=col;for(let j=0;j<g.length;j++)for(let i=0;i<g[j].length;i++)if(g[j][i]==='1')c.fillRect(x+i,y+j,1,1);}
function bubble(c,x,y,g,col){
  const w=g[0].length+4,h=g.length+4,bx=Math.round(x-w/2),by=Math.round(y-h),mx=Math.round(x);
  c.fillStyle='#231a2a';c.fillRect(bx-1,by,w+2,h);c.fillRect(bx,by-1,w,h+2);
  c.fillStyle='#fffaf0';c.fillRect(bx,by,w,h);c.fillRect(mx-1,by+h,2,1);
  c.fillStyle='#231a2a';c.fillRect(mx-2,by+h,1,1);c.fillRect(mx+1,by+h,1,1);c.fillRect(mx-1,by+h+1,2,1);
  glyph(c,g,bx+2,by+2,col);
}

/* =====================================================================
   MAP — walk graph
   ===================================================================== */
const N={
  A:{x:6,y:160},B:{x:95,y:160},C:{x:160,y:160},D:{x:230,y:160},E:{x:280,y:160},F:{x:337,y:160},G:{x:432,y:160},I:{x:520,y:160},J:{x:604,y:160},H:{x:634,y:160},
  FW:{x:103,y:151,j:0,face:1},SH:{x:230,y:131,j:0,z:143.5},INN:{x:337,y:146,j:.6},STG:{x:433,y:126,j:0,z:145},AUD:{x:432,y:172,j:1.6},
  DJ:{x:532,y:151,j:0,face:1},LB:{x:607,y:150,j:0},
  P:{x:280,y:198,j:1.3},WL:{x:268,y:211,j:0,face:-1},Q:{x:205,y:240,j:0},R:{x:280,y:242},S:{x:355,y:240,j:0},T:{x:412,y:242},
  U:{x:500,y:242,j:1.2},MK:{x:540,y:240,j:0},K:{x:604,y:242},K2:{x:604,y:296},
  L:{x:140,y:186,j:.5,z:189},M:{x:80,y:212,j:0,face:1},NT:{x:446,y:225,j:1},
  BL:{x:6,y:332},BB:{x:147,y:332},B1:{x:200,y:332},B2:{x:280,y:332},B3:{x:392,y:332},B4:{x:476,y:332},BR:{x:604,y:332},BE:{x:634,y:332},
  HM1:{x:196,y:321,j:0},HM2:{x:244,y:321,j:0},HM3:{x:322,y:321,j:0},
  AT:{x:396,y:329,j:0,face:1},TEA:{x:523,y:320,j:.6,z:322},OS:{x:566,y:298,j:1},
  /* benches (sit + nap spots): y = bench base - 2, z = base + 1 */
  BN1:{x:297,y:230,j:.5,z:233},BN2:{x:360,y:260,j:.5,z:263},BN3:{x:470,y:260,j:.5,z:263},BN4:{x:230,y:262,j:.5,z:265},BN5:{x:40,y:240,j:.5,z:243},
};
const EDGES=[
  ['A','B',14],['B','C',14],['C','D',14],['D','E',14],['E','F',14],['F','G',14],['G','I',14],['I','J',14],['J','H',14],
  ['B','FW',8],['D','SH',10],['F','INN',8],['G','STG',8],['G','AUD',0],['I','DJ',8],['J','LB',8],
  ['E','P',10],['P','R',10],['R','Q',10],['R','S',10],['S','T',10],['T','U',10],['U','K',10],['U','MK',0],['MK','K',0],
  ['J','K',10],['K','K2',10],['K2','BR',10],['T','NT',0],['G','NT',0],
  ['C','L',0],['L','M',0],['P','WL',0],['R','B2',10],
  ['BL','BB',12],['BB','B1',12],['B1','B2',12],['B2','B3',12],['B3','B4',12],['B4','BR',12],['BR','BE',12],
  ['B1','HM1',0],['B1','HM2',0],['B2','HM2',0],['B2','HM3',0],['B3','HM3',0],['B3','AT',0],['B4','TEA',0],['BR','TEA',0],['K2','OS',0],
  ['P','BN1',0],['R','BN1',0],['S','BN2',0],['T','BN3',0],['U','BN3',0],['Q','BN4',0],['R','BN4',0],['M','BN5',0],
];
const ADJ={};for(const k in N)ADJ[k]=[];
for(const [a,b] of EDGES){ADJ[a].push(b);ADJ[b].push(a);}
function route(a,b){
  if(a===b)return [];
  const dist={},prev={},open=new Set(Object.keys(N));
  for(const k in N)dist[k]=Infinity;dist[a]=0;
  while(open.size){
    let u=null;for(const k of open)if(u===null||dist[k]<dist[u])u=k;
    open.delete(u);if(u===b||dist[u]===Infinity)break;
    for(const v of ADJ[u]){const d=dist[u]+Math.hypot(N[u].x-N[v].x,N[u].y-N[v].y);if(d<dist[v]){dist[v]=d;prev[v]=u;}}
  }
  const out=[];let k=b;while(k&&k!==a){out.unshift(k);k=prev[k];}
  return k===a?out:[b];
}

/* =====================================================================
   BACKGROUND (transparent sky — sky is drawn live each frame)
   ===================================================================== */
const RIV=[[-10,200],[20,206],[50,214],[78,228],[100,245],[116,262],[126,284],[134,306],[146,330],[160,352],[168,374]];
const [bgC,bg]=mk(TW,TH);
const WATER_PTS=[],STARS=[];
function stampLine(c,a,b,r){const L=Math.hypot(b.x-a.x,b.y-a.y)||1;for(let s=0;s<=L;s+=1){c.beginPath();c.arc(lerp(a.x,b.x,s/L),lerp(a.y,b.y,s/L),r,0,Math.PI*2);c.fill();}}
function renderBG(){
  const r=rng(42);
  const pillar=(x,top,w,col,sh,leaf)=>{
    for(let y=top;y<108;y++){const k=Math.min(1,(y-top)/5);const ww=Math.round(w*(.6+.4*k)+(y-top)*.1);R(bg,x-ww/2,y,ww,1,col);const s=Math.max(2,Math.round(ww*.28));R(bg,x+ww/2-s,y,s,1,sh);}
    for(let i=0;i<w;i++)disc(bg,x-w/2+r()*w,top+1+r()*7,1+Math.floor(r()*2),leaf);
    for(let i=0;i<w/3;i++)disc(bg,x-w/2+r()*w,top+12+r()*60,1,leaf);
  };
  [[18,34,34],[66,48,26],[132,24,40],[300,40,30],[362,20,46],[452,36,38],[528,28,42],[600,42,34]].forEach(([x,t,w])=>pillar(x,t,w,'#a6cfc0','#90bdaf','#8cbf9c'));
  [[96,54,30],[186,60,24],[404,52,34],[262,66,22],[560,56,28],[628,50,26]].forEach(([x,t,w])=>pillar(x,t,w,'#6aa883','#58946f','#4a8a56'));
  for(let x=-6;x<TW+8;x+=6)disc(bg,x,96+r()*6,7+r()*5,'#2c6a3a');
  for(let x=-6;x<TW+8;x+=7)disc(bg,x-2,92+r()*6,4+r()*3,'#3c8447');
  R(bg,0,104,TW,TH-104,'#5fae42');R(bg,0,104,TW,2,'#3f7f36');
  for(let i=0;i<12000;i++)R(bg,Math.floor(r()*TW),106+Math.floor(r()*(TH-106)),1,1,pk(r,['#56a23c','#6bbb4c','#4f9837','#73c252']));
  for(let i=0;i<520;i++){const x=r()*TW,y=108+r()*(TH-108);R(bg,x,y,1,2,'#3f8a33');R(bg,x+2,y,1,2,'#3f8a33');R(bg,x+1,y-1,1,3,'#4e9a3a');}
  for(let i=0;i<300;i++)R(bg,r()*TW,110+r()*(TH-110),1,1,pk(r,['#ffd1e0','#ffffff','#ffe066','#f6a6c1']));

  const [,m]=mk(TW,TH);m.fillStyle='#fff';
  for(let i=0;i<RIV.length-1;i++)stampLine(m,{x:RIV[i][0],y:RIV[i][1]},{x:RIV[i+1][0],y:RIV[i+1][1]},12);
  const wd=m.getImageData(0,0,TW,TH).data;
  const [,p]=mk(TW,TH);p.fillStyle='#fff';
  for(const [a,b,w] of EDGES)if(w)stampLine(p,N[a],N[b],w/2);
  p.beginPath();p.arc(N.P.x,N.P.y,15,0,Math.PI*2);p.fill();
  const pd=p.getImageData(0,0,TW,TH).data;
  const W=(x,y)=>x>=0&&y>=0&&x<TW&&y<TH&&wd[(y*TW+x)*4+3]>127;
  const Pt=(x,y)=>x>=0&&y>=0&&x<TW&&y<TH&&pd[(y*TW+x)*4+3]>127&&!W(x,y);
  const img=bg.getImageData(0,0,TW,TH),d=img.data;
  const set=(x,y,h)=>{const c=hx(h),i=(y*TW+x)*4;d[i]=c[0];d[i+1]=c[1];d[i+2]=c[2];d[i+3]=255;};
  const STONES=['#cbc4b4','#bfb8a7','#d5cfc1','#b5ae9e','#c4bdad'];
  for(let y=104;y<TH;y++)for(let x=0;x<TW;x++){
    if(W(x,y)){
      if(!W(x,y-1)||!W(x,y-2))set(x,y,'#2d5f8c');
      else if(!W(x,y+1)||(!W(x-1,y)&&!W(x+1,y)))set(x,y,'#7fc6ee');
      else{const deep=W(x,y-7)&&W(x,y+7);set(x,y,deep?((x+y)%2?'#2f7cc0':'#3383c6'):'#3d8fd0');if(r()<.04)set(x,y,'#5aa9e0');if(r()<.012)WATER_PTS.push({x,y,ph:r()*6.28});}
    }else if(Pt(x,y)){
      const edge=!Pt(x-1,y)||!Pt(x+1,y)||!Pt(x,y-1)||!Pt(x,y+1);
      if(edge){set(x,y,!Pt(x,y+1)?'#6f6a5e':'#8e887a');continue;}
      const row=Math.floor(y/4),off=(row%2)*3,col=Math.floor((x+off)/6);
      if(y%4===0||(x+off)%6===0)set(x,y,'#958f80');
      else{set(x,y,STONES[((Math.imul(col,73856093)^Math.imul(row,19349663))>>>0)%STONES.length]);if((x+off)%6===1&&y%4===1)set(x,y,'#e6e0d3');}
    }else{
      if(W(x,y+1)||W(x,y+2))set(x,y,'#7b6a48');
      else if(W(x,y+3)||W(x+1,y)||W(x-1,y))set(x,y,'#4f8d36');
      else if(Pt(x,y-1))set(x,y,'#4b8f35');
    }
  }
  bg.putImageData(img,0,0);
  for(let i=0;i<RIV.length-1;i++){
    const a=RIV[i],b=RIV[i+1],L=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/L,ny=(b[0]-a[0])/L;
    for(let s=0;s<L;s+=5){if(r()<.55){const side=r()<.5?-1:1;const x=lerp(a[0],b[0],s/L)+nx*13*side,y=lerp(a[1],b[1],s/L)+ny*13*side;if(Math.abs(y-332)<9)continue;oval(bg,x,y,2+Math.floor(r()*2),1,'#8d8880');R(bg,x-1,y-1,2,1,'#bdb8ae');}}
  }
  [[40,212],[92,244],[60,222],[130,296],[152,350]].forEach(([x,y])=>{oval(bg,x,y,3,1,'#3f8f4a');R(bg,x,y,1,1,'#2a6a35');});
  R(bg,93,243,1,1,'#ffd1e0');
  const stones=(a,b)=>{const L=Math.hypot(b.x-a.x,b.y-a.y);for(let s=6;s<L-4;s+=7){const x=lerp(a.x,b.x,s/L)+(r()-.5)*3,y=lerp(a.y,b.y,s/L);oval(bg,x,y,2,1,'#a8a39a');R(bg,x-1,y-1,2,1,'#cfcac0');}};
  stones(N.C,N.L);stones(N.L,N.M);stones(N.P,N.WL);stones(N.T,N.NT);stones(N.K2,N.OS);
  for(let i=0;i<140;i++)STARS.push({x:r()*TW,y:1+r()*70,ph:r()*6.28,b:r()<.15});
}

/* =====================================================================
   SKY: clouds, sun, moon, stars
   ===================================================================== */
const CLOUDS=[],CLOUD_IMG=[];
function makeClouds(){
  const pals={day:['#ffffff','#d6e3f0'],grey:['#a4abba','#80889a'],night:['#3b4470','#2a3158'],sunset:['#ffcfb4','#e49c8c']};
  for(let s=0;s<6;s++){
    const r=rng(100+s),w=28+Math.floor(r()*38),blobs=[];
    for(let i=0;i<5+Math.floor(r()*3);i++)blobs.push([6+r()*(w-12),10+r()*5,4+r()*5]);
    const set={};
    for(const k in pals){const [c,g]=mk(w+10,32);for(const [x,y,rr] of blobs)disc(g,x+5,y+3,rr,pals[k][1]);for(const [x,y,rr] of blobs)disc(g,x+5,y+1,rr,pals[k][0]);set[k]=c;}
    CLOUD_IMG.push(set);
  }
  const r=rng(77);for(let i=0;i<18;i++)CLOUDS.push({s:i%6,y:2+r()*62,sp:2+r()*4,x0:r()*(TW+120)});
}

/* =====================================================================
   PROPS
   ===================================================================== */
const props=[],LIGHTS=[],TREES=[];
const PAL={roofD:'#2b2f3f',roofM:'#3d4258',roofL:'#596180',woodD:'#4a2c18',plaster:'#efe6d2',red:'#c63b2c',redD:'#8c2a20',gold:'#e3b341'};
const SLATE={d:PAL.roofD,m:PAL.roofM,l:PAL.roofL};
const TEAL={d:'#1f3644',m:'#2e4f62',l:'#44708a'};
const BROWN={d:'#5a3020',m:'#7a4428',l:'#9a5a34'};
const GREEN={d:'#24402c',m:'#33583c',l:'#4a7650'};
function sprite(x,y,w,h,base,draw,extra){const [c,g]=mk(w,h);g.translate(-x,-y);draw(g);const p=Object.assign({img:c,x,y,base},extra||{});props.push(p);return p;}
function fxProp(base,fx){props.push({img:null,base,fx});}
function roof(g,cx,y,hw,h,pal){
  for(let r=0;r<h;r++){
    const k=h>1?r/(h-1):1,w=Math.round(hw*(.42+.58*k));
    let col=pal.m;if(r<2)col=pal.l;if(r%3===2)col=pal.d;
    R(g,cx-w,y+r,w*2,1,col);
    if(r%3!==2)for(let sx=cx-w+((Math.floor(r/3))%2?1:3);sx<cx+w-1;sx+=4)R(g,sx,y+r,1,1,pal.d);
    R(g,cx-w,y+r,1,1,pal.d);R(g,cx+w-1,y+r,1,1,pal.d);
  }
  R(g,cx-hw-2,y+h-2,3,2,pal.m);R(g,cx+hw-1,y+h-2,3,2,pal.m);
  R(g,cx-hw-4,y+h-3,3,1,pal.d);R(g,cx+hw+1,y+h-3,3,1,pal.d);
  R(g,cx-hw-2,y+h,hw*2+4,1,pal.d);
  R(g,cx-hw,y+h+1,hw*2,1,'rgba(20,10,10,.45)');
  const rw=Math.round(hw*.42);R(g,cx-rw-1,y-2,rw*2+2,2,pal.d);R(g,cx-rw-3,y-3,2,2,pal.d);R(g,cx+rw+1,y-3,2,2,pal.d);
}
function wall(g,x,y,w,h,step,fill){R(g,x,y,w,h,fill||PAL.plaster);R(g,x,y+h-3,w,3,PAL.woodD);for(let px=x;px<=x+w-2;px+=step||12)R(g,px,y,2,h,PAL.woodD);R(g,x+w-2,y,2,h,PAL.woodD);R(g,x,y,w,2,PAL.woodD);}
function win(g,x,y,w,h){R(g,x-1,y-1,w+2,h+2,PAL.woodD);R(g,x,y,w,h,'#f2e2b8');for(let i=x+2;i<x+w;i+=3)R(g,i,y,1,h,'#8a5a34');for(let j=y+3;j<y+h;j+=4)R(g,x,j,w,1,'#8a5a34');LIGHTS.push({x:x+w/2,y:y+h/2,r:Math.max(w,h)+4,col:'255,200,120',k:.55});}
function lantern(g,x,y){R(g,x,y-2,1,2,'#2a1a10');R(g,x-1,y,3,4,'#d8432f');R(g,x-1,y,3,1,'#2a1a10');R(g,x-1,y+3,3,1,'#2a1a10');R(g,x,y+1,1,1,'#ffa070');LIGHTS.push({x:x+.5,y:y+2,r:13,col:'255,150,70'});}
function toro(x,base){
  sprite(x-5,base-17,11,18,base,g=>{R(g,x-3,base-2,7,2,'#8d8880');R(g,x-1,base-8,3,6,'#a8a39a');R(g,x-3,base-11,7,3,'#bdb8ae');R(g,x-2,base-10,5,1,'#ffcf6a');R(g,x-4,base-13,9,2,'#8d8880');R(g,x-3,base-14,7,1,'#a8a39a');R(g,x-1,base-16,3,2,'#8d8880');});
  LIGHTS.push({x,y:base-10,r:12,col:'255,190,90'});
}
function cherry(bx,by,s,seed){
  const r=rng(seed),cy=by-24*s,ext=36*s;
  TREES.push({x:bx,y:cy,r:22*s});
  sprite(bx-ext,by-50*s,ext*2,50*s+3,by,g=>{
    R(g,bx-2,by-18*s,4,18*s,'#5a3a2a');R(g,bx-1,by-18*s,1,18*s,'#7a5040');R(g,bx-4,by-2,8,2,'#4a2e22');
    R(g,bx-8*s,by-22*s,8*s,2,'#5a3a2a');R(g,bx,by-24*s,9*s,2,'#5a3a2a');
    const blobs=[];for(let i=0;i<15;i++){const a=r()*Math.PI*2,d=r()*15*s;blobs.push([bx+Math.cos(a)*d*1.45,cy+Math.sin(a)*d*.7,(6+r()*5)*s]);}
    blobs.forEach(([x,y,rr])=>disc(g,x,y+2,rr,'#c46a8d'));
    blobs.forEach(([x,y,rr])=>disc(g,x,y,rr-1,'#e98fb0'));
    blobs.forEach(([x,y,rr])=>disc(g,x-2,y-2,Math.max(1,rr-4),'#f6b3cc'));
    for(let i=0;i<8;i++){const[x,y,rr]=blobs[i];disc(g,x-3,y-3,Math.max(1,rr-7),'#ffd6e5');}
    for(let i=0;i<40;i++){const[x,y,rr]=pk(r,blobs);R(g,x+(r()-.5)*rr*1.6,y+(r()-.5)*rr,1,1,pk(r,['#ffe8f0','#b85a80','#ffffff']));}
  });
}
function house(cx,wallCol,pal){
  sprite(cx-26,270,52,50,318,g=>{
    wall(g,cx-18,298,36,20,17,wallCol);
    R(g,cx-4,304,8,14,'#5a3a24');R(g,cx-4,304,8,1,'#2a1a10');R(g,cx,304,1,14,'#3a2416');R(g,cx-5,302,10,4,'#2f3f73');R(g,cx-2,302,1,4,'#1f2a50');R(g,cx+1,302,1,4,'#1f2a50');
    win(g,cx-15,303,7,6);win(g,cx+8,303,7,6);
    roof(g,cx,284,20,14,pal);
    R(g,cx+12,313,4,5,'#a0563a');disc(g,cx+14,311,2,'#4f9a3a');R(g,cx-17,314,3,4,'#7a4a2a');
  });
}
function bench(cx,base){
  const x=cx-8,y=base-14;
  sprite(x-2,y,20,15,base,g=>{R(g,x,y+8,16,2,'#8a5a32');R(g,x,y+7,16,1,'#b07a48');R(g,x,y+2,16,2,'#7a4a2a');R(g,x,y+2,16,1,'#a06a3a');R(g,x+1,y+4,1,4,'#4a2c18');R(g,x+14,y+4,1,4,'#4a2c18');R(g,x+1,y+10,2,4,'#4a2c18');R(g,x+13,y+10,2,4,'#4a2c18');R(g,x,y+14,16,1,'rgba(18,28,18,.25)');});
}
const BENCHES=['L','BN1','BN2','BN3','BN4','BN5'];
const ART={p:0,dots:[]};
function newPainting(){ART.p=0;ART.dots=[];const pal=pick([['#3a6ab0','#7fc6ee','#ffffff','#2f7a3c'],['#e05a4a','#ffb347','#ffd166','#7a3a8a'],['#4f9a3a','#a3d95b','#f6b3cc','#5a3a2a']]);for(let i=0;i<63;i++)ART.dots.push({x:i%9,y:Math.floor(i/9),c:pick(pal)});ART.dots.sort(()=>Math.random()-.5);}
newPainting();

function buildProps(){
  /* FORGE (coding → blacksmith) */
  sprite(18,66,104,78,142,g=>{
    R(g,34,104,70,38,'#5b3a23');for(let yy=106;yy<142;yy+=4)R(g,34,yy,70,1,'#4a2e1b');
    wall(g,34,106,30,36,15);win(g,41,114,16,10);
    R(g,66,108,34,34,'#24170f');
    for(let yy=118;yy<140;yy+=3)for(let xx=70+((yy/3|0)%2)*3;xx<97;xx+=6){R(g,xx,yy,5,2,'#8a4430');R(g,xx,yy,5,1,'#a35a40');}
    R(g,76,125,15,9,'#160c08');R(g,75,124,17,1,'#5a2a1a');
    R(g,64,104,3,38,PAL.woodD);R(g,100,104,3,38,PAL.woodD);
    R(g,94,110,1,7,'#9aa0b0');R(g,96,110,1,6,'#9aa0b0');R(g,93,109,5,1,'#5a5f6e');
    R(g,96,70,10,30,'#7e7a73');for(let yy=72;yy<100;yy+=4)R(g,96,yy,10,1,'#68645d');R(g,95,68,12,3,'#5a5650');R(g,97,70,2,30,'#99958d');
    roof(g,68,84,44,22,SLATE);
    R(g,22,130,10,12,'#8a5a32');R(g,22,130,10,1,'#b07a48');R(g,22,135,10,1,'#5a3a20');R(g,24,124,8,6,'#7a4a2a');R(g,24,124,8,1,'#a06a3a');
    R(g,104,132,8,10,'#5a4030');R(g,104,135,8,1,'#2a2a30');R(g,104,139,8,1,'#2a2a30');R(g,105,132,6,1,'#3a6a9a');
    lantern(g,28,106);lantern(g,107,106);
  },{fx:(c,t)=>{
    const heat=roleWorking('blacksmith')?1:.5;
    for(let i=0;i<13;i++){const h=2+Math.floor((Math.sin(t*13+i*1.9)+1)*1.6*heat+3*heat);R(c,77+i,133-h,1,h,i%3===0?'#ffe066':i%2?'#ff8c1a':'#ff5a1a');}
    R(c,76,133,15,1,'#ffb347');
  }});
  LIGHTS.push({x:83,y:129,r:30,col:'255,120,40',k:1.2,always:true,on:()=>roleWorking('blacksmith')?1.1:.55});
  sprite(106,141,12,9,149,g=>{R(g,108,143,9,2,'#55596a');R(g,106,143,3,1,'#55596a');R(g,110,145,4,2,'#3d404c');R(g,109,147,6,2,'#2e3039');R(g,108,143,9,1,'#9aa0b3');});

  /* SHRINE TOWER (terminal / AI → wizard) */
  sprite(190,0,82,156,143,g=>{
    R(g,229,2,2,12,PAL.gold);R(g,227,6,6,1,PAL.gold);R(g,227,9,6,1,PAL.gold);R(g,228,2,4,1,'#fff0a0');
    R(g,222,26,16,12,PAL.red);R(g,224,28,4,8,'#f4ead0');R(g,232,28,4,8,'#f4ead0');
    roof(g,230,14,17,12,TEAL);
    R(g,214,48,32,18,PAL.red);for(let xx=216;xx<244;xx+=6)R(g,xx,50,4,12,'#f4ead0');R(g,214,48,32,2,PAL.redD);
    roof(g,230,36,26,12,TEAL);
    R(g,206,78,48,32,PAL.plaster);
    for(const xx of [206,214,246,252])R(g,xx,78,2,32,PAL.red);
    R(g,206,78,48,3,PAL.redD);
    R(g,221,90,18,20,'#7a2a20');for(let xx=223;xx<238;xx+=3)R(g,xx,91,1,19,'#c9a050');R(g,221,99,18,1,'#c9a050');
    win(g,218,82,6,5);win(g,236,82,6,5);
    disc(g,230,84,3,PAL.gold);disc(g,230,84,2,'#2a4a6a');R(g,229,83,1,1,'#bfe8ff');
    roof(g,230,64,34,14,TEAL);
    R(g,196,110,68,32,'#9a958c');
    for(let yy=113;yy<142;yy+=5){R(g,196,yy,68,1,'#7e7a73');for(let xx=196+((yy/5|0)%2)*4;xx<264;xx+=8)R(g,xx,yy,1,5,'#7e7a73');}
    R(g,195,109,70,2,'#c9c5bc');
    for(let xx=197;xx<=263;xx+=6)R(g,xx,102,2,8,PAL.red);R(g,196,103,69,2,PAL.red);R(g,196,103,69,1,'#e05a4a');
    for(let yy=110;yy<152;yy+=3){R(g,220,yy,20,2,'#c4bfb5');R(g,220,yy+2,20,1,'#8d8880');}
    R(g,218,108,2,44,'#7e7a73');R(g,240,108,2,44,'#7e7a73');
    lantern(g,198,79);lantern(g,262,79);lantern(g,206,49);lantern(g,254,49);
  },{fx:(c,t)=>{if(roleWorking('wizard')){const a=.5+.5*Math.sin(t*4);R(c,229,83,2,2,a>.5?'#e0fbff':'#7fd3ff');}}});
  LIGHTS.push({x:230,y:86,r:34,col:'110,200,255',k:1.3,always:true,on:()=>roleWorking('wizard')?1:0});
  toro(212,151);toro(248,151);

  /* TRAVELER'S INN + TORII (browser → traveler) */
  sprite(288,62,102,82,142,g=>{
    wall(g,300,100,76,42,12);
    R(g,327,114,22,28,'#f3e7c6');for(let xx=329;xx<349;xx+=4)R(g,xx,114,1,28,'#8a5a34');for(let yy=118;yy<142;yy+=5)R(g,327,yy,22,1,'#8a5a34');
    R(g,325,112,26,9,'#2f3f73');R(g,331,112,1,9,'#1f2a50');R(g,338,112,1,9,'#1f2a50');R(g,345,112,1,9,'#1f2a50');R(g,334,115,2,2,'#f4ead0');R(g,341,115,2,2,'#f4ead0');
    win(g,305,110,14,10);win(g,357,110,14,10);
    R(g,298,138,80,4,'#8a5a34');R(g,298,138,80,1,'#b07a48');
    roof(g,338,80,44,20,SLATE);
    R(g,330,67,16,9,'#6b4226');R(g,331,68,14,7,'#d9b45a');R(g,333,70,10,1,'#6b4226');R(g,333,72,8,1,'#6b4226');
    lantern(g,304,101);lantern(g,372,101);
  });
  sprite(310,117,52,40,155,g=>{
    const r='#cf3b2c';
    R(g,320,126,3,29,r);R(g,350,126,3,29,r);R(g,320,126,1,29,'#e86050');R(g,350,126,1,29,'#e86050');
    R(g,319,152,5,3,'#2b2b2b');R(g,349,152,5,3,'#2b2b2b');
    R(g,316,131,41,3,r);R(g,313,121,47,3,'#262626');R(g,311,119,4,2,'#262626');R(g,358,119,4,2,'#262626');
    R(g,314,124,45,2,r);R(g,333,124,7,7,'#262626');R(g,334,125,5,5,PAL.gold);
  });
  toro(304,154);

  /* FESTIVAL STAGE (music → bard) */
  sprite(386,58,94,96,144,g=>{
    R(g,404,90,60,30,'#5a3a24');for(let xx=406;xx<462;xx+=8)R(g,xx,90,4,30,'#6a4430');
    R(g,404,90,60,6,'#7a3a8a');for(let xx=404;xx<464;xx+=6)R(g,xx,96,3,2,'#7a3a8a');
    R(g,398,80,3,40,PAL.red);R(g,466,80,3,40,PAL.red);
    R(g,396,118,74,8,'#b07a48');for(let xx=398;xx<470;xx+=6)R(g,xx,118,1,8,'#8a5a32');R(g,396,118,74,1,'#d09a60');
    R(g,396,126,74,18,'#6b4226');for(let yy=129;yy<144;yy+=4)R(g,396,yy,74,1,'#54321c');
    for(let xx=400;xx<468;xx+=10){R(g,xx,131,6,8,'#4a2c18');R(g,xx+1,132,4,6,'#c63b2c');}
    for(let yy=144;yy<152;yy+=2){R(g,425,yy,16,1,'#b07a48');R(g,425,yy+1,16,1,'#6b4226');}
    roof(g,433,66,40,16,SLATE);R(g,394,82,79,1,PAL.red);
    for(let i=0;i<7;i++){const lx=402+i*10,ly=86+Math.round(Math.sin(i/6*Math.PI)*3);R(g,lx,ly-2,1,2,'#2a1a10');R(g,lx-1,ly,4,4,'#ffb04a');R(g,lx-1,ly,4,1,'#c06020');R(g,lx-1,ly+3,4,1,'#c06020');R(g,lx,ly+1,1,1,'#fff0c0');LIGHTS.push({x:lx+1,y:ly+2,r:12,col:'255,170,80',on:()=>roleWorking('bard')?1.3:.8});}
  });

  /* DOJO (games → samurai) */
  sprite(484,72,94,72,142,g=>{
    R(g,496,108,68,34,'#5b3a23');
    for(let xx=499;xx<562;xx+=11){R(g,xx,112,9,20,'#efe6d2');R(g,xx,112,9,1,'#c9bfa8');R(g,xx+4,112,1,20,'#c9bfa8');}
    R(g,496,132,68,8,'#3a2416');
    R(g,519,113,22,27,'#1e140e');R(g,521,117,18,1,'#6b4226');for(const xx of [523,527,531,535])R(g,xx,118,1,13,'#c9d0dc');
    R(g,506,113,7,18,'#d9b45a');R(g,507,115,5,1,'#3a2416');R(g,507,118,5,1,'#3a2416');R(g,508,121,3,1,'#3a2416');R(g,507,124,5,1,'#3a2416');
    disc(g,552,126,4,'#a0563a');disc(g,552,126,3,'#e8d8b0');R(g,549,130,1,3,'#4a2c18');R(g,555,130,1,3,'#4a2c18');
    R(g,492,140,76,3,'#8a5a34');R(g,492,140,76,1,'#b07a48');
    roof(g,530,86,38,22,GREEN);
    R(g,528,80,4,4,PAL.gold);
    lantern(g,497,108);lantern(g,563,108);
  });
  sprite(540,134,10,18,151,g=>{R(g,544,137,2,14,'#8a6a3a');R(g,542,139,6,7,'#d9b45a');R(g,542,141,6,1,'#a07a3a');R(g,542,144,6,1,'#a07a3a');R(g,543,150,4,1,'#5a3a24');});

  /* LIBRARY (docs / notes → scholar) */
  sprite(574,52,66,92,142,g=>{
    R(g,591,76,32,22,PAL.plaster);R(g,591,76,32,2,PAL.woodD);for(const xx of [591,606,621])R(g,xx,76,2,22,PAL.woodD);
    win(g,595,81,8,8);win(g,611,81,8,8);
    roof(g,607,64,20,12,TEAL);
    R(g,605,56,4,6,PAL.gold);
    wall(g,586,108,42,34,10);
    R(g,600,118,14,24,'#2e1c12');
    for(let yy=120;yy<140;yy+=5)for(let xx=601;xx<613;xx+=2)R(g,xx,yy,1,4,pick(['#c63b2c','#3a6ab0','#d9b45a','#4f9a3a','#7a3a8a']));
    for(let yy=124;yy<142;yy+=5)R(g,600,yy,14,1,'#5a3a24');
    win(g,589,114,8,10);win(g,617,114,8,10);
    roof(g,607,94,28,14,TEAL);
    R(g,603,110,8,6,'#f4ead0');R(g,603,110,8,1,'#8a5a34');R(g,605,112,4,1,'#3a6ab0');
    lantern(g,589,108);lantern(g,625,108);
  });

  /* MARKET STALLS (spreadsheets / office → merchant) */
  const stall=(cx,awn,goods)=>sprite(cx-18,194,36,38,230,g=>{
    R(g,cx-15,202,2,26,'#5a3a24');R(g,cx+13,202,2,26,'#5a3a24');
    R(g,cx-14,216,28,12,'#8a5a34');R(g,cx-14,216,28,2,'#b07a48');R(g,cx-14,226,28,2,'#5a3a20');
    for(let i=0;i<7;i++){R(g,cx-12+i*4,213,3,3,goods[i%goods.length]);R(g,cx-12+i*4,213,3,1,lighten(goods[i%goods.length]));}
    let k=0;for(let xx=cx-16;xx<cx+16;xx+=4,k++){R(g,xx,197,4,7,k%2?awn:'#f4ead0');R(g,xx+1,204,2,1,k%2?awn:'#f4ead0');}
    R(g,cx-16,196,32,1,shade(awn));
  });
  stall(506,'#c63b2c',['#ff8c42','#ffd166','#e05a4a']);
  stall(540,'#2f6ab0',['#e8e4dc','#9ad0ff','#c9c5bc']);
  stall(574,'#3f8a4a',['#7fcf6a','#c9e07a','#d9b45a']);

  /* POST HALL (chat → messenger) */
  sprite(158,170,96,60,228,g=>{
    wall(g,174,198,62,30,12);
    R(g,197,208,16,20,'#f3e7c6');for(let xx=199;xx<213;xx+=4)R(g,xx,208,1,20,'#8a5a34');R(g,197,208,16,1,PAL.woodD);
    win(g,180,206,12,9);win(g,219,206,12,9);
    R(g,199,201,12,6,'#f8f0dc');R(g,199,201,12,1,'#8a5a34');R(g,200,202,1,1,'#8a5a34');R(g,209,202,1,1,'#8a5a34');R(g,201,203,2,1,'#8a5a34');R(g,207,203,2,1,'#8a5a34');R(g,203,204,4,1,'#8a5a34');
    roof(g,205,180,40,18,SLATE);
    lantern(g,178,199);lantern(g,232,199);
  });
  sprite(242,220,10,17,236,g=>{R(g,243,224,7,10,'#c63b2c');R(g,243,224,7,1,'#e86050');R(g,244,226,5,1,'#2a1a1a');R(g,244,222,5,2,'#8c2a20');R(g,245,234,3,2,'#4a2c18');});

  /* STOREHOUSE (files → scout) */
  sprite(312,172,92,58,228,g=>{
    R(g,326,198,58,30,'#f2ede2');R(g,326,198,58,2,'#d8d0c0');
    R(g,326,216,58,12,'#3a3a46');for(let xx=326;xx<384;xx+=4)for(let yy=217;yy<228;yy+=4)R(g,xx+1,yy+1,2,2,'#e8e4dc');
    R(g,347,205,16,23,'#5a3a24');R(g,347,205,16,1,'#2a1a10');R(g,354,205,1,23,'#2a1a10');
    for(const [sx,sy] of [[349,208],[360,208],[349,220],[360,220]])R(g,sx,sy,1,1,'#c9c5bc');
    R(g,332,204,6,4,'#2a2a30');R(g,372,204,6,4,'#2a2a30');
    roof(g,355,184,36,16,SLATE);
    R(g,388,216,10,12,'#8a5a32');R(g,388,216,10,1,'#b07a48');R(g,392,216,1,12,'#5a3a20');R(g,390,208,8,8,'#7a4a2a');R(g,390,208,8,1,'#a06a3a');
    R(g,314,212,1,16,PAL.woodD);R(g,324,212,1,16,PAL.woodD);R(g,312,209,14,9,'#8a5a34');R(g,313,210,12,7,'#ead7a2');R(g,315,212,4,1,'#5a9a4a');R(g,320,214,1,1,'#c63b2c');R(g,316,215,6,1,'#7a6a4a');
  });

  /* HOMES (where residents sleep / shelter from rain) */
  house(196,'#efe6d2',SLATE);house(244,'#e9dcc4',BROWN);house(322,'#efe6d2',TEAL);

  /* ATELIER (design / art → artist) */
  sprite(348,268,90,54,320,g=>{
    wall(g,362,292,60,28,15,'#ece2cc');
    R(g,367,297,24,13,'#cfe6f0');for(let xx=369;xx<391;xx+=4)R(g,xx,297,1,13,'#8a5a34');R(g,367,303,24,1,'#8a5a34');R(g,366,296,26,1,PAL.woodD);R(g,366,310,26,1,PAL.woodD);
    LIGHTS.push({x:379,y:303,r:16,col:'255,210,140',k:.6});
    R(g,400,302,12,18,'#6b4226');R(g,400,302,12,1,'#3a2416');R(g,405,302,1,18,'#3a2416');
    R(g,413,298,6,5,'#f4ead0');R(g,414,299,4,3,'#e05a4a');R(g,413,305,6,5,'#f4ead0');R(g,414,306,4,3,'#3a6ab0');
    roof(g,392,278,32,14,BROWN);
    oval(g,392,275,4,2,'#d9b45a');R(g,390,274,1,1,'#e05a4a');R(g,392,274,1,1,'#3a6ab0');R(g,394,275,1,1,'#4f9a3a');
  });
  sprite(398,308,16,20,327,g=>{R(g,402,319,1,8,'#6b4226');R(g,411,319,1,8,'#6b4226');R(g,406,316,1,11,'#5a3a24');R(g,401,310,11,10,'#6b4226');R(g,402,311,9,7,'#fbf6ea');},
    {fx:c=>{for(let i=0;i<Math.min(ART.dots.length,Math.floor(ART.p));i++){const d=ART.dots[i];R(c,402+d.x,311+d.y,1,1,d.c);}}});

  /* TEA HOUSE + nodate parasol (rest spot) */
  sprite(438,268,80,54,320,g=>{
    wall(g,452,292,52,28,13);
    R(g,466,302,24,18,'#3a2416');R(g,469,306,6,4,'#8a8a8a');R(g,470,305,4,1,'#5a5a5a');
    R(g,465,294,26,9,'#3f8a4a');for(const xx of [471,478,485])R(g,xx,294,1,9,'#2a5a30');R(g,476,296,4,3,'#f4ead0');
    win(g,455,300,8,7);win(g,494,300,8,7);
    roof(g,478,278,30,14,SLATE);
    lantern(g,455,293);lantern(g,501,293);
  });
  sprite(508,292,32,32,321,g=>{
    R(g,511,316,24,2,'#c63b2c');R(g,511,315,24,1,'#e05a4a');R(g,512,318,2,4,'#4a2c18');R(g,532,318,2,4,'#4a2c18');
    R(g,523,299,1,17,'#5a3a24');
    for(let i=0;i<6;i++)R(g,523-2-i*2,293+i,5+i*4,1,i%2?'#d8432f':'#b8322a');
    R(g,511,299,25,1,'#8c2a20');R(g,522,292,3,1,'#2a1a10');
  });

  /* HOT SPRING (rest spot) */
  sprite(534,270,66,22,290,g=>{
    for(let xx=540;xx<596;xx+=3){R(g,xx,272,2,16,'#8aa04a');R(g,xx,272,2,1,'#a8c060');}R(g,538,277,60,1,'#5a6a30');R(g,538,283,60,1,'#5a6a30');
    oval(g,566,296,27,11,'#8d8880');oval(g,566,296,23,9,'#4fa8cc');oval(g,566,295,19,6,'#7fcbe0');
    for(let a=Math.PI;a<=Math.PI*2.01;a+=.32)disc(g,566+Math.cos(a)*25,296+Math.sin(a)*10,3,'#a8a39a');
  });
  sprite(534,296,66,18,312,g=>{
    for(let a=0;a<=Math.PI+.01;a+=.3){const x=566+Math.cos(a)*25,y=297+Math.sin(a)*10;disc(g,x,y,3,'#8d8880');R(g,x-1,y-2,2,1,'#bdb8ae');}
  });

  /* WATERMILL + BRIDGE */
  sprite(36,258,76,62,318,g=>{
    R(g,50,292,54,26,'#7a4a2a');for(let yy=294;yy<318;yy+=3)R(g,50,yy,54,1,'#6a3e22');R(g,50,292,54,2,PAL.woodD);
    R(g,70,302,10,16,'#3a2416');win(g,57,298,7,6);win(g,89,298,7,6);
    R(g,104,299,9,2,'#4a2c18');
    roof(g,77,276,30,16,BROWN);
  });
  fxProp(319,(c,t)=>{
    const cx=124,cy=300,a0=t*.9;
    for(let k=0;k<10;k++){const a=a0+k*Math.PI/5;for(let s=2;s<=12;s++)R(c,cx+Math.cos(a)*s,cy+Math.sin(a)*s,1,1,'#6b4226');R(c,cx+Math.cos(a)*13-1,cy+Math.sin(a)*13-1,3,3,'#8a5a34');}
    for(let a=0;a<6.28;a+=.25)R(c,cx+Math.cos(a)*11,cy+Math.sin(a)*11,1,1,'#5a3a24');
    disc(c,cx,cy,2,'#4a4a52');
  });
  sprite(124,316,48,20,326,g=>{
    R(g,126,325,44,10,'#9c6438');for(let xx=126;xx<170;xx+=3)R(g,xx,325,1,10,'#7a4a2a');R(g,126,325,44,1,'#c0844a');
    R(g,126,320,44,2,'#c63b2c');for(const xx of [126,137,148,159,168]){R(g,xx,317,2,8,'#c63b2c');R(g,xx,316,2,1,'#2a2a2a');}
  });
  sprite(124,333,48,10,341,g=>{R(g,126,337,44,2,'#c63b2c');R(g,126,339,44,1,'#8c2a20');for(const xx of [126,137,148,159,168])R(g,xx,334,2,6,'#c63b2c');});

  /* WELL, BENCH, SIGN, LANTERNS */
  sprite(244,184,22,25,208,g=>{R(g,247,200,16,8,'#8d8880');R(g,247,200,16,2,'#bdb8ae');R(g,249,198,12,2,'#2a4a6a');R(g,247,188,2,12,PAL.woodD);R(g,261,188,2,12,PAL.woodD);R(g,245,186,20,3,PAL.roofM);R(g,246,185,18,1,PAL.roofL);R(g,253,193,4,3,'#7a4a2a');R(g,254,189,1,4,'#c9b38a');for(let xx=248;xx<263;xx+=4)R(g,xx,203,1,4,'#6e6a64');});
  for(const b of BENCHES){const n=N[b];bench(n.x,n.z-1);}
  sprite(296,180,10,13,192,g=>{R(g,300,182,2,10,PAL.woodD);R(g,296,182,9,3,'#b07a48');R(g,297,186,8,3,'#a06a3a');R(g,296,182,9,1,'#d09a60');});
  toro(58,192);toro(110,350);toro(344,350);toro(540,350);

  /* TREES */
  cherry(172,140,1,11);cherry(284,136,.85,12);cherry(24,200,.8,13);cherry(448,214,1.05,14);cherry(150,266,1,15);cherry(575,205,.8,16);cherry(22,300,.8,17);
  sprite(0,104,24,40,138,g=>{disc(g,8,122,10,'#2f7a3c');disc(g,6,118,7,'#3f9048');disc(g,4,115,3,'#58a85a');R(g,7,128,3,10,'#5a3a2a');});
  sprite(0,346,TW,14,999,g=>{const r=rng(5);for(let x=180;x<TW+4;x+=6){disc(g,x,358+r()*3,5+r()*3,'#2f7a3c');disc(g,x-1,356+r()*3,3,'#45964c');}for(let x=0;x<118;x+=6){disc(g,x,358+r()*3,5+r()*3,'#2f7a3c');disc(g,x-1,356+r()*3,3,'#45964c');}for(let i=0;i<20;i++)R(g,180+r()*460,352+r()*6,1,1,'#ffd1e0');});
}

/* =====================================================================
   ROLES & RESIDENTS
   ===================================================================== */
const ROLES={
  blacksmith:{label:'Blacksmith',bld:'Forge',kind:'Coding',top:'#5c4433',bot:'#3a3030',acc:'hammer',work:'FW',hang:'B',color:'#ff7a45',verb:'forging code at the Forge'},
  wizard:{label:'Shrine Wizard',bld:'Shrine Tower',kind:'Terminal / AI',top:'#f2efe6',bot:'#c43a2c',acc:'wizard',work:'SH',hang:'D',color:'#8f7bff',verb:'channeling the AI at the Shrine'},
  traveler:{label:'Traveler',bld:"Traveler's Inn",kind:'Browser',top:'#8a6a3c',bot:'#3e4a5e',acc:'pack',work:'explore',hang:'INN',color:'#ffd166',verb:'exploring the web'},
  bard:{label:'Bard',bld:'Festival Stage',kind:'Music / Video',top:'#ece4d0',bot:'#4a5a8a',acc:'shamisen',work:'STG',hang:'G',color:'#ff8fc7',verb:'performing on the Festival Stage'},
  messenger:{label:'Messenger',bld:'Post Hall',kind:'Chat / Mail',top:'#3f7a5a',bot:'#2f3a4a',acc:'satchel',work:'Q',hang:'R',color:'#4fd1a5',verb:'sorting letters at the Post Hall'},
  scout:{label:'Scout',bld:'Storehouse',kind:'Files',top:'#7a8a3a',bot:'#4a3a2a',acc:'straw',work:'S',hang:'T',color:'#a3d95b',verb:'surveying the Storehouse'},
  scholar:{label:'Scholar',bld:'Library',kind:'Docs / Notes',top:'#3a5a9a',bot:'#2a3050',acc:'book',work:'LB',hang:'J',color:'#6fb3ff',verb:'studying at the Library'},
  samurai:{label:'Samurai',bld:'Dojo',kind:'Games',top:'#2e2e3e',bot:'#454a6a',acc:'katana',work:'DJ',hang:'I',color:'#ff5a5a',verb:'training at the Dojo'},
  artist:{label:'Artist',bld:'Atelier',kind:'Design / Art',top:'#e8dcc0',bot:'#5a4a3a',acc:'brush',work:'AT',hang:'B3',color:'#ffa94d',verb:'painting at the Atelier'},
  merchant:{label:'Merchant',bld:'Market',kind:'Sheets / Office',top:'#2f7a5a',bot:'#3a3030',acc:'abacus',work:'MK',hang:'U',color:'#5ad1e6',verb:'trading at the Market'},
  villager:{label:'Villager',bld:'Plaza',kind:'Other apps',top:'#7f86a3',bot:'#525770',acc:'broom',work:'P',hang:'P',color:'#c8d0e0',verb:'tidying the Plaza'},
};
const PEOPLE=[
  ['Haru','#f2c79b','#2b2233','short','#4a6a8a','#3a3a4a'],['Yuki','#f6d3b3','#e9e4f0','long','#b8506a','#3a3048',1],
  ['Kenji','#e0a878','#3b2a20','spiky','#5a7a4a','#3a3428'],['Mei','#f6d3b3','#6a3a2a','bun','#d07a3a','#5a3a2a'],
  ['Sora','#f2c79b','#f0c24a','spiky','#3a6ab0','#2c3a5a'],['Rin','#f6d3b3','#1f1a24','pony','#9a3a5a','#2a2a3a'],
  ['Taro','#d49a6a','#4a3020','short','#8a7a4a','#4a4030'],['Aiko','#f6d3b3','#d07a3a','cat','#e8a0b8','#5a4a6a',1],
  ['Ren','#e8b48a','#5a5a6a','short','#4a8a8a','#2a3a3a'],['Hana','#f6d3b3','#8a4a7a','long','#f2efe6','#c43a2c',1],
  ['Kai','#d49a6a','#2a2a2a','spiky','#c98a3a','#3a3a4a'],['Nori','#f6d3b3','#4a2a5a','bun','#5aa0a0','#3a3048',1],
];
const START=['B','C','D','E','F','G','P','R','L','T','U','B2'];
const HOMES=['HM1','HM2','HM3'];
const UMB=['#c63b2c','#e8a03a','#3a6ab0','#7a4ad0','#3f8a4a'];
const RES=PEOPLE.map((p,i)=>{const n=N[START[i]];return{
  name:p[0],skin:p[1],hair:p[2],style:p[3],top:p[4],bot:p[5],skirt:!!p[6],seed:i*1.37,home:HOMES[i%3],umb:UMB[i%UMB.length],
  jx:((i%5)-2)*4,jy:(i%3)-1,x:n.x,y:n.y,node:START[i],target:START[i],path:[],hidden:false,
  act:'wander',pose:'stand',face:0,timer:.5+Math.random()*3,app:null,role:null,working:false,react:0,wait:0,bubble:null,lastPh:0};});

function roleWorking(role){return RES.some(r=>r.role===role&&r.working&&!r.path.length&&r.pose==='work');}
function say(r,type,dur){r.bubble={type,t:dur||1.4};}
const POSE={work:'work',chore:'work',talk:'stand',listen:'stand',idle:'stand',sit:'sit',fish:'fish',nap:'sleep',bnap:'sleep',sleep:'sleep',chat:'stand',watch:'stand',wander:'stand',well:'stand',explore:'stand',tea:'sit',soak:'soak',browse:'stand',home:'stand'};
function goTo(r,node,act){
  r.hidden=false;
  const ids=route(r.node,node),dest=N[node],j=dest.j??1;
  r.path=ids.map(id=>({x:N[id].x,y:N[id].y,id}));
  if(!r.path.length)r.path=[{x:dest.x,y:dest.y,id:node}];
  const last=r.path[r.path.length-1];last.x=dest.x+r.jx*j;last.y=dest.y+r.jy*j;
  if(act==='bnap'){last.x=dest.x+1;last.y=dest.y-3;}
  r.target=node;r.act=act;r.pose='walk';r.spot=0;r.spotFace=null;r.partner=null;
}
/* work stations around each building: [dx, dy, face] from the job node. Workers shuttle between them. */
const WORK_SPOTS={
  blacksmith:[[0,0,1],[-17,1,-1],[0,0,1],[-60,-3,-1]],          // anvil · stoke the fire · anvil · fetch from the crates
  wizard:[[0,0,0],[-8,0,-1],[8,0,1]],                             // chant at the shrine door, pacing the landing
  bard:[[0,0,0],[-16,-2,1],[16,-2,-1]],                           // move around the stage
  messenger:[[0,0,0],[31,-3,1],[-22,1,-1]],                       // desk · mailbox · Post Hall door
  scout:[[0,0,0],[30,-8,1],[-31,-6,-1]],                          // storehouse · crates · notice board
  scholar:[[0,0,0],[-13,2,-1],[13,2,1]],                          // library shelves
  samurai:[[0,0,1],[24,1,-1]],                                    // strike the dummy from both sides
  artist:[[0,0,1],[-8,1,1]],                                      // step back to look at the painting
  merchant:[[-34,0,0],[0,0,0],[34,0,0]],                          // the three stalls
  villager:[[-14,4,0],[12,6,0],[0,-6,0],[16,-4,0]],               // sweep the plaza
};
function nextWorkSpot(r){
  const spots=WORK_SPOTS[r.role],w=ROLES[r.role].work,n=N[w];
  if(!spots||!n)return false;
  r.spot=((r.spot??0)+1)%spots.length;
  const [dx,dy,f]=spots[r.spot];
  r.path=[{x:n.x+dx,y:n.y+dy}];r.act='work';r.pose='walk';r.spotFace=f;
  return true;
}
function arrive(r){
  const n=N[r.target];r.pose=POSE[r.act]||'stand';r.face=n.face??0;
  r.timer=r.act==='explore'?.6+Math.random()*1.8:7+Math.random()*10;
  if(r.act==='work'){r.timer=4+Math.random()*4;if(r.spotFace!=null)r.face=r.spotFace;}
  if(r.act==='chat')r.face=r.x<N.P.x?1:-1;
  if(r.act==='chore')r.timer=5+Math.random()*5;
  if(r.act==='idle'&&r.app)r.timer=3+Math.random()*4;
  if(r.act==='talk'){
    r.face=r.spotFace??r.face;r.timer=6+Math.random()*7;
    const o=r.partner;
    if(validTalk(r)){o.act='talk';o.timer=r.timer+.2;o.face=r.x<o.x?-1:1;say(o,'!',.8);}
    else r.timer=.8;
  }
  if(r.act==='bnap'){r.face=0;r.timer=curTod()==='night'?25+Math.random()*25:14+Math.random()*14;}
  if(r.act==='home'){r.hidden=true;r.timer=curTod()==='night'?40+Math.random()*40:14+Math.random()*16;}
}
function benchNapped(b,me){return RES.some(o=>o!==me&&o.target===b&&o.act==='bnap');}
function sleepHere(r){
  if(r.hidden){r.path=[];r.act='home';return;}
  const wk=weather();
  if(wk!=='rain'&&wk!=='storm'&&wk!=='snow'){
    const b=BENCHES.filter(b=>!benchNapped(b,r)).map(b=>[b,Math.hypot(N[b].x-r.x,N[b].y-r.y)]).filter(e=>e[1]<120).sort((a,b)=>a[1]-b[1])[0];
    if(b){goTo(r,b[0],'bnap');return;}
  }
  r.path=[];r.act='sleep';r.pose='sleep';r.timer=12+Math.random()*12;}
const EXPLORE=['A','B','C','D','E','F','G','I','J','H','P','R','T','U','K','K2','BR','B4','B3','B2','B1','BB','BL','INN'];
const WANDER=['B','C','D','E','F','G','I','J','R','T','Q','S','U','K','B1','B2','B3','B4','BB'];
function exploreNext(r){goTo(r,pick(EXPLORE.filter(n=>n!==r.node)),'explore');}
function occupancy(node,me){return RES.filter(o=>o!==me&&o.target===node&&!o.app).length;}
function planLeisure(r){
  if(afk){sleepHere(r);return;}
  const tod=curTod(),wk=weather(),wet=wk==='rain'||wk==='storm',cold=wk==='snow',night=tod==='night';
  if(night&&Math.random()<.65){goTo(r,r.home,'home');return;}
  if(wet&&Math.random()<.45){goTo(r,r.home,'home');return;}
  if(Math.random()<.2&&startTalk(r))return;
  const bard=RES.some(o=>o.role==='bard'&&o.working),merch=RES.some(o=>o.role==='merchant'&&o.working);
  const catOn=b=>PETS.some(p=>p.benchN===b);
  const sitB=BENCHES.filter(b=>occupancy(b,r)<2&&!benchNapped(b,r)&&!catOn(b)),napB=BENCHES.filter(b=>occupancy(b,r)===0&&!catOn(b));
  const opts=[
    {act:'wander',w:wet?1:3},{act:'sit',node:sitB.length?pick(sitB):'L',cap:sitB.length?99:0,w:wet?.2:2.4},{act:'fish',node:'M',cap:1,w:wet?.3:1.4},
    {act:'bnap',node:napB.length?pick(napB):'L',cap:napB.length?99:0,w:wet||cold?0:night?2.2:.9},
    {act:'nap',node:'NT',cap:2,w:wet||cold?0:night?1.5:.7},{act:'chat',node:'P',cap:4,w:wet?.5:2},{act:'well',node:'WL',cap:1,w:.6},
    {act:'watch',node:'AUD',cap:4,w:bard?3.5:0},{act:'tea',node:'TEA',cap:2,w:wet?3:1.5},{act:'soak',node:'OS',cap:3,w:cold?4:night?2:1.2},
    {act:'browse',node:'U',cap:3,w:merch?2.5:.8},{act:'home',node:r.home,cap:99,w:.5},
  ].filter(o=>o.w>0&&(!o.node||occupancy(o.node,r)<o.cap));
  let k=Math.random()*opts.reduce((s,o)=>s+o.w,0),ch=opts[0];
  for(const o of opts){if((k-=o.w)<=0){ch=o;break;}}
  goTo(r,ch.node||pick(WANDER.filter(n=>n!==r.node)),ch.act);
}
/* ---------- small talk + background chores: nobody stands frozen ---------- */
const NO_TALK=new Set(['fish','soak','tea','home','bnap','nap','sleep','talk','listen','well']);
const TALK_GL=['dots','heart','note','?','!','idea','dots'];
function validTalk(r){const p=r.partner;return !!p&&p.partner===r&&(p.act==='talk'||p.act==='listen')&&!p.hidden;}
function canTalk(o,me){return o!==me&&!o.hidden&&!o.working&&!o.path.length&&o.wait<=0&&o.pose!=='sleep'&&o!==selected&&!NO_TALK.has(o.act)&&Math.hypot(o.x-me.x,o.y-me.y)<170;}
function startTalk(r){
  if(afk)return false;
  const cands=RES.filter(o=>canTalk(o,r));if(!cands.length)return false;
  const o=pick(cands),side=r.x<o.x?-1:1;        // r stands on this side of o
  goTo(r,o.node,'talk');
  const last=r.path[r.path.length-1];last.x=o.x+side*11;last.y=o.y+(o.pose==='sit'?2:0);
  r.partner=o;r.spotFace=-side;
  o.path=[];o.act='listen';o.partner=r;o.timer=40;o.face=side;if(o.pose!=='sit')o.pose='stand';
  return true;
}
function potter(r){                              // stroll a few steps along the road near the hangout, then back
  const hang=ROLES[r.role].hang;
  if(r.node!==hang){goTo(r,hang,'idle');return;}
  const nbs=ADJ[hang].filter(n=>!N[n].z&&N[n].j!==0);
  if(!nbs.length){r.act='idle';r.pose='stand';r.timer=3+Math.random()*3;return;}
  const nb=pick(nbs),k=.3+Math.random()*.4,h=N[hang];
  goTo(r,hang,'idle');
  r.path=[{x:h.x,y:h.y},{x:lerp(h.x,N[nb].x,k),y:lerp(h.y,N[nb].y,k),id:hang}];
}
/* resident whose app is open but not focused: chat, do light chores, or potter around */
function planOnCall(r){
  if(afk){sleepHere(r);return;}
  const role=ROLES[r.role],k=Math.random();
  if(k<.35&&startTalk(r))return;
  if(k<.65){if(role.work==='explore')exploreNext(r);else goTo(r,role.work,'chore');return;}
  potter(r);
}
function gotoJob(r){
  if(afk){sleepHere(r);return;}
  const role=ROLES[r.role];
  if(r.working){if(role.work==='explore')exploreNext(r);else goTo(r,role.work,'work');}
  else goTo(r,role.hang,'idle');
}

/* =====================================================================
   APPS → JOBS
   ===================================================================== */
const SIM_APPS=[
  {id:'code',name:'VS Code',role:'blacksmith',open:true},
  {id:'chrome',name:'Chrome',role:'traveler',open:true},
  {id:'term',name:'Terminal',role:'wizard',open:true,ai:'claude'},
  {id:'spotify',name:'Spotify',role:'bard',open:true},
  {id:'notion',name:'Notion',role:'scholar',open:true},
  {id:'discord',name:'Discord',role:'messenger',open:false},
  {id:'explorer',name:'File Explorer',role:'scout',open:false},
  {id:'steam',name:'Steam',role:'samurai',open:false},
  {id:'figma',name:'Figma',role:'artist',open:false},
  {id:'excel',name:'Excel',role:'merchant',open:false},
];
let simFg='code',source='sim',afk=false,lastAfk=false;
let live={ok:false,apps:[],windows:0};
const FRIENDLY={'code.exe':'VS Code','chrome.exe':'Chrome','msedge.exe':'Edge','firefox.exe':'Firefox','brave.exe':'Brave','opera.exe':'Opera','windowsterminal.exe':'Terminal','wt.exe':'Terminal','powershell.exe':'PowerShell','pwsh.exe':'PowerShell','cmd.exe':'Command Prompt','spotify.exe':'Spotify','discord.exe':'Discord','slack.exe':'Slack','teams.exe':'Teams','ms-teams.exe':'Teams','outlook.exe':'Outlook','telegram.exe':'Telegram','explorer.exe':'File Explorer','devenv.exe':'Visual Studio','vlc.exe':'VLC','idea64.exe':'IntelliJ','pycharm64.exe':'PyCharm','claude.exe':'Claude','notion.exe':'Notion','obsidian.exe':'Obsidian','winword.exe':'Word','excel.exe':'Excel','powerpnt.exe':'PowerPoint','steam.exe':'Steam','figma.exe':'Figma','photoshop.exe':'Photoshop','blender.exe':'Blender','cursor.exe':'Cursor','whatsapp.exe':'WhatsApp','whatsapp.root.exe':'WhatsApp','notepad.exe':'Notepad','mspaint.exe':'Paint','olk.exe':'Outlook','epicgameslauncher.exe':'Epic Games','chatgpt.exe':'ChatGPT','zoom.exe':'Zoom','obs64.exe':'OBS'};
function currentApps(){
  if(source==='live'&&live.ok)return live.apps.map(a=>{const exe=(a.exe||a.kind||'app');return{id:a.id||exe,opened:a.opened_at,focusSince:a.focused_since,focusTotal:a.focus_total||0,count:a.count||1,name:FRIENDLY[exe.toLowerCase()]||exe.replace(/\.exe$/i,''),role:ROLES[a.role]?a.role:'villager',fg:!!a.foreground,ai:(a.ai_tools||[])[0]||null};});
  return SIM_APPS.filter(a=>a.open).map(a=>({...a,fg:a.id===simFg}));
}
const jobs=new Map();
function log(msg){if(window.onTownLog)window.onTownLog(msg);}
/* one resident per job: apps of the same kind (e.g. Terminal + Claude) share a single Wizard, never two identical workers */
function groupByRole(list){
  const g=new Map();
  for(const a of list){if(!g.has(a.role))g.set(a.role,[]);g.get(a.role).push(a);}
  return [...g].map(([role,items])=>{
    items.sort((a,b)=>(b.fg-a.fg)||((a.opened||0)-(b.opened||0)));
    const main=items[0];
    return{...main,id:'role:'+role,role,fg:items.some(a=>a.fg),ai:items.map(a=>a.ai).find(Boolean)||null,list:items,
      name:items.length>1?`${main.name} +${items.length-1}`:main.name};
  });
}
function sync(){
  const apps=groupByRole(currentApps()).slice(0,RES.length),ids=new Set(apps.map(a=>a.id));
  if(afk!==lastAfk){
    lastAfk=afk;PETS.forEach(p=>{p.timer=Math.min(p.timer,.5+Math.random()*2);});
    if(afk){RES.forEach(sleepHere);log('You stepped away. The town dozes off');}
    else{log('Welcome back! The town wakes up');RES.forEach(r=>{say(r,'!',1);r.react=.5;r.wait=.5;if(r.app)r.working=null;else planLeisure(r);});}
  }
  for(const [id,r] of [...jobs])if(!ids.has(id)){
    jobs.delete(id);const nm=r.app?r.app.name:id;r.app=null;r.role=null;r.working=false;
    say(r,'dots',1.6);r.wait=.6;log(`${r.name} clocked out (${nm} closed)`);planLeisure(r);
  }
  for(const a of apps){
    let r=jobs.get(a.id),fresh=false;
    if(!r){
      r=RES.find(o=>!o.app&&!o.hidden&&o!==selected)||RES.find(o=>!o.app);if(!r)continue;
      jobs.set(a.id,r);fresh=true;r.working=null;say(r,'!',1.2);r.react=.7;r.wait=.7;
      log(`${r.name} became the ${ROLES[a.role].label} (${a.name} opened)`);
    }
    r.app=a;r.role=a.role;
    const w=!!a.fg&&!afk;
    if(r.working!==w){
      r.working=w;
      if(w){if(!fresh){say(r,'!',1);r.react=.5;r.wait=.5;}log(`${r.name} is ${ROLES[a.role].verb} (${a.name} in focus)`);}
      gotoJob(r);
    }
  }
  if(window.onTownSync)window.onTownSync();
}
async function pollLive(){
  if(source!=='live')return;
  try{const res=await fetch(AGENT+'/status',{cache:'no-store'});const j=await res.json();live={ok:true,apps:j.apps||[],windows:j.windows_count||0};if(WALL)afk=!!j.afk;}
  catch(e){live={ok:false,apps:[],windows:0};}
  sync();
}

/* =====================================================================
   ENVIRONMENT — real time + real weather
   ===================================================================== */
const ENV={timeMode:'auto',manualMin:720,fastBase:0,weatherMode:'auto',real:null,sunrise:360,sunset:1080,place:'',status:'',loc:null};
const WNAME={clear:'Clear',cloudy:'Cloudy',rain:'Rain',storm:'Thunderstorm',snow:'Snow',fog:'Fog'};
const WMO={0:['clear','Clear sky'],1:['clear','Mainly clear'],2:['cloudy','Partly cloudy'],3:['cloudy','Overcast'],45:['fog','Fog'],48:['fog','Rime fog'],
  51:['rain','Light drizzle'],53:['rain','Drizzle'],55:['rain','Heavy drizzle'],56:['rain','Freezing drizzle'],57:['rain','Freezing drizzle'],
  61:['rain','Light rain'],63:['rain','Rain'],65:['rain','Heavy rain'],66:['rain','Freezing rain'],67:['rain','Freezing rain'],
  71:['snow','Light snow'],73:['snow','Snow'],75:['snow','Heavy snow'],77:['snow','Snow grains'],80:['rain','Rain showers'],81:['rain','Rain showers'],82:['storm','Violent showers'],
  85:['snow','Snow showers'],86:['snow','Snow showers'],95:['storm','Thunderstorm'],96:['storm','Thunderstorm + hail'],99:['storm','Thunderstorm + hail']};
function realMin(){const d=new Date();return d.getHours()*60+d.getMinutes()+d.getSeconds()/60;}
function nowMin(){if(ENV.timeMode==='manual')return ENV.manualMin;if(ENV.timeMode==='fast')return(((ENV.fastBase+T*12)%1440)+1440)%1440;return realMin();}
function weather(){return ENV.weatherMode==='auto'?(ENV.real?ENV.real.kind:'clear'):ENV.weatherMode;}
function elev(m){
  const sr=ENV.sunrise,ss=ENV.sunset;
  if(m>=sr&&m<=ss)return Math.sin(Math.PI*(m-sr)/(ss-sr));
  const nl=1440-(ss-sr),pos=(((m-ss)%1440)+1440)%1440/nl;return -Math.sin(Math.PI*Math.min(1,pos));
}
function curTod(){const e=elev(nowMin());return e>.12?'day':e>-.12?'dusk':'night';}
function phaseLabel(){const m=nowMin(),e=elev(m);return e>.12?'Day':e>-.12?(m<720?'Dawn':'Sunset'):'Night';}
async function fetchWeather(lat,lon,place){
  try{
    const u=`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=temperature_2m,weather_code,wind_speed_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
    const j=await (await fetch(u)).json();
    const w=WMO[j.current.weather_code]||['clear','Clear'];
    ENV.real={kind:w[0],desc:w[1],temp:Math.round(j.current.temperature_2m),wind:j.current.wind_speed_10m};
    const toMin=s=>{const [h,mm]=s.split('T')[1].split(':').map(Number);return h*60+mm;};
    ENV.sunrise=toMin(j.daily.sunrise[0]);ENV.sunset=toMin(j.daily.sunset[0]);
    ENV.loc={lat,lon,place};ENV.place=place;ENV.status='';
    try{localStorage.setItem('db_loc',JSON.stringify(ENV.loc));}catch(e){}
  }catch(e){ENV.status='Weather unavailable. Check your internet connection';setTimeout(()=>fetchWeather(lat,lon,place),60000);}
  envChanged();
}
let cfgKey='';
async function loadConfigLocation(){
  try{
    const c=await (await fetch(AGENT+'/config',{cache:'no-store'})).json();
    const key=JSON.stringify([c.lat,c.lon,c.city]);if(key===cfgKey)return true;cfgKey=key;
    if(typeof c.lat==='number'&&typeof c.lon==='number'){fetchWeather(c.lat,c.lon,c.place||c.city||'Your location');return true;}
    if(c.city){setCity(c.city);return true;}
  }catch(e){}
  return false;
}
async function detectLocation(){
  if(await loadConfigLocation()){if(WALL)setInterval(loadConfigLocation,60000);return;}
  if(WALL){ENV.status='Set your city at '+location.origin+'/settings.html';envChanged();setInterval(loadConfigLocation,60000);return;}
  let saved=null;try{saved=JSON.parse(localStorage.getItem('db_loc')||'null');}catch(e){}
  if(saved){fetchWeather(saved.lat,saved.lon,saved.place);return;}
  if(!navigator.geolocation){ENV.status='Type your city to get real weather';envChanged();return;}
  ENV.status='Asking browser for your location…';envChanged();
  navigator.geolocation.getCurrentPosition(p=>fetchWeather(p.coords.latitude,p.coords.longitude,'Your location'),
    ()=>{ENV.status='Location not available. Type your city for real weather';envChanged();},{timeout:12000,maximumAge:3600000});
}
async function setCity(name){
  ENV.status='Looking up '+name+'…';envChanged();
  try{const j=await (await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name='+encodeURIComponent(name))).json();
    const r=j.results&&j.results[0];if(!r){ENV.status='City not found';envChanged();return;}
    fetchWeather(r.latitude,r.longitude,r.name+(r.country_code?', '+r.country_code:''));
  }catch(e){ENV.status='City lookup failed';envChanged();}
}
setInterval(()=>{if(ENV.loc)fetchWeather(ENV.loc.lat,ENV.loc.lon,ENV.loc.place);},15*60*1000);
function setTimeMode(v){if(v==='fast')ENV.fastBase=nowMin()-T*12;if(v==='manual'&&ENV.timeMode!=='manual')ENV.manualMin=Math.floor(nowMin());ENV.timeMode=v;envChanged();}
function envIcon(){const wk=weather(),e=elev(nowMin());return{clear:e>-.05?'☀':'☾',cloudy:'☁',rain:'🌧',storm:'⛈',snow:'❄',fog:'🌫'}[wk];}
function envDesc(){return ENV.weatherMode==='auto'?(ENV.real?ENV.real.desc:'Clear'):WNAME[weather()];}
function envSummaryHTML(){
  const t=ENV.real&&ENV.weatherMode==='auto'?` · ${ENV.real.temp}°C`:'';
  const mode=ENV.timeMode==='auto'?'real time':ENV.timeMode==='fast'?'fast-forward':'picked time';
  return `${envIcon()} <b>${fmt(nowMin())}</b> · ${phaseLabel()} · ${esc(envDesc())}${t}<br><span class="sub">${ENV.place?esc(ENV.place)+' · ':''}sunrise ${fmt(ENV.sunrise)} · sunset ${fmt(ENV.sunset)} · ${mode}${ENV.weatherMode==='auto'?'':' · weather override'}</span>${ENV.status?`<br><span class="st">${esc(ENV.status)}</span>`:''}`;
}
function envChanged(){if(window.__envUI)window.__envUI();if(window.onEnvChange)window.onEnvChange();}
function bindEnv(){
  const ts=document.getElementById('envTime'),sl=document.getElementById('envSlider'),ws=document.getElementById('envWeather'),ci=document.getElementById('envCity'),cb=document.getElementById('envCityBtn'),info=document.getElementById('envInfo');
  const segOn=(el,v)=>el&&el.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  if(ts)ts.addEventListener('click',e=>{const b=e.target.closest('button');if(b)setTimeMode(b.dataset.v);});
  if(sl)sl.addEventListener('input',()=>{ENV.timeMode='manual';ENV.manualMin=+sl.value;envChanged();});
  if(ws)ws.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;ENV.weatherMode=b.dataset.v;envChanged();});
  const go=()=>{if(ci&&ci.value.trim())setCity(ci.value.trim());};
  if(cb)cb.addEventListener('click',go);
  if(ci)ci.addEventListener('keydown',e=>{if(e.key==='Enter')go();});
  window.__envUI=()=>{segOn(ts,ENV.timeMode);segOn(ws,ENV.weatherMode);if(sl&&ENV.timeMode!=='manual')sl.value=Math.floor(nowMin());if(info)info.innerHTML=envSummaryHTML();};
  setInterval(()=>window.__envUI(),1000);
}

/* =====================================================================
   DRAW A RESIDENT (body only — outline/shadow/extras in drawResident)
   ===================================================================== */
function drawPerson(c,r,t,X,Y){
  const role=r.role?ROLES[r.role]:null;
  const top=role?role.top:r.top,bot=role?role.bot:r.bot,acc=role?role.acc:null;
  const skin=r.skin,hair=r.hair,pose=r.pose;
  const x=Math.round(X??r.x),y=Math.round(Y??r.y);
  if(pose==='sleep'){
    const bx=x-7,by=y-5;
    R(c,bx+3,by,12,4,top);R(c,bx+3,by+3,12,1,shade(top));R(c,bx+12,by,3,4,bot);R(c,bx+14,by+1,2,2,'#2a2020');
    R(c,bx,by-1,4,5,skin);R(c,bx-1,by-1,2,5,hair);R(c,bx,by-2,4,1,hair);R(c,bx+1,by+1,2,1,shade(skin));
    if(acc==='wizard'){R(c,bx-3,by-1,3,4,'#3b2f5c');R(c,bx-4,by,1,2,'#3b2f5c');}
    if(acc==='straw')R(c,bx-3,by-2,2,7,'#d9b45a');
    return;
  }
  let bob=0,la=0,lb=0,sw=0;
  if(pose==='walk'){const ph=Math.floor(t*8+r.seed*3)%4;la=ph===0?-1:0;lb=ph===2?-1:0;bob=(ph===1||ph===3)?-1:0;sw=ph<2?1:-1;}
  if(pose==='work'){ // busy body rhythm: workers never stand frozen
    const wp=(t*({hammer:1.6,katana:1.6,broom:2,shamisen:2.4,abacus:2.2}[acc]||1.8)+r.seed)%1;
    bob=wp<.5?0:-1;
    if(acc==='straw'||acc==='book'||acc==='satchel'){la=wp<.5?0:-1;lb=wp<.5?-1:0;} // shifting feet while busy
  }
  if(r.react>0)bob=-1-(Math.floor(r.react*12)%2);
  const sit=pose==='sit'||pose==='fish',working=pose==='work';
  const ox=x-4,oy=y-16+bob+(sit?3:0),f=r.face||0;
  const P=(cx,ry,w,h,col)=>{c.fillStyle=col;c.fillRect(ox+cx,oy+ry,w,h);};
  const skirt=acc==='wizard'||acc==='katana'||(!role&&r.skirt),feet='#2a2020';
  if(acc==='pack'){P(0,6,9,7,'#6b4a2a');P(0,6,9,1,'#8a6238');P(1,4,7,2,'#a0563a');P(1,4,7,1,'#c0704a');}
  if(sit){P(1,12,7,2,bot);P(f<0?0:6,13,3,1,feet);}
  else if(skirt){P(1,12,7,4,bot);P(1,15,7,1,shade(bot));P(2,16+la,2,1,feet);P(5,16+lb,2,1,feet);}
  else{P(2,12,2,4+la,bot);P(5,12,2,4+lb,bot);P(2,16+la,2,1,feet);P(5,16+lb,2,1,feet);}
  P(2,7,5,5,top);P(2,11,5,1,shade(top));P(3,7,3,1,lighten(top));
  if(acc==='hammer')P(3,8,3,6,'#3a2a1e');
  if(acc==='pack'){P(2,7,1,4,'#4a2c18');P(6,7,1,4,'#4a2c18');}
  if(acc==='satchel'){P(2,7,1,1,'#7a4a2a');P(3,8,1,1,'#7a4a2a');P(4,9,1,1,'#7a4a2a');P(5,10,1,1,'#7a4a2a');}
  if(acc==='wizard'){P(2,7,1,4,'#e8e2d4');P(4,7,1,5,'#c43a2c');}
  if(acc==='abacus'){P(2,7,1,5,'#f4ead0');P(6,7,1,5,'#f4ead0');}
  if(acc==='brush'){P(3,9,1,1,'#3a6ab0');P(5,8,1,1,'#e05a4a');P(4,10,1,1,'#3f9a4a');}
  if(acc==='katana'){P(3,7,3,1,'#e8e2d4');P(4,8,1,1,'#e8e2d4');}
  P(2,1,5,6,skin);P(2,6,5,1,shade(skin));
  P(2,0,5,2,hair);P(1,1,1,3,hair);P(7,1,1,3,hair);
  if(f>0)P(2,2,1,2,hair);else if(f<0)P(6,2,1,2,hair);else{P(2,2,1,1,hair);P(4,2,1,1,hair);P(6,2,1,1,hair);}
  const st=r.style;
  if(st==='long'){P(1,1,1,8,hair);P(7,1,1,8,hair);}
  if(st==='pony'){P(8,2,1,5,hair);P(7,2,1,1,'#d04a5a');}
  if(st==='bun')P(3,-2,3,2,hair);
  if(st==='spiky'){P(2,-1,1,1,hair);P(4,-1,1,1,hair);P(6,-1,1,1,hair);P(1,0,1,1,hair);P(7,0,1,1,hair);}
  if(st==='cat'){P(1,-1,2,2,hair);P(6,-1,2,2,hair);P(2,0,1,1,'#f2a0b8');P(6,0,1,1,'#f2a0b8');}
  const ex=f>0?4:f<0?2:3,blink=((t+r.seed*1.7)%4)<.13,eye=blink?shade(skin):'#1d1a26';
  P(ex,4,1,1,eye);P(ex+2,4,1,1,eye);
  if(f===0){P(2,5,1,1,'#f0a8a0');P(6,5,1,1,'#f0a8a0');}
  if(acc==='book'){P(ex-1,4,1,1,'#b8b8c8');P(ex+1,4,1,1,'#b8b8c8');P(ex+3,4,1,1,'#b8b8c8');}
  if(acc==='hammer')P(2,1,5,1,'#e8e0d0');
  if(acc==='katana'){P(2,1,5,1,'#d63a2f');P(7,1,2,1,'#d63a2f');P(8,2,1,1,'#d63a2f');}
  if(acc==='wizard'){const hc='#3b2f5c';P(0,1,9,1,hc);P(1,0,7,1,hc);P(2,-1,5,1,'#d4a017');P(3,-2,3,1,hc);P(3,-3,3,1,hc);P(4,-4,2,1,hc);P(5,-5,2,1,hc);P(6,-6,1,1,hc);}
  if(acc==='straw'){P(-1,1,11,1,'#d9b45a');P(0,1,9,1,'#e6c56e');P(2,-1,5,2,'#d9b45a');P(2,0,5,1,'#a0563a');}
  if(acc==='brush'){P(1,0,7,1,'#c63b2c');P(2,-1,5,1,'#c63b2c');P(5,-2,1,1,'#c63b2c');}
  let lArm=true,rArm=true;
  const ph=(t*1.6+r.seed)%1;
  if(working){
    switch(acc){
      case 'hammer':rArm=false;
        if(ph<.6){P(7,5,1,4,top);P(7,4,1,1,skin);P(8,0,1,5,'#7a5030');P(7,-1,3,2,'#9aa0b3');}
        else{P(7,8,1,2,top);P(8,10,1,1,skin);P(9,10,3,1,'#7a5030');P(12,9,2,3,'#9aa0b3');}
        break;
      case 'wizard':{rArm=false;const gl=Math.sin(t*5)>0;P(7,6,1,3,top);P(7,5,1,1,skin);P(8,-2,1,15,'#7a5030');P(7,-5,3,3,gl?'#bdf0ff':'#7fd3ff');P(8,-4,1,1,'#ffffff');break;}
      case 'shamisen':lArm=rArm=false;
        P(2,9,3,3,'#ecdcb4');P(2,9,3,1,'#5a3a24');P(5,8,1,1,'#5a3a24');P(6,7,1,1,'#5a3a24');P(7,6,1,1,'#5a3a24');P(8,5,1,1,'#5a3a24');P(9,4,1,1,'#3a2a1a');
        P(1,8,1,3,top);P(2,ph<.5?10:11,1,1,skin);P(7,8,1,1,top);P(8,6,1,1,skin);break;
      case 'satchel':{lArm=rArm=false;const up=ph<.5;P(6,10,3,3,'#a0663a');P(6,10,3,1,'#7a4a2a');P(1,8,1,2,top);P(7,8,1,2,top);
        if(up){P(-1,5,4,3,'#fbf3df');P(0,6,2,1,'#c63b2c');P(1,7,1,2,skin);P(7,10,1,1,skin);}   // hold a letter up to read it…
        else{P(5,8,4,3,'#fbf3df');P(6,9,2,1,'#c63b2c');P(1,10,1,1,skin);P(7,9,1,1,skin);}      // …then file it in the satchel
        break;}
      case 'straw':{lArm=rArm=false;const l=ph<.5?0:-2;P(1,8,1,2,top);P(7,8,1,2,top);P(-1,10+l,11,4,'#ead7a2');P(-1,10+l,11,1,'#c9b07a');P(1,11+l,3,1,'#5a9a4a');P(4,12+l,2,1,'#5a9a4a');P(6,11+l,1,1,'#c43a2c');P(-1,11+l,1,1,skin);P(9,11+l,1,1,skin);break;}
      case 'broom':{rArm=false;const s=ph<.5?0:2;P(7,8,1,3,top);P(7,11,1,1,skin);P(7+s/2,9,1,6,'#9c6438');P(5+s,14,4,2,'#d9b45a');break;}
      case 'book':{lArm=rArm=false;const pg=Math.floor((t*1.4+r.seed)%3);P(1,8,1,2,top);P(7,8,1,2,top);P(1,9,7,3,'#f8f0dc');P(4,9,1,3,'#b0a080');P(2,10,2,1,'#9a9080');P(5,10,2,1,'#9a9080');
        if(pg===1)P(4,7,3,3,'#ffffff');if(pg===2)P(2,7,3,3,'#ffffff');P(1,11,1,1,skin);P(7,pg?9:11,1,1,skin);break;} // turning pages
      case 'katana':rArm=false;
        if(ph<.45){P(7,5,1,4,top);P(7,4,1,1,skin);P(6,3,3,1,'#c9a050');P(7,-6,1,9,'#dfe5ee');P(7,-6,1,1,'#ffffff');}
        else{P(7,9,2,1,top);P(9,9,1,1,skin);P(10,9,1,1,'#c9a050');for(let i=0;i<6;i++)P(11+i,10+i,1,1,'#dfe5ee');}
        break;
      case 'brush':{lArm=rArm=false;const d=ph<.5?0:1;P(1,8,1,2,top);P(-1,10,3,2,'#d9b45a');P(-1,10,1,1,'#e05a4a');P(1,11,1,1,'#3a6ab0');P(7,8,2,1,top);P(9,8+d,1,1,skin);P(10,7+d,2,1,'#9c6438');P(12,7+d,1,1,pick(['#e05a4a','#3a6ab0','#ffd166']));break;}
      case 'abacus':{lArm=rArm=false;P(1,8,1,2,top);P(7,8,1,2,top);P(1,10,7,3,'#6b4226');P(2,11,5,1,'#3a2416');for(let i=0;i<5;i++)P(2+i,((i+Math.floor(ph*4))%2)?10:12,1,1,i%2?'#e05a4a':'#ffd166');P(1,10,1,1,skin);P(7,10,1,1,skin);break;}
    }
  }else{
    if(acc==='hammer'){P(8,9,1,3,'#7a5030');P(7,8,3,2,'#9aa0b3');}
    if(acc==='wizard'){P(8,3,1,13,'#7a5030');P(8,1,2,2,'#7fd3ff');P(8,1,1,1,'#ffffff');}
    if(acc==='shamisen'){P(-1,6,1,2,'#5a3a24');P(0,8,1,2,'#5a3a24');P(1,10,3,3,'#ecdcb4');P(1,10,3,1,'#5a3a24');}
    if(acc==='satchel'){P(6,10,3,3,'#a0663a');P(6,10,3,1,'#7a4a2a');}
    if(acc==='broom'){P(8,4,1,10,'#9c6438');P(7,13,3,3,'#d9b45a');}
    if(acc==='book'){P(7,9,2,4,'#8a3a2a');P(7,9,2,1,'#c9a050');}
    if(acc==='katana'){P(0,9,1,1,'#2a2a2a');P(-1,10,1,1,'#2a2a2a');P(-2,11,1,1,'#1a1a2a');P(-3,12,1,1,'#1a1a2a');}
    if(acc==='brush'){P(8,7,1,5,'#9c6438');P(8,6,1,1,'#e05a4a');}
    if(acc==='abacus'){P(6,11,3,2,'#c9a050');P(7,10,1,1,'#8a6a2a');}
  }
  if(!working&&r.act==='talk'&&r.bubble){       // talking: gesture with a hand + moving mouth
    const g=Math.floor(t*5+r.seed)%2;
    if(f<0){lArm=false;P(1,8,1,1,top);P(0,g?6:7,1,2,top);P(0,g?5:6,1,1,skin);}
    else{rArm=false;P(7,8,1,1,top);P(8,g?6:7,1,2,top);P(8,g?5:6,1,1,skin);}
    if(f!==0&&Math.floor(t*7+r.seed)%2)P(f>0?5:3,6,1,1,'#8a3a3a');
  }
  if(lArm){P(1,8,1,3,top);P(1,sw>0?10:11,1,1,skin);}
  if(rArm){P(7,8,1,3,top);P(7,sw<0?10:11,1,1,skin);}
}
/* outlined resident + shadow + extras (fishing line, umbrella, hot-spring water) */
const [tpC,tp]=mk(48,44),[slC,sl]=mk(48,44);const AX=24,AY=36;
function drawResident(c,r,t){
  if(r.hidden)return;
  const x=Math.round(r.x),y=Math.round(r.y),soak=r.pose==='soak';
  if(!soak&&!(r.act==='bnap'&&r.pose==='sleep')){c.fillStyle='rgba(18,28,18,.32)';c.fillRect(x-4,y-1,9,2);c.fillRect(x-3,y,7,1);}
  tp.clearRect(0,0,48,44);drawPerson(tp,r,t,AX,AY);
  sl.globalCompositeOperation='source-over';sl.clearRect(0,0,48,44);sl.drawImage(tpC,0,0);
  sl.globalCompositeOperation='source-in';sl.fillStyle='#160f1c';sl.fillRect(0,0,48,44);sl.globalCompositeOperation='source-over';
  const ox=x-AX,oy=y-AY+(soak?3:0);
  c.globalAlpha=.9;c.drawImage(slC,ox+1,oy);c.drawImage(slC,ox-1,oy);c.drawImage(slC,ox,oy+1);c.drawImage(slC,ox,oy-1);c.globalAlpha=1;
  c.drawImage(tpC,ox,oy);
  if(soak){oval(c,x,y-3,8,4,'#7fcbe0');R(c,x-6,y-7,13,1,'#bfeefa');R(c,x-4+Math.round(Math.sin(t*2+r.seed)*2),y-4,3,1,'#bfeefa');}
  if(r.pose==='fish'){
    const tx=x+13,ty=y-18;
    for(let i=0;i<=10;i++)R(c,lerp(x+4,tx,i/10),lerp(y-2,ty,i/10),1,1,'#6a4428');
    const bx=x+18,by=y+22+Math.round(Math.sin(t*2+r.seed));
    c.fillStyle='rgba(240,240,255,.6)';for(let i=0;i<=24;i++)c.fillRect(Math.round(lerp(tx,bx,i/24)),Math.round(lerp(ty,by,i/24)-Math.sin(i/24*Math.PI)*3),1,1);
    R(c,bx,by-1,1,1,'#ffffff');R(c,bx,by,1,1,'#d63a2f');
  }
  const wk=weather();
  if((wk==='rain'||wk==='storm'||wk==='snow')&&!soak&&r.pose!=='sleep'&&r.pose!=='work'&&r.act!=='tea'){
    const ux=x+1,uy=y-27+(r.pose==='sit'||r.pose==='fish'?3:0),u=r.umb;
    R(c,ux,uy+1,1,9,'#5a3a24');
    R(c,ux-3,uy-2,7,1,u);R(c,ux-5,uy-1,11,1,u);R(c,ux-6,uy,13,1,u);R(c,ux-7,uy+1,15,1,shade(u));
    R(c,ux-1,uy-3,3,1,'#2a1a10');R(c,ux-4,uy-1,1,1,lighten(u));R(c,ux+4,uy-1,1,1,lighten(u));
  }
}

/* =====================================================================
   PARTICLES (ambient + per-resident) and WEATHER
   ===================================================================== */
const parts=[];
function emit(p){p.max=p.life;parts.push(p);if(parts.length>800)parts.shift();}
function updateParts(dt,t){
  for(let i=parts.length-1;i>=0;i--){
    const p=parts[i];p.life-=dt;
    if(p.life<=0||p.y>TH+6||p.x>TW+6||p.x<-6||p.y<-10){parts.splice(i,1);continue;}
    p.vy+=(p.g||0)*dt;
    if(p.kind==='petal')p.vx=(weather()==='storm'?30:10)+Math.sin(t*1.5+p.ph)*9;
    if(p.kind==='smoke'){p.size+=dt*1.4;p.vx+=dt*3;}
    if(p.kind==='firefly'){p.vx+=(Math.random()-.5)*30*dt;p.vy+=(Math.random()-.5)*30*dt;}
    if(p.kind==='note'||p.kind==='rune')p.x+=Math.sin(t*3+p.ph)*.25;
    p.x+=p.vx*dt;p.y+=p.vy*dt;
  }
}
function drawParts(c,glow){
  for(const p of parts){
    if(!!p.glow!==glow)continue;
    const a=clamp(p.life/p.max*1.6);c.globalAlpha=a;
    const x=Math.round(p.x),y=Math.round(p.y);
    switch(p.kind){
      case 'note':glyph(c,GL.note,x,y,p.col);break;
      case 'mail':R(c,x-1,y-1,7,6,'#231a2a');glyph(c,GL.mail,x,y,'#fffaf0');break;
      case 'coin':glyph(c,GL.coin,x,y,'#ffd166');break;
      case 'smoke':c.globalAlpha=a*(p.alpha||.5);disc(c,x,y,p.size,p.col);break;
      case 'petal':R(c,x,y,Math.sin(p.ph+T*5)>0?2:1,1,p.col);break;
      case 'firefly':c.globalAlpha=a*(.5+.5*Math.sin(T*6+p.ph));R(c,x,y,1,1,p.col);break;
      default:R(c,x,y,p.size||1,p.size||1,p.col);
    }
  }
  c.globalAlpha=1;
}
function ambient(dt,wk){
  const tod=curTod(),wet=wk==='rain'||wk==='storm'||wk==='snow';
  if(Math.random()<dt*(wet?1.5:7)){const tr=pick(TREES);emit({kind:'petal',x:tr.x+(Math.random()-.5)*tr.r*2,y:tr.y+(Math.random()-.5)*tr.r*.8,vx:10,vy:7+Math.random()*7,life:9,ph:Math.random()*6,col:pick(['#f7b6cf','#ffd6e5','#e98fb0'])});}
  if(!wet&&Math.random()<dt*2)emit({kind:'petal',x:-4,y:40+Math.random()*260,vx:14,vy:5+Math.random()*5,life:16,ph:Math.random()*6,col:pick(['#f7b6cf','#ffd6e5'])});
  if(Math.random()<dt*(roleWorking('blacksmith')?5:2.2))emit({kind:'smoke',x:100+Math.random()*3,y:66,vx:2,vy:-7-Math.random()*3,size:1.5,life:3.5,col:'#dcdce2'});
  if(Math.random()<dt*(wk==='snow'||tod==='night'?5:2.5))emit({kind:'smoke',x:548+Math.random()*36,y:292,vx:1,vy:-6-Math.random()*3,size:1.5,life:3,col:'#ffffff',alpha:.35});
  if(tod==='night'&&!wet&&Math.random()<dt*2.5)emit({kind:'firefly',glow:true,x:Math.random()*TW,y:170+Math.random()*180,vx:0,vy:0,life:5,ph:Math.random()*6,col:'#e8ff8a'});
  if(Math.random()<dt*1.2)emit({x:126+Math.random()*6,y:311,vx:(Math.random()-.5)*14,vy:-10,g:50,life:.5,col:'#cfeeff'});
  if(roleWorking('artist')){ART.p+=dt*1.5;if(ART.p>ART.dots.length+8)newPainting();}
}
function residentFx(r,dt,t){
  if(r.path.length||r.wait>0||r.hidden)return;
  const ph=(t*1.6+r.seed)%1;
  if(r.pose==='work'){
    switch(r.role){
      case 'blacksmith':if(r.lastPh<.6&&ph>=.6)for(let i=0;i<7;i++)emit({glow:true,x:r.x+9,y:r.y-7,vx:(Math.random()-.3)*40,vy:-20-Math.random()*25,g:90,life:.5+Math.random()*.3,col:pick(['#ffe066','#ffb347','#ff7a1a'])});break;
      case 'wizard':if(Math.random()<dt*7){const a=Math.random()*6.28;emit({kind:'rune',glow:true,x:r.x+5+Math.cos(a)*5,y:r.y-20+Math.sin(a)*3,vx:0,vy:-9,life:1.3,ph:a,col:pick(['#7fd3ff','#bdf0ff','#a98bff'])});}break;
      case 'bard':if(Math.random()<dt*1.6)emit({kind:'note',x:r.x-2+Math.random()*6,y:r.y-22,vx:(Math.random()-.5)*8,vy:-11,life:2.2,ph:Math.random()*6,col:pick(['#ff8fc7','#ffd166','#8f7bff','#4fd1a5'])});break;
      case 'messenger':if(Math.random()<dt*.5)emit({kind:'mail',x:r.x,y:r.y-16,vx:16+Math.random()*8,vy:-14,life:2.4});break;
      case 'scout':if(Math.random()<dt*.25)say(r,'?',1.2);break;
      case 'scholar':if(Math.random()<dt*.18)say(r,'idea',1.4);break;
      case 'samurai':if(r.lastPh<.45&&ph>=.45)for(let i=0;i<8;i++){const a=-1.2+i*.3;emit({glow:true,x:r.x+6+Math.cos(a)*9,y:r.y-10+Math.sin(a)*9,vx:Math.cos(a)*12,vy:Math.sin(a)*12,life:.25,col:'#ffffff'});}break;
      case 'artist':if(Math.random()<dt*3)emit({x:r.x+12,y:r.y-9,vx:(Math.random()-.5)*8,vy:-6,g:20,life:.6,col:pick(['#e05a4a','#3a6ab0','#ffd166','#4f9a3a'])});break;
      case 'merchant':if(Math.random()<dt*.9)emit({kind:'coin',x:r.x-1,y:r.y-14,vx:(Math.random()-.5)*16,vy:-26,g:70,life:.9});break;
      case 'villager':if(Math.random()<dt*5)emit({x:r.x+4+Math.random()*4,y:r.y-1,vx:(Math.random()-.5)*10,vy:-4,life:.6,col:'#c9b38a'});break;
    }
  }
  r.lastPh=ph;
  if(r.act==='fish'){
    if(Math.random()<dt*.35)emit({x:r.x+18+(Math.random()-.5)*4,y:r.y+22,vx:(Math.random()-.5)*6,vy:0,life:.7,col:'#bfe8ff'});
    if(Math.random()<dt*.05){say(r,'heart',1.6);for(let i=0;i<6;i++)emit({x:r.x+18,y:r.y+20,vx:(Math.random()-.5)*20,vy:-18,g:60,life:.6,col:'#e6f6ff'});}
  }
  if(r.act==='chat'&&Math.random()<dt*.45)say(r,pick(['dots','heart','note','?','dots']),1.5);
  if(r.act==='watch'&&Math.random()<dt*.3)say(r,pick(['heart','note']),1.3);
  if((r.act==='tea'||r.act==='soak')&&Math.random()<dt*.15)say(r,pick(['heart','dots']),1.4);
  if(r.act==='idle'&&Math.random()<dt*.06)say(r,'dots',1.3);
  if(r.act==='talk'&&validTalk(r)&&!r.bubble&&!r.partner.bubble&&Math.random()<dt*1.3)say(r,pick(TALK_GL),1.2+Math.random()*.6); // take turns speaking
}
const wparts=[];let flash=0,bolt=null,nextBolt=3;
function updateWeather(dt,wk){
  const rate={rain:260,storm:480,snow:70}[wk]||0;
  for(let n=rate*dt;n>0;n--){if(Math.random()>=n)continue;
    if(wk==='snow')wparts.push({k:'s',x:Math.random()*(TW+60)-30,y:-4,vx:6,vy:14+Math.random()*10,ph:Math.random()*6,ty:110+Math.random()*(TH-110),sz:Math.random()<.3?2:1});
    else wparts.push({k:'r',x:Math.random()*(TW+90),y:-6,vx:wk==='storm'?-70:-35,vy:230+Math.random()*60,ty:100+Math.random()*(TH-100)});}
  if(wparts.length>1600)wparts.splice(0,wparts.length-1600);
  for(let i=wparts.length-1;i>=0;i--){
    const p=wparts[i];
    if(p.k==='sp'){p.life-=dt;if(p.life<=0)wparts.splice(i,1);continue;}
    p.x+=(p.vx+(p.k==='s'?Math.sin(T*2+p.ph)*8:0))*dt;p.y+=p.vy*dt;
    if(p.y>=p.ty){if(p.k==='r'&&Math.random()<.5)wparts[i]={k:'sp',x:p.x,y:p.ty,life:.15};else wparts.splice(i,1);}
  }
  if(wk!=='rain'&&wk!=='storm'&&wk!=='snow')for(let i=wparts.length-1;i>=0;i--)if(wparts[i].y<0)wparts.splice(i,1);
  if(wk==='storm'&&T>nextBolt){flash=1;nextBolt=T+5+Math.random()*9;let x=60+Math.random()*(TW-120),y=0;bolt=[[x,y]];while(y<70+Math.random()*30){x+=(Math.random()-.5)*14;y+=6+Math.random()*6;bolt.push([x,y]);}}
  flash=clamp(flash-dt*2.6);
}
function drawWeather(c,wk){
  for(const p of wparts){
    if(p.k==='r'){c.fillStyle='rgba(200,220,255,.55)';c.fillRect(Math.round(p.x),Math.round(p.y),1,3);}
    else if(p.k==='s'){c.fillStyle='#ffffff';c.fillRect(Math.round(p.x),Math.round(p.y),p.sz,p.sz);}
    else{c.fillStyle='rgba(220,235,255,.7)';c.fillRect(Math.round(p.x)-1,Math.round(p.y),3,1);}
  }
  if(wk==='fog'){c.fillStyle='rgba(222,226,234,.30)';c.fillRect(0,0,TW,TH);for(let i=0;i<5;i++){const y=110+i*50,off=Math.sin(T*.2+i)*40;c.fillStyle='rgba(235,238,244,.16)';c.fillRect(-50+off,y,TW+100,16);}}
  if(flash>0){
    if(bolt&&flash>.55){c.fillStyle='#ffffff';for(let i=0;i<bolt.length-1;i++){const a=bolt[i],b=bolt[i+1],L=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let s=0;s<=L;s++)c.fillRect(Math.round(lerp(a[0],b[0],s/L)),Math.round(lerp(a[1],b[1],s/L)),1,1);}}
    c.fillStyle=`rgba(235,240,255,${flash*.35})`;c.fillRect(0,0,TW,TH);
  }
}

/* =====================================================================
   PETS (two town cats) + BIRDS (sky flocks, sparrows on the ground)
   ===================================================================== */
const CAT={
  walk:[["o.......o.o","o.......ooo",".o......oeo",".oododdooow","..oooooooo.","..o.o..o.o."],
        ["o.......o.o","o.......ooo",".o......oeo",".oododdooow","..oooooooo.",".o..o.o..o."]],
  sit:[["....o.o","....ooo","....oeo","...owwo","..ooooo","o.odooo","ooooowo"],
       ["....o.o","....ooo","....oeo","...owwo","o.ooooo","o.odooo",".oooowo"]],
  curl:["......o.o.","..ooodoooo",".ooodooko.","oooooooww."],
};
const PETS=[
  {name:'Mochi',kind:'orange tabby',pal:{o:'#e8913a',d:'#b5621f',w:'#fff1dc',e:'#2a1a10'},node:'P'},
  {name:'Kuro',kind:'black cat',pal:{o:'#3a3a48',d:'#26262f',w:'#eeeef2',e:'#d8e05a'},node:'S'},
].map((p,i)=>({...p,x:N[p.node].x+8,y:N[p.node].y+5,path:[],act:'sit',st:'sit',face:i?-1:1,timer:2+i*3,seed:i*2.3+.7,friend:null,benchN:null,z:null,bubble:null}));
let petLogT=0;
function petGo(p,node,act,fx,fy){
  p.benchN=null;p.z=null;p.act=act;
  p.path=route(p.node,node).map(id=>({x:N[id].x,y:N[id].y+4,id}));
  if(!p.path.length)p.path=[{x:fx,y:fy,id:node}];
  const last=p.path[p.path.length-1];last.x=fx;last.y=fy;last.id=node;
}
function petNap(p){
  const free=BENCHES.filter(b=>!PETS.some(o=>o!==p&&o.benchN===b)&&occupancy(b,null)===0);
  if(free.length&&Math.random()<.6){const b=pick(free);petGo(p,b,'curl',N[b].x+2,N[b].y-4);p.benchN=b;return;}
  const sleeper=RES.find(r=>r.act==='bnap'&&!r.path.length&&!r.hidden&&!PETS.some(o=>o!==p&&o.friend===r));
  if(sleeper&&Math.random()<.7){p.friend=sleeper;petGo(p,sleeper.target,'curl',sleeper.x+4,sleeper.y+9);return;}
  const n=pick(WANDER);petGo(p,n,'curl',N[n].x+(Math.random()-.5)*14,N[n].y+6);
}
function petPlan(p){
  const wk=weather(),wet=wk==='rain'||wk==='storm'||wk==='snow',night=curTod()==='night';
  p.friend=null;
  if(wet){const n=p.seed>1?'INN':'TEA';petGo(p,n,'curl',N[n].x+(p.seed>1?-14:14),N[n].y+1);return;}
  if(afk)return petNap(p);
  const awake=RES.filter(r=>!r.hidden&&!r.path.length&&r.wait<=0&&r.pose!=='soak'&&r.pose!=='sleep'&&!['SH','STG','OS','INN','TEA'].includes(r.target)&&!PETS.some(o=>o!==p&&o.friend===r));
  const fishers=awake.filter(r=>r.act==='fish'),flock=GB.find(b=>b.st==='peck');
  const opts=[['roam',3],['nap',night?4:1.2],['visit',awake.length?2.5:0],['fish',fishers.length?2.5:0],['hunt',flock?2:0]].filter(o=>o[1]>0);
  let k=Math.random()*opts.reduce((s,o)=>s+o[1],0),ch=opts[0][0];for(const o of opts)if((k-=o[1])<=0){ch=o[0];break;}
  if(ch==='nap')return petNap(p);
  if(ch==='visit'||ch==='fish'){const r=pick(ch==='fish'?fishers:awake),side=ch==='fish'?-1:(Math.random()<.5?-1:1);p.friend=r;petGo(p,r.target,'visit',r.x+side*10,r.y+1);return;}
  if(ch==='hunt'){let best='P',bd=1e9;for(const id of WANDER){const d=Math.hypot(N[id].x-flock.x,N[id].y-flock.y);if(d<bd){bd=d;best=id;}}petGo(p,best,'hunt',flock.x-flock.face*8,flock.y+1);return;}
  const n=pick(WANDER.filter(n=>n!==p.node));petGo(p,n,'sit',N[n].x+(Math.random()-.5)*16,N[n].y+4+Math.random()*3);
}
function petArrive(p){
  p.st=p.act==='curl'?'curl':'sit';
  const night=curTod()==='night';
  p.timer=p.st==='curl'?(night||afk?30+Math.random()*30:12+Math.random()*14):5+Math.random()*7;
  if(p.benchN)p.z=N[p.benchN].z+.5;
  const r=p.friend;
  if(r&&!r.hidden&&Math.hypot(r.x-p.x,r.y-p.y)<18){
    p.face=r.x>p.x?1:-1;
    if(p.act==='visit'&&r.pose!=='sleep'){say(r,'heart',1.6);p.bubble={type:'heart',t:1.4};
      if(T>petLogT){petLogT=T+45;log(`${p.name} the cat dropped by to see ${r.name}`);}}
  }
  if(p.act==='hunt'){p.bubble={type:'!',t:1};p.timer=2+Math.random()*2;}
}
function petStep(p,dt){
  if(p.bubble&&(p.bubble.t-=dt)<=0)p.bubble=null;
  if(p.path.length){
    const q=p.path[0],dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy),sp=(p.act==='hunt'?42:p.act==='visit'?28:22)*dt;
    if(Math.abs(dx)>.3)p.face=dx>0?1:-1;
    if(d<=sp){p.x=q.x;p.y=q.y;p.path.shift();if(q.id)p.node=q.id;if(!p.path.length)petArrive(p);}
    else{p.x+=dx/d*sp;p.y+=dy/d*sp;}
    return;
  }
  const f=p.friend;
  if(p.act==='visit'&&f&&(f.path.length||f.hidden))p.timer=Math.min(p.timer,1.2);
  if(p.st==='curl'&&f&&f.act==='bnap'&&f.path.length)p.timer=Math.min(p.timer,1);
  p.timer-=dt;if(p.timer<=0)petPlan(p);
}
function drawCat(c,p,t){
  const walking=p.path.length>0,curl=!walking&&p.st==='curl';
  const fr=walking?CAT.walk[Math.floor(t*10+p.seed)%2]:curl?CAT.curl:CAT.sit[Math.floor(t*1.3+p.seed)%3===0?1:0];
  const w=fr[0].length,h=fr.length,x=Math.round(p.x),y=Math.round(p.y),flip=p.face<0,ox=x-(w>>1),oy=y-h;
  const blink=((t+p.seed*1.9)%4.5)<.14;
  if(!p.benchN){c.fillStyle='rgba(18,28,18,.3)';c.fillRect(x-4,y,9,1);}
  c.fillStyle='#160f1c';
  for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(fr[j][i]!=='.'){const px=ox+(flip?w-1-i:i),py=oy+j;c.fillRect(px-1,py,3,1);c.fillRect(px,py-1,1,3);}
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const ch=fr[j][i];if(ch==='.')continue;
    c.fillStyle=ch==='k'?'#160f1c':ch==='e'&&blink?p.pal.o:(p.pal[ch]||p.pal.o);
    c.fillRect(ox+(flip?w-1-i:i),oy+j,1,1);
  }
}
/* screen pixel (physical) → resident or cat under it */
function pickAt(px,py){
  const save=mouse;mouse={x:(px-BLIT.ox)/BLIT.s,y:(py-BLIT.oy)/BLIT.s};
  const hit=hitTest()||petHit();mouse=save;return hit;
}
function petHit(){if(!mouse)return null;for(const p of PETS)if(Math.abs(mouse.x-p.x)<=7&&mouse.y>=p.y-9&&mouse.y<=p.y+2)return p;return null;}
function petLabel(p){
  if(p.path.length)return p.act==='hunt'?'Stalking some birds…':p.act==='visit'&&p.friend?`Trotting over to ${p.friend.name}`:p.act==='curl'?'Looking for a nap spot':'Wandering around town';
  if(p.st==='curl')return p.benchN?'Napping on a bench':p.friend?`Napping next to ${p.friend.name}`:'Curled up asleep';
  if(p.act==='visit'&&p.friend)return `Keeping ${p.friend.name} company`;
  return p.act==='hunt'?'Watching the birds fly off':'Sitting, tail swishing';
}

const SKYB=[],GB=[];let gbT=3,flockId=0;
const BIRD_SPOTS=[[300,166],[180,166],[470,168],[560,168],[60,170],[330,252],[420,256],[262,292],[450,340],[240,340],[560,338],[300,214],[160,214]];
function spawnFlock(){
  const free=BIRD_SPOTS.filter(([x,y])=>!RES.some(r=>!r.hidden&&Math.abs(r.x-x)<30&&Math.abs(r.y-y)<16)&&!PETS.some(p=>Math.abs(p.x-x)<34&&Math.abs(p.y-y)<18));
  if(!free.length)return;
  const [sx,sy]=pick(free),n=2+(Math.random()*3|0),dir=Math.random()<.5?1:-1,id=++flockId;
  for(let i=0;i<n;i++){const tx=sx+(Math.random()-.5)*22,ty=sy+(Math.random()-.5)*8;
    GB.push({fl:id,x:tx-dir*(140+Math.random()*40),y:ty-150-Math.random()*30,tx,ty,st:'in',vx:0,vy:0,face:dir,ph:Math.random()*6,pk:0,hy:0,hop:Math.random()*2,life:25+Math.random()*30,col:pick(['#8a6a48','#7a5a3a','#9a7a52'])});}
}
function scare(fl){for(const b of GB)if(b.fl===fl&&b.st!=='out'){b.st='out';const a=-Math.PI/2+(Math.random()-.5)*1.6;b.face=Math.cos(a)>0?1:-1;b.vx=Math.cos(a)*75;b.vy=Math.sin(a)*60-25;}}
function updateBirds(dt,wk){
  const day=curTod()!=='night',calm=wk!=='rain'&&wk!=='storm'&&wk!=='snow';
  if(day&&wk!=='rain'&&wk!=='storm'&&SKYB.length<14&&Math.random()<dt/16){
    const n=3+(Math.random()*4|0),dir=Math.random()<.5?1:-1,y=16+Math.random()*55,sp=(20+Math.random()*10)*dir,x0=dir>0?-12:TW+12;
    for(let i=0;i<n;i++){const k=Math.ceil(i/2);SKYB.push({x:x0-k*8*dir,y:y+(i%2?1:-1)*k*4,vx:sp,ph:Math.random()*6});}
  }
  for(let i=SKYB.length-1;i>=0;i--){const b=SKYB[i];b.x+=b.vx*dt;b.y+=Math.sin(T*1.5+b.ph)*.06;if(b.x<-40||b.x>TW+40)SKYB.splice(i,1);}
  gbT-=dt;
  if(gbT<=0){gbT=8+Math.random()*14;if(day&&calm&&GB.length<8)spawnFlock();}
  if(!day||!calm)for(const b of GB)if(b.st!=='out')scare(b.fl);
  for(let i=GB.length-1;i>=0;i--){
    const b=GB[i];
    if(b.st==='in'){const dx=b.tx-b.x,dy=b.ty-b.y,d=Math.hypot(dx,dy),sp=90*dt;if(d<=sp){b.x=b.tx;b.y=b.ty;b.st='peck';}else{b.x+=dx/d*sp;b.y+=dy/d*sp;b.face=dx>0?1:-1;}}
    else if(b.st==='peck'){
      b.life-=dt;b.pk=Math.max(0,b.pk-dt);b.hy=Math.max(0,b.hy-dt);b.hop-=dt;
      if(b.hop<=0){b.hop=.5+Math.random()*2.2;if(Math.random()<.45)b.pk=.25;else{b.face=Math.random()<.5?1:-1;b.x+=b.face*(1+Math.random()*3);b.hy=.15;}}
      let near=b.life<=0;
      for(const r of RES)if(!r.hidden&&r.pose!=='sleep'&&Math.abs(r.x-b.x)<16&&Math.abs(r.y-b.y)<10){near=true;break;}
      for(const p of PETS)if((p.path.length||p.st!=='curl')&&Math.abs(p.x-b.x)<22&&Math.abs(p.y-b.y)<12){near=true;break;}
      if(near)scare(b.fl);
    }else{b.x+=b.vx*dt;b.y+=b.vy*dt;b.vy-=12*dt;if(b.y<-20||b.x<-20||b.x>TW+20)GB.splice(i,1);}
  }
}
function drawFlyer(c,x,y,up,col){
  x=Math.round(x);y=Math.round(y);c.fillStyle=col;
  if(up){c.fillRect(x-2,y-2,1,1);c.fillRect(x-1,y-1,1,1);c.fillRect(x+1,y-1,1,1);c.fillRect(x+2,y-2,1,1);}
  else{c.fillRect(x-2,y,1,1);c.fillRect(x-1,y-1,1,1);c.fillRect(x+1,y-1,1,1);c.fillRect(x+2,y,1,1);}
  c.fillRect(x,y-1,1,2);
}
function drawSparrow(c,b){
  const x=Math.round(b.x),y=Math.round(b.y)-(b.hy>0?1:0),f=b.face,P=(dx,dy,w,h,col)=>R(c,f>0?x+dx:x-dx-w+1,y+dy,w,h,col);
  c.fillStyle='rgba(18,28,18,.25)';c.fillRect(x-2,Math.round(b.y),5,1);
  P(-3,-5,1,2,'#4a3424');P(-2,-4,4,2,b.col);P(-1,-2,3,1,'#e8d8b8');P(-2,-4,2,1,'#5a4030');
  if(b.pk>0){P(2,-3,2,2,'#5a4030');P(4,-2,1,1,'#e8a03a');}
  else{P(1,-6,2,2,'#5a4030');P(3,-5,1,1,'#e8a03a');P(2,-6,1,1,'#16120e');}
  P(0,-1,1,1,'#5a3a24');
}

/* =====================================================================
   SKY + LIGHTING
   ===================================================================== */
function skyColors(e,wk){
  const NT='#0b1030',NB='#28336a',TT='#3b3f80',TB='#ff9e70',DT='#4fa6e6',DB='#d4f0ff';
  let top,bot;
  if(e<=-.25){top=NT;bot=NB;}else if(e<0){const k=(e+.25)/.25;top=mix(NT,TT,k);bot=mix(NB,TB,k);}
  else if(e<.25){const k=e/.25;top=mix(TT,DT,k);bot=mix(TB,DB,k);}else{top=DT;bot=DB;}
  const grey={cloudy:.45,rain:.65,storm:.82,snow:.5,fog:.55}[wk]||0;
  if(grey){top=mix(top,e>0?'#8f98a8':'#2a3046',grey);bot=mix(bot,e>0?'#c4cad4':'#3a4058',grey);}
  return [top,bot];
}
function worldTint(e,wk){
  let t;
  if(e<=-.25)t='#5c66a6';else if(e<0)t=mix('#5c66a6','#ffb48c',(e+.25)/.25);else if(e<.25)t=mix('#ffb48c','#ffffff',e/.25);else t='#ffffff';
  const w={cloudy:'#e4e8ee',rain:'#bcc4d2',storm:'#9ea6bc',snow:'#eef2f8',fog:'#e6e8ec'}[wk];
  return w?mulHex(t,w):t;
}
function drawSky(c,e,m,wk){
  const [top,bot]=skyColors(e,wk);
  for(let y=0;y<112;y+=2){c.fillStyle=mix(top,bot,Math.min(1,y/96));c.fillRect(0,y,TW,2);}
  const starA=clamp((-e-.08)*3)*({clear:1,cloudy:.35,fog:.15}[wk]??0);
  if(starA>0){for(const s of STARS){c.globalAlpha=starA*(.4+.6*Math.abs(Math.sin(T*1.3+s.ph)));R(c,s.x,s.y,1,1,s.b?'#ffffff':'#fff8e0');if(s.b){R(c,s.x-1,s.y,3,1,'rgba(255,255,255,.35)');}}c.globalAlpha=1;}
  const sr=ENV.sunrise,ss=ENV.sunset,vis={clear:1,cloudy:.55,fog:.35,snow:.35,rain:.1,storm:0}[wk]??1;
  if(m>=sr-30&&m<=ss+30&&vis>0){
    const p=(m-sr)/(ss-sr),sx=20+p*(TW-40),sy=106-Math.sin(Math.PI*clamp(p))*88,col=mix('#ff8a3a','#fff4c0',clamp(e*3));
    const g=c.createRadialGradient(sx,sy,0,sx,sy,30);g.addColorStop(0,`rgba(255,230,160,${.45*vis})`);g.addColorStop(1,'rgba(255,230,160,0)');c.fillStyle=g;c.fillRect(sx-30,sy-30,60,60);
    c.globalAlpha=vis;disc(c,sx,sy,7,col);disc(c,sx-1,sy-1,4,mix(col,'#ffffff',.5));c.globalAlpha=1;
  }
  if(e<.05){
    const nl=1440-(ss-sr),pos=(((m-ss)%1440)+1440)%1440/nl;
    if(pos>=0&&pos<=1){const mx=20+pos*(TW-40),my=100-Math.sin(Math.PI*pos)*82,mv=vis*clamp((-e+.05)*4);
      if(mv>0){const g=c.createRadialGradient(mx,my,0,mx,my,22);g.addColorStop(0,`rgba(220,230,255,${.3*mv})`);g.addColorStop(1,'rgba(220,230,255,0)');c.fillStyle=g;c.fillRect(mx-22,my-22,44,44);
        c.globalAlpha=mv;disc(c,mx,my,6,'#fff3c8');R(c,mx+1,my-2,2,2,'#e8dca8');R(c,mx-3,my+1,2,1,'#e8dca8');c.globalAlpha=1;}}
  }
  const n={clear:4,cloudy:11,rain:14,storm:18,snow:12,fog:9}[wk]||4,dark=wk==='rain'||wk==='storm';
  const nightK=clamp((-e+.05)*2.5),sunsetK=Math.max(0,1-Math.abs(e)*5)*(1-nightK)*(dark?.3:1);
  for(let i=0;i<n;i++){
    const cl=CLOUDS[i],set=CLOUD_IMG[cl.s],x=((cl.x0+T*cl.sp*(wk==='storm'?2.5:1))%(TW+120))-80;
    c.drawImage(set[dark?'grey':'day'],Math.round(x),Math.round(cl.y));
    if(sunsetK>0){c.globalAlpha=sunsetK;c.drawImage(set.sunset,Math.round(x),Math.round(cl.y));}
    if(nightK>0){c.globalAlpha=nightK;c.drawImage(set.night,Math.round(x),Math.round(cl.y));}
    c.globalAlpha=1;
  }
  c.globalAlpha=.85;for(const b of SKYB)drawFlyer(c,b.x,b.y,Math.sin(T*9+b.ph)>0,e>0?'#2a2838':'#1a1826');c.globalAlpha=1;
}
function drawLights(c,e,wk,t){
  let amt=clamp((.18-e)/.4);
  if(wk==='storm')amt=Math.max(amt,.5);else if(wk==='rain'||wk==='fog')amt=Math.max(amt,.3);
  c.globalCompositeOperation='lighter';
  for(const L of LIGHTS){
    let k=(L.on?L.on():1)*(L.k||1)*(L.always?Math.max(amt,.45):amt);
    if(k<=.01)continue;
    const rr=L.r*(1+Math.sin(t*6+L.x)*.05),g=c.createRadialGradient(L.x,L.y,0,L.x,L.y,rr);
    g.addColorStop(0,`rgba(${L.col},${Math.min(.8,.5*k)})`);g.addColorStop(1,`rgba(${L.col},0)`);
    c.fillStyle=g;c.fillRect(L.x-rr,L.y-rr,rr*2,rr*2);
  }
  c.globalCompositeOperation='source-over';
}

/* =====================================================================
   SIMULATION STEP
   ===================================================================== */
function step(r,dt){
  if(r.react>0)r.react-=dt;
  if(r.bubble&&(r.bubble.t-=dt)<=0)r.bubble=null;
  if(r.wait>0){r.wait-=dt;return;}
  if(r.path.length){
    const p=r.path[0],dx=p.x-r.x,dy=p.y-r.y,d=Math.hypot(dx,dy),sp=(r.act==='explore'?25:20)*dt;
    if(Math.abs(dx)>.3)r.face=dx>0?1:-1;r.pose='walk';
    if(d<=sp){r.x=p.x;r.y=p.y;r.path.shift();if(p.id)r.node=p.id;if(!r.path.length)arrive(r);}
    else{r.x+=dx/d*sp;r.y+=dy/d*sp;}
    return;
  }
  if(afk)return;
  if((r.act==='talk'||r.act==='listen')&&!validTalk(r))r.timer=Math.min(r.timer,.6+Math.random()*.6);
  if(r.pose==='stand'&&r.act!=='talk'&&r.act!=='listen'&&Math.random()<dt*.15)r.face=pick([-1,0,1]); // look around
  r.timer-=dt;
  if(r.timer>0)return;
  if(r.act==='explore'){if(r.app&&r.working)exploreNext(r);else if(r.app)planOnCall(r);else planLeisure(r);}
  else if(!r.app)planLeisure(r);
  else if(r.working&&r.act==='work'&&nextWorkSpot(r)){}
  else if(!r.working)planOnCall(r);
  else r.timer=5+Math.random()*6;
}
let envKeyT='',envKeyW='';
function envReact(){
  const tod=curTod(),wk=weather();
  if(envKeyT&&tod!==envKeyT)log({day:'Good morning, Hometown! ☀',dusk:phaseLabel()==='Dawn'?'Dawn breaks over the mountains':'The sun is setting. Lanterns are lit',night:'Night falls. Most villagers head home'}[tod]);
  if(envKeyW&&wk!==envKeyW)log({clear:'The sky clears up',cloudy:'Clouds roll in',rain:'It started raining. Out come the umbrellas',storm:'A thunderstorm rolls in!',snow:'Snow is falling on Hometown',fog:'A thick fog settles over town'}[wk]);
  if((envKeyT&&tod!==envKeyT)||(envKeyW&&wk!==envKeyW))RES.forEach(r=>{if(!r.app&&!afk&&!r.path.length)r.timer=Math.random()*4;});
  if((envKeyT&&tod!==envKeyT)||(envKeyW&&wk!==envKeyW))PETS.forEach(p=>{if(!p.path.length)p.timer=Math.min(p.timer,1+Math.random()*3);});
  envKeyT=tod;envKeyW=wk;
}

/* =====================================================================
   DISPLAY SCALING
   ===================================================================== */
function resize(){
  const dpr=window.devicePixelRatio||1,fit=view.dataset.fit||'contain';
  if(fit==='cover'){
    const W=Math.round(innerWidth*dpr),H=Math.round(innerHeight*dpr);
    view.width=W;view.height=H;view.style.width=innerWidth+'px';view.style.height=innerHeight+'px';
    let s=Math.max(W/TW,H/TH);if(Math.ceil(s)-s<.08)s=Math.ceil(s);
    BLIT={s,ox:Math.round((W-TW*s)/2),oy:Math.round((H-TH*s)/2)};
  }else{
    const host=view.closest('[data-host]')||document.body;
    const availW=(host.clientWidth-60)*dpr,availH=(innerHeight-(+view.dataset.reserve||220))*dpr;
    let s=Math.min(availW/TW,availH/TH);const si=Math.floor(s);if(si>=1&&s-si<.15)s=si;s=clamp(s,1,6);
    view.width=Math.round(TW*s);view.height=Math.round(TH*s);view.style.width=view.width/dpr+'px';view.style.height=view.height/dpr+'px';
    BLIT={s,ox:0,oy:0};
  }
}
addEventListener('resize',resize);
function blit(){
  const {s,ox,oy}=BLIT;
  vctx.fillStyle='#000';vctx.fillRect(0,0,view.width,view.height);
  if(Math.abs(s-Math.round(s))<.01){vctx.imageSmoothingEnabled=false;vctx.drawImage(scC,0,0,TW,TH,ox,oy,TW*s,TH*s);return;}
  const k=Math.ceil(s);if(!upC||upC.width!==TW*k)[upC,upX]=mk(TW*k,TH*k);
  upX.imageSmoothingEnabled=false;upX.drawImage(scC,0,0,TW*k,TH*k);
  vctx.imageSmoothingEnabled=true;vctx.imageSmoothingQuality='high';vctx.drawImage(upC,0,0,TW*k,TH*k,ox,oy,TW*s,TH*s);
}

/* =====================================================================
   RENDER LOOP + INPUT
   ===================================================================== */
let T=0,last=performance.now(),mouse=null,hover=null,selected=null;
function zOf(r){const n=N[r.target];return(n&&n.z&&Math.hypot(r.x-n.x,r.y-n.y)<20&&(!r.path.length||r.act==='work'))?n.z:r.y;}
let lastF=0;
function frame(now){
  if(FPS_CAP&&now-lastF<1000/FPS_CAP-2){requestAnimationFrame(frame);return;}
  lastF=now;
  const dt=clamp((now-last)/1000,0,.05);last=Math.max(last,now);T+=dt;
  const m=nowMin(),e=elev(m),wk=weather();
  envReact();
  RES.forEach(r=>{step(r,dt);residentFx(r,dt,T);});
  PETS.forEach(p=>petStep(p,dt));updateBirds(dt,wk);
  ambient(dt,wk);updateParts(dt,T);updateWeather(dt,wk);

  drawSky(sc,e,m,wk);
  ctx.clearRect(0,0,TW,TH);ctx.drawImage(bgC,0,0);
  for(const w of WATER_PTS)if(Math.sin(T*1.7+w.ph+w.x*.06)>.72)R(ctx,w.x,w.y,2,1,'#a8e0ff');
  const list=[];
  for(const p of props)list.push([p.base,()=>{if(p.img)ctx.drawImage(p.img,p.x,p.y);if(p.fx)p.fx(ctx,T);}]);
  for(const r of RES)if(!r.hidden)list.push([zOf(r),()=>drawResident(ctx,r,T)]);
  for(const p of PETS)list.push([p.z??p.y,()=>drawCat(ctx,p,T)]);
  for(const b of GB)list.push(b.st==='peck'?[b.y,()=>drawSparrow(ctx,b)]:[990,()=>drawFlyer(ctx,b.x,b.y,Math.sin(T*16+b.ph)>0,'#4a3424')]);
  list.sort((a,b)=>a[0]-b[0]);for(const [,d] of list)d();
  drawParts(ctx,false);
  if(wk==='snow'){ctx.globalCompositeOperation='source-atop';ctx.fillStyle='rgba(240,246,255,.25)';ctx.fillRect(0,0,TW,TH);ctx.globalCompositeOperation='source-over';}
  const tint=worldTint(e,wk);
  if(tint!=='#ffffff'){
    mkx.clearRect(0,0,TW,TH);mkx.drawImage(wlC,0,0);
    ctx.globalCompositeOperation='multiply';ctx.fillStyle=tint;ctx.fillRect(0,0,TW,TH);
    ctx.globalCompositeOperation='destination-in';ctx.drawImage(mkC,0,0);ctx.globalCompositeOperation='source-over';
  }
  sc.drawImage(wlC,0,0);
  drawLights(sc,e,wk,T);
  drawWeather(sc,wk);
  drawParts(sc,true);
  hover=hitTest();
  if(selected&&!selected.hidden){const pulse=Math.floor(T*4)%2;sc.strokeStyle=pulse?'#ffd27a':'#e8a030';sc.lineWidth=1;sc.beginPath();sc.ellipse(Math.round(selected.x)+.5,Math.round(selected.y)+.5,7,3,0,0,Math.PI*2);sc.stroke();}
  if(hover){const hx_=Math.round(hover.x),hy=Math.round(hover.y)-(hover.pose==='sleep'?12:28)+Math.round(Math.sin(T*6));R(sc,hx_-2,hy,5,1,'#ffd27a');R(sc,hx_-1,hy+1,3,1,'#ffd27a');R(sc,hx_,hy+2,1,1,'#ffd27a');}
  for(const r of RES){
    if(r.hidden)continue;
    if(r.pose==='sleep')for(let k=0;k<2;k++){const ph=(T*.45+r.seed+k*.5)%1;sc.globalAlpha=1-ph;const zx=Math.round(r.x-7+ph*5+k*3),zy=Math.round(r.y-13-ph*12);glyph(sc,GL.z,zx+1,zy+1,'#2a2a40');glyph(sc,GL.z,zx,zy,'#ffffff');}
    sc.globalAlpha=1;
    if(r.bubble)bubble(sc,r.x,r.y-(r.pose==='sleep'?10:r.pose==='soak'?14:21)-(r.role==='wizard'&&r.pose!=='sleep'?5:0),GL[r.bubble.type],BCOL[r.bubble.type]);
  }
  for(const p of PETS){
    if(!p.path.length&&p.st==='curl'){const ph=(T*.4+p.seed)%1;sc.globalAlpha=1-ph;const zx=Math.round(p.x+2+ph*4),zy=Math.round(p.y-8-ph*9);glyph(sc,GL.z,zx+1,zy+1,'#2a2a40');glyph(sc,GL.z,zx,zy,'#ffffff');sc.globalAlpha=1;}
    if(p.bubble)bubble(sc,p.x,p.y-(p.st==='curl'?6:9),GL[p.bubble.type],BCOL[p.bubble.type]);
  }
  blit();
  updateTip();
  if(window.onTownFrame)window.onTownFrame();
  requestAnimationFrame(frame);
}
const tip=document.getElementById('tip');
view.addEventListener('mousemove',e=>{
  const b=view.getBoundingClientRect(),dpr=view.width/b.width;
  mouse={x:((e.clientX-b.left)*dpr-BLIT.ox)/BLIT.s,y:((e.clientY-b.top)*dpr-BLIT.oy)/BLIT.s,cx:e.clientX,cy:e.clientY};
});
view.addEventListener('mouseleave',()=>{mouse=null;});
view.addEventListener('click',()=>{selected=hover||null;if(window.onTownClick)window.onTownClick(hover);});
function hitTest(){
  if(!mouse)return null;let best=null;
  for(const r of RES){if(r.hidden)continue;const sl_=r.pose==='sleep';const x0=r.x-(sl_?10:6),x1=r.x+(sl_?9:6),y0=r.y-(sl_?9:21),y1=r.y+2;
    if(mouse.x>=x0&&mouse.x<=x1&&mouse.y>=y0&&mouse.y<=y1&&(!best||r.y>best.y))best=r;}
  return best;
}
function stateLabel(r){
  if(afk&&(r.act==='sleep'||r.act==='home'||r.act==='bnap'))return'Sleeping (you are away)';
  if(r.app&&r.working&&r.role==='traveler')return'Working: exploring';
  if(r.act==='talk'&&r.path.length)return'Going to chat'+(r.partner?' with '+r.partner.name:'');
  if((r.act==='talk'||r.act==='listen')&&r.partner)return'Chatting with '+r.partner.name+(r.app&&!r.working?' (app in background)':'');
  if(r.path.length||r.wait>0)return r.app?(r.working?'Heading to work':'Strolling (app in background)'):r.act==='home'?'Heading home':'Walking';
  if(r.app&&!r.working&&r.act==='chore')return'Doing light chores (app in background)';
  if(r.app)return r.working?'Working':'Taking a break (app in background)';
  return{sit:'Resting on the bench',fish:'Fishing',nap:'Napping under the sakura',bnap:'Napping on a bench',sleep:'Sleeping',chat:'Chatting in the plaza',watch:'Watching the show',wander:'Strolling',well:'Drawing water',tea:'Sipping tea at the Tea House',soak:'Soaking in the hot spring',browse:'Browsing the Market',home:'At home'}[r.act]||'Idle';
}
function appLabel(r){return r.app?r.app.name+(r.app.ai?` (${r.app.ai})`:''):'None (free time)';}
function jobLabel(r){return r.role?ROLES[r.role].label:'Town resident';}
function updateTip(){
  if(!tip)return;
  const pet=!hover&&mouse?petHit():null;
  if((!hover&&!pet)||!mouse){tip.style.display='none';view.style.cursor='default';return;}
  view.style.cursor='pointer';
  tip.innerHTML=pet?`<b>Town cat:</b> ${esc(pet.name)} (${esc(pet.kind)})\n<b>State:</b> ${esc(petLabel(pet))}`
    :`<b>Resident:</b> ${esc(hover.name)}\n<b>Job:</b> ${esc(jobLabel(hover))}\n<b>App:</b> ${esc(appLabel(hover))}\n<b>State:</b> ${esc(stateLabel(hover))}`;
  tip.style.display='block';
  const w=tip.offsetWidth,h=tip.offsetHeight;
  tip.style.left=Math.min(innerWidth-w-8,mouse.cx+16)+'px';tip.style.top=Math.min(innerHeight-h-8,mouse.cy+16)+'px';
}

/* ---------- boot ---------- */
function townBoot(){
  const q=new URLSearchParams(location.search);
  const tm=q.get('time');if(tm&&/^\d{1,2}:\d{2}$/.test(tm)){const [h,mm]=tm.split(':').map(Number);ENV.timeMode='manual';ENV.manualMin=h*60+mm;}
  const tod=q.get('tod');if(tod){ENV.timeMode='manual';ENV.manualMin={day:720,dusk:1075,night:1350}[tod]??720;}
  const w=q.get('weather');if(w&&WNAME[w])ENV.weatherMode=w;
  renderBG();makeClouds();buildProps();resize();bindEnv();
  sync();envChanged();
  if(WALL){source='live';pollLive();}
  if(!q.has('noloc'))detectLocation();
  setInterval(()=>{if(source==='live')pollLive();},2000);
  requestAnimationFrame(frame);
}
