(function () {
  "use strict";

  if (typeof SoftBodySim === "undefined" || typeof resolveBodyCollisions !== "function") {
    document.body.innerHTML = "<p style='font-family:sans-serif;color:#fff;padding:24px'>物理模块加载失败：请确认 src/soft_body_sim.js 与 src/body_collisions.js 存在。</p>";
    return;
  }

  const WORLD_W = 900;
  const WORLD_H = 780;
  const ARENA = { x: 24, y: 24, w: 852, h: 732 };
  const CENTER = { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };
  const SPAWN = { x: 220, y: 190 };
  const RADIUS = 62;
  const FIXED_STEP = 1 / 240;
  const MAX_STEPS_PER_FRAME = 24;
  const METRICS_INTERVAL = 0.25;
  const CENTER_EPSILON = 70;
  const CONTOUR_CELL = 10;
  const CONTOUR_COLOR = "rgba(108, 224, 214, 0.26)";
  const CONTOUR_MAJOR = "rgba(140, 244, 226, 0.40)";

  const COLORS = {
    background: "#070b14",
    arena: "#101a2b",
    grid: "rgba(66, 110, 140, 0.22)",
    border: "#5cf0c0",
    ghost: "rgba(120, 220, 205, 0.30)",
    source: "#f5c451",
    sourceGlow: "rgba(245, 196, 81, 0.22)",
    text: "rgba(220, 238, 240, 0.88)",
    textMuted: "rgba(180, 208, 214, 0.58)",
    bodyEdge: [46, 174, 134],
    bodyCenter: [142, 240, 195],
    bodyOutline: "#083f35",
    bodyRim: "rgba(168, 255, 232, 0.95)",
    shadow: "rgba(0, 0, 0, 0.22)",
    tether: "#ffd166",
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
      key: "center_mu",
      label: "中心引力 μ",
      min: 0,
      max: 250,
      step: 1,
      decimals: 0,
      unit: "×10⁶",
      help: "指向画面中心引力源的强度。越大越快被吸向中心；近距离会自动软化，不会无限加速。",
    },
    {
      key: "body_size",
      label: "软体大小",
      min: 30,
      max: 120,
      step: 1,
      decimals: 0,
      unit: "px",
      help: "同时缩放所有软体；新增软体也使用这个大小。默认出生点需要足够空间。",
    },
    {
      key: "edge_stiffness",
      label: "边缘刚度",
      min: 0,
      max: 1,
      step: 0.01,
      decimals: 2,
      unit: "",
      help: "轮廓相邻质点的距离约束。越高越像有弹性的果冻；越低越容易拉伸、挤压和折叠，0 会失去边缘支撑。",
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
      max: 0.05,
      step: 0.001,
      decimals: 3,
      unit: "",
      help: "维持轮廓总面积。范围 0–0.05，步进 0.001；0 完全不约束，0.001 起就会持续恢复，因此适合在这里细调。",
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
  templateSim.setup(ARENA, CENTER, SPAWN, RADIUS);

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
  const debugCheckbox = document.getElementById("debug");
  const equipotentialCheckbox = document.getElementById("equipotential");
  const paramHelpEl = document.getElementById("param-help");
  const statusEl = document.getElementById("status");
  const metricsEl = document.getElementById("metrics");

  const bodies = [];
  const rowElements = {};
  let bodySize = RADIUS;
  let outlineSmoothing = 1.0;
  const values = snapshotParams(templateSim);
  const defaultValues = { ...values };

  let dpr = 1;
  let paused = false;
  let dragging = false;
  let activePointer = null;
  let activeBody = null;
  let pendingSpawns = 0;
  let grabMode = "edge";
  let debugDraw = false;
  let showEquipotential = true;
  let contourCache = null;
  let lastFrameTime = performance.now();
  let accumulator = 0;
  let metricsTimer = 0;

  function snapshotParams(sourceSim) {
    return {
      gravity: sourceSim.gravity,
      center_mu: sourceSim.centerMu / 1e6,
      body_size: bodySize,
      edge_stiffness: sourceSim.edgeStiffness,
      bending_stiffness: sourceSim.bendingStiffness,
      area_strength: sourceSim.areaStrength,
      shape_strength: sourceSim.shapeStrength,
      outline_smoothing: outlineSmoothing,
      damping: sourceSim.damping,
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
    body.centerMu = values.center_mu * 1e6;
    body.edgeStiffness = values.edge_stiffness;
    body.bendingStiffness = values.bending_stiffness;
    body.areaStrength = values.area_strength;
    body.shapeStrength = values.shape_strength;
    body.damping = values.damping;
    body.restitution = values.restitution;
    body.wallFriction = values.wall_friction;
  }

  function applyParameterToSim(key, displayValue) {
    if (key === "body_size") {
      bodySize = displayValue;
      for (const body of bodies) {
        body.setRadius(bodySize);
      }
      updateBodyCount();
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
        case "center_mu":
          body.centerMu = displayValue * 1e6;
          break;
        case "edge_stiffness":
          body.edgeStiffness = displayValue;
          break;
        case "bending_stiffness":
          body.bendingStiffness = displayValue;
          break;
        case "area_strength":
          body.areaStrength = displayValue;
          break;
        case "shape_strength":
          body.shapeStrength = displayValue;
          break;
        case "damping":
          body.damping = displayValue;
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

  function createBody() {
    const body = new SoftBodySim();
    body.setup(ARENA, CENTER, SPAWN, bodySize);
    applyParamsToBody(body);
    return body;
  }

  function bodyBoundingRadius(body) {
    let radius = 0;
    for (const point of body.positions) {
      radius = Math.max(radius, Math.hypot(point.x - body.centroid.x, point.y - body.centroid.y));
    }
    return radius;
  }

  function isSpawnFree() {
    for (const body of bodies) {
      const distanceToSpawn = Math.hypot(body.centroid.x - SPAWN.x, body.centroid.y - SPAWN.y);
      if (distanceToSpawn < bodySize + bodyBoundingRadius(body) + 6) {
        return false;
      }
    }
    return true;
  }

  function updateBodyCount() {
    if (bodyCountEl) {
      const base = `${bodies.length} 个软体`;
      bodyCountEl.textContent = pendingSpawns > 0 ? `${base} · 等待 ${pendingSpawns}` : base;
    }
    if (removeBodyButton) {
      removeBodyButton.disabled = bodies.length === 0;
    }
  }

  function addBodyNow() {
    bodies.push(createBody());
    updateBodyCount();
    updateMetrics();
    return true;
  }

  function requestAddBody() {
    if (isSpawnFree()) {
      addBodyNow();
    } else {
      pendingSpawns += 1;
      updateBodyCount();
    }
  }

  function removeOldestBody() {
    if (bodies.length === 0) {
      return;
    }
    const removed = bodies.shift();
    if (activeBody === removed) {
      endDrag();
    }
    processPendingSpawns();
    updateBodyCount();
    updateMetrics();
  }

  function processPendingSpawns() {
    if (pendingSpawns > 0 && isSpawnFree()) {
      pendingSpawns -= 1;
      bodies.push(createBody());
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
    statusEl.textContent = paused ? "已暂停 · 参数仍可实时调整" : "运行中 · 重力 + 中心引力";
    statusEl.classList.toggle("paused", paused);
    accumulator = 0;
  }

  function togglePause() {
    setPaused(!paused);
  }

  function setGrabMode(mode) {
    grabMode = mode === "center" ? "center" : "edge";
    endDrag();
    grabModeButton.textContent = grabMode === "center" ? "拖拽点：中心" : "拖拽点：边缘";
    grabModeButton.classList.toggle("active", grabMode === "center");
    grabModeButton.setAttribute("aria-pressed", String(grabMode === "center"));
  }

  function toggleGrabMode() {
    setGrabMode(grabMode === "edge" ? "center" : "edge");
  }

  function resetSimulation() {
    endDrag();
    bodies.length = 0;
    pendingSpawns = 0;
    bodies.push(createBody());
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
    metricsEl.textContent = `最大速度 ${Math.round(maxSpeed)} px/s\n最大面积误差 ${(maxAreaError * 100).toFixed(1)}%${contactText}`;
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
    if (paused || event.button !== 0) {
      return;
    }
    const point = toWorld(event);
    if (!pointInArena(point)) {
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
    if (!dragging || event.pointerId !== activePointer || !activeBody) {
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

    processPendingSpawns();
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
    drawGravitySource(time);
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

    ctx.save();
    ctx.strokeStyle = COLORS.ghost;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.arc(SPAWN.x, SPAWN.y, RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawText("初始位置", SPAWN.x - RADIUS, SPAWN.y + RADIUS + 22, 13, COLORS.ghost, "left");

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

  function drawGravitySource(time) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2);
    const glow = ctx.createRadialGradient(CENTER.x, CENTER.y, 0, CENTER.x, CENTER.y, 32 + pulse * 8);
    glow.addColorStop(0, "rgba(245, 196, 81, 0.28)");
    glow.addColorStop(1, "rgba(245, 196, 81, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, 32 + pulse * 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(245, 196, 81, 0.48)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, 13 + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = COLORS.source;
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff6d9";
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(245, 196, 81, 0.72)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(CENTER.x - 20, CENTER.y);
    ctx.lineTo(CENTER.x - 10, CENTER.y);
    ctx.moveTo(CENTER.x + 10, CENTER.y);
    ctx.lineTo(CENTER.x + 20, CENTER.y);
    ctx.moveTo(CENTER.x, CENTER.y - 20);
    ctx.lineTo(CENTER.x, CENTER.y - 10);
    ctx.moveTo(CENTER.x, CENTER.y + 10);
    ctx.lineTo(CENTER.x, CENTER.y + 20);
    ctx.stroke();

    drawText("引力中心", CENTER.x + 18, CENTER.y - 18, 14, COLORS.source, "left");
  }

  function fieldSignature() {
    return `${values.gravity.toFixed(4)}|${(values.center_mu * 1e6).toFixed(4)}|${CENTER_EPSILON.toFixed(4)}`;
  }

  function potentialAt(x, y) {
    const dx = CENTER.x - x;
    const dy = CENTER.y - y;
    const softened = dx * dx + dy * dy + CENTER_EPSILON * CENTER_EPSILON;
    let value = -values.gravity * y;
    const mu = values.center_mu * 1e6;
    if (mu > 0) {
      value -= mu / Math.sqrt(softened);
    }
    return value;
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
    if (values.gravity === 0 && values.center_mu === 0) {
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

    drawPolygon(outline.map((p) => ({ x: p.x + 7, y: p.y + 9 })), COLORS.shadow);

    const bands = 10;
    for (let band = 0; band < bands; band += 1) {
      const t = band / (bands - 1);
      const scale = 1 - 0.3 * t;
      const points = outline.map((p) => ({
        x: center.x + (p.x - center.x) * scale,
        y: center.y + (p.y - center.y) * scale,
      }));
      drawPolygon(points, colorLerp(COLORS.bodyEdge, COLORS.bodyCenter, t));
    }

    ctx.lineJoin = "round";
    drawStroke(outline, COLORS.bodyOutline, 6);
    drawStroke(outline, COLORS.bodyRim, 2.2);

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
    drawText("封闭实验区 · 240 Hz 固定步长", ARENA.x + 24, ARENA.y + ARENA.h - 18, 12, COLORS.textMuted, "left");
    drawText("拖动软体轮廓施加局部力", ARENA.x + ARENA.w - 24, ARENA.y + 30, 12, COLORS.textMuted, "right");
    if (showEquipotential && (values.gravity !== 0 || values.center_mu !== 0)) {
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
  debugCheckbox.addEventListener("change", () => {
    debugDraw = debugCheckbox.checked;
  });
  equipotentialCheckbox.addEventListener("change", () => {
    showEquipotential = equipotentialCheckbox.checked;
  });

  window.addEventListener("keydown", (event) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    } else if (event.key === "r" || event.key === "R") {
      resetSimulation();
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
    getBodies: () => bodies.map((body) => ({ radius: body.restRadius, particles: body.positions.length })),
    getPrimaryBody: () => bodies[0] || null,
    getPendingSpawns: () => pendingSpawns,
    addBody: requestAddBody,
    removeOldest: removeOldestBody,
    getGrabMode: () => grabMode,
    setGrabMode,
  };

  setGrabMode("edge");
  requestAnimationFrame(frame);
}());
