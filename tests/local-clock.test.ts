import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalClock} from '../client/local-clock.ts';
import {Simulation} from '../shared/simulation.ts';
import {rules,spawn} from '../shared/world.ts';

const run=(clock:LocalClock,hz:number,seconds:number,step:(dt:number)=>boolean|void)=>{for(let i=0;i<Math.round(hz*seconds);i++)clock.advance(1/hz,step);};
test('local configured movement and arsenal collision agree at 60, 30 and 10 rendered frames per second',()=>{
  for(const hz of [60,30,10]){
    const sim=new Simulation(),clock=new LocalClock();
    run(clock,hz,2,dt=>{sim.movePlayer(rules.character.walk_speed_mps*dt,0);sim.step(dt,false);});
    assert.ok(Math.abs(sim.actors[0].pos.x-10)<1e-6);assert.equal(sim.phase,'playing');
    sim.actors[0].pos={x:0,z:-26};clock.reset();
    run(clock,hz,2,dt=>{sim.movePlayer(0,-rules.character.walk_speed_mps*dt);sim.step(dt,false);});
    assert.ok(sim.actors[0].pos.z>=-28.65);assert.ok(sim.actors[0].pos.z<-27);assert.equal(sim.phase,'playing');
  }
});
test('local ordinary flight, cooldown and three-stone refill keep configured time at low render FPS',()=>{
  for(const hz of [60,30,10]){
    const sim=new Simulation(),clock=new LocalClock(),target={x:2,z:5};
    sim.press(target,false);sim.release(target);
    run(clock,hz,1,dt=>sim.step(dt,false));assert.equal(sim.hp(target,1),2);assert.equal(sim.shots.length,1);
    run(clock,hz,.5,dt=>sim.step(dt,false));assert.equal(sim.hp(target,1),1);assert.equal(sim.shots.length,0);assert.equal(sim.cooldown,0);
    sim.ammo=0;sim.actors[0].pos={x:-2.8,z:-32.4};sim.press(null,true);
    run(clock,hz,.5,dt=>sim.step(dt,true));assert.equal(sim.ammo,0);
    run(clock,hz,1.7,dt=>sim.step(dt,true));assert.equal(sim.ammo,3);
    sim.release(null);assert.equal(sim.released,1);assert.equal(sim.shots.length,0);
  }
});
test('local pause discards fractional elapsed time; round reset cannot apply old movement to the new round',()=>{
  const sim=new Simulation(),clock=new LocalClock();const move=(dt:number)=>{sim.movePlayer(rules.character.walk_speed_mps*dt,0);sim.step(dt,false);};
  clock.advance(.005,move);clock.reset();clock.advance(.012,move);assert.equal(sim.actors[0].pos.x,spawn.x);
  clock.advance(.005,move);assert.ok(sim.actors[0].pos.x>spawn.x);
  sim.phase='falling';sim.actors[0].falling=true;sim.actors[0].y=-30;const round=sim.round;
  clock.advance(.25,dt=>{move(dt);return sim.round===round;});assert.equal(sim.round,round+1);assert.deepEqual(sim.actors[0].pos,spawn);assert.equal(sim.ammo,3);
});
