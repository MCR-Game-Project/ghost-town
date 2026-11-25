import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Procedural sculpted geometry builders for period pedestrians (no photo textures).
// Every geometry preserves smooth vertex normals across curved surfaces and carries
// a vertex `color` attribute so `instanceColor` tints cleanly with folds and AO.

export function ensureVertexColors(geo, r = 1, g = 1, b = 1) {
  const pos = geo.getAttribute("position");
  const count = pos.count;
  if (!geo.getAttribute("color")) {
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  return geo;
}

// Compute smooth normals on each indexed part BEFORE converting to non-indexed,
// so merging heterogeneous parts never degrades smooth shading into flat facets.
function mergeParts(parts) {
  const prepped = parts.map((g) => {
    const src = g.clone();
    if (!src.getAttribute("normal")) src.computeVertexNormals();
    const nonIdx = src.index ? src.toNonIndexed() : src;
    nonIdx.deleteAttribute("uv");
    return ensureVertexColors(nonIdx);
  });
  return mergeGeometries(prepped, false);
}

const segs = (lod, hi, lo) => (lod === "lo" ? lo : hi);

const smoothstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Smooth elliptical loft with optional pleats, front flattening, bustle curve, and
// seam-free 360-degree vertex normals (plus optional crisp flat end-caps).
// theta = 0 faces +Z (front), theta = PI/2 faces +X, theta = PI faces -Z (back).
export function buildLoft(rings, radialSegs = 24, options = {}) {
  const {
    thetaStart = 0,
    thetaLen = Math.PI * 2,
    capBottom = false,
    capTop = false,
  } = options;
  const openArc = Math.abs(thetaLen - Math.PI * 2) > 1e-4;
  const cols = openArc ? radialSegs + 1 : radialSegs;
  const positions = [];
  const colors = [];
  const indices = [];

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const {
      y,
      rx,
      rz,
      ox = 0,
      oz = 0,
      pleatAmp = 0,
      pleatFreq = 8,
      pleatPhase = 0,
      shade = 1.0,
      backBustle = 0,
      frontPinch = 0,
    } = ring;

    for (let c = 0; c < cols; c++) {
      const u = c / radialSegs;
      const theta = thetaStart + u * thetaLen;
      const s = Math.sin(theta);
      const cs = Math.cos(theta);
      const pleatWave = Math.cos(pleatFreq * theta + pleatPhase);
      const pleat = 1 + pleatAmp * pleatWave;

      let x = ox + rx * s * pleat;
      let z = oz + rz * cs * pleat;

      if (backBustle > 0 && cs < 0) {
        z -= backBustle * Math.pow(-cs, 1.55);
      }
      if (frontPinch > 0 && cs > 0) {
        z -= frontPinch * Math.pow(cs, 2.0);
      }

      positions.push(x, y, z);

      const foldShade = pleatAmp !== 0 ? 1 - Math.min(0.16, Math.abs(pleatAmp) * 2.1) * (0.5 - 0.5 * pleatWave) : 1.0;
      const vShade = Math.max(0.55, Math.min(1.06, shade * foldShade));
      colors.push(vShade, vShade, vShade);
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    for (let c = 0; c < radialSegs; c++) {
      const cNext = openArc ? c + 1 : (c + 1) % radialSegs;
      const a = r * cols + c;
      const b = r * cols + cNext;
      const d = (r + 1) * cols + c;
      const e = (r + 1) * cols + cNext;
      indices.push(a, b, d);
      indices.push(b, e, d);
    }
  }

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  wallGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  wallGeo.setIndex(indices);
  wallGeo.computeVertexNormals();

  if ((!capBottom && !capTop) || openArc) {
    return wallGeo;
  }

  // Keep caps as separate indexed pieces so flat cap normals never crease the smooth side loft
  const parts = [wallGeo];
  const makeCap = (ringIdx, isTop) => {
    const ring = rings[ringIdx];
    const ox = ring.ox || 0;
    const oz = ring.oz || 0;
    const cPos = [ox, ring.y, oz];
    const cs = Math.max(0.55, (ring.shade ?? 1.0) * (isTop ? 1.0 : 0.85));
    const cCol = [cs, cs, cs];
    const cIdx = [];
    for (let c = 0; c < radialSegs; c++) {
      const src = (ringIdx * cols + c) * 3;
      cPos.push(positions[src], positions[src + 1], positions[src + 2]);
      cCol.push(colors[src], colors[src + 1], colors[src + 2]);
    }
    for (let c = 0; c < radialSegs; c++) {
      const n = (c + 1) % radialSegs;
      if (isTop) cIdx.push(0, 1 + c, 1 + n);
      else cIdx.push(0, 1 + n, 1 + c);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.Float32BufferAttribute(cPos, 3));
    cg.setAttribute("color", new THREE.Float32BufferAttribute(cCol, 3));
    cg.setIndex(cIdx);
    cg.computeVertexNormals();
    return cg;
  };

  if (capBottom) parts.push(makeCap(0, false));
  if (capTop) parts.push(makeCap(rings.length - 1, true));
  return parts.length === 1 ? wallGeo : mergeParts(parts);
}

// Sculpted head centered on headPivot (base of skull at y = 0, crown at y = 0.76).
// Includes brow ridge, recessed eye sockets, defined nose bridge/tip + under-nose shadow,
// cheekbone fullness, jaw/chin taper, lip contour, ears, and soft facial AO.
export function makeHeadGeo(lod = "hi") {
  const geo = new THREE.SphereGeometry(1, segs(lod, 26, 8), segs(lod, 20, 6));
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    let x = vx * 0.295;
    let y = vy * 0.385;
    let z = vz * 0.335;
    let shade = 1.0;
    let blush = 0.0;

    if (vy < 0) {
      const t = -vy;
      x *= 1 - 0.30 * Math.pow(t, 1.35);
      if (vz > 0) {
        const chin = Math.exp(-(vx * vx * 6.0 + Math.pow((vy + 0.68) * 3.0, 2)));
        z += 0.048 * chin;
      }
      if (vy < -0.50) shade *= 0.82;
    }

    // Cheekbones & warm mid-face blush
    if (vz > 0.12) {
      const cheek = Math.exp(-(Math.pow((Math.abs(vx) - 0.50) * 3.1, 2) + Math.pow((vy + 0.04) * 3.6, 2)));
      z += 0.022 * cheek;
      blush = cheek;
    }

    // Recessed eye sockets with clear orbital AO
    if (vz > 0.32) {
      const sock = Math.exp(-(Math.pow((Math.abs(vx) - 0.34) * 4.6, 2) + Math.pow((vy - 0.06) * 5.8, 2)));
      z -= 0.034 * sock;
      shade *= 1 - 0.22 * sock;
    }

    // Brow ridge catchlight
    if (vz > 0.38) {
      const brow = Math.exp(-(Math.pow(vx * 1.85, 2) + Math.pow((vy - 0.22) * 6.0, 2)));
      z += 0.026 * brow;
      shade *= 1 + 0.03 * brow;
    }

    // Defined nose bridge, tip, and under-nose philtrum shadow
    if (vz > 0.42 && Math.abs(vx) < 0.30) {
      const noseX = Math.exp(-Math.pow(vx / 0.12, 2));
      const noseY = Math.exp(-Math.pow((vy + 0.04) / 0.17, 2));
      const tip = Math.exp(-Math.pow((vy + 0.12) / 0.085, 2));
      const nose = noseX * (0.76 * noseY + 0.52 * tip);
      z += 0.104 * nose;
      const underNose = noseX * Math.exp(-Math.pow((vy + 0.23) / 0.065, 2));
      shade *= 1 - 0.22 * underNose;
    }

    // Mouth crease + lower-lip shadow
    if (vz > 0.42 && Math.abs(vx) < 0.34) {
      const mouthLine = Math.exp(-(Math.pow(vx * 4.2, 2) + Math.pow((vy + 0.36) * 12.0, 2)));
      z -= 0.016 * mouthLine;
      shade *= 1 - 0.14 * mouthLine;
      const underLip = Math.exp(-(Math.pow(vx * 5.0, 2) + Math.pow((vy + 0.48) * 10.0, 2)));
      shade *= 1 - 0.12 * underLip;
    }

    // Ears
    if (Math.abs(vx) > 0.78 && vy > -0.25 && vy < 0.22 && vz > -0.28 && vz < 0.16) {
      const ear = Math.exp(-(Math.pow((vy + 0.02) * 4.8, 2) + Math.pow((vz + 0.06) * 5.8, 2)));
      x += Math.sign(vx) * 0.038 * ear;
      shade *= 1 - 0.10 * ear;
      blush = Math.max(blush, ear * 0.65);
    }

    pos.setXYZ(i, x, y + 0.38, z);
    colors[i * 3] = Math.min(1.04, shade * (1 + 0.045 * blush));
    colors[i * 3 + 1] = shade * (1 - 0.025 * blush);
    colors[i * 3 + 2] = shade * (1 - 0.040 * blush);
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function makeEyeWhitesGeo(lod = "hi") {
  const mk = (sx) => {
    const g = new THREE.SphereGeometry(1, segs(lod, 10, 6), segs(lod, 8, 5));
    g.scale(0.056, 0.032, 0.024);
    g.rotateY(sx * 0.16);
    g.translate(sx * 0.100, 0.402, 0.283);
    return ensureVertexColors(g, 0.96, 0.95, 0.92);
  };
  return mergeParts([mk(-1), mk(1)]);
}

export function makeIrisesGeo(lod = "hi") {
  const mk = (sx) => {
    const iris = new THREE.SphereGeometry(1, segs(lod, 10, 6), segs(lod, 8, 5));
    iris.scale(0.033, 0.033, 0.022);
    iris.translate(sx * 0.100, 0.402, 0.299);
    ensureVertexColors(iris, 0.88, 0.88, 0.88);
    const pupil = new THREE.SphereGeometry(1, segs(lod, 8, 6), segs(lod, 6, 5));
    pupil.scale(0.017, 0.017, 0.016);
    pupil.translate(sx * 0.100, 0.402, 0.312);
    ensureVertexColors(pupil, 0.18, 0.18, 0.18);
    return mergeParts([iris, pupil]);
  };
  return mergeParts([mk(-1), mk(1)]);
}

export function makeBrowsGeo(lod = "hi") {
  const mk = (sx) => {
    const g = new THREE.CapsuleGeometry(0.017, 0.082, segs(lod, 4, 2), segs(lod, 8, 5));
    g.rotateZ(Math.PI / 2 - sx * 0.12);
    g.scale(1.0, 0.82, 0.78);
    g.translate(sx * 0.102, 0.460, 0.309);
    return ensureVertexColors(g, 0.78, 0.78, 0.78);
  };
  return mergeParts([mk(-1), mk(1)]);
}

export function makeMouthGeo(lod = "hi") {
  const upper = new THREE.SphereGeometry(1, segs(lod, 12, 6), segs(lod, 8, 5));
  upper.scale(0.068, 0.017, 0.026);
  upper.translate(0, 0.246, 0.308);
  ensureVertexColors(upper, 0.86, 0.84, 0.84);
  const lower = new THREE.SphereGeometry(1, segs(lod, 12, 6), segs(lod, 8, 5));
  lower.scale(0.058, 0.016, 0.025);
  lower.translate(0, 0.228, 0.307);
  ensureVertexColors(lower, 0.96, 0.94, 0.94);
  return mergeParts([upper, lower]);
}

// Tailored mustache + trimmed jawline beard
export function makeBeardGeo(lod = "hi") {
  const mustL = new THREE.CapsuleGeometry(0.018, 0.062, segs(lod, 4, 2), segs(lod, 6, 4));
  mustL.rotateZ(Math.PI / 2 + 0.20);
  mustL.translate(-0.046, 0.278, 0.318);
  const mustR = new THREE.CapsuleGeometry(0.018, 0.062, segs(lod, 4, 2), segs(lod, 6, 4));
  mustR.rotateZ(Math.PI / 2 - 0.20);
  mustR.translate(0.046, 0.278, 0.318);
  const chin = buildLoft(
    [
      { y: 0.02, rx: 0.15, rz: 0.16, oz: 0.12, shade: 0.85 },
      { y: 0.12, rx: 0.19, rz: 0.20, oz: 0.11, shade: 0.93 },
      { y: 0.22, rx: 0.20, rz: 0.19, oz: 0.09, shade: 0.96 },
    ],
    segs(lod, 14, 7),
    { thetaStart: -Math.PI * 0.45, thetaLen: Math.PI * 0.90 },
  );
  return mergeParts([mustL, mustR, chin]);
}

export function makeNeckGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 4.70, rx: 0.200, rz: 0.180, shade: 0.92 },
      { y: 4.86, rx: 0.155, rz: 0.150, shade: 0.98 },
      { y: 5.04, rx: 0.145, rz: 0.145, shade: 0.96 },
      { y: 5.16, rx: 0.150, rz: 0.150, shade: 0.90 },
    ],
    segs(lod, 16, 7),
  );
}

// Smooth, voluminous hair cap using continuous smoothstep blending (no faceted vertex jumps).
export function makeHairBaseGeo(lod = "hi") {
  const geo = new THREE.SphereGeometry(1, segs(lod, 24, 8), segs(lod, 18, 6));
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    const theta = Math.atan2(vx, vz);
    const wave = 1 + 0.018 * Math.cos(14 * theta);

    // Smooth continuous coverage weights (0 on face -> 1 on crown/back/temples)
    const crownMask = smoothstep(0.24, 0.44, vy - 0.14 * Math.max(0, vz));
    const backMask = smoothstep(-0.02, -0.26, vz) * smoothstep(-0.56, -0.22, vy);
    const templeMask =
      smoothstep(0.58, 0.78, Math.abs(vx)) *
      smoothstep(-0.04, 0.16, vy) *
      smoothstep(0.32, 0.04, vz);
    const cover = Math.max(crownMask, backMask, templeMask);

    // Smoothly tuck non-hair face vertices inside skull, lift hair with natural volume
    const rBoost = -0.055 + cover * (0.108 + 0.016 * Math.max(0, vy));
    const jawScale = vy < 0 ? 1 - 0.28 * Math.pow(-vy, 1.35) : 1.0;

    const rx = (0.296 + rBoost) * wave * jawScale;
    const ry = 0.386 + Math.max(0, rBoost * 0.95);
    const rz = (0.336 + rBoost) * wave;

    const x = vx * rx;
    const y = vy * ry + 0.394;
    const z = vz * rz - 0.016;

    const shade = 0.88 + 0.07 * Math.cos(14 * theta) + 0.07 * Math.max(0, vy);
    pos.setXYZ(i, x, y, z);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function makeHairBunGeo(lod = "hi") {
  const g = new THREE.SphereGeometry(1, segs(lod, 16, 8), segs(lod, 12, 6));
  g.scale(0.160, 0.140, 0.135);
  g.translate(0, 0.38, -0.34);
  return ensureVertexColors(g, 0.94, 0.94, 0.94);
}

// Smoothly sculpted voluminous bob / swept nape hair
export function makeHairSideBobGeo(lod = "hi") {
  const hood = buildLoft(
    [
      { y: 0.12, rx: 0.33, rz: 0.34, oz: -0.06, pleatAmp: 0.032, pleatFreq: 10, shade: 0.86 },
      { y: 0.28, rx: 0.36, rz: 0.38, oz: -0.04, pleatAmp: 0.028, pleatFreq: 10, shade: 0.94 },
      { y: 0.48, rx: 0.35, rz: 0.38, oz: -0.03, pleatAmp: 0.018, pleatFreq: 10, shade: 0.99 },
      { y: 0.66, rx: 0.28, rz: 0.31, oz: -0.02, shade: 1.00 },
    ],
    segs(lod, 20, 8),
    { thetaStart: Math.PI * 0.32, thetaLen: Math.PI * 1.36 },
  );
  const backRoll = new THREE.SphereGeometry(1, segs(lod, 16, 8), segs(lod, 12, 6));
  backRoll.scale(0.28, 0.18, 0.18);
  backRoll.translate(0, 0.24, -0.25);
  ensureVertexColors(backRoll, 0.92, 0.92, 0.92);
  return mergeParts([hood, backRoll]);
}

// Anatomical men's coat/jacket torso (y = 3.24..4.80)
export function makeTorsoMenGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 3.24, rx: 0.50, rz: 0.33, ox: 0, oz: 0.00, pleatAmp: 0.020, pleatFreq: 8, shade: 0.93 },
      { y: 3.48, rx: 0.46, rz: 0.30, ox: 0, oz: 0.00, pleatAmp: 0.016, pleatFreq: 8, shade: 0.96 },
      { y: 3.88, rx: 0.52, rz: 0.34, ox: 0, oz: 0.02, pleatAmp: 0.012, pleatFreq: 8, shade: 0.99 },
      { y: 4.30, rx: 0.59, rz: 0.36, ox: 0, oz: 0.03, pleatAmp: 0.008, pleatFreq: 8, shade: 1.02 },
      { y: 4.62, rx: 0.62, rz: 0.31, ox: 0, oz: 0.01, pleatAmp: 0.005, pleatFreq: 8, shade: 1.00 },
      { y: 4.80, rx: 0.24, rz: 0.20, ox: 0, oz: 0.00, shade: 0.92 },
    ],
    segs(lod, 24, 8),
    { capBottom: true, capTop: true },
  );
}

export function makeTorsoShirtGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 3.34, rx: 0.39, rz: 0.23, pleatAmp: 0.0, pleatFreq: 10, shade: 0.90 },
      { y: 3.56, rx: 0.435, rz: 0.275, pleatAmp: 0.014, pleatFreq: 10, shade: 0.96 },
      { y: 4.02, rx: 0.53, rz: 0.34, ox: 0, oz: 0.02, pleatAmp: 0.012, pleatFreq: 10, shade: 1.01 },
      { y: 4.44, rx: 0.58, rz: 0.33, ox: 0, oz: 0.02, pleatAmp: 0.008, pleatFreq: 10, shade: 1.02 },
      { y: 4.68, rx: 0.56, rz: 0.28, shade: 0.99 },
      { y: 4.82, rx: 0.22, rz: 0.19, shade: 0.92 },
    ],
    segs(lod, 24, 8),
    { capBottom: true, capTop: true },
  );
}

export function makeTorsoWomenGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 3.36, rx: 0.37, rz: 0.25, pleatAmp: 0.016, pleatFreq: 8, shade: 0.94 },
      { y: 3.62, rx: 0.39, rz: 0.26, pleatAmp: 0.014, pleatFreq: 8, shade: 0.97 },
      { y: 4.08, rx: 0.48, rz: 0.33, ox: 0, oz: 0.045, pleatAmp: 0.009, pleatFreq: 8, shade: 1.02 },
      { y: 4.45, rx: 0.50, rz: 0.28, ox: 0, oz: 0.015, shade: 1.00 },
      { y: 4.65, rx: 0.46, rz: 0.23, shade: 0.98 },
      { y: 4.78, rx: 0.19, rz: 0.17, shade: 0.92 },
    ],
    segs(lod, 24, 8),
    { capBottom: true, capTop: true },
  );
}

export function makePelvisGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 2.68, rx: 0.44, rz: 0.31, shade: 0.90 },
      { y: 2.96, rx: 0.48, rz: 0.33, shade: 0.96 },
      { y: 3.26, rx: 0.455, rz: 0.295, shade: 0.98 },
      { y: 3.42, rx: 0.445, rz: 0.285, shade: 0.78 },
      { y: 3.48, rx: 0.440, rz: 0.280, shade: 0.88 },
    ],
    segs(lod, 22, 8),
    { capBottom: true, capTop: true },
  );
}

// Open-front coat skirt / tails for frock coats and sack suits (y = 2.18..3.44)
export function makeCoatTailGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 2.18, rx: 0.58, rz: 0.40, pleatAmp: 0.030, pleatFreq: 9, shade: 0.90 },
      { y: 2.62, rx: 0.54, rz: 0.37, pleatAmp: 0.024, pleatFreq: 9, shade: 0.94 },
      { y: 3.05, rx: 0.50, rz: 0.34, pleatAmp: 0.016, pleatFreq: 9, shade: 0.97 },
      { y: 3.44, rx: 0.47, rz: 0.31, pleatAmp: 0.009, pleatFreq: 9, shade: 0.95 },
    ],
    segs(lod, 22, 8),
    { thetaStart: Math.PI * 0.16, thetaLen: Math.PI * 1.68 },
  );
}

export function makeShirtFrontGeo(lod = "hi") {
  const vFront = new THREE.ConeGeometry(0.145, 0.78, 4);
  vFront.rotateY(Math.PI / 4);
  vFront.rotateX(Math.PI);
  vFront.scale(1.0, 1.0, 0.24);
  vFront.translate(0, 4.36, 0.366);
  const collarRing = buildLoft(
    [
      { y: 4.66, rx: 0.23, rz: 0.21, ox: 0, oz: 0.02, shade: 0.94 },
      { y: 4.78, rx: 0.19, rz: 0.18, ox: 0, oz: 0.01, shade: 1.00 },
    ],
    segs(lod, 18, 7),
  );
  return mergeParts([vFront, collarRing]);
}

// Modest rounded collar for women's dresses and blouses
export function makeWomanCollarGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 4.62, rx: 0.26, rz: 0.23, oz: 0.02, shade: 0.94 },
      { y: 4.74, rx: 0.21, rz: 0.19, oz: 0.01, shade: 1.00 },
      { y: 4.82, rx: 0.18, rz: 0.17, shade: 0.96 },
    ],
    segs(lod, 18, 7),
  );
}

export function makeLapelsGeo(lod = "hi") {
  const mk = (sx) => {
    const strip = new THREE.BoxGeometry(0.11, 0.84, 0.05);
    strip.rotateZ(sx * 0.20);
    strip.rotateY(-sx * 0.18);
    strip.translate(sx * 0.17, 4.26, 0.382);
    return ensureVertexColors(strip, 0.90, 0.90, 0.90);
  };
  return mergeParts([mk(-1), mk(1)]);
}

export function makeTieGeo(lod = "hi") {
  const knot = new THREE.BoxGeometry(0.075, 0.075, 0.045);
  knot.translate(0, 4.66, 0.375);
  const blade = new THREE.ConeGeometry(0.052, 0.52, 4);
  blade.rotateY(Math.PI / 4);
  blade.rotateX(Math.PI);
  blade.scale(1.0, 1.0, 0.28);
  blade.translate(0, 4.38, 0.386);
  return mergeParts([knot, blade]);
}

export function makeVestGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 3.36, rx: 0.47, rz: 0.320, shade: 0.90 },
      { y: 3.74, rx: 0.51, rz: 0.352, ox: 0, oz: 0.018, shade: 0.97 },
      { y: 4.12, rx: 0.53, rz: 0.368, ox: 0, oz: 0.025, shade: 1.00 },
    ],
    segs(lod, 14, 7),
    { thetaStart: -Math.PI * 0.14, thetaLen: Math.PI * 0.28 },
  );
}

// Curved denim bib + shoulder straps hugging torsoShirt cleanly
export function makeOverallsBibGeo(lod = "hi") {
  const bib = buildLoft(
    [
      { y: 3.36, rx: 0.485, rz: 0.318, shade: 0.94 },
      { y: 3.82, rx: 0.550, rz: 0.375, ox: 0, oz: 0.02, shade: 0.98 },
      { y: 4.24, rx: 0.565, rz: 0.390, ox: 0, oz: 0.025, shade: 1.00 },
    ],
    segs(lod, 14, 7),
    { thetaStart: -Math.PI * 0.24, thetaLen: Math.PI * 0.48 },
  );
  const mkStrap = (sx) => {
    const strap = new THREE.BoxGeometry(0.095, 0.52, 0.52);
    strap.rotateX(-0.14);
    strap.translate(sx * 0.22, 4.46, 0.08);
    return ensureVertexColors(strap, 0.95, 0.95, 0.95);
  };
  return mergeParts([bib, mkStrap(-1), mkStrap(1)]);
}

export function makeShawlGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 3.88, rx: 0.60, rz: 0.38, pleatAmp: 0.028, pleatFreq: 10, shade: 0.90 },
      { y: 4.24, rx: 0.58, rz: 0.36, pleatAmp: 0.020, pleatFreq: 10, shade: 0.97 },
      { y: 4.56, rx: 0.54, rz: 0.30, shade: 1.00 },
      { y: 4.74, rx: 0.24, rz: 0.20, shade: 0.94 },
    ],
    segs(lod, 22, 8),
    { thetaStart: Math.PI * 0.14, thetaLen: Math.PI * 1.72 },
  );
}

export function makeSkirtFullGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 0.26, rx: 0.98, rz: 0.90, pleatAmp: 0.052, pleatFreq: 10, shade: 0.88 },
      { y: 0.98, rx: 0.88, rz: 0.80, pleatAmp: 0.046, pleatFreq: 10, shade: 0.92 },
      { y: 1.85, rx: 0.74, rz: 0.66, pleatAmp: 0.036, pleatFreq: 10, shade: 0.96 },
      { y: 2.75, rx: 0.57, rz: 0.48, pleatAmp: 0.024, pleatFreq: 10, shade: 0.99 },
      { y: 3.25, rx: 0.44, rz: 0.34, pleatAmp: 0.014, pleatFreq: 10, shade: 0.98 },
      { y: 3.44, rx: 0.39, rz: 0.27, pleatAmp: 0.008, pleatFreq: 10, shade: 0.93 },
    ],
    segs(lod, 28, 8),
    { capBottom: true },
  );
}

export function makeSkirtBustleGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 0.26, rx: 0.92, rz: 0.84, backBustle: 0.22, pleatAmp: 0.050, pleatFreq: 10, shade: 0.88 },
      { y: 1.05, rx: 0.82, rz: 0.74, backBustle: 0.28, pleatAmp: 0.044, pleatFreq: 10, shade: 0.92 },
      { y: 2.00, rx: 0.68, rz: 0.58, backBustle: 0.36, pleatAmp: 0.036, pleatFreq: 10, shade: 0.96 },
      { y: 2.82, rx: 0.54, rz: 0.42, backBustle: 0.42, pleatAmp: 0.026, pleatFreq: 10, shade: 1.00 },
      { y: 3.26, rx: 0.43, rz: 0.32, backBustle: 0.20, pleatAmp: 0.014, pleatFreq: 10, shade: 0.98 },
      { y: 3.44, rx: 0.39, rz: 0.27, backBustle: 0.06, pleatAmp: 0.008, pleatFreq: 10, shade: 0.93 },
    ],
    segs(lod, 28, 8),
    { capBottom: true },
  );
}

export function makeSkirtMidGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 1.24, rx: 0.74, rz: 0.70, pleatAmp: 0.046, pleatFreq: 9, shade: 0.89 },
      { y: 1.90, rx: 0.67, rz: 0.61, pleatAmp: 0.038, pleatFreq: 9, shade: 0.94 },
      { y: 2.65, rx: 0.58, rz: 0.48, pleatAmp: 0.022, pleatFreq: 9, shade: 0.98 },
      { y: 3.18, rx: 0.46, rz: 0.34, pleatAmp: 0.012, pleatFreq: 9, shade: 0.99 },
      { y: 3.44, rx: 0.40, rz: 0.28, pleatAmp: 0.006, pleatFreq: 9, shade: 0.93 },
    ],
    segs(lod, 26, 8),
    { capBottom: true },
  );
}

export function makeSkirtShortGeo(lod = "hi") {
  return buildLoft(
    [
      { y: 1.66, rx: 0.72, rz: 0.66, pleatAmp: 0.048, pleatFreq: 10, shade: 0.90 },
      { y: 2.25, rx: 0.65, rz: 0.57, pleatAmp: 0.036, pleatFreq: 10, shade: 0.95 },
      { y: 2.85, rx: 0.56, rz: 0.45, pleatAmp: 0.020, pleatFreq: 10, shade: 0.98 },
      { y: 3.24, rx: 0.45, rz: 0.33, pleatAmp: 0.012, pleatFreq: 10, shade: 0.99 },
      { y: 3.44, rx: 0.40, rz: 0.28, pleatAmp: 0.005, pleatFreq: 10, shade: 0.93 },
    ],
    segs(lod, 26, 8),
    { capBottom: true },
  );
}

// Sculpted 2-segment leg: thigh (hip=0 to knee=-1.36) and calf (knee=0 to ankle=-1.34)
export function makeThighGeo(lod = "hi") {
  const shaft = buildLoft(
    [
      { y: -1.36, rx: 0.160, rz: 0.160, shade: 0.90 },
      { y: -0.95, rx: 0.184, rz: 0.186, shade: 0.95 },
      { y: -0.45, rx: 0.215, rz: 0.218, shade: 0.99 },
      { y: 0.00, rx: 0.228, rz: 0.222, shade: 0.97 },
    ],
    segs(lod, 14, 7),
  );
  const hipCap = new THREE.SphereGeometry(1, segs(lod, 12, 6), segs(lod, 8, 5));
  hipCap.scale(0.220, 0.215, 0.205);
  const kneeCap = new THREE.SphereGeometry(0.158, segs(lod, 12, 6), segs(lod, 8, 5));
  kneeCap.translate(0, -1.36, 0);
  return mergeParts([shaft, hipCap, kneeCap]);
}

export function makeCalfGeo(lod = "hi") {
  const shaft = buildLoft(
    [
      { y: -1.34, rx: 0.112, rz: 0.115, shade: 0.89 },
      { y: -0.92, rx: 0.132, rz: 0.140, oz: -0.01, shade: 0.94 },
      { y: -0.40, rx: 0.166, rz: 0.175, oz: -0.02, shade: 0.99 },
      { y: 0.00, rx: 0.158, rz: 0.158, shade: 0.96 },
    ],
    segs(lod, 14, 7),
  );
  const ankleCap = new THREE.SphereGeometry(0.112, segs(lod, 10, 6), segs(lod, 8, 5));
  ankleCap.translate(0, -1.34, 0);
  return mergeParts([shaft, ankleCap]);
}

export function makeShoeGeo(lod = "hi") {
  const vamp = new THREE.SphereGeometry(1, segs(lod, 12, 6), segs(lod, 8, 5));
  vamp.scale(0.148, 0.105, 0.275);
  vamp.translate(0, -0.115, 0.14);
  const heel = new THREE.BoxGeometry(0.23, 0.10, 0.20);
  heel.translate(0, -0.17, -0.06);
  const sole = new THREE.BoxGeometry(0.25, 0.045, 0.44);
  sole.translate(0, -0.197, 0.17);
  const collar = new THREE.CylinderGeometry(0.125, 0.14, 0.14, segs(lod, 12, 6));
  collar.translate(0, -0.05, 0);
  return mergeParts([vamp, heel, sole, collar]);
}

export function makeUpperArmGeo(lod = "hi") {
  const shaft = buildLoft(
    [
      { y: -0.98, rx: 0.138, rz: 0.138, shade: 0.91 },
      { y: -0.52, rx: 0.160, rz: 0.160, shade: 0.97 },
      { y: -0.14, rx: 0.175, rz: 0.175, shade: 1.00 },
      { y: 0.00, rx: 0.168, rz: 0.168, shade: 0.98 },
    ],
    segs(lod, 14, 7),
  );
  const deltoid = new THREE.SphereGeometry(0.168, segs(lod, 12, 6), segs(lod, 8, 5));
  const elbow = new THREE.SphereGeometry(0.138, segs(lod, 10, 6), segs(lod, 8, 5));
  elbow.translate(0, -0.98, 0);
  return mergeParts([shaft, deltoid, elbow]);
}

export function makeForearmGeo(lod = "hi") {
  const shaft = buildLoft(
    [
      { y: -0.86, rx: 0.102, rz: 0.098, shade: 0.90 },
      { y: -0.45, rx: 0.128, rz: 0.124, shade: 0.96 },
      { y: -0.12, rx: 0.140, rz: 0.138, shade: 1.00 },
      { y: 0.00, rx: 0.134, rz: 0.134, shade: 0.97 },
    ],
    segs(lod, 14, 7),
  );
  const wristCap = new THREE.SphereGeometry(0.098, segs(lod, 10, 6), segs(lod, 8, 5));
  wristCap.translate(0, -0.86, 0);
  return mergeParts([shaft, wristCap]);
}

export function makeHandGeo(lod = "hi") {
  const palm = new THREE.SphereGeometry(1, segs(lod, 10, 6), segs(lod, 8, 5));
  palm.scale(0.068, 0.135, 0.105);
  palm.translate(0, -0.13, 0.01);
  const fingers = new THREE.SphereGeometry(1, segs(lod, 10, 6), segs(lod, 8, 5));
  fingers.scale(0.056, 0.14, 0.088);
  fingers.translate(0, -0.27, 0.015);
  const thumb = new THREE.CapsuleGeometry(0.028, 0.10, segs(lod, 4, 2), segs(lod, 6, 4));
  thumb.rotateX(0.45);
  thumb.translate(0, -0.14, 0.10);
  return mergeParts([palm, fingers, thumb]);
}

export function makePuffSleeveGeo(lod = "hi") {
  const g = new THREE.SphereGeometry(1, segs(lod, 16, 8), segs(lod, 12, 6));
  g.scale(0.23, 0.26, 0.23);
  g.translate(0, -0.22, 0);
  return ensureVertexColors(g, 0.98, 0.98, 0.98);
}

export function makeHatCrownCylGeo(lod = "hi") {
  const g = new THREE.CylinderGeometry(0.32, 0.36, 1.0, segs(lod, 22, 8));
  return ensureVertexColors(g, 0.96, 0.96, 0.96);
}

export function makeFedoraCrownGeo(lod = "hi") {
  return buildLoft(
    [
      { y: -0.20, rx: 0.36, rz: 0.40, shade: 0.92 },
      { y: -0.02, rx: 0.34, rz: 0.39, shade: 0.98 },
      { y: 0.16, rx: 0.25, rz: 0.36, frontPinch: 0.03, shade: 1.00 },
      { y: 0.22, rx: 0.18, rz: 0.30, frontPinch: 0.04, shade: 0.94 },
    ],
    segs(lod, 22, 8),
    { capBottom: true, capTop: true },
  );
}

export function makeHatDomeGeo(lod = "hi") {
  const g = new THREE.SphereGeometry(1, segs(lod, 20, 8), segs(lod, 14, 6));
  g.scale(0.36, 0.32, 0.38);
  return ensureVertexColors(g, 0.96, 0.96, 0.96);
}

export function makeHatBrimCurvedGeo(lod = "hi") {
  const geo = new THREE.CylinderGeometry(1.0, 1.0, 0.055, segs(lod, 28, 10), 1);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const curl = Math.max(0, r - 0.35) * (0.14 * (x * x) - 0.09 * (z * z));
    pos.setY(i, y + curl);
  }
  geo.computeVertexNormals();
  return ensureVertexColors(geo, 0.95, 0.95, 0.95);
}

export function makeHatBrimFlatGeo(lod = "hi") {
  const g = new THREE.CylinderGeometry(1.0, 1.0, 0.045, segs(lod, 28, 10));
  return ensureVertexColors(g, 0.97, 0.97, 0.97);
}

export function makeHatBandGeo(lod = "hi") {
  const g = new THREE.CylinderGeometry(0.37, 0.38, 0.11, segs(lod, 22, 8));
  return ensureVertexColors(g, 0.92, 0.92, 0.92);
}

export function makeBonnetGeo(lod = "hi") {
  const hood = buildLoft(
    [
      { y: -0.20, rx: 0.42, rz: 0.46, shade: 0.88 },
      { y: 0.04, rx: 0.45, rz: 0.50, shade: 0.96 },
      { y: 0.28, rx: 0.39, rz: 0.43, shade: 1.00 },
      { y: 0.40, rx: 0.25, rz: 0.29, shade: 0.96 },
    ],
    segs(lod, 24, 8),
    { thetaStart: Math.PI * 0.24, thetaLen: Math.PI * 1.52 },
  );
  const back = new THREE.SphereGeometry(1, segs(lod, 16, 8), segs(lod, 12, 6));
  back.scale(0.36, 0.34, 0.34);
  back.translate(0, 0.06, -0.13);
  return mergeParts([hood, back]);
}
