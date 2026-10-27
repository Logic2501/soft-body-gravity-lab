"use strict";

const { SoftBodySim } = require("../src/soft_body_sim.js");
const { resolveBodyCollisions, bodyCollisionDistance } = require("../src/body_collisions.js");
const { createWaterPalette, WATER_HUE } = require("../src/body_palette.js");

const DT = 1 / 240;
const ARENA = { x: 24, y: 24, w: 852, h: 732 };
const CENTER = { x: 450, y: 390 };
const SPAWN = { x: 220, y: 190 };
const RADIUS = 62;

const failures = [];
const DEEP = process.argv.includes("--deep");

function makeSim(gravity = 900, centerMu = 90e6, damping = 0.4) {
  const sim = new SoftBodySim();
  sim.setup(ARENA, CENTER, SPAWN, RADIUS, 32);
  sim.gravity = gravity;
  sim.centerMu = centerMu;
  sim.damping = damping;
  return sim;
}

function polygonArea(points) {
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += a.x * b.y - b.x * a.y;
  }
  return total * 0.5;
}

function run(sim, seconds) {
  const steps = Math.round(seconds / DT);
  const stats = {
    inside: true,
    finite: true,
    maxSpeed: 0,
    maxAreaError: 0,
    minAreaRatio: 1,
    maxCenterAccel: 0,
    contact: false,
    penetration: 0,
    maxRadialDev: 0,
    maxEdgeStrain: 0,
    maxAspect: 1,
    orientationFlips: 0,
  };

  for (let step = 0; step < steps; step += 1) {
    sim.step(DT);
    stats.maxSpeed = Math.max(stats.maxSpeed, sim.lastMaxSpeed);
    stats.maxAreaError = Math.max(stats.maxAreaError, sim.lastAreaError);
    stats.minAreaRatio = Math.min(stats.minAreaRatio, 1 - sim.lastAreaError);
    stats.maxCenterAccel = Math.max(stats.maxCenterAccel, sim.lastMaxCenterAccel);
    stats.contact = stats.contact || sim.lastContact;
    if (sim.lastInstability) {
      stats.finite = false;
    }
    if (polygonArea(sim.positions) * sim.restArea < 0) {
      stats.orientationFlips += 1;
    }

    const meanRadius = sim.getBodyRadius();
    for (let i = 0; i < sim.positions.length; i += 1) {
      const p = sim.positions[i];
      stats.maxRadialDev = Math.max(
        stats.maxRadialDev,
        Math.abs(Math.hypot(p.x - sim.centroid.x, p.y - sim.centroid.y) - meanRadius) / Math.max(meanRadius, 1),
      );
      const next = sim.positions[(i + 1) % sim.positions.length];
      const edge = Math.hypot(next.x - p.x, next.y - p.y);
      stats.maxEdgeStrain = Math.max(
        stats.maxEdgeStrain,
        Math.abs(edge - sim.restEdgeLengths[i]) / Math.max(sim.restEdgeLengths[i], 1),
      );
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        stats.finite = false;
      }
      const penetration = Math.max(
        ARENA.x - p.x,
        p.x - (ARENA.x + ARENA.w),
        ARENA.y - p.y,
        p.y - (ARENA.y + ARENA.h),
      );
      stats.penetration = Math.max(stats.penetration, penetration);
      if (penetration > 0.05) {
        stats.inside = false;
      }
    }

    let minX = sim.positions[0].x;
    let maxX = minX;
    let minY = sim.positions[0].y;
    let maxY = minY;
    for (const p of sim.positions) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    if (width > 1 && height > 1) {
      stats.maxAspect = Math.max(stats.maxAspect, Math.max(width, height) / Math.min(width, height));
    }
  }
  return stats;
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function testFreeFall() {
  const sim = makeSim(900, 0);
  const startY = sim.centroid.y;
  let stats = run(sim, 1);
  const oneSecondY = sim.centroid.y;
  stats = run(sim, 3);
  console.log(
    `[free fall] centroid_y ${startY.toFixed(1)} -> ${oneSecondY.toFixed(1)} after 1s; 4s speed=${stats.maxSpeed.toFixed(1)} area_err=${stats.maxAreaError.toFixed(3)} penetration=${stats.penetration.toFixed(3)} contact=${stats.contact}`,
  );
  expect(oneSecondY > startY + 250, "free fall: body should move down clearly");
  expect(stats.inside, "free fall: points must stay inside the arena");
  expect(stats.finite, "free fall: no NaN/instability");
  expect(stats.contact, "free fall: body should reach and touch the floor");
  expect(stats.maxSpeed <= sim.maxSpeed + 0.5, "free fall: speed cap respected");
}

function testCenterOnly() {
  const sim = makeSim(0, 90e6);
  const startDistance = Math.hypot(sim.centroid.x - CENTER.x, sim.centroid.y - CENTER.y);
  let stats = run(sim, 1.2);
  const afterDistance = Math.hypot(sim.centroid.x - CENTER.x, sim.centroid.y - CENTER.y);
  stats = run(sim, 4);
  console.log(
    `[center only] distance ${startDistance.toFixed(1)} -> ${afterDistance.toFixed(1)} after 1.2s; stats speed=${stats.maxSpeed.toFixed(1)} area_err=${stats.maxAreaError.toFixed(3)} min_area=${stats.minAreaRatio.toFixed(2)} center_accel=${stats.maxCenterAccel.toFixed(0)}`,
  );
  expect(afterDistance < startDistance - 60, "center gravity: body should be pulled toward the source");
  expect(stats.inside, "center gravity: points must stay inside the arena");
  expect(stats.finite, "center gravity: no NaN/instability");
  expect(stats.minAreaRatio > 0.35, "center gravity: body must not collapse");
  expect(stats.maxSpeed <= sim.maxSpeed + 0.5, "center gravity: speed cap respected");
}

function testCenterNearSingularity() {
  const sim = new SoftBodySim();
  sim.setup(ARENA, CENTER, CENTER, RADIUS, 32);
  sim.gravity = 0;
  sim.centerMu = 250e6;
  const stats = run(sim, 6);
  console.log(
    `[near center] speed=${stats.maxSpeed.toFixed(1)} area_err=${stats.maxAreaError.toFixed(3)} min_area=${stats.minAreaRatio.toFixed(2)} center_accel=${stats.maxCenterAccel.toFixed(0)} penetration=${stats.penetration.toFixed(3)}`,
  );
  expect(stats.finite, "near singularity: no NaN/instability");
  expect(stats.inside, "near singularity: points must stay inside the arena");
  expect(stats.maxCenterAccel <= 9000.1, "near singularity: center acceleration must stay capped");
  expect(stats.maxSpeed <= sim.maxSpeed + 0.5, "near singularity: speed cap respected");
  expect(stats.minAreaRatio > 0.3, "near singularity: body must not collapse");
}

function testDualField() {
  const sim = makeSim();
  const stats = run(sim, 8);
  console.log(
    `[dual field] speed=${stats.maxSpeed.toFixed(1)} area_err=${stats.maxAreaError.toFixed(3)} min_area=${stats.minAreaRatio.toFixed(2)} radial_dev=${stats.maxRadialDev.toFixed(3)} edge_strain=${stats.maxEdgeStrain.toFixed(3)} aspect=${stats.maxAspect.toFixed(2)} contact=${stats.contact}`,
  );
  expect(stats.inside, "dual field: points must stay inside the arena");
  expect(stats.finite, "dual field: no NaN/instability");
  expect(stats.minAreaRatio > 0.35, "dual field: body must not collapse");
  expect(stats.maxSpeed <= sim.maxSpeed + 0.5, "dual field: speed cap respected");
  expect(stats.orientationFlips === 0, "dual field: contour orientation must not flip");
}

function testBoundaryBounce() {
  const sim = makeSim(1600, 0, 0.25);
  sim.restitution = 0.9;
  sim.edgeStiffness = 0.35;
  sim.areaStrength = 0.35;
  sim.bendingStiffness = 0.04;
  sim.shapeStrength = 0.02;
  let foundContact = false;
  let contactY = 0;
  for (let i = 0; i < Math.round(2.5 / DT); i += 1) {
    sim.step(DT);
    if (sim.lastContact && !foundContact) {
      foundContact = true;
      contactY = sim.centroid.y;
      break;
    }
  }
  let minYAfter = sim.centroid.y;
  for (let i = 0; i < Math.round(0.55 / DT); i += 1) {
    sim.step(DT);
    minYAfter = Math.min(minYAfter, sim.centroid.y);
  }
  console.log(
    `[boundary] contact=${foundContact} contact_y=${contactY.toFixed(1)} min_y_after=${minYAfter.toFixed(1)} rebound=${(contactY - minYAfter).toFixed(1)}`,
  );
  expect(foundContact, "boundary: body should contact the floor");
  expect(contactY - minYAfter > 25, "boundary: high restitution should visibly rebound");
  const stats = run(sim, 2);
  expect(stats.inside, "boundary: no penetration after bounce");
  expect(stats.finite, "boundary: no NaN/instability");
}

function testLongStability() {
  const sim = makeSim();
  const stats = run(sim, 20);
  console.log(
    `[stability 20s] speed=${stats.maxSpeed.toFixed(1)} area_err=${stats.maxAreaError.toFixed(3)} min_area=${stats.minAreaRatio.toFixed(2)} radial_dev=${stats.maxRadialDev.toFixed(3)} edge_strain=${stats.maxEdgeStrain.toFixed(3)} aspect=${stats.maxAspect.toFixed(2)} flips=${stats.orientationFlips}`,
  );
  expect(stats.finite, "stability: no NaN/instability over 20s");
  expect(stats.inside, "stability: no wall penetration over 20s");
  expect(stats.maxSpeed <= sim.maxSpeed + 0.5, "stability: speed cap respected over 20s");
  expect(stats.minAreaRatio > 0.3, "stability: area must remain bounded over 20s");
  expect(stats.orientationFlips === 0, "stability: contour orientation must not flip over 20s");
}

function testUserDefaults() {
  const sim = new SoftBodySim();
  sim.setup(ARENA, CENTER, SPAWN, RADIUS, 16);
  const stats = run(sim, 20);
  console.log(
    `[user defaults 20s] speed=${stats.maxSpeed.toFixed(1)} area_err=${stats.maxAreaError.toFixed(3)} min_area=${stats.minAreaRatio.toFixed(2)} radial_dev=${stats.maxRadialDev.toFixed(3)} edge_strain=${stats.maxEdgeStrain.toFixed(3)} aspect=${stats.maxAspect.toFixed(2)} flips=${stats.orientationFlips}`,
  );
  expect(stats.finite, "user defaults: no NaN/instability");
  expect(stats.inside, "user defaults: no wall penetration");
  expect(stats.maxSpeed <= sim.maxSpeed + 0.5, "user defaults: speed cap respected");
  expect(stats.orientationFlips === 0, "user defaults: contour orientation must not flip");
}

function testRepeatabilityAndReset() {
  const a = makeSim();
  const b = makeSim();
  const steps = Math.round(3 / DT);
  for (let i = 0; i < steps; i += 1) {
    a.step(DT);
    b.step(DT);
  }
  let maxDiff = 0;
  for (let i = 0; i < a.positions.length; i += 1) {
    maxDiff = Math.max(maxDiff, Math.hypot(a.positions[i].x - b.positions[i].x, a.positions[i].y - b.positions[i].y));
  }
  console.log(`[repeatability] max position diff after 3s = ${maxDiff.toFixed(9)}`);
  expect(maxDiff < 1e-6, "repeatability: identical initial state must produce identical motion");

  a.reset();
  let resetDiff = 0;
  for (let i = 0; i < a.positions.length; i += 1) {
    resetDiff = Math.max(resetDiff, Math.hypot(a.positions[i].x - a.initialPositions[i].x, a.positions[i].y - a.initialPositions[i].y));
  }
  let maxResetSpeed = 0;
  for (const v of a.velocities) {
    maxResetSpeed = Math.max(maxResetSpeed, Math.hypot(v.x, v.y));
  }
  console.log(`[reset] reset position diff=${resetDiff.toFixed(9)} reset speed=${maxResetSpeed.toFixed(9)}`);
  expect(resetDiff < 1e-9, "reset: positions must return to initial state");
  expect(maxResetSpeed < 1e-9, "reset: velocities must be zero");
}

function testLocalGrab() {
  const sim = makeSim(0, 0, 0.5);
  const top = { x: SPAWN.x, y: SPAWN.y - RADIUS };
  const grabbed = sim.grabAt(top, 40);
  expect(grabbed, "grab: nearest perimeter point should be selected");
  if (!grabbed) {
    return;
  }
  const index = sim.grabIndex;
  const start = { x: sim.positions[index].x, y: sim.positions[index].y };
  sim.updateGrab({ x: top.x + 200, y: top.y - 50 });
  for (let i = 0; i < Math.round(0.45 / DT); i += 1) {
    sim.step(DT);
  }
  const travelled = Math.hypot(sim.positions[index].x - start.x, sim.positions[index].y - start.y);
  const heldSpeed = Math.hypot(sim.velocities[index].x, sim.velocities[index].y);
  sim.releaseGrab();
  const stats = run(sim, 1.5);
  console.log(
    `[grab] travelled=${travelled.toFixed(1)} held_speed=${heldSpeed.toFixed(1)} post-release speed=${stats.maxSpeed.toFixed(1)} area_err=${stats.maxAreaError.toFixed(3)}`,
  );
  expect(travelled > 150, "grab: edge drag should move the grabbed area clearly");
  expect(heldSpeed <= sim.maxSpeed + 0.5, "grab: drag force must respect speed cap");
  expect(stats.finite, "grab: release should remain stable");
  expect(stats.inside, "grab: release must not tunnel through walls");
}

function testCenterGrab() {
  const sim = makeSim(0, 0, 0.5);
  const grabbed = sim.grabAt({ x: sim.centroid.x, y: sim.centroid.y }, 30, "center");
  expect(grabbed, "center grab: centroid should be selectable");
  if (!grabbed) {
    return;
  }
  const start = { x: sim.centroid.x, y: sim.centroid.y };
  const target = { x: SPAWN.x + 140, y: SPAWN.y - 60 };
  sim.updateGrab(target);
  for (let i = 0; i < Math.round(0.4 / DT); i += 1) {
    sim.step(DT);
  }
  const travelled = Math.hypot(sim.centroid.x - start.x, sim.centroid.y - start.y);
  const heldSpeed = Math.hypot(sim.velocities[0].x, sim.velocities[0].y);
  for (let i = 0; i < Math.round(1.0 / DT); i += 1) {
    sim.step(DT);
  }
  const settleDistance = Math.hypot(sim.centroid.x - target.x, sim.centroid.y - target.y);
  const settleSpeed = Math.hypot(sim.velocities[0].x, sim.velocities[0].y);
  sim.releaseGrab();
  const stats = run(sim, 1.0);
  console.log(`[center grab] travelled=${travelled.toFixed(1)} held_speed=${heldSpeed.toFixed(1)} settle_d=${settleDistance.toFixed(1)} settle_speed=${settleSpeed.toFixed(1)} area_err=${stats.maxAreaError.toFixed(3)}`);
  expect(travelled > 30, "center grab: body centroid should move");
  expect(heldSpeed <= sim.maxSpeed + 0.5, "center grab: drag force must respect speed cap");
  expect(settleDistance < 20, "center grab: body should settle near the target");
  expect(settleSpeed < 80, "center grab: damping should suppress high-speed oscillation");
  expect(stats.finite, "center grab: release should remain stable");
  expect(stats.inside, "center grab: release must not tunnel through walls");
}

function testSegmentsAndPalette() {
  const sim = makeSim(0, 0, 0.5);
  sim.setSegments(16);
  const before = sim.positions.length;
  const stats = run(sim, 0.5);
  const palette0 = createWaterPalette();
  const palette1 = createWaterPalette();
  console.log(`[segments/palette] points=${before}->${sim.positions.length} finite=${stats.finite} hue=${palette0.hue}`);
  expect(before === 16 && sim.positions.length === 16, "segments: edge count should rebuild every particle array");
  expect(sim.restEdgeLengths.length === 16 && sim.restSkipLengths.length === 16, "segments: constraints should use the new count");
  expect(stats.finite && stats.inside, "segments: rebuilt topology should remain stable");
  expect(palette0.hue === WATER_HUE && palette1.hue === WATER_HUE, "palette: water drops should use one fixed hue");
  expect(palette0.edge.length === 3 && palette0.center.length === 3, "palette: colors should be valid RGB triples");
}

function testCollisionFriction() {
  const makePair = (friction) => {
    const a = makeSim(0, 0, 0.5);
    const b = new SoftBodySim();
    b.setup(ARENA, CENTER, { x: SPAWN.x + 110, y: SPAWN.y }, RADIUS, 32);
    b.gravity = 0;
    b.centerMu = 0;
    b.damping = 0.5;
    a.wallFriction = friction;
    b.wallFriction = friction;
    for (const velocity of b.velocities) {
      velocity.y = 120;
    }
    return { a, b };
  };
  const averageY = (body) => {
    let total = 0;
    for (const velocity of body.velocities) {
      total += velocity.y;
    }
    return total / body.velocities.length;
  };
  const noFriction = makePair(0);
  const withFriction = makePair(0.8);
  resolveBodyCollisions([noFriction.a, noFriction.b], { margin: 2, iterations: 1, restitution: 0 });
  resolveBodyCollisions([withFriction.a, withFriction.b], { margin: 2, iterations: 1, restitution: 0 });
  const slidingNoFriction = averageY(noFriction.b);
  const slidingWithFriction = averageY(withFriction.b);
  console.log(`[collision friction] tangential_speed=${slidingNoFriction.toFixed(1)}->${slidingWithFriction.toFixed(1)}`);
  expect(slidingWithFriction < slidingNoFriction - 5, "collision friction: body-body contact should use wall friction");
}

function testBodyCollisions() {
  const a = makeSim(0, 0, 0.5);
  const b = new SoftBodySim();
  b.setup(ARENA, CENTER, { x: SPAWN.x + 110, y: SPAWN.y }, RADIUS);
  b.gravity = 0;
  b.centerMu = 0;
  b.damping = 0.5;
  const before = Math.hypot(a.centroid.x - b.centroid.x, a.centroid.y - b.centroid.y);
  const initialMin = bodyCollisionDistance(a, b);
  for (let i = 0; i < Math.round(1.5 / DT); i += 1) {
    a.step(DT);
    b.step(DT);
    resolveBodyCollisions([a, b], { margin: 2, iterations: 3 });
  }
  const after = Math.hypot(a.centroid.x - b.centroid.x, a.centroid.y - b.centroid.y);
  const afterMin = bodyCollisionDistance(a, b);
  for (let i = 0; i < Math.round(0.5 / DT); i += 1) {
    a.step(DT);
    b.step(DT);
    resolveBodyCollisions([a, b], { margin: 2, iterations: 3 });
  }
  const restMin = bodyCollisionDistance(a, b);
  console.log(`[collisions] center=${before.toFixed(1)}->${after.toFixed(1)} edge_min=${initialMin.toFixed(2)}->${afterMin.toFixed(2)} rest_min=${restMin.toFixed(2)}`);
  expect(after > before + 5, "collisions: overlapping bodies should separate");
  expect(afterMin > 0.5, "collisions: edges must not remain interpenetrating");
  expect(restMin > 0.5, "collisions: bodies must not sink back into each other");
}

function testExtremeParameters() {
  const sim = makeSim(2500, 250e6, 0);
  sim.edgeStiffness = 0.05;
  sim.areaStrength = 0;
  sim.shapeStrength = 0;
  sim.bendingStiffness = 0;
  sim.restitution = 1;
  sim.wallFriction = 0;
  const stats = run(sim, 20);
  console.log(
    `[extreme] speed=${stats.maxSpeed.toFixed(1)} area_err=${stats.maxAreaError.toFixed(3)} min_area=${stats.minAreaRatio.toFixed(2)} penetration=${stats.penetration.toFixed(3)} flips=${stats.orientationFlips}`,
  );
  expect(stats.finite, "extreme: no NaN/instability at maximum field strengths");
  expect(stats.inside, "extreme: points must stay inside the arena");
  expect(stats.maxSpeed <= sim.maxSpeed + 0.5, "extreme: speed cap respected");
  expect(stats.maxCenterAccel <= 9000.1, "extreme: center acceleration cap respected");
}

testFreeFall();
testCenterOnly();
testCenterNearSingularity();
testDualField();
testBoundaryBounce();
if (DEEP) {
  testLongStability();
  testUserDefaults();
  testRepeatabilityAndReset();
  testExtremeParameters();
} else {
  console.log("[deep] skipped 20s stability / user defaults / repeatability / extreme; run with --deep");
}
testLocalGrab();
testCenterGrab();
testBodyCollisions();
testCollisionFriction();
testSegmentsAndPalette();

if (failures.length === 0) {
  console.log("RESULT: PASS — all numerical checks passed");
} else {
  for (const failure of failures) {
    console.log(`FAIL: ${failure}`);
  }
  console.log(`RESULT: FAIL — ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
