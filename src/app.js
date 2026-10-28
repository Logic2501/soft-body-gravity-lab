(function () {
  "use strict";

  if (typeof SoftBodySim === "undefined" || typeof resolveBodyCollisions !== "function" || typeof createWaterPalette !== "function" || typeof mergeSoftBodies !== "function" || typeof splitSoftBody !== "function" || typeof shouldSplitBody !== "function") {
    document.body.innerHTML = "<p style='font-family:sans-serif;color:#fff;padding:24px'>物理模块加载失败：请确认 src/soft_body_sim.js、src/body_collisions.js、src/body_palette.js 与 src/body_merge_split.js 存在。</p>";
    return;
  }

  const WORLD_W = 900;
  const WORLD_H = 780;
  const ARENA = { x: 24, y: 24, w: 852, h: 732 };
  const CENTER = { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };
  const RADIUS = 15;
  const EDGE_PARTICLES = 8;
  const INITIAL_DROPS = 6;
  const MAX_BODIES = 32;
  const FIXED_STEP = 1 / 240;
  const MAX_STEPS_PER_FRAME = 24;
  const METRICS_INTERVAL = 0.25;
  const WATER_CHECK_INTERVAL = 1 / 60;
  const EMITTER_INTERVAL = 1.0;
  const MANUAL_EMIT_INTERVAL = 0.44;
  const LAUNCH_HOLD = 0.34;
  const CONTOUR_CELL = 10;
  const CONTOUR_COLOR = "rgba(108, 224, 214, 0.26)";
  const CONTOUR_MAJOR = "rgba(140, 244, 226, 0.40)";
  const EMITTERS = [
    { x: ARENA.x + 64, y: ARENA.y + ARENA.h - 18, direction: 1, label: "左水龙头" },
    { x: ARENA.x + ARENA.w - 64, y: ARENA.y + ARENA.h - 18, direction: -1, label: "右水龙头" },
  ];

  const COLORS = {
    background: "#070b14",
    arena: "#101a2b",
    grid: "rgba(66, 110, 140, 0.22)",
    border: "#5cf0c0",
    text: "rgba(220, 238, 240, 0.88)",
    textMuted: "rgba(180, 208, 214, 0.58)",
    bodyEdge: [46, 174, 134],
    bodyCenter: [142, 240, 195],
    bodyOutline: "#083f35",
    bodyRim: "rgba(168, 255, 232, 0.95)",
    shadow: "rgba(0, 0, 0, 0.22)",
    tether: "#ffd166",
    faucet: "#68d8e8",
    faucetGlow: "rgba(104, 216, 232, 0.28)",
  };

  const PARAMS = [
    {
      key: "gravity",
      label: "重力强度",
      min: 0,
      max: 2500,
      step: 10,
      decimals: 0,
      unit: "px/s²",
      help: "全局向下加速度。越大下落和撞墙越猛；调到 0 可单独观察中心引力。",
    },
    {
      key: "body_size",
      label: "软体大小",
      min: 10,
      max: 60,
      step: 1,
      decimals: 0,
      unit: "px",
      help: "只影响之后发射的新水滴；已有和合并后的水滴不会被缩放。默认 15 px。",
    },
    {
      key: "edge_particles",
      label: "边缘质点数",
      min: 8,
      max: 24,
      step: 2,
      decimals: 0,
      unit: "",
      help: "轮廓质点数量，8–24；默认 8。改变后会按当前圆心和大小重建所有水滴轮廓。",
    },
    {
      key: "edge_stiffness",
      label: "边缘刚度",
      min: 0,
      max: 0.03,
      step: 0.001,
      decimals: 3,
      unit: "",
      help: "轮廓相邻质点的距离约束。水流版缩小到 0–0.03，默认 0.010；越低越容易拉伸、挤压和分裂。",
    },
    {
      key: "bending_stiffness",
      label: "弯曲刚度",
      min: 0,
      max: 0.2,
      step: 0.01,
      decimals: 2,
      unit: "",
      help: "隔点约束，抵抗轮廓折角。调低更容易出现尖锐折痕；0 完全允许边缘折叠。",
    },
    {
      key: "area_strength",
      label: "面积保持",
      min: 0,
      max: 10,
      step: 0.1,
      decimals: 1,
      unit: "×10⁻³",
      help: "维持轮廓总面积。UI 以 ×10⁻³ 显示，范围 0–10、步进 0.1；默认 2 对应物理值 0.002。0 完全不约束。",
    },
    {
      key: "shape_strength",
      label: "形状保持",
      min: 0,
      max: 0.01,
      step: 0.001,
      decimals: 3,
      unit: "",
      help: "把质点拉回初始半径，维持圆形记忆。范围 0–0.01，步进 0.001；0 完全自由，越大越接近圆形。",
    },
    {
      key: "outline_smoothing",
      label: "轮廓平滑",
      min: 0,
      max: 1,
      step: 0.01,
      decimals: 2,
      unit: "",
      help: "只影响绘制，不影响物理。越高折痕越圆润；调到 0 会直接显示质点轮廓的尖锐折角。",
    },
    {
      key: "damping",
      label: "阻尼",
      min: 0,
      max: 8,
      step: 0.1,
      decimals: 1,
      unit: "1/s",
      help: "速度衰减率。越高越快停下；越低振荡和回弹持续越久，0 几乎不衰减。",
    },
    {
      key: "center_grab_damping",
      label: "中心拖拽阻尼",
      min: 0,
      max: 80,
      step: 1,
      decimals: 0,
      unit: "",
      help: "中心点拖拽的阻尼。越大越稳、越不晃；越小越跟手。默认 20，约半临界阻尼。",
    },
    {
      key: "restitution",
      label: "边界恢复",
      min: 0,
      max: 1,
      step: 0.01,
      decimals: 2,
      unit: "",
      help: "撞墙后的法向反弹比例。0 吸收冲击几乎不弹；1 近似完全反弹。",
    },
    {
      key: "wall_friction",
      label: "边界摩擦",
      min: 0,
      max: 1,
      step: 0.01,
      decimals: 2,
      unit: "",
      help: "撞墙时切向速度损失。越高越不容易沿墙滑动；0 完全无摩擦。",
    },
  ];

  const PARAM_BY_KEY = Object.fromEntries(PARAMS.map((param) => [param.key, param]));

  const templateSim = new SoftBodySim();
  templateSim.setup(ARENA, CENTER, CENTER, RADIUS, EDGE_PARTICLES);
  templateSim.gravity = 500;
  templateSim.centerMu = 0;
  templateSim.edgeStiffness = 0.01;
  templateSim.bendingStiffness = 0;
  templateSim.areaStrength = 0.002;
  templateSim.shapeStrength = 0;
  templateSim.damping = 0.18;
  templateSim.restitution = 0.02;
  templateSim.wallFriction = 0.01;

  const WATER_PALETTE = createWaterPalette();

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const paramsEl = document.getElementById("params");
  const pauseButton = document.getElementById("pause");
  const resetButton = document.getElementById("reset");
  const defaultsButton = document.getElementById("defaults");
  const addBodyButton = document.getElementById("add-body");
  const removeBodyButton = document.getElementById("remove-body");
  const bodyCountEl = document.getElementById("body-count");
  const grabModeButton = document.getElementById("grab-mode");
  const eraseModeButton = document.getElementById("erase-mode");
  const debugCheckbox = document.getElementById("debug");
  const equipotentialCheckbox = document.getElementById("equipotential");
  const autoEmitCheckbox = document.getElementById("auto-emit");
  const paramHelpEl = document.getElementById("param-help");
  const statusEl = document.getElementById("status");
  const metricsEl = document.getElementById("metrics");

  const bodies = [];
  const rowElements = {};
  let bodySize = RADIUS;
  let edgeParticles = EDGE_PARTICLES;
  let outlineSmoothing = 1.0;
  let mergeCount = 0;
  let splitCount = 0;
  let emitCount = 0;
  let nextEmitterIndex = 0;
  let waterCheckTimer = 0;
  let autoEmit = autoEmitCheckbox ? autoEmitCheckbox.checked : false;
  let emitterTimers = EMITTERS.map((_, index) => 0.35 + index * 0.45);
  const manualEmitterTimers = EMITTERS.map(() => MANUAL_EMIT_INTERVAL);
  const keyEmitterHeld = EMITTERS.map(() => false);
  let pointerEmitter = -1;
  const values = snapshotParams(templateSim);
  const defaultValues = { ...values };

  let dpr = 1;
  let paused = false;
  let dragging = false;
  let activePointer = null;
  let activeBody = null;
  let grabMode = "edge";
  let eraseMode = false;
  let debugDraw = false;
  let showEquipotential = false;
  let contourCache = null;
  let lastFrameTime = performance.now();
  let accumulator = 0;
  let metricsTimer = 0;

  function snapshotParams(sourceSim) {
    return {
      gravity: sourceSim.gravity,
      body_size: bodySize,
      edge_particles: edgeParticles,
      edge_stiffness: sourceSim.edgeStiffness,
      bending_stiffness: sourceSim.bendingStiffness,
      area_strength: sourceSim.areaStrength * 1000,
      shape_strength: sourceSim.shapeStrength,
      outline_smoothing: outlineSmoothing,
      damping: sourceSim.damping,
      center_grab_damping: sourceSim.centerGrabDamping,
      restitution: sourceSim.restitution,
      wall_friction: sourceSim.wallFriction,
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatValue(value, decimals) {
    return Number(value).toFixed(decimals);
  }

  function buildPanel() {
    for (const definition of PARAMS) {
      const row = document.createElement("div");
      row.className = "param";
      row.dataset.key = definition.key;

      const label = document.createElement("label");
      label.className = "param-label";
      label.htmlFor = `${definition.key}-range`;
      label.textContent = definition.label;
      const helpDot = document.createElement("span");
      helpDot.className = "param-help-dot";
      helpDot.textContent = "?";
      helpDot.setAttribute("aria-hidden", "true");
      label.append(helpDot);

      const range = document.createElement("input");
      range.type = "range";
      range.id = `${definition.key}-range`;
      range.min = String(definition.min);
      range.max = String(definition.max);
      range.step = String(definition.step);
      range.value = String(values[definition.key]);
      range.setAttribute("aria-label", `${definition.label}滑块`);

      const number = document.createElement("input");
      number.type = "number";
      number.className = "param-number";
      number.min = String(definition.min);
      number.max = String(definition.max);
      number.step = String(definition.step);
      number.value = formatValue(values[definition.key], definition.decimals);
      number.setAttribute("aria-label", `${definition.label}数值`);
      number.inputMode = "decimal";
      range.setAttribute("aria-describedby", "param-help");
      number.setAttribute("aria-describedby", "param-help");
      label.title = definition.help;
      range.title = definition.help;
      number.title = definition.help;
      row.title = definition.help;

      const unit = document.createElement("span");
      unit.className = "param-unit";
      unit.textContent = definition.unit;

      row.append(label, range, number, unit);
      paramsEl.append(row);
      rowElements[definition.key] = { range, number, definition };

      range.addEventListener("input", () => {
        setParameter(definition.key, Number(range.value), true);
      });

      const commitNumber = () => {
        const raw = number.value.trim();
        const parsed = Number(raw);
        if (raw === "" || !Number.isFinite(parsed)) {
          number.value = formatValue(values[definition.key], definition.decimals);
          return;
        }
        setParameter(definition.key, parsed, true);
      };

      number.addEventListener("change", commitNumber);
      number.addEventListener("blur", commitNumber);
      number.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitNumber();
          number.blur();
        }
      });

      const showHelp = () => {
        if (paramHelpEl) {
          paramHelpEl.textContent = `${definition.label}：${definition.help}`;
        }
      };
      row.addEventListener("pointerenter", showHelp);
      row.addEventListener("focusin", showHelp);
      row.addEventListener("click", showHelp);
      if (definition.key === "gravity" && paramHelpEl) {
        paramHelpEl.textContent = `${definition.label}：${definition.help}`;
      }
    }
  }

  function syncRow(key) {
    const row = rowElements[key];
    if (!row) {
      return;
    }
    row.range.value = String(values[key]);
    row.number.value = formatValue(values[key], row.definition.decimals);
  }

  function setParameter(key, displayValue, syncControls) {
    const definition = PARAM_BY_KEY[key];
    if (!definition) {
      return false;
    }
    let next = Number(displayValue);
    if (!Number.isFinite(next)) {
      next = values[key];
    }
    next = clamp(next, definition.min, definition.max);
    values[key] = next;
    applyParameterToSim(key, next);
    if (syncControls) {
      syncRow(key);
    }
    return true;
  }

  function applyParamsToBody(body) {
    body.gravity = values.gravity;
    body.centerMu = 0;
    body.edgeStiffness = values.edge_stiffness;
    body.bendingStiffness = values.bending_stiffness;
    body.areaStrength = values.area_strength / 1000;
    body.shapeStrength = values.shape_strength;
    body.damping = values.damping;
    body.centerGrabDamping = values.center_grab_damping;
    body.restitution = values.restitution;
    body.wallFriction = values.wall_friction;
  }

  function applyParameterToSim(key, displayValue) {
    if (key === "body_size") {
      bodySize = displayValue;
      return;
    }
    if (key === "edge_particles") {
      edgeParticles = displayValue;
      endDrag();
      for (const body of bodies) {
        body.setSegments(edgeParticles);
      }
      resolveBodyCollisions(bodies, { margin: 2, iterations: 3, restitution: 0 });
      updateMetrics();
      return;
    }
    if (key === "outline_smoothing") {
      outlineSmoothing = displayValue;
      return;
    }
    for (const body of bodies) {
      switch (key) {
        case "gravity":
          body.gravity = displayValue;
          break;
        case "edge_stiffness":
          body.edgeStiffness = displayValue;
          break;
        case "bending_stiffness":
          body.bendingStiffness = displayValue;
          break;
        case "area_strength":
          body.areaStrength = displayValue / 1000;
          break;
        case "shape_strength":
          body.shapeStrength = displayValue;
          break;
        case "damping":
          body.damping = displayValue;
          break;
        case "center_grab_damping":
          body.centerGrabDamping = displayValue;
          break;
        case "restitution":
          body.restitution = displayValue;
          break;
        case "wall_friction":
          body.wallFriction = displayValue;
          break;
        default:
          break;
      }
    }
  }

  function createBodyAt(spawn, options = {}) {
    const body = new SoftBodySim();
    body.setup(ARENA, CENTER, spawn, bodySize, edgeParticles);
    body.palette = WATER_PALETTE;
    applyParamsToBody(body);
    body.waterAge = 0;
    body.mergeCooldown = Number.isFinite(options.mergeCooldown) ? options.mergeCooldown : 0;
    body.launchRemaining = 0;
    return body;
  }

  function bodyBoundingRadius(body) {
    let radius = 0;
    for (const point of body.positions) {
      radius = Math.max(radius, Math.hypot(point.x - body.centroid.x, point.y - body.centroid.y));
    }
    return radius;
  }

  function bodyEdgeStrain(body) {
    let strain = 0;
    for (let i = 0; i < body.positions.length; i += 1) {
      const a = body.positions[i];
      const b = body.positions[(i + 1) % body.positions.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const rest = Math.max(body.restEdgeLengths[i], 1e-6);
      strain = Math.max(strain, Math.abs(length - rest) / rest);
    }
    return strain;
  }

  function updateBodyCount() {
    if (bodyCountEl) {
      bodyCountEl.textContent = `${bodies.length} / ${MAX_BODIES} 滴`;
    }
    if (removeBodyButton) {
      removeBodyButton.disabled = bodies.length === 0;
    }
  }

  function spawnFromEmitter(index) {
    if (bodies.length >= MAX_BODIES) {
      return false;
    }
    const emitter = EMITTERS[index % EMITTERS.length];
    const spawn = {
      x: emitter.x + emitter.direction * 4,
      y: ARENA.y + ARENA.h - bodySize - 6,
    };
    const body = createBodyAt(spawn, { mergeCooldown: 0.25 });
    body.launchRemaining = LAUNCH_HOLD;
    body.launchTarget = {
      x: emitter.x + emitter.direction * 100,
      y: ARENA.y + ARENA.h - 300,
    };
    body.grabIndex = -1;
    body.centerGrab = true;
    body.grabTarget = { ...body.launchTarget };
    body.centerGrabDamping = Math.max(body.centerGrabDamping, 50);
    body.grabMaxAccel = 1800;
    bodies.push(body);
    emitCount += 1;
    updateBodyCount();
    updateMetrics();
    return true;
  }

  function emitFromNextEmitter() {
    const emitted = spawnFromEmitter(nextEmitterIndex);
    if (emitted) {
      nextEmitterIndex = (nextEmitterIndex + 1) % EMITTERS.length;
    }
    return emitted;
  }

  function isEmitterHeld(index) {
    return keyEmitterHeld[index] || pointerEmitter === index;
  }

  function startEmitterHold(index, source) {
    const wasHeld = isEmitterHeld(index);
    if (source === "pointer") {
      pointerEmitter = index;
    } else {
      keyEmitterHeld[index] = true;
    }
    if (wasHeld) {
      return;
    }
    manualEmitterTimers[index] = MANUAL_EMIT_INTERVAL;
    spawnFromEmitter(index);
  }

  function releaseEmitterHold(index, source) {
    if (source === "pointer") {
      if (pointerEmitter === index) {
        pointerEmitter = -1;
      }
    } else {
      keyEmitterHeld[index] = false;
    }
  }

  function stopEmitterHolds() {
    for (let i = 0; i < keyEmitterHeld.length; i += 1) {
      keyEmitterHeld[i] = false;
    }
    pointerEmitter = -1;
  }

  function updateManualEmitters(dt) {
    for (let i = 0; i < EMITTERS.length; i += 1) {
      if (!isEmitterHeld(i)) {
        continue;
      }
      manualEmitterTimers[i] -= dt;
      if (manualEmitterTimers[i] > 0) {
        continue;
      }
      manualEmitterTimers[i] += MANUAL_EMIT_INTERVAL;
      spawnFromEmitter(i);
    }
  }

  function emitterAt(point) {
    const bottom = ARENA.y + ARENA.h;
    for (let i = 0; i < EMITTERS.length; i += 1) {
      const emitter = EMITTERS[i];
      if (Math.abs(point.x - emitter.x) <= 38 && point.y >= bottom - 96 && point.y <= bottom) {
        return i;
      }
    }
    return -1;
  }

  function updateEmitters(dt) {
    if (!autoEmit) {
      return;
    }
    for (let i = 0; i < EMITTERS.length; i += 1) {
      emitterTimers[i] -= dt;
      if (emitterTimers[i] > 0) {
        continue;
      }
      emitterTimers[i] += EMITTER_INTERVAL;
      spawnFromEmitter(i);
    }
  }

  function updateLaunchers(dt) {
    for (const body of bodies) {
      if (!(body.launchRemaining > 0)) {
        continue;
      }
      if (body === activeBody) {
        body.launchRemaining = 0;
        continue;
      }
      body.launchRemaining -= dt;
      body.grabTarget = { ...body.launchTarget };
      if (body.launchRemaining <= 0) {
        body.launchRemaining = 0;
        body.releaseGrab();
      }
    }
  }

  function requestAddBody() {
    return emitFromNextEmitter();
  }

  function removeOldestBody() {
    if (bodies.length === 0) {
      return;
    }
    const removed = bodies.shift();
    if (activeBody === removed) {
      endDrag();
    }
    updateBodyCount();
    updateMetrics();
  }

  function updateWater(dt) {
    for (const body of bodies) {
      body.waterAge = (body.waterAge || 0) + dt;
      body.mergeCooldown = Math.max(0, (body.mergeCooldown || 0) - dt);
    }

    waterCheckTimer += dt;
    if (waterCheckTimer < WATER_CHECK_INTERVAL) {
      return;
    }
    waterCheckTimer = 0;

    let changed = false;
    const mergeGap = typeof WATER_MERGE_GAP === "number" ? WATER_MERGE_GAP : 8;

    for (let i = bodies.length - 1; i >= 0; i -= 1) {
      if (bodies.length >= MAX_BODIES) {
        break;
      }
      const body = bodies[i];
      if (body === activeBody || !shouldSplitBody(body)) {
        continue;
      }
      const children = splitSoftBody(body);
      if (!children || children.length !== 2) {
        continue;
      }
      bodies.splice(i, 1, children[0], children[1]);
      splitCount += 1;
      changed = true;
    }

    for (let i = 0; i < bodies.length; i += 1) {
      let j = i + 1;
      while (j < bodies.length) {
        const a = bodies[i];
        const b = bodies[j];
        if (a === activeBody || b === activeBody || a.launchRemaining > 0 || b.launchRemaining > 0) {
          j += 1;
          continue;
        }
        if ((a.mergeCooldown || 0) > 0 || (b.mergeCooldown || 0) > 0) {
          j += 1;
          continue;
        }
        const centerDistance = Math.hypot(a.centroid.x - b.centroid.x, a.centroid.y - b.centroid.y);
        if (centerDistance > bodyBoundingRadius(a) + bodyBoundingRadius(b) + mergeGap) {
          j += 1;
          continue;
        }
        if (bodyCollisionDistance(a, b) > mergeGap) {
          j += 1;
          continue;
        }
        const merged = mergeSoftBodies(a, b, { mergeCooldown: 0.55 });
        if (!merged) {
          j += 1;
          continue;
        }
        merged.palette = a.palette;
        bodies[i] = merged;
        bodies.splice(j, 1);
        mergeCount += 1;
        changed = true;
      }
    }

    if (changed) {
      updateBodyCount();
      updateMetrics();
    }
  }

  function setPaused(nextPaused) {
    paused = nextPaused;
    if (paused) {
      endDrag();
    }
    pauseButton.textContent = paused ? "继续" : "暂停";
    statusEl.textContent = paused ? "已暂停 · 参数仍可实时调整" : "运行中 · 水流 + 重力";
    statusEl.classList.toggle("paused", paused);
    accumulator = 0;
  }

  function togglePause() {
    setPaused(!paused);
  }

  function setGrabMode(mode) {
    grabMode = mode === "center" ? "center" : "edge";
    setEraseMode(false);
    endDrag();
    grabModeButton.textContent = grabMode === "center" ? "拖拽点：中心" : "拖拽点：边缘";
    grabModeButton.classList.toggle("active", grabMode === "center");
    grabModeButton.setAttribute("aria-pressed", String(grabMode === "center"));
  }

  function toggleGrabMode() {
    setGrabMode(grabMode === "edge" ? "center" : "edge");
  }

  function setEraseMode(enabled) {
    eraseMode = Boolean(enabled);
    endDrag();
    if (eraseModeButton) {
      eraseModeButton.textContent = eraseMode ? "擦除模式：开" : "擦除模式：关";
      eraseModeButton.classList.toggle("active", eraseMode);
      eraseModeButton.setAttribute("aria-pressed", String(eraseMode));
    }
    canvas.classList.toggle("erasing", eraseMode);
  }

  function toggleEraseMode() {
    setEraseMode(!eraseMode);
  }

  function pointInPolygon(points, point) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[i];
      const b = points[j];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  function eraseAt(point) {
    let removed = 0;
    for (let i = bodies.length - 1; i >= 0; i -= 1) {
      const body = bodies[i];
      const nearCenter = Math.hypot(body.centroid.x - point.x, body.centroid.y - point.y)
        <= Math.max(body.restRadius * 0.75, 10);
      if (!nearCenter && !pointInPolygon(body.positions, point)) {
        continue;
      }
      if (activeBody === body) {
        endDrag();
      }
      bodies.splice(i, 1);
      removed += 1;
    }
    if (removed > 0) {
      updateBodyCount();
      updateMetrics();
    }
    return removed;
  }

  function setAutoEmit(enabled) {
    autoEmit = Boolean(enabled);
    if (autoEmitCheckbox) {
      autoEmitCheckbox.checked = autoEmit;
    }
  }

  function resetSimulation() {
    endDrag();
    stopEmitterHolds();
    bodies.length = 0;
    mergeCount = 0;
    splitCount = 0;
    emitCount = 0;
    nextEmitterIndex = 0;
    waterCheckTimer = 0;
    emitterTimers = EMITTERS.map((_, index) => 0.35 + index * 0.45);
    const spacing = Math.max(bodySize * 2.1, 28);
    for (let i = 0; i < INITIAL_DROPS; i += 1) {
      const spawn = {
        x: CENTER.x + (i - (INITIAL_DROPS - 1) / 2) * spacing,
        y: ARENA.y + ARENA.h - bodySize - 8,
      };
      bodies.push(createBodyAt(spawn));
    }
    metricsTimer = 0;
    updateBodyCount();
    updateMetrics();
  }

  function restoreDefaults() {
    for (const definition of PARAMS) {
      setParameter(definition.key, defaultValues[definition.key], true);
    }
    updateMetrics();
  }

  function updateMetrics() {
    if (bodies.length === 0) {
      metricsEl.textContent = "无软体 · 点击 + 添加";
      return;
    }
    let maxSpeed = 0;
    let maxAreaError = 0;
    let contact = false;
    for (const body of bodies) {
      maxSpeed = Math.max(maxSpeed, body.lastMaxSpeed);
      maxAreaError = Math.max(maxAreaError, body.lastAreaError);
      contact = contact || body.lastContact;
    }
    const contactText = contact ? " · 接触边界" : "";
    metricsEl.textContent = `最大速度 ${Math.round(maxSpeed)} px/s\n最大面积误差 ${(maxAreaError * 100).toFixed(1)}%${contactText}\n合并 ${mergeCount} · 分离 ${splitCount} · ${bodies.length} 滴`;
  }

  function setupCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(WORLD_W * dpr);
    canvas.height = Math.round(WORLD_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function toWorld(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WORLD_W,
      y: ((event.clientY - rect.top) / rect.height) * WORLD_H,
    };
  }

  function pointInArena(point) {
    return point.x >= ARENA.x && point.x <= ARENA.x + ARENA.w && point.y >= ARENA.y && point.y <= ARENA.y + ARENA.h;
  }

  function endDrag() {
    pointerEmitter = -1;
    if (activeBody) {
      activeBody.releaseGrab();
    }
    activeBody = null;
    if (!dragging) {
      return;
    }
    dragging = false;
    activePointer = null;
    canvas.classList.remove("grabbing");
  }

  function findGrabBody(point) {
    if (grabMode === "center") {
      let bestBody = null;
      let bestDistance = Infinity;
      for (const body of bodies) {
        const distance = Math.hypot(body.centroid.x - point.x, body.centroid.y - point.y);
        const threshold = Math.max(body.restRadius * 1.5 + 12, 70);
        if (distance <= threshold && distance < bestDistance) {
          bestDistance = distance;
          bestBody = body;
        }
      }
      if (!bestBody) {
        return null;
      }
      bestBody.grabIndex = -1;
      bestBody.centerGrab = true;
      bestBody.grabTarget = bestBody.clampPoint(point);
      return bestBody;
    }

    let bestBody = null;
    let bestIndex = -1;
    let bestDistanceSq = 110 * 110;
    for (const body of bodies) {
      for (let i = 0; i < body.positions.length; i += 1) {
        const dx = body.positions[i].x - point.x;
        const dy = body.positions[i].y - point.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestBody = body;
          bestIndex = i;
        }
      }
    }
    if (!bestBody) {
      return null;
    }
    bestBody.centerGrab = false;
    bestBody.grabIndex = bestIndex;
    bestBody.grabTarget = bestBody.clampPoint(point);
    return bestBody;
  }

  function onPointerDown(event) {
    if (event.button !== 0) {
      return;
    }
    const point = toWorld(event);
    if (!pointInArena(point)) {
      return;
    }
    const emitterIndex = emitterAt(point);
    if (emitterIndex >= 0) {
      startEmitterHold(emitterIndex, "pointer");
      dragging = true;
      activePointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (eraseMode) {
      dragging = true;
      activePointer = event.pointerId;
      eraseAt(point);
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (paused) {
      return;
    }
    activeBody = findGrabBody(point);
    if (!activeBody) {
      return;
    }
    dragging = true;
    activePointer = event.pointerId;
    canvas.classList.add("grabbing");
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!dragging || event.pointerId !== activePointer) {
      return;
    }
    if (pointerEmitter >= 0) {
      event.preventDefault();
      return;
    }
    if (eraseMode) {
      eraseAt(toWorld(event));
      event.preventDefault();
      return;
    }
    if (!activeBody) {
      return;
    }
    activeBody.updateGrab(toWorld(event));
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!dragging || event.pointerId !== activePointer) {
      return;
    }
    endDrag();
    event.preventDefault();
  }

  function frame(now) {
    const frameDelta = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    if (!paused) {
      accumulator += frameDelta;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
        updateLaunchers(FIXED_STEP);
        updateManualEmitters(FIXED_STEP);
        updateEmitters(FIXED_STEP);
        updateWater(FIXED_STEP);
        for (const body of bodies) {
          body.step(FIXED_STEP);
        }
        resolveBodyCollisions(bodies, { margin: 2, iterations: 3, restitution: 0 });
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (steps === MAX_STEPS_PER_FRAME) {
        accumulator = 0;
      }
      metricsTimer += frameDelta;
      if (metricsTimer >= METRICS_INTERVAL) {
        metricsTimer = 0;
        updateMetrics();
      }
    }

    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  function draw(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    drawArena();
    if (showEquipotential) {
      drawEquipotentials();
    }
    drawEmitters(time);
    for (const body of bodies) {
      drawBody(body);
    }
    drawHints();
  }

  function drawArena() {
    ctx.fillStyle = COLORS.arena;
    ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ARENA.x + 48; x < ARENA.x + ARENA.w; x += 48) {
      ctx.moveTo(x, ARENA.y);
      ctx.lineTo(x, ARENA.y + ARENA.h);
    }
    for (let y = ARENA.y + 48; y < ARENA.y + ARENA.h; y += 48) {
      ctx.moveTo(ARENA.x, y);
      ctx.lineTo(ARENA.x + ARENA.w, y);
    }
    ctx.stroke();

    ctx.save();
    ctx.shadowColor = "rgba(92, 240, 192, 0.35)";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.restore();

    drawGravityArrow();
  }

  function drawGravityArrow() {
    const startX = ARENA.x + 36;
    const startY = ARENA.y + 110;
    const endY = startY + 54;
    ctx.strokeStyle = COLORS.text;
    ctx.fillStyle = COLORS.text;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX, endY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(startX, endY + 2);
    ctx.lineTo(startX - 6, endY - 10);
    ctx.lineTo(startX + 6, endY - 10);
    ctx.closePath();
    ctx.fill();
    drawText("g", startX + 12, startY + 2, 17, COLORS.text, "left");
  }

  function drawEmitters(time) {
    const bottom = ARENA.y + ARENA.h;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
    for (const emitter of EMITTERS) {
      const nozzleY = bottom - 26;
      const glow = ctx.createRadialGradient(emitter.x, nozzleY, 0, emitter.x, nozzleY, 28 + pulse * 7);
      glow.addColorStop(0, COLORS.faucetGlow);
      glow.addColorStop(1, "rgba(104, 216, 232, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(emitter.x, nozzleY, 28 + pulse * 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(76, 132, 158, 0.42)";
      ctx.fillRect(emitter.x - 10, bottom - 12, 20, 12);
      ctx.fillStyle = COLORS.faucet;
      ctx.fillRect(emitter.x - 5, nozzleY, 10, 26);
      ctx.fillStyle = "#0b2838";
      ctx.fillRect(emitter.x - 8, nozzleY - 4, 16, 5);

      ctx.strokeStyle = COLORS.faucet;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(emitter.x + emitter.direction * 16, nozzleY - 8);
      ctx.lineTo(emitter.x + emitter.direction * 38, nozzleY - 30);
      ctx.lineTo(emitter.x + emitter.direction * 28, nozzleY - 31);
      ctx.moveTo(emitter.x + emitter.direction * 38, nozzleY - 30);
      ctx.lineTo(emitter.x + emitter.direction * 37, nozzleY - 19);
      ctx.stroke();

      drawText(emitter.label, emitter.x - 22, bottom - 44, 11, COLORS.textMuted, "left");
    }
  }

  function fieldSignature() {
    return values.gravity.toFixed(4);
  }

  function potentialAt(x, y) {
    return -values.gravity * y;
  }

  function buildLevels(values) {
    const sorted = values.slice().sort();
    const count = 14;
    const levels = [];
    const range = sorted[sorted.length - 1] - sorted[0];
    for (let i = 1; i <= count; i += 1) {
      const position = (i / (count + 1)) * (sorted.length - 1);
      const lower = Math.floor(position);
      const upper = Math.min(sorted.length - 1, lower + 1);
      const t = position - lower;
      levels.push(sorted[lower] + (sorted[upper] - sorted[lower]) * t);
    }

    const tolerance = Math.max(range * 0.002, 1e-6);
    const deduped = [];
    for (const level of levels) {
      if (deduped.length === 0 || Math.abs(level - deduped[deduped.length - 1]) > tolerance) {
        deduped.push(level);
      }
    }
    return deduped;
  }

  function marchingSegments(values, cols, rows, dx, dy, level) {
    const segments = [];
    const crossed = (a, b) => (a < level) !== (b < level);
    const interpolate = (a, b, va, vb) => a + ((level - va) / (vb - va)) * (b - a);

    for (let row = 0; row < rows - 1; row += 1) {
      const y0 = ARENA.y + row * dy;
      const y1 = y0 + dy;
      for (let col = 0; col < cols - 1; col += 1) {
        const x0 = ARENA.x + col * dx;
        const x1 = x0 + dx;
        const index = col + row * cols;
        const v0 = values[index];
        const v1 = values[index + 1];
        const v2 = values[index + cols + 1];
        const v3 = values[index + cols];
        const points = [];

        if (crossed(v0, v1)) {
          points.push({ x: interpolate(x0, x1, v0, v1), y: y0 });
        }
        if (crossed(v1, v2)) {
          points.push({ x: x1, y: interpolate(y0, y1, v1, v2) });
        }
        if (crossed(v2, v3)) {
          points.push({ x: interpolate(x1, x0, v2, v3), y: y1 });
        }
        if (crossed(v3, v0)) {
          points.push({ x: x0, y: interpolate(y1, y0, v3, v0) });
        }

        if (points.length === 2) {
          segments.push([points[0].x, points[0].y, points[1].x, points[1].y]);
        } else if (points.length === 4) {
          segments.push([points[0].x, points[0].y, points[1].x, points[1].y]);
          segments.push([points[2].x, points[2].y, points[3].x, points[3].y]);
        }
      }
    }
    return segments;
  }

  function getContours() {
    const signature = fieldSignature();
    if (contourCache && contourCache.signature === signature) {
      return contourCache;
    }
    if (values.gravity === 0) {
      contourCache = { signature, levels: [] };
      return contourCache;
    }

    const cols = Math.ceil(ARENA.w / CONTOUR_CELL) + 1;
    const rows = Math.ceil(ARENA.h / CONTOUR_CELL) + 1;
    const dx = ARENA.w / (cols - 1);
    const dy = ARENA.h / (rows - 1);
    const gridValues = new Float64Array(cols * rows);

    for (let row = 0; row < rows; row += 1) {
      const y = ARENA.y + row * dy;
      for (let col = 0; col < cols; col += 1) {
        gridValues[col + row * cols] = potentialAt(ARENA.x + col * dx, y);
      }
    }

    const levels = buildLevels(gridValues);
    contourCache = {
      signature,
      levels: levels.map((value) => ({
        value,
        segments: marchingSegments(gridValues, cols, rows, dx, dy, value),
      })),
    };
    return contourCache;
  }

  function drawEquipotentials() {
    const contours = getContours();
    if (contours.levels.length === 0) {
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.clip();
    ctx.lineWidth = 1;
    for (let i = 0; i < contours.levels.length; i += 1) {
      const entry = contours.levels[i];
      if (entry.segments.length === 0) {
        continue;
      }
      ctx.strokeStyle = i % 3 === 0 ? CONTOUR_MAJOR : CONTOUR_COLOR;
      ctx.beginPath();
      for (const segment of entry.segments) {
        ctx.moveTo(segment[0], segment[1]);
        ctx.lineTo(segment[2], segment[3]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBody(body) {
    const outline = buildOutline(body);
    if (outline.length < 3) {
      return;
    }
    const center = body.centroid;
    const palette = body.palette || {
      edge: COLORS.bodyEdge,
      center: COLORS.bodyCenter,
      outline: COLORS.bodyOutline,
      rim: COLORS.bodyRim,
    };

    drawPolygon(outline.map((p) => ({ x: p.x + 7, y: p.y + 9 })), COLORS.shadow);

    const bands = 6;
    for (let band = 0; band < bands; band += 1) {
      const t = band / (bands - 1);
      const scale = 1 - 0.12 * t;
      const points = outline.map((p) => ({
        x: center.x + (p.x - center.x) * scale,
        y: center.y + (p.y - center.y) * scale,
      }));
      drawPolygon(points, colorLerp(palette.edge, palette.center, t));
    }

    ctx.lineJoin = "round";
    drawStroke(outline, palette.outline, 2.5);
    drawStroke(outline, palette.rim, 1.1);

    if (debugDraw) {
      drawDebug(center, body);
    }

    if (body === activeBody && (body.grabIndex >= 0 || body.centerGrab)) {
      const grabbed = body.centerGrab ? body.centroid : body.positions[body.grabIndex];
      ctx.strokeStyle = COLORS.tether;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(grabbed.x, grabbed.y);
      ctx.lineTo(body.grabTarget.x, body.grabTarget.y);
      ctx.stroke();
      ctx.fillStyle = COLORS.tether;
      ctx.beginPath();
      ctx.arc(body.grabTarget.x, body.grabTarget.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(grabbed.x, grabbed.y, body.centerGrab ? 10 : 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawDebug(center, body) {
    const n = body.positions.length;
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i += 1) {
      const p = body.positions[i];
      const next = body.positions[(i + 1) % n];
      const skip = body.positions[(i + 2) % n];
      ctx.strokeStyle = "rgba(85, 225, 255, 0.45)";
      line(p, next);
      ctx.strokeStyle = "rgba(245, 180, 90, 0.34)";
      line(p, skip);
      ctx.strokeStyle = "rgba(245, 140, 215, 0.18)";
      line(p, center);
    }
    for (const p of body.positions) {
      ctx.fillStyle = "rgba(235, 255, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255, 210, 90, 1)";
    ctx.beginPath();
    ctx.arc(center.x, center.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function buildOutline(body) {
    const n = body.positions.length;
    const raw = [];
    for (let i = 0; i < n; i += 1) {
      const p0 = body.positions[(i - 1 + n) % n];
      const p1 = body.positions[i];
      const p2 = body.positions[(i + 1) % n];
      const p3 = body.positions[(i + 2) % n];
      for (let j = 0; j < 6; j += 1) {
        raw.push(catmullRom(p0, p1, p2, p3, j / 6));
      }
    }

    const smoothed = raw.map((p) => ({ x: p.x, y: p.y }));
    const count = smoothed.length;
    const temp = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const previous = smoothed[(i - 1 + count) % count];
      const current = smoothed[i];
      const next = smoothed[(i + 1) % count];
      temp[i] = {
        x: current.x + ((previous.x + current.x + next.x) / 3 - current.x) * outlineSmoothing,
        y: current.y + ((previous.y + current.y + next.y) / 3 - current.y) * outlineSmoothing,
      };
    }

    for (const point of temp) {
      point.x = clamp(point.x, ARENA.x + 1, ARENA.x + ARENA.w - 1);
      point.y = clamp(point.y, ARENA.y + 1, ARENA.y + ARENA.h - 1);
    }
    return temp;
  }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    const tangentOutX = 0.5 * (p2.x - p0.x);
    const tangentOutY = 0.5 * (p2.y - p0.y);
    const tangentInX = 0.5 * (p3.x - p1.x);
    const tangentInY = 0.5 * (p3.y - p1.y);
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return {
      x: p1.x * h00 + tangentOutX * h10 + p2.x * h01 + tangentInX * h11,
      y: p1.y * h00 + tangentOutY * h10 + p2.y * h01 + tangentInY * h11,
    };
  }

  function drawPolygon(points, fillStyle) {
    if (points.length < 3) {
      return;
    }
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawStroke(points, strokeStyle, lineWidth) {
    if (points.length < 3) {
      return;
    }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  function line(a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function colorLerp(a, b, t) {
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r}, ${g}, ${bl})`;
  }

  function drawText(text, x, y, size, color, align) {
    ctx.fillStyle = color;
    ctx.font = `${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
  }

  function drawHints() {
    drawText("封闭水流区 · 240 Hz", ARENA.x + 24, ARENA.y + 22, 12, COLORS.textMuted, "left");
    drawText("靠近合并 · 拉伸临界分离", ARENA.x + ARENA.w - 24, ARENA.y + 30, 12, COLORS.textMuted, "right");
    if (showEquipotential && values.gravity !== 0) {
      const x = ARENA.x + ARENA.w - 150;
      const y = ARENA.y + 52;
      ctx.strokeStyle = CONTOUR_MAJOR;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 18, y);
      ctx.stroke();
      drawText("等势能线", x + 25, y, 11, COLORS.textMuted, "left");
    }
  }

  resetSimulation();
  buildPanel();
  setupCanvas();
  setPaused(false);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", setupCanvas);

  pauseButton.addEventListener("click", togglePause);
  resetButton.addEventListener("click", resetSimulation);
  defaultsButton.addEventListener("click", restoreDefaults);
  addBodyButton.addEventListener("click", requestAddBody);
  removeBodyButton.addEventListener("click", removeOldestBody);
  grabModeButton.addEventListener("click", toggleGrabMode);
  if (eraseModeButton) {
    eraseModeButton.addEventListener("click", toggleEraseMode);
  }
  debugCheckbox.addEventListener("change", () => {
    debugDraw = debugCheckbox.checked;
  });
  equipotentialCheckbox.addEventListener("change", () => {
    showEquipotential = equipotentialCheckbox.checked;
  });
  if (autoEmitCheckbox) {
    autoEmitCheckbox.addEventListener("change", () => {
      setAutoEmit(autoEmitCheckbox.checked);
    });
  }

  window.addEventListener("keydown", (event) => {
    const active = document.activeElement;
    const tag = active && active.tagName;
    const typing = tag === "TEXTAREA" || (tag === "INPUT" && active.type !== "checkbox");
    if (typing || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (event.code === "Space") {
      if (tag === "BUTTON" || (tag === "INPUT" && active.type === "checkbox")) {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        togglePause();
      }
    } else if (key === "r") {
      if (!event.repeat) {
        resetSimulation();
      }
    } else if (key === "a" || event.key === "ArrowLeft") {
      event.preventDefault();
      startEmitterHold(0, "key");
    } else if (key === "d" || event.key === "ArrowRight") {
      event.preventDefault();
      startEmitterHold(1, "key");
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.key.toLowerCase() === "a" || event.key === "ArrowLeft") {
      releaseEmitterHold(0, "key");
    } else if (event.key.toLowerCase() === "d" || event.key === "ArrowRight") {
      releaseEmitterHold(1, "key");
    }
  });

  window.addEventListener("blur", () => {
    stopEmitterHolds();
    endDrag();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopEmitterHolds();
    }
  });

  window.__softBodyDemo = {
    get paused() {
      return paused;
    },
    getParams: () => ({ ...values }),
    setParam: (key, value) => setParameter(key, value, true),
    togglePause,
    reset: resetSimulation,
    restoreDefaults,
    getDefaults: () => ({ ...defaultValues }),
    getContours: () => getContours(),
    getBodies: () => bodies.map((body) => ({
      x: body.centroid.x,
      y: body.centroid.y,
      radius: body.restRadius,
      particles: body.positions.length,
      hue: body.palette ? body.palette.hue : null,
      centerGrabDamping: body.centerGrabDamping,
      aspect: bodyAspect(body),
      edgeStrain: bodyEdgeStrain(body),
      areaError: body.lastAreaError,
      waterAge: body.waterAge || 0,
    })),
    getPrimaryBody: () => bodies[0] || null,
    getLargestBody: () => bodies.reduce((largest, body) => (!largest || body.restRadius > largest.restRadius ? body : largest), null),
    addBody: requestAddBody,
    removeOldest: removeOldestBody,
    getGrabMode: () => grabMode,
    setGrabMode,
    getEraseMode: () => eraseMode,
    setEraseMode,
    eraseAt,
    getEmitters: () => EMITTERS.map((emitter) => ({ ...emitter })),
    isAutoEmit: () => autoEmit,
    setAutoEmit,
    emitNow: requestAddBody,
    getWaterStats: () => ({
      bodies: bodies.length,
      maxBodies: MAX_BODIES,
      initialDrops: INITIAL_DROPS,
      mergeCount,
      splitCount,
      emitCount,
      autoEmit,
    }),
  };

  setGrabMode("edge");
  requestAnimationFrame(frame);
}());
