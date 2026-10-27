(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    const api = factory();
    root.SoftBodySim = api.SoftBodySim;
    root.SOFT_BODY_SEGMENTS = api.SEGMENTS;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SEGMENTS = 8;

  const DEFAULT_GRAVITY = 250;
  const DEFAULT_CENTER_MU = 7e6;
  const DEFAULT_CENTER_EPSILON = 70;
  const DEFAULT_EDGE_STIFFNESS = 0.05;
  const DEFAULT_AREA_STRENGTH = 0.005;
  const DEFAULT_SHAPE_STRENGTH = 0;
  const DEFAULT_DAMPING = 0.2;
  const DEFAULT_RESTITUTION = 0.04;
  const DEFAULT_WALL_FRICTION = 0.04;
  const DEFAULT_MAX_SPEED = 2600;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finiteVector = (value) => Number.isFinite(value.x) && Number.isFinite(value.y);

  class SoftBodySim {
    constructor() {
      this.segments = SEGMENTS;
      this.solverIterations = 6;
      this.bendingStiffness = 0.04;
      this.grabStiffness = 400;
      this.grabMaxAccel = 22000;
      this.edgeGrabStiffness = 800;
      this.edgeGrabMaxAccel = 50000;
      this.centerGrabDamping = 20;
      this.maxCenterAccel = 9000;
      this.wallEpsilon = 0.01;
      this.settleSpeed = 24;

      this.arena = { x: 0, y: 0, w: 1, h: 1 };
      this.center = { x: 0, y: 0 };
      this.restRadius = 62;
      this.restArea = 0;
      this.centroid = { x: 0, y: 0 };

      this.positions = [];
      this.velocities = [];
      this.initialPositions = [];
      this.restEdgeLengths = [];
      this.restSkipLengths = [];

      this.resetParameters();
    }

    resetParameters() {
      this.gravity = DEFAULT_GRAVITY;
      this.centerMu = DEFAULT_CENTER_MU;
      this.centerEpsilon = DEFAULT_CENTER_EPSILON;
      this.edgeStiffness = DEFAULT_EDGE_STIFFNESS;
      this.areaStrength = DEFAULT_AREA_STRENGTH;
      this.shapeStrength = DEFAULT_SHAPE_STRENGTH;
      this.damping = DEFAULT_DAMPING;
      this.restitution = DEFAULT_RESTITUTION;
      this.wallFriction = DEFAULT_WALL_FRICTION;
      this.maxSpeed = DEFAULT_MAX_SPEED;
      this.grabStiffness = 400;
      this.grabMaxAccel = 22000;
      this.edgeGrabStiffness = 800;
      this.edgeGrabMaxAccel = 50000;
      this.centerGrabDamping = 20;
    }

    setup(arena, center, spawn, radius, segmentCount = SEGMENTS) {
      this.arena = { ...arena };
      this.center = { ...center };
      this.spawnCenter = { x: spawn.x, y: spawn.y };
      this.restRadius = radius;
      this.segments = Math.max(8, Math.round(segmentCount));
      this.initialPositions = [];
      for (let i = 0; i < this.segments; i += 1) {
        const angle = (Math.PI * 2 * i) / this.segments;
        this.initialPositions.push({
          x: spawn.x + Math.cos(angle) * radius,
          y: spawn.y + Math.sin(angle) * radius,
        });
      }
      this.restEdgeLengths = [];
      this.restSkipLengths = [];
      for (let i = 0; i < this.segments; i += 1) {
        this.restEdgeLengths.push(distance(this.initialPositions[i], this.initialPositions[(i + 1) % this.segments]));
        this.restSkipLengths.push(distance(this.initialPositions[i], this.initialPositions[(i + 2) % this.segments]));
      }
      this.restArea = this.signedArea(this.initialPositions);
      this.reset();
    }

    reset() {
      this.positions = this.initialPositions.map((p) => ({ x: p.x, y: p.y }));
      this.velocities = Array.from({ length: this.segments }, () => ({ x: 0, y: 0 }));
      this.centroid = this.average(this.positions);
      this.grabIndex = -1;
      this.centerGrab = false;
      this.grabTarget = { x: this.centroid.x, y: this.centroid.y };
      this.lastMaxSpeed = 0;
      this.lastAreaError = 0;
      this.lastContact = false;
      this.lastMaxCenterAccel = 0;
      this.lastInstability = false;
    }

    setRadius(newRadius) {
      if (!Number.isFinite(newRadius) || newRadius <= 0 || newRadius === this.restRadius) {
        return;
      }
      const scale = newRadius / this.restRadius;
      const center = this.centroid;
      for (let i = 0; i < this.positions.length; i += 1) {
        this.positions[i].x = center.x + (this.positions[i].x - center.x) * scale;
        this.positions[i].y = center.y + (this.positions[i].y - center.y) * scale;
        this.initialPositions[i].x = this.spawnCenter.x + (this.initialPositions[i].x - this.spawnCenter.x) * scale;
        this.initialPositions[i].y = this.spawnCenter.y + (this.initialPositions[i].y - this.spawnCenter.y) * scale;
        this.restEdgeLengths[i] *= scale;
        this.restSkipLengths[i] *= scale;
      }
      this.restArea *= scale * scale;
      this.restRadius = newRadius;
      this.clampToArena();
      this.centroid = this.average(this.positions);
    }

    setSegments(segmentCount) {
      const count = Math.max(8, Math.round(segmentCount));
      if (count === this.segments) {
        return;
      }
      const center = { x: this.centroid.x, y: this.centroid.y };
      let vx = 0;
      let vy = 0;
      for (const velocity of this.velocities) {
        vx += velocity.x;
        vy += velocity.y;
      }
      vx /= Math.max(this.velocities.length, 1);
      vy /= Math.max(this.velocities.length, 1);

      this.segments = count;
      this.initialPositions = [];
      this.positions = [];
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count;
        this.initialPositions.push({
          x: this.spawnCenter.x + Math.cos(angle) * this.restRadius,
          y: this.spawnCenter.y + Math.sin(angle) * this.restRadius,
        });
        this.positions.push({
          x: center.x + Math.cos(angle) * this.restRadius,
          y: center.y + Math.sin(angle) * this.restRadius,
        });
      }
      this.restEdgeLengths = [];
      this.restSkipLengths = [];
      for (let i = 0; i < count; i += 1) {
        this.restEdgeLengths.push(distance(this.initialPositions[i], this.initialPositions[(i + 1) % count]));
        this.restSkipLengths.push(distance(this.initialPositions[i], this.initialPositions[(i + 2) % count]));
      }
      this.restArea = this.signedArea(this.initialPositions);
      this.velocities = Array.from({ length: count }, () => ({ x: vx, y: vy }));
      this.grabIndex = -1;
      this.centerGrab = false;
      this.grabTarget = { x: center.x, y: center.y };
      this.centroid = center;
      this.clampToArena();
      this.centroid = this.average(this.positions);
      this.updateMetrics();
    }

    step(dt) {
      if (this.positions.length < 3 || dt <= 0) {
        return;
      }
      this.lastInstability = false;
      const oldPositions = this.positions.map((p) => ({ x: p.x, y: p.y }));

      this.applyExternalAcceleration(dt);
      for (let i = 0; i < this.positions.length; i += 1) {
        this.positions[i].x += this.velocities[i].x * dt;
        this.positions[i].y += this.velocities[i].y * dt;
      }

      for (let iteration = 0; iteration < this.solverIterations; iteration += 1) {
        this.solveDistanceConstraints();
        this.solveAreaConstraint();
        this.solveShapeConstraint();
        this.clampToArena();
      }

      for (let i = 0; i < this.positions.length; i += 1) {
        this.velocities[i].x = (this.positions[i].x - oldPositions[i].x) / dt;
        this.velocities[i].y = (this.positions[i].y - oldPositions[i].y) / dt;
      }

      this.handleWallResponse();
      const dampingFactor = Math.exp(-Math.max(this.damping, 0) * dt);
      for (let i = 0; i < this.positions.length; i += 1) {
        this.velocities[i].x *= dampingFactor;
        this.velocities[i].y *= dampingFactor;
        this.limitSpeed(i);
        if (!finiteVector(this.positions[i]) || !finiteVector(this.velocities[i])) {
          this.reset();
          this.lastInstability = true;
          return;
        }
      }

      this.centroid = this.average(this.positions);
      this.updateMetrics();
    }

    applyExternalAcceleration(dt) {
      this.lastMaxCenterAccel = 0;
      const centerGrabAccel = this.centerGrab ? this.centerGrabAcceleration() : null;
      const edgeGrabAccel = this.grabIndex >= 0
        ? this.edgeGrabAcceleration(this.positions[this.grabIndex])
        : null;
      for (let i = 0; i < this.positions.length; i += 1) {
        let ax = 0;
        let ay = this.gravity;
        if (this.centerMu > 0) {
          const centerAccel = this.centerAcceleration(this.positions[i]);
          ax += centerAccel.x;
          ay += centerAccel.y;
          this.lastMaxCenterAccel = Math.max(
            this.lastMaxCenterAccel,
            Math.hypot(centerAccel.x, centerAccel.y),
          );
        }
        if (edgeGrabAccel) {
          const weight = this.edgeGrabWeight(i);
          if (weight > 0) {
            ax += edgeGrabAccel.x * weight;
            ay += edgeGrabAccel.y * weight;
          }
        }
        if (centerGrabAccel) {
          ax += centerGrabAccel.x;
          ay += centerGrabAccel.y;
        }
        this.velocities[i].x += ax * dt;
        this.velocities[i].y += ay * dt;
      }
    }

    centerAcceleration(point) {
      if (this.centerMu <= 0) {
        return { x: 0, y: 0 };
      }
      const dx = this.center.x - point.x;
      const dy = this.center.y - point.y;
      const softened = dx * dx + dy * dy + this.centerEpsilon * this.centerEpsilon;
      if (softened <= 1e-9) {
        return { x: 0, y: 0 };
      }
      const factor = this.centerMu / Math.pow(softened, 1.5);
      let ax = dx * factor;
      let ay = dy * factor;
      const length = Math.hypot(ax, ay);
      if (length > this.maxCenterAccel) {
        const scale = this.maxCenterAccel / length;
        ax *= scale;
        ay *= scale;
      }
      return { x: ax, y: ay };
    }

    edgeGrabAcceleration(point) {
      let ax = (this.grabTarget.x - point.x) * this.edgeGrabStiffness;
      let ay = (this.grabTarget.y - point.y) * this.edgeGrabStiffness;
      const length = Math.hypot(ax, ay);
      if (length > this.edgeGrabMaxAccel) {
        const scale = this.edgeGrabMaxAccel / length;
        ax *= scale;
        ay *= scale;
      }
      return { x: ax, y: ay };
    }

    edgeGrabWeight(index) {
      if (this.grabIndex < 0 || this.segments === 0) {
        return 0;
      }
      let distance = Math.abs(index - this.grabIndex);
      distance = Math.min(distance, this.segments - distance);
      if (distance === 0) {
        return 1;
      }
      if (distance === 1) {
        return 0.65;
      }
      if (distance === 2) {
        return 0.35;
      }
      if (distance === 3) {
        return 0.15;
      }
      return 0;
    }

    centerGrabAcceleration() {
      let vx = 0;
      let vy = 0;
      for (const velocity of this.velocities) {
        vx += velocity.x;
        vy += velocity.y;
      }
      vx /= Math.max(this.velocities.length, 1);
      vy /= Math.max(this.velocities.length, 1);

      let ax = (this.grabTarget.x - this.centroid.x) * this.grabStiffness - vx * this.centerGrabDamping;
      let ay = (this.grabTarget.y - this.centroid.y) * this.grabStiffness - vy * this.centerGrabDamping;
      const length = Math.hypot(ax, ay);
      if (length > this.grabMaxAccel) {
        const scale = this.grabMaxAccel / length;
        ax *= scale;
        ay *= scale;
      }
      return { x: ax, y: ay };
    }

    solveDistanceConstraints() {
      for (let i = 0; i < this.segments; i += 1) {
        const next = (i + 1) % this.segments;
        this.solveDistance(i, next, this.restEdgeLengths[i], this.edgeStiffness);
        const skip = (i + 2) % this.segments;
        this.solveDistance(i, skip, this.restSkipLengths[i], this.bendingStiffness);
      }
    }

    solveDistance(a, b, restLength, stiffness) {
      const pa = this.positions[a];
      const pb = this.positions[b];
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let currentDistance = Math.hypot(dx, dy);
      if (currentDistance < 1e-6) {
        dx = 1;
        dy = 0;
        currentDistance = 1e-6;
      }
      const correction = ((currentDistance - restLength) / currentDistance) * 0.5 * clamp(stiffness, 0, 1);
      const offsetX = dx * correction;
      const offsetY = dy * correction;
      pa.x += offsetX;
      pa.y += offsetY;
      pb.x -= offsetX;
      pb.y -= offsetY;
    }

    solveAreaConstraint() {
      if (this.areaStrength <= 0) {
        return;
      }
      const area = this.signedArea(this.positions);
      const error = area - this.restArea;
      const gradients = new Array(this.segments);
      let gradientSum = 0;
      for (let i = 0; i < this.segments; i += 1) {
        const prev = this.positions[(i - 1 + this.segments) % this.segments];
        const next = this.positions[(i + 1) % this.segments];
        const gradient = {
          x: 0.5 * (next.y - prev.y),
          y: 0.5 * (prev.x - next.x),
        };
        gradients[i] = gradient;
        gradientSum += gradient.x * gradient.x + gradient.y * gradient.y;
      }
      if (gradientSum < 1e-9) {
        return;
      }
      const factor = (-error / gradientSum) * clamp(this.areaStrength, 0, 1);
      for (let i = 0; i < this.segments; i += 1) {
        this.positions[i].x += gradients[i].x * factor;
        this.positions[i].y += gradients[i].y * factor;
      }
    }

    solveShapeConstraint() {
      if (this.shapeStrength <= 0) {
        return;
      }
      const center = this.average(this.positions);
      const strength = clamp(this.shapeStrength, 0, 1);
      for (let i = 0; i < this.segments; i += 1) {
        const offsetX = this.positions[i].x - center.x;
        const offsetY = this.positions[i].y - center.y;
        const currentDistance = Math.hypot(offsetX, offsetY);
        if (currentDistance < 1e-6) {
          continue;
        }
        const correction = (currentDistance - this.restRadius) * strength;
        this.positions[i].x -= (offsetX / currentDistance) * correction;
        this.positions[i].y -= (offsetY / currentDistance) * correction;
      }
    }

    clampToArena() {
      const minX = this.arena.x;
      const minY = this.arena.y;
      const maxX = this.arena.x + this.arena.w;
      const maxY = this.arena.y + this.arena.h;
      for (let i = 0; i < this.segments; i += 1) {
        this.positions[i].x = clamp(this.positions[i].x, minX, maxX);
        this.positions[i].y = clamp(this.positions[i].y, minY, maxY);
      }
    }

    handleWallResponse() {
      this.lastContact = false;
      const minX = this.arena.x;
      const minY = this.arena.y;
      const maxX = this.arena.x + this.arena.w;
      const maxY = this.arena.y + this.arena.h;
      const tangentKeep = 1 - clamp(this.wallFriction, 0, 1);

      for (let i = 0; i < this.segments; i += 1) {
        const p = this.positions[i];
        const v = this.velocities[i];
        let touched = false;

        if (p.x <= minX + this.wallEpsilon) {
          touched = true;
          if (v.x < 0) {
            v.x = -v.x * this.restitution;
            if (Math.abs(v.x) < this.settleSpeed) {
              v.x = 0;
            }
          }
          v.y *= tangentKeep;
        } else if (p.x >= maxX - this.wallEpsilon) {
          touched = true;
          if (v.x > 0) {
            v.x = -v.x * this.restitution;
            if (Math.abs(v.x) < this.settleSpeed) {
              v.x = 0;
            }
          }
          v.y *= tangentKeep;
        }

        if (p.y <= minY + this.wallEpsilon) {
          touched = true;
          if (v.y < 0) {
            v.y = -v.y * this.restitution;
            if (Math.abs(v.y) < this.settleSpeed) {
              v.y = 0;
            }
          }
          v.x *= tangentKeep;
        } else if (p.y >= maxY - this.wallEpsilon) {
          touched = true;
          if (v.y > 0) {
            v.y = -v.y * this.restitution;
            if (Math.abs(v.y) < this.settleSpeed) {
              v.y = 0;
            }
          }
          v.x *= tangentKeep;
        }

        if (touched) {
          this.lastContact = true;
        }
      }
    }

    limitSpeed(index) {
      const velocity = this.velocities[index];
      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed > this.maxSpeed && speed > 0) {
        const scale = this.maxSpeed / speed;
        velocity.x *= scale;
        velocity.y *= scale;
      }
    }

    updateMetrics() {
      this.lastMaxSpeed = 0;
      for (const velocity of this.velocities) {
        this.lastMaxSpeed = Math.max(this.lastMaxSpeed, Math.hypot(velocity.x, velocity.y));
      }
      const area = Math.abs(this.signedArea(this.positions));
      const target = Math.abs(this.restArea);
      this.lastAreaError = target < 1e-9 ? 0 : Math.abs(area - target) / target;
    }

    signedArea(points) {
      let total = 0;
      const count = points.length;
      for (let i = 0; i < count; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % count];
        total += a.x * b.y - b.x * a.y;
      }
      return total * 0.5;
    }

    average(points) {
      if (points.length === 0) {
        return { x: 0, y: 0 };
      }
      let x = 0;
      let y = 0;
      for (const point of points) {
        x += point.x;
        y += point.y;
      }
      return { x: x / points.length, y: y / points.length };
    }

    grabAt(point, maxDistance = 110, mode = "edge") {
      if (mode === "center") {
        const distanceToCenter = Math.hypot(this.centroid.x - point.x, this.centroid.y - point.y);
        if (distanceToCenter > maxDistance) {
          return false;
        }
        this.grabIndex = -1;
        this.centerGrab = true;
        this.grabTarget = this.clampPoint(point);
        return true;
      }

      let bestIndex = -1;
      let bestDistanceSq = maxDistance * maxDistance;
      for (let i = 0; i < this.segments; i += 1) {
        const dx = this.positions[i].x - point.x;
        const dy = this.positions[i].y - point.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestIndex = i;
        }
      }
      this.centerGrab = false;
      this.grabIndex = bestIndex;
      if (bestIndex >= 0) {
        this.grabTarget = this.clampPoint(point);
      }
      return bestIndex >= 0;
    }

    updateGrab(point) {
      if (this.grabIndex >= 0 || this.centerGrab) {
        this.grabTarget = this.clampPoint(point);
      }
    }

    releaseGrab() {
      this.grabIndex = -1;
      this.centerGrab = false;
    }

    clampPoint(point) {
      return {
        x: clamp(point.x, this.arena.x, this.arena.x + this.arena.w),
        y: clamp(point.y, this.arena.y, this.arena.y + this.arena.h),
      };
    }

    getBodyRadius() {
      if (this.positions.length === 0) {
        return this.restRadius;
      }
      let total = 0;
      for (const point of this.positions) {
        total += Math.hypot(point.x - this.centroid.x, point.y - this.centroid.y);
      }
      return total / this.positions.length;
    }
  }

  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  return { SoftBodySim, SEGMENTS };
}));
