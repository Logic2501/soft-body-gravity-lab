(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    const api = factory();
    root.mergeSoftBodies = api.mergeSoftBodies;
    root.splitSoftBody = api.splitSoftBody;
    root.bodyAspect = api.bodyAspect;
    root.shouldSplitBody = api.shouldSplit;
    root.WATER_MERGE_GAP = api.MERGE_GAP;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MERGE_GAP = 18;
  const MERGE_COOLDOWN = 0.55;
  const SPLIT_ASPECT = 2.6;
  const SPLIT_MIN_RADIUS = 28;
  const SPLIT_MIN_AGE = 0.8;

  const PHYSICS_KEYS = [
    "solverIterations",
    "gravity",
    "centerMu",
    "centerEpsilon",
    "edgeStiffness",
    "areaStrength",
    "shapeStrength",
    "damping",
    "restitution",
    "wallFriction",
    "maxSpeed",
    "grabStiffness",
    "grabMaxAccel",
    "centerGrabDamping",
  ];

  function bodyArea(body) {
    if (Number.isFinite(body.restArea) && Math.abs(body.restArea) > 1e-9) {
      return Math.abs(body.restArea);
    }
    return Math.PI * body.restRadius * body.restRadius;
  }

  function averageVelocity(body) {
    let x = 0;
    let y = 0;
    for (const velocity of body.velocities) {
      x += velocity.x;
      y += velocity.y;
    }
    const count = Math.max(body.velocities.length, 1);
    return { x: x / count, y: y / count };
  }

  function copyPhysics(target, source) {
    for (const key of PHYSICS_KEYS) {
      if (source[key] !== undefined) {
        target[key] = source[key];
      }
    }
    if (source.palette) {
      target.palette = source.palette;
    }
  }

  function radiusForPolygonArea(area, segments) {
    return Math.sqrt(area / (0.5 * segments * Math.sin((Math.PI * 2) / segments)));
  }

  function buildBody(source, center, radius, segments, velocity) {
    const body = new source.constructor();
    body.setup(source.arena, source.center, center, radius, segments);
    copyPhysics(body, source);
    for (const current of body.velocities) {
      current.x = velocity.x;
      current.y = velocity.y;
    }
    body.centroid = body.average(body.positions);
    body.clampToArena();
    body.updateMetrics();
    return body;
  }

  function mergeSoftBodies(bodyA, bodyB, options = {}) {
    if (!bodyA || !bodyB) {
      return null;
    }
    const areaA = bodyArea(bodyA);
    const areaB = bodyArea(bodyB);
    const totalArea = areaA + areaB;
    if (totalArea <= 0) {
      return null;
    }

    const center = {
      x: (bodyA.centroid.x * areaA + bodyB.centroid.x * areaB) / totalArea,
      y: (bodyA.centroid.y * areaA + bodyB.centroid.y * areaB) / totalArea,
    };
    const velocityA = averageVelocity(bodyA);
    const velocityB = averageVelocity(bodyB);
    const velocity = {
      x: (velocityA.x * areaA + velocityB.x * areaB) / totalArea,
      y: (velocityA.y * areaA + velocityB.y * areaB) / totalArea,
    };
    const segments = Math.min(
      Number.isFinite(options.maxSegments) ? options.maxSegments : 24,
      Math.max(bodyA.segments || bodyA.positions.length, bodyB.segments || bodyB.positions.length),
    );
    const radius = radiusForPolygonArea(totalArea, segments);

    const merged = buildBody(bodyA, center, radius, segments, velocity);
    merged.mergeCooldown = Number.isFinite(options.mergeCooldown)
      ? options.mergeCooldown
      : MERGE_COOLDOWN;
    merged.waterAge = 0;
    return merged;
  }

  function bodyPrincipalAxis(body) {
    const positions = body.positions;
    if (positions.length < 3) {
      return { aspect: 1, axis: { x: 1, y: 0 } };
    }
    const center = body.average(positions);
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const point of positions) {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      xx += dx * dx;
      xy += dx * dy;
      yy += dy * dy;
    }
    const count = positions.length;
    xx /= count;
    xy /= count;
    yy /= count;

    const trace = xx + yy;
    const determinant = xx * yy - xy * xy;
    const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - determinant));
    const major = Math.max(trace / 2 + discriminant, 1e-9);
    const minor = Math.max(trace / 2 - discriminant, 1e-9);
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);

    return {
      aspect: Math.sqrt(major / minor),
      axis: { x: Math.cos(angle), y: Math.sin(angle) },
    };
  }

  function bodyAspect(body) {
    return bodyPrincipalAxis(body).aspect;
  }

  function shouldSplit(body, options = {}) {
    if (!body) {
      return false;
    }
    const minRadius = Number.isFinite(options.minRadius) ? options.minRadius : SPLIT_MIN_RADIUS;
    const minAspect = Number.isFinite(options.minAspect) ? options.minAspect : SPLIT_ASPECT;
    const minAge = Number.isFinite(options.minAge) ? options.minAge : SPLIT_MIN_AGE;
    return body.restRadius >= minRadius
      && (body.waterAge || 0) >= minAge
      && (body.mergeCooldown || 0) <= 0
      && bodyAspect(body) >= minAspect;
  }

  function splitSoftBody(body, options = {}) {
    if (!body) {
      return null;
    }
    const area = bodyArea(body);
    const segments = Math.max(8, body.segments || body.positions.length);
    const childRadius = radiusForPolygonArea(area / 2, segments);
    if (!Number.isFinite(childRadius) || childRadius <= 0) {
      return null;
    }

    const principal = bodyPrincipalAxis(body);
    const axis = principal.axis;
    const separation = childRadius * (Number.isFinite(options.separation) ? options.separation : 0.8);
    const push = Number.isFinite(options.separationSpeed) ? options.separationSpeed : 75;
    const baseVelocity = averageVelocity(body);
    const centerA = {
      x: body.centroid.x - axis.x * separation,
      y: body.centroid.y - axis.y * separation,
    };
    const centerB = {
      x: body.centroid.x + axis.x * separation,
      y: body.centroid.y + axis.y * separation,
    };
    const velocityA = {
      x: baseVelocity.x - axis.x * push,
      y: baseVelocity.y - axis.y * push,
    };
    const velocityB = {
      x: baseVelocity.x + axis.x * push,
      y: baseVelocity.y + axis.y * push,
    };
    const childA = buildBody(body, centerA, childRadius, segments, velocityA);
    const childB = buildBody(body, centerB, childRadius, segments, velocityB);
    const cooldown = Number.isFinite(options.mergeCooldown) ? options.mergeCooldown : MERGE_COOLDOWN;
    childA.mergeCooldown = cooldown;
    childB.mergeCooldown = cooldown;
    childA.waterAge = 0;
    childB.waterAge = 0;
    return [childA, childB];
  }

  return {
    mergeSoftBodies,
    splitSoftBody,
    bodyAspect,
    shouldSplit,
    bodyPrincipalAxis,
    bodyArea,
    MERGE_GAP,
    MERGE_COOLDOWN,
    SPLIT_ASPECT,
    SPLIT_MIN_RADIUS,
    SPLIT_MIN_AGE,
  };
}));
