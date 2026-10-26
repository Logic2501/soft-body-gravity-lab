"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const PAGE_URL = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
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

    const defaults = await evaluate("window.__softBodyDemo.getDefaults()");
    const paramKeys = Object.keys(defaults);
    expect(paramKeys.length > 0, "ui: defaults should expose parameter keys");

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
      return {
        areaMax: Number(area.max),
        areaStep: Number(area.step),
        shapeMax: Number(shape.max),
        shapeStep: Number(shape.step),
        areaText: document.querySelector('[data-key="area_strength"] .param-number').value,
        shapeText: document.querySelector('[data-key="shape_strength"] .param-number').value,
      };
    })()`);
    expect(Math.abs(fineRanges.areaMax - 0.05) < 1e-9, "ui: area strength should use the 0–0.05 fine range");
    expect(Math.abs(fineRanges.shapeMax - 0.01) < 1e-9, "ui: shape strength should use the 0–0.01 fine range");
    expect(Math.abs(fineRanges.areaStep - 0.001) < 1e-9, "ui: area strength should step by 0.001");
    expect(Math.abs(fineRanges.shapeStep - 0.001) < 1e-9, "ui: shape strength should step by 0.001");
    expect(Math.abs(Number(fineRanges.areaText) - defaults.area_strength) < 1e-9 && /^\d+\.\d{3}$/.test(fineRanges.areaText), "ui: area strength should display three decimals");
    expect(Math.abs(Number(fineRanges.shapeText) - defaults.shape_strength) < 1e-9 && /^\d+\.\d{3}$/.test(fineRanges.shapeText), "ui: shape strength should display three decimals");

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

    const beforeMotion = await evaluate("({ x: window.__softBodyDemo.getPrimaryBody().centroid.x, y: window.__softBodyDemo.getPrimaryBody().centroid.y })");
    await sleep(500);
    const afterMotion = await evaluate("({ x: window.__softBodyDemo.getPrimaryBody().centroid.x, y: window.__softBodyDemo.getPrimaryBody().centroid.y })");
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

    await evaluate("window.__softBodyDemo.setParam('gravity', 250); window.__softBodyDemo.setParam('center_mu', 7);");
    const equipotentialDefault = await evaluate("document.getElementById('equipotential').checked");
    expect(equipotentialDefault === true, "ui: equipotential lines should be enabled by default");
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
      const off = checkbox.checked;
      checkbox.click();
      return { off, on: checkbox.checked };
    })()`);
    expect(equipotentialToggle.off === false && equipotentialToggle.on === true, "ui: equipotential checkbox should toggle");

    const bodyLifecycle = await evaluate(`(() => {
      const demo = window.__softBodyDemo;
      if (!demo.paused) {
        document.getElementById('pause').click();
      }
      document.getElementById('reset').click();
      const initial = {
        bodies: demo.getBodies().length,
        pending: demo.getPendingSpawns(),
        count: document.getElementById('body-count').textContent,
      };
      document.getElementById('add-body').click();
      const queued = {
        bodies: demo.getBodies().length,
        pending: demo.getPendingSpawns(),
        count: document.getElementById('body-count').textContent,
      };
      document.getElementById('remove-body').click();
      const afterRemove = {
        bodies: demo.getBodies().length,
        pending: demo.getPendingSpawns(),
        count: document.getElementById('body-count').textContent,
      };
      const sizeNumber = document.querySelector('[data-key="body_size"] .param-number');
      sizeNumber.value = '90';
      sizeNumber.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        initial,
        queued,
        afterRemove,
        radii: demo.getBodies().map((body) => body.radius),
      };
    })()`);
    expect(bodyLifecycle.initial.bodies === 1, "ui: reset should leave one body");
    expect(bodyLifecycle.queued.bodies === 1 && bodyLifecycle.queued.pending === 1, "ui: occupied spawn should queue a body");
    expect(bodyLifecycle.queued.count.includes("等待 1"), "ui: queued spawn should be visible in the body count");
    expect(bodyLifecycle.afterRemove.bodies === 1 && bodyLifecycle.afterRemove.pending === 0, "ui: removing the oldest body should let the queued body spawn");
    expect(bodyLifecycle.radii.length > 0 && bodyLifecycle.radii.every((radius) => Math.abs(radius - 90) < 1e-6), "ui: body size slider should scale every body");

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
