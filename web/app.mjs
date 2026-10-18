import {defaults,project,orderedFaces,validateScene} from './geometry.mjs';
const $=id=>document.getElementById(id),canvas=$('scene'),ctx=canvas.getContext('2d');
let scene,camera={...defaults},flat=false,selected='mcu',drag=null,width=800,height=430;
function p(point){return project(point,camera,width,height,flat);}
function line(a,b,color='#cfd7c9',thickness=1){a=p(a);b=p(b);if(!a||!b)return;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=color;ctx.lineWidth=thickness;ctx.stroke();}
function draw(){
  if(!scene)return; const start=performance.now();ctx.clearRect(0,0,width,height);
  for(let n=-200;n<=200;n+=40){line([n,-200,0],[n,200,0]);line([-200,n,0],[200,n,0]);}
  for(const c of scene.components)for(const id of c.links.filter(id=>c.id<id)){const other=scene.components.find(o=>o.id===id);line([c.x,c.y,0],[other.x,other.y,0],'#668776',2.5);}
  if(flat)for(const c of scene.components){
    const a=p([c.x-c.width/2,c.y+c.depth/2,0]),b=p([c.x+c.width/2,c.y-c.depth/2,0]);
    ctx.fillStyle='#'+c.color;ctx.fillRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);
    ctx.strokeStyle=c.id===selected?'#243e2f':'#688071';ctx.lineWidth=c.id===selected?3:1;ctx.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);
  }else for(const face of orderedFaces(scene.components,camera,width,height)){
    ctx.beginPath();face.points.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.closePath();
    ctx.fillStyle='#'+face.color+(face.shade===4?'ff':'c9');ctx.fill();ctx.strokeStyle=face.id===selected?'#243e2f':'#688071';ctx.lineWidth=face.id===selected?2.5:1;ctx.stroke();
  }
  for(const c of scene.components){const top=p([c.x,c.y,flat?0:c.height+28]);if(!top)continue;line([c.x,c.y,0],[c.x,c.y,flat?0:c.height+28],'#31543f',1.5);
    ctx.beginPath();ctx.arc(top[0],top[1],c.id===selected?8:5,0,Math.PI*2);ctx.fillStyle=c.id===selected?'#243e2f':'white';ctx.fill();
    ctx.font='11px system-ui';ctx.fillStyle='#344a39';ctx.textAlign='center';ctx.fillText(c.id.toUpperCase(),top[0],top[1]-15);
  }
  return performance.now()-start;
}
function resize(){const box=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);width=box.width;height=box.height;canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);draw();}
function inspect(id){
  const c=scene.components.find(c=>c.id===id);if(!c)throw new RangeError('Unknown component');selected=id;
  $('name').textContent=c.name;$('description').textContent=c.description;$('pins').replaceChildren();$('links').replaceChildren();
  for(const name of c.pins){const span=document.createElement('span');span.textContent=name;$('pins').append(span);}
  for(const link of c.links){const li=document.createElement('li');li.textContent=scene.components.find(c=>c.id===link).name;$('links').append(li);}
  for(const button of $('components').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.id===id));draw();
}
function mode(value){flat=value;$('flat').setAttribute('aria-pressed',String(flat));$('spatial').setAttribute('aria-pressed',String(!flat));$('left').disabled=flat;$('right').disabled=flat;draw();}
canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY,moved:false};canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener('pointermove',event=>{if(!drag||flat)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.moved ||=Math.abs(dx)+Math.abs(dy)>2;camera.yaw+=dx*.3;camera.elevation=Math.max(20,Math.min(75,camera.elevation-dy*.2));drag.x=event.clientX;drag.y=event.clientY;draw();});
canvas.addEventListener('pointerup',event=>{if(drag&&!drag.moved){const box=canvas.getBoundingClientRect();const options=scene.components.map(c=>({id:c.id,q:p([c.x,c.y,flat?0:c.height+28])})).filter(o=>o.q).map(o=>({...o,d:Math.hypot(o.q[0]-(event.clientX-box.left),o.q[1]-(event.clientY-box.top))})).filter(o=>o.d<32).sort((a,b)=>a.d-b.d);if(options.length)inspect(options[0].id);}drag=null;});
canvas.addEventListener('pointercancel',()=>{drag=null;});
canvas.addEventListener('wheel',event=>{if(flat)return;event.preventDefault();camera.distance=Math.max(550,Math.min(1100,camera.distance+event.deltaY*.4));draw();},{passive:false});
canvas.addEventListener('keydown',event=>{if(flat)return;let handled=true;if(event.key==='ArrowLeft')camera.yaw-=10;else if(event.key==='ArrowRight')camera.yaw+=10;else if(event.key==='ArrowUp')camera.elevation=Math.min(75,camera.elevation+5);else if(event.key==='ArrowDown')camera.elevation=Math.max(20,camera.elevation-5);else if(event.key==='+')camera.distance=Math.max(550,camera.distance-30);else if(event.key==='-')camera.distance=Math.min(1100,camera.distance+30);else handled=false;if(handled){event.preventDefault();draw();}});
$('flat').addEventListener('click',()=>mode(true));$('spatial').addEventListener('click',()=>mode(false));
$('left').addEventListener('click',()=>{camera.yaw-=15;draw();});$('right').addEventListener('click',()=>{camera.yaw+=15;draw();});$('reset').addEventListener('click',()=>{camera={...defaults};draw();});
$('measure').addEventListener('click',()=>{
  const button=$('measure');button.disabled=true;const samples=[],original={...camera};let frame=0;mode(false);
  function step(){camera.yaw=original.yaw+frame*5;samples.push(draw());if(++frame<60)requestAnimationFrame(step);else{samples.sort((a,b)=>a-b);$('timing').textContent=`60 draws: median ${samples[30].toFixed(3)} ms, max ${samples[59].toFixed(3)} ms of synchronous Canvas drawing code on this browser.`;camera=original;button.disabled=false;draw();}}
  requestAnimationFrame(step);
});
window.addEventListener('resize',resize);
try{
  const response=await fetch('../app/src/main/assets/lab.json');if(!response.ok)throw new Error('Scene download failed');scene=validateScene(await response.json());
  for(const c of scene.components){const button=document.createElement('button');button.dataset.id=c.id;button.setAttribute('aria-pressed',String(c.id===selected));const small=document.createElement('small');small.textContent=c.id.toUpperCase();button.append(small,document.createTextNode(c.name));button.addEventListener('click',()=>inspect(c.id));$('components').append(button);}
  resize();inspect(selected);
}catch(error){$('name').textContent='Scene unavailable';$('description').textContent=error.message;}
