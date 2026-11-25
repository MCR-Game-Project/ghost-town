import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Procedural sculpted geometry builders for period pedestrians (no photo textures).
// Every geometry carries outward-facing normals and a vertex `color` attribute so
// `instanceColor` tints cleanly while preserving fabric folds, tailoring, and facial AO.

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

function mergeParts(parts) {
  const prepped = parts.map((g) => {
    const nonIdx = (g.index ? g.toNonIndexed() : g).clone();
    nonIdx.deleteAttribute("uv");
    if (!nonIdx.getAttribute("normal")) nonIdx.computeVertexNormals();
    return ensureVertexColors(nonIdx);
  });
  const merged = mergeGeometries(prepped, false);
  merged.computeVertexNormals();
  return merged;
}

// Smooth elliptical loft with optional pleats, front flattening, and bustle curve.
// theta = 0 faces +Z (front), theta = PI/2 faces +X, theta = PI faces -Z (back).
// Outward-facing CCW winding: (a, b, d) and (b, e, d).
export function buildLoft(rings, radialSegs = 20, options = {}) {
  const {
    thetaStart = 0,
    thetaLen = Math.PI * 2,
    capBottom = false,
    capTop = false,
  } = options;
  const openArc = Math.abs(thetaLen - Math.PI * 2) > 1e-4;
  const cols = radialSegs + 1;
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
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      indices.push(a, b, d);
      indices.push(b, e, d);
    }
  }

  if (capBottom && !openArc) {
    const bRing = rings[0];
    const centerIdx = positions.length / 3;
    positions.push(bRing.ox || 0, bRing.y, bRing.oz || 0);
    const bs = (bRing.shade ?? 1.0) * 0.85;
    colors.push(bs, bs, bs);
    for (let c = 0; c < radialSegs; c++) {
      indices.push(centerIdx, c + 1, c);
    }
  }

  if (capTop && !openArc) {
    const tRing = rings[rings.length - 1];
    const topBase = (rings.length - 1) * cols;
    const centerIdx = positions.length / 3;
    positions.push(tRing.ox || 0, tRing.y, tRing.oz || 0);
    const ts = tRing.shade ?? 1.0;
    colors.push(ts, ts, ts);
    for (let c = 0; c < radialSegs; c++) {
      indices.push(centerIdx, topBase + c, topBase + c + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Sculpted head centered on headPivot (base of skull at y = 0, crown at y = 0.76).
// Head center at y = 0.38. Includes brow ridge, recessed eye sockets, nose bridge/tip,
// jaw/chin taper, lip line, ear projections, and soft facial AO vertex shading.
export function makeHeadGeo() {
  const geo = new THREE.SphereGeometry(1, 18, 12);
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
        const chin = Math.exp(-(vx * vx * 6.5 + Math.pow((vy + 0.68) * 3.2, 2)));
        z += 0.044 * chin;
      }
      if (vy < -0.55) shade *= 0.88;
    }

    if (vz > 0.15) {
      const cheek = Math.exp(-(Math.pow((Math.abs(vx) - 0.52) * 3.2, 2) + Math.pow((vy + 0.05) * 3.8, 2)));
      z += 0.020 * cheek;
      blush = cheek;
    }

    if (vz > 0.35) {
      const sock = Math.exp(-(Math.pow((Math.abs(vx) - 0.34) * 4.8, 2) + Math.pow((vy - 0.06) * 6.2, 2)));
      z -= 0.028 * sock;
      shade *= 1 - 0.14 * sock;
    }

    if (vz > 0.42) {
      const brow = Math.exp(-(Math.pow(vx * 1.9, 2) + Math.pow((vy - 0.22) * 6.5, 2)));
      z += 0.022 * brow;
    }

    if (vz > 0.45 && Math.abs(vx) < 0.28) {
      const noseX = Math.exp(-Math.pow(vx / 0.115, 2));
      const noseY = Math.exp(-Math.pow((vy + 0.05) / 0.16, 2));
      const tip = Math.exp(-Math.pow((vy + 0.12) / 0.08, 2));
      const nose = noseX * (0.72 * noseY + 0.45 * tip);
      z += 0.084 * nose;
      const underNose = noseX * Math.exp(-Math.pow((vy + 0.22) / 0.06, 2));
      shade *= 1 - 0.14 * underNose;
    }

    if (vz > 0.45 && Math.abs(vx) < 0.30) {
      const mouthLine = Math.exp(-(Math.pow(vx * 4.5, 2) + Math.pow((vy + 0.36) * 14.0, 2)));
      z -= 0.012 * mouthLine;
      shade *= 1 - 0.08 * mouthLine;
    }

    if (Math.abs(vx) > 0.80 && vy > -0.24 && vy < 0.20 && vz > -0.26 && vz < 0.14) {
      const ear = Math.exp(-(Math.pow((vy + 0.02) * 5.0, 2) + Math.pow((vz + 0.06) * 6.0, 2)));
      x += Math.sign(vx) * 0.036 * ear;
      shade *= 1 - 0.08 * ear;
      blush = Math.max(blush, ear * 0.6);
    }

    pos.setXYZ(i, x, y + 0.38, z);
    colors[i * 3] = Math.min(1.04, shade * (1 + 0.035 * blush));
    colors[i * 3 + 1] = shade * (1 - 0.025 * blush);
    colors[i * 3 + 2] = shade * (1 - 0.035 * blush);
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function makeEyeWhitesGeo() {
  const mk = (sx) => {
    const g = new THREE.SphereGeometry(1, 8, 6);
    g.scale(0.050, 0.027, 0.022);
    g.rotateY(sx * 0.16);
    g.translate(sx * 0.100, 0.402, 0.285);
    return ensureVertexColors(g, 0.96, 0.95, 0.93);
  };
  return mergeParts([mk(-1), mk(1)]);
}

export function makeIrisesGeo() {
  const mk = (sx) => {
    const g = new THREE.SphereGeometry(1, 8, 6);
    g.scale(0.027, 0.027, 0.020);
    g.translate(sx * 0.100, 0.402, 0.299);
    return ensureVertexColors(g, 1, 1, 1);
  };
  return mergeParts([mk(-1), mk(1)]);
}

export function makeBrowsGeo() {
  const mk = (sx) => {
    const g = new THREE.CapsuleGeometry(0.013, 0.070, 2, 5);
    g.rotateZ(Math.PI / 2 - sx * 0.10);
    g.scale(1.0, 0.85, 0.75);
    g.translate(sx * 0.100, 0.454, 0.307);
    return ensureVertexColors(g, 0.86, 0.86, 0.86);
  };
  return mergeParts([mk(-1), mk(1)]);
}

export function makeMouthGeo() {
  const g = new THREE.SphereGeometry(1, 8, 6);
  g.scale(0.062, 0.018, 0.024);
  g.translate(0, 0.240, 0.306);
  return ensureVertexColors(g, 0.94, 0.92, 0.92);
}

// Tailored mustache + trimmed jawline beard (not a floating chin ball)
export function makeBeardGeo() {
  const mustL = new THREE.CapsuleGeometry(0.016, 0.056, 2, 5);
  mustL.rotateZ(Math.PI / 2 + 0.20);
  mustL.translate(-0.044, 0.278, 0.316);
  const mustR = new THREE.CapsuleGeometry(0.016, 0.056, 2, 5);
  mustR.rotateZ(Math.PI / 2 - 0.20);
  mustR.translate(0.044, 0.278, 0.316);
  const chin = buildLoft(
    [
      { y: 0.02, rx: 0.15, rz: 0.16, oz: 0.12, shade: 0.85 },
      { y: 0.12, rx: 0.19, rz: 0.20, oz: 0.11, shade: 0.93 },
      { y: 0.22, rx: 0.20, rz: 0.19, oz: 0.09, shade: 0.96 },
    ],
    10,
    { thetaStart: -Math.PI * 0.45, thetaLen: Math.PI * 0.90 },
  );
  return mergeParts([mustL, mustR, chin]);
}

export function makeNeckGeo() {
  return buildLoft(
    [
      { y: 4.70, rx: 0.200, rz: 0.180, shade: 0.92 },
      { y: 4.86, rx: 0.155, rz: 0.150, shade: 0.98 },
      { y: 5.04, rx: 0.145, rz: 0.145, shade: 0.96 },
      { y: 5.16, rx: 0.150, rz: 0.150, shade: 0.90 },
    ],
    14,
  );
}

// Sculpted hair cap covering crown, temples, and nape — never clips cheeks or jawline.
export function makeHairBaseGeo() {
  const geo = new THREE.SphereGeometry(1, 12, 8);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    const theta = Math.atan2(vx, vz);
    const strand = 1 + 0.024 * Math.cos(18 * theta);

    // Hair covers top/crown (vy > 0.34), temples above ears (|vx| > 0.72 && vy > 0.08),
    // and back of skull (vz < -0.15 && vy > -0.35). Everything on the face/jaw stays inside skull.
    const onBack = vz < -0.15 && vy > -0.38;
    const onCrown = vy > 0.34 + 0.12 * Math.max(0, vz);
    const onTemple = Math.abs(vx) > 0.72 && vz > -0.25 && vz < 0.25 && vy > 0.08 && vy < 0.40;
    const keepOut = !(onBack || onCrown || onTemple);

    const rBoost = keepOut ? -0.06 : 0.036;
    const jawScale = vy < 0 ? 1 - 0.30 * Math.pow(-vy, 1.35) : 1.0;

    const rx = (0.300 + rBoost) * strand * jawScale;
    const ry = 0.390 + Math.max(0, rBoost);
    const rz = (0.340 + rBoost) * strand;

    const x = vx * rx;
    const y = vy * ry + 0.39;
    const z = vz * rz - 0.014;

    const shade = 0.92 + 0.08 * Math.cos(18 * theta) + 0.04 * Math.max(0, vy);
    pos.setXYZ(i, x, y, z);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function makeHairBunGeo() {
  const g = new THREE.SphereGeometry(1, 10, 8);
  g.scale(0.145, 0.130, 0.125);
  g.translate(0, 0.37, -0.34);
  return ensureVertexColors(g, 0.94, 0.94, 0.94);
}

export function makeHairSideBobGeo() {
  const mk = (sx) => {
    const g = new THREE.CapsuleGeometry(0.072, 0.24, 3, 6);
    g.scale(0.68, 1.0, 1.12);
    g.rotateZ(sx * 0.10);
    g.translate(sx * 0.212, 0.31, -0.10);
    return ensureVertexColors(g, 0.94, 0.94, 0.94);
  };
  const back = new THREE.CapsuleGeometry(0.135, 0.20, 3, 6);
  back.rotateZ(Math.PI / 2);
  back.scale(1.22, 1.14, 0.86);
  back.translate(0, 0.29, -0.26);
  return mergeParts([mk(-1), mk(1), back]);
}

// Anatomical men's coat/jacket torso (y = 3.24..4.80)
export function makeTorsoMenGeo() {
  return buildLoft(
    [
      { y: 3.24, rx: 0.50, rz: 0.33, ox: 0, oz: 0.00, pleatAmp: 0.022, pleatFreq: 8, shade: 0.93 },
      { y: 3.48, rx: 0.46, rz: 0.30, ox: 0, oz: 0.00, pleatAmp: 0.018, pleatFreq: 8, shade: 0.96 },
      { y: 3.88, rx: 0.52, rz: 0.34, ox: 0, oz: 0.02, pleatAmp: 0.014, pleatFreq: 8, shade: 0.99 },
      { y: 4.30, rx: 0.59, rz: 0.36, ox: 0, oz: 0.03, pleatAmp: 0.010, pleatFreq: 8, shade: 1.02 },
      { y: 4.62, rx: 0.62, rz: 0.31, ox: 0, oz: 0.01, pleatAmp: 0.006, pleatFreq: 8, shade: 1.00 },
      { y: 4.80, rx: 0.24, rz: 0.20, ox: 0, oz: 0.00, shade: 0.92 },
    ],
    20,
    { capBottom: true, capTop: true },
  );
}

export function makeTorsoShirtGeo() {
  return buildLoft(
    [
      { y: 3.34, rx: 0.40, rz: 0.24, pleatAmp: 0.0, pleatFreq: 10, shade: 0.90 },
      { y: 3.56, rx: 0.44, rz: 0.28, pleatAmp: 0.014, pleatFreq: 10, shade: 0.96 },
      { y: 4.02, rx: 0.53, rz: 0.34, ox: 0, oz: 0.02, pleatAmp: 0.012, pleatFreq: 10, shade: 1.01 },
      { y: 4.44, rx: 0.58, rz: 0.33, ox: 0, oz: 0.02, pleatAmp: 0.008, pleatFreq: 10, shade: 1.02 },
      { y: 4.68, rx: 0.56, rz: 0.28, shade: 0.99 },
      { y: 4.82, rx: 0.22, rz: 0.19, shade: 0.92 },
    ],
    20,
    { capBottom: true, capTop: true },
  );
}

export function makeTorsoWomenGeo() {
  return buildLoft(
    [
      { y: 3.36, rx: 0.37, rz: 0.25, pleatAmp: 0.018, pleatFreq: 8, shade: 0.94 },
      { y: 3.62, rx: 0.39, rz: 0.26, pleatAmp: 0.015, pleatFreq: 8, shade: 0.97 },
      { y: 4.08, rx: 0.48, rz: 0.33, ox: 0, oz: 0.045, pleatAmp: 0.010, pleatFreq: 8, shade: 1.02 },
      { y: 4.45, rx: 0.50, rz: 0.28, ox: 0, oz: 0.015, shade: 1.00 },
      { y: 4.65, rx: 0.46, rz: 0.23, shade: 0.98 },
      { y: 4.78, rx: 0.19, rz: 0.17, shade: 0.92 },
    ],
    20,
    { capBottom: true, capTop: true },
  );
}

export function makePelvisGeo() {
  return buildLoft(
    [
      { y: 2.68, rx: 0.44, rz: 0.31, shade: 0.90 },
      { y: 2.96, rx: 0.48, rz: 0.33, shade: 0.96 },
      { y: 3.26, rx: 0.475, rz: 0.315, shade: 0.98 },
      { y: 3.42, rx: 0.470, rz: 0.305, shade: 0.78 },
      { y: 3.48, rx: 0.465, rz: 0.300, shade: 0.88 },
    ],
    18,
    { capBottom: true, capTop: true },
  );
}

// Open-front coat skirt / tails for frock coats and sack suits (y = 2.18..3.44)
export function makeCoatTailGeo() {
  return buildLoft(
    [
      { y: 2.18, rx: 0.58, rz: 0.40, pleatAmp: 0.032, pleatFreq: 9, shade: 0.90 },
      { y: 2.62, rx: 0.54, rz: 0.37, pleatAmp: 0.025, pleatFreq: 9, shade: 0.94 },
      { y: 3.05, rx: 0.50, rz: 0.34, pleatAmp: 0.018, pleatFreq: 9, shade: 0.97 },
      { y: 3.44, rx: 0.47, rz: 0.31, pleatAmp: 0.010, pleatFreq: 9, shade: 0.95 },
    ],
    18,
    { thetaStart: Math.PI * 0.16, thetaLen: Math.PI * 1.68 },
  );
}

export function makeShirtFrontGeo() {
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
    14,
  );
  return mergeParts([vFront, collarRing]);
}

// Modest rounded collar for women's dresses and blouses
export function makeWomanCollarGeo() {
  return buildLoft(
    [
      { y: 4.62, rx: 0.26, rz: 0.23, oz: 0.02, shade: 0.94 },
      { y: 4.74, rx: 0.21, rz: 0.19, oz: 0.01, shade: 1.00 },
      { y: 4.82, rx: 0.18, rz: 0.17, shade: 0.96 },
    ],
    16,
  );
}

export function makeLapelsGeo() {
  const mk = (sx) => {
    const strip = new THREE.BoxGeometry(0.11, 0.84, 0.05);
    strip.rotateZ(sx * 0.20);
    strip.rotateY(-sx * 0.18);
    strip.translate(sx * 0.17, 4.26, 0.382);
    return ensureVertexColors(strip, 0.90, 0.90, 0.90);
  };
  return mergeParts([mk(-1), mk(1)]);
}

export function makeTieGeo() {
  const knot = new THREE.BoxGeometry(0.075, 0.075, 0.045);
  knot.translate(0, 4.66, 0.375);
  const blade = new THREE.ConeGeometry(0.052, 0.52, 4);
  blade.rotateY(Math.PI / 4);
  blade.rotateX(Math.PI);
  blade.scale(1.0, 1.0, 0.28);
  blade.translate(0, 4.38, 0.386);
  return mergeParts([knot, blade]);
}

export function makeVestGeo() {
  return buildLoft(
    [
      { y: 3.36, rx: 0.47, rz: 0.320, shade: 0.90 },
      { y: 3.74, rx: 0.51, rz: 0.352, ox: 0, oz: 0.018, shade: 0.97 },
      { y: 4.12, rx: 0.53, rz: 0.368, ox: 0, oz: 0.025, shade: 1.00 },
    ],
    12,
    { thetaStart: -Math.PI * 0.14, thetaLen: Math.PI * 0.28 },
  );
}

// Curved denim bib + shoulder straps hugging torsoShirt cleanly
export function makeOverallsBibGeo() {
  const bib = buildLoft(
    [
      { y: 3.36, rx: 0.485, rz: 0.318, shade: 0.94 },
      { y: 3.82, rx: 0.550, rz: 0.375, ox: 0, oz: 0.02, shade: 0.98 },
      { y: 4.24, rx: 0.565, rz: 0.390, ox: 0, oz: 0.025, shade: 1.00 },
    ],
    12,
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

export function makeShawlGeo() {
  return buildLoft(
    [
      { y: 3.88, rx: 0.60, rz: 0.38, pleatAmp: 0.03, pleatFreq: 10, shade: 0.90 },
      { y: 4.24, rx: 0.58, rz: 0.36, pleatAmp: 0.02, pleatFreq: 10, shade: 0.97 },
      { y: 4.56, rx: 0.54, rz: 0.30, shade: 1.00 },
      { y: 4.74, rx: 0.24, rz: 0.20, shade: 0.94 },
    ],
    18,
    { thetaStart: Math.PI * 0.14, thetaLen: Math.PI * 1.72 },
  );
}

export function makeSkirtFullGeo() {
  return buildLoft(
    [
      { y: 0.26, rx: 0.98, rz: 0.90, pleatAmp: 0.055, pleatFreq: 10, shade: 0.88 },
      { y: 0.98, rx: 0.88, rz: 0.80, pleatAmp: 0.048, pleatFreq: 10, shade: 0.92 },
      { y: 1.85, rx: 0.74, rz: 0.66, pleatAmp: 0.038, pleatFreq: 10, shade: 0.96 },
      { y: 2.75, rx: 0.57, rz: 0.48, pleatAmp: 0.025, pleatFreq: 10, shade: 0.99 },
      { y: 3.25, rx: 0.44, rz: 0.34, pleatAmp: 0.015, pleatFreq: 10, shade: 0.98 },
      { y: 3.44, rx: 0.39, rz: 0.27, pleatAmp: 0.008, pleatFreq: 10, shade: 0.93 },
    ],
    24,
    { capBottom: true },
  );
}

export function makeSkirtBustleGeo() {
  return buildLoft(
    [
      { y: 0.26, rx: 0.92, rz: 0.84, backBustle: 0.22, pleatAmp: 0.052, pleatFreq: 10, shade: 0.88 },
      { y: 1.05, rx: 0.82, rz: 0.74, backBustle: 0.28, pleatAmp: 0.045, pleatFreq: 10, shade: 0.92 },
      { y: 2.00, rx: 0.68, rz: 0.58, backBustle: 0.36, pleatAmp: 0.038, pleatFreq: 10, shade: 0.96 },
      { y: 2.82, rx: 0.54, rz: 0.42, backBustle: 0.42, pleatAmp: 0.028, pleatFreq: 10, shade: 1.00 },
      { y: 3.26, rx: 0.43, rz: 0.32, backBustle: 0.20, pleatAmp: 0.015, pleatFreq: 10, shade: 0.98 },
      { y: 3.44, rx: 0.39, rz: 0.27, backBustle: 0.06, pleatAmp: 0.008, pleatFreq: 10, shade: 0.93 },
    ],
    24,
    { capBottom: true },
  );
}

export function makeSkirtMidGeo() {
  return buildLoft(
    [
      { y: 1.24, rx: 0.74, rz: 0.70, pleatAmp: 0.048, pleatFreq: 9, shade: 0.89 },
      { y: 1.90, rx: 0.67, rz: 0.61, pleatAmp: 0.040, pleatFreq: 9, shade: 0.94 },
      { y: 2.65, rx: 0.58, rz: 0.48, pleatAmp: 0.024, pleatFreq: 9, shade: 0.98 },
      { y: 3.18, rx: 0.46, rz: 0.34, pleatAmp: 0.014, pleatFreq: 9, shade: 0.99 },
      { y: 3.44, rx: 0.40, rz: 0.28, pleatAmp: 0.006, pleatFreq: 9, shade: 0.93 },
    ],
    22,
    { capBottom: true },
  );
}

export function makeSkirtShortGeo() {
  return buildLoft(
    [
      { y: 1.66, rx: 0.72, rz: 0.66, pleatAmp: 0.052, pleatFreq: 10, shade: 0.90 },
      { y: 2.25, rx: 0.65, rz: 0.57, pleatAmp: 0.038, pleatFreq: 10, shade: 0.95 },
      { y: 2.85, rx: 0.56, rz: 0.45, pleatAmp: 0.022, pleatFreq: 10, shade: 0.98 },
      { y: 3.24, rx: 0.45, rz: 0.33, pleatAmp: 0.012, pleatFreq: 10, shade: 0.99 },
      { y: 3.44, rx: 0.40, rz: 0.28, pleatAmp: 0.005, pleatFreq: 10, shade: 0.93 },
    ],
    22,
    { capBottom: true },
  );
}

// Sculpted 2-segment leg: thigh (hip=0 to knee=-1.36) and calf (knee=0 to ankle=-1.34)
export function makeThighGeo() {
  const shaft = buildLoft(
    [
      { y: -1.36, rx: 0.160, rz: 0.160, shade: 0.90 },
      { y: -0.95, rx: 0.184, rz: 0.186, shade: 0.95 },
      { y: -0.45, rx: 0.215, rz: 0.218, shade: 0.99 },
      { y: 0.00, rx: 0.228, rz: 0.222, shade: 0.97 },
    ],
    10,
  );
  const hipCap = new THREE.SphereGeometry(1, 8, 6);
  hipCap.scale(0.220, 0.215, 0.205);
  const kneeCap = new THREE.SphereGeometry(0.158, 8, 6);
  kneeCap.translate(0, -1.36, 0);
  return mergeParts([shaft, hipCap, kneeCap]);
}

export function makeCalfGeo() {
  const shaft = buildLoft(
    [
      { y: -1.34, rx: 0.112, rz: 0.115, shade: 0.89 },
      { y: -0.92, rx: 0.132, rz: 0.140, oz: -0.01, shade: 0.94 },
      { y: -0.40, rx: 0.166, rz: 0.175, oz: -0.02, shade: 0.99 },
      { y: 0.00, rx: 0.158, rz: 0.158, shade: 0.96 },
    ],
    10,
  );
  const ankleCap = new THREE.SphereGeometry(0.112, 8, 6);
  ankleCap.translate(0, -1.34, 0);
  return mergeParts([shaft, ankleCap]);
}

export function makeShoeGeo() {
  const vamp = new THREE.SphereGeometry(1, 8, 6);
  vamp.scale(0.148, 0.105, 0.275);
  vamp.translate(0, -0.115, 0.14);
  const heel = new THREE.BoxGeometry(0.23, 0.10, 0.20);
  heel.translate(0, -0.17, -0.06);
  const sole = new THREE.BoxGeometry(0.25, 0.045, 0.44);
  sole.translate(0, -0.197, 0.17);
  const collar = new THREE.CylinderGeometry(0.125, 0.14, 0.14, 8);
  collar.translate(0, -0.05, 0);
  return mergeParts([vamp, heel, sole, collar]);
}

export function makeUpperArmGeo() {
  const shaft = buildLoft(
    [
      { y: -0.98, rx: 0.138, rz: 0.138, shade: 0.91 },
      { y: -0.52, rx: 0.160, rz: 0.160, shade: 0.97 },
      { y: -0.14, rx: 0.175, rz: 0.175, shade: 1.00 },
      { y: 0.00, rx: 0.168, rz: 0.168, shade: 0.98 },
    ],
    10,
  );
  const deltoid = new THREE.SphereGeometry(0.168, 8, 6);
  const elbow = new THREE.SphereGeometry(0.138, 8, 6);
  elbow.translate(0, -0.98, 0);
  return mergeParts([shaft, deltoid, elbow]);
}

export function makeForearmGeo() {
  const shaft = buildLoft(
    [
      { y: -0.86, rx: 0.102, rz: 0.098, shade: 0.90 },
      { y: -0.45, rx: 0.128, rz: 0.124, shade: 0.96 },
      { y: -0.12, rx: 0.140, rz: 0.138, shade: 1.00 },
      { y: 0.00, rx: 0.134, rz: 0.134, shade: 0.97 },
    ],
    10,
  );
  const wristCap = new THREE.SphereGeometry(0.098, 8, 6);
  wristCap.translate(0, -0.86, 0);
  return mergeParts([shaft, wristCap]);
}

export function makeHandGeo() {
  const palm = new THREE.SphereGeometry(1, 8, 6);
  palm.scale(0.068, 0.135, 0.105);
  palm.translate(0, -0.13, 0.01);
  const fingers = new THREE.SphereGeometry(1, 8, 6);
  fingers.scale(0.056, 0.14, 0.088);
  fingers.translate(0, -0.27, 0.015);
  const thumb = new THREE.CapsuleGeometry(0.028, 0.10, 2, 5);
  thumb.rotateX(0.45);
  thumb.translate(0, -0.14, 0.10);
  return mergeParts([palm, fingers, thumb]);
}

export function makePuffSleeveGeo() {
  const g = new THREE.SphereGeometry(1, 10, 8);
  g.scale(0.23, 0.26, 0.23);
  g.translate(0, -0.22, 0);
  return ensureVertexColors(g, 0.98, 0.98, 0.98);
}

export function makeHatCrownCylGeo() {
  const g = new THREE.CylinderGeometry(0.32, 0.36, 1.0, 16);
  return ensureVertexColors(g, 0.96, 0.96, 0.96);
}

export function makeFedoraCrownGeo() {
  return buildLoft(
    [
      { y: -0.20, rx: 0.36, rz: 0.40, shade: 0.92 },
      { y: -0.02, rx: 0.34, rz: 0.39, shade: 0.98 },
      { y: 0.16, rx: 0.24, rz: 0.35, frontPinch: 0.03, shade: 1.00 },
      { y: 0.22, rx: 0.16, rz: 0.28, frontPinch: 0.04, shade: 0.94 },
    ],
    18,
    { capBottom: true, capTop: true },
  );
}

export function makeHatDomeGeo() {
  const g = new THREE.SphereGeometry(1, 12, 8);
  g.scale(0.36, 0.32, 0.38);
  return ensureVertexColors(g, 0.96, 0.96, 0.96);
}

export function makeHatBrimCurvedGeo() {
  const geo = new THREE.CylinderGeometry(1.0, 1.0, 0.055, 22, 1);
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

export function makeHatBrimFlatGeo() {
  const g = new THREE.CylinderGeometry(1.0, 1.0, 0.045, 22);
  return ensureVertexColors(g, 0.97, 0.97, 0.97);
}

export function makeHatBandGeo() {
  const g = new THREE.CylinderGeometry(0.37, 0.38, 0.11, 18);
  return ensureVertexColors(g, 0.92, 0.92, 0.92);
}

export function makeBonnetGeo() {
  const hood = buildLoft(
    [
      { y: -0.20, rx: 0.42, rz: 0.46, shade: 0.88 },
      { y: 0.04, rx: 0.45, rz: 0.50, shade: 0.96 },
      { y: 0.28, rx: 0.39, rz: 0.43, shade: 1.00 },
      { y: 0.40, rx: 0.25, rz: 0.29, shade: 0.96 },
    ],
    20,
    { thetaStart: Math.PI * 0.24, thetaLen: Math.PI * 1.52 },
  );
  const back = new THREE.SphereGeometry(1, 10, 8);
  back.scale(0.36, 0.34, 0.34);
  back.translate(0, 0.06, -0.13);
  return mergeParts([hood, back]);
}
