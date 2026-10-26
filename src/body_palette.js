(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.createBodyPalette = factory().createBodyPalette;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BASE_HUE = 156;
  const HUE_STEP = 18;

  function createBodyPalette(index) {
    const hue = (BASE_HUE + index * HUE_STEP) % 360;
    return {
      hue,
      edge: hslToRgb(hue, 0.58, 0.43),
      center: hslToRgb(hue, 0.72, 0.75),
      outline: `hsl(${hue.toFixed(1)}, 78%, 18%)`,
      rim: `hsla(${hue.toFixed(1)}, 90%, 82%, 0.95)`,
    };
  }

  function hslToRgb(hue, saturation, lightness) {
    const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const hPrime = hue / 60;
    const x = c * (1 - Math.abs((hPrime % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hPrime < 1) {
      r = c;
      g = x;
    } else if (hPrime < 2) {
      r = x;
      g = c;
    } else if (hPrime < 3) {
      g = c;
      b = x;
    } else if (hPrime < 4) {
      g = x;
      b = c;
    } else if (hPrime < 5) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    const m = lightness - c / 2;
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }

  return { createBodyPalette, BASE_HUE, HUE_STEP };
}));
