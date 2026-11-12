import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeMaterials, makeSignTexture } from "./textures.js";
import { mirrorPlat } from "./orient.js";
import { drawFacadeSpec } from "./facade/assemble.js";

const FACING = { "+z": 0, "-z": Math.PI, "+x": Math.PI / 2, "-x": -Math.PI / 2 };

const idHash = (id) => {
  let h = 0;
  const s = id || "";
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
};

export function buildTown(data, scene) {
  mirrorPlat(data);
  const mats = makeMaterials();
  const buckets = new Map();
  const detailBuckets = new Map();
  let detailOn = false;
  const signs = [];
  const extraTrees = [];
  const colliders = [];
  const picks = new THREE.Group();
  picks.name = "picks";
  let buildingMatrix = new THREE.Matrix4();
  const white = new THREE.Color(1, 1, 1);
  let tint = new THREE.Color(1, 1, 1);

  const put = (mat, geo) => {
    const c = mat.userData?.vary ? tint : white;
    const n = geo.getAttribute("position").count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const dest = detailOn ? detailBuckets : buckets;
    if (!dest.has(mat)) dest.set(mat, []);
    dest.get(mat).push(geo);
  };

  // Box faces are 0–1 in UV. Scale them by the material's foot-size so a brick stays a brick.
  const scaleBoxUVs = (geo, w, h, d, mat) => {
    const uv = geo.getAttribute("uv");
    if (!uv || uv.count !== 24) return;
    const feet = mat?.userData?.uvFeet || { u: 4, v: 3.2 };
    const faces = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    for (let face = 0; face < 6; face++) {
      const su = faces[face][0] / feet.u;
      const sv = faces[face][1] / feet.v;
      for (let i = 0; i < 4; i++) {
        const idx = face * 4 + i;
        uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
      }
    }
    uv.needsUpdate = true;
  };

  // Glass panes store a 0–1 vertical UV so the top of each light can reflect sky.
  const gradeGlassUV = (geo) => {
    const pos = geo.getAttribute("position");
    const uv = geo.getAttribute("uv");
    if (!pos || !uv) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = Math.max(0.001, maxY - minY);
    for (let i = 0; i < pos.count; i++) uv.setXY(i, uv.getX(i), (pos.getY(i) - minY) / span);
    uv.needsUpdate = true;
  };

  const box = (mat, cx, cy, cz, w, h, d) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (mat === mats.glass || mat === mats.glassShop) gradeGlassUV(geo);
    else scaleBoxUVs(geo, w, h, d, mat);
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(cx, cy, cz));
    geo.applyMatrix4(buildingMatrix);
    put(mat, geo);
  };

  const localBox = (mat, cx, cy, cz, w, h, d, rotX = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d, mat);
    if (rotX) geo.applyMatrix4(new THREE.Matrix4().makeRotationX(rotX));
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(cx, cy, cz));
    geo.applyMatrix4(buildingMatrix);
    put(mat, geo);
  };

  // A shallow arch of short blocks. "z" bulges toward the street; "x" bulges off a side wall.
  const archHood = (mat, x, yBase, z, span, rise, outward) => {
    const steps = rise > span * 0.3 ? 7 : 5;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const u = (t - 0.5) * 2;
      const yy = yBase + rise * (1 - u * u);
      const seg = span / steps + 0.12;
      if (outward === "z") box(mat, x + u * span * 0.46, yy, z, seg, 0.36, 0.42);
      else box(mat, x, yy, z + u * span * 0.46, 0.42, 0.36, seg);
    }
  };

  // Semicircular brick arch. Each voussoir is a separate block so the joints read.
  const voussoirArch = (brickMat, mortarMat, x, yBase, z, span) => {
    const n = span > 6 ? 15 : 11;
    const thick = Math.max(0.46, span * 0.078);
    const rad = span / 2 + thick * 0.2;
    const place = (mat, radius, depth, zOff, gap, keyMat = null) => {
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * (i + 0.5)) / n;
        const arc = (Math.PI * radius) / n;
        const geo = new THREE.BoxGeometry(arc * gap, thick, depth);
        geo.rotateZ(ang - Math.PI / 2);
        geo.translate(x + Math.cos(ang) * radius, yBase + Math.sin(ang) * radius, z + zOff);
        geo.applyMatrix4(buildingMatrix);
        put(keyMat && i === (n - 1) / 2 ? keyMat : mat, geo);
      }
    };
    place(mortarMat, rad + 0.04, 0.28, -0.16, 1.04);
    place(brickMat, rad, 0.5, 0.08, 0.76, mats.stone);
  };

  // Upper half-round light, divided by radial bars.
  const fanlight = (x, y, z, r, bars) => {
    const shape = new THREE.Shape();
    const radius = r * 0.94;
    shape.absarc(0, 0, radius, 0, Math.PI, false);
    shape.lineTo(radius, 0);
    const geo = new THREE.ShapeGeometry(shape, 18);
    gradeGlassUV(geo);
    geo.translate(x, y, z);
    geo.applyMatrix4(buildingMatrix);
    put(mats.glass, geo);
    const count = Math.max(2, bars);
    for (let i = 1; i < count; i++) {
      const ang = (Math.PI * i) / count;
      const len = radius * 0.98;
      const muntin = new THREE.BoxGeometry(0.07, len, 0.08);
      muntin.rotateZ(ang - Math.PI / 2);
      muntin.translate(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5, z + 0.06);
      muntin.applyMatrix4(buildingMatrix);
      put(mats.trim, muntin);
    }
  };

  // One-over-one sash. Glass sits several inches behind the outer frame so the
  // reveal and the projecting sill cast a shadow. arch "open" leaves the head clear.
  const frontSash = (x, y, z, w, h, arch, shutters = false, archMat = mats.trim, hood = false, cap = true) => {
    const frame = archMat || mats.trim;
    const stile = Math.max(0.15, Math.min(0.28, w * 0.09));
    const meet = Math.max(0.18, stile * 1.2);
    const recess = 0.48;
    const glassZ = z + 0.05;
    const outerZ = glassZ + recess;
    const frameD = 0.16;
    const frameZ = outerZ - frameD * 0.42;
    const sillMat = archMat === mats.voussoir ? mats.stone : frame;
    box(mats.reveal, x, y, glassZ - 0.1, w * 0.98, h * 0.98, 0.1);
    const jd = recess * 0.92;
    const jz = glassZ + jd * 0.48;
    box(mats.reveal, x - w / 2 + 0.04, y, jz, 0.08, h * 0.98, jd);
    box(mats.reveal, x + w / 2 - 0.04, y, jz, 0.08, h * 0.98, jd);
    box(mats.reveal, x, y + h / 2 - 0.04, jz, w * 0.98, 0.08, jd);
    box(mats.reveal, x, y - h / 2 + 0.04, jz, w * 0.98, 0.08, jd);
    const paneW = Math.max(0.2, w - stile * 2.5);
    const paneH = Math.max(0.2, (h - meet - stile * 2.1) * 0.5);
    const up = meet * 0.5 + paneH * 0.5;
    // One vertical range across both lights, so the lower sash carries the tree reflection.
    const glassPane = (yy, v0, v1) => {
      const geo = new THREE.BoxGeometry(paneW, paneH, 0.04);
      const pos = geo.getAttribute("position");
      const uv = geo.getAttribute("uv");
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const yyPos = pos.getY(i);
        if (yyPos < minY) minY = yyPos;
        if (yyPos > maxY) maxY = yyPos;
      }
      const spanY = Math.max(0.001, maxY - minY);
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - minY) / spanY;
        uv.setXY(i, uv.getX(i), v0 + (v1 - v0) * t);
      }
      geo.translate(x, yy, glassZ);
      geo.applyMatrix4(buildingMatrix);
      put(mats.glass, geo);
    };
    glassPane(y + up, 0.5, 1);
    glassPane(y - up, 0, 0.5);
    box(frame, x - w / 2, y, frameZ, stile, h + stile * 0.55, frameD);
    box(frame, x + w / 2, y, frameZ, stile, h + stile * 0.55, frameD);
    box(frame, x, y + h / 2, frameZ, w + stile, stile, frameD);
    box(frame, x, y - h / 2, frameZ, w + stile, stile * 0.85, frameD);
    box(frame, x, y, glassZ + 0.1, w - stile * 1.15, meet, 0.12);
    box(frame, x - w / 2 + stile * 0.72, y, glassZ + 0.07, stile * 0.4, h - stile * 1.5, 0.09);
    box(frame, x + w / 2 - stile * 0.72, y, glassZ + 0.07, stile * 0.4, h - stile * 1.5, 0.09);
    box(sillMat, x, y - h / 2 - 0.26, outerZ + 0.12, w + 1.15, 0.32, 0.95);
    box(mats.trimDark, x, y - h / 2 - 0.46, outerZ + 0.28, w + 0.7, 0.1, 0.34);
    if (arch === "segmental") archHood(archMat, x, y + h / 2 + 0.04, outerZ, w + 0.35, (w + 0.35) * 0.28, "z");
    else if (arch === "round") archHood(archMat, x, y + h / 2 - w * 0.1, outerZ, w + 0.25, (w + 0.25) * 0.5, "z");
    else if (arch !== "open" && cap) box(mats.stone, x, y + h / 2 + 0.24, outerZ + 0.02, w + 0.75, 0.24, 0.55);
    if (shutters) {
      const sw = Math.min(0.48, w * 0.32);
      box(mats.shutter, x - w / 2 - sw * 0.72, y, outerZ - 0.08, sw, h * 0.9, 0.1);
      box(mats.shutter, x + w / 2 + sw * 0.72, y, outerZ - 0.08, sw, h * 0.9, 0.1);
    }
    if (hood) {
      localBox(mats.trim, x, y + h / 2 + 0.55, outerZ + 0.2, w + 1.05, 0.14, 1.25, -0.42);
      box(mats.trimDark, x - w * 0.42, y + h / 2 + 0.18, outerZ, 0.16, 0.55, 0.28);
      box(mats.trimDark, x + w * 0.42, y + h / 2 + 0.18, outerZ, 0.16, 0.55, 0.28);
    }
  };

  const sideSash = (x, y, z, side, w, h, arch, shutters = false, archMat = mats.trim) => {
    const frame = archMat || mats.trim;
    const stile = Math.max(0.12, Math.min(0.22, w * 0.09));
    const meet = Math.max(0.16, stile * 1.15);
    const recess = 0.42;
    const glassX = x + side * 0.05;
    const outer = 0.05 + recess;
    const frameD = 0.14;
    const frameX = x + side * (outer - frameD * 0.4);
    const sillMat = archMat === mats.voussoir ? mats.stone : frame;
    box(mats.reveal, glassX - side * 0.08, y, z, 0.1, h * 0.96, w * 0.96);
    const jd = recess * 0.9;
    const jx = glassX + side * jd * 0.45;
    box(mats.reveal, jx, y, z - w / 2 + 0.04, jd, h * 0.96, 0.08);
    box(mats.reveal, jx, y, z + w / 2 - 0.04, jd, h * 0.96, 0.08);
    box(mats.reveal, jx, y + h / 2 - 0.04, z, jd, 0.08, w * 0.96);
    box(mats.reveal, jx, y - h / 2 + 0.04, z, jd, 0.08, w * 0.96);
    const paneW = Math.max(0.2, w - stile * 2.4);
    const paneH = Math.max(0.2, (h - meet - stile * 1.8) * 0.5);
    const up = meet * 0.5 + paneH * 0.5;
    box(mats.glass, glassX, y + up, z, 0.04, paneH, paneW);
    box(mats.glass, glassX, y - up, z, 0.04, paneH, paneW);
    box(frame, frameX, y, z - w / 2, frameD, h + stile, stile);
    box(frame, frameX, y, z + w / 2, frameD, h + stile, stile);
    box(frame, frameX, y + h / 2, z, frameD, stile, w + stile);
    box(frame, frameX, y - h / 2, z, frameD, stile * 0.85, w + stile);
    box(frame, glassX + side * 0.08, y, z, 0.1, meet, w - stile);
    box(sillMat, x + side * (outer + 0.06), y - h / 2 - 0.14, z, 0.55, 0.16, w + 0.8);
    if (arch === "segmental") archHood(archMat, x + side * outer, y + h / 2, z, w + 0.24, (w + 0.24) * 0.26, "x");
    else if (arch === "round") archHood(archMat, x + side * outer, y + h / 2 - w * 0.12, z, w + 0.18, (w + 0.18) * 0.5, "x");
    else box(mats.stone, x + side * outer, y + h / 2 + 0.16, z, 0.4, 0.2, w + 0.5);
    if (shutters) {
      const sw = Math.min(0.42, w * 0.3);
      box(mats.shutter, x + side * (outer - 0.05), y, z - w / 2 - sw * 0.7, 0.1, h * 0.88, sw);
      box(mats.shutter, x + side * (outer - 0.05), y, z + w / 2 + sw * 0.7, 0.1, h * 0.88, sw);
    }
  };

  const paneledDoor = (x, z, w, h, transom = true) => {
    const cy = 0.35 + h / 2;
    box(mats.trim, x, cy, z - 0.02, w + 0.36, h + 0.28, 0.16);
    box(mats.trimDark, x, cy - h * 0.04, z + 0.05, w * 0.82, h * 0.82, 0.12);
    box(mats.trim, x, cy - h * 0.22, z + 0.12, w * 0.52, h * 0.28, 0.045);
    box(mats.trim, x, cy + h * 0.16, z + 0.12, w * 0.52, h * 0.22, 0.045);
    box(mats.trim, x, cy - h * 0.02, z + 0.12, w * 0.08, h * 0.7, 0.04);
    if (transom) {
      box(mats.glass, x, 0.35 + h + 0.42, z + 0.06, w * 0.7, 0.62, 0.05);
      box(mats.trim, x, 0.35 + h + 0.42, z + 0.1, 0.07, 0.62, 0.04);
      box(mats.stone, x, 0.35 + h + 0.86, z + 0.08, w + 0.4, 0.26, 0.22);
    }
  };

  const dentilCourse = (y, z, width, size = {}) => {
    const dw = size.w ?? 0.26;
    const dh = size.h ?? 0.28;
    const dd = size.d ?? 0.26;
    const gap = size.gap ?? 0.9;
    const mat = size.mat || mats.trim;
    const n = Math.max(6, Math.round(width / gap));
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + (width * (i + 0.5)) / n;
      box(mat, x, y, z, dw, dh, dd);
    }
  };

  const bracketRow = (y, z, width, mat = mats.trimDark) => {
    const n = Math.max(4, Math.round(width / 3.4));
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + 0.5 + ((width - 1) * i) / Math.max(1, n - 1);
      box(mat, x, y - 0.15, z + 0.28, 0.36, 0.32, 0.78);
      box(mat, x, y - 0.72, z + 0.08, 0.3, 0.9, 0.32);
      box(mat, x, y - 0.45, z + 0.24, 0.28, 0.28, 0.36);
    }
  };

  const drawAwning = (width, fz, y = 10.2) => {
    localBox(mats.awning, 0, y, fz + 2.15, width, 0.12, 4.4, -0.42);
    localBox(mats.awningShade, 0, y - 0.1, fz + 2.15, width * 0.98, 0.05, 4.15, -0.42);
    box(mats.awningShade, 0, y - 0.72, fz + 4.05, width, 0.55, 0.1);
  };

  const chimneyStack = (mat, x, y, z, w, h, d) => {
    box(mat, x, y, z, w, h, d);
    const top = y + h / 2;
    box(mats.stone, x, top + 0.16, z, w + 0.46, 0.28, d + 0.46);
    box(mat, x, top + 0.48, z, w * 0.62, 0.4, d * 0.62);
  };

  const downspouts = (width, depth, wallH) => {
    for (const side of [-1, 1]) {
      const x = side * (width / 2 - 0.15);
      const z = depth / 2 + 0.22;
      box(mats.metal, x, wallH * 0.48, z, 0.16, wallH * 0.9, 0.16);
      box(mats.metal, x, 0.4, z + 0.35, 0.16, 0.16, 0.7);
    }
  };

  // Unnamed shops on Main, Hail, and Hurst. Bay width follows the street photographs:
  // a brick front is about twelve feet to a window, a false front about fourteen.
  // Door side alternates so the row is not a repeated stamp. No proprietor is painted on.
  const drawStreetFront = (b, wallH, frame, groundOnly = false) => {
    const fz = b.depth / 2 + 0.14;
    const bays = frame
      ? Math.max(2, Math.min(3, Math.round(b.width / 14)))
      : Math.max(2, Math.min(4, Math.round(b.width / 12)));
    const gap = b.width / bays;
    const arch = frame ? "flat" : "segmental";
    const archMat = frame ? mats.trim : mats.voussoir;
    const doorAt = idHash(b.id) % 2 === 0 ? bays - 1 : 0;
    const winW = Math.min(frame ? 3.4 : 4.6, Math.max(2.4, gap * 0.46));
    if (b.stories > 1 && !groundOnly) {
      box(mats.stone, 0, wallH * 0.5, fz + 0.01, b.width * 0.94, 0.22, 0.12);
      for (let col = 0; col < bays; col++) {
        const x = -b.width / 2 + gap * (col + 0.5);
        frontSash(x, wallH * 0.72, fz, winW, b.stories > 2 ? 5.4 : 6.8, arch, false, archMat, frame);
        if (b.stories > 2) frontSash(x, wallH * 0.42, fz, winW, 5.6, arch, false, archMat, frame);
      }
    }
    if (!frame && !groundOnly) {
      box(mats.trim, 0, wallH - 0.15, fz + 0.05, b.width + 0.5, 0.55, 0.55);
      dentilCourse(wallH - 0.7, fz + 0.22, b.width);
      bracketRow(wallH - 0.85, fz, b.width);
    }
    for (let col = 0; col < bays; col++) {
      const x = -b.width / 2 + gap * (col + 0.5);
      if (col === doorAt) {
        const dw = Math.min(3.5, gap - 0.8);
        paneledDoor(x, fz, dw, 7.2);
      } else {
        const gw = Math.min(frame ? 5.4 : 7.2, gap - 0.9);
        box(mats.trimDark, x, 1.05, fz, gw, 1.35, 0.2);
        box(mats.reveal, x, 5.05, fz - 0.04, gw * 0.9, 5.4, 0.12);
        box(mats.glass, x, 5.05, fz + 0.02, gw * 0.82, 5.1, 0.06);
        box(mats.trim, x, 5.05, fz + 0.1, gw + 0.16, 5.7, 0.08);
        box(mats.trim, x, 5.05, fz + 0.14, 0.08, 5.0, 0.04);
        box(mats.glass, x, 8.15, fz + 0.02, gw * 0.82, 0.62, 0.05);
        box(mats.stone, x, 8.55, fz + 0.1, gw + 0.2, 0.22, 0.2);
        if (!frame) {
          box(mats.trimDark, x - gw / 2 - 0.15, 4.8, fz + 0.12, 0.28, 8.4, 0.22);
          box(mats.trimDark, x + gw / 2 + 0.15, 4.8, fz + 0.12, 0.28, 8.4, 0.22);
          box(mats.stone, x - gw / 2 - 0.15, 0.55, fz + 0.16, 0.4, 0.7, 0.28);
          box(mats.stone, x + gw / 2 + 0.15, 0.55, fz + 0.16, 0.4, 0.7, 0.28);
          box(mats.trim, x - gw / 2 - 0.15, 8.85, fz + 0.16, 0.42, 0.32, 0.3);
          box(mats.trim, x + gw / 2 + 0.15, 8.85, fz + 0.16, 0.42, 0.32, 0.3);
        }
      }
    }
    if (b.stories > 1) drawAwning(b.width * 0.9, fz, 10.6);
    if (groundOnly) return;
    const party = b.party || [];
    for (const side of [-1, 1]) {
      if (party.includes(side === -1 ? "left" : "right")) continue;
      const x = side * (b.width / 2 + 0.08);
      const rows = Math.max(1, Math.floor(b.depth / 18));
      for (let i = 0; i < rows; i++) {
        const z = -b.depth / 2 + ((i + 0.5) * b.depth) / rows;
        if (b.stories > 1) sideSash(x, wallH * 0.7, z, side, 2.3, 5.2, arch, false, archMat);
      }
    }
  };

  // A front taken from a photograph: bay count, arch shape, cornice, storefront, porch.
  const drawFacade = (b, wallH) => {
    const f = b.facade;
    const fz = b.depth / 2 + 0.14;
    const bays = Math.max(1, f.bays || 3);
    const upperBays = Math.max(1, f.upperBays || bays);
    const gap = b.width / bays;
    const upperGap = b.width / upperBays;
    const arch = f.arches || "flat";
    const archMat = f.hood === "cream" ? mats.siding.cream : f.hood === "white" ? mats.siding.white : arch === "flat" ? mats.stone : mats.voussoir;
    const doorAt =
      f.door === "center" ? Math.floor((bays - 1) / 2) : f.door === "left" ? 0 : f.door === "none" ? -1 : bays - 1;
    const winW = Math.min(6.2, Math.max(2.2, upperGap * 0.52));
    const winH = b.stories > 2 ? 6.1 : f.tall ? 8.6 : 7.3;
    const plate = f.storefront === "plate";
    if (b.stories > 1 && f.ground !== "keep") box(mats.stone, 0, wallH * 0.5, fz + 0.01, b.width * 0.96, 0.26, 0.14);
    if (f.ground !== "keep") {
      for (let col = 0; col < bays; col++) {
        const x = -b.width / 2 + gap * (col + 0.5);
        const gw = Math.max(2.8, gap - (f.storefront === "iron" || plate ? 0.55 : 1.4));
        if (col === doorAt) {
          const dw = f.door === "center" ? Math.min(5.0, gap - 0.7) : Math.min(3.6, gap - 0.55);
          paneledDoor(x, fz, dw, plate ? 8.2 : 7.4, true);
          if (f.door === "center") box(mats.trim, x, 4.15, fz + 0.16, 0.1, 6.6, 0.04);
        } else if (plate) {
          box(mats.siding.white, x, 0.7, fz, gw, 1.15, 0.18);
          box(mats.glass, x, 5.4, fz + 0.04, gw * 0.92, 7.6, 0.06);
          box(mats.trim, x, 5.4, fz + 0.1, 0.08, 7.4, 0.04);
        } else {
          box(f.brickBase ? brickOf(b) : mats.trimDark, x, f.brickBase ? 1.45 : 1.1, fz, gw, f.brickBase ? 2.5 : 1.45, 0.2);
          box(mats.reveal, x, 5.15, fz - 0.04, gw * 0.9, 5.4, 0.12);
          box(mats.glass, x, 5.15, fz + 0.02, gw * 0.84, 5.15, 0.06);
          box(mats.trim, x, 5.15, fz + 0.1, gw + 0.16, 5.7, 0.08);
          box(mats.trim, x, 5.15, fz + 0.14, 0.08, 5.0, 0.04);
          box(mats.glass, x, 8.25, fz + 0.02, gw * 0.84, 0.66, 0.05);
          box(mats.stone, x, 8.7, fz + 0.1, gw + 0.22, 0.24, 0.22);
          if (f.storefront === "iron") {
            box(mats.trimDark, x - gw / 2 - 0.14, 4.9, fz + 0.12, 0.26, 8.6, 0.22);
            box(mats.trimDark, x + gw / 2 + 0.14, 4.9, fz + 0.12, 0.26, 8.6, 0.22);
            box(mats.stone, x - gw / 2 - 0.14, 0.55, fz + 0.16, 0.38, 0.7, 0.28);
            box(mats.stone, x + gw / 2 + 0.14, 0.55, fz + 0.16, 0.38, 0.7, 0.28);
            box(mats.trim, x - gw / 2 - 0.14, 9.05, fz + 0.16, 0.4, 0.3, 0.28);
            box(mats.trim, x + gw / 2 + 0.14, 9.05, fz + 0.16, 0.4, 0.3, 0.28);
          }
        }
      }
    }
    if (b.stories > 1) {
      const fill = f.upperFill === "russet" ? mats.siding.darkred : null;
      for (let col = 0; col < upperBays; col++) {
        const x = -b.width / 2 + upperGap * (col + 0.5);
        frontSash(x, wallH * 0.72, fz, winW, winH, arch, false, archMat);
        if (fill) box(fill, x, wallH * 0.72, fz + 0.1, winW * 0.7, winH * 0.72, 0.08);
        if (b.stories > 2) frontSash(x, wallH * 0.45, fz, winW * 0.92, winH * 0.86, arch, false, archMat);
      }
    }
    if (f.cornice === "bracket" || f.cornice === "plain" || f.cornice === "corbel") {
      box(mats.trim, 0, wallH + 0.35, fz + 0.55, b.width + 1.3, 0.95, 1.35);
      box(mats.trim, 0, wallH - 0.35, fz + 0.28, b.width + 0.4, 0.42, 0.7);
      dentilCourse(wallH - 0.15, fz + 0.85, b.width);
      if (f.cornice === "bracket" || f.cornice === "corbel") bracketRow(wallH - 0.85, fz + 0.2, b.width);
      if (f.cornice === "corbel") {
        box(brickOf(b), 0, wallH - 1.55, fz + 0.42, b.width, 0.55, 0.55);
        box(brickOf(b), 0, wallH - 2.15, fz + 0.22, b.width * 0.98, 0.4, 0.38);
      }
    }
    if (f.pilasters) {
      for (const x of [-b.width / 2 + 0.4, b.width / 2 - 0.4]) {
        box(mats.trim, x, wallH * 0.48, fz + 0.35, 0.85, wallH * 0.9, 0.7);
        box(mats.stone, x, 0.7, fz + 0.42, 1.15, 1.2, 0.9);
        box(mats.trim, x, wallH * 0.92, fz + 0.48, 1.2, 0.55, 0.95);
      }
    }
    if (f.pentRoof) {
      localBox(mats.roofSlate, 0, 10.5, fz + 2.3, b.width * 0.98, 0.2, 5.4, -0.38);
      box(mats.trimDark, 0, 9.55, fz + 0.2, b.width, 0.28, 0.35);
    } else if (f.awning) drawAwning(b.width * 0.9, fz);
    if (f.stripedCanopy) {
      const canopyW = b.width * 0.36;
      const origin = b.width / 2 - canopyW / 2 - 0.3;
      const stripes = 7;
      const sw = canopyW / stripes;
      for (let i = 0; i < stripes; i++) {
        const sx = origin - canopyW / 2 + sw * (i + 0.5);
        localBox(i % 2 ? mats.siding.white : mats.siding.red, sx, 10.7, fz + 2.15, sw * 0.98, 0.1, 4.6, -0.3);
      }
      box(mats.trimDark, origin, 10.15, fz + 4.2, canopyW, 0.16, 0.16);
    }
    if (f.posts) {
      const z = b.depth / 2 + 3.1;
      const n = Math.max(2, bays);
      for (let i = 0; i <= n; i++) {
        const x = -b.width / 2 + (b.width * i) / n;
        box(mats.trimDark, x, 5.1, z, 0.34, 10, 0.34);
      }
    }
    if (f.shedPorch) {
      const z = b.depth / 2 + 3.3;
      box(mats.plank, 0, 0.55, z, b.width * 0.94, 0.28, 6.2);
      localBox(mats.roofDark, 0, 9.3, z + 0.2, b.width + 0.4, 0.16, 6.6, -0.2);
      for (let i = 0; i <= bays; i++) {
        const x = -b.width / 2 + (b.width * i) / bays;
        box(mats.trimDark, x, 4.7, z + 2.5, 0.38, 8.2, 0.38);
      }
    }
    const party = b.party || [];
    const sideCount = f.sideBays || 0;
    for (const side of [-1, 1]) {
      if (!sideCount) break;
      if (party.includes(side === -1 ? "left" : "right")) continue;
      const x = side * (b.width / 2 + 0.1);
      for (let i = 0; i < sideCount; i++) {
        const z = -b.depth / 2 + ((i + 0.6) * b.depth) / (sideCount + 0.5);
        if (b.stories > 1) sideSash(x, wallH * 0.68, z, side, 2.5, 4.8, arch, false, archMat);
      }
    }
  };

  // One smooth clapboard triangle, a horizontal cornice with returns, and
  // raking boards that lie on the two slopes. The old courses were a ziggurat,
  // and a rake rotated by side * tilt ran up the wrong diagonal.
  const drawPediment = (mat, width, rise, yBase, z, xShift = 0) => {
    const thick = 0.7;
    const feet = mat?.userData?.uvFeet || { u: 8, v: 3.2 };
    const zf = z + thick / 2;
    const zb = z - thick / 2;
    const y0 = yBase;
    const y1 = yBase + rise;
    const x0 = -width / 2;
    const x1 = width / 2;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const push = (x, y, zz, nx, ny, nz) => {
      positions.push(x + xShift, y, zz);
      normals.push(nx, ny, nz);
      uvs.push((x - x0) / feet.u, (y - y0) / feet.v);
      return positions.length / 3 - 1;
    };
    const tri = (a, b, c) => indices.push(a, b, c);
    const fl = push(x0, y0, zf, 0, 0, 1);
    const fr = push(x1, y0, zf, 0, 0, 1);
    const fp = push(0, y1, zf, 0, 0, 1);
      tri(fl, fr, fp);
    const bl = push(x0, y0, zb, 0, 0, -1);
    const bp = push(0, y1, zb, 0, 0, -1);
    const br = push(x1, y0, zb, 0, 0, -1);
    tri(bl, bp, br);
    const slope = Math.hypot(width / 2, rise);
    const s = rise / slope;
    const c = width / 2 / slope;
    {
      const nx = -s;
      const ny = c;
      const a = push(x0, y0, zf, nx, ny, 0);
      const b = push(0, y1, zf, nx, ny, 0);
      const d = push(0, y1, zb, nx, ny, 0);
      const e = push(x0, y0, zb, nx, ny, 0);
      tri(a, b, d);
      tri(a, d, e);
    }
    {
      const nx = s;
      const ny = c;
      const a = push(x1, y0, zf, nx, ny, 0);
      const b = push(x1, y0, zb, nx, ny, 0);
      const d = push(0, y1, zb, nx, ny, 0);
      const e = push(0, y1, zf, nx, ny, 0);
      tri(a, b, e);
      tri(b, d, e);
    }
    {
      const a = push(x0, y0, zf, 0, -1, 0);
      const b = push(x0, y0, zb, 0, -1, 0);
      const d = push(x1, y0, zb, 0, -1, 0);
      const e = push(x1, y0, zf, 0, -1, 0);
      tri(a, b, d);
      tri(a, d, e);
    }
    const face = new THREE.BufferGeometry();
    face.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    face.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    face.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    face.setIndex(indices);
    face.applyMatrix4(buildingMatrix);
    put(mat, face);

    box(mats.trim, 0, yBase - 0.42, z + 0.02, width + 0.35, 0.72, 0.48);
    box(mats.trim, 0, yBase + 0.12, z + 0.28, width + 1.15, 0.5, 1.2);
    dentilCourse(yBase - 0.08, z + 0.48, width * 0.94);
    for (const side of [-1, 1]) {
      box(mats.trim, side * (width / 2 + 0.05), yBase + 0.12, z - 0.85, 0.72, 0.5, 1.7);
      box(mats.trimDark, side * (width / 2 - 0.35), yBase - 0.95, z + 0.32, 0.32, 1.15, 0.55);
    }
    const tilt = Math.atan2(rise, width / 2);
    const length = slope + 0.12;
    const rakeZ = zf + 0.04;
    const rakes = [
      [tilt, -width / 4],
      [Math.PI - tilt, width / 4],
    ];
    for (const [angle, x] of rakes) {
      const rake = new THREE.BoxGeometry(length, 0.46, 0.32);
      scaleBoxUVs(rake, length, 0.46, 0.32, mats.trim);
      rake.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
      rake.applyMatrix4(new THREE.Matrix4().makeTranslation(x, yBase + rise / 2, rakeZ));
      rake.applyMatrix4(buildingMatrix);
      put(mats.trim, rake);
    }
  };

  // Square false front with a projecting cornice. A few carry a small smooth
  // center pediment. No stacked steps and no block arches.
  const drawFalseFront = (b, wallH, body) => {
    const fz = b.depth / 2 + 0.18;
    const style = idHash(b.id) % 7;
    const parapetH = 4.8;
    box(body, 0, wallH + parapetH / 2 - 0.35, fz - 0.08, b.width + 0.55, parapetH, 1.2);
    box(mats.trim, 0, wallH + parapetH - 0.2, fz + 0.08, b.width + 1.05, 0.42, 1.55);
    box(mats.trim, 0, wallH + 0.42, fz + 0.16, b.width + 0.7, 0.78, 0.72);
    dentilCourse(wallH + 0.05, fz + 0.42, b.width * 0.96);
    bracketRow(wallH - 0.15, fz + 0.02, b.width);
    for (const side of [-1, 1]) {
      box(body, side * (b.width / 2 + 0.05), wallH + parapetH / 2 - 0.35, fz - 1.15, 0.7, parapetH, 2.2);
      box(mats.trim, side * (b.width / 2 + 0.08), wallH + 0.42, fz - 0.85, 0.7, 0.78, 1.5);
    }
    if (style === 4) {
      drawPediment(body, b.width * 0.4, 3.1, wallH + parapetH - 0.05, fz + 0.12);
    }
  };

  const cornerBoards = (b, wallH) => {
    const party = b.party || [];
    const fz = b.depth / 2 + 0.12;
    if (!party.includes("left")) box(mats.trim, -b.width / 2, wallH / 2, fz, 0.42, wallH, 0.3);
    if (!party.includes("right")) box(mats.trim, b.width / 2, wallH / 2, fz, 0.42, wallH, 0.3);
  };

  const dressFront = (b) => {
    if (b.facade?.shedPorch || b.porch) return;
    const h = idHash(`${b.id}:dress`);
    const fz = b.depth / 2;
    if (h % 3 !== 0) {
      const z = fz + 2.35;
      const span = Math.min(Math.max(8, b.width * 0.62), 16);
      box(mats.trimDark, -span / 2, 1.65, z, 0.26, 3.1, 0.26);
      box(mats.trimDark, span / 2, 1.65, z, 0.26, 3.1, 0.26);
      box(mats.trimDark, 0, 3.1, z, span, 0.2, 0.2);
    }
    const side = h % 2 === 0 ? -1 : 1;
    const x = side * (b.width / 2 - 1.7);
    if (h % 2 === 0) {
      box(mats.siding.tan, x, 1.1, fz + 1.25, 1.45, 2.15, 1.45);
      box(mats.metal, x, 1.55, fz + 1.25, 1.52, 0.08, 1.52);
      box(mats.metal, x, 0.7, fz + 1.25, 1.52, 0.08, 1.52);
      if (h % 4 === 0) {
        box(mats.siding.tan, x + side * 1.4, 0.95, fz + 1.85, 1.25, 1.85, 1.25);
        box(mats.metal, x + side * 1.4, 1.3, fz + 1.85, 1.32, 0.07, 1.32);
      }
    } else {
      box(mats.plank, x, 0.85, fz + 1.3, 1.7, 1.6, 1.5);
      box(mats.plank, x - side * 0.4, 2.15, fz + 1.45, 1.35, 1.15, 1.2);
    }
  };

  const rearShed = (b, body) => {
    const z = -b.depth / 2 - 3.5;
    const w = Math.min(b.width * 0.58, 18);
    box(body, 0, 4.1, z, w, 7.4, 7);
    localBox(mats.roofDark, 0, 8.05, z + 0.15, w + 0.8, 0.16, 8, 0.16);
    box(mats.trimDark, 0, 3.1, z + 3.6, Math.min(4.2, w * 0.4), 5.2, 0.12);
  };

  // Ground floor and upstairs windows copied from the Ball Bros. corner photograph.
  const drawPeakedStorefront = (b, wallH) => {
    const fz = b.depth / 2 + 0.16;
    const gap = b.width / 3;
    for (let col = 0; col < 3; col++) {
      const x = -b.width / 2 + gap * (col + 0.5);
      frontSash(x, wallH * 0.62, fz, Math.min(3.5, gap - 2.6), 5.6, "flat");
    }
    const winW = Math.min(6.4, gap - 1.5);
    for (const x of [-gap, gap]) {
      box(mats.trimDark, x, 1.15, fz, winW, 1.5, 0.22);
      box(mats.glass, x, 5.15, fz, winW, 6.2, 0.12);
      box(mats.trim, x, 5.15, fz + 0.08, winW + 0.35, 6.5, 0.1);
      box(mats.trim, x, 5.15, fz + 0.16, 0.1, 6.0, 0.06);
      box(mats.trim, x, 5.15, fz + 0.16, winW, 0.1, 0.06);
    }
    box(mats.trimDark, 0, 4.3, fz, 5.1, 8.2, 0.24);
    box(mats.trim, 0, 4.2, fz + 0.14, 0.14, 7.6, 0.08);
    box(mats.glass, -1.15, 6.15, fz + 0.16, 1.5, 2.3, 0.05);
    box(mats.glass, 1.15, 6.15, fz + 0.16, 1.5, 2.3, 0.05);
    box(mats.trim, 0, 8.55, fz + 0.08, 5.5, 0.45, 0.12);
    const porchZ = b.depth / 2 + 3.4;
    box(mats.plank, 0, 0.42, porchZ, b.width * 0.96, 0.22, 6.4);
    localBox(mats.roofDark, 0, 9.15, porchZ + 0.15, b.width + 0.8, 0.16, 6.8, -0.22);
    for (const x of [-b.width / 2 + 0.4, -2.4, 2.4, b.width / 2 - 0.4]) {
      box(mats.trimDark, x, 4.7, porchZ + 2.7, 0.36, 8.6, 0.36);
    }
    const party = b.party || [];
    const sideCount = b.facade?.sideBays || 0;
    for (const side of [-1, 1]) {
      if (!sideCount) break;
      if (party.includes(side === -1 ? "left" : "right")) continue;
      const x = side * (b.width / 2 + 0.1);
      for (let i = 0; i < sideCount; i++) {
        const z = -b.depth / 2 + ((i + 0.6) * b.depth) / (sideCount + 0.5);
        sideSash(x, wallH * 0.62, z, side, 2.6, 5.2, "flat");
      }
    }
  };

  const tiled = (mat, tilesU, tilesV) => {
    const copy = mat.clone();
    for (const key of ["map", "normalMap", "roughnessMap"]) {
      if (!mat[key]) continue;
      copy[key] = mat[key].clone();
      copy[key].wrapS = copy[key].wrapT = THREE.RepeatWrapping;
      copy[key].repeat.set(Math.max(0.2, tilesU), Math.max(0.2, tilesV));
    }
    if (copy.map) copy.map.colorSpace = THREE.SRGBColorSpace;
    if (copy.normalMap) copy.normalMap.colorSpace = THREE.LinearSRGBColorSpace;
    if (copy.roughnessMap) copy.roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;
    return copy;
  };

  const begin = (x, z, facing, extraDeg = 0) => {
    const rot = (FACING[facing] ?? 0) + THREE.MathUtils.degToRad(extraDeg || 0);
    buildingMatrix.compose(
      new THREE.Vector3(x, 0, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    return rot;
  };

  const paintOf = (b) => mats.siding[b.paint] || mats.siding.cream;
  const brickOf = (b) => mats.brick[b.brick] || mats.brick.red;

  const gable = (width, depth, rise, yBase, mat = mats.roof) => {
    const run = depth / 2 + 1.1;
    const slopeLen = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run);
    const roofW = width + 2.2;
    for (const sign of [1, -1]) {
      const geo = new THREE.BoxGeometry(roofW, 0.5, slopeLen);
      scaleBoxUVs(geo, roofW, 0.5, slopeLen, mat);
      const local = new THREE.Matrix4().makeRotationX(sign * angle);
      local.premultiply(new THREE.Matrix4().makeTranslation(0, yBase + rise / 2, sign * (run / 2)));
      geo.applyMatrix4(local);
      geo.applyMatrix4(buildingMatrix);
      put(mat, geo);
    }
  };

  const footprint = (b) => {
    const w = b.width;
    const d = b.depth;
    const rot = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const xs = [];
    const zs = [];
    for (const lx of [-w / 2, w / 2]) {
      for (const lz of [-d / 2, d / 2]) {
        xs.push(b.x + lx * c + lz * s);
        zs.push(b.z - lx * s + lz * c);
      }
    }
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    };
  };

  const punch = (width, depth, stories, floorH, wallH, party, commercial, shutters = false) => {
    const fz = depth / 2 + 0.12;
    const cols = Math.max(2, Math.round(width / (commercial ? 9 : 11)));
    const gap = width / cols;
    const doorCol = Math.floor(cols / 2);
    const winW = Math.min(2.7, Math.max(1.8, gap * 0.42));
    for (let col = 0; col < cols; col++) {
      const x = -width / 2 + gap * (col + 0.5);
      if (commercial && col === cols - 1) {
        paneledDoor(x, fz, Math.min(3.2, gap - 0.8), 7.2);
      } else if (commercial) {
        const gw = Math.min(6.2, gap - 1.2);
        box(mats.reveal, x, 5.4, fz - 0.04, gw, 6.2, 0.12);
        box(mats.glass, x, 5.4, fz + 0.02, gw * 0.86, 5.6, 0.06);
        box(mats.trim, x, 5.4, fz + 0.1, gw + 0.16, 6.4, 0.08);
        box(mats.trim, x, 5.4, fz + 0.14, 0.08, 5.4, 0.04);
      } else if (col !== doorCol) {
        frontSash(x, 5.1, fz, winW, 4.6, "flat", shutters, mats.trim, shutters);
      }
      for (let s = 1; s < stories; s++) {
        const y = s * floorH + floorH * 0.55;
        if (y > wallH - 1.5) continue;
        frontSash(x, y, fz, winW, Math.min(4.8, floorH * 0.55), "flat", shutters, mats.trim, shutters);
      }
    }
    for (const side of [-1, 1]) {
      const key = side === -1 ? "left" : "right";
      if (party.includes(key)) continue;
      const x = side * (width / 2 + 0.08);
      const rows = Math.max(1, Math.floor(depth / 14));
      for (let i = 0; i < rows; i++) {
        const z = -depth / 2 + ((i + 0.5) * depth) / rows;
        for (let s = commercial ? 1 : 0; s < stories; s++) {
          const y = s * floorH + floorH * 0.55;
          if (y < 3 || y > wallH - 1) continue;
          sideSash(x, y, z, side, 2.2, 4.2, "flat", shutters);
        }
      }
    }
  };

  const signFor = (b, wallH) => {
    if (!b.sign) return;
    const rot = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
    const outward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    if (b.facade?.signBand) {
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      const canopy = b.facade.stripedCanopy ? b.width * 0.34 : 0;
      const width = Math.max(8, b.width - canopy - 1.4);
      signs.push({
        title: b.sign,
        subtitle: "",
        style: "band",
        position: new THREE.Vector3(b.x, 10.5, b.z).addScaledVector(outward, b.depth / 2 + 0.7).addScaledVector(right, -canopy / 2),
        rotation: rot,
        width,
      });
      return;
    }
    // A peaked false front carries its name in the gable, where the 1880s photograph puts BALL BROS.
    const peaked = b.facade?.peak;
    const depot = b.kind === "depot";
    const hendee = b.id === "hendee-house-26";
    const y = peaked
      ? b.stories * 12 + 6.5
      : hendee
        ? wallH - 2.6
        : depot
          ? 13.2
          : Math.min(wallH - 1.2, b.stories * 8 + 4);
    const reach = peaked ? b.depth / 2 + 0.55 : depot ? b.depth / 2 + 5.5 : b.depth / 2 + 0.55;
    signs.push({
      title: b.sign,
      subtitle: b.facade?.sign2 || (peaked || depot || hendee ? "" : b.confidence === "sourced" ? b.use : ""),
      style: peaked ? "painted" : "board",
      position: new THREE.Vector3(b.x, y, b.z).addScaledVector(outward, reach),
      rotation: rot,
      width: peaked
        ? Math.min(b.width * 0.36, 10.5)
        : depot
          ? 16
          : hendee
            ? 22
            : Math.min(Math.max(b.width * 0.62, 10), 28),
    });
    if (b.facade?.sign3) {
      signs.push({
        title: b.facade.sign3,
        subtitle: "",
        style: "board",
        position: new THREE.Vector3(b.x, y - 3.4, b.z).addScaledVector(outward, reach),
        rotation: rot,
        width: Math.min(Math.max(b.width * 0.7, 12), 36),
      });
    }
    if (b.facade?.upperSign) {
      signs.push({
        title: b.facade.upperSign,
        subtitle: "",
        style: "board",
        position: new THREE.Vector3(b.x, y + 4.2, b.z).addScaledVector(outward, reach),
        rotation: rot,
        width: Math.min(b.width * 0.46, 14),
      });
    }
  };

  const addStudBarn = (b) => {
    const body = mats.siding.white;
    const wall = b.stories > 1 ? 22 : 16;
    box(body, 0, wall / 2, 0, b.width, wall, b.depth);
    gable(b.width, b.depth, b.depth > 40 ? 10 : 6, wall, mats.roofDark);
    if (b.facade?.cupolas) {
      for (const x of [-b.width * 0.22, b.width * 0.22]) {
        box(body, x, wall + 6, 0, 4, 6, 4);
        const cap = new THREE.ConeGeometry(3.2, 4, 4);
        cap.rotateY(Math.PI / 4);
        cap.applyMatrix4(new THREE.Matrix4().makeTranslation(x, wall + 11, 0));
        cap.applyMatrix4(buildingMatrix);
        put(mats.roofDark, cap);
        if (b.facade.flags !== false) box(mats.trim, x, wall + 13.4, 0, 0.15, 3.2, 0.15);
      }
    }
    if (b.facade?.paddock) {
      const fence = (x, z, w, d) => {
        box(mats.trimDark, x, 2.2, z, w, 0.15, 0.15);
        box(mats.trimDark, x, 3.6, z, w, 0.12, 0.12);
      };
      fence(0, b.depth / 2 + 28, b.width + 80, 0.2);
      fence(0, b.depth / 2 + 70, b.width + 80, 0.2);
      for (const x of [-(b.width + 80) / 2, (b.width + 80) / 2]) {
        box(mats.trimDark, x, 2.2, b.depth / 2 + 49, 0.15, 0.15, 42);
        box(mats.trimDark, x, 3.6, b.depth / 2 + 49, 0.12, 0.12, 42);
      }
      box(mats.dirt, 0, 0.08, b.depth / 2 + 18, 12, 0.08, 50);
      for (let i = 0; i < 6; i++) {
        const spot = new THREE.Vector3(-b.width * 0.7 + i * 14, 0, -b.depth / 2 - 16);
        spot.applyMatrix4(buildingMatrix);
        extraTrees.push({ x: spot.x, z: spot.z, kind: "maple", scale: 1.1 });
      }
    }
    signFor(b, wall * 0.62);
    return wall + 12;
  };

  const addHoseTower = (b) => {
    const body = mats.brick.red;
    box(body, 0, 6, 0, b.width, 12, b.depth);
    box(mats.trimDark, 0, 4.5, b.depth / 2 + 0.12, 3.4, 7, 0.14);
    box(body, 0, 28, 0, 8, 32, 8);
    for (const side of [-1, 1]) {
      box(mats.trim, side * 4.1, 28, 0, 0.2, 10, 3.2);
      box(mats.trim, 0, 28, side * 4.1, 3.2, 10, 0.2);
    }
    box(mats.roofDark, 0, 46, 0, 10, 0.4, 10);
    const cap = new THREE.ConeGeometry(6.5, 8, 4);
    cap.rotateY(Math.PI / 4);
    cap.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 50, 0));
    cap.applyMatrix4(buildingMatrix);
    put(mats.roofDark, cap);
    signFor(b, 10);
    return 54;
  };

  const addCrossingShanty = (b) => {
    const body = paintOf(b);
    box(body, 0, 5, 0, b.width, 10, b.depth);
    gable(b.width, b.depth, 3.2, 10, mats.roofDark);
    box(mats.trimDark, 0, 4.2, b.depth / 2 + 0.1, 2.4, 6.4, 0.12);
    box(mats.trunk, b.width / 2 + 6, 8, 2, 0.5, 16, 0.5);
    box(mats.trim, b.width / 2 + 14, 14.5, 2, 16, 0.35, 0.35);
    signFor(b, 8);
    return 14;
  };

  // Wood-shingle roofs. "side" ridges run across the front. "front" ridges run back from the street.
  const gableAt = (width, depth, rise, yBase, mat, ox, oz) => {
    const run = depth / 2 + 1.15;
    const slopeLen = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run);
    const roofW = width + 1.8;
    for (const sign of [1, -1]) {
      const geo = new THREE.BoxGeometry(roofW, 0.4, slopeLen);
      scaleBoxUVs(geo, roofW, 0.4, slopeLen, mat);
      const local = new THREE.Matrix4().makeRotationX(sign * angle);
      local.premultiply(new THREE.Matrix4().makeTranslation(ox, yBase + rise / 2, oz + sign * (run / 2)));
      geo.applyMatrix4(local);
      geo.applyMatrix4(buildingMatrix);
      put(mat, geo);
    }
  };

  const gableFrontAt = (width, depth, rise, yBase, mat, ox, oz) => {
    const run = width / 2 + 1.15;
    const slopeLen = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run);
    const roofD = depth + 1.8;
    for (const sign of [1, -1]) {
      const geo = new THREE.BoxGeometry(slopeLen, 0.4, roofD);
      scaleBoxUVs(geo, slopeLen, 0.4, roofD, mat);
      const local = new THREE.Matrix4().makeRotationZ(-sign * angle);
      local.premultiply(new THREE.Matrix4().makeTranslation(ox + sign * (run / 2), yBase + rise / 2, oz));
      geo.applyMatrix4(local);
      geo.applyMatrix4(buildingMatrix);
      put(mat, geo);
    }
  };

  const hipRoof = (width, depth, rise, yBase, mat, ox, oz) => {
    const overhang = 1.05;
    const alongX = width >= depth;
    const long = alongX ? width : depth;
    const short = alongX ? depth : width;
    const sideRun = short / 2 + overhang;
    const slopeLen = Math.hypot(sideRun, rise);
    const angle = Math.atan2(rise, sideRun);
    const ridge = Math.max(1.4, long - short);
    if (alongX) {
      for (const sign of [1, -1]) {
        const geo = new THREE.BoxGeometry(ridge + 0.4, 0.38, slopeLen);
        scaleBoxUVs(geo, ridge, 0.38, slopeLen, mat);
        const local = new THREE.Matrix4().makeRotationX(sign * angle);
        local.premultiply(new THREE.Matrix4().makeTranslation(ox, yBase + rise / 2, oz + sign * (sideRun / 2)));
        geo.applyMatrix4(local);
        geo.applyMatrix4(buildingMatrix);
        put(mat, geo);
      }
      for (const sign of [1, -1]) {
        const geo = new THREE.BoxGeometry(slopeLen, 0.38, short + overhang * 2);
        scaleBoxUVs(geo, slopeLen, 0.38, short, mat);
        const local = new THREE.Matrix4().makeRotationZ(-sign * angle);
        local.premultiply(
          new THREE.Matrix4().makeTranslation(ox + sign * (ridge / 2 + sideRun / 2), yBase + rise / 2, oz),
        );
        geo.applyMatrix4(local);
        geo.applyMatrix4(buildingMatrix);
        put(mat, geo);
      }
    } else {
      for (const sign of [1, -1]) {
        const geo = new THREE.BoxGeometry(slopeLen, 0.38, ridge + 0.4);
        scaleBoxUVs(geo, slopeLen, 0.38, ridge, mat);
        const local = new THREE.Matrix4().makeRotationZ(-sign * angle);
        local.premultiply(new THREE.Matrix4().makeTranslation(ox + sign * (sideRun / 2), yBase + rise / 2, oz));
        geo.applyMatrix4(local);
        geo.applyMatrix4(buildingMatrix);
        put(mat, geo);
      }
      for (const sign of [1, -1]) {
        const geo = new THREE.BoxGeometry(short + overhang * 2, 0.38, slopeLen);
        scaleBoxUVs(geo, short, 0.38, slopeLen, mat);
        const local = new THREE.Matrix4().makeRotationX(sign * angle);
        local.premultiply(
          new THREE.Matrix4().makeTranslation(ox, yBase + rise / 2, oz + sign * (ridge / 2 + sideRun / 2)),
        );
        geo.applyMatrix4(local);
        geo.applyMatrix4(buildingMatrix);
        put(mat, geo);
      }
    }
  };

  // Clapboard filling the triangle under a gable. along "z" faces the street; along "x" is a side wall.
  const clapboardTriangle = (mat, span, rise, yBase, along, at, cx, cz) => {
    const thick = 0.5;
    const feet = mat?.userData?.uvFeet || { u: 8, v: 3.2 };
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const push = (x, y, z, nx, ny, nz) => {
      positions.push(x, y, z);
      normals.push(nx, ny, nz);
      const u = (along === "z" ? x - cx + span / 2 : z - cz + span / 2) / feet.u;
      uvs.push(u, (y - yBase) / feet.v);
      return positions.length / 3 - 1;
    };
    const tri = (a, b, c) => indices.push(a, b, c);
    if (along === "z") {
      const zf = at + thick / 2;
      const zb = at - thick / 2;
      const x0 = cx - span / 2;
      const x1 = cx + span / 2;
      const fl = push(x0, yBase, zf, 0, 0, 1);
      const fr = push(x1, yBase, zf, 0, 0, 1);
      const fp = push(cx, yBase + rise, zf, 0, 0, 1);
      tri(fl, fr, fp);
      const bl = push(x0, yBase, zb, 0, 0, -1);
      const bp = push(cx, yBase + rise, zb, 0, 0, -1);
      const br = push(x1, yBase, zb, 0, 0, -1);
      tri(bl, bp, br);
    } else {
      const xf = at + thick / 2;
      const xb = at - thick / 2;
      const z0 = cz - span / 2;
      const z1 = cz + span / 2;
      const fl = push(xf, yBase, z0, 1, 0, 0);
      const fr = push(xf, yBase, z1, 1, 0, 0);
      const fp = push(xf, yBase + rise, cz, 1, 0, 0);
      tri(fl, fr, fp);
      const bl = push(xb, yBase, z0, -1, 0, 0);
      const bp = push(xb, yBase + rise, cz, -1, 0, 0);
      const br = push(xb, yBase, z1, -1, 0, 0);
      tri(bl, bp, br);
    }
    const face = new THREE.BufferGeometry();
    face.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    face.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    face.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    face.setIndex(indices);
    face.applyMatrix4(buildingMatrix);
    put(mat, face);
  };

  const sashFront = (x, y, z, w, h, lights, shutters, hood) => {
    const stile = Math.max(0.11, w * 0.08);
    const meet = Math.max(0.13, stile * 1.15);
    const recess = 0.4;
    const glassZ = z + 0.04;
    const outerZ = glassZ + recess;
    const frameD = 0.13;
    const frameZ = outerZ - frameD * 0.4;
    box(mats.reveal, x, y, glassZ - 0.09, w * 0.96, h * 0.96, 0.08);
    const jd = recess * 0.9;
    box(mats.reveal, x - w / 2 + 0.035, y, glassZ + jd * 0.48, 0.07, h * 0.96, jd);
    box(mats.reveal, x + w / 2 - 0.035, y, glassZ + jd * 0.48, 0.07, h * 0.96, jd);
    box(mats.reveal, x, y + h / 2 - 0.035, glassZ + jd * 0.48, w * 0.96, 0.07, jd);
    box(mats.reveal, x, y - h / 2 + 0.035, glassZ + jd * 0.48, w * 0.96, 0.07, jd);
    const paneW = Math.max(0.18, w - stile * 2.4);
    const paneH = Math.max(0.18, (h - meet - stile * 1.8) * 0.5);
    const up = meet * 0.5 + paneH * 0.5;
    box(mats.glass, x, y + up, glassZ, paneW, paneH, 0.035);
    box(mats.glass, x, y - up, glassZ, paneW, paneH, 0.035);
    box(mats.trim, x - w / 2, y, frameZ, stile, h + stile, frameD);
    box(mats.trim, x + w / 2, y, frameZ, stile, h + stile, frameD);
    box(mats.trim, x, y + h / 2, frameZ, w + stile, stile, frameD);
    box(mats.trim, x, y - h / 2, frameZ, w + stile, stile * 0.8, frameD);
    box(mats.trim, x, y, glassZ + 0.08, w - stile, meet, 0.1);
    if (lights === "six") {
      for (const yy of [y + up, y - up]) {
        box(mats.trim, x - w * 0.16, yy, glassZ + 0.06, 0.04, paneH * 0.92, 0.05);
        box(mats.trim, x + w * 0.16, yy, glassZ + 0.06, 0.04, paneH * 0.92, 0.05);
      }
    }
    box(mats.trim, x, y - h / 2 - 0.12, outerZ + 0.06, w + 0.55, 0.13, 0.5);
    if (hood) localBox(mats.trim, x, y + h / 2 + 0.3, outerZ + 0.12, w + 0.55, 0.08, 0.72, -0.42);
    else box(mats.trim, x, y + h / 2 + 0.16, outerZ, w + 0.42, 0.14, 0.34);
    if (shutters) {
      const sw = Math.min(0.5, w * 0.36);
      box(mats.shutter, x - w / 2 - sw * 0.56, y, outerZ - 0.06, sw, h * 0.88, 0.06);
      box(mats.shutter, x + w / 2 + sw * 0.56, y, outerZ - 0.06, sw, h * 0.88, 0.06);
    }
  };

  const sashSide = (x, y, z, out, w, h, lights, shutters) => {
    const stile = Math.max(0.1, w * 0.08);
    const meet = Math.max(0.12, stile * 1.1);
    const recess = 0.36;
    const glassX = x + out * 0.04;
    const outer = 0.04 + recess;
    const frameD = 0.12;
    const frameX = x + out * (outer - frameD * 0.4);
    box(mats.reveal, glassX - out * 0.08, y, z, 0.08, h * 0.94, w * 0.94);
    const paneW = Math.max(0.16, w - stile * 2.2);
    const paneH = Math.max(0.16, (h - meet - stile * 1.6) * 0.5);
    const up = meet * 0.5 + paneH * 0.5;
    box(mats.glass, glassX, y + up, z, 0.035, paneH, paneW);
    box(mats.glass, glassX, y - up, z, 0.035, paneH, paneW);
    box(mats.trim, frameX, y, z - w / 2, frameD, h, stile);
    box(mats.trim, frameX, y, z + w / 2, frameD, h, stile);
    box(mats.trim, frameX, y + h / 2, z, frameD, stile, w);
    box(mats.trim, frameX, y - h / 2, z, frameD, stile * 0.8, w);
    box(mats.trim, glassX + out * 0.07, y, z, 0.08, meet, w - stile);
    if (lights === "six") {
      box(mats.trim, glassX + out * 0.06, y + up, z - w * 0.16, 0.04, paneH * 0.9, 0.04);
      box(mats.trim, glassX + out * 0.06, y + up, z + w * 0.16, 0.04, paneH * 0.9, 0.04);
      box(mats.trim, glassX + out * 0.06, y - up, z - w * 0.16, 0.04, paneH * 0.9, 0.04);
      box(mats.trim, glassX + out * 0.06, y - up, z + w * 0.16, 0.04, paneH * 0.9, 0.04);
    }
    box(mats.trim, x + out * (outer + 0.04), y - h / 2 - 0.1, z, 0.42, 0.12, w + 0.4);
    box(mats.trim, x + out * outer, y + h / 2 + 0.12, z, 0.28, 0.12, w + 0.36);
    if (shutters) {
      const sw = Math.min(0.42, w * 0.34);
      box(mats.shutter, x + out * (outer - 0.04), y, z - w / 2 - sw * 0.55, 0.055, h * 0.86, sw);
      box(mats.shutter, x + out * (outer - 0.04), y, z + w / 2 + sw * 0.55, 0.055, h * 0.86, sw);
    }
  };

  const turnedPost = (x, z, top) => {
    const bot = 0.72;
    const cap = top - 0.62;
    const mid = (bot + cap) / 2;
    box(mats.trimDark, x, 0.34, z, 0.5, 0.48, 0.5);
    box(mats.trimDark, x, (bot + mid) / 2 - 0.1, z, 0.2, Math.max(0.8, mid - bot - 0.2), 0.2);
    box(mats.trimDark, x, mid, z, 0.38, 0.32, 0.38);
    box(mats.trimDark, x, (mid + cap) / 2 + 0.1, z, 0.2, Math.max(0.8, cap - mid - 0.2), 0.2);
    box(mats.trimDark, x, top - 0.46, z, 0.36, 0.18, 0.36);
    box(mats.trimDark, x, top - 0.22, z, 0.48, 0.32, 0.48);
  };

  const frontPorch = (x, z, span, depth, doorX) => {
    const top = 8.15;
    box(mats.plank, x, 0.38, z, span, 0.2, depth);
    localBox(mats.roof, x, top, z, span + 0.7, 0.14, depth + 0.45, 0.2);
    box(mats.trim, x, top - 0.15, z - depth / 2 + 0.15, span + 0.3, 0.28, 0.22);
    const n = Math.max(2, Math.round(span / 7.5));
    const posts = [];
    for (let i = 0; i < n; i++) posts.push(x - span / 2 + (span * i) / (n - 1));
    for (const px of posts) turnedPost(px, z + depth / 2 - 0.35, top - 0.15);
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i];
      const c = posts[i + 1];
      const mid = (a + c) / 2;
      if (doorX != null && Math.abs(mid - doorX) < 2.4) continue;
      const gap = c - a - 0.5;
      if (gap < 1) continue;
      box(mats.trim, mid, 2.15, z + depth / 2 - 0.32, gap, 0.12, 0.1);
      box(mats.trim, mid, 1.15, z + depth / 2 - 0.32, gap, 0.12, 0.1);
    }
  };

  const houseBrackets = (x, z, span, y) => {
    const n = Math.max(4, Math.round(span / 4.4));
    for (let i = 0; i < n; i++) {
      const px = x - span / 2 + (span * (i + 0.5)) / n;
      box(mats.trimDark, px, y - 0.4, z + 0.2, 0.24, 0.75, 0.42);
      box(mats.trimDark, px, y - 0.78, z + 0.05, 0.18, 0.42, 0.18);
    }
  };

  const houseChimney = (x, z, plate, rise) => {
    chimneyStack(mats.brick.red, x, plate + rise * 0.55 + 1.1, z, 1.45, 5.2, 1.45);
  };


  const addHouse = (b) => {
    const h = idHash(b.id);
    const gridley = (b.name || "").startsWith("Gridley") || (b.id || "").startsWith("gridley-");
    const onCrafford =
      (b.facing === "+z" || b.facing === "-z") && Math.abs(b.z - 581) > 40 && Math.abs(b.z - 581) < 100;
    let plan = b.plan;
    if (!plan) {
      if (gridley || onCrafford) plan = "gable-front";
      else {
        const roll = h % 12;
        if (roll === 0) plan = "italianate";
        else if (roll <= 4) plan = "gable-ell";
        else if (roll <= 7) plan = "gable-front";
        else if (roll <= 9) plan = "i-house";
        else plan = "cottage";
      }
    }
    const stories = Number(b.stories) || (plan === "cottage" ? 1 : 2);
    const floors = Math.max(1, Math.floor(stories + 0.001));
    const half = stories - floors > 0.4 || (plan === "gable-front" && !b.plan && h % 3 === 1);
    const brick = b.material === "brick";
    const body = brick ? brickOf(b) : paintOf(b);
    const lights =
      b.sash || (plan === "italianate" ? "two" : plan === "cottage" ? "six" : h % 2 === 0 ? "six" : "two");
    const shutters = true;
    const hood = plan === "italianate";
    const plateOf = (count) => count * 9.25 + 0.65;
    const winH1 = 4.85;
    const winY1 = 4.7;
    const winH2 = 4.7;
    const winY2 = plateOf(1) + 4.55;

    const drawMass = (spec) => {
      const { x, z, width, depth, floors: fl, half: hf, roof, low } = spec;
      const plate = plateOf(fl);
      const span = roof === "front" ? width : Math.min(width, depth);
      const rise = spec.rise ?? (low ? 4.15 : hf ? Math.max(7.1, span * 0.45) : Math.max(5.1, span * 0.33));
      box(body, x, plate / 2, z, width, plate, depth);
      box(mats.stone, x, 0.32, z, width + 0.28, 0.64, depth + 0.28);
      if (!brick) {
        box(mats.trim, x - width / 2, plate / 2, z + depth / 2, 0.26, plate, 0.26);
        box(mats.trim, x + width / 2, plate / 2, z + depth / 2, 0.26, plate, 0.26);
        box(mats.trimDark, x, 0.95, z + depth / 2 + 0.04, width + 0.08, 0.55, 0.1);
      } else {
        box(mats.stone, x, plate * 0.52, z + depth / 2 + 0.05, width + 0.12, 0.22, 0.12);
      }
      box(mats.trim, x, plate - 0.16, z + depth / 2 + 0.08, width + 0.35, 0.28, 0.22);
      if (roof === "front") {
        gableFrontAt(width, depth, rise, plate, mats.roof, x, z);
        clapboardTriangle(body, width, rise * 0.92, plate, "z", z + depth / 2 + 0.02, x, z);
        clapboardTriangle(body, width, rise * 0.92, plate, "z", z - depth / 2 - 0.02, x, z);
      } else if (roof === "hip") {
        hipRoof(width, depth, rise, plate, mats.roof, x, z);
      } else {
        gableAt(width, depth, rise, plate, mats.roof, x, z);
        clapboardTriangle(body, depth, rise * 0.92, plate, "x", x + width / 2 + 0.02, x, z);
        clapboardTriangle(body, depth, rise * 0.92, plate, "x", x - width / 2 - 0.02, x, z);
      }
      return { plate, rise };
    };

    const frontWindows = (x, z, width, depth, fl, doorX) => {
      const fz = z + depth / 2 + 0.08;
      const ww = Math.min(2.35, Math.max(1.65, width * 0.15));
      const spots = [];
      if (width >= 22) spots.push(x - width * 0.27, x + width * 0.27);
      else if (doorX == null) spots.push(x);
      else spots.push(x + Math.sign((x - doorX) || 1) * Math.min(width * 0.24, width / 2 - 1.8));
      if (width >= 30 && doorX != null) spots.push(x - width * 0.38, x + width * 0.38);
      const seen = new Set();
      for (const px of spots) {
        const key = Math.round(px * 4);
        if (seen.has(key)) continue;
        seen.add(key);
        if (Math.abs(px - x) > width / 2 - 1.25) continue;
        if (doorX != null && Math.abs(px - doorX) < 2.15) continue;
        sashFront(px, winY1, fz, ww, winH1, lights, shutters, hood);
        if (fl > 1) sashFront(px, winY2, fz, ww * 0.94, winH2, lights, shutters, hood);
      }
      return fz;
    };

    const sideWindows = (x, z, width, depth, fl, out) => {
      const rows = depth > 28 ? 2 : 1;
      for (let i = 0; i < rows; i++) {
        const pz = z - depth * 0.18 + i * depth * 0.36;
        sashSide(x + out * (width / 2 + 0.06), winY1, pz, out, 2.05, 4.4, lights, h % 2 === 0);
        if (fl > 1) sashSide(x + out * (width / 2 + 0.06), winY2, pz, out, 1.9, 4.2, lights, false);
      }
    };

    let top = 18;
    const yardFront = b.depth / 2;

    if (plan === "gable-ell") {
      const side = h % 2 === 0 ? -1 : 1;
      const U = Math.max(13.5, Math.min(b.width - 11, b.width * 0.52));
      let u0;
      let u1;
      let w0;
      let w1;
      if (side < 0) {
        u0 = -b.width / 2;
        u1 = u0 + U;
        w1 = b.width / 2;
        w0 = u1 - 0.5;
      } else {
        u1 = b.width / 2;
        u0 = u1 - U;
        w0 = -b.width / 2;
        w1 = u0 + 0.5;
      }
      const uprightW = u1 - u0;
      const uprightX = (u0 + u1) / 2;
      const wingW = w1 - w0;
      const wingX = (w0 + w1) / 2;
      const uprightD = b.depth * 0.98;
      const wingD = Math.max(14, b.depth * 0.6);
      const uprightZ = 0;
      const wingZ = uprightD / 2 - wingD / 2;
      const wingFloors = Math.max(1, Math.floor(Number(b.wingStories) || 1));
      const up = drawMass({
        x: uprightX,
        z: uprightZ,
        width: uprightW,
        depth: uprightD,
        floors,
        half: half || floors === 1,
        roof: "front",
      });
      const wing = drawMass({
        x: wingX,
        z: wingZ,
        width: wingW,
        depth: wingD,
        floors: wingFloors,
        half: false,
        roof: "side",
      });
      const inner = Math.sign(uprightX - wingX) || 1;
      const doorX = wingX + inner * (wingW / 2 - 2.15);
      frontWindows(uprightX, uprightZ, uprightW, uprightD, floors, null);
      frontWindows(wingX, wingZ, wingW, wingD, wingFloors, doorX);
      paneledDoor(doorX, wingZ + wingD / 2 + 0.06, 2.55, 6.7, false);
      sideWindows(uprightX, uprightZ, uprightW, uprightD, floors, side);
      sideWindows(wingX, wingZ, wingW, wingD, wingFloors, -side);
      if (half || up.rise > 6.2) {
        const gz = uprightZ + uprightD / 2 + 0.16;
        sashFront(uprightX, up.plate + up.rise * 0.4, gz, Math.min(2.15, uprightW * 0.22), 3.1, lights, false, false);
      }
      frontPorch(0, yardFront + 3.15, b.width * 0.96, 6.1, doorX);
      houseChimney(uprightX, uprightZ - uprightD * 0.12, up.plate, up.rise);
      top = Math.max(up.plate + up.rise, wing.plate + wing.rise);
    } else if (plan === "i-house") {
      const mainD = Math.min(20, Math.max(16, b.depth * 0.48));
      const mainZ = b.depth / 2 - mainD / 2;
      const ellW = Math.max(12, Math.min(b.width * 0.48, b.width - 4));
      const ellD = Math.max(8, b.depth - mainD - 0.8);
      const ellZ = b.depth / 2 - mainD - ellD / 2;
      const ellSide = h % 2 === 0 ? -1 : 1;
      const ellX = ellSide * (b.width / 2 - ellW / 2 - 0.4);
      const main = drawMass({
        x: 0,
        z: mainZ,
        width: b.width,
        depth: mainD,
        floors: 2,
        half: false,
        roof: "side",
      });
      drawMass({
        x: ellX,
        z: ellZ,
        width: ellW,
        depth: ellD,
        floors: 1,
        half: false,
        roof: "side",
      });
      const doorX = 0;
      frontWindows(0, mainZ, b.width, mainD, 2, doorX);
      paneledDoor(doorX, mainZ + mainD / 2 + 0.06, 2.7, 7.05, true);
      sideWindows(0, mainZ, b.width, mainD, 2, -1);
      sideWindows(0, mainZ, b.width, mainD, 2, 1);
      frontPorch(0, b.depth / 2 + 3.15, b.width * 0.94, 6.2, 0);
      houseChimney(-b.width / 2 + 1.7, mainZ, main.plate, main.rise);
      houseChimney(b.width / 2 - 1.7, mainZ, main.plate, main.rise);
      top = main.plate + main.rise;
    } else if (plan === "italianate") {
      const main = drawMass({
        x: 0,
        z: 0,
        width: b.width,
        depth: b.depth,
        floors: 2,
        half: false,
        roof: "side",
        rise: Math.max(5.8, Math.min(b.width, b.depth) * 0.24),
      });
      const fullPorch = h % 2 === 0;
      const doorX = 0;
      frontWindows(0, 0, b.width, b.depth, 2, doorX);
      paneledDoor(doorX, b.depth / 2 + 0.06, 2.8, 7.15, true);
      sideWindows(0, 0, b.width, b.depth, 2, -1);
      sideWindows(0, 0, b.width, b.depth, 2, 1);
      houseBrackets(0, b.depth / 2, b.width, main.plate);
      if (fullPorch) frontPorch(0, b.depth / 2 + 3.2, b.width * 0.9, 6.3, 0);
      else frontPorch(0, b.depth / 2 + 3.05, Math.min(12, b.width * 0.5), 6, 0);
      houseChimney(b.width * 0.22, -b.depth * 0.08, main.plate, main.rise + 1.5);
      top = main.plate + main.rise + 2;
    } else {
      const frontGable = plan !== "cottage";
      const fl = Math.max(1, floors);
      const mass = drawMass({
        x: 0,
        z: 0,
        width: b.width,
        depth: b.depth,
        floors: fl,
        half,
        roof: frontGable ? "front" : "side",
      });
      const doorX = h % 3 === 0 ? b.width * 0.16 : 0;
      frontWindows(0, 0, b.width, b.depth, fl, doorX);
      paneledDoor(doorX, b.depth / 2 + 0.06, 2.6, fl > 1 ? 7 : 6.7, fl > 1);
      sideWindows(0, 0, b.width, b.depth, fl, -1);
      sideWindows(0, 0, b.width, b.depth, fl, 1);
      if (frontGable && half) {
        sashFront(
          0,
          mass.plate + mass.rise * 0.4,
          b.depth / 2 + 0.16,
          Math.min(2.2, b.width * 0.16),
          3.15,
          lights,
          false,
          false,
        );
      }
      frontPorch(0, b.depth / 2 + 3.15, b.width * 0.92, 6.1, doorX);
      houseChimney(frontGable ? 0 : b.width * 0.26, frontGable ? -b.depth * 0.12 : 0, mass.plate, mass.rise);
      top = mass.plate + mass.rise;
    }

    if (h % 6 !== 0) {
      const fenceZ = yardFront + 9.4;
      const fenceW = Math.min(b.width + 10, 48);
      const gate = 3.6;
      const seg = (fenceW - gate) / 2;
      for (const x of [-(gate / 2 + seg / 2), gate / 2 + seg / 2]) {
        box(mats.picket, x, 1.65, fenceZ, seg, 3.25, 0.08);
        box(mats.trim, x, 1.15, fenceZ + 0.06, seg, 0.12, 0.1);
        box(mats.trim, x, 2.25, fenceZ + 0.06, seg, 0.12, 0.1);
      }
      for (const x of [-fenceW / 2, -gate / 2, gate / 2, fenceW / 2]) {
        box(mats.trimDark, x, 1.75, fenceZ, 0.26, 3.5, 0.26);
      }
      box(mats.plank, 0, 0.08, yardFront + 6.2, 3.1, 0.1, 6.4);
    }

    const rear = -(b.depth / 2);
    const wantPrivy = h % 5 !== 0;
    const wantShed = h % 3 !== 1;
    const wantWell = h % 4 === 0;
    if (wantPrivy || (!wantPrivy && !wantShed)) {
      const px = -b.width * 0.28;
      const pz = rear - 6.5;
      box(body, px, 3.45, pz, 4.1, 6.9, 4.5);
      localBox(mats.roof, px, 7.05, pz, 4.7, 0.14, 5.1, 0.16);
      box(mats.trimDark, px, 3.05, pz + 2.3, 1.9, 5.2, 0.08);
    }
    if (wantShed) {
      const sx = b.width * 0.18;
      const sz = rear - 12;
      box(mats.siding.gray, sx, 4, sz, 9.5, 7.6, 11);
      gableAt(9.5, 11, 3.3, 7.8, mats.roof, sx, sz);
      box(mats.trimDark, sx, 3.2, sz + 5.55, 3.8, 5.8, 0.1);
    }
    if (wantWell) {
      const wx = h % 2 === 0 ? b.width * 0.05 : -b.width * 0.05;
      const wz = rear - (wantShed ? 18 : 12);
      box(mats.stone, wx, 1.1, wz + 1.1, 2.5, 1.55, 0.4);
      box(mats.stone, wx, 1.1, wz - 1.1, 2.5, 1.55, 0.4);
      box(mats.stone, wx + 1.1, 1.1, wz, 0.4, 1.55, 1.8);
      box(mats.stone, wx - 1.1, 1.1, wz, 0.4, 1.55, 1.8);
      box(mats.reveal, wx, 0.85, wz, 1.35, 0.18, 1.35);
      box(mats.trimDark, wx, 4.2, wz - 1.25, 0.2, 6.1, 0.2);
      box(mats.trimDark, wx + 0.1, 6.9, wz - 0.25, 0.14, 0.14, 2);
    }

    if (h % 3 !== 2) {
      const spot = new THREE.Vector3((h % 2 ? 1 : -1) * b.width * 0.42, 0, rear - 8 - (h % 4));
      spot.applyMatrix4(buildingMatrix);
      extraTrees.push({
        x: spot.x,
        z: spot.z,
        kind: h % 2 ? "maple" : "elm",
        scale: 0.82 + (h % 5) * 0.07,
      });
    }
    if (b.bayWindow) {
      const bx = b.width * 0.28;
      const fz = b.depth / 2;
      box(body, bx, 5.2, fz + 1.8, 7.2, 8.2, 3.6);
      box(mats.trim, bx, 5.2, fz + 3.7, 6.2, 6.4, 0.16);
      box(mats.glass, bx, 5.4, fz + 3.85, 4.6, 4.8, 0.06);
      localBox(mats.roofDark, bx, 9.6, fz + 1.8, 8, 0.16, 4.2, -0.15);
    }
    return top + 4;
  };

  // 590 East Main. Warm cream paint, red colonnettes on pedestal blocks,
  // and a hood with a recessed panel over each one-over-one sash.
  const addBallCream = (b) => {
    const wallH = 26;
    const body = mats.trim.clone();
    body.color.set("#F6E7CC");
    body.roughness = 0.9;
    body.emissive = new THREE.Color("#6a4e2e");
    body.emissiveIntensity = 0.045;
    const red = mats.siding.red.clone();
    red.map = null;
    red.normalMap = null;
    red.roughnessMap = null;
    red.color.set("#9a332c");
    red.roughness = 0.72;
    const paint = mats.trim.clone();
    paint.color.set("#F3E6CC");
    paint.roughness = 0.82;
    const shade = paint.clone();
    shade.color.set("#E6D0A4");
    const fz = b.depth / 2;
    const sashZ = fz - 0.42;
    const winW = 3.7;
    const winH = winW * 2;
    const winY = 16.15;
    box(body, 0, wallH / 2, -0.35, b.width, wallH, b.depth - 0.5);
    box(mats.stone, 0, 0.7, 0, b.width + 0.8, 1.4, b.depth + 0.5);
    const colonnette = (x) => {
      const z = fz + 0.28;
      const foot = winY - winH / 2;
      const head = winY + winH / 2;
      box(paint, x, foot - 0.22, z, 1.05, 0.46, 0.95);
      const turn = (rTop, rBot, height, y) => {
        const geo = new THREE.CylinderGeometry(rTop, rBot, height, 14);
        geo.translate(x, y, z);
        geo.applyMatrix4(buildingMatrix);
        put(red, geo);
      };
      turn(0.34, 0.46, 0.22, foot + 0.08);
      turn(0.25, 0.36, 0.28, foot + 0.32);
      const shaftH = head - foot - 1.15;
      turn(0.25, 0.25, shaftH, (foot + head) / 2 - 0.05);
      turn(0.34, 0.26, 0.24, head - 0.42);
      turn(0.52, 0.32, 0.28, head - 0.16);
      box(paint, x, head + 0.08, z, 1.05, 0.18, 0.85);
    };
    const narrow = (x0, count, span) => {
      const slot = span / count;
      for (let i = 0; i <= count; i++) colonnette(x0 + i * slot);
      for (let i = 0; i < count; i++) {
        const x = x0 + (i + 0.5) * slot;
        frontSash(x, winY, sashZ, winW, winH, "flat", false, paint, false, false);
        const top = winY + winH / 2;
        box(shade, x, top + 0.14, sashZ + 0.55, winW + 0.15, 0.16, 0.55);
        box(paint, x, top + 0.34, sashZ + 0.78, winW + 0.4, 0.22, 0.95);
        box(paint, x, top + 0.52, sashZ + 1.02, winW + 0.65, 0.14, 1.1);
        box(paint, x, top + 1.25, fz + 0.18, winW * 0.78, 0.95, 0.32);
        box(shade, x, top + 1.25, fz - 0.02, winW * 0.58, 0.62, 0.12);
      }
    };
    const leftSpan = b.width * 0.62;
    const leftX = -b.width / 2 + 0.6;
    narrow(leftX, 6, leftSpan);
    const pedX = leftX + leftSpan / 2;
    const rightSpan = b.width * 0.28;
    const rightX = b.width / 2 - rightSpan - 0.5;
    narrow(rightX, 2, rightSpan);
    const cx = rightX + rightSpan / 2;
    const friezeY = 22.35;
    box(body, 0, friezeY, fz - 0.15, b.width, 1.7, 1.7);
    const corniceY = 24.2;
    box(paint, 0, corniceY - 0.15, fz + 0.28, b.width + 0.4, 0.7, 0.75);
    const pairs = Math.max(6, Math.round(b.width / 6.2));
    for (let i = 0; i < pairs; i++) {
      const x = -b.width / 2 + 1.4 + ((b.width - 2.8) * i) / Math.max(1, pairs - 1);
      for (const side of [-0.34, 0.34]) {
        const px = x + side;
        box(paint, px, corniceY - 0.95, fz + 0.7, 0.34, 1.45, 0.55);
        const curl = new THREE.TorusGeometry(0.46, 0.12, 8, 14, Math.PI);
        curl.translate(px, corniceY - 1.55, fz + 0.95);
        curl.applyMatrix4(buildingMatrix);
        put(paint, curl);
      }
    }
    box(paint, 0, corniceY + 0.48, fz + 1.05, b.width + 1.2, 0.42, 1.5);
    box(paint, 0, corniceY + 0.76, fz + 0.82, b.width + 0.55, 0.18, 1.0);
    const bosses = Math.max(12, Math.round(b.width / 1.65));
    for (let i = 0; i < bosses; i++) {
      const x = -b.width / 2 + ((i + 0.5) * b.width) / bosses;
      const disk = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 12);
      disk.rotateX(Math.PI / 2);
      disk.translate(x, corniceY - 0.42, fz + 0.78);
      disk.applyMatrix4(buildingMatrix);
      put(red, disk);
    }
    const lozenge = (x, y) => {
      const diamond = new THREE.BoxGeometry(0.62, 0.62, 0.16);
      diamond.rotateZ(Math.PI / 4);
      diamond.translate(x, y, fz + 0.92);
      diamond.applyMatrix4(buildingMatrix);
      put(red, diamond);
    };
    for (let i = 0; i < 6; i++) lozenge(leftX + (i + 0.5) * (leftSpan / 6), friezeY - 0.15);
    for (let i = 0; i < 2; i++) lozenge(rightX + (i + 0.5) * (rightSpan / 2), friezeY - 0.15);
    // The parapet is one wall rising out of the cornice. Its back is inside the
    // facade wall and its bottom overlaps the corona, so no sky shows under it.
    const paraBottom = corniceY + 0.42;
    const paraH = 2.85;
    const paraZ = fz - 0.15;
    const paraD = 2.2;
    box(body, 0, paraBottom + paraH / 2, paraZ, b.width + 0.2, paraH, paraD);
    box(paint, 0, paraBottom + paraH + 0.1, paraZ + 0.04, b.width + 0.55, 0.24, paraD + 0.18);
    const blockW = 16.5;
    const blockH = 5.35;
    box(body, pedX, paraBottom + blockH / 2, paraZ + 0.04, blockW, blockH, paraD + 0.16);
    box(paint, pedX, paraBottom + blockH + 0.12, paraZ + 0.08, blockW + 0.4, 0.26, paraD + 0.28);
    const faceZ = paraZ + paraD / 2 + 0.08;
    const pedBase = paraBottom + blockH + 0.02;
    const pedW = 15.2;
    const pedRise = 1.2;
    const tymZ = faceZ - 0.2;
    {
      const thick = 0.85;
      const zf = tymZ + thick / 2;
      const zb = tymZ - thick / 2;
      const positions = [];
      const normals = [];
      const uvs = [];
      const indices = [];
      const push = (x, y, z, nx, ny, nz) => {
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        uvs.push((x - pedX) / 8, (y - pedBase) / 4);
        return positions.length / 3 - 1;
      };
      const tri = (a, b, c) => indices.push(a, b, c);
      const x0 = pedX - pedW / 2;
      const x1 = pedX + pedW / 2;
      const fl = push(x0, pedBase, zf, 0, 0, 1);
      const fr = push(x1, pedBase, zf, 0, 0, 1);
      const fp = push(pedX, pedBase + pedRise, zf, 0, 0, 1);
      tri(fl, fr, fp);
      const bl = push(x0, pedBase, zb, 0, 0, -1);
      const bp = push(pedX, pedBase + pedRise, zb, 0, 0, -1);
      const br = push(x1, pedBase, zb, 0, 0, -1);
      tri(bl, br, bp);
      const slope = Math.hypot(pedW / 2, pedRise);
      const s = pedRise / slope;
      const c = pedW / 2 / slope;
      {
        const a = push(x0, pedBase, zf, -s, c, 0);
        const b = push(pedX, pedBase + pedRise, zf, -s, c, 0);
        const d = push(pedX, pedBase + pedRise, zb, -s, c, 0);
        const e = push(x0, pedBase, zb, -s, c, 0);
        tri(a, b, d);
        tri(a, d, e);
      }
      {
        const a = push(x1, pedBase, zf, s, c, 0);
        const b = push(x1, pedBase, zb, s, c, 0);
        const d = push(pedX, pedBase + pedRise, zb, s, c, 0);
        const e = push(pedX, pedBase + pedRise, zf, s, c, 0);
        tri(a, b, e);
        tri(b, d, e);
      }
      const face = new THREE.BufferGeometry();
      face.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      face.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      face.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      face.setIndex(indices);
      face.applyMatrix4(buildingMatrix);
      put(body, face);
      const tilt = Math.atan2(pedRise, pedW / 2);
      for (const [angle, x] of [[tilt, pedX - pedW / 4], [Math.PI - tilt, pedX + pedW / 4]]) {
        const rake = new THREE.BoxGeometry(slope + 0.2, 0.36, 0.42);
        rake.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
        rake.applyMatrix4(new THREE.Matrix4().makeTranslation(x, pedBase + pedRise / 2, zf + 0.16));
        rake.applyMatrix4(buildingMatrix);
        put(paint, rake);
      }
    }
    const finial = (x, y, z, r = 0.26) => {
      const ball = new THREE.SphereGeometry(r, 14, 10);
      ball.translate(x, y, z);
      ball.applyMatrix4(buildingMatrix);
      put(red, ball);
      const neck = new THREE.CylinderGeometry(r * 0.45, r * 0.7, r * 0.7, 8);
      neck.translate(x, y - r * 0.7, z);
      neck.applyMatrix4(buildingMatrix);
      put(red, neck);
    };
    finial(pedX - blockW / 2 + 0.35, pedBase + 0.35, tymZ + 0.55);
    finial(pedX + blockW / 2 - 0.35, pedBase + 0.35, tymZ + 0.55);
    finial(pedX, pedBase + pedRise + 0.32, tymZ + 0.55, 0.22);
    for (const side of [-1, 1]) {
      const scroll = new THREE.TorusGeometry(0.62, 0.11, 6, 10, Math.PI);
      scroll.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      scroll.translate(pedX + side * (blockW / 2 + 0.15), paraBottom + paraH + 0.15, faceZ - 0.15);
      scroll.applyMatrix4(buildingMatrix);
      put(paint, scroll);
    }
    box(paint, cx, friezeY + 0.15, fz + 0.55, 9.2, 1.45, 0.42);
    box(paint, 0, 11.05, fz + 0.28, b.width + 0.2, 0.24, 0.42);
    dentilCourse(11.28, fz + 0.72, b.width * 0.98, { w: 0.22, h: 0.2, d: 0.24, gap: 0.52, mat: paint });
    box(paint, 0, 11.55, fz + 0.82, b.width + 0.8, 0.4, 1.2);
    box(paint, 0, 11.9, fz + 0.48, b.width + 0.3, 0.18, 0.55);
    const shopSpan = b.width * 0.94;
    const shops = 4;
    const sw = shopSpan / shops;
    for (let i = 0; i <= shops; i++) {
      const x = -shopSpan / 2 + i * sw;
      box(paint, x, 5.55, fz + 0.22, 0.62, 10.2, 0.55);
      box(paint, x, 10.85, fz + 0.4, 0.9, 0.32, 0.7);
    }
    for (let i = 0; i < shops; i++) {
      const x = -shopSpan / 2 + (i + 0.5) * sw;
      const door = i === 1;
      box(mats.reveal, x, 5.15, fz - 0.28, sw * 0.82, 7.5, 0.12);
      if (door) {
        box(mats.glassShop, x - sw * 0.14, 5.2, fz - 0.18, sw * 0.2, 6.6, 0.05);
        box(mats.glassShop, x + sw * 0.14, 5.2, fz - 0.18, sw * 0.2, 6.6, 0.05);
        box(paint, x, 5.2, fz - 0.08, 0.12, 6.8, 0.12);
      } else {
        for (const k of [-0.22, 0, 0.22]) {
          box(mats.glassShop, x + k * sw, 5.15, fz - 0.18, sw * 0.18, 6.8, 0.05);
        }
        box(paint, x - sw * 0.11, 5.15, fz - 0.08, 0.1, 6.9, 0.1);
        box(paint, x + sw * 0.11, 5.15, fz - 0.08, 0.1, 6.9, 0.1);
      }
      box(mats.reveal, x, 9.55, fz - 0.22, sw * 0.78, 1.15, 0.1);
      for (const k of [-0.28, -0.09, 0.09, 0.28]) {
        box(mats.glassShop, x + k * sw, 9.55, fz - 0.12, sw * 0.14, 0.95, 0.04);
      }
      box(paint, x, 8.85, fz + 0.02, sw * 0.78, 0.12, 0.16);
      box(mats.trimDark, x, 1.15, fz + 0.02, sw * 0.7, 0.9, 0.16);
    }
    const fanR = 4.8;
    const fanY = paraBottom + paraH + 0.2;
    const fanZ = faceZ + 0.08;
    const fanShape = new THREE.Shape();
    fanShape.absarc(0, 0, fanR, 0, Math.PI, false);
    fanShape.lineTo(fanR, 0);
    const fan = new THREE.ShapeGeometry(fanShape, 28);
    fan.translate(cx, fanY, fanZ);
    fan.applyMatrix4(buildingMatrix);
    put(shade, fan);
    const ribs = 12;
    for (let i = 0; i <= ribs; i++) {
      const ang = (Math.PI * i) / ribs;
      const len = fanR * 0.98;
      const rib = new THREE.BoxGeometry(0.12, len, 0.18);
      rib.rotateZ(ang - Math.PI / 2);
      rib.translate(cx + Math.cos(ang) * len * 0.5, fanY + Math.sin(ang) * len * 0.5, fanZ + 0.12);
      rib.applyMatrix4(buildingMatrix);
      put(paint, rib);
    }
    const rim = new THREE.TorusGeometry(fanR, 0.09, 6, 28, Math.PI);
    rim.translate(cx, fanY, fanZ + 0.06);
    rim.applyMatrix4(buildingMatrix);
    put(paint, rim);
    const rot = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
    const outward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const placeSign = (title, localX, y, width) => {
      signs.push({
        title,
        subtitle: "",
        style: "molded",
        position: new THREE.Vector3(b.x, y, b.z).addScaledVector(right, localX).addScaledVector(outward, b.depth / 2 + 1.32),
        rotation: rot,
        width,
      });
    };
    placeSign("BALL BROS", pedX, paraBottom + 2.55, 9.4);
    placeSign("CARRIAGE", cx, friezeY + 0.15, 6.6);
    for (const [lx, lz, scale] of [[b.width * 0.55, fz + 8, 2.3]]) {
      const spot = new THREE.Vector3(lx, 0, lz);
      spot.applyMatrix4(buildingMatrix);
      extraTrees.push({ x: spot.x, z: spot.z, kind: "maple", scale });
    }
    return wallH + 14;
  };

  // North end of the 500 block, the corner in Mark's 2010 photograph.
  // Round-arched upper windows, plate glass, a white canopy, and the letters M, C, and P.
  const addMcpCorner = (b) => {
    const wallH = 24;
    const body = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 });
    {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 128;
      const g = canvas.getContext("2d");
      g.fillStyle = "#c9c0b4";
      g.fillRect(0, 0, 256, 128);
      const bw = 64;
      const bh = 32;
      const mortar = 5;
      const shades = [
        [214, 156, 132],
        [186, 122, 100],
        [198, 140, 116],
        [168, 108, 88],
        [206, 150, 126],
        [176, 118, 98],
      ];
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < 5; col++) {
          const shade = shades[(row * 5 + col * 3 + 7) % shades.length];
          g.fillStyle = `rgb(${shade[0]}, ${shade[1]}, ${shade[2]})`;
          g.fillRect(col * bw + off + mortar, row * bh + mortar, bw - mortar * 2, bh - mortar * 2);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      body.map = tex;
      body.userData.uvFeet = { u: 2.6, v: 1.3 };
    }
    const fz = b.depth / 2 + 0.12;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.55, 0, b.width + 0.2, 1.1, b.depth + 0.2);
    const belt = mats.stone.clone();
    belt.color.set("#e6e1d6");
    box(belt, 0, 12.65, fz + 0.28, b.width + 0.4, 0.7, 0.55);
    box(belt, -b.width / 2 - 0.22, 12.65, 0, 0.5, 0.7, b.depth + 0.3);
    box(body, 0, wallH + 1.05, 0, b.width - 0.3, 2.1, b.depth - 0.3);
    const capstone = mats.stone.clone();
    capstone.color.set("#ebe6dc");
    box(capstone, 0, wallH + 2.28, 0, b.width + 0.55, 0.48, b.depth + 0.55);
    const finial = mats.siding.red.clone();
    finial.map = null;
    finial.normalMap = null;
    finial.roughnessMap = null;
    finial.color.set("#c42828");
    for (const [sx, sz] of [
      [b.width / 2 - 1.4, fz - 0.3],
      [-b.width / 2 + 1.4, fz - 0.3],
      [0.4, fz - 0.3],
      [b.width / 2 - 1.4, -b.depth / 2 + 1.4],
    ]) {
      const globe = new THREE.SphereGeometry(0.85, 16, 12);
      globe.translate(sx, wallH + 2.8, sz);
      globe.applyMatrix4(buildingMatrix);
      put(finial, globe);
    }
    const archAt = (x, z, w, rectH, yRect) => {
      const spring = yRect + rectH / 2;
      frontSash(x, yRect, z, w * 0.9, rectH, "open", false, mats.trim, false, false);
      const bars = w > 6 ? [-0.2, 0.2] : [0];
      for (const k of bars) box(mats.trim, x + k * w, yRect, z + 0.18, 0.08, rectH * 0.8, 0.08);
      fanlight(x, spring + 0.04, z + 0.1, w * 0.43, w > 6 ? 5 : 3);
      voussoirArch(body, mats.stone, x, spring, z + 0.38, w * 1.06);
    };
    const pairCenters = [-17, 0, 17];
    const frameMat = mats.trim.clone();
    frameMat.color.set("#f4efe4");
    const winW = 5.25;
    const winH = 7.9;
    for (const gx of pairCenters) {
      for (const dx of [-3.05, 3.05]) {
        const x = gx + dx;
        const sill = 13.5;
        const rectH = winH - winW / 2;
        const springY = sill + rectH;
        box(mats.reveal, x, sill + rectH / 2, fz - 0.16, winW * 0.92, rectH, 0.22);
        box(mats.glass, x, sill + rectH / 2, fz + 0.02, winW * 0.78, rectH * 0.9, 0.05);
        box(frameMat, x - winW * 0.46, sill + rectH / 2, fz + 0.22, 0.22, rectH, 0.24);
        box(frameMat, x + winW * 0.46, sill + rectH / 2, fz + 0.22, 0.22, rectH, 0.24);
        box(frameMat, x, sill, fz + 0.22, winW, 0.2, 0.24);
        const arch = new THREE.TorusGeometry(winW * 0.46, 0.2, 10, 24, Math.PI);
        arch.translate(x, springY, fz + 0.24);
        arch.applyMatrix4(buildingMatrix);
        put(frameMat, arch);
        const fan = new THREE.CircleGeometry(winW * 0.36, 18, 0, Math.PI);
        fan.translate(x, springY, fz + 0.04);
        fan.applyMatrix4(buildingMatrix);
        put(mats.glass, fan);
      }
    }
    const plates = [-16.5, 0, 16.5];
    for (const x of plates) {
      const gw = 14.2;
      box(mats.reveal, x, 5.2, fz - 0.28, gw * 0.96, 8.4, 0.12);
      box(mats.glassShop, x, 4.7, fz - 0.1, gw - 1.1, 6.6, 0.05);
      box(mats.glassShop, x, 9.15, fz - 0.04, gw - 1.4, 1.55, 0.05);
      const transom = new THREE.MeshStandardMaterial({ color: "#f7f4ee", roughness: 0.62 });
      box(transom, x, 8.25, fz + 0.14, gw - 0.85, 0.34, 0.18);
      for (const k of [-0.28, 0, 0.28]) box(transom, x + k * (gw * 0.7), 9.15, fz + 0.14, 0.14, 1.45, 0.12);
      box(body, x - gw / 2, 5.4, fz + 0.2, 0.42, 9.2, 0.4);
      box(body, x + gw / 2, 5.4, fz + 0.2, 0.42, 9.2, 0.4);
      box(mats.stone, x, 1.15, fz + 0.28, gw + 0.5, 0.28, 0.5);
      box(mats.stone, x, 10.0, fz + 0.32, gw + 0.6, 0.28, 0.5);
    }
    const doorX = 0;
    box(mats.trim, doorX - 1.8, 5.2, fz + 0.2, 0.28, 8.4, 0.32);
    box(mats.trim, doorX + 1.8, 5.2, fz + 0.2, 0.28, 8.4, 0.32);
    box(mats.trim, doorX, 9.2, fz + 0.2, 3.9, 0.28, 0.32);
    box(mats.reveal, doorX, 5.3, fz - 0.2, 3.1, 6.6, 0.1);
    box(mats.glassShop, doorX - 0.7, 5.3, fz - 0.08, 1.15, 6.0, 0.05);
    box(mats.glassShop, doorX + 0.7, 5.3, fz - 0.08, 1.15, 6.0, 0.05);
    box(mats.trim, doorX, 5.3, fz + 0.02, 0.1, 6.0, 0.08);
    box(mats.glassShop, doorX, 8.65, fz - 0.02, 2.6, 0.7, 0.04);
    const canopyZ = fz + 3.4;
    const canopyMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7, metalness: 0 });
    box(canopyMat, doorX, 10.25, canopyZ, 13.6, 0.55, 6.6);
    const globeMat = new THREE.MeshStandardMaterial({ color: "#c42828", roughness: 0.42 });
    for (const dx of [-6.1, 6.1]) {
      const arm = new THREE.BoxGeometry(0.36, 1.15, 0.36);
      arm.translate(doorX + dx, 9.45, canopyZ);
      arm.applyMatrix4(buildingMatrix);
      put(canopyMat, arm);
      const globe = new THREE.SphereGeometry(0.58, 16, 12);
      globe.translate(doorX + dx, 8.75, canopyZ);
      globe.applyMatrix4(buildingMatrix);
      put(globeMat, globe);
    }
    const along = Math.max(7, Math.round(b.depth / 9));
    for (const side of [-1, 1]) {
      const sideX = side * (b.width / 2 + 0.16);
      for (let i = 0; i < along; i++) {
        const z = -b.depth / 2 + 5 + ((i + 0.5) * (b.depth - 10)) / along;
        sideSash(sideX, 16.6, z, side, 3.15, 5.8, "segmental", false, mats.trim);
        sideSash(sideX, 6.3, z, side, 2.85, 5.3, "flat", false, mats.trim);
      }
    }
    const rot = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
    const outward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const medal = (x, y, letter) => {
      const z = fz + 0.5;
      const back = new THREE.CylinderGeometry(1.58, 1.58, 0.16, 22);
      back.rotateX(Math.PI / 2);
      back.translate(x, y, z - 0.24);
      back.applyMatrix4(buildingMatrix);
      put(mats.brick.dark, back);
      const disk = new THREE.CylinderGeometry(1.32, 1.32, 0.64, 24);
      disk.rotateX(Math.PI / 2);
      disk.translate(x, y, z);
      disk.applyMatrix4(buildingMatrix);
      put(mats.siding.white, disk);
      const rim = new THREE.TorusGeometry(1.32, 0.13, 8, 28);
      rim.translate(x, y, z + 0.24);
      rim.applyMatrix4(buildingMatrix);
      put(mats.trim, rim);
      if (!letter) return;
      signs.push({
        title: letter,
        subtitle: "",
        style: "letter",
        flush: true,
        position: new THREE.Vector3(b.x, y, b.z).addScaledVector(right, x).addScaledVector(outward, b.depth / 2 + 1.12),
        rotation: rot,
        width: 1.5,
      });
    };
    medal(-8, 17.6, "M");
    medal(8, 17.6, "C");
    medal(25, 17.6, "P");
    return wallH + 8;
  };

  const addStore = (b, frame) => {
    const floorH = 12;
    const wallH = b.stories * floorH;
    const body = frame ? paintOf(b) : brickOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.45, 0, b.width + 0.3, 0.9, b.depth + 0.3);
    if (frame) {
      gable(b.width, b.depth, 5, wallH - 1, mats.roofDark);
      if (b.facade?.peak) {
        // Ball Bros. keeps the triangular front from the 1880s photograph,
        // finished as a pediment with a cornice and returns.
        const rise = Math.min(10, Math.max(7.2, b.width * 0.34));
        drawPediment(body, b.width + 0.15, rise, wallH - 0.1, b.depth / 2 + 0.24);
      } else if (b.facade?.flatTop) {
        const fz = b.depth / 2 + 0.16;
        box(body, 0, wallH + 1.1, fz, b.width + 0.3, 2.2, 0.8);
        box(mats.trim, 0, wallH + 2.05, fz + 0.15, b.width + 0.5, 0.36, 0.4);
      } else {
        drawFalseFront(b, wallH, body);
      }
      cornerBoards(b, wallH);
      dressFront(b);
      if (idHash(b.id) % 5 === 2) rearShed(b, body);
    } else if (b.facade?.cornice) {
      box(brickOf(b), 0, wallH + 0.7, 0, b.width + 0.35, 1.4, b.depth + 0.25);
    } else {
      box(brickOf(b), 0, wallH + 1.4, 0, b.width + 0.6, 2.8, b.depth + 0.6);
      box(mats.trim, 0, wallH + 0.3, b.depth / 2 + 0.15, b.width + 1, 0.7, 0.8);
    }
    if (!frame) {
      dressFront(b);
      if (idHash(b.id) % 6 === 1) rearShed(b, body);
    }
    if (b.facade?.peak) drawPeakedStorefront(b, wallH);
    else if (b.facade?.bays) drawFacade(b, wallH);
    else drawStreetFront(b, wallH, frame);
    if (b.facade?.bays && b.facade?.ground === "keep") drawStreetFront(b, wallH, frame, true);
    if (b.facade?.cornerBay) {
      const bx = b.width / 2 - 4.5;
      const fz = b.depth / 2;
      box(body, bx, wallH * 0.72, fz + 2.4, 8.5, wallH * 0.42, 5.2);
      frontSash(bx, wallH * 0.74, fz + 5.1, 2.6, 5.4, "flat");
      const pz = fz + 3.2;
      box(mats.plank, -b.width * 0.05, 10.8, pz, b.width * 0.92, 0.22, 5.6);
      localBox(mats.awning, -b.width * 0.05, 14.2, pz, b.width * 0.96, 0.12, 5.8, -0.4);
      for (const x of [-b.width / 2 + 0.4, b.width / 2 - 0.4]) {
        box(mats.trimDark, x, 7.2, pz + 2.2, 0.38, 13.2, 0.38);
      }
    }
    if (!frame && b.facade?.cornerPediment) {
      const rise = 6.4;
      const yBase = wallH + 2.7;
      drawPediment(brickOf(b), Math.min(18, b.width + 1.2), rise, yBase, b.depth / 2 + 0.55);
      const peak = yBase + rise;
      box(mats.trim, 0, peak + 1.3, b.depth / 2 + 0.7, 0.38, 2.6, 0.38);
      box(mats.trimDark, 0, peak + 2.75, b.depth / 2 + 0.7, 0.85, 0.4, 0.85);
    }
    if (b.porch || b.kind === "hotel") {
      const z = b.depth / 2 + 4;
      box(mats.plank, 0, 1, z, b.width + 1, 0.4, 8);
      box(mats.roofDark, 0, 11, z, b.width + 1.4, 0.35, 8.4);
      const posts = Math.max(2, Math.round(b.width / 14));
      for (let i = 0; i < posts; i++) {
        const x = -b.width / 2 + (b.width * i) / (posts - 1);
        box(mats.trimDark, x, 6, z + 3.6, 0.5, 10, 0.5);
      }
    }
    downspouts(b.width, b.depth, wallH);
    signFor(b, frame ? wallH + 4 : wallH);
    return wallH + (frame ? 8 : 4);
  };

  // 1861 Reformed Church. No photograph was found, so this is the ordinary frame church of that date.
  const addReformedChurch = (b) => {
    const wallH = 18;
    const body = paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.7, 0, b.width + 0.5, 1.4, b.depth + 0.5);
    gable(b.width, b.depth, b.width * 0.42, wallH, mats.roofDark);
    const fz = b.depth / 2 + 0.14;
    box(mats.trimDark, 0, 4.6, fz, 5.2, 8.4, 0.22);
    box(mats.glass, -0.7, 5.2, fz + 0.1, 0.9, 3.2, 0.05);
    box(mats.glass, 0.7, 5.2, fz + 0.1, 0.9, 3.2, 0.05);
    box(mats.trim, 0, 9.2, fz + 0.08, 5.6, 0.4, 0.12);
    frontSash(0, 13.2, fz, 3.2, 3.4, "round");
    for (let i = 0; i < 3; i++) {
      const z = -b.depth * 0.22 + i * (b.depth * 0.22);
      for (const side of [-1, 1]) {
        sideSash(side * (b.width / 2 + 0.08), 9.5, z, side, 2.2, 8.2, "round");
      }
    }
    const tz = b.depth / 2 - 5;
    box(body, 0, 26, tz, 10, 28, 10);
    box(mats.trim, 0, 16, tz + 5.2, 3.2, 6.4, 0.16);
    const cone = new THREE.ConeGeometry(7.2, 16, 4);
    cone.rotateY(Math.PI / 4);
    cone.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 48, tz));
    cone.applyMatrix4(buildingMatrix);
    put(mats.roofDark, cone);
    signFor(b, 14);
    return 64;
  };

  // First Presbyterian after the 1917 enlargement: crenellated tower, cross gables.
  const addGothicChurch = (b) => {
    const body = mats.brick.dark;
    const wallH = 22;
    box(body, 0, wallH / 2 + 1.2, -2, b.width, wallH, b.depth);
    box(mats.stone, 0, 1.3, -2, b.width + 1.2, 2.6, b.depth + 1.2);
    gable(b.width, b.depth, 12, wallH + 1, mats.roofDark);
    const wingX = b.width * 0.15;
    box(body, wingX, 12, b.depth * 0.15, b.width * 0.72, 20, b.depth * 0.55);
    gableAt(b.width * 0.72, b.depth * 0.55, 8, 22, mats.roofDark, wingX, b.depth * 0.15);
    const fz = b.depth / 2;
    const pointed = (x, y, z, w, h) => {
      box(mats.trim, x, y, z, w + 0.4, h + 0.3, 0.16);
      box(mats.glass, x, y - 0.2, z + 0.08, w * 0.72, h * 0.72, 0.05);
      archHood(mats.stone, x, y + h * 0.35, z + 0.12, w + 0.2, h * 0.45, "z");
    };
    pointed(b.width * 0.08, 12, fz + 0.2, 3.4, 10);
    pointed(b.width * 0.28, 11, fz + 0.2, 2.6, 8);
    pointed(-b.width * 0.12, 11, fz - 4, 2.4, 8);
    const tx = -b.width / 2 + 8;
    const tz = fz - 6;
    box(body, tx, 20, tz, 16, 40, 16);
    box(mats.stone, tx, 1.4, tz, 17.2, 2.8, 17.2);
    for (const face of [
      [0, 8.2, 0],
      [8.2, 0, 1],
      [-8.2, 0, -1],
    ]) {
      box(mats.trim, tx + face[0], 24, tz + face[1], face[2] ? 0.2 : 3.2, 8, face[2] ? 3.2 : 0.2);
      box(mats.trimDark, tx + face[0], 24, tz + face[1], face[2] ? 0.12 : 1.6, 5.5, face[2] ? 1.6 : 0.12);
      archHood(mats.stone, tx + face[0], 27.2, tz + face[1], 3.4, 1.8, face[2] ? "x" : "z");
    }
    pointed(tx, 8, tz + 8.2, 3.6, 8);
    box(mats.trimDark, tx - 0.7, 6.2, tz + 8.35, 1.1, 6.4, 0.08);
    box(mats.trimDark, tx + 0.7, 6.2, tz + 8.35, 1.1, 6.4, 0.08);
    for (let i = 0; i < 7; i++) {
      const mx = tx - 7 + i * 2.3;
      box(body, mx, 40.4, tz + 7.6, 1.3, 2.2, 1.1);
      box(body, tx + 7.6, 40.4, tz - 7 + i * 2.3, 1.1, 2.2, 1.3);
    }
    box(mats.stone, 0, 0.2, fz + 8, b.width + 10, 0.25, 7);
    const tree = new THREE.Vector3(b.width * 0.55, 0, fz + 10);
    tree.applyMatrix4(buildingMatrix);
    extraTrees.push({ x: tree.x, z: tree.z, kind: "maple", scale: 0.7 });
    signFor(b, 16);
    return 48;
  };

  // 1915 Hail and Crafford postcard: red brick, slate turret, columned porch.
  const addTurretHouse = (b) => {
    const body = mats.brick.red;
    const floors = 2;
    const plate = floors * 11 + 2;
    box(body, 0, plate / 2 + 0.8, 0, b.width, plate, b.depth);
    box(mats.stone, 0, 1.1, 0, b.width + 0.8, 2.2, b.depth + 0.8);
    gable(b.width * 0.7, b.depth, 8, plate, mats.roofDark);
    box(mats.trim, 0, plate + 3.2, b.depth * 0.05, 6, 4.5, 5);
    box(mats.roofDark, 0, plate + 6, b.depth * 0.05, 7, 1.2, 6);
    const tx = b.width / 2 - 6;
    const tz = b.depth / 2 - 6;
    box(body, tx, 16, tz, 12, 28, 12);
    const cone = new THREE.ConeGeometry(8.2, 14, 8);
    cone.applyMatrix4(new THREE.Matrix4().makeTranslation(tx, 38, tz));
    cone.applyMatrix4(buildingMatrix);
    put(mats.roofDark, cone);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      frontSash(tx + Math.sin(a) * 0.2, 14 + (i % 2) * 8, tz + 6.2, 2.1, 5.2, "round", false, mats.trim);
    }
    const fz = b.depth / 2;
    frontSash(-b.width * 0.15, 8, fz, 2.4, 6.4, "flat", false, mats.trim);
    frontSash(-b.width * 0.15, 18, fz, 2.2, 5.6, "flat", false, mats.trim);
    const pz = fz + 4;
    box(mats.plank, -4, 1.3, pz, b.width * 0.7, 0.28, 8);
    box(mats.roofDark, -4, 10.5, pz, b.width * 0.74, 0.2, 8.4);
    for (let i = 0; i < 4; i++) {
      const x = -b.width * 0.32 + i * (b.width * 0.18);
      box(mats.trim, x, 5.8, pz + 3.2, 0.45, 9, 0.45);
    }
    box(mats.trim, -4, 10.2, pz + 0.2, b.width * 0.62, 0.35, 0.2);
    signFor(b, 12);
    return plate + 16;
  };

  // 2010 south end of the 400 block. Cream paint, filled panels, and the
  // Something Special band are the photograph. The 1900 stop keeps the red bank.
  const addSomethingSpecial = (b) => {
    const wallH = 32;
    const body = mats.trim.clone();
    body.color.set("#e4d8c4");
    body.roughness = 0.92;
    const paint = mats.trim.clone();
    paint.color.set("#f1e4cc");
    paint.roughness = 0.84;
    const russet = mats.siding.red.clone();
    russet.map = null;
    russet.normalMap = null;
    russet.roughnessMap = null;
    russet.color.set("#9a534c");
    const louver = russet.clone();
    louver.color.set("#7d403c");
    const stripe = russet.clone();
    stripe.color.set("#a33b32");
    const fz = b.depth / 2;
    box(body, 0, wallH / 2, -0.15, b.width, wallH, b.depth - 0.3);
    box(mats.stone, 0, 0.55, 0, b.width + 0.4, 1.1, b.depth + 0.3);
    const count = 6;
    const span = b.width * 0.86;
    for (let i = 0; i < count; i++) {
      const x = -span / 2 + (span * (i + 0.5)) / count;
      const w = 2.5;
      const h = 8.6;
      const y = 23.2;
      box(russet, x, y, fz - 0.02, w * 0.72, h * 0.82, 0.08);
      for (let k = 0; k < 7; k++) {
        box(louver, x, y - h * 0.32 + k * (h * 0.09), fz + 0.05, w * 0.66, 0.06, 0.04);
      }
      box(paint, x - w / 2, y, fz + 0.14, 0.16, h, 0.24);
      box(paint, x + w / 2, y, fz + 0.14, 0.16, h, 0.24);
      box(paint, x, y - h / 2, fz + 0.16, w + 0.15, 0.14, 0.26);
      archHood(paint, x, y + h / 2 - 0.15, fz + 0.28, w + 0.45, 1.15, "z");
      box(paint, x, y - h / 2 - 0.18, fz + 0.32, w + 0.55, 0.16, 0.42);
    }
    const cy = 29.2;
    box(paint, 0, cy - 0.15, fz + 0.22, b.width + 0.2, 0.55, 0.55);
    const pairs = 7;
    for (let i = 0; i < pairs; i++) {
      const x = -b.width / 2 + 1.6 + ((b.width - 3.2) * i) / (pairs - 1);
      for (const dx of [-0.32, 0.32]) {
        box(paint, x + dx, cy - 0.95, fz + 0.38, 0.26, 1.25, 0.48);
      }
    }
    box(paint, 0, cy + 0.28, fz + 0.55, b.width + 0.6, 0.28, 0.85);
    box(body, 0, cy + 1.15, fz - 0.02, b.width, 1.5, 1.2);
    box(paint, 0, cy + 1.95, fz + 0.12, b.width + 0.25, 0.16, 1.25);
    const crestW = 8.4;
    const crestRise = 1.7;
    const crestY = cy + 2.05;
    {
      const thick = 0.7;
      const zf = fz + 0.2 + thick / 2;
      const zb = fz + 0.2 - thick / 2;
      const positions = [];
      const normals = [];
      const uvs = [];
      const indices = [];
      const push = (x, y, z, nx, ny, nz) => {
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        uvs.push(x / 8, y / 4);
        return positions.length / 3 - 1;
      };
      const tri = (a, b, c) => indices.push(a, b, c);
      const fl = push(-crestW / 2, crestY, zf, 0, 0, 1);
      const fr = push(crestW / 2, crestY, zf, 0, 0, 1);
      const fp = push(0, crestY + crestRise, zf, 0, 0, 1);
      tri(fl, fr, fp);
      const bl = push(-crestW / 2, crestY, zb, 0, 0, -1);
      const bp = push(0, crestY + crestRise, zb, 0, 0, -1);
      const br = push(crestW / 2, crestY, zb, 0, 0, -1);
      tri(bl, br, bp);
      const face = new THREE.BufferGeometry();
      face.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      face.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      face.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      face.setIndex(indices);
      face.applyMatrix4(buildingMatrix);
      put(body, face);
    }
    const finial = new THREE.SphereGeometry(0.28, 12, 8);
    finial.translate(0, crestY + crestRise + 0.32, fz + 0.35);
    finial.applyMatrix4(buildingMatrix);
    put(paint, finial);
    const neck = new THREE.CylinderGeometry(0.1, 0.16, 0.28, 8);
    neck.translate(0, crestY + crestRise + 0.08, fz + 0.35);
    neck.applyMatrix4(buildingMatrix);
    put(paint, neck);
    const bandY = 14.6;
    const bandH = 5.2;
    const glassY = 6.6;
    const glassH = 10.4;
    const full = b.width;
    const leftW = full * 0.56;
    const rightW = full * 0.44;
    const leftX = -full / 2 + leftW / 2;
    const rightX = full / 2 - rightW / 2;
    const doorX = -b.width * 0.02;
    const brown = mats.trimDark.clone();
    brown.color.set("#4a3428");
    box(brown, leftX, bandY, fz + 0.16, leftW * 0.98, bandH, 0.28);
    box(mats.reveal, leftX, glassY, fz - 0.2, leftW * 0.9, glassH, 0.12);
    for (const k of [-0.33, 0, 0.33]) {
      box(mats.glassShop, leftX + k * leftW * 0.72, glassY, fz - 0.04, leftW * 0.2, glassH - 0.7, 0.05);
    }
    box(paint, leftX - leftW * 0.28, glassY, fz + 0.08, 0.14, glassH, 0.12);
    box(paint, leftX + leftW * 0.28, glassY, fz + 0.08, 0.14, glassH, 0.12);
    box(mats.reveal, doorX, glassY - 0.4, fz - 0.45, 3.5, glassH + 0.4, 0.18);
    box(mats.trimDark, doorX, glassY - 0.9, fz - 0.28, 2.4, glassH - 1.2, 0.12);
    box(mats.glassShop, doorX, glassY + glassH * 0.32, fz - 0.2, 2.2, 1.5, 0.04);
    box(mats.reveal, rightX, glassY, fz - 0.2, rightW * 0.92, glassH, 0.12);
    for (const k of [-0.3, 0, 0.3]) {
      box(mats.glassShop, rightX + k * rightW * 0.68, glassY, fz - 0.04, rightW * 0.18, glassH - 0.7, 0.05);
    }
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      box(
        i % 2 ? mats.siding.white : stripe,
        rightX - rightW / 2 + ((i + 0.5) * rightW) / stripes,
        bandY,
        fz + 0.34,
        rightW / stripes - 0.04,
        bandH,
        0.7,
      );
    }
    const rot = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
    const outward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    signs.push({
      title: "Something Special",
      subtitle: "",
      style: "band",
      position: new THREE.Vector3(b.x, bandY, b.z).addScaledVector(right, leftX).addScaledVector(outward, b.depth / 2 + 0.55),
      rotation: rot,
      width: leftW * 0.9,
      height: bandH - 0.35,
    });
    const lampX = leftX - leftW * 0.62;
    const lampZ = fz + 8.5;
    const post = new THREE.CylinderGeometry(0.11, 0.16, 10.2, 10);
    post.translate(lampX, 5.2, lampZ);
    post.applyMatrix4(buildingMatrix);
    put(mats.coal, post);
    const globe = new THREE.SphereGeometry(0.48, 16, 12);
    globe.translate(lampX, 10.6, lampZ);
    globe.applyMatrix4(buildingMatrix);
    const lampMat = new THREE.MeshStandardMaterial({ color: "#f4f1e4", emissive: "#fff6dd", emissiveIntensity: 0.45, roughness: 0.35 });
    const globeMesh = new THREE.Mesh(globe, lampMat);
    scene.add(globeMesh);
    const cap = new THREE.CylinderGeometry(0.12, 0.42, 0.38, 10);
    cap.translate(lampX, 11.15, lampZ);
    cap.applyMatrix4(buildingMatrix);
    put(mats.coal, cap);
    const can = new THREE.CylinderGeometry(0.42, 0.48, 2.3, 12);
    can.translate(lampX - 1.8, 1.25, lampZ - 0.4);
    can.applyMatrix4(buildingMatrix);
    put(mats.coal, can);
    return wallH + 8;
  };

  // The green front just north of Something Special, from the same 2010 photograph.
  const addGreenNeighbor = (b) => {
    const wallH = 24;
    const body = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.92 });
    {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      const g = canvas.getContext("2d");
      g.fillStyle = "#8d8a78";
      g.fillRect(0, 0, 128, 64);
      g.fillStyle = "#A8A878";
      g.fillRect(3, 3, 58, 26);
      g.fillRect(67, 3, 58, 26);
      g.fillRect(3, 35, 58, 26);
      g.fillRect(67, 35, 26, 26);
      g.fillStyle = "#b3b48a";
      g.fillRect(35, 35, 26, 26);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      body.map = tex;
      body.userData.uvFeet = { u: 4, v: 2 };
    }
    const fz = b.depth / 2;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.brick.red, 0, 1.3, fz + 0.05, b.width, 2.6, 0.8);
    const n = 3;
    const gap = b.width / n;
    for (let i = 0; i < n; i++) {
      const x = -b.width / 2 + gap * (i + 0.5);
      frontSash(x, 16.2, fz, Math.min(3.2, gap - 1.4), 6.4, "round", false, mats.trim);
      const hood = new THREE.TorusGeometry(1.55, 0.16, 8, 18, Math.PI);
      hood.translate(x, 18.6, fz + 0.35);
      hood.applyMatrix4(buildingMatrix);
      put(mats.trim, hood);
    }
    box(body, 0, wallH + 0.4, fz + 0.05, b.width, 1.1, 0.7);
    const corbels = Math.max(8, Math.round(b.width / 1.5));
    for (let i = 0; i < corbels; i++) {
      const x = -b.width / 2 + ((i + 0.5) * b.width) / corbels;
      box(body, x, wallH - 0.55, fz + 0.28, 0.55, 0.7, 0.4);
    }
    localBox(mats.roof, 0, 11.4, fz + 1.6, b.width * 0.96, 0.16, 3.2, -0.35);
    box(mats.reveal, 0, 5.6, fz - 0.05, b.width * 0.86, 6.2, 0.1);
    box(mats.glassShop, 0, 5.6, fz + 0.04, b.width * 0.72, 5.6, 0.05);
    return wallH + 4;
  };

  // The gray front with two arched hoods, third north of the Hurst corner.
  const addGrayHoods = (b) => {
    const wallH = 22;
    const body = mats.siding.gray.clone();
    body.color.set("#d9d4cc");
    const fz = b.depth / 2;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(body, 0, wallH + 0.7, fz, b.width + 0.2, 1.5, 0.6);
    box(mats.trim, 0, wallH + 1.4, fz + 0.12, b.width + 0.3, 0.16, 0.4);
    for (const x of [-b.width * 0.22, b.width * 0.22]) {
      frontSash(x, 14.6, fz, 3.1, 6.2, "round", false, mats.trimDark);
    }
    box(mats.reveal, 0, 5.2, fz - 0.04, b.width * 0.8, 6.4, 0.1);
    box(mats.glassShop, 0, 5.2, fz + 0.04, b.width * 0.66, 5.8, 0.05);
    return wallH + 4;
  };

  // Hurst Street just east of East Main, the two 2010 storefronts.
  // The tan front is weathered buff brick. The red front is pressed-metal black at the cornice.
  const addHurstBuff = (b) => {
    const wallH = 32;
    const body = mats.brick.buff.clone();
    {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const g = canvas.getContext("2d");
      g.fillStyle = "#b3aa9c";
      g.fillRect(0, 0, 256, 256);
      const bw = 64;
      const bh = 32;
      const mortar = 5;
      for (let row = 0; row < 8; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < 5; col++) {
          const n = ((row * 3 + col * 5) % 5) - 2;
          g.fillStyle = `rgb(${216 + n * 3}, ${205 + n * 2}, ${187 + n * 2})`;
          g.fillRect(col * bw + off + mortar, row * bh + mortar, bw - mortar * 2, bh - mortar * 2);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      body.map = tex;
      body.color.set("#ffffff");
      body.userData.uvFeet = { u: 2.4, v: 2.4 };
    }
    const headBrick = mats.brick.red.clone();
    headBrick.color.set("#9a4538");
    const wood = mats.trimDark.clone();
    wood.color.set("#6b3028");
    const woodDark = wood.clone();
    woodDark.color.set("#4a241e");
    const hoodMat = new THREE.MeshStandardMaterial({ color: "#2A2420", roughness: 0.94, side: THREE.DoubleSide });
    hoodMat.polygonOffset = true;
    hoodMat.polygonOffsetFactor = -1;
    const louver = wood.clone();
    louver.color.set("#3a221c");
    const fz = b.depth / 2 + 0.12;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.35, 0, b.width + 0.2, 0.7, b.depth + 0.2);
    const flatFace = (mat, x, y, z, radius, thick) => {
      const shape = new THREE.Shape();
      shape.moveTo(radius, 0);
      shape.absarc(0, 0, radius, 0, Math.PI, false);
      shape.lineTo(radius, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 16 });
      geo.translate(x, y, z);
      geo.applyMatrix4(buildingMatrix);
      put(mat, geo);
    };
    const cols = 4;
    const gap = (b.width - 1.2) / cols;
    for (let i = 0; i < cols; i++) {
      const x = -b.width / 2 + 0.6 + gap * (i + 0.5);
      const w = 2.45;
      const h = 9.4;
      const y = 21.4;
      box(woodDark, x, y - 0.35, fz + 0.1, w * 0.96, h * 0.86, 0.16);
      for (let k = 0; k < 14; k++) {
        box(louver, x, y - h * 0.44 + k * (h * 0.058), fz + 0.2, w * 0.84, 0.045, 0.045);
      }
      const spring = y + h * 0.32;
      const span = w + 0.55;
      const rise = span * 0.36;
      const n = 7;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const u = (t - 0.5) * 2;
        const geo = new THREE.BoxGeometry(span / n + 0.08, 0.42, 0.48);
        geo.rotateZ(-u * 0.5);
        geo.translate(x + u * span * 0.46, spring + rise * (1 - u * u), fz + 0.34);
        geo.applyMatrix4(buildingMatrix);
        put(headBrick, geo);
      }
    }
    const cy = wallH - 0.2;
    const shadow = body.clone();
    shadow.color.set("#b7ad9e");
    box(shadow, 0, cy - 1.15, fz + 0.16, b.width, 0.16, 0.22);
    const corbels = Math.max(14, Math.round(b.width / 1.7));
    for (let i = 0; i < corbels; i++) {
      const x = -b.width / 2 + ((i + 0.5) * b.width) / corbels;
      box(body, x, cy - 0.7, fz + 0.22, 0.55, 0.42, 0.28);
      box(body, x, cy - 0.28, fz + 0.3, 0.42, 0.32, 0.22);
    }
    box(body, 0, cy + 0.15, fz + 0.28, b.width + 0.3, 0.28, 0.36);
    const beamY = 12.7;
    const openCenters = [-b.width * 0.24, b.width * 0.24];
    const openHalf = b.width * 0.34 * 0.46;
    const boardN = Math.round(b.width / 0.55);
    for (let k = 0; k < boardN; k++) {
      const x = -b.width / 2 + ((k + 0.5) * b.width) / boardN;
      if (openCenters.some((cx) => Math.abs(x - cx) < openHalf + 0.15)) continue;
      box(k % 2 ? woodDark : wood, x, 6.4, fz + 0.08, 0.42, 11.6, 0.16);
    }
    box(wood, 0, beamY, fz + 0.42, b.width + 0.15, 0.95, 0.62);
    box(woodDark, 0, beamY - 0.62, fz + 0.32, b.width, 0.28, 0.42);
    const openW = b.width * 0.34;
    for (const x of [-b.width * 0.24, b.width * 0.24]) {
      const rad = openW * 0.46;
      const glassY = 3.15;
      const glassH = 4.3;
      box(mats.glassShop, x, glassY, fz + 0.02, rad * 1.85, glassH, 0.05);
      for (const mx of [-0.33, 0, 0.33]) box(woodDark, x + mx * rad * 1.5, glassY, fz + 0.12, 0.07, glassH * 0.9, 0.05);
      for (const my of [-0.33, 0.33]) box(woodDark, x, glassY + my * glassH * 0.32, fz + 0.12, rad * 1.55, 0.06, 0.05);
      flatFace(hoodMat, x, glassY + glassH * 0.5, fz + 0.16, rad, 0.16);
      box(wood, x - rad - 0.28, 6.3, fz + 0.36, 0.55, 11.2, 0.42);
      box(wood, x + rad + 0.28, 6.3, fz + 0.36, 0.55, 11.2, 0.42);
    }
    for (let k = 0; k < 4; k++) {
      box(k % 2 ? woodDark : wood, -0.7 + k * 0.46, 6.2, fz + 0.3, 0.38, 10.6, 0.22);
    }
    return wallH + 4;
  };

  const addHurstPressed = (b) => {
    const wallH = 32;
    const body = mats.brick.red.clone();
    {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 128;
      const g = canvas.getContext("2d");
      g.fillStyle = "#3a342f";
      g.fillRect(0, 0, 256, 128);
      const bw = 64;
      const bh = 32;
      const mortar = 5;
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < 5; col++) {
          const tone = ((row * 5 + col * 3) % 4) * 10;
          g.fillStyle = `rgb(${138 - tone}, ${62 - tone * 0.35}, ${44 - tone * 0.25})`;
          g.fillRect(col * bw + off + mortar, row * bh + mortar, bw - mortar * 2, bh - mortar * 2);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      body.map = tex;
      body.color.set("#ffffff");
      body.userData.uvFeet = { u: 2.7, v: 1.35 };
    }
    const black = mats.coal.clone();
    black.color.set("#16181c");
    const inset = black.clone();
    inset.color.set("#0c0d10");
    const lap = new THREE.MeshStandardMaterial({ color: "#f7f6f3", roughness: 0.86 });
    const lapShadow = new THREE.MeshStandardMaterial({ color: "#c5c1b8", roughness: 0.92 });
    const gray = new THREE.MeshStandardMaterial({ color: "#b7b6b1", roughness: 0.9 });
    const white = new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.8, side: THREE.DoubleSide });
    const fz = b.depth / 2 + 0.12;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(gray, 0, 1.75, fz + 0.05, b.width, 3.5, 0.32);
    const lapBottom = 3.5;
    const lapTop = 9.15;
    box(lap, 0, (lapBottom + lapTop) / 2, fz + 0.1, b.width - 0.2, lapTop - lapBottom, 0.26);
    for (let y = lapBottom + 0.16; y < lapTop; y += 0.33) {
      box(lapShadow, 0, y, fz + 0.24, b.width - 0.5, 0.045, 0.05);
    }
    const friezeY = 10.85;
    box(black, 0, friezeY, fz + 0.22, b.width + 0.15, 3.2, 0.36);
    const bays = 4;
    for (let i = 0; i < bays; i++) {
      const x = -b.width / 2 + ((i + 0.5) * b.width) / bays;
      const pw = b.width / bays - 1.45;
      box(inset, x, friezeY, fz + 0.02, pw, 2.05, 0.14);
      box(black, x, friezeY + 1.12, fz + 0.32, pw + 0.28, 0.12, 0.18);
      box(black, x, friezeY - 1.12, fz + 0.32, pw + 0.28, 0.12, 0.18);
      box(black, x - pw / 2, friezeY, fz + 0.32, 0.12, 2.2, 0.18);
      box(black, x + pw / 2, friezeY, fz + 0.32, 0.12, 2.2, 0.18);
    }
    const pilasters = 5;
    for (let i = 0; i < pilasters; i++) {
      const x = -b.width / 2 + (b.width * i) / (pilasters - 1);
      const end = i === 0 || i === pilasters - 1;
      box(black, x, 6.5, fz + 0.46, end ? 0.78 : 0.58, 12.4, end ? 0.58 : 0.46);
      box(black, x, friezeY + 1.55, fz + 0.7, end ? 1.45 : 0.9, end ? 0.85 : 0.45, end ? 0.85 : 0.55);
      if (end) {
        box(black, x, friezeY + 1.05, fz + 0.62, 1.1, 0.35, 0.55);
        const cap = new THREE.TorusGeometry(0.42, 0.1, 6, 10, Math.PI);
        cap.rotateY(Math.PI / 2);
        cap.translate(x, friezeY + 0.85, fz + 0.85);
        cap.applyMatrix4(buildingMatrix);
        put(black, cap);
      }
    }
    for (const x of [-b.width * 0.3, -b.width * 0.02]) {
      box(inset, x, 6.35, fz + 0.28, 1.45, 2.35, 0.14);
      box(mats.glass, x, 6.35, fz + 0.36, 1.05, 1.85, 0.04);
    }
    const doorX = b.width * 0.38;
    box(lap, doorX, 5.9, fz + 0.28, 2.05, 5.8, 0.14);
    box(white, doorX, 5.9, fz + 0.38, 1.65, 5.3, 0.08);
    box(mats.glass, doorX, 7.9, fz + 0.46, 0.7, 1.15, 0.04);
    const flatArch = (mat, x, y, z, radius, thick) => {
      const shape = new THREE.Shape();
      shape.moveTo(radius, 0);
      shape.absarc(0, 0, radius, 0, Math.PI, false);
      shape.lineTo(radius, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 14 });
      geo.translate(x, y, z);
      geo.applyMatrix4(buildingMatrix);
      put(mat, geo);
    };
    const archMat = new THREE.MeshStandardMaterial({ color: "#f6f3ec", roughness: 0.76 });
    const surround = (x, y, w, h, glass) => {
      const sill = y - h * 0.48;
      const spring = y + h * 0.02;
      const rad = w * 0.36;
      const openingH = spring - sill;
      if (glass) {
        box(mats.reveal, x, (sill + spring) / 2, fz - 0.02, w * 0.58, openingH * 0.92, 0.16);
        box(mats.glass, x, (sill + spring) / 2, fz + 0.08, w * 0.46, openingH * 0.82, 0.04);
        box(archMat, x - w * 0.34, (sill + spring) / 2, fz + 0.24, 0.08, openingH, 0.12);
        box(archMat, x + w * 0.34, (sill + spring) / 2, fz + 0.24, 0.08, openingH, 0.12);
        box(archMat, x, sill, fz + 0.24, w * 0.76, 0.08, 0.12);
      } else {
        const fillW = w * 0.5;
        box(archMat, x, (sill + spring) / 2, fz + 0.22, fillW, openingH * 0.98, 0.22);
        for (let k = 0; k < 6; k++) {
          box(inset, x, sill + 0.45 + k * (openingH * 0.13), fz + 0.36, fillW * 0.72, 0.045, 0.03);
        }
        const pil = 0.62;
        box(archMat, x - fillW * 0.5 - pil * 0.35, (sill + spring) / 2, fz + 0.55, pil, openingH, 0.7);
        box(archMat, x + fillW * 0.5 + pil * 0.35, (sill + spring) / 2, fz + 0.55, pil, openingH, 0.7);
        box(archMat, x, sill, fz + 0.55, fillW + pil * 2.1, 0.28, 0.7);
      }
      const archRad = glass ? rad : w * 0.5;
      const arch = new THREE.TorusGeometry(archRad, glass ? 0.07 : 0.34, 12, 32, Math.PI);
      arch.translate(x, spring, fz + (glass ? 0.26 : 0.58));
      arch.applyMatrix4(buildingMatrix);
      put(archMat, arch);
      if (!glass) box(archMat, x, spring + archRad * 0.82, fz + 0.64, 0.28, 0.42, 0.22);
    };
    const leftXs = [-10.6, -6.7, -2.8];
    const rightXs = [2.3, 5.5, 8.7];
    for (const x of leftXs) surround(x, 21.2, 2.7, 12.4, false);
    for (const x of rightXs) surround(x, 18.8, 2.15, 11.4, true);
    const xs = rightXs;
    const gap = rightXs[1] - rightXs[0];
    const panelMid = (xs[0] + xs[2]) / 2;
    const panelW = xs[2] - xs[0] + gap * 0.85;
    box(body, panelMid, 19.8, fz - 0.22, panelW, 12.4, 0.16);
    box(body, panelMid, 26.2, fz + 0.18, panelW + 0.5, 0.35, 0.4);
    box(body, panelMid - panelW / 2, 19.8, fz + 0.16, 0.35, 12.6, 0.38);
    box(body, panelMid + panelW / 2, 19.8, fz + 0.16, 0.35, 12.6, 0.38);
    const right0 = rightXs[0] - 1.5;
    const right1 = rightXs[2] + 1.5;
    const corbelY = 25.2;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 7; i++) {
        if ((i + row) % 2 === 0) continue;
        const x = right0 + ((i + 0.5) * (right1 - right0)) / 7;
        box(body, x, corbelY + row * 0.38, fz + 0.4 + row * 0.14, 0.5, 0.34, 0.4 + row * 0.12);
      }
    }
    box(body, (right0 + right1) / 2, corbelY + 1.15, fz + 0.7, right1 - right0 + 0.4, 0.28, 0.55);
    const cy = 28.2;
    const brackets = 7;
    for (let i = 0; i < brackets; i++) {
      const x = -b.width / 2 + 1.6 + ((b.width - 3.2) * i) / (brackets - 1);
      const curl = new THREE.TorusGeometry(0.95, 0.14, 6, 12, Math.PI);
      curl.rotateY(Math.PI / 2);
      curl.translate(x, cy - 1.7, fz + 0.85);
      curl.applyMatrix4(buildingMatrix);
      put(black, curl);
      box(black, x, cy - 1.15, fz + 0.7, 0.36, 1.1, 0.4);
    }
    box(black, 0, cy, fz + 1.05, b.width + 1.6, 2.15, 1.85);
    box(black, 0, cy + 1.35, fz + 0.55, b.width + 0.7, 0.7, 1.05);
    for (const x of [-b.width / 2 - 0.15, b.width / 2 + 0.15]) {
      box(black, x, cy + 1.7, fz + 0.7, 0.45, 1.3, 0.45);
      const fin = new THREE.SphereGeometry(0.32, 10, 8);
      fin.translate(x, cy + 2.5, fz + 0.7);
      fin.applyMatrix4(buildingMatrix);
      put(black, fin);
    }
    const dormY = cy + 1.2;
    box(black, 0, dormY + 1.8, fz + 0.85, 6.8, 3.4, 0.9);
    box(black, 0, dormY + 3.8, fz + 0.75, 3.6, 1.5, 0.75);
    box(black, 0, dormY + 4.8, fz + 0.7, 0.7, 0.9, 0.45);
    const roundMat = new THREE.MeshStandardMaterial({ color: "#f7f4ee", roughness: 0.75 });
    const roundWin = new THREE.CylinderGeometry(0.48, 0.48, 0.14, 18);
    roundWin.rotateX(Math.PI / 2);
    roundWin.translate(0, dormY + 1.85, fz + 1.35);
    roundWin.applyMatrix4(buildingMatrix);
    put(roundMat, roundWin);
    const roundRim = new THREE.TorusGeometry(0.48, 0.08, 6, 18);
    roundRim.translate(0, dormY + 1.85, fz + 1.45);
    roundRim.applyMatrix4(buildingMatrix);
    put(black, roundRim);
    const crest = new THREE.SphereGeometry(0.28, 10, 8);
    crest.translate(0, dormY + 5.35, fz + 0.7);
    crest.applyMatrix4(buildingMatrix);
    put(black, crest);
    return wallH + 8;
  };

  // 292 West Hurst, the 2010 photograph: brick first story, slate mansard, arched porch.
  const addHurst292 = (b) => {
    const brickH = 11.4;
    const body = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.92 });
    {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      const g = canvas.getContext("2d");
      g.fillStyle = "#9A7A68";
      g.fillRect(0, 0, 128, 64);
      const shades = ["#7A4030", "#814433", "#7A4030", "#733c2e"];
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 32 : 0;
        for (let col = -1; col < 5; col++) {
          g.fillStyle = shades[(row + col + 4) % shades.length];
          g.fillRect(col * 32 + off + 1, row * 16 + 1, 30, 14);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      body.map = tex;
      body.userData.uvFeet = { u: 4, v: 2 };
    }
    const slate = new THREE.MeshStandardMaterial({ color: "#5B6878", roughness: 0.8, metalness: 0.06 });
    slate.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSlateW;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSlateW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
varying vec3 vSlateW;
float sHash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          diffuseColor.rgb *= mix(0.84, 1.1, sHash(floor(vSlateW.xz * 1.8 + vSlateW.y)));`);
    };
    slate.customProgramCacheKey = () => "slate-5b6878";
    const fz = b.depth / 2;
    const base = 2;
    buildingMatrix.premultiply(new THREE.Matrix4().makeTranslation(0, base, 0));
    box(body, 0, -base / 2, 0, b.width + 0.35, base, b.depth + 0.35);
    box(body, 0, brickH / 2, 0, b.width, brickH, b.depth);
    const mansardH = 9.84;
    const band = new THREE.MeshStandardMaterial({ color: "#f6f3ec", roughness: 0.68 });
    box(band, 0, brickH + 0.32, 0, b.width + 0.9, 0.62, b.depth + 0.9);
    box(band, 0, brickH - 0.05, fz + 0.42, b.width + 0.5, 0.32, 0.62);
    box(slate, 0, brickH + 0.7 + mansardH / 2, b.depth / 2 - 0.05, b.width - 0.2, mansardH, 0.7);
    box(slate, 0, brickH + 0.7 + mansardH / 2, -b.depth / 2 + 0.05, b.width - 0.2, mansardH, 0.7);
    box(slate, b.width / 2 - 0.05, brickH + 0.7 + mansardH / 2, 0, 0.7, mansardH, b.depth - 0.2);
    box(slate, -b.width / 2 + 0.05, brickH + 0.7 + mansardH / 2, 0, 0.7, mansardH, b.depth - 0.2);
    const pyramidRise = 7.4;
    const putPyr = (yaw, eaveX, eaveZ, span, run) => {
      const length = Math.hypot(run, pyramidRise);
      const geo = new THREE.BoxGeometry(span, 0.36, length);
      geo.translate(0, 0, -length / 2);
      geo.rotateX(Math.atan2(pyramidRise, run));
      geo.rotateY(yaw);
      geo.translate(eaveX, brickH + 0.7 + mansardH, eaveZ);
      geo.applyMatrix4(buildingMatrix);
      put(slate, geo);
    };
    putPyr(0, 0, b.depth / 2, b.width + 0.8, b.depth / 2);
    putPyr(Math.PI, 0, -b.depth / 2, b.width + 0.8, b.depth / 2);
    putPyr(Math.PI / 2, b.width / 2, 0, b.depth + 0.8, b.width / 2);
    putPyr(-Math.PI / 2, -b.width / 2, 0, b.depth + 0.8, b.width / 2);
    const archX = -2;
    const openW = b.width * 0.4;
    const rad = openW / 2;
    const spring = 0.85;
    const porchD = 8.2;
    const porchFront = fz + porchD;
    const pier = 1.35;
    const porchRoofY = brickH;
    const archTrim = mats.stone.clone();
    archTrim.color.set("#e7dccb");
    box(body, archX - openW / 2 - pier / 2, (brickH - base) / 2, fz + porchD / 2, pier, brickH + base, porchD);
    box(body, archX + openW / 2 + pier / 2, (brickH - base) / 2, fz + porchD / 2, pier, brickH + base, porchD);
    const crown = spring + rad;
    box(body, archX, (crown + porchRoofY) / 2 + 0.15, porchFront - 0.5, openW + 0.4, Math.max(0.8, porchRoofY - crown), 1.4);
    for (let i = 0; i < 16; i++) {
      const ang = (Math.PI * (i + 0.5)) / 16;
      const geo = new THREE.BoxGeometry(1.55, 0.85, 1.35);
      geo.rotateZ(ang - Math.PI / 2);
      geo.translate(archX + Math.cos(ang) * (rad + 0.15), spring + Math.sin(ang) * (rad + 0.15), porchFront - 0.2);
      geo.applyMatrix4(buildingMatrix);
      put(archTrim, geo);
    }
    box(mats.plank, archX, 0.22, fz + porchD / 2, openW - 0.4, 0.18, porchD - 0.6);
    box(mats.trim, archX - 2.4, 4.2, fz + 0.7, 2.6, 7.0, 0.2);
    box(mats.glass, archX - 2.4, 5.8, fz + 0.86, 1.0, 2.4, 0.06);
    frontSash(archX + 2.6, 5.2, fz + 0.35, 2.6, 4.6, "flat", false, mats.trim);
    const leftEdge = -b.width / 2 + 0.4;
    const rightEdge = archX + openW / 2 + pier;
    const roofMid = (leftEdge + rightEdge) / 2;
    const roofW = rightEdge - leftEdge;
    box(body, roofMid, porchRoofY - 0.15, fz + porchD / 2, roofW, 0.36, porchD + 0.3);
    box(mats.plank, (leftEdge + archX - openW / 2) / 2, 0.28, fz + porchD * 0.55, archX - openW / 2 - leftEdge, 0.16, porchD - 0.8);
    box(mats.trim, roofMid, porchRoofY + 0.22, porchFront + 0.2, roofW + 0.4, 0.42, 0.36);
    box(mats.trim, leftEdge - 0.1, porchRoofY + 0.22, fz + porchD / 2, 0.36, 0.42, porchD + 0.5);
    const colXs = [-18.2, -15.1, -12.2];
    for (const x of colXs) {
      const col = new THREE.CylinderGeometry(0.28, 0.34, 10.8, 12);
      col.translate(x, 5.7, porchFront + 0.2);
      col.applyMatrix4(buildingMatrix);
      put(band, col);
    }
    const railZ = porchFront + 0.35;
    box(band, (colXs[0] + colXs[2]) / 2, 3.15, railZ, colXs[2] - colXs[0], 0.16, 0.14);
    box(band, (colXs[0] + colXs[2]) / 2, 1.7, railZ, colXs[2] - colXs[0], 0.14, 0.12);
    for (let i = 0; i < 9; i++) {
      const x = colXs[0] + ((colXs[2] - colXs[0]) * i) / 8;
      box(band, x, 2.4, railZ, 0.1, 1.5, 0.1);
    }
    const bayX = 12.2;
    const bayProj = 5.2;
    const bayFront = fz + bayProj;
    const bayW = 10.4;
    box(body, bayX, (brickH - base) / 2, fz + bayProj / 2, bayW, brickH + base, bayProj);
    for (const dx of [-3.2, 0, 3.2]) frontSash(bayX + dx, 5.4, bayFront + 0.05, 2.15, 4.6, "flat", false, mats.trim);
    const pairX = -8.2;
    const pairY = brickH + 0.9 + mansardH * 0.48;
    box(band, pairX, pairY, fz + 0.42, 6.2, 5.6, 0.28);
    for (const dx of [-1.45, 1.45]) {
      box(mats.glass, pairX + dx, pairY, fz + 0.62, 1.7, 4.2, 0.06);
      box(band, pairX + dx - 0.95, pairY, fz + 0.58, 0.16, 4.5, 0.12);
      box(band, pairX + dx + 0.95, pairY, fz + 0.58, 0.16, 4.5, 0.12);
    }
    const towerTop = brickH + mansardH + 4.2;
    const towerFace = bayFront + 3.1;
    box(slate, bayX, brickH + 1.6, towerFace + 0.15, bayW + 1.6, 2.8, 1.8);
    box(slate, bayX, (brickH + 2.4 + towerTop) / 2, towerFace - 1.5, bayW, towerTop - brickH - 2.4, 2.6);
    const capProfile = [
      [0, 0],
      [bayW * 0.46, 0],
      [bayW * 0.62, 0.45],
      [bayW * 0.58, 1.15],
      [bayW * 0.4, 2.15],
      [bayW * 0.28, 3.15],
      [bayW * 0.12, 3.9],
      [0, 4.45],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const cap = new THREE.LatheGeometry(capProfile, 28);
    cap.translate(bayX, towerTop - 0.6, towerFace - 1.3);
    cap.applyMatrix4(buildingMatrix);
    put(slate, cap);
    const finial = new THREE.SphereGeometry(0.32, 12, 10);
    finial.translate(bayX, towerTop + 3.9, towerFace - 1.3);
    finial.applyMatrix4(buildingMatrix);
    put(slate, finial);
    const archCrown = brickH + mansardH + 2.2;
    const archRad = 2.55;
    const archSpring = archCrown - archRad;
    const glassH = archSpring - (brickH + 2.4);
    box(mats.glass, bayX, brickH + 2.4 + glassH / 2, towerFace + 0.08, 4.5, glassH, 0.06);
    box(band, bayX - 2.5, brickH + 2.4 + glassH / 2, towerFace + 0.16, 0.3, glassH, 0.16);
    box(band, bayX + 2.5, brickH + 2.4 + glassH / 2, towerFace + 0.16, 0.3, glassH, 0.16);
    const dormArch = new THREE.TorusGeometry(archRad, 0.26, 10, 24, Math.PI);
    dormArch.translate(bayX, archSpring, towerFace + 0.18);
    dormArch.applyMatrix4(buildingMatrix);
    put(band, dormArch);
    const fan = new THREE.CircleGeometry(archRad * 0.84, 18, 0, Math.PI);
    fan.translate(bayX, archSpring, towerFace + 0.1);
    fan.applyMatrix4(buildingMatrix);
    put(mats.glass, fan);
    const dormL = -9.2;
    const dormY = brickH + mansardH + 2.8;
    const dormZ = b.depth / 2 - 2.4;
    box(band, dormL, dormY, dormZ, 5.4, 2.6, 1.5);
    drawPediment(band, 5.6, 2.1, dormY + 1.15, dormZ + 0.4, dormL);
    for (let i = 0; i < 4; i++) {
      box(mats.stone, archX, -base + 0.32 + i * 0.5, porchFront + 0.7 + i * 0.95, 8.8, 0.46, 1.0);
    }
    const lawn = new THREE.MeshStandardMaterial({ color: "#6d9448", roughness: 0.96 });
    box(lawn, 0, -base + 0.1, fz + 30, b.width + 40, 0.18, 74);
    const walkMat = new THREE.MeshStandardMaterial({ color: "#efeae2", roughness: 0.9 });
    box(walkMat, archX, -base + 0.24, porchFront + 28, 5.4, 0.16, 50);
    const shrub = mats.leaf.clone();
    shrub.color.set("#3d6a34");
    const clumps = [
      [-18.2, fz + 2.4, 0.85],
      [-15.2, fz + 2.1, 0.7],
      [-11.6, fz + 2.3, 0.75],
      [7.2, fz + 2.2, 0.7],
      [16.4, fz + 2.4, 0.8],
      [19.2, fz + 2.1, 0.65],
    ];
    for (const [x, z, s] of clumps) {
      for (const [dx, dy, dz, sc] of [
        [0, 0.85, 0, 1],
        [0.55, 0.5, 0.25, 0.72],
        [-0.45, 0.48, 0.2, 0.66],
      ]) {
        const geo = new THREE.SphereGeometry(s * sc, 12, 10);
        geo.translate(x + dx * s, -base + dy * s, z + dz * s);
        geo.applyMatrix4(buildingMatrix);
        put(shrub, geo);
      }
    }
    for (const spot of [new THREE.Vector3(-b.width * 0.72, -base, fz + 2.2), new THREE.Vector3(b.width * 0.72, -base, fz + 1.4)]) {
      spot.applyMatrix4(buildingMatrix);
      extraTrees.push({ x: spot.x, z: spot.z, kind: "maple", scale: 1.55 });
    }
    return brickH + mansardH + pyramidRise + 2;
  };

  // 304 West Hurst, the Hendee Home photograph: Italianate, belvedere, stacked porch.
  const addHendeeHome = (b) => {
    const body = mats.siding.darkred;
    const plate = 24;
    box(mats.stone, 0, 2.2, 0, b.width + 1, 4.4, b.depth + 1);
    box(body, 0, plate / 2 + 3.2, 0, b.width, plate, b.depth);
    gable(b.width, b.depth, 7, plate + 4, mats.roof);
    box(mats.trim, 0, plate + 3.6, b.depth / 2 + 0.1, b.width + 0.4, 0.35, 0.4);
    bracketRow(plate + 3.1, b.depth / 2, b.width);
    const fz = b.depth / 2;
    box(body, 0, plate + 8, fz - 1, b.width * 0.42, 7, 1.2);
    box(mats.trim, 0, plate + 10.2, fz + 0.1, 2.2, 2.2, 0.16);
    box(mats.glass, 0, plate + 10.2, fz + 0.2, 1.3, 1.3, 0.05);
    box(body, 0, plate + 11, -1, 12, 6, 10);
    box(mats.trim, 0, plate + 14.2, -1, 12.6, 0.7, 10.6);
    for (const x of [-5.4, 5.4]) box(mats.trim, x, plate + 12.2, 4.2, 0.2, 2.2, 0.2);
    const cols = 3;
    for (let floor = 0; floor < 2; floor++) {
      const y = 7.5 + floor * 9;
      for (let i = 0; i < cols; i++) {
        const x = -b.width * 0.28 + i * b.width * 0.28;
        frontSash(x, y, fz, 2.1, 6.6, "flat", true, mats.trim, true);
      }
    }
    const pz = fz + 5;
    box(mats.plank, 0, 4.6, pz, b.width * 0.72, 0.3, 8);
    box(mats.plank, 0, 13.2, pz, b.width * 0.68, 0.24, 7.4);
    for (let i = 0; i < 4; i++) {
      const x = -b.width * 0.3 + i * (b.width * 0.2);
      box(mats.trim, x, 9, pz + 3, 0.42, 8.4, 0.42);
    }
    box(mats.trim, 0, 13.4, pz + 3.4, b.width * 0.64, 0.7, 0.16);
    box(mats.trim, b.width * 0.42, 6.5, pz + 2, 0.8, 0.2, 6);
    box(mats.trim, b.width * 0.42, 5.2, pz + 4, 0.8, 0.2, 3);
    box(body, -b.width * 0.1, 8, -b.depth * 0.35, b.width * 0.55, 12, 8);
    box(mats.plank, -b.width * 0.1, 4.2, -b.depth * 0.55, b.width * 0.4, 0.22, 5);
    const treeL = new THREE.Vector3(-b.width * 0.8, 0, fz + 8);
    const treeR = new THREE.Vector3(b.width * 0.9, 0, fz + 4);
    for (const spot of [treeL, treeR]) {
      spot.applyMatrix4(buildingMatrix);
      extraTrees.push({ x: spot.x, z: spot.z, kind: "maple", scale: 1.35 });
    }
    const pine = new THREE.ConeGeometry(5, 16, 7);
    pine.applyMatrix4(new THREE.Matrix4().makeTranslation(b.width * 0.85, 10, -b.depth * 0.2));
    pine.applyMatrix4(buildingMatrix);
    put(mats.leafDark, pine);
    signFor(b, 14);
    return plate + 18;
  };

  // Undated junction photograph: two dark gabled sections, platform, order board.
  const addJunctionDepot = (b) => {
    const body = mats.brick.dark;
    const wallH = 14;
    box(body, -b.width * 0.18, wallH / 2, 0, b.width * 0.62, wallH, b.depth);
    box(body, b.width * 0.28, wallH / 2 - 1, 4, b.width * 0.42, wallH - 2, b.depth * 0.8);
    wideGable(b.width * 0.62, b.depth, 5.5, wallH, 4.2);
    gable(b.width * 0.42, b.depth * 0.8, 4.2, wallH - 2, mats.roofDark);
    eaveBrackets(b.width * 0.9, b.depth, wallH - 1);
    const fz = b.depth / 2;
    frontSash(-b.width * 0.28, 7, fz, 2.6, 5, "flat");
    frontSash(-b.width * 0.08, 7, fz, 2.6, 5, "flat");
    box(mats.trimDark, b.width * 0.22, 4.6, fz + 0.2, 4, 8, 0.2);
    chimneyStack(mats.brick.red, -b.width * 0.05, wallH + 2, -2, 1.8, 4.5, 1.8);
    chimneyStack(mats.brick.dark, b.width * 0.22, wallH + 1, 2, 1.6, 3.6, 1.6);
    box(mats.ballast, 0, 0.2, fz + 8, b.width + 20, 0.3, 16);
    box(mats.trim, -b.width * 0.2, wallH + 2.4, fz + 0.3, 10, 1.4, 0.2);
    box(mats.trunk, b.width * 0.05, 14, fz + 10, 0.7, 28, 0.7);
    box(mats.trim, b.width * 0.05, 26, fz + 12, 6, 0.2, 0.8);
    box(mats.trunk, -b.width * 0.55, 12, fz + 14, 0.55, 24, 0.55);
    for (let i = 0; i < 4; i++) {
      box(mats.trunk, -b.width * 0.55, 20 + i * 1.1, fz + 14, 6, 0.16, 0.2);
    }
    signFor(b, wallH + 1);
    return 24;
  };

  const addChurch = (b) => {
    if (b.id === "reformed-church") return addReformedChurch(b);
    const wallH = 20;
    const body = b.material === "brick" ? brickOf(b) : paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.6, 0, b.width + 0.6, 1.2, b.depth + 0.6);
    gable(b.width, b.depth, b.width * 0.48, wallH, mats.roofDark);
    // Tall side windows.
    for (let i = 0; i < 4; i++) {
      const z = -b.depth * 0.32 + i * (b.depth * 0.2);
      for (const x of [-b.width / 2 - 0.1, b.width / 2 + 0.1]) {
        box(mats.trim, x, 10, z, 0.2, 10, 2.4);
        box(mats.glass, x, 10, z, 0.12, 9, 1.8);
      }
    }
    box(mats.trimDark, 0, 5, b.depth / 2 + 0.2, 5, 9, 0.3);
    if (b.steeple !== false) {
      const tz = b.depth / 2 - 6;
      box(body, 0, 28, tz, 12, 36, 12);
      box(mats.trim, 0, 18, tz + 6.2, 4, 8, 0.2);
      const cone = new THREE.ConeGeometry(8.5, 18, 4);
      cone.rotateY(Math.PI / 4);
      cone.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 54, tz));
      cone.applyMatrix4(buildingMatrix);
      put(mats.roofDark, cone);
    }
    signFor(b, 16);
    return 70;
  };

  // Deep eaves, the way both depot photographs read from the platform.
  const wideGable = (width, depth, rise, yBase, overhang) => {
    const run = depth / 2 + overhang;
    const slopeLen = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run);
    const roofW = width + 2.6;
    for (const sign of [1, -1]) {
      const geo = new THREE.BoxGeometry(roofW, 0.42, slopeLen);
      scaleBoxUVs(geo, roofW, 0.42, slopeLen, mats.tin);
      const local = new THREE.Matrix4().makeRotationX(sign * angle);
      local.premultiply(new THREE.Matrix4().makeTranslation(0, yBase + rise / 2, sign * (run / 2)));
      geo.applyMatrix4(local);
      geo.applyMatrix4(buildingMatrix);
      put(mats.tin, geo);
    }
  };

  const eaveBrackets = (width, depth, y) => {
    const count = Math.max(5, Math.round(width / 8));
    for (const z of [-depth / 2, depth / 2]) {
      for (let i = 0; i < count; i++) {
        const x = -width / 2 + (width * (i + 0.5)) / count;
        box(mats.trimDark, x, y, z, 0.35, 1.3, 1.5);
      }
    }
  };

  // The wooden CB&Q depot in the photograph of it being moved. That is the 1880 station.
  const addCbqDepot = (b) => {
    const wallH = 14;
    const body = paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.45, 0, b.width + 0.5, 0.9, b.depth + 0.5);
    wideGable(b.width, b.depth, 7.5, wallH, 5.2);
    eaveBrackets(b.width, b.depth, wallH - 0.3);
    const fz = b.depth / 2;
    // Operator's bay, centered on the track side.
    // Trackside bay, three faces of glass, set on the long wall.
    box(body, 0, 8.2, fz + 2.4, 16, 14.6, 4.8);
    for (const x of [-4.4, 0, 4.4]) frontSash(x, 8.2, fz + 4.9, 2.7, 6.2, "flat");
    sideSash(8.1, 8.2, fz + 2.4, 1, 2.2, 5.4, "flat");
    sideSash(-8.1, 8.2, fz + 2.4, -1, 2.2, 5.4, "flat");
    box(mats.trimDark, 0, 3.5, fz + 4.9, 3.1, 6.2, 0.14);
    const openings = Math.max(5, Math.round(b.width / 11));
    for (let i = 0; i < openings; i++) {
      const x = -b.width / 2 + 5 + ((b.width - 10) * i) / (openings - 1);
      if (Math.abs(x) < 10) continue;
      const end = i === 0 || i === openings - 1;
      if (end) {
        box(mats.trimDark, x, 4.5, fz + 0.16, 3.2, 8.0, 0.2);
        box(mats.glass, x, 6.4, fz + 0.26, 1.15, 2.1, 0.05);
      } else {
        frontSash(x, 7.5, fz + 0.12, 2.6, 5.6, "flat");
      }
    }
    box(mats.plank, 0, 0.55, fz + 7.2, b.width + 16, 0.4, 12);
    chimneyStack(mats.brick.red, b.width * 0.38, wallH + 5.2, 0, 2.4, 9, 2.4);
    downspouts(b.width, b.depth, wallH);
    signFor(b, 12);
    return 28;
  };

  // 1914 T. & P. W. postcard: board-and-batten, deep eaves, a bay, a cinder platform.
  const addTpwDepot = (b) => {
    const wallH = 13;
    const body = paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    for (const side of [-1, 1]) {
      const x = side * (b.width / 2 + 0.04);
      const boards = Math.max(6, Math.round(b.depth / 3.2));
      for (let i = 0; i < boards; i++) {
        const z = -b.depth / 2 + ((i + 0.5) * b.depth) / boards;
        box(mats.trimDark, x, wallH / 2, z, 0.1, wallH, 0.16);
      }
    }
    const frontBoards = Math.max(8, Math.round(b.width / 2.8));
    for (let i = 0; i < frontBoards; i++) {
      const x = -b.width / 2 + ((i + 0.5) * b.width) / frontBoards;
      box(mats.trimDark, x, wallH / 2, b.depth / 2 + 0.08, 0.14, wallH, 0.1);
    }
    box(mats.stone, 0, 0.35, 0, b.width + 0.5, 0.7, b.depth + 0.5);
    wideGable(b.width, b.depth, 7.4, wallH - 0.2, 5.2);
    eaveBrackets(b.width, b.depth, wallH - 0.2);
    const fz = b.depth / 2;
    const openings = Math.max(5, Math.round(b.width / 13));
    for (let i = 0; i < openings; i++) {
      const x = -b.width / 2 + (b.width * (i + 0.5)) / openings;
      const door = i === 1 || i === openings - 2;
      if (door) {
        box(mats.trimDark, x, 4.4, fz + 0.16, 3.6, 8, 0.18);
        box(mats.glass, x, 6.8, fz + 0.24, 1.4, 1.4, 0.05);
      } else if (i === Math.floor(openings / 2)) {
        box(body, x, 6.2, fz + 2.2, 7.2, 8.4, 4.2);
        for (const dx of [-1.6, 1.6]) frontSash(x + dx, 6.4, fz + 4.4, 1.7, 4.2, "flat");
      } else {
        frontSash(x, 6.8, fz + 0.12, 2.4, 4.4, "flat");
      }
    }
    box(mats.ballast, 0, 0.22, fz + 6.2, b.width + 16, 0.28, 12);
    chimneyStack(mats.brick.red, b.width * 0.28, wallH + 4.2, -2, 2.1, 5.4, 2.1);
    box(mats.trimDark, 0, wallH + 7.6, 0, 0.28, 3.2, 0.28);
    box(mats.trim, 0, wallH + 9.3, 0, 1.1, 0.28, 1.1);
    const shedX = b.width / 2 + 16;
    box(body, shedX, 5.5, 2, 14, 11, 12);
    gable(14, 12, 3.4, 11, mats.roofDark);
    frontSash(shedX, 5.2, 8.2, 2.2, 3.4, "flat");
    box(mats.trunk, -b.width / 2 - 8, 12, fz + 8, 0.7, 24, 0.7);
    box(mats.trunk, -b.width / 2 - 8, 23, fz + 8, 8, 0.28, 0.35);
    extraTrees.push({ x: b.x + b.width * 0.42, z: b.z + 18, kind: "maple", scale: 1.7 });
    extraTrees.push({ x: b.x + b.width * 0.62, z: b.z + 8, kind: "elm", scale: 1.55 });
    downspouts(b.width, b.depth, wallH);
    signFor(b, 11);
    return 26;
  };

  const addDepot = (b) => (b.id === "tpw-depot" ? addTpwDepot(b) : addCbqDepot(b));

  // Hotel Alexander photograph of the 1871 Hendee House: three brick stories, cornice, porch.
  const addHendeeHouse = (b) => {
    const wallH = 36;
    const body = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 });
    {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 128;
      const g = canvas.getContext("2d");
      g.fillStyle = "#b7ad9e";
      g.fillRect(0, 0, 256, 128);
      const bw = 64;
      const bh = 32;
      const mortar = 5;
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < 5; col++) {
          const n = ((row * 4 + col * 3) % 5) - 2;
          g.fillStyle = `rgb(${207 + n * 3}, ${195 + n * 2}, ${170 + n * 2})`;
          g.fillRect(col * bw + off + mortar, row * bh + mortar, bw - mortar * 2, bh - mortar * 2);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      body.map = tex;
      body.userData.uvFeet = { u: 2.6, v: 1.3 };
    }
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.7, 0, b.width + 0.4, 1.4, b.depth + 0.4);
    const fz = b.depth / 2 + 0.16;
    box(mats.trim, 0, wallH - 0.45, fz, b.width + 1.4, 1.5, 1.15);
    const brackets = 15;
    for (let i = 0; i < brackets; i++) {
      const x = -b.width / 2 + (b.width * (i + 0.5)) / brackets;
      box(mats.trimDark, x, wallH - 2.1, fz + 0.35, 0.45, 1.7, 0.85);
    }
    // Hotel Alexander postcard: round-arched hoods on every floor, iron balconies.
    const bays = 7;
    const gap = b.width / bays;
    const ironRail = (x, y, z, w) => {
      box(mats.metal, x, y, z, w, 0.1, 0.1);
      box(mats.metal, x, y + 1.35, z, w, 0.08, 0.08);
      const n = Math.max(3, Math.round(w / 1.15));
      for (let i = 0; i < n; i++) {
        const px = x - w / 2 + (w * (i + 0.5)) / n;
        box(mats.metal, px, y + 0.68, z, 0.06, 1.25, 0.06);
      }
    };
    for (let col = 0; col < bays; col++) {
      const x = -b.width / 2 + gap * (col + 0.5);
      const door = col === 2 || col === 3;
      frontSash(x, door ? 6.4 : 6.2, fz, Math.min(2.8, gap - 1.4), door ? 8.6 : 7.6, "round", false, mats.trim);
      frontSash(x, 18.2, fz, Math.min(2.6, gap - 1.5), 7.4, "round", false, mats.trim);
      frontSash(x, 29.2, fz, Math.min(2.4, gap - 1.6), 6.6, "round", false, mats.trim);
    }
    const deckZ = b.depth / 2 + 2.8;
    box(mats.metal, 0, 13.15, deckZ, b.width * 0.96, 0.14, 4.6);
    ironRail(0, 13.3, deckZ + 2.05, b.width * 0.94);
    const aw = b.width * 0.36;
    const ax = -b.width * 0.3;
    const stripes = 10;
    for (let i = 0; i < stripes; i++) {
      localBox(
        i % 2 ? mats.siding.white : mats.trimDark,
        ax - aw / 2 + ((i + 0.5) * aw) / stripes,
        16.4,
        deckZ + 0.2,
        aw / stripes - 0.05,
        0.14,
        4.8,
        -0.55,
      );
    }
    chimneyStack(body, -b.width * 0.32, wallH + 0.6, -6, 2.4, 6.2, 2.4);
    chimneyStack(body, b.width * 0.24, wallH + 0.4, 4, 2.1, 5.2, 2.1);
    downspouts(b.width, b.depth, wallH);
    signFor(b, wallH);
    return wallH + 8;
  };

  const addElevator = (b) => {
    const body = paintOf(b);
    const h = 48;
    const cribD = b.depth * 0.62;
    box(body, 0, h / 2, 0, b.width, h, cribD);
    // Headhouse, narrower, with the gable end toward the street the hotel faces.
    box(body, 0, h + 7, 0, b.width * 0.55, 14, cribD * 0.72);
    gable(b.width * 0.55, cribD * 0.72, 7, h + 14, mats.tin);
    if (b.facade?.cupola) {
      box(body, 0, h + 20, 0, b.width * 0.2, 7, cribD * 0.28);
      for (const x of [-b.width * 0.1 - 0.05, b.width * 0.1 + 0.05]) {
        box(mats.trim, x, h + 20, 0, 0.12, 2.4, 1.6);
        box(mats.glass, x, h + 20, 0, 0.08, 1.8, 1.1);
      }
      box(mats.roofDark, 0, h + 24, 0, b.width * 0.28, 1.0, cribD * 0.38);
    }
    // Shaft windows on both long faces, the way the trackside views read.
    for (const side of [-1, 1]) {
      const x = side * (b.width / 2 + 0.06);
      for (let i = 0; i < 6; i++) {
        const y = 8 + i * 6.6;
        box(mats.trim, x, y, 0, 0.14, 2.6, 1.8);
        box(mats.glass, x + side * 0.06, y, 0, 0.06, 2.0, 1.2);
      }
    }
    // Driveway shed on the track side, with an open wagon mouth.
    const shedZ = b.depth * 0.38;
    box(mats.siding.gray, 0, 7.5, shedZ, b.width + 2, 15, 16);
    gable(b.width + 2, 16, 4.5, 15, mats.tin);
    box(mats.trimDark, 0, 5.2, shedZ + 8.1, 11, 9.2, 0.18);
    box(mats.coal, 0, 4.6, shedZ + 7.6, 9.2, 7.6, 0.3);
    signFor(b, h - 4);
    return h + 26;
  };

  const addMill = (b) => {
    const wallH = b.stories * 13;
    const body = b.material === "brick" ? brickOf(b) : paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    gable(b.width, b.depth, 8, wallH, mats.tin);
    box(mats.brick.dark, b.width / 2 + 3, 22, -b.depth * 0.2, 4, 44, 4);
    box(mats.brick.red, b.width / 2 + 3, 46, -b.depth * 0.2, 5, 3, 5);
    punch(b.width, b.depth, b.stories, 13, wallH, [], false);
    signFor(b, wallH - 2);
    return 50;
  };

  const addBarn = (b) => {
    const wallH = 18;
    const body = paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    gable(b.width, b.depth, 10, wallH, mats.roofDark);
    box(mats.trimDark, 0, 6, b.depth / 2 + 0.15, 10, 11, 0.25);
    box(body, b.width * 0.36, 7, 0, 14, 12, b.depth + 1);
    gable(14, b.depth + 1, 5, 13, mats.roofDark);
    signFor(b, 14);
    return 30;
  };

  // East Side School, opened in the winter of 1904, after the 1875 building burned in 1896.
  const addEastSideSchool = (b) => {
    const body = mats.brick.red;
    const base = 8;
    const floor = 11;
    const stories = 3;
    const wall = base + stories * floor;
    box(mats.stone, 0, base / 2, 0, b.width + 1.6, base, b.depth + 1.6);
    box(body, 0, base + (stories * floor) / 2, 0, b.width, stories * floor, b.depth);
    for (let s = 1; s <= stories; s++) {
      box(mats.stone, 0, base + s * floor, 0, b.width + 0.4, 0.45, b.depth + 0.4);
    }
    hipRoof(b.width, b.depth, 8, wall, mats.roofDark, 0, 0);
    const fz = b.depth / 2 + 0.12;
    const cols = 5;
    for (let c = 0; c < cols; c++) {
      const x = -b.width * 0.28 + (c * b.width * 0.56) / (cols - 1);
      box(mats.glass, x, base * 0.45, fz, 3.2, 2.2, 0.06);
      box(mats.stone, x, base * 0.45 - 1.3, fz + 0.08, 3.8, 0.28, 0.2);
      for (let s = 0; s < stories; s++) {
        const y = base + s * floor + floor * 0.55;
        for (const dx of [-1.35, 1.35]) {
          box(mats.trim, x + dx, y, fz, 2.1, 6.4, 0.12);
          box(mats.glass, x + dx, y, fz + 0.06, 1.5, 5.2, 0.05);
          box(mats.stone, x + dx, y - 3.5, fz + 0.1, 2.5, 0.28, 0.22);
        }
      }
    }
    const tx = b.width / 2 - 9;
    const tz = fz - 8;
    box(body, tx, 22, tz, 18, 44, 18);
    box(mats.stone, tx, 1.2, tz, 19.2, 2.4, 19.2);
    for (const side of [-1, 1]) {
      box(mats.stone, tx + side * 8.6, 22, tz, 1.1, 40, 18.4);
      box(mats.stone, tx, 22, tz + side * 8.6, 18.4, 40, 1.1);
    }
    box(mats.stone, tx, 6.2, tz + 9.2, 8, 10, 2.4);
    box(mats.trimDark, tx, 5.4, tz + 10.2, 5.2, 8.2, 0.2);
    archHood(mats.stone, tx, 9.2, tz + 10.3, 6.4, 3.2, "z");
    frontSash(tx - 2.2, 18, tz + 9.2, 2.4, 6.2, "round", false, mats.stone);
    frontSash(tx + 2.2, 18, tz + 9.2, 2.4, 6.2, "round", false, mats.stone);
    box(mats.trim, tx, 28, tz + 9.3, 3.4, 3.4, 0.16);
    box(mats.glass, tx, 28, tz + 9.4, 2.2, 2.2, 0.05);
    box(body, tx, 40, tz, 16, 10, 16);
    for (const face of [0, 1, 2, 3]) {
      const ang = face * Math.PI / 2;
      box(mats.trimDark, tx + Math.sin(ang) * 8.1, 40, tz + Math.cos(ang) * 8.1, face % 2 ? 6 : 0.2, 6, face % 2 ? 0.2 : 6);
    }
    const cap = new THREE.ConeGeometry(12, 14, 4);
    cap.rotateY(Math.PI / 4);
    cap.applyMatrix4(new THREE.Matrix4().makeTranslation(tx, 52, tz));
    cap.applyMatrix4(buildingMatrix);
    put(mats.roofDark, cap);
    chimneyStack(mats.brick.red, -b.width * 0.32, wall + 3, -b.depth * 0.2, 2.4, 7, 2.4);
    chimneyStack(mats.brick.red, b.width * 0.05, wall + 2, -b.depth * 0.25, 2.2, 6, 2.2);
    for (let i = 0; i < 8; i++) {
      const z = -b.depth / 2 + (i * b.depth) / 7;
      box(mats.metal, b.width / 2 + 6, 2.2, z, 0.12, 3.6, 0.12);
      box(mats.metal, b.width / 2 + 6, 3.8, z, 0.08, 0.08, 1.2);
    }
    const tree = new THREE.Vector3(-b.width * 0.7, 0, fz + 8);
    tree.applyMatrix4(buildingMatrix);
    extraTrees.push({ x: tree.x, z: tree.z, kind: "maple", scale: 1.6 });
    signFor(b, wall - 2);
    return wall + 16;
  };

  // The 1875 graded school: red brick on a stone basement that reads as an extra story.
  // The 1907 encyclopedia plate is the later West Side School, so it is not copied.
  const addSchool = (b) => {
    // A one-room country school. The town's graded school, below, is a different building.
    if (b.plan === "country") {
      const body = paintOf(b);
      const wallH = 12;
      box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
      gable(b.width, b.depth, 6.5, wallH, mats.roofDark);
      box(mats.trimDark, 0, 4.4, b.depth / 2 + 0.12, 3.4, 7.4, 0.12);
      box(mats.glass, -b.width * 0.28, 6.4, b.depth / 2 + 0.1, 2.6, 4.4, 0.08);
      box(mats.glass, b.width * 0.28, 6.4, b.depth / 2 + 0.1, 2.6, 4.4, 0.08);
      box(body, 0, wallH + 2.6, -b.depth * 0.12, 4.4, 4.6, 4.4);
      box(mats.roofDark, 0, wallH + 5.4, -b.depth * 0.12, 5.4, 1.4, 5.4);
      signFor(b, wallH);
      return wallH + 7;
    }
    const baseH = 10;
    const floorH = 12;
    const upper = b.stories * floorH;
    const wallH = baseH + upper;
    const body = brickOf(b);
    box(mats.stone, 0, baseH / 2, 0, b.width + 1.4, baseH, b.depth + 1.4);
    box(body, 0, baseH + upper / 2, 0, b.width, upper, b.depth);
    box(mats.stone, 0, baseH, 0, b.width + 1.6, 0.7, b.depth + 1.6);
    gable(b.width, b.depth, 9, wallH, mats.roofDark);
    const fz = b.depth / 2 + 0.16;
    box(mats.stone, 0, 0.45, fz + 3.4, 10, 0.9, 6.4);
    box(mats.trimDark, 0, baseH * 0.48, fz, 5.4, baseH * 0.82, 0.28);
    box(mats.glass, -1.05, baseH * 0.62, fz + 0.12, 1.3, 2.2, 0.05);
    box(mats.glass, 1.05, baseH * 0.62, fz + 0.12, 1.3, 2.2, 0.05);
    // Four classrooms a floor: four windows each side of the center doors.
    const bays = 9;
    const gap = b.width / bays;
    for (let col = 0; col < bays; col++) {
      if (col === 4) continue;
      const x = -b.width / 2 + gap * (col + 0.5);
      frontSash(x, baseH * 0.48, fz, 2.15, 3.6, "flat");
      frontSash(x, baseH + floorH * 0.55, fz, 2.35, 6.2, "segmental");
      if (b.stories > 1) frontSash(x, baseH + floorH * 1.55, fz, 2.35, 6.2, "segmental");
    }
    chimneyStack(mats.brick.red, -b.width * 0.38, wallH + 4, -b.depth * 0.12, 2.2, 8, 2.2);
    chimneyStack(mats.brick.red, b.width * 0.38, wallH + 4, -b.depth * 0.12, 2.2, 8, 2.2);
    downspouts(b.width, b.depth, wallH);
    // Cupola. Mark remembers one, and the East Side High School postcard shows a square belfry.
    const cup = 11;
    box(body, 0, wallH + cup / 2 + 0.6, 0, cup, cup, cup);
    box(mats.trim, 0, wallH + cup + 0.4, 0, cup + 0.8, 0.7, cup + 0.8);
    for (const side of [-1, 1]) {
      box(mats.trim, side * (cup / 2 + 0.06), wallH + 6.2, 0, 0.14, 3.4, 2.4);
      box(mats.glass, side * (cup / 2 + 0.12), wallH + 6.2, 0, 0.08, 2.4, 1.6);
      box(mats.trim, 0, wallH + 6.2, side * (cup / 2 + 0.06), 2.4, 3.4, 0.14);
      box(mats.glass, 0, wallH + 6.2, side * (cup / 2 + 0.12), 1.6, 2.4, 0.08);
    }
    box(mats.roofDark, 0, wallH + cup + 2.4, 0, cup + 2, 2.2, cup + 2);
    box(mats.roofDark, 0, wallH + cup + 4.2, 0, 3.2, 2.2, 3.2);
    for (const side of [-1, 1]) {
      const x = side * (b.width / 2 + 0.1);
      const count = 4;
      for (let i = 0; i < count; i++) {
        const z = -b.depth / 2 + ((i + 0.5) * b.depth) / count;
        sideSash(x, baseH + floorH * 0.55, z, side, 2.3, 6.2, "segmental");
        if (b.stories > 1) sideSash(x, baseH + floorH * 1.55, z, side, 2.3, 6.2, "segmental");
      }
    }
    signFor(b, wallH - 1);
    return wallH + 10;
  };

  // C. S. Norcross factory, concrete block, corner of Dean and Davis, contract May 1906.
  const addNorcross = (b) => {
    const body = mats.stone;
    const wall = 26;
    box(body, 0, wall / 2, 0, b.width, wall, b.depth);
    box(body, 0, wall + 1.6, b.depth / 2 - 0.4, b.width + 0.6, 3.2, 1.4);
    box(body, 0, wall + 3.4, b.depth / 2 - 0.4, b.width * 0.42, 2.4, 1.6);
    for (const side of [-1, 1]) {
      box(body, side * (b.width / 2), wall / 2 + 1.2, 0, 1.6, wall + 2.4, b.depth + 0.4);
      box(body, side * (b.width / 2), wall + 2.6, b.depth * 0.15, 1.8, 4.2, 6);
    }
    const fz = b.depth / 2 + 0.1;
    const cols = 4;
    for (let i = 0; i < cols; i++) {
      const x = -b.width * 0.32 + (i * b.width * 0.64) / (cols - 1);
      frontSash(x, 8, fz, 2.6, 5.2, "flat", false, mats.stone);
      frontSash(x, 18.5, fz, 2.6, 5.2, "flat", false, mats.stone);
    }
    box(mats.roofDark, 0, 11.2, fz + 3.2, 12, 0.35, 6);
    for (const x of [-5, 5]) box(mats.trimDark, x, 5.6, fz + 5.6, 0.4, 10.4, 0.4);
    box(mats.trimDark, 0, 4.2, fz, 4.2, 7.6, 0.16);
    signFor(b, wall - 1);
    return wall + 6;
  };

  // A plain industrial block. No gable, chimney, or trim beyond the walls and a flat roof.
  const addPlainPlant = (b) => {
    const floors = Math.max(1, Number(b.stories) || 1);
    const h = floors * 14;
    const body = b.material === "brick" ? brickOf(b) : paintOf(b);
    box(body, 0, h / 2, 0, b.width, h, b.depth);
    box(mats.roofDark, 0, h + 0.25, 0, b.width + 0.8, 0.5, b.depth + 0.8);
    if (b.sign) signFor(b, h * 0.6);
    return h + 2;
  };

  const addShed = (b) => {
    const wallH = 12;
    const body = paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    gable(b.width, b.depth, 4, wallH, mats.roofDark);
    box(mats.trimDark, 0, 5, b.depth / 2 + 0.12, b.width * 0.45, 8, 0.2);
    signFor(b, 10);
    return 18;
  };

  const addFactory = (b) => {
    const wallH = 22;
    const body = paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    gable(b.width, b.depth, 6, wallH, mats.tin);
    punch(b.width, b.depth, 2, 11, wallH, [], false);
    box(mats.brick.dark, -b.width * 0.35, 20, b.depth * 0.2, 4, 40, 4);
    signFor(b, 18);
    return 42;
  };

  // 771 North Crafford, the 2010 photograph: brick foursquare, hipped roof, gabled dormer.
  const addFuneralHome = (b) => {
    const wallH = 24;
    const body = mats.brick.red.clone();
    body.color.set("#6e3228");
    const white = mats.trim.clone();
    white.color.set("#f3ead8");
    const roof = mats.roof.clone();
    roof.color.set("#5c6558");
    const fz = b.depth / 2;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 1.15, 0, b.width + 0.6, 2.3, b.depth + 0.6);
    box(white, 0, wallH - 0.35, 0, b.width + 10, 0.7, b.depth + 10);
    box(white, 0, wallH + 0.15, 0, b.width + 7.2, 0.42, b.depth + 7.2);
    hipRoof(b.width + 6, b.depth + 6, 3.2, wallH - 0.4, roof, 0, -1.5);
    dentilCourse(wallH - 0.95, fz + 1.7, b.width + 1.2);
    bracketRow(wallH - 1.45, fz + 1.05, b.width + 0.4);
    for (const side of [-1, 1]) {
      const x = side * (b.width / 2 + 1.5);
      const count = 6;
      for (let i = 0; i < count; i++) {
        const z = -b.depth / 2 + ((i + 0.5) * b.depth) / count;
        box(white, x, wallH - 1.35, z, 0.7, 0.7, 0.4);
      }
    }
    // Front, viewer's left to right, from the 2010 photograph. Local -x is the left.
    const front = b.facadeSpec?.front || [
      { id: "left-gable", width: 14 },
      { id: "center", width: 16 },
      { id: "right", width: 16 },
    ];
    const span = front.reduce((sum, bay) => sum + bay.width, 0) || b.width;
    let cursor = -b.width / 2;
    const placed = front.map((bay) => {
      const width = (bay.width / span) * b.width;
      const x = cursor + width / 2;
      cursor += width;
      return { ...bay, x, width };
    });
    const pair = (x, y, z, w, h, arch = "flat") => {
      frontSash(x - w * 0.28, y, z, w * 0.42, h, arch, false, white);
      frontSash(x + w * 0.28, y, z, w * 0.42, h, arch, false, white);
    };
    for (const bay of placed) {
      const zFace = bay.id === "left-gable" ? fz + 2.8 : fz + 0.2;
      if (bay.id === "left-gable") box(body, bay.x, 12, fz + 1.3, bay.width - 0.6, 22, 2.6);
      pair(bay.x, 17.2, zFace, Math.min(8.4, bay.width * 0.7), 6.2);
      pair(bay.x, 6.6, zFace, Math.min(8.4, bay.width * 0.7), 6.0);
    }
    const left = placed[0];
    const right = placed[placed.length - 1];
    // One front gable over the left bay. Its ridge runs back from the street.
    {
      const gx = left.x;
      const gw = Math.min(left.width, 13);
      const rise = 6.4;
      const y0 = wallH + 0.2;
      const faceZ = fz + 2.7;
      clapboardTriangle(white, gw, rise, y0, "z", faceZ, gx, faceZ);
      frontSash(gx, y0 + rise * 0.42, faceZ + 0.15, 2.4, 4.2, "round", false, white);
      frontSash(gx - 2.2, y0 + rise * 0.28, faceZ + 0.12, 1.5, 3.2, "flat", false, white);
      frontSash(gx + 2.2, y0 + rise * 0.28, faceZ + 0.12, 1.5, 3.2, "flat", false, white);
      const run = gw / 2;
      const slopeLen = Math.hypot(run, rise) * 0.98;
      const angle = Math.atan2(rise, run);
      for (const sign of [-1, 1]) {
        const barge = new THREE.BoxGeometry(slopeLen, 0.42, 0.22);
        for (let k = 0; k < 6; k++) {
          const tooth = new THREE.BoxGeometry(0.35, 0.45, 0.16);
          tooth.applyMatrix4(new THREE.Matrix4().makeRotationZ(-sign * angle));
          tooth.applyMatrix4(new THREE.Matrix4().makeTranslation(gx + sign * (0.6 + k * 0.85), y0 + 0.5 + k * 0.7, faceZ + 0.28));
          tooth.applyMatrix4(buildingMatrix);
          put(white, tooth);
        }
        const rake = new THREE.Matrix4().makeRotationZ(-sign * angle);
        rake.premultiply(new THREE.Matrix4().makeTranslation(gx + sign * run * 0.48, y0 + rise * 0.48, faceZ + 0.16));
        barge.applyMatrix4(rake);
        barge.applyMatrix4(buildingMatrix);
        put(white, barge);
      }
    }
    for (const side of [-1, 1]) {
      sideSash(side * (b.width / 2 + 0.12), 17.2, -4, side, 2.4, 5.4, "flat", false, white);
      sideSash(side * (b.width / 2 + 0.12), 6.4, 2, side, 2.3, 5.2, "flat", false, white);
    }
    const addPorch = (x, w, d) => {
      const zc = fz + d * 0.42;
      box(mats.plank, x, 1.05, zc, w - 0.6, 0.7, d - 0.8);
      box(white, x, 8.2, zc, w + 1, 0.7, d + 0.4);
      box(white, x, 8.7, zc, w + 0.2, 0.22, d);
      const n = 4;
      for (let i = 0; i < n; i++) {
        const cx = x - w / 2 + 1.1 + ((w - 2.2) * i) / (n - 1);
        box(white, cx, 4.6, fz + d - 0.45, 0.7, 7.2, 0.7);
        box(mats.stone, cx, 0.4, fz + d - 0.45, 0.95, 0.5, 0.95);
      }
    };
    addPorch(left.x, left.width + 1, 8);
    addPorch(right.x, right.width - 1, 7);
    paneledDoor(left.x, fz + 0.15, 3.2, 7.2);
    for (let i = 0; i < 4; i++) {
      box(mats.stone, right.x + right.width * 0.28, 0.22 + i * 0.26, fz + 7.4 + i * 0.75, 4.4, 0.26, 0.95);
    }
    for (let i = 0; i < 16; i++) {
      const x = -b.width / 2 - 2 + ((b.width + 4) * (i + 0.5)) / 16;
      box(i % 2 ? mats.leaf : mats.leafDark, x, 1.6, fz + 12.5, 2.2, 2.6 + (i % 3) * 0.4, 1.8);
    }
    box(mats.stone, 0, 0.12, fz + 24, b.width + 24, 0.16, 6.5);
    box(mats.stone, 0, 0.32, fz + 20.6, b.width + 24, 0.38, 0.7);
    box(white, 0, 12.3, 0, b.width + 0.8, 0.38, b.depth + 0.8);
    const yardTrees = [
      [b.width * 0.42, fz + 6, 3.6],
    ];
    for (const [x, z, scale] of yardTrees) {
      const spot = new THREE.Vector3(x, 0, z);
      spot.applyMatrix4(buildingMatrix);
      extraTrees.push({ x: spot.x, z: spot.z, kind: "maple", scale });
    }
    chimneyStack(body, b.width * 0.18, wallH + 6, -b.depth * 0.12, 1.7, 7, 1.7);
    return wallH + 18;
  };

  if (data.streetStyle?.rile) {
    const rile = data.streets.find((s) => s.name === "Rile Street");
    if (rile) {
      for (const house of data.buildings) {
        if (house.kind === "house" && Math.abs(house.z - rile.at) < 150) house.bayWindow = true;
      }
    }
  }

  for (const b of data.buildings) {
    const hue = idHash(b.id);
    tint.setRGB(
      0.92 + (hue % 20) / 20 * 0.12,
      0.93 + ((hue >> 5) % 16) / 16 * 0.08,
      0.9 + ((hue >> 10) % 14) / 14 * 0.08,
    );
    begin(b.x, b.z, b.facing, b.rotation || 0);
    let height = 20;
    const handDrawn = Boolean(
      b.facade?.hendeeHome || b.facade?.turretHouse || b.facade?.studBarn || b.facade?.hoseTower ||
      b.facade?.ballCream || b.facade?.mcpCorner || b.facade?.hurst292 || b.facade?.funeralHome ||
      b.facade?.hurstBuff || b.facade?.hurstPressed || b.facade?.signBand || b.facade?.pentRoof ||
      (b.id === "millinery-2" && b.facade?.storefront === "plate") ||
      b.facade?.bays || b.facade?.norcross ||
      b.facade?.plainPlant || b.facade?.eastSide1904 ||
      b.id === "presbyterian-church-1917" || b.id === "junction-depot" || b.id === "hurst-crossing-shanty" ||
      b.id === "hendee-house-26"
    );
    if (b.facadeSpec && !handDrawn) {
      height = drawFacadeSpec(b, {
        box, put, mats, THREE, buildingMatrix, frontSash, archHood, hipRoof, gable, gableAt,
        dentilCourse, bracketRow, drawPediment, chimneyStack, paneledDoor, localBox,
        clapboardTriangle, extraTrees, signs, FACING, tint,
        year: data.meta?.shownYear || data.year || 1880,
      });
    } else if (b.facade?.hendeeHome) height = addHendeeHome(b);
    else if (b.facade?.turretHouse) height = addTurretHouse(b);
    else if (b.id === "presbyterian-church-1917") height = addGothicChurch(b);
    else if (b.id === "junction-depot") height = addJunctionDepot(b);
    else if (b.id === "hurst-crossing-shanty") height = addCrossingShanty(b);
    else if (b.facade?.studBarn) height = addStudBarn(b);
    else if (b.facade?.hoseTower) height = addHoseTower(b);
    else if (b.facade?.ballCream) height = addBallCream(b);
    else if (b.facade?.mcpCorner) height = addMcpCorner(b);
    else if (b.facade?.hurst292) height = addHurst292(b);
    else if (b.facade?.funeralHome) height = addFuneralHome(b);
    else if (b.facade?.signBand) height = addSomethingSpecial(b);
    else if (b.facade?.pentRoof) height = addGreenNeighbor(b);
    else if (b.id === "millinery-2" && b.facade?.storefront === "plate") height = addGrayHoods(b);
    else if (b.facade?.hurstBuff) height = addHurstBuff(b);
    else if (b.facade?.hurstPressed) height = addHurstPressed(b);
    else if (b.kind === "house") height = addHouse(b);
    else if (b.id === "hendee-house-26") height = addHendeeHouse(b);
    else if (b.kind === "frame-store") height = addStore(b, true);
    else if (b.kind === "brick-store" || b.kind === "hotel") height = addStore(b, b.material === "frame");
    else if (b.kind === "church") height = addChurch(b);
    else if (b.kind === "depot") height = addDepot(b);
    else if (b.kind === "elevator") height = addElevator(b);
    else if (b.kind === "mill") height = addMill(b);
    else if (b.kind === "barn") height = addBarn(b);
    else if (b.facade?.norcross) height = addNorcross(b);
    else if (b.facade?.plainPlant) height = addPlainPlant(b);
    else if (b.kind === "factory") height = addFactory(b);
    else if (b.facade?.eastSide1904) height = addEastSideSchool(b);
    else if (b.kind === "school") height = addSchool(b);
    else height = addShed(b);

    const fp = footprint(b);
    colliders.push({ ...fp, id: b.id });
    const pick = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const cx = (fp.minX + fp.maxX) / 2;
    const cz = (fp.minZ + fp.maxZ) / 2;
    const sx = Math.max(2, fp.maxX - fp.minX);
    const sz = Math.max(2, fp.maxZ - fp.minZ);
    pick.scale.set(sx, height, sz);
    pick.position.set(cx, height / 2, cz);
    pick.userData.building = b;
    pick.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });
    picks.add(pick);
  }

  // Ground.
  const prairie = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), mats.grass);
  prairie.rotation.x = -Math.PI / 2;
  prairie.receiveShadow = true;
  scene.add(prairie);

  for (const block of data.blocks) {
    if (block.use !== "park") continue;
    const w = block.x1 - block.x0;
    const d = block.z1 - block.z0;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mats.park);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((block.x0 + block.x1) / 2, 0.03, (block.z0 + block.z1) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const lake of data.water || []) {
    const size = lake.cell || 14;
    const positions = [];
    const half = size / 2;
    for (const [x, z] of lake.points) {
      positions.push(
        x - half, 0.2, z - half,
        x + half, 0.2, z - half,
        x + half, 0.2, z + half,
        x - half, 0.2, z + half,
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const indices = [];
    for (let i = 0; i < lake.points.length; i++) {
      const a = i * 4;
      indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x3d8eb0,
        roughness: 0.35,
        metalness: 0.05,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  const pavedNames = new Set(["East Main Street", "Crafford Street"]);
  const pavedNow = (data.meta?.shownYear || 0) >= 1970;
  for (const street of data.streets) {
    if (street.points) {
      addPolylineStreet(street, mats, scene);
      continue;
    }
    if (pavedNow && pavedNames.has(street.name)) continue;
    const len = street.to - street.from;
    const geo =
      street.axis === "x"
        ? new THREE.PlaneGeometry(len, street.width)
        : new THREE.PlaneGeometry(street.width, len);
    const mesh = new THREE.Mesh(
      geo,
      street.axis === "x" ? mats.street : mats.streetCross,
    );
    mesh.rotation.x = -Math.PI / 2;
    if (street.axis === "x") mesh.position.set((street.from + street.to) / 2, 0.05, street.at);
    else mesh.position.set(street.at, 0.05, (street.from + street.to) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const walk of data.boardwalks) {
    if (pavedNow) {
      const onMain = walk.axis === "x" && Math.abs(Math.abs(walk.at) - 156) < 50;
      const onHurst = walk.axis === "z" && Math.abs(Math.abs(walk.at) - 420) < 55;
      if (onMain || onHurst) continue;
    }
    const len = Math.abs(walk.to - walk.from);
    const geo =
      walk.axis === "x"
        ? new THREE.BoxGeometry(len, 0.35, walk.width)
        : new THREE.BoxGeometry(walk.width, 0.35, len);
    const mesh = new THREE.Mesh(
      geo,
      walk.axis === "x" ? tiled(mats.plank, len / 6, walk.width / 2) : tiled(mats.plank, walk.width / 2, len / 6),
    );
    mesh.position.set(
      walk.axis === "x" ? (walk.from + walk.to) / 2 : walk.at,
      0.4,
      walk.axis === "z" ? (walk.from + walk.to) / 2 : walk.at,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const vergeParts = [];
  for (const street of data.streets) {
    if (street.points) continue;
    if (pavedNow && (street.name === "East Main Street" || street.name === "Hurst Street")) continue;
    const len = Math.abs(street.to - street.from);
    const verge = 8;
    for (const side of [-1, 1]) {
      const offset = side * (street.width / 2 + verge / 2 + 0.8);
      const geo = street.axis === "x" ? new THREE.PlaneGeometry(len, verge) : new THREE.PlaneGeometry(verge, len);
      const uv = geo.getAttribute("uv");
      const uFeet = (street.axis === "x" ? len : verge) / 22;
      const vFeet = (street.axis === "x" ? verge : len) / 22;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uFeet, uv.getY(i) * vFeet);
      geo.rotateX(-Math.PI / 2);
      const mid = (street.from + street.to) / 2;
      if (street.axis === "x") geo.translate(mid, 0.07, street.at + offset);
      else geo.translate(street.at + offset, 0.07, mid);
      vergeParts.push(geo);
    }
  }
  const vergeMesh = new THREE.Mesh(mergeGeometries(vergeParts, false), mats.grass);
  vergeMesh.receiveShadow = true;
  scene.add(vergeMesh);

  const named = data.streets.filter((street) => street.name.endsWith("Street"));
  const eastWest = named.filter((street) => street.axis === "x");
  const northSouth = named.filter((street) => street.axis === "z");
  const crossingParts = [];
  for (const road of eastWest) {
    for (const cross of northSouth) {
      if (cross.at < road.from || cross.at > road.to) continue;
      if (road.at < cross.from || road.at > cross.to) continue;
      const across = new THREE.BoxGeometry(11, 0.16, road.width * 0.62);
      scaleBoxUVs(across, 11, 0.16, road.width * 0.62, mats.plank);
      across.translate(cross.at, 0.12, road.at);
      const along = new THREE.BoxGeometry(cross.width * 0.62, 0.16, 11);
      scaleBoxUVs(along, cross.width * 0.62, 0.16, 11, mats.plank);
      along.translate(cross.at, 0.15, road.at);
      crossingParts.push(across, along);
    }
  }
  if (crossingParts.length) {
    const crossings = new THREE.Mesh(mergeGeometries(crossingParts, false), mats.plank);
    crossings.castShadow = true;
    crossings.receiveShadow = true;
    scene.add(crossings);
  }

  const puddleParts = [];
  for (const road of named) {
    if (!/Main|Hail|Hurst|Gridley/.test(road.name)) continue;
    if (pavedNow && pavedNames.has(road.name)) continue;
    const span = road.to - road.from;
    const count = Math.max(3, Math.floor(Math.abs(span) / 180));
    for (let i = 0; i < count; i++) {
      const along = road.from + ((i + 0.35) * span) / count;
      const side = (i % 2 === 0 ? 1 : -1) * road.width * 0.16;
      const geo = new THREE.PlaneGeometry(9, 4.2);
      const uv = geo.getAttribute("uv");
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 0.8, uv.getY(k) * 0.4);
      geo.rotateX(-Math.PI / 2);
      if (road.axis === "x") geo.translate(along, 0.09, road.at + side);
      else geo.translate(road.at + side, 0.09, along);
      puddleParts.push(geo);
    }
  }
  if (puddleParts.length) {
    const puddles = new THREE.Mesh(mergeGeometries(puddleParts, false), mats.mud);
    puddles.receiveShadow = true;
    scene.add(puddles);
  }

  const lampSpots = [];
  const addLampLine = (axis, at, from, to, step) => {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    for (let p = start; p <= end; p += step) {
      lampSpots.push(axis === "x" ? { x: p, z: at } : { x: at, z: p });
    }
  };
  addLampLine("x", 180, -760, 360, 130);
  addLampLine("x", -180, -760, 360, 130);
  addLampLine("z", -430, -140, 140, 140);
  addLampLine("z", 26, -480, -220, 130);
  if (lampSpots.length) {
    const n = lampSpots.length;
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 1, 0.42), mats.trimDark, n);
    const lanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.2, 0.9), mats.lamp, n);
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.28, 1.15), mats.metal, n);
    const lampDummy = new THREE.Object3D();
    lampSpots.forEach((spot, i) => {
      lampDummy.position.set(spot.x, 5.2, spot.z);
      lampDummy.scale.set(1, 10.4, 1);
      lampDummy.updateMatrix();
      posts.setMatrixAt(i, lampDummy.matrix);
      lampDummy.position.set(spot.x, 10.55, spot.z);
      lampDummy.scale.set(1, 1, 1);
      lampDummy.updateMatrix();
      lanterns.setMatrixAt(i, lampDummy.matrix);
      lampDummy.position.set(spot.x, 11.25, spot.z);
      lampDummy.updateMatrix();
      caps.setMatrixAt(i, lampDummy.matrix);
    });
    posts.castShadow = true;
    caps.castShadow = true;
    scene.add(posts, lanterns, caps);
  }

  const railViewport = { value: new THREE.Vector2(1280, 800) };
  // Keeps a rail from shrinking to a soft hairline in an aerial view.
  // Up close it stays the real width of the steel.
  const makeRailMaterial = (color, minPixels, halfWidth) => {
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.22,
      roughness: 0.4,
    });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.railViewport = railViewport;
      shader.uniforms.railMinPx = { value: minPixels };
      shader.uniforms.railHalf = { value: halfWidth };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform vec2 railViewport;\nuniform float railMinPx;\nuniform float railHalf;")
        .replace(
        "#include <project_vertex>",
        `
          vec4 mvPosition = vec4(transformed, 1.0);
          mvPosition = modelViewMatrix * mvPosition;
          vec3 railOut = normalize(mat3(modelViewMatrix) * vec3(1.0, 0.0, 0.0));
          float railDepth = max(1.0, -mvPosition.z);
          float worldPerPx = (railDepth * 2.0) / max(1.0, projectionMatrix[1][1] * railViewport.y);
          float targetHalf = min(1.55, railMinPx * worldPerPx * 0.5);
          float extra = max(0.0, targetHalf - railHalf);
          mvPosition.xyz += railOut * sign(position.x) * extra;
          gl_Position = projectionMatrix * mvPosition;
        `,
      );
    };
    mat.customProgramCacheKey = () => `rail-${color}-${minPixels}`;
    return mat;
  };
  const railBody = makeRailMaterial("#a3adb4", 2.1, 0.2);
  const railCap = makeRailMaterial("#e6ebef", 0, 0.08);
  const noteRailSize = (renderer) => renderer.getDrawingBufferSize(railViewport.value);

  const addTrack = (points) => {
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, z1] = points[i];
      const [x2, z2] = points[i + 1];
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      const mid = new THREE.Vector3((x1 + x2) / 2, 0, (z1 + z2) / 2);
      const ballastMat = tiled(mats.trackBed, 1, len / 8);
      for (const key of ["map", "normalMap", "roughnessMap"]) {
        if (ballastMat[key]) ballastMat[key].anisotropy = 8;
      }
      const ballast = new THREE.Mesh(new THREE.BoxGeometry(14, 0.48, len), ballastMat);
      ballast.position.copy(mid);
      ballast.position.y = 0.24;
      ballast.rotation.y = yaw;
      ballast.receiveShadow = true;
      scene.add(ballast);
      for (const side of [-2.35, 2.35]) {
        const across = Math.cos(yaw) * side;
        const along = -Math.sin(yaw) * side;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.36, len), railBody);
        rail.position.set(mid.x + across, 0.64, mid.z + along);
        rail.rotation.y = yaw;
        rail.castShadow = true;
        rail.onBeforeRender = noteRailSize;
        scene.add(rail);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, len), railCap);
        cap.position.set(mid.x + across, 0.85, mid.z + along);
        cap.rotation.y = yaw;
        cap.onBeforeRender = noteRailSize;
        scene.add(cap);
      }
    }
  };
  for (const track of data.tracks) addTrack(track.points);

  // One wire along the telegraph line so the poles read as a line, not sticks.
  const wire = new THREE.Mesh(new THREE.BoxGeometry(3100, 0.08, 0.08), mats.trimDark);
  wire.position.set(420, 8, 80);
  scene.add(wire);

  // Props.
  const propRoot = new THREE.Group();
  for (const p of data.props) {
    propRoot.add(makeProp(p, mats));
  }
  scene.add(propRoot);

  // Street looks taken from dated photographs. Each one is only on the years
  // whose patch sets streetStyle, and only on the street the picture shows.
  const style = data.streetStyle || {};
  const streetByName = (name) => data.streets.find((s) => s.name === name && s.axis);
  const dressStreet = (street, opt) => {
    if (!street || street.points) return;
    const len = Math.abs(street.to - street.from);
    const mid = (street.from + street.to) / 2;
    const along = (t) => (street.axis === "x" ? [street.from + t * (street.to - street.from), street.at] : [street.at, street.from + t * (street.to - street.from)]);
    if (opt.ruts) {
      for (const side of [-1, 1]) {
        const geo = street.axis === "x" ? new THREE.PlaneGeometry(len * 0.92, 1.3) : new THREE.PlaneGeometry(1.3, len * 0.92);
        geo.rotateX(-Math.PI / 2);
        const off = side * 4.2;
        if (street.axis === "x") geo.translate(mid, 0.08, street.at + off);
        else geo.translate(street.at + off, 0.08, mid);
        const mesh = new THREE.Mesh(geo, mats.mud);
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
    }
    if (opt.curb || opt.walk) {
      const stone = mats.stone.clone();
      stone.vertexColors = false;
      for (const side of opt.sides || [-1, 1]) {
        const inset = opt.inset || 0;
        const curbOff = side * (street.width / 2 - inset + 0.4);
        const walkOff = side * (street.width / 2 - inset - 2.6);
        if (opt.curb) {
          const curb = new THREE.Mesh(
            street.axis === "x" ? new THREE.BoxGeometry(len, 0.45, 0.7) : new THREE.BoxGeometry(0.7, 0.45, len),
            stone,
          );
          curb.position.set(street.axis === "x" ? mid : street.at + curbOff, 0.28, street.axis === "x" ? street.at + curbOff : mid);
          curb.castShadow = true;
          scene.add(curb);
        }
        if (opt.walk) {
          const walk = new THREE.Mesh(
            street.axis === "x" ? new THREE.BoxGeometry(len, 0.12, 4.2) : new THREE.BoxGeometry(4.2, 0.12, len),
            stone,
          );
          walk.position.set(street.axis === "x" ? mid : street.at + walkOff, 0.16, street.axis === "x" ? street.at + walkOff : mid);
          walk.receiveShadow = true;
          scene.add(walk);
        }
      }
    }
    if (opt.poles) {
      const count = Math.max(3, Math.round(len / 160));
      for (let i = 0; i < count; i++) {
        const [x, z] = along((i + 0.5) / count);
        const side = i % 2 === 0 ? 1 : -1;
        const px = street.axis === "x" ? x : x + side * (street.width / 2 + 5);
        const pz = street.axis === "x" ? z + side * (street.width / 2 + 5) : z;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 24, 0.55), mats.trunk);
        post.position.set(px, 12, pz);
        post.castShadow = true;
        scene.add(post);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(7, 0.22, 0.28), mats.trunk);
        arm.position.set(px, 22, pz);
        scene.add(arm);
      }
    }
    if (opt.trees) {
      const count = opt.trees === "mature" ? Math.round(len / 28) : Math.round(len / 42);
      for (let i = 0; i < count; i++) {
        const [x, z] = along((i + 0.3) / count);
        const side = i % 2 === 0 ? 1 : -1;
        const park = street.width / 2 + 4.2;
        extraTrees.push({
          x: street.axis === "x" ? x : x + side * park,
          z: street.axis === "x" ? z + side * park : z,
          kind: "maple",
          scale: opt.trees === "spring" ? 0.72 : 1.55,
        });
      }
    }
  };
  if (style.rile) {
    const rile = streetByName("Rile Street");
    dressStreet(rile, { ruts: true, curb: true, walk: true, poles: true, trees: "mature" });
  }
  if (style.crafford) {
    const crafford = streetByName("Crafford Street");
    if (crafford) dressStreet({ ...crafford, from: 0, to: 450 }, { ruts: true, curb: true, walk: true, trees: "spring" });
  }
  const eastMain = streetByName("East Main Street");
  if (eastMain) dressStreet({ ...eastMain, from: -520, to: 560 }, { curb: true, walk: true, inset: 8, sides: [1] });
  const craffordNorth = streetByName("Crafford Street");
  if (craffordNorth) dressStreet({ ...craffordNorth, from: 980, to: 1280 }, { curb: true, walk: true, inset: 6, sides: [-1] });
  if ((data.meta?.shownYear || 0) >= 1970) {
    const asphalt = new THREE.MeshStandardMaterial({ color: "#6a6d70", roughness: 0.96, metalness: 0 });
    asphalt.polygonOffset = true;
    asphalt.polygonOffsetFactor = -1;
    asphalt.polygonOffsetUnits = -1;
    asphalt.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vPaveWorld;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPaveWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
varying vec3 vPaveWorld;
float pHash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
float pNoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(pHash(i),pHash(i+vec2(1.0,0.0)),f.x), mix(pHash(i+vec2(0.0,1.0)),pHash(i+vec2(1.0,1.0)),f.x), f.y); }`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          float n = pNoise(vPaveWorld.xz * 0.35);
          diffuseColor.rgb *= mix(vec3(0.92), vec3(1.05), n);`);
    };
    asphalt.customProgramCacheKey = () => "asphalt-plain";
    const concrete = mats.stone.clone();
    concrete.color.set("#d7d3cb");
    concrete.vertexColors = false;
    concrete.roughness = 0.9;
    const strip = (axis, alongMid, alongLen, across, acrossSize, y, thick, mat) => {
      const mesh = new THREE.Mesh(
        axis === "x" ? new THREE.BoxGeometry(alongLen, thick, acrossSize) : new THREE.BoxGeometry(acrossSize, thick, alongLen),
        mat,
      );
      mesh.position.set(axis === "x" ? alongMid : across, y, axis === "x" ? across : alongMid);
      mesh.receiveShadow = true;
      if (thick > 0.3) mesh.castShadow = true;
      scene.add(mesh);
    };
    const paveRoad = (street, from, to) => {
      if (!street) return;
      const len = Math.abs(to - from);
      const mid = (from + to) / 2;
      const half = street.width / 2;
      const walk = 15;
      const curb = 0.9;
      for (const side of [-1, 1]) {
        const walkCenter = side * (half - walk / 2 + 2);
        const curbCenter = side * (half - walk - curb / 2 + 1.2);
        strip(street.axis, mid, len, street.at + walkCenter, walk + 4, 0.22, 0.2, concrete);
        strip(street.axis, mid, len, street.at + curbCenter, curb, 0.32, 0.46, concrete);
      }
      const road = Math.max(12, street.width - walk * 2 - 2);
      strip(street.axis, mid, len, street.at, road, 0.16, 0.18, asphalt);
    };
    if (eastMain) {
      paveRoad(eastMain, eastMain.from, eastMain.to);
      const plainRoad = new THREE.MeshStandardMaterial({ color: "#6e7174", roughness: 0.95 });
      const approach = new THREE.Mesh(new THREE.BoxGeometry(260, 0.8, 110), plainRoad);
      approach.position.set(-350, 0.9, 155);
      approach.receiveShadow = true;
      const walk400 = new THREE.Mesh(new THREE.BoxGeometry(260, 0.35, 28), concrete);
      walk400.position.set(-350, 1.15, 188);
      walk400.receiveShadow = true;
      scene.add(approach, walk400);
      const southWalk = new THREE.Mesh(new THREE.BoxGeometry(240, 0.32, 52), concrete);
      southWalk.position.set(400, 0.34, 106);
      southWalk.receiveShadow = true;
      const yellow = new THREE.MeshStandardMaterial({ color: "#e2c04a", roughness: 0.72 });
      const southCurb = new THREE.Mesh(new THREE.BoxGeometry(240, 0.58, 1.15), yellow);
      southCurb.position.set(400, 0.52, 133);
      southCurb.castShadow = true;
      const northWalk = new THREE.Mesh(new THREE.BoxGeometry(90, 0.22, 16), concrete);
      northWalk.position.set(380, 0.3, 176);
      northWalk.receiveShadow = true;
      scene.add(southWalk, southCurb, northWalk);
    }
    const hurst = streetByName("Hurst Street");
    if (hurst) {
      paveRoad(hurst, 180, 520);
      const walkMat = concrete.clone();
      walkMat.color.set("#e7e2d8");
      const walk = new THREE.Mesh(new THREE.BoxGeometry(100, 0.24, 180), walkMat);
      walk.position.set(-431, 0.26, 310);
      walk.receiveShadow = true;
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 170), concrete);
      curb.position.set(-474.5, 0.34, 310);
      const road = new THREE.Mesh(new THREE.BoxGeometry(40, 0.16, 170), asphalt);
      road.position.set(-498, 0.18, 310);
      road.receiveShadow = true;
      scene.add(walk, curb, road);
    }
    if (craffordNorth) {
      const len = Math.abs(craffordNorth.to - craffordNorth.from);
      const mid = (craffordNorth.from + craffordNorth.to) / 2;
      const mesh = new THREE.Mesh(
        craffordNorth.axis === "x"
          ? new THREE.PlaneGeometry(len, craffordNorth.width + 4)
          : new THREE.PlaneGeometry(craffordNorth.width + 4, len),
        asphalt,
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(craffordNorth.axis === "x" ? mid : craffordNorth.at, 0.12, craffordNorth.axis === "x" ? craffordNorth.at : mid);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
  if (style.mains) {
    for (const name of ["West Main Street"]) {
      const street = streetByName(name);
      if (!street) continue;
      dressStreet({ ...street, from: -520, to: 520 }, { curb: true, walk: true });
      const hitchN = 8;
      const hitchPosts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 3.4, 0.28), mats.trimDark, hitchN * 2);
      const hitchRail = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.22, 0.22), mats.trimDark, hitchN);
      const dummy = new THREE.Object3D();
      const side = Math.sign(street.at || 1);
      for (let i = 0; i < hitchN; i++) {
        const x = -460 + i * 120;
        const z = street.at + side * (street.width / 2 + 2.4);
        dummy.position.set(x - 1.4, 1.7, z);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        hitchPosts.setMatrixAt(i * 2, dummy.matrix);
        dummy.position.set(x + 1.4, 1.7, z);
        dummy.updateMatrix();
        hitchPosts.setMatrixAt(i * 2 + 1, dummy.matrix);
        dummy.position.set(x, 3.2, z);
        dummy.updateMatrix();
        hitchRail.setMatrixAt(i, dummy.matrix);
      }
      hitchPosts.castShadow = true;
      scene.add(hitchPosts, hitchRail);
      const lampN = 6;
      const lampPosts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1, 0.4), mats.trimDark, lampN);
      const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.85, 1.1, 0.85), mats.lamp, lampN);
      for (let i = 0; i < lampN; i++) {
        const x = -380 + i * 150;
        const z = street.at + side * (street.width / 2 + 5.5);
        dummy.position.set(x, 5.5, z);
        dummy.scale.set(1, 11, 1);
        dummy.updateMatrix();
        lampPosts.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 11.2, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        lamps.setMatrixAt(i, dummy.matrix);
      }
      scene.add(lampPosts, lamps);
      for (let i = 0; i < 4; i++) {
        const x = -400 + i * 110;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 26, 0.5), mats.trunk);
        post.position.set(x, 13, street.at + Math.sign(street.at || 1) * street.width * 0.42);
        scene.add(post);
      }
      const span = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, street.width * 0.7), mats.trimDark);
      span.position.set(80, 22, street.at);
      scene.add(span);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 1.4), mats.lamp);
      lamp.position.set(80, 21.2, street.at);
      scene.add(lamp);
    }
  }

  // Trees in the recorded yards, plus one in most house yards, plus a distant line.
  for (let i = 0; i < 56; i++) {
    const angle = (i / 56) * Math.PI * 2;
    const radius = 2200 + (i % 6) * 90;
    extraTrees.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius * 0.78,
      kind: i % 2 ? "maple" : "elm",
      scale: 1.7 + (i % 4) * 0.25,
    });
  }
  const allTrees = data.trees.concat(extraTrees);
  const lobeCount = 18;
  const foliage = (color, key) => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.84, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vLeafW;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLeafW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
varying vec3 vLeafW;
float lHash(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
          if (lHash(floor(vLeafW * 1.35)) < 0.28) discard;`);
    };
    mat.customProgramCacheKey = () => key;
    return mat;
  };
  const leafMat = foliage("#3e6b34", "leaf-gaps-a");
  const leafDarkMat = foliage("#2c5228", "leaf-gaps-b");
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.38, 0.62, 1, 8), mats.trunk, allTrees.length);
  const lobes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 9), leafMat, allTrees.length * lobeCount);
  const lobesDark = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), leafDarkMat, allTrees.length * lobeCount);
  const dummy = new THREE.Object3D();
  const lobePattern = [];
  for (let k = 0; k < lobeCount; k++) {
    const ang = k * 2.399963;
    const ring = 1.15 + (k % 5) * 0.62;
    const y = 0.15 + (k % 6) * 0.72;
    lobePattern.push([Math.cos(ang) * ring, y, Math.sin(ang) * ring * 0.82, 0.95 + (k % 4) * 0.22, 0.72 + (k % 3) * 0.16]);
  }
  allTrees.forEach((t, i) => {
    const s = t.scale || 1;
    const trunkH = (8 + (i % 3) * 0.6) * s;
    dummy.position.set(t.x, trunkH / 2, t.z);
    dummy.scale.set(s * 0.85, trunkH, s * 0.85);
    dummy.rotation.set(0, i * 0.7, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    lobePattern.forEach((lobe, k) => {
      const spin = i * 1.7 + k * 0.4;
      const ox = Math.cos(spin) * lobe[0] * s;
      const oz = Math.sin(spin) * lobe[2] * s;
      dummy.position.set(t.x + ox, trunkH + lobe[1] * s * 0.85, t.z + oz);
      dummy.scale.set(lobe[3] * s, lobe[4] * s, lobe[3] * s * 0.86);
      dummy.rotation.set(0, spin, 0);
      dummy.updateMatrix();
      (k % 2 ? lobesDark : lobes).setMatrixAt(i * lobeCount + k, dummy.matrix);
    });
  });
  for (const mesh of [trunks, lobes, lobesDark]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  addStreetNames(data, mats, scene);

  const mergeBucket = (map, parent) => {
    for (const [mat, geos] of map) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  };
  // Merge static building parts. Fine muntins sit in a second mesh that the view hides from the air.
  mergeBucket(buckets, scene);
  const detail = new THREE.Group();
  detail.name = "building-detail";
  mergeBucket(detailBuckets, detail);
  scene.add(detail);

  for (const s of signs) {
    const tex = makeSignTexture(s.title, s.subtitle, s.style);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.84, metalness: 0 });
    const h = s.height || (s.style === "molded" ? s.width * 0.2 : s.style === "band" ? s.width * 0.22 : s.style === "letter" ? s.width * 0.95 : s.subtitle ? s.width * 0.36 : s.width * 0.28);
    if (s.style === "letter" || s.style === "molded") {
      mat.transparent = true;
      mat.alphaTest = 0.35;
      mat.roughness = 0.62;
    }
    const group = new THREE.Group();
    group.position.copy(s.position);
    group.rotation.y = s.rotation;
    const board = new THREE.Mesh(new THREE.BoxGeometry(s.width + 0.7, h + 0.45, 0.22), mats.trim);
    board.castShadow = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.width, h), mat);
    mesh.position.z = 0.16;
    if (s.style === "letter" || s.style === "molded" || s.style === "band") group.add(mesh);
    else {
      const bracketL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.45), mats.trimDark);
      const bracketR = bracketL.clone();
      bracketL.position.set(-s.width * 0.32, -h * 0.55, 0.12);
      bracketR.position.set(s.width * 0.32, -h * 0.55, 0.12);
      group.add(board, mesh);
      if (!s.flush) group.add(bracketL, bracketR);
    }
    scene.add(group);
  }

  scene.add(picks);

  return { colliders, picks, materials: mats };
}

const streetLabelCache = new Map();

function addPolylineStreet(street, mats, scene) {
  const pts = street.points;
  const half = street.width / 2;
  const positions = [];
  const uvs = [];
  const indices = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const span = Math.hypot(dx, dz) || 1;
    dx /= span;
    dz /= span;
    if (i > 0) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    positions.push(pts[i][0] - dz * half, 0.12, pts[i][1] + dx * half);
    positions.push(pts[i][0] + dz * half, 0.12, pts[i][1] - dx * half);
    uvs.push(dist / 48, 0, dist / 48, 1);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mats.street);
  mesh.receiveShadow = true;
  scene.add(mesh);

  const mid = pts[Math.floor((pts.length - 1) / 2)];
  const painted = streetLabelTexture(street.name, "road");
  const letterH = 16;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(letterH * painted.aspect, letterH), new THREE.MeshBasicMaterial({
    map: painted.tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  }));
  label.rotation.x = -Math.PI / 2;
  label.position.set(mid[0], 0.22, mid[1]);
  label.renderOrder = 2;
  scene.add(label);
}

function streetLabelTexture(name, ink) {
  const key = `${ink}:${name}`;
  if (streetLabelCache.has(key)) return streetLabelCache.get(key);
  const upper = name.toUpperCase();
  const lines = [upper];
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = '700 150px Georgia, "Palatino Linotype", Palatino, serif';
  const textWidth = Math.max(...lines.map((line) => Math.ceil(measure.measureText(line).width)));
  const c = document.createElement("canvas");
  c.width = textWidth + (lines.length > 1 ? 72 : 96);
  c.height = lines.length > 1 ? 340 : 210;
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  if (ink === "board") {
    g.fillStyle = "#f3e6c8";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#2a1c12";
    g.lineWidth = 14;
    g.strokeRect(8, 8, c.width - 16, c.height - 16);
    g.fillStyle = "#24180f";
  } else {
    g.lineWidth = 6;
    g.strokeStyle = "rgba(20, 16, 12, 0.9)";
    g.fillStyle = "#2c241c";
  }
  g.font = '700 150px Georgia, "Palatino Linotype", Palatino, serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((line, i) => {
    const y = lines.length > 1 ? (i === 0 ? c.height * 0.32 : c.height * 0.73) : c.height / 2 + 4;
    if (ink === "road") g.strokeText(line, c.width / 2, y);
    g.fillText(line, c.width / 2, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const record = { tex, aspect: c.width / c.height };
  streetLabelCache.set(key, record);
  return record;
}

function addStreetNames(data, mats, scene) {
  const roads = data.streets.filter((street) => street.name.endsWith("Street"));
  roads.forEach((street) => {
    const painted = streetLabelTexture(street.name, "road");
    const letterH = 6;
    const letterW = letterH * painted.aspect;
    const lane = street.width * 0.22;
    const roadMat = new THREE.MeshBasicMaterial({
      map: painted.tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    const span = street.to - street.from;
    const count = Math.max(2, Math.round(span / 780));
    for (let i = 0; i < count; i++) {
      const along = street.from + ((i + 0.5) * span) / count;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(letterW, letterH), roadMat);
      mesh.rotation.order = "YXZ";
      mesh.rotation.y = street.axis === "z" ? Math.PI / 2 : 0;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(
        street.axis === "x" ? along : street.at + lane,
        0.12,
        street.axis === "z" ? along : street.at + lane,
      );
      mesh.renderOrder = 2;
      scene.add(mesh);
    }
  });
}

function ensureColor(root) {
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.material?.vertexColors) return;
    const geo = mesh.geometry;
    if (!geo?.getAttribute("position") || geo.getAttribute("color")) return;
    const colors = new Float32Array(geo.getAttribute("position").count * 3);
    colors.fill(1);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  });
}

function makeHorse(mats) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rotX = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotX;
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };

  // Light harness horse, about fifteen hands at the withers, facing +z.
  add(new THREE.CylinderGeometry(0.82, 0.9, 3.5, 10), mats.horse, 0, 3.7, 0, Math.PI / 2);
  const chest = add(new THREE.SphereGeometry(0.78, 10, 8), mats.horse, 0, 3.55, 1.45);
  chest.scale.set(0.9, 1.02, 1.08);
  const rump = add(new THREE.SphereGeometry(0.9, 10, 8), mats.horse, 0, 3.85, -1.45);
  rump.scale.set(0.95, 1.05, 1.02);
  const shoulder = add(new THREE.SphereGeometry(0.42, 8, 6), mats.horse, 0, 4.25, 1.2);
  shoulder.scale.set(0.8, 0.65, 1.05);

  add(new THREE.CylinderGeometry(0.22, 0.42, 2.05, 7), mats.horse, 0, 5.4, 2.0, 0.78);
  add(new THREE.BoxGeometry(0.42, 0.48, 1.55), mats.horse, 0, 5.72, 3.1, 0.7);
  add(new THREE.BoxGeometry(0.32, 0.28, 0.62), mats.horseDark, 0, 5.22, 4.02, 0.5);
  add(new THREE.BoxGeometry(0.14, 0.22, 1.45), mats.horseDark, 0, 5.85, 1.85, 0.7);

  for (const side of [-1, 1]) {
    const ear = add(new THREE.ConeGeometry(0.08, 0.36, 5), mats.horseDark, side * 0.14, 6.42, 2.62, -0.35);
    ear.rotation.z = side * 0.15;
    add(new THREE.SphereGeometry(0.045, 6, 5), mats.horseDark, side * 0.26, 5.95, 3.42);
    const bridle = add(new THREE.BoxGeometry(0.06, 0.06, 0.85), mats.trimDark, side * 0.2, 6.05, 3.05);
    bridle.castShadow = false;
  }
  add(new THREE.BoxGeometry(0.42, 0.06, 0.08), mats.trimDark, 0, 5.35, 3.95);

  const leg = (x, topZ, kneeZ, hoofZ, upperH, cannonH) => {
    add(new THREE.BoxGeometry(0.34, upperH, 0.4), mats.horse, x, 2.85 - upperH / 2, (topZ + kneeZ) / 2);
    add(new THREE.BoxGeometry(0.22, cannonH, 0.24), mats.horseDark, x, 0.28 + cannonH / 2, (kneeZ + hoofZ) / 2);
    add(new THREE.BoxGeometry(0.32, 0.22, 0.4), mats.horseDark, x, 0.12, hoofZ);
  };
  leg(-0.42, 1.2, 1.28, 1.18, 1.35, 1.2);
  leg(0.42, 1.2, 1.28, 1.18, 1.35, 1.2);
  leg(-0.46, -1.25, -1.55, -1.35, 1.25, 1.25);
  leg(0.46, -1.25, -1.55, -1.35, 1.25, 1.25);

  add(new THREE.BoxGeometry(0.18, 0.55, 0.18), mats.horseDark, 0, 4.45, -2.15, 0.9);
  add(new THREE.BoxGeometry(0.14, 1.35, 0.14), mats.horseDark, 0, 3.35, -2.45, 0.35);

  const collar = add(new THREE.TorusGeometry(0.46, 0.09, 6, 12), mats.trimDark, 0, 4.85, 1.55, 1.15);
  collar.castShadow = false;
  add(new THREE.BoxGeometry(0.55, 0.12, 1.15), mats.trimDark, 0, 4.62, 0.15);
  const girth = add(new THREE.TorusGeometry(0.98, 0.06, 6, 14), mats.trimDark, 0, 3.45, 0.25);
  girth.castShadow = false;
  for (const side of [-1, 1]) {
    const trace = add(new THREE.BoxGeometry(0.07, 0.07, 3.3), mats.trimDark, side * 0.72, 3.85, -0.15);
    trace.castShadow = false;
  }
  ensureColor(g);
  return g;
}

function makeWagon(mats) {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.18, 8.4), mats.siding.tan);
  bed.position.set(0, 2.62, -0.2);
  bed.castShadow = true;
  bed.receiveShadow = true;
  g.add(bed);
  for (const x of [-2.35, 2.35]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.45, 8.3), mats.siding.tan);
    side.position.set(x, 3.4, -0.2);
    side.castShadow = true;
    g.add(side);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 8.1), mats.siding.red);
    stripe.position.set(x + Math.sign(x) * 0.08, 3.95, -0.2);
    g.add(stripe);
  }
  for (const z of [-4.3, 3.9]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(4.7, 1.35, 0.14), mats.siding.tan);
    end.position.set(0, 3.35, z);
    end.castShadow = true;
    g.add(end);
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.16, 1.15), mats.trim);
  seat.position.set(0, 3.55, 2.35);
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.05, 0.12), mats.trim);
  seatBack.position.set(0, 4.1, 1.85);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.1, 1.3), mats.plank);
  foot.position.set(0, 2.95, 3.35);
  g.add(seat, seatBack, foot);
  addWagonWheel(g, mats, -2.62, 2.15, -2.15, 2.15);
  addWagonWheel(g, mats, 2.62, 2.15, -2.15, 2.15);
  addWagonWheel(g, mats, -2.62, 1.72, 2.55, 1.72);
  addWagonWheel(g, mats, 2.62, 1.72, 2.55, 1.72);
  for (const y of [2.15, 1.72]) {
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5.3, 8), mats.metal);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, y, y > 2 ? -2.15 : 2.55);
    g.add(axle);
  }
  for (const x of [-0.72, 0.72]) {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 6.4), mats.trimDark);
    shaft.position.set(x, 3.15, 7.15);
    shaft.castShadow = true;
    g.add(shaft);
  }
  const singletree = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.14), mats.trimDark);
  singletree.position.set(0, 3.15, 10.2);
  const hound = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.14), mats.trimDark);
  hound.position.set(0, 3.05, 4.05);
  g.add(singletree, hound);
  ensureColor(g);
  return g;
}

function addWagonWheel(group, mats, x, y, z, radius) {
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.09, 6, 18), mats.trim);
  rim.rotation.y = Math.PI / 2;
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.05, 0.055, 6, 18), mats.metal);
  tire.rotation.y = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.46, 8), mats.metal);
  hub.rotation.z = Math.PI / 2;
  wheel.add(rim, tire, hub);
  for (let i = 0; i < 12; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.07, radius * 1.82, 0.08), mats.trim);
    spoke.rotation.x = (i / 12) * Math.PI * 2;
    wheel.add(spoke);
  }
  wheel.position.set(x, y, z);
  wheel.traverse((obj) => {
    obj.castShadow = true;
  });
  group.add(wheel);
}

function makeProp(p, mats) {
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rotation || 0;
  const add = (mat, x, y, z, w, h, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  if (p.type === "hitching") {
    add(mats.trimDark, -2.2, 2.2, 0, 0.3, 4.2, 0.3);
    add(mats.trimDark, 2.2, 2.2, 0, 0.3, 4.2, 0.3);
    add(mats.trimDark, 0, 3.2, 0, 4.6, 0.28, 0.28);
  } else if (p.type === "trough") {
    add(mats.siding.gray, 0, 1.4, 0, 6, 1.4, 2.2);
    add(mats.metal, 0, 2.2, 0, 5.2, 0.3, 1.6);
  } else if (p.type === "lamp") {
    add(mats.trimDark, 0, 5.2, 0, 0.42, 10.4, 0.42);
    add(mats.trim, 0, 10.15, 0, 0.7, 0.22, 0.7);
    add(mats.lamp, 0, 10.7, 0, 0.85, 1.15, 0.85);
    add(mats.metal, 0, 11.4, 0, 1.1, 0.28, 1.1);
  } else if (p.type === "telegraph") {
    add(mats.trunk, 0, 11, 0, 1.1, 22, 1.1);
    add(mats.trunk, 0, 21.6, 0, 7, 0.35, 0.45);
  } else if (p.type === "crossbuck") {
    add(mats.trimDark, 0, 6, 0, 0.4, 12, 0.4);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.8, 0.15),
      mats.whitewash,
    );
    board.position.y = 10;
    board.rotation.z = 0.6;
    const board2 = board.clone();
    board2.rotation.z = -0.6;
    g.add(board, board2);
  } else if (p.type === "wagon") {
    g.add(makeWagon(mats));
  } else if (p.type === "horse") {
    g.add(makeHorse(mats));
  } else if (p.type === "barrels") {
    for (const [x, z] of [[0, 0], [1.4, 0.4], [-0.2, 1.3]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 2.2, 8), mats.siding.tan);
      m.position.set(x, 1.1, z);
      m.castShadow = true;
      g.add(m);
    }
  } else if (p.type === "crates") {
    add(mats.plank, 0, 1, 0, 2.2, 2, 2.2);
    add(mats.plank, 1.6, 0.7, 0.8, 1.6, 1.4, 1.6);
  } else if (p.type === "lumber") {
    for (let i = 0; i < 5; i++) add(mats.plank, 0, 0.4 + i * 0.45, 0, 14, 0.4, 3);
  } else if (p.type === "coal") {
    const m = new THREE.Mesh(new THREE.ConeGeometry(7, 5, 7), mats.coal);
    m.position.y = 2;
    m.castShadow = true;
    g.add(m);
  } else if (p.type === "pump") {
    add(mats.trimDark, 0, 2, 0, 0.4, 4, 0.4);
    add(mats.metal, 0.6, 3.6, 0, 1.4, 0.25, 0.25);
    add(mats.siding.gray, 0, 0.4, 0, 1.4, 0.8, 1.4);
  } else if (p.type === "bandstand") {
    add(mats.plank, 0, 2, 0, 22, 1.2, 22);
    add(mats.roof, 0, 14, 0, 26, 0.5, 26);
    for (const x of [-9, 9]) {
      for (const z of [-9, 9]) add(mats.trimDark, x, 8, z, 0.6, 12, 0.6);
    }
    add(mats.trim, 0, 2.8, 10.2, 6, 0.3, 2);
  }
  ensureColor(g);
  return g;
}
