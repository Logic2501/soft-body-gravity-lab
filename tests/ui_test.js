"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const PAGE_URL = process.env.PAGE_URL || pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "softbody-chrome-"));

const failures = [];
const pageErrors = [];

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollJson(url, attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch (_error) {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  throw new Error(`Chrome debug endpoint did not become ready: ${url}`);
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    throw new Error(`Chrome not found: ${CHROME}. Set CHROME_BIN to run the UI test.`);
  }

  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    PAGE_URL,
  ], { stdio: "ignore" });

  let socket;
  try {
    const targets = await pollJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find((target) => target.type === "page");
    if (!page) {
      throw new Error("No page target found");
    }

    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result);
        }
      } else if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        pageErrors.push(details.exception?.description || details.text || "page exception");
      }
    });

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }

    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        const details = result.exceptionDetails.exception?.description
          || result.exceptionDetails.exception?.value
          || result.exceptionDetails.text
          || "evaluate failed";
        throw new Error(`${details}\nExpression: ${expression}`);
      }
      return result.result.value;
    }

    await send("Runtime.enable");
    await send("Log.enable");

    for (let i = 0; i < 40; i += 1) {
      const ready = await evaluate("typeof window.__softBodyDemo === 'object'");
      if (ready) {
        break;
      }
      await sleep(100);
    }

    const hookReady = await evaluate("typeof window.__softBodyDemo === 'object'");
    expect(hookReady, "ui: browser test hook should be available");

    const autoDefault = await evaluate("document.getElementById('auto-emit').checked");
    expect(autoDefault === false, "ui: auto faucet should be off by default");
    await evaluate("window.__softBodyDemo.setAutoEmit(false)");
    const waterConfig = await evaluate(`(() => ({
      emitters: window.__softBodyDemo.getEmitters(),
      stats: window.__softBodyDemo.getWaterStats(),
      auto: window.__softBodyDemo.isAutoEmit(),
      checkbox: document.getElementById('auto-emit').checked,
    }))()`);
    expect(waterConfig.emitters.length === 2, "ui: water scene should expose two faucet emitters");
    expect(waterConfig.stats.initialDrops === 6 && waterConfig.stats.maxBodies === 32, "ui: water scene should start with six drops and cap at 32");
    expect(waterConfig.auto === false && waterConfig.checkbox === false, "ui: auto emitter should be switchable");
    const autoToggle = await evaluate(`(() => {
      const checkbox = document.getElementById('auto-emit');
      checkbox.click();
      const on = window.__softBodyDemo.isAutoEmit();
      checkbox.click();
      return { on, off: window.__softBodyDemo.isAutoEmit() };
    })()`);
    expect(autoToggle.on === true && autoToggle.off === false, "ui: auto faucet checkbox should drive the emitter state");

    const keyEmit = await evaluate(`(() => {
      const demo = window.__softBodyDemo;
      demo.setAutoEmit(false);
      demo.reset();
      if (document.activeElement) {
        document.activeElement.blur();
      }
      const before = demo.getWaterStats().emitCount;
      const keys = ['a', 'd', 'ArrowLeft', 'ArrowRight'];
      for (const key of keys) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      }
      return { before, after: demo.getWaterStats().emitCount };
    })()`);
    console.log(`[water keys] emits ${keyEmit.before} -> ${keyEmit.after}`);
    expect(keyEmit.after - keyEmit.before === 4, "ui: A/D and arrow keys should emit from both faucets");

    const keyHold = await evaluate(`(async () => {
      const demo = window.__softBodyDemo;
      demo.setAutoEmit(false);
      demo.reset();
      if (document.activeElement) {
        document.activeElement.blur();
      }
      const before = demo.getWaterStats().emitCount;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 650));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
      return { before, after: demo.getWaterStats().emitCount };
    })()`);
    console.log(`[water key hold] emits ${keyHold.before} -> ${keyHold.after}`);
    expect(keyHold.after - keyHold.before >= 2, "ui: holding a faucet key should emit repeatedly");

    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(120);
    const mousePoint = await evaluate(`(() => {
      const canvas = document.getElementById('scene').getBoundingClientRect();
      const emitter = window.__softBodyDemo.getEmitters()[0];
      return {
        x: canvas.left + (emitter.x / 900) * canvas.width,
        y: canvas.top + ((emitter.y - 30) / 780) * canvas.height,
      };
    })()`);
    await evaluate("window.__softBodyDemo.setAutoEmit(false); window.__softBodyDemo.reset();");
    const beforeMouse = await evaluate("window.__softBodyDemo.getWaterStats().emitCount");
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: mousePoint.x, y: mousePoint.y, button: "left", clickCount: 1 });
    await sleep(500);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: mousePoint.x, y: mousePoint.y, button: "left", clickCount: 1 });
    const afterMouse = await evaluate("window.__softBodyDemo.getWaterStats().emitCount");
    console.log(`[water mouse hold] emits ${beforeMouse} -> ${afterMouse}`);
    expect(afterMouse - beforeMouse >= 2, "ui: holding a faucet with the mouse should emit repeatedly");

    const launch = await evaluate(`(async () => {
      const demo = window.__softBodyDemo;
      demo.setAutoEmit(false);
      demo.reset();
      demo.emitNow();
      const before = demo.getBodies().at(-1);
      const start = { x: before.x, y: before.y };
      await new Promise((resolve) => setTimeout(resolve, 350));
      const after = demo.getBodies().at(-1);
      return { start, after: { x: after.x, y: after.y } };
    })()`);
    console.log(`[water launch] y ${launch.start.y.toFixed(1)} -> ${launch.after.y.toFixed(1)}`);
    expect(launch.after.y < launch.start.y - 20, "ui: faucet launch should move diagonally upward");

    const erase = await evaluate(`(() => {
      const demo = window.__softBodyDemo;
      demo.setAutoEmit(false);
      demo.reset();
      const body = demo.getBodies()[0];
      demo.setEraseMode(true);
      const active = document.getElementById('erase-mode').classList.contains('active');
      const removed = demo.eraseAt({ x: body.x, y: body.y });
      const after = demo.getBodies().length;
      demo.setEraseMode(false);
      return { active, removed, after, mode: demo.getEraseMode() };
    })()`);
    console.log(`[water erase] removed=${erase.removed} remaining=${erase.after}`);
    expect(erase.active === true && erase.removed === 1 && erase.after === 5, "ui: erase mode should delete the clicked droplet");
    expect(erase.mode === false, "ui: erase mode should toggle off");

    const defaults = await evaluate("window.__softBodyDemo.getDefaults()");
    const paramKeys = Object.keys(defaults);
    expect(paramKeys.length > 0, "ui: defaults should expose parameter keys");
    expect(!("center_mu" in defaults), "ui: water scene should not expose center gravity");
    expect(defaults.body_size === 15 && defaults.edge_particles === 8, "ui: water defaults should use small eight-particle drops");
    expect(Math.abs(defaults.area_strength - 2) < 1e-9, "ui: area strength should display 2 ×10⁻³");

    const rowCount = await evaluate("document.querySelectorAll('#params .param').length");
    expect(rowCount === paramKeys.length, "ui: one parameter row per default key");
    const helpDots = await evaluate("document.querySelectorAll('#params .param-help-dot').length");
    expect(helpDots === paramKeys.length, "ui: every parameter should have a help marker");
    const initialHelp = await evaluate("document.getElementById('param-help').textContent");
    expect(initialHelp.includes("重力强度"), "ui: initial help should explain gravity");

    const bendingHelp = await evaluate(`(() => {
      const row = document.querySelector('[data-key="bending_stiffness"]');
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return document.getElementById('param-help').textContent;
    })()`);
    expect(bendingHelp.includes("折角"), "ui: parameter help should update when a row is selected");

    const initialParams = await evaluate("window.__softBodyDemo.getParams()");
    for (const key of paramKeys) {
      expect(Math.abs(initialParams[key] - defaults[key]) < 1e-9, `ui: initial ${key} should match defaults`);
    }

    const fineRanges = await evaluate(`(() => {
      const area = document.getElementById('area_strength-range');
      const shape = document.getElementById('shape_strength-range');
      const edge = document.getElementById('edge_stiffness-range');
      return {
        areaMax: Number(area.max),
        areaStep: Number(area.step),
        shapeMax: Number(shape.max),
        shapeStep: Number(shape.step),
        edgeMax: Number(edge.max),
        edgeStep: Number(edge.step),
        areaText: document.querySelector('[data-key="area_strength"] .param-number').value,
        shapeText: document.querySelector('[data-key="shape_strength"] .param-number').value,
        edgeText: document.querySelector('[data-key="edge_stiffness"] .param-number').value,
      };
    })()`);
    expect(Math.abs(fineRanges.areaMax - 10) < 1e-9, "ui: area strength should use the 0–10 ×10⁻³ range");
    expect(Math.abs(fineRanges.shapeMax - 0.01) < 1e-9, "ui: shape strength should use the 0–0.01 fine range");
    expect(Math.abs(fineRanges.edgeMax - 0.03) < 1e-9, "ui: edge stiffness should use the 0–0.03 fine range");
    expect(Math.abs(fineRanges.areaStep - 0.1) < 1e-9, "ui: area strength should step by 0.1 ×10⁻³");
    expect(Math.abs(fineRanges.shapeStep - 0.001) < 1e-9, "ui: shape strength should step by 0.001");
    expect(Math.abs(fineRanges.edgeStep - 0.001) < 1e-9, "ui: edge stiffness should step by 0.001");
    expect(Math.abs(Number(fineRanges.areaText) - defaults.area_strength) < 1e-9 && /^\d+\.\d$/.test(fineRanges.areaText), "ui: area strength should display one decimal");
    expect(Math.abs(Number(fineRanges.shapeText) - defaults.shape_strength) < 1e-9 && /^\d+\.\d{3}$/.test(fineRanges.shapeText), "ui: shape strength should display three decimals");
    expect(Math.abs(Number(fineRanges.edgeText) - defaults.edge_stiffness) < 1e-9 && /^\d+\.\d{3}$/.test(fineRanges.edgeText), "ui: edge stiffness should display three decimals");

    const canvasSize = await evaluate("(() => { const c = document.getElementById('scene'); return { w: c.width, h: c.height }; })()");
    expect(canvasSize.w > 0 && canvasSize.h > 0, "ui: canvas should have a non-zero backing size");

    const sliderResult = await evaluate(`(() => {
      const range = document.getElementById('gravity-range');
      range.value = '1200';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        param: window.__softBodyDemo.getParams().gravity,
        number: document.querySelector('[data-key="gravity"] .param-number').value,
      };
    })()`);
    expect(Math.abs(sliderResult.param - 1200) < 1e-6, "ui: slider should update the simulation parameter");
    expect(sliderResult.number === "1200", "ui: slider should update the numeric field");

    const invalidResult = await evaluate(`(() => {
      const number = document.querySelector('[data-key="gravity"] .param-number');
      number.value = 'nan';
      number.dispatchEvent(new Event('change', { bubbles: true }));
      return { text: number.value, param: window.__softBodyDemo.getParams().gravity };
    })()`);
    expect(invalidResult.text === "1200", "ui: invalid numeric input should revert");
    expect(Math.abs(invalidResult.param - 1200) < 1e-6, "ui: invalid numeric input must not reach physics");

    const clampedResult = await evaluate(`(() => {
      const number = document.querySelector('[data-key="gravity"] .param-number');
      number.value = '99999';
      number.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        text: number.value,
        param: window.__softBodyDemo.getParams().gravity,
        range: document.getElementById('gravity-range').value,
      };
    })()`);
    expect(clampedResult.text === "2500", "ui: out-of-range input should clamp");
    expect(Math.abs(clampedResult.param - 2500) < 1e-6, "ui: clamped value should reach physics");
    expect(clampedResult.range === "2500", "ui: clamped value should update the slider");

    const validResult = await evaluate(`(() => {
      const number = document.querySelector('[data-key="gravity"] .param-number');
      number.value = '1500';
      number.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        param: window.__softBodyDemo.getParams().gravity,
        range: document.getElementById('gravity-range').value,
      };
    })()`);
    expect(Math.abs(validResult.param - 1500) < 1e-6, "ui: valid numeric input should update physics");
    expect(validResult.range === "1500", "ui: valid numeric input should update the slider");

    const pauseResult = await evaluate(`(() => {
      document.getElementById('pause').click();
      return {
        paused: window.__softBodyDemo.paused,
        text: document.getElementById('pause').textContent,
      };
    })()`);
    expect(pauseResult.paused === true, "ui: pause button should pause the simulation");
    expect(pauseResult.text === "继续", "ui: pause button should switch to continue");
    await evaluate("document.getElementById('pause').click()");
    expect((await evaluate("window.__softBodyDemo.paused")) === false, "ui: continue button should resume");

    await evaluate("window.__softBodyDemo.reset(); window.__softBodyDemo.emitNow();");
    const beforeMotion = await evaluate("(() => { const body = window.__softBodyDemo.getBodies().at(-1); return { x: body.x, y: body.y }; })()");
    await sleep(500);
    const afterMotion = await evaluate("(() => { const body = window.__softBodyDemo.getBodies().at(-1); return { x: body.x, y: body.y }; })()");
    const moved = Math.hypot(afterMotion.x - beforeMotion.x, afterMotion.y - beforeMotion.y);
    expect(moved > 1, "ui: animation loop should advance the simulation");

    const resetResult = await evaluate(`(() => {
      const demo = window.__softBodyDemo;
      const before = demo.getPrimaryBody();
      before.positions[0].x += 15;
      before.velocities[0].x = 99;
      document.getElementById('reset').click();
      const body = demo.getPrimaryBody();
      return {
        x: body.positions[0].x,
        initialX: body.initialPositions[0].x,
        speed: body.velocities[0].x,
      };
    })()`);
    expect(Math.abs(resetResult.x - resetResult.initialX) < 1e-9, "ui: reset should restore initial positions");
    expect(Math.abs(resetResult.speed) < 1e-9, "ui: reset should clear velocities");

    const defaultResult = await evaluate(`(() => {
      document.getElementById('defaults').click();
      return {
        param: window.__softBodyDemo.getParams().gravity,
        number: document.querySelector('[data-key="gravity"] .param-number').value,
      };
    })()`);
    expect(Math.abs(defaultResult.param - defaults.gravity) < 1e-6, "ui: restore defaults should restore gravity");
    expect(Math.abs(Number(defaultResult.number) - defaults.gravity) < 1e-6, "ui: restore defaults should refresh the field");

    const debugResult = await evaluate(`(() => {
      const checkbox = document.getElementById('debug');
      checkbox.click();
      return checkbox.checked;
    })()`);
    expect(debugResult === true, "ui: debug checkbox should toggle");

    await evaluate("window.__softBodyDemo.setParam('gravity', 250);");
    const equipotentialDefault = await evaluate("document.getElementById('equipotential').checked");
    expect(equipotentialDefault === false, "ui: equipotential lines should be disabled by default");
    const contourStats = await evaluate(`(() => {
      const contours = window.__softBodyDemo.getContours();
      return {
        levels: contours.levels.length,
        segments: contours.levels.reduce((sum, level) => sum + level.segments.length, 0),
      };
    })()`);
    console.log(`[contours] levels=${contourStats.levels} segments=${contourStats.segments}`);
    expect(contourStats.levels > 0, "ui: equipotential levels should be generated");
    expect(contourStats.segments > 0, "ui: equipotential segments should be generated");
    const contourSpan = await evaluate(`(() => {
      const contours = window.__softBodyDemo.getContours();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const level of contours.levels) {
        for (const segment of level.segments) {
          minX = Math.min(minX, segment[0], segment[2]);
          maxX = Math.max(maxX, segment[0], segment[2]);
          minY = Math.min(minY, segment[1], segment[3]);
          maxY = Math.max(maxY, segment[1], segment[3]);
        }
      }
      return { minX, maxX, minY, maxY };
    })()`);
    console.log(`[contours span] x=${contourSpan.minX.toFixed(0)}..${contourSpan.maxX.toFixed(0)} y=${contourSpan.minY.toFixed(0)}..${contourSpan.maxY.toFixed(0)}`);
    expect(contourSpan.minY < 300, "ui: equipotential lines should reach the upper half");
    expect(contourSpan.maxY > 480, "ui: equipotential lines should reach the lower half");
    const levelInfo = await evaluate(`(() => {
      const contours = window.__softBodyDemo.getContours();
      const values = contours.levels.map((level) => level.value).sort((a, b) => a - b);
      let minGap = Infinity;
      for (let i = 1; i < values.length; i += 1) {
        minGap = Math.min(minGap, values[i] - values[i - 1]);
      }
      return {
        values,
        minGap,
        range: values[values.length - 1] - values[0],
      };
    })()`);
    console.log(`[contours levels] ${levelInfo.values.map((v) => v.toFixed(0)).join(", ")} minGap=${((levelInfo.minGap / levelInfo.range) * 100).toFixed(1)}%`);
    const equipotentialToggle = await evaluate(`(() => {
      const checkbox = document.getElementById('equipotential');
      checkbox.click();
      const on = checkbox.checked;
      checkbox.click();
      return { on, off: checkbox.checked };
    })()`);
    expect(equipotentialToggle.on === true && equipotentialToggle.off === false, "ui: equipotential checkbox should toggle");

    const bodyLifecycle = await evaluate(`(() => {
      const demo = window.__softBodyDemo;
      if (!demo.paused) {
        document.getElementById('pause').click();
      }
      document.getElementById('reset').click();
      const initial = {
        bodies: demo.getBodies().length,
        count: document.getElementById('body-count').textContent,
      };
      document.getElementById('add-body').click();
      const afterAdd = {
        bodies: demo.getBodies().length,
        count: document.getElementById('body-count').textContent,
      };
      document.getElementById('remove-body').click();
      const afterRemove = {
        bodies: demo.getBodies().length,
        count: document.getElementById('body-count').textContent,
        hue: demo.getBodies()[0] ? demo.getBodies()[0].hue : null,
      };
      const sizeBefore = demo.getBodies().map((body) => body.radius);
      const sizeNumber = document.querySelector('[data-key="body_size"] .param-number');
      sizeNumber.value = '40';
      sizeNumber.dispatchEvent(new Event('change', { bubbles: true }));
      const sizeAfter = demo.getBodies().map((body) => body.radius);
      demo.emitNow();
      const newRadius = demo.getBodies().at(-1).radius;
      const edgeNumber = document.querySelector('[data-key="edge_particles"] .param-number');
      edgeNumber.value = '24';
      edgeNumber.dispatchEvent(new Event('change', { bubbles: true }));
      const dampingNumber = document.querySelector('[data-key="center_grab_damping"] .param-number');
      dampingNumber.value = '10';
      dampingNumber.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        initial,
        afterAdd,
        afterRemove,
        sizeBefore,
        sizeAfter,
        newRadius,
        hues: demo.getBodies().map((body) => body.hue),
        radii: demo.getBodies().map((body) => body.radius),
        particles: demo.getBodies().map((body) => body.particles),
        centerDamping: demo.getBodies().map((body) => body.centerGrabDamping),
      };
    })()`);
    expect(bodyLifecycle.initial.bodies === 6, "ui: reset should leave six water drops");
    expect(bodyLifecycle.initial.count.includes("6 / 32"), "ui: reset count should show the drop cap");
    expect(bodyLifecycle.afterAdd.bodies === 7, "ui: faucet button should emit one drop");
    expect(bodyLifecycle.afterRemove.bodies === 6, "ui: removing the oldest drop should keep the pool size");
    expect(Math.abs(bodyLifecycle.afterRemove.hue - 198) < 1e-9, "ui: water drops should use the fixed light-blue hue");
    expect(bodyLifecycle.hues.length > 0 && bodyLifecycle.hues.every((hue) => Math.abs(hue - 198) < 1e-9), "ui: all water drops should share one hue");
    expect(bodyLifecycle.sizeBefore.every((radius) => Math.abs(radius - 15) < 1e-6), "ui: existing drops should start at the original size");
    expect(bodyLifecycle.sizeAfter.every((radius) => Math.abs(radius - 15) < 1e-6), "ui: body size should not rescale existing drops");
    expect(Math.abs(bodyLifecycle.newRadius - 40) < 1e-6, "ui: body size should apply to newly emitted drops");
    expect(bodyLifecycle.radii.filter((radius) => Math.abs(radius - 40) < 1e-6).length === 1, "ui: only the new drop should use the new size");
    expect(bodyLifecycle.particles.length > 0 && bodyLifecycle.particles.every((count) => count === 24), "ui: edge particle count should rebuild every drop");
    expect(bodyLifecycle.centerDamping.length > 0 && bodyLifecycle.centerDamping.every((value) => Math.abs(value - 10) < 1e-9), "ui: center drag damping should apply to every drop");

    const grabMode = await evaluate(`(() => {
      const demo = window.__softBodyDemo;
      const button = document.getElementById('grab-mode');
      const initial = { text: button.textContent, mode: demo.getGrabMode() };
      button.click();
      const center = { text: button.textContent, mode: demo.getGrabMode() };
      button.click();
      const edge = { text: button.textContent, mode: demo.getGrabMode() };
      return { initial, center, edge };
    })()`);
    expect(grabMode.initial.mode === "edge" && grabMode.initial.text.includes("边缘"), "ui: drag mode should start at edge");
    expect(grabMode.center.mode === "center" && grabMode.center.text.includes("中心"), "ui: drag mode should switch to center");
    expect(grabMode.edge.mode === "edge" && grabMode.edge.text.includes("边缘"), "ui: drag mode should switch back to edge");

    const flow = await evaluate(`(async () => {
      const demo = window.__softBodyDemo;
      demo.restoreDefaults();
      demo.reset();
      demo.setAutoEmit(true);
      if (demo.paused) {
        document.getElementById('pause').click();
      }
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const stats = demo.getWaterStats();
      demo.setAutoEmit(false);
      return stats;
    })()`);
    console.log(`[water flow] bodies=${flow.bodies} merges=${flow.mergeCount} splits=${flow.splitCount}`);
    expect(flow.mergeCount > 0, "ui: nearby faucet drops should merge automatically");
    expect(flow.bodies >= 1, "ui: water flow should keep a visible pool");

    const split = await evaluate(`(async () => {
      const demo = window.__softBodyDemo;
      demo.restoreDefaults();
      demo.reset();
      demo.setAutoEmit(false);
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const body = demo.getLargestBody();
      const before = { count: demo.getBodies().length, radius: body ? body.restRadius : 0, splits: demo.getWaterStats().splitCount };
      if (!body) {
        return { before, after: null };
      }
      body.waterAge = 2;
      body.mergeCooldown = 0;
      for (const point of body.positions) {
        point.x = body.centroid.x + (point.x - body.centroid.x) * 3;
        point.y = body.centroid.y + (point.y - body.centroid.y) * 0.3;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { before, after: demo.getWaterStats() };
    })()`);
    console.log(`[water split] largest_radius=${split.before.radius.toFixed(1)} bodies=${split.before.count}->${split.after ? split.after.bodies : "?"} splits=${split.after ? split.after.splitCount : "?"}`);
    expect(split.after && split.after.splitCount > split.before.splits, "ui: critical deformation should split the largest drop");
    expect(split.after && split.after.bodies > split.before.count, "ui: critical split should add a drop");

    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(150);
    const desktopLayout = await evaluate(`(() => {
      const canvas = document.getElementById('scene').getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      };
    })()`);
    expect(desktopLayout.scrollWidth <= desktopLayout.viewport + 1, "ui: desktop layout must not overflow horizontally");
    expect(desktopLayout.canvasWidth > 0 && desktopLayout.canvasHeight > 0, "ui: desktop canvas should have layout size");

    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(150);
    const mobileLayout = await evaluate(`(() => {
      const canvas = document.getElementById('scene').getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        panelTop: document.querySelector('.panel').getBoundingClientRect().top,
        stageBottom: document.querySelector('.stage').getBoundingClientRect().bottom,
      };
    })()`);
    expect(mobileLayout.scrollWidth <= mobileLayout.viewport + 1, "ui: mobile layout must not overflow horizontally");
    expect(mobileLayout.canvasWidth > 0 && mobileLayout.canvasHeight > 0, "ui: mobile canvas should have layout size");
    expect(mobileLayout.panelTop >= mobileLayout.stageBottom - 1, "ui: mobile panel should stack below the stage");
    await send("Emulation.clearDeviceMetricsOverride");

    expect(pageErrors.length === 0, `ui: page exceptions: ${pageErrors.join(" | ")}`);

    if (failures.length === 0) {
      console.log("RESULT: PASS — browser UI checks passed");
    } else {
      for (const failure of failures) {
        console.log(`FAIL: ${failure}`);
      }
      console.log(`RESULT: FAIL — ${failures.length} check(s) failed`);
      process.exitCode = 1;
    }
  } finally {
    if (socket) {
      socket.close();
    }
    chrome.kill("SIGTERM");
    await sleep(200);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`RESULT: FAIL — ${error.message}`);
  process.exitCode = 1;
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (_error) {
    // Ignore cleanup errors.
  }
});
