"use strict";

const { SoftBodySim } = require("../src/soft_body_sim.js");
const {
  mergeSoftBodies,
  splitSoftBody,
  bodyAspect,
  shouldSplit,
  MERGE_GAP,
  SPLIT_ASPECT,
} = require("../src/body_merge_split.js");

const DT = 1 / 240;
const ARENA = { x: 24, y: 24, w: 852, h: 732 };
const CENTER = { x: 450, y: 390 };
const failures = [];

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function makeDrop(x, y, radius = 22, segments = 8) {
  const body = new SoftBodySim();
  body.setup(ARENA, CENTER, { x, y }, radius, segments);
  body.gravity = 0;
  body.centerMu = 0;
  body.damping = 0;
  return body;
}

function totalRestArea(bodies) {
  let area = 0;
  for (const body of bodies) {
    area += Math.abs(body.restArea);
  }
  return area;
}

function runWater(body, seconds) {
  let finite = true;
  let inside = true;
  let penetration = 0;
  let maxAspect = 1;
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    body.step(DT);
    maxAspect = Math.max(maxAspect, bodyAspect(body));
    if (body.lastInstability) {
      finite = false;
    }
    for (const point of body.positions) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        finite = false;
      }
      const out = Math.max(
        ARENA.x - point.x,
        point.x - (ARENA.x + ARENA.w),
        ARENA.y - point.y,
        point.y - (ARENA.y + ARENA.h),
      );
      penetration = Math.max(penetration, out);
      if (out > 0.05) {
        inside = false;
      }
    }
  }
  return { finite, inside, penetration, maxAspect };
}

function testMerge() {
  const a = makeDrop(300, 300);
  const b = makeDrop(320, 300);
  for (const velocity of a.velocities) {
    velocity.x = 40;
  }
  for (const velocity of b.velocities) {
    velocity.x = -20;
  }
  const areaBefore = totalRestArea([a, b]);
  const merged = mergeSoftBodies(a, b);
  const areaAfter = totalRestArea([merged]);
  console.log(
    `[water merge] radius=${merged.restRadius.toFixed(1)} particles=${merged.positions.length} area=${areaAfter.toFixed(1)}/${areaBefore.toFixed(1)} centroid=(${merged.centroid.x.toFixed(1)},${merged.centroid.y.toFixed(1)}) vx=${merged.velocities[0].x.toFixed(1)}`,
  );
  expect(merged.positions.length === 8, "water merge: merged body should keep the low particle count");
  expect(Math.abs(areaAfter - areaBefore) / areaBefore < 1e-9, "water merge: area must be conserved");
  expect(Math.abs(merged.velocities[0].x - 10) < 1e-6, "water merge: velocity should be area-weighted");
  expect(Math.abs(merged.centroid.x - 310) < 1e-6, "water merge: centroid should be area-weighted");
  expect(MERGE_GAP > 0, "water merge: proximity gap should be positive");
}

function testSplit() {
  const body = makeDrop(450, 360, 80);
  body.waterAge = 1.5;
  body.mergeCooldown = 0;
  for (const point of body.positions) {
    point.x = body.centroid.x + (point.x - body.centroid.x) * 3.2;
    point.y = body.centroid.y + (point.y - body.centroid.y) * 0.32;
  }
  body.centroid = body.average(body.positions);
  const aspect = bodyAspect(body);
  expect(aspect > SPLIT_ASPECT, "water split: test body should exceed the critical aspect");
  expect(shouldSplit(body), "water split: critical deformation should trigger separation");
  const areaBefore = totalRestArea([body]);
  const children = splitSoftBody(body);
  const areaAfter = totalRestArea(children);
  const centerDistance = Math.hypot(
    children[0].centroid.x - children[1].centroid.x,
    children[0].centroid.y - children[1].centroid.y,
  );
  const separationSpeed = Math.hypot(
    children[0].velocities[0].x - children[1].velocities[0].x,
    children[0].velocities[0].y - children[1].velocities[0].y,
  );
  console.log(
    `[water split] aspect=${aspect.toFixed(2)} children=${children.length} particles=${children[0].positions.length}/${children[1].positions.length} area=${areaAfter.toFixed(1)}/${areaBefore.toFixed(1)} centers=${centerDistance.toFixed(1)} vsep=${separationSpeed.toFixed(1)}`,
  );
  expect(children.length === 2, "water split: a critical body should split into two");
  expect(children.every((child) => child.positions.length === 8), "water split: each child should reconnect eight edge particles");
  expect(children.every((child) => child.restEdgeLengths.length === 8), "water split: child constraints should be rebuilt");
  expect(Math.abs(areaAfter - areaBefore) / areaBefore < 1e-9, "water split: area must be conserved");
  expect(centerDistance > 1, "water split: children should separate spatially");
  expect(separationSpeed > 1, "water split: children should separate kinematically");
}

function testWaterStability() {
  const body = makeDrop(450, 700, 22);
  body.gravity = 500;
  body.edgeStiffness = 0.02;
  body.bendingStiffness = 0;
  body.areaStrength = 0.001;
  body.shapeStrength = 0;
  body.damping = 0.18;
  body.restitution = 0.02;
  body.wallFriction = 0.01;
  const stats = runWater(body, 12);
  console.log(
    `[water soft body] finite=${stats.finite} inside=${stats.inside} penetration=${stats.penetration.toFixed(3)} aspect=${stats.maxAspect.toFixed(2)}`,
  );
  expect(stats.finite, "water soft body: no NaN/instability");
  expect(stats.inside, "water soft body: no wall penetration");
  expect(Number.isFinite(stats.maxAspect), "water soft body: aspect should remain measurable");
}

testMerge();
testSplit();
testWaterStability();

if (failures.length === 0) {
  console.log("RESULT: PASS — water merge/split checks passed");
} else {
  for (const failure of failures) {
    console.log(`FAIL: ${failure}`);
  }
  console.log(`RESULT: FAIL — ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
