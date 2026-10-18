export const defaults={yaw:30,elevation:55,distance:720};
const rad=angle=>angle*Math.PI/180;
export function validateScene(scene){
  if(scene.schema_version!==1||scene.data!=='synthetic'||!Array.isArray(scene.components)||!scene.components.length)throw new TypeError('Expected synthetic scene v1');
  const ids=new Set(scene.components.map(c=>c.id));
  if(ids.size!==scene.components.length)throw new TypeError('Duplicate component ID');
  for(const c of scene.components){
    if(typeof c.id!=='string'||!c.id||typeof c.name!=='string'||typeof c.description!=='string'||!/^[0-9a-f]{6}$/i.test(c.color))throw new TypeError('Invalid component labels');
    if(!['x','y','width','depth','height'].every(k=>Number.isFinite(c[k]))||c.width<=0||c.depth<=0||c.height<=0||c.height>150)throw new TypeError('Invalid dimensions');
    if(Math.abs(c.x)+c.width/2>220||Math.abs(c.y)+c.depth/2>220)throw new TypeError('Component outside scene');
    if(!Array.isArray(c.pins)||!c.pins.every(p=>typeof p==='string')||!Array.isArray(c.links)||!c.links.every(id=>ids.has(id)&&id!==c.id))throw new TypeError('Invalid pins or links');
  }
  return scene;
}
export function project(point,camera,width,height,flat=false){
  if(![...point,camera.yaw,camera.elevation,camera.distance,width,height].every(Number.isFinite)||width<=0||height<=0||camera.distance<=0)throw new RangeError('Invalid projection parameters');
  const [x,y,z]=point;
  if(flat){const scale=Math.min(width,height)/430;return [width/2+x*scale,height/2-y*scale,0];}
  const a=rad(camera.yaw),p=rad(camera.elevation),rx=x*Math.cos(a)-y*Math.sin(a),ry=x*Math.sin(a)+y*Math.cos(a);
  const depth=camera.distance+ry*Math.cos(p)-z*Math.sin(p);
  if(depth<=10)return null;
  const scale=Math.min(width,height)*1.7/depth;
  return [width/2+rx*scale,height*.55-(ry*Math.sin(p)+z*Math.cos(p))*scale,depth];
}
export function orderedFaces(components,camera,width,height){
  const result=[];
  for(const c of components){
    const base=[[c.x-c.width/2,c.y-c.depth/2,0],[c.x+c.width/2,c.y-c.depth/2,0],[c.x+c.width/2,c.y+c.depth/2,0],[c.x-c.width/2,c.y+c.depth/2,0]];
    const points=[...base,...base.map(([x,y])=>[x,y,c.height])].map(p=>project(p,camera,width,height));
    [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]].forEach((ids,shade)=>{
      if(ids.some(i=>points[i]===null))return;
      result.push({id:c.id,color:c.color,shade,points:ids.map(i=>points[i]),depth:ids.reduce((sum,i)=>sum+points[i][2],0)/4});
    });
  }
  return result.sort((a,b)=>b.depth-a.depth);
}
