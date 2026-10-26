(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    const api = factory();
    root.resolveBodyCollisions = api.resolveBodyCollisions;
    root.bodyCollisionDistance = api.bodyCollisionDistance;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EPS = 1e-8;

  function resolveBodyCollisions(bodies, options = {}) {
    if (!bodies || bodies.length < 2) {
      return;
    }
    const margin = Number.isFinite(options.margin) ? options.margin : 2;
    const iterations = Math.max(1, Math.round(options.iterations || 3));
    const restitution = Number.isFinite(options.restitution) ? options.restitution : 0;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const radii = bodies.map(bodyBoundingRadius);
      for (let a = 0; a < bodies.length; a += 1) {
        for (let b = a + 1; b < bodies.length; b += 1) {
          const centerDistance = Math.hypot(
            bodies[b].centroid.x - bodies[a].centroid.x,
            bodies[b].centroid.y - bodies[a].centroid.y,
          );
          if (centerDistance > radii[a] + radii[b] + margin) {
            continue;
          }
          collidePair(bodies[a], bodies[b], margin, restitution);
        }
      }
      for (const body of bodies) {
        body.clampToArena();
      }
    }

    for (const body of bodies) {
      body.centroid = body.average(body.positions);
    }
  }

  function collidePair(bodyA, bodyB, margin, restitution) {
    const aCount = bodyA.positions.length;
    const bCount = bodyB.positions.length;
    for (let i = 0; i < aCount; i += 1) {
      const a1 = bodyA.positions[i];
      const a2 = bodyA.positions[(i + 1) % aCount];
      for (let j = 0; j < bCount; j += 1) {
        const b1 = bodyB.positions[j];
        const b2 = bodyB.positions[(j + 1) % bCount];
        if (!segmentAabbClose(a1, a2, b1, b2, margin)) {
          continue;
        }
        const closest = closestSegmentPoints(a1, a2, b1, b2);
        if (closest.distance >= margin) {
          continue;
        }

        let nx;
        let ny;
        if (closest.distance > EPS) {
          nx = (closest.x2 - closest.x1) / closest.distance;
          ny = (closest.y2 - closest.y1) / closest.distance;
        } else {
          const cdx = bodyB.centroid.x - bodyA.centroid.x;
          const cdy = bodyB.centroid.y - bodyA.centroid.y;
          const centerLength = Math.hypot(cdx, cdy);
          if (centerLength > EPS) {
            nx = cdx / centerLength;
            ny = cdy / centerLength;
          } else {
            const edgeX = a2.x - a1.x;
            const edgeY = a2.y - a1.y;
            const edgeLength = Math.hypot(edgeX, edgeY) || 1;
            nx = -edgeY / edgeLength;
            ny = edgeX / edgeLength;
          }
        }

        const overlap = margin - closest.distance;
        const push = overlap * 0.5;
        a1.x -= nx * push;
        a1.y -= ny * push;
        a2.x -= nx * push;
        a2.y -= ny * push;
        b1.x += nx * push;
        b1.y += ny * push;
        b2.x += nx * push;
        b2.y += ny * push;

        const va1 = bodyA.velocities[i];
        const va2 = bodyA.velocities[(i + 1) % aCount];
        const vb1 = bodyB.velocities[j];
        const vb2 = bodyB.velocities[(j + 1) % bCount];
        const vax = (va1.x + va2.x) * 0.5;
        const vay = (va1.y + va2.y) * 0.5;
        const vbx = (vb1.x + vb2.x) * 0.5;
        const vby = (vb1.y + vb2.y) * 0.5;
        const relativeNormal = (vbx - vax) * nx + (vby - vay) * ny;
        if (relativeNormal < 0) {
          const impulse = (-(1 + restitution) * relativeNormal) / 2;
          va1.x -= nx * impulse;
          va1.y -= ny * impulse;
          va2.x -= nx * impulse;
          va2.y -= ny * impulse;
          vb1.x += nx * impulse;
          vb1.y += ny * impulse;
          vb2.x += nx * impulse;
          vb2.y += ny * impulse;
        }
      }
    }
  }

  function bodyBoundingRadius(body) {
    let radius = 0;
    for (const point of body.positions) {
      radius = Math.max(radius, Math.hypot(point.x - body.centroid.x, point.y - body.centroid.y));
    }
    return radius;
  }

  function segmentAabbClose(a1, a2, b1, b2, margin) {
    return !(
      Math.max(a1.x, a2.x) + margin < Math.min(b1.x, b2.x)
      || Math.max(b1.x, b2.x) + margin < Math.min(a1.x, a2.x)
      || Math.max(a1.y, a2.y) + margin < Math.min(b1.y, b2.y)
      || Math.max(b1.y, b2.y) + margin < Math.min(a1.y, a2.y)
    );
  }

  function closestSegmentPoints(a1, a2, b1, b2) {
    const d1x = a2.x - a1.x;
    const d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x;
    const d2y = b2.y - b1.y;
    const rx = a1.x - b1.x;
    const ry = a1.y - b1.y;
    const a = d1x * d1x + d1y * d1y;
    const e = d2x * d2x + d2y * d2y;
    const f = d2x * rx + d2y * ry;

    let s = 0;
    let t = 0;
    if (a <= EPS && e <= EPS) {
      s = 0;
      t = 0;
    } else if (a <= EPS) {
      s = 0;
      t = clamp(f / e, 0, 1);
    } else {
      const c = d1x * rx + d1y * ry;
      if (e <= EPS) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else {
        const b = d1x * d2x + d1y * d2y;
        const denominator = a * e - b * b;
        if (denominator !== 0) {
          s = clamp((b * f - c * e) / denominator, 0, 1);
        }
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = clamp(-c / a, 0, 1);
        } else if (t > 1) {
          t = 1;
          s = clamp((b - c) / a, 0, 1);
        }
      }
    }

    const x1 = a1.x + d1x * s;
    const y1 = a1.y + d1y * s;
    const x2 = b1.x + d2x * t;
    const y2 = b1.y + d2y * t;
    return {
      x1,
      y1,
      x2,
      y2,
      distance: Math.hypot(x2 - x1, y2 - y1),
    };
  }

  function bodyCollisionDistance(bodyA, bodyB) {
    let minimum = Infinity;
    for (let i = 0; i < bodyA.positions.length; i += 1) {
      const a1 = bodyA.positions[i];
      const a2 = bodyA.positions[(i + 1) % bodyA.positions.length];
      for (let j = 0; j < bodyB.positions.length; j += 1) {
        const b1 = bodyB.positions[j];
        const b2 = bodyB.positions[(j + 1) % bodyB.positions.length];
        minimum = Math.min(minimum, closestSegmentPoints(a1, a2, b1, b2).distance);
      }
    }
    return minimum;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { resolveBodyCollisions, bodyCollisionDistance };
}));
