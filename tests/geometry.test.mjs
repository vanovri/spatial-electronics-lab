import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {defaults,project,orderedFaces,validateScene} from '../web/geometry.mjs';
const scene=JSON.parse(fs.readFileSync(new URL('../app/src/main/assets/lab.json',import.meta.url)));
test('one shared scene has valid IDs, links and dimensions',()=>{assert.equal(validateScene(scene).components.length,4);});
test('invalid schema, IDs, dimensions and links are rejected',()=>{
  for(const mutate of [s=>s.data='real',s=>s.components[0].width=-1,s=>s.components[0].x=300,s=>s.components[0].color='x',s=>s.components[0].links=['missing'],s=>s.components[1].id=s.components[0].id]){
    const copy=structuredClone(scene);mutate(copy);assert.throws(()=>validateScene(copy),TypeError);
  }
});
test('origin and raised landmark project correctly',()=>{
  assert.deepEqual(project([0,0,0],defaults,800,400),[400,220.00000000000003,720]);
  const raised=project([0,0,80],defaults,800,400);assert.ok(raised[1]<220&&raised[2]<720);
});
test('2D ignores height and camera while preserving component IDs',()=>{
  for(const c of scene.components){assert.deepEqual(project([c.x,c.y,0],defaults,800,400,true),project([c.x,c.y,100],{...defaults,yaw:200},800,400,true));}
});
test('near-plane and invalid input do not invent a clamped point',()=>{
  assert.equal(project([0,0,1000],{yaw:0,elevation:90,distance:720},800,400),null);
  assert.throws(()=>project([NaN,0,0],defaults,800,400),RangeError);
  assert.throws(()=>project([0,0,0],defaults,0,400),RangeError);
});
test('all visible faces sort globally and supported camera range remains finite',()=>{
  for(let yaw=-360;yaw<=360;yaw+=30)for(const elevation of [20,55,75]){
    const faces=orderedFaces(scene.components,{yaw,elevation,distance:550},390,300);
    assert.equal(faces.length,20);assert.ok(faces.every(f=>f.points.every(p=>p.every(Number.isFinite))));
    assert.ok(faces.slice(1).every((face,i)=>faces[i].depth>=face.depth));
  }
});
