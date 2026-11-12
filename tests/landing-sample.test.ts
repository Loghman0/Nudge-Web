import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {compareSample,hindsightOptions,memoryEdges,memoryNodes} from '../src/components/landing/sample-model';
describe('public sample evidence',()=>{
 it('allows positive and negative outcomes to change the recommendation without a fabricated percentage',()=>{
  assert.equal(hindsightOptions(null)[0].id,'film');assert.equal(hindsightOptions('good')[0].id,'walk');assert.equal(hindsightOptions('bad')[0].id,'film');
  assert.match(hindsightOptions('bad')[1].evidence,/poor fit/);
 });
 it('does not invent relevant evidence for unfamiliar options or favor arbitrary ties',()=>{
  assert.equal(compareSample('Build a shed','Buy a bicycle').label,null);
  assert.equal(compareSample('Walk in the park','Hike outdoors').label,null);
  assert.equal(compareSample('Watch a film','Take a walk').label,'Take a walk');
  assert.equal(compareSample('Parkinson lecture','Watch a film').label,null);
 });
 it('connects every public node to the same sample memory with valid endpoints',()=>{
  const reachable=new Set([0]);for(let i=0;i<memoryNodes.length;i++)for(const [a,b] of memoryEdges){assert.ok(memoryNodes[a]&&memoryNodes[b]);if(reachable.has(a)||reachable.has(b)){reachable.add(a);reachable.add(b);}}
  assert.equal(reachable.size,memoryNodes.length);
 });
});
