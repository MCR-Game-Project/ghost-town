import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
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

// Trade words that stand in for a shop's use. They are not sign readings (round 4).
const GENERIC_SIGNS = new Set([
  "GROCERY", "GROCERIES", "DRY GOODS", "HARDWARE", "BOOTS & SHOES", "BOOTS", "SHOES", "BAKERY",
  "FURNITURE", "OFFICES", "VARIETY", "MILLINERY", "BARBER", "TIN & STOVES", "SALOON", "HARNESS",
  "PRINTER", "CANDY", "RESTAURANT", "STORE", "BOARDING", "GENERAL STORE", "CLOTHING", "CLOTHIERS",
  "DRUGS", "MEATS", "CHINA", "CIGARS", "JEWELRY", "BOWLING", "ROOMS", "LODGINGS", "GRAIN & COAL",
  "STEAM LAUNDRY", "IMPLEMENTS", "LUNCH", "HALL",
]);

export function buildTown(data, scene) {
  mirrorPlat(data);
  const mats = makeMaterials();
  // Round 4: the slider year, for things that change inside a stop (ground, cars, hitch rails).
  const eraYear = data.meta?.sliderYear || data.meta?.shownYear || 1880;
  // Round 4: shop windows read dark in every street photograph, not as pale panels.
  const shopGlass = new THREE.MeshStandardMaterial({ color: "#2a333b", roughness: 0.16, metalness: 0.35, envMapIntensity: 0.85 });
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

  // Pointed (Gothic) head: two straight raking blocks meeting at an apex, with a
  // glazed triangle under them. Used for the upper windows of the Hendee building
  // engraving (centennial book, PDF p.25).
  // Smooth semicircular hood molding (a half torus) with an optional glazed head.
  const ringArch = (mat, x, y, z, radius, tube = 0.32, glass = false) => {
    const ring = new THREE.TorusGeometry(radius, tube, 6, 20, Math.PI);
    ring.scale(1, 1, 1.4);
    ring.translate(x, y, z);
    ring.applyMatrix4(buildingMatrix);
    put(mat, ring);
    if (glass) {
      const head = new THREE.CircleGeometry(radius - tube * 0.6, 20, 0, Math.PI);
      head.translate(x, y, z - 0.25);
      head.applyMatrix4(buildingMatrix);
      put(mats.glass, head);
    }
  };

  // Raking coping or trim along both slopes of a front gable, with kneeler blocks at the
  // feet and an apex block, so a church or school gable reads against the sky.
  const gableCoping = (mat, span, rise, yBase, z, x = 0, thick = 0.6) => {
    const half = span / 2;
    const len = Math.hypot(half, rise) + 0.3;
    const ang = Math.atan2(rise, half);
    for (const sd of [-1, 1]) {
      const rk = new THREE.BoxGeometry(len, thick, thick * 1.4);
      rk.rotateZ(-sd * ang);
      rk.translate(x + (sd * half) / 2, yBase + rise / 2 + thick * 0.4, z);
      rk.applyMatrix4(buildingMatrix);
      put(mat, rk);
      box(mat, x + sd * (half - 0.2), yBase + 0.2, z, 1.4, 1.2, thick * 1.8);
    }
    box(mat, x, yBase + rise + thick * 0.6, z, 1.1, 1.0, thick * 1.6);
  };

  // Small four-sided pinnacle (tower corners, St. Bernard's p.59).
  const pinnacle = (mat, x, y, z, w = 1.0, h = 4.0) => {
    box(mat, x, y + 0.6, z, w, 1.2, w);
    const c = new THREE.ConeGeometry(w * 0.6, h, 4);
    c.rotateY(Math.PI / 4);
    c.translate(x, y + 1.2 + h / 2, z);
    c.applyMatrix4(buildingMatrix);
    put(mat, c);
  };

  const pointedHood = (mat, x, yBase, z, span) => {
    const rise = span * 0.58;
    const len = Math.hypot(span / 2, rise) + 0.2;
    const angle = Math.atan2(rise, span / 2);
    for (const side of [-1, 1]) {
      const geo = new THREE.BoxGeometry(len, 0.3, 0.34);
      geo.rotateZ(-side * angle);
      geo.translate(x + side * (span / 4), yBase + rise / 2, z);
      geo.applyMatrix4(buildingMatrix);
      put(mat, geo);
    }
    const tri = new THREE.Shape();
    tri.moveTo(-span / 2 + 0.35, 0);
    tri.lineTo(span / 2 - 0.35, 0);
    tri.lineTo(0, rise - 0.45);
    tri.lineTo(-span / 2 + 0.35, 0);
    const glass = new THREE.ShapeGeometry(tri);
    glass.translate(x, yBase, z - 0.36);
    glass.applyMatrix4(buildingMatrix);
    put(mats.glass, glass);
    // Small keystone and label stops at the springing (hood moldings in the p.25 engraving).
    box(mat, x, yBase + rise - 0.05, z + 0.08, 0.42, 0.6, 0.42);
    for (const side of [-1, 1]) box(mat, x + side * (span / 2 + 0.05), yBase - 0.15, z + 0.05, 0.42, 0.42, 0.4);
  };

  // One-over-one sash. Glass sits several inches behind the outer frame so the
  // reveal and the projecting sill cast a shadow. arch "open" leaves the head clear.
  const frontSash = (x, y, z, w, h, arch, shutters = false, archMat = mats.trim, hood = false, cap = true, muntin = false) => {
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
    if (muntin === "two") {
      box(frame, x, y + up, glassZ + 0.06, 0.065, paneH * 0.94, 0.06);
      box(frame, x, y - up, glassZ + 0.06, 0.065, paneH * 0.94, 0.06);
    }
    box(sillMat, x, y - h / 2 - 0.26, outerZ + 0.12, w + 1.15, 0.32, 0.95);
    box(mats.trimDark, x, y - h / 2 - 0.46, outerZ + 0.28, w + 0.7, 0.1, 0.34);
    if (arch === "segmental") archHood(archMat, x, y + h / 2 + 0.04, outerZ, w + 0.35, (w + 0.35) * 0.28, "z");
    else if (arch === "round") archHood(archMat, x, y + h / 2 - w * 0.1, outerZ, w + 0.25, (w + 0.25) * 0.5, "z");
    else if (arch === "pointed") pointedHood(archMat, x, y + h / 2, outerZ, w + 0.3);
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
    else if (arch === "pointed") archHood(archMat, x + side * outer, y + h / 2, z, w + 0.2, (w + 0.2) * 0.72, "x");
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
  // Round 4: the tops of the unnamed brick fronts differ from one building to the next, as in
  // the West Main 1900 (p.34), White Way 1905 (p.39), East Main 1907, and 1954 (p.113-p.116)
  // photographs: a bracketed metal cornice, a corbelled brick top, a dark pressed-metal
  // cornice, a coped parapet with a raised name block, or an arched brick corbel table.
  // Which front gets which is an estimate (by id); facade.corniceStyle overrides it.
  const CORNICE_STYLES = ["bracket", "corbel", "metal", "panel", "arcade"];
  const CORNICE_1880 = ["bracket", "arcade", "corbel"];
  const streetCornice = (b, wallH, fz, era1880 = false) => {
    const hCornice = idHash(`${b.id}:cornice`);
    const style = b.facade?.corniceStyle || (era1880 ? CORNICE_1880[hCornice % CORNICE_1880.length] : CORNICE_STYLES[hCornice % CORNICE_STYLES.length]);
    const brick = brickOf(b);
    if (style === "bracket") {
      box(mats.trim, 0, wallH - 0.15, fz + 0.05, b.width + 0.5, 0.55, 0.55);
      dentilCourse(wallH - 0.7, fz + 0.22, b.width);
      bracketRow(wallH - 0.85, fz, b.width);
    } else if (style === "corbel") {
      // Three stepped brick courses under a stone coping; no painted trim.
      box(brick, 0, wallH - 2.1, fz + 0.18, b.width, 0.5, 0.36);
      box(brick, 0, wallH - 1.55, fz + 0.34, b.width, 0.5, 0.68);
      box(brick, 0, wallH - 1.0, fz + 0.5, b.width + 0.2, 0.5, 1.0);
      const n = Math.max(4, Math.round(b.width / 1.6));
      for (let i = 0; i < n; i++) box(brick, -b.width / 2 + (b.width * (i + 0.5)) / n, wallH - 2.75, fz + 0.2, 0.55, 0.7, 0.4);
      box(mats.stone, 0, wallH + 0.55, fz - 0.2, b.width + 0.5, 0.35, 1.4);
    } else if (style === "metal") {
      // Dark pressed-metal cornice with a frieze and paired brackets.
      box(mats.trimDark, 0, wallH - 1.2, fz + 0.14, b.width, 1.9, 0.28);
      box(mats.trimDark, 0, wallH - 0.05, fz + 0.55, b.width + 0.9, 0.6, 1.35);
      box(mats.trimDark, 0, wallH + 0.4, fz + 0.7, b.width + 1.2, 0.32, 1.6);
      const n = Math.max(2, Math.round(b.width / 7));
      for (let i = 0; i <= n; i++) {
        const x = -b.width / 2 + 0.3 + ((b.width - 0.6) * i) / n;
        for (const dx of [-0.35, 0.35]) box(mats.trimDark, x + dx, wallH - 1.0, fz + 0.5, 0.3, 1.7, 0.75);
      }
    } else if (style === "panel") {
      // Coped parapet stepping up to a raised name block at the center (no name is painted).
      box(brick, 0, wallH + 0.9, fz - 0.1, b.width, 1.8, 0.8);
      const pw = Math.min(b.width * 0.45, 12);
      box(brick, 0, wallH + 2.3, fz - 0.1, pw, 1.4, 0.8);
      box(mats.stone, 0, wallH + 1.9, fz - 0.05, b.width + 0.3, 0.3, 1.05);
      box(mats.stone, 0, wallH + 3.1, fz - 0.05, pw + 0.4, 0.3, 1.05);
      box(brick, 0, wallH + 1.0, fz + 0.36, pw - 1.2, 0.8, 0.12);
      box(brick, 0, wallH - 0.5, fz + 0.3, b.width, 0.45, 0.45);
    } else {
      // Arched corbel table: small round-headed brick arches under a brick band.
      box(brick, 0, wallH - 0.5, fz + 0.42, b.width + 0.2, 0.7, 0.85);
      const n = Math.max(4, Math.round(b.width / 2.2));
      for (let i = 0; i <= n; i++) box(brick, -b.width / 2 + (b.width * i) / n, wallH - 1.35, fz + 0.3, 0.42, 1.1, 0.6);
      for (let i = 0; i < n; i++) {
        const x = -b.width / 2 + (b.width * (i + 0.5)) / n;
        box(brick, x, wallH - 1.0, fz + 0.3, b.width / n - 0.4, 0.38, 0.6);
      }
      box(mats.stone, 0, wallH + 0.2, fz + 0.1, b.width + 0.4, 0.3, 1.2);
    }
    if (era1880 && !b.facade?.corniceStyle && hCornice % 5 < 2) {
      const pw = Math.min(b.width * 0.42, 10);
      drawPediment(brick, pw, 2.8, wallH + 0.25, fz + 0.22);
      box(mats.stone, 0, wallH + 1.15, fz + 0.5, pw * 0.55, 0.65, 0.16);
    }
  };

  const drawStreetFront = (b, wallH, frame, groundOnly = false) => {
    const fz = b.depth / 2 + 0.14;
    const shade = idHash(`${b.id}:shop`);
    const storeEra = genericEra(b);
    const era1880 = storeEra === "v1880";
    const bays = frame
      ? Math.max(2, Math.min(3, Math.round(b.width / 14)))
      : Math.max(2, Math.min(4, Math.round(b.width / 12)));
    const gap = b.width / bays;
    const arch = frame ? "flat" : era1880 && shade % 2 === 0 ? "round" : "segmental";
    const archMat = frame ? mats.trim : mats.voussoir;
    const doorAt = idHash(b.id) % 2 === 0 ? bays - 1 : 0;
    const winW = Math.min(frame ? 3.2 : 4.2, Math.max(2.3, gap * 0.44));
    const muntin = era1880 ? "two" : false;
    if (b.stories > 1 && !groundOnly) {
      box(mats.stone, 0, wallH * 0.5, fz + 0.01, b.width * 0.94, 0.24, 0.14);
      for (let col = 0; col < bays; col++) {
        const x = -b.width / 2 + gap * (col + 0.5);
        frontSash(x, wallH * 0.72, fz, winW, b.stories > 2 ? 5.4 : 6.8, arch, false, archMat, frame || era1880, true, muntin);
        if (b.stories > 2) frontSash(x, wallH * 0.42, fz, winW, 5.6, arch, false, archMat, frame || era1880, true, muntin);
      }
    }
    if (!frame && !groundOnly) streetCornice(b, wallH, fz, era1880);
    for (let col = 0; col < bays; col++) {
      const x = -b.width / 2 + gap * (col + 0.5);
      if (col === doorAt) {
        const dw = Math.min(3.5, gap - 0.8);
        paneledDoor(x, fz, dw, 7.2);
      } else {
        const gw = Math.min(frame ? 5.2 : 7.0, gap - 0.9);
        const frameMat = shade % 2 ? mats.trimDark : mats.trim;
        box(mats.trimDark, x, 1.05, fz, gw, 1.35, 0.2);
        box(mats.reveal, x, 5.05, fz - 0.04, gw * 0.9, 5.4, 0.12);
        box(shopGlass, x, 5.05, fz + 0.02, gw * 0.84, 5.1, 0.06);
        box(frameMat, x - gw / 2, 5.05, fz + 0.1, 0.24, 5.7, 0.1);
        box(frameMat, x + gw / 2, 5.05, fz + 0.1, 0.24, 5.7, 0.1);
        box(frameMat, x, 7.85, fz + 0.1, gw + 0.16, 0.22, 0.1);
        box(frameMat, x, 2.25, fz + 0.1, gw + 0.16, 0.22, 0.1);
        if (era1880) {
          for (const mx of [-gw * 0.21, 0, gw * 0.21]) box(frameMat, x + mx, 5.05, fz + 0.14, 0.09, 5.1, 0.06);
          box(frameMat, x, 5.6, fz + 0.14, gw * 0.86, 0.09, 0.06);
        } else {
          box(frameMat, x, 5.05, fz + 0.14, 0.08, 5.0, 0.04);
        }
        box(shopGlass, x, 8.15, fz + 0.02, gw * 0.84, 0.62, 0.05);
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
    if (era1880 && frame && shade % 2 === 0 && !b.porch) {
      const pz = fz + 2.8;
      box(mats.plank, 0, 0.45, pz, b.width + 0.4, 0.3, 5.6);
      localBox(mats.roofDark, 0, 10.6, pz, b.width + 0.6, 0.16, 5.8, 0.2);
      const posts = Math.max(2, Math.round(b.width / 12));
      for (let i = 0; i < posts; i++) {
        const px = -b.width / 2 + 0.4 + ((b.width - 0.8) * i) / (posts - 1);
        box(mats.trimDark, px, 5.5, pz + 2.4, 0.34, 9.8, 0.34);
      }
    } else if (b.stories > 1) drawAwning(b.width * 0.9, fz, 10.6);
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

  // Deep projecting crown for the centennial-book buildings: a frieze band, large scroll
  // brackets under a projecting eave, dentils, and a crown molding, carried around every
  // side that is not a party wall. Book photographs: Hendee p.25, Cole p.13 and p.35,
  // City Hall p.125, Bank of Bushnell p.41. Sizes are read from the pictures (estimates).
  const deepCrown = (b, wallH, opt = {}) => {
    const o = typeof opt === "object" ? opt : {};
    const proj = o.proj ?? 2.2;
    const fh = o.frieze ?? 2.4;
    const mat = o.mat === "dark" ? mats.trimDark : o.mat === "white" ? mats.siding.white : mats.trim;
    const friezeMat = o.friezeMat === "body" ? brickOf(b) : o.friezeMat === "dark" ? mats.trimDark : mat;
    const spacing = o.spacing ?? 2.8;
    const fz = b.depth / 2 + 0.14;
    const party = b.party || [];
    const sides = [-1, 1].filter((sd) => !party.includes(sd === -1 ? "left" : "right"));
    const leftOut = sides.includes(-1) ? proj : 0;
    const rightOut = sides.includes(1) ? proj : 0;
    const slabW = b.width + leftOut + rightOut;
    const slabX = (rightOut - leftOut) / 2;
    // Front run.
    box(friezeMat, 0, wallH - fh / 2, fz + 0.12, b.width + 0.1, fh, 0.34);
    box(mat, 0, wallH - fh - 0.15, fz + 0.3, b.width + 0.3, 0.32, 0.6);
    box(mat, slabX, wallH + 0.25, fz + proj / 2, slabW + 0.2, 0.55, proj + 0.4);
    box(mat, slabX, wallH + 0.75, fz + proj / 2 + 0.12, slabW + 0.5, 0.45, proj + 0.75);
    box(mat, slabX, wallH + 1.1, fz + proj / 2 + 0.2, slabW + 0.7, 0.26, proj + 0.95);
    dentilCourse(wallH - 0.18, fz + 0.5, b.width - 0.4, { w: 0.32, h: 0.34, d: 0.4, gap: 0.75, mat });
    const n = Math.max(3, Math.round(b.width / spacing));
    const bracket = (x, z, alongX) => {
      // Scroll bracket: a tall drop on the frieze, a knee, and an arm under the eave.
      const w = alongX ? 0.5 : proj * 0.92;
      const d = alongX ? proj * 0.92 : 0.5;
      box(mat, x, wallH - fh * 0.5, alongX ? z + 0.32 : z, alongX ? 0.5 : 0.62, fh * 0.9, alongX ? 0.62 : 0.5);
      box(mat, alongX ? x : x, wallH - fh * 0.92, alongX ? z + 0.55 : z, alongX ? 0.4 : 1.0, 0.4, alongX ? 1.0 : 0.4);
      box(mat, x, wallH - 0.15, alongX ? z + proj * 0.46 : z, w, 0.42, d);
    };
    for (let i = 0; i < n; i++) {
      const x = -b.width / 2 + 0.55 + ((b.width - 1.1) * i) / (n - 1);
      bracket(x, fz, true);
    }
    // Side runs.
    for (const sd of sides) {
      const sx = sd * (b.width / 2 + 0.14);
      if (o.sideStyle !== "corbel") {
        box(friezeMat, sx + sd * 0.12, wallH - fh / 2, 0, 0.34, fh, b.depth + 0.1);
        box(mat, sx + sd * 0.3, wallH - fh - 0.15, 0, 0.6, 0.32, b.depth + 0.3);
      }
      const sp = o.sideStyle === "corbel" ? 0.9 : proj;
      const smat = o.sideStyle === "corbel" ? brickOf(b) : mat;
      box(smat, sx + sd * (sp / 2), wallH + 0.25, -0.2, sp + 0.4, 0.55, b.depth + 0.2);
      box(smat, sx + sd * (sp / 2 + 0.12), wallH + 0.75, -0.2, sp + 0.75, 0.45, b.depth + 0.4);
      // sideStyle "corbel": stepped brick corbel courses instead of brackets (bank side, p.41).
      if (o.sideStyle === "corbel") {
        box(brickOf(b), sx + sd * 0.25, wallH - 0.9, -0.1, 0.5, 0.5, b.depth + 0.2);
        box(brickOf(b), sx + sd * 0.5, wallH - 0.4, -0.1, 1.0, 0.5, b.depth + 0.3);
        const m2 = Math.round(b.depth / 1.4);
        for (let i = 0; i < m2; i++) box(brickOf(b), sx + sd * 0.2, wallH - 1.5, -b.depth / 2 + (i + 0.5) * (b.depth / m2), 0.4, 0.6, 0.6);
        continue;
      }
      const m = Math.max(3, Math.round(b.depth / (spacing * 1.25)));
      for (let i = 0; i < m; i++) {
        const z = -b.depth / 2 + 0.8 + ((b.depth - 1.6) * i) / (m - 1);
        box(mat, sx + sd * 0.32, wallH - fh * 0.5, z, 0.62, fh * 0.9, 0.5);
        box(mat, sx + sd * (proj * 0.46), wallH - 0.15, z, proj * 0.92, 0.42, 0.5);
      }
    }
    // Corner urn finials on the crown (City Hall, p.125).
    if (o.finials) {
      for (const x of [-b.width / 2 - leftOut * 0.6, b.width / 2 + rightOut * 0.6]) {
        box(mat, x, wallH + 1.6, fz + proj * 0.4, 0.9, 0.7, 0.9);
        const urn = new THREE.SphereGeometry(0.55, 10, 8);
        urn.translate(x, wallH + 2.4, fz + proj * 0.4);
        urn.applyMatrix4(buildingMatrix);
        put(mat, urn);
        box(mat, x, wallH + 3.1, fz + proj * 0.4, 0.18, 0.7, 0.18);
      }
    }
    // Raised name panel above the crown, where a photograph shows one.
    if (o.panel) {
      const pw = Math.min(b.width * 0.5, o.panel.width ?? 16);
      const ph = o.panel.height ?? 3.2;
      box(brickOf(b), 0, wallH + 1.25 + ph / 2, fz - 0.1, pw, ph, 0.8);
      box(mat, 0, wallH + 1.25 + ph + 0.2, fz + 0.1, pw + 0.8, 0.4, 1.2);
      box(mat, 0, wallH + 1.25 + ph / 2, fz + 0.32, pw - 1.2, ph - 1.0, 0.1);
    }
    return wallH + 1.3 + (o.panel ? (o.panel.height ?? 3.2) + 0.6 : 0);
  };

  // Full-width columned porch across the ground floor (Hendee engraving, PDF p.25):
  // turned columns with caps and bases, arched spandrels between them, a fascia that
  // carries the HENDEE sign, a low roof, and a raised deck. Depth is an estimate.
  // style "light": the thin flat canopy on slender square posts of the Hendee engraving
  // (p.25), carried round the corner along one side by wrap: { side, length }.
  const drawLightCanopy = (b, o) => {
    const depth = o.depth ?? 8;
    const h = o.height ?? 12.5;
    const fz = b.depth / 2 + 0.14;
    const zc = fz + depth;
    const w = b.width + (o.extend ?? 0.6);
    const cols = Math.max(2, o.cols ?? 7);
    const xc = (o.shift ?? 0);
    box(mats.plank, xc, 0.6, fz + depth / 2, w, 0.3, depth);
    for (let i = 0; i < cols; i++) {
      const x = xc - w / 2 + 0.3 + ((w - 0.6) * i) / (cols - 1);
      box(mats.trim, x, h / 2, zc - 0.3, 0.38, h, 0.38);
    }
    box(mats.trim, xc, h - 0.3, zc - 0.25, w + 0.2, 0.75, 0.22);
    const roof = new THREE.BoxGeometry(w + 0.3, 0.16, depth + 0.4);
    roof.rotateX(0.05);
    roof.translate(xc, h + 0.1, fz + depth / 2);
    roof.applyMatrix4(buildingMatrix);
    put(mats.roofDark, roof);
    if (o.wrap) {
      const sd = o.wrap.side || 1;
      const len = o.wrap.length ?? b.depth * 0.6;
      const sx = sd * (b.width / 2 + depth / 2 + 0.1);
      const z0 = b.depth / 2 + 0.1;
      box(mats.plank, sx, 0.6, z0 - len / 2, depth, 0.3, len);
      const n = Math.max(2, Math.round(len / 9));
      for (let i = 0; i <= n; i++) box(mats.trim, sx + sd * (depth / 2 - 0.3), h / 2, z0 - (len * i) / n, 0.38, h, 0.38);
      box(mats.trim, sx + sd * (depth / 2 - 0.25), h - 0.3, z0 - len / 2, 0.22, 0.75, len);
      const sroof = new THREE.BoxGeometry(depth + 0.4, 0.16, len);
      sroof.rotateZ(-sd * 0.05);
      sroof.translate(sx, h + 0.1, z0 - len / 2);
      sroof.applyMatrix4(buildingMatrix);
      put(mats.roofDark, sroof);
    }
    return { y: h + 2.2, z: zc };
  };

  const drawVeranda = (b, v) => {
    const o = typeof v === "object" ? v : {};
    if (o.style === "light") return drawLightCanopy(b, o);
    const depth = o.depth ?? 8;
    const h = o.height ?? 11;
    const fz = b.depth / 2 + 0.14;
    const zc = fz + depth;
    const cols = Math.max(2, o.cols ?? 7);
    const w = b.width + 0.6;
    box(mats.stone, 0, 0.45, fz + depth / 2, w, 0.9, depth);
    box(mats.plank, 0, 0.95, fz + depth / 2, w - 0.3, 0.12, depth - 0.3);
    for (let i = 0; i < cols; i++) {
      const x = -w / 2 + 0.5 + ((w - 1) * i) / (cols - 1);
      const col = new THREE.CylinderGeometry(0.46, 0.56, h - 2.2, 14);
      col.translate(x, 1.0 + (h - 2.2) / 2, zc - 0.5);
      col.applyMatrix4(buildingMatrix);
      put(mats.siding.white, col);
      box(mats.siding.white, x, 1.25, zc - 0.5, 1.0, 0.5, 1.0);
      box(mats.siding.white, x, h - 1.05, zc - 0.5, 1.1, 0.4, 1.1);
      if (i < cols - 1) {
        const nx = -w / 2 + 0.5 + ((w - 1) * (i + 1)) / (cols - 1);
        // Shallow segmental spandrel between columns.
        const span = nx - x - 0.9;
        const rr = (span * span) / (8 * 1.4) + 0.7;
        const arc = new THREE.TorusGeometry(rr, 0.22, 5, 18, 2 * Math.asin(Math.min(1, span / 2 / rr)));
        arc.rotateZ(Math.PI / 2 - Math.asin(Math.min(1, span / 2 / rr)));
        arc.translate((x + nx) / 2, h - 1.4 - rr, zc - 0.5);
        arc.applyMatrix4(buildingMatrix);
        put(mats.siding.white, arc);
      }
    }
    // Fascia and cornice of the porch.
    box(mats.siding.white, 0, h - 0.5, zc - 0.5, w + 0.3, 1.8, 0.5);
    box(mats.trimDark, 0, h - 1.45, zc - 0.25, w + 0.3, 0.14, 0.1);
    box(mats.trim, 0, h + 0.45, zc - 0.35, w + 0.6, 0.35, 0.9);
    dentilCourse(h - 1.0, zc - 0.2, w - 0.5, { gap: 0.8 });
    // Low roof falling to the street.
    const roof = new THREE.BoxGeometry(w + 0.4, 0.2, depth + 0.6);
    roof.rotateX(0.08);
    roof.translate(0, h + 0.65, fz + depth / 2);
    roof.applyMatrix4(buildingMatrix);
    put(mats.roofDark, roof);
    // Railing at the open ends.
    for (const sd of [-1, 1]) {
      box(mats.siding.white, sd * (w / 2 - 0.1), 3.3, fz + depth / 2, 0.2, 0.25, depth - 1);
      for (let k = 0; k < 6; k++) box(mats.siding.white, sd * (w / 2 - 0.1), 2.2, fz + 0.8 + (k * (depth - 1.6)) / 5, 0.14, 2.2, 0.14);
    }
    return { y: h + 2.2, z: zc };
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
    const winW = f.winW ?? Math.min(6.2, Math.max(2.2, upperGap * 0.52));
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
          box(shopGlass, x, 5.4, fz + 0.04, gw * 0.92, 7.6, 0.06);
          box(mats.trim, x, 5.4, fz + 0.1, 0.08, 7.4, 0.04);
        } else {
          box(f.brickBase ? brickOf(b) : mats.trimDark, x, f.brickBase ? 1.45 : 1.1, fz, gw, f.brickBase ? 2.5 : 1.45, 0.2);
          box(mats.reveal, x, 5.15, fz - 0.04, gw * 0.9, 5.4, 0.12);
          box(shopGlass, x, 5.15, fz + 0.02, gw * 0.84, 5.15, 0.06);
          // Open frame round the plate glass (it was a solid slab that hid the glass).
          box(mats.trim, x - gw / 2, 5.15, fz + 0.1, 0.24, 5.7, 0.08);
          box(mats.trim, x + gw / 2, 5.15, fz + 0.1, 0.24, 5.7, 0.08);
          box(mats.trim, x, 7.9, fz + 0.1, gw + 0.16, 0.2, 0.08);
          box(mats.trim, x, 2.4, fz + 0.1, gw + 0.16, 0.2, 0.08);
          box(mats.trim, x, 5.15, fz + 0.14, 0.08, 5.0, 0.04);
          box(shopGlass, x, 8.25, fz + 0.02, gw * 0.84, 0.66, 0.05);
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
    // Round-headed ground-floor openings, as in the Hendee building engraving (PDF p.25).
    if (f.groundArch === "round" && f.ground !== "keep") {
      const spring = 7.6;
      const rise = Math.max(1.6, Math.min(gap * 0.45, wallH * 0.5 - spring - 0.4));
      for (let col = 0; col < bays; col++) {
        const x = -b.width / 2 + gap * (col + 0.5);
        archHood(mats.stone, x, spring, fz + 0.3, gap - 0.6, rise, "z");
        box(mats.glass, x, spring + rise * 0.36, fz + 0.03, (gap - 1.4) * 0.84, rise * 0.7, 0.05);
      }
      for (let col = 0; col <= bays; col++) {
        const x = -b.width / 2 + gap * col;
        box(mats.stone, x, 5.4, fz + 0.2, 0.9, 10.8, 0.5);
      }
    }
    // Upper windows set in groups with a pier between them (Hendee engraving: two groups of three).
    const groups = Math.max(1, f.upperGroups || 1);
    const upperX = (col) => {
      if (groups === 1) return -b.width / 2 + upperGap * (col + 0.5);
      const per = Math.ceil(upperBays / groups);
      const g = Math.floor(col / per);
      const i = col % per;
      const groupW = b.width / groups;
      return -b.width / 2 + g * groupW + groupW * 0.12 + ((i + 0.5) * groupW * 0.76) / per;
    };
    if (groups > 1) {
      for (let g = 1; g < groups; g++) {
        box(mats.trim, -b.width / 2 + (b.width * g) / groups, wallH * 0.74, fz + 0.18, 1.0, wallH * 0.46, 0.3);
      }
    }
    if (b.stories > 1) {
      const fill = f.upperFill === "russet" ? mats.siding.darkred : null;
      for (let col = 0; col < upperBays; col++) {
        const x = upperX(col);
        // upperY lowers the upper row so a tall arched head clears a deep frieze (Hendee, p.25).
        const uy = wallH * (f.upperY ?? 0.72);
        frontSash(x, uy, fz, winW, f.upperH ?? winH, arch, false, archMat);
        // heavyCaps: the deep moulded lintel caps over the bank's front windows (p.41).
        if (f.heavyCaps) {
          const top = uy + (f.upperH ?? winH) / 2;
          box(mats.stone, x, top + 0.55, fz + 0.62, winW + 1.1, 0.9, 0.5);
          box(mats.trim, x, top + 1.15, fz + 0.75, winW + 1.6, 0.32, 0.75);
          box(mats.stone, x - winW / 2 - 0.45, top + 0.1, fz + 0.62, 0.35, 0.8, 0.45);
          box(mats.stone, x + winW / 2 + 0.45, top + 0.1, fz + 0.62, 0.35, 0.8, 0.45);
        }
        if (fill) box(fill, x, uy, fz + 0.1, winW * 0.7, winH * 0.72, 0.08);
        if (b.stories > 2) frontSash(x, wallH * 0.45, fz, winW * 0.92, winH * 0.86, arch, false, archMat);
      }
    }
    if (f.crown) deepCrown(b, wallH, f.crown);
    else if (f.cornice === "bracket" || f.cornice === "plain" || f.cornice === "corbel") {
      // Round 4: the same kind of cornice is not the same cornice. The finish (painted wood,
      // dark pressed metal, or stone-colored) and the frieze depth vary by building (estimate);
      // facade.corniceFinish overrides it.
      const finishes = { cream: mats.trim, dark: mats.trimDark, stone: mats.stone };
      const fin = f.corniceFinish || ["cream", "dark", "stone"][idHash(`${b.id}:finish`) % 3];
      const cm = finishes[fin] || mats.trim;
      const deep = idHash(`${b.id}:frieze`) % 2 === 0;
      box(cm, 0, wallH + 0.35, fz + 0.55, b.width + 1.3, deep ? 1.15 : 0.95, deep ? 1.6 : 1.35);
      box(cm, 0, wallH - 0.35, fz + 0.28, b.width + 0.4, 0.42, 0.7);
      if (deep) box(cm, 0, wallH - 1.55, fz + 0.2, b.width, 1.6, 0.3);
      dentilCourse(wallH - 0.15, fz + 0.85, b.width, { mat: cm });
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
    if (f.quoinPilasters) {
      const qCount = Math.floor((wallH - 12.5) / 1.8);
      for (const qx of [-b.width / 2 + 0.5, b.width / 2 - 0.5]) {
        for (let q = 0; q < qCount; q++) {
          const qw = q % 2 === 0 ? 1.5 : 1.05;
          box(mats.stone, qx, 12.2 + q * 1.8, fz + 0.22, qw, 1.15, 0.42);
        }
      }
      if (bays === 13) {
        for (const k of [3, 7, 10]) {
          const px = -b.width / 2 + gap * k;
          box(brickOf(b), px, 12 + (wallH - 14.5) / 2, fz + 0.14, 0.95, wallH - 14.5, 0.28);
          box(mats.stone, px, 11.7, fz + 0.2, 1.15, 0.55, 0.36);
        }
      }
      if (f.shedPorchSide || f.sideStair) {
        const sx = (f.shedPorchSide || f.sideStair) * (b.width / 2 + 0.12);
        for (const sz of [-b.depth / 2 + 0.6, b.depth / 2 - 0.6]) {
          for (let q = 0; q < qCount; q++) {
            const qd = q % 2 === 0 ? 1.5 : 1.05;
            box(mats.stone, sx, 12.2 + q * 1.8, sz, 0.42, 1.15, qd);
          }
        }
      }
    }
    if (f.veranda) drawVeranda(b, f.veranda);
    if (f.pentRoof) {
      localBox(mats.roofSlate, 0, 10.5, fz + 2.3, b.width * 0.98, 0.2, 5.4, -0.38);
      box(mats.trimDark, 0, 9.55, fz + 0.2, b.width, 0.28, 0.35);
    } else if (f.awning) {
      if (f.awningFrom && bays > f.awningFrom) {
        const startX = -b.width / 2 + gap * (f.awningFrom - 1);
        const awW = b.width / 2 - startX - 0.6;
        const awCx = (startX + b.width / 2 - 0.6) / 2;
        localBox(mats.awning, awCx, 10.2, fz + 2.15, awW, 0.12, 4.4, -0.42);
        localBox(mats.awningShade, awCx, 10.1, fz + 2.15, awW * 0.98, 0.05, 4.15, -0.42);
        box(mats.awningShade, awCx, 9.48, fz + 4.05, awW, 0.55, 0.1);
      } else {
        drawAwning(b.width * 0.9, fz);
      }
    }
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
      const pd = 7.2;
      const zc = fz + pd / 2;
      const eaveZ = fz + pd;
      const sd = f.shedPorchSide || 0;
      const postMat = mats.siding.cream;
      const xLeft = sd === -1 ? -b.width / 2 - pd : -b.width / 2;
      const xRight = sd === 1 ? b.width / 2 + pd : b.width / 2;
      const fw = xRight - xLeft;
      const fcx = (xLeft + xRight) / 2;
      box(mats.plank, fcx, 0.48, zc, fw, 0.3, pd);
      // Sloped porch roof falling toward East Main (+rotX tilts +z downward).
      const froof = new THREE.BoxGeometry(fw + 0.3, 0.22, pd + 0.4);
      scaleBoxUVs(froof, fw + 0.3, 0.22, pd + 0.4, mats.roofSlate);
      froof.rotateX(0.2);
      froof.translate(fcx, 9.85, zc);
      froof.applyMatrix4(buildingMatrix);
      put(mats.roofSlate, froof);
      box(postMat, fcx, 9.0, eaveZ - 0.15, fw + 0.3, 0.55, 0.32);
      const postCount = Math.max(4, Math.round(b.width / 9));
      for (let i = 0; i <= postCount; i++) {
        const x = -b.width / 2 + (b.width * i) / postCount;
        box(postMat, x, 4.65, eaveZ - 0.25, 0.42, 8.6, 0.42);
      }
      if (sd) {
        const sx = sd * (b.width / 2 + pd / 2);
        const eaveX = sd * (b.width / 2 + pd);
        box(mats.plank, sx, 0.48, 0, pd, 0.3, b.depth);
        // Side roof falling outward toward the side street (-sd * rotZ tilts sd*x downward).
        const sroof = new THREE.BoxGeometry(pd + 0.4, 0.22, b.depth + 0.4);
        scaleBoxUVs(sroof, pd + 0.4, 0.22, b.depth + 0.4, mats.roofSlate);
        sroof.rotateZ(-sd * 0.2);
        sroof.translate(sx, 9.85, 0);
        sroof.applyMatrix4(buildingMatrix);
        put(mats.roofSlate, sroof);
        box(postMat, eaveX - sd * 0.15, 9.0, 0, 0.32, 0.55, b.depth + 0.3);
        const n = Math.max(3, Math.round(b.depth / 8.5));
        for (let i = 0; i <= n; i++) {
          const pz = -b.depth / 2 + (b.depth * i) / n;
          box(postMat, eaveX - sd * 0.25, 4.65, pz, 0.42, 8.6, 0.42);
        }
        box(postMat, eaveX - sd * 0.25, 4.65, eaveZ - 0.25, 0.48, 8.6, 0.48);
        // Small dormer hood over the 1880 outside stair on the Hail side (p.13).
        if (b.facade?.sideStair === sd) {
          box(mats.roofSlate, sd * (b.width / 2 + 2.2), 11.4, b.facade.stairAt ?? -6, 3.6, 1.4, 3.6);
        }
      }
    }
    const party = b.party || [];
    const sideCount = f.sideBays || 0;
    for (const side of [-1, 1]) {
      if (!sideCount) break;
      if (party.includes(side === -1 ? "left" : "right")) continue;
      const x = side * (b.width / 2 + 0.1);
      // Side-wall window size, height, arch and an optional ground row (round 3: the tall
      // narrow arched side windows of the Bank of Bushnell, p.41).
      const sw = f.sideWinW ?? 2.5;
      const sh = f.sideWinH ?? 4.8;
      const sArch = f.sideArch || arch;
      for (let i = 0; i < sideCount; i++) {
        const z = -b.depth / 2 + ((i + 0.6) * b.depth) / (sideCount + 0.5);
        if (b.stories > 1) sideSash(x, wallH * (f.sideY ?? 0.68), z, side, sw, sh, sArch, false, archMat);
        if (b.stories > 2 && f.sideY) sideSash(x, wallH * 0.45, z, side, sw, sh * 0.95, sArch, false, archMat);
        if (f.sideRows === 2 && !(f.sideSkip || []).includes(i)) sideSash(x, f.sideLowY ?? 5.6, z, side, sw, f.sideLowH ?? sh, sArch, false, archMat);
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
    // Counter-clockwise from the street, so the front face is not culled (it used to show
    // only the rakes and the cornice as an outline).
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
  const drawFalseFront = (b, wallH, body, era1880 = false) => {
    const fz = b.depth / 2 + 0.18;
    const style = idHash(b.id) % 7;
    const parapetH = era1880 ? 5.6 : 4.8;
    box(body, 0, wallH + parapetH / 2 - 0.35, fz - 0.08, b.width + 0.55, parapetH, 1.2);
    box(mats.trim, 0, wallH + parapetH - 0.2, fz + 0.08, b.width + 1.05, 0.42, 1.55);
    box(mats.trim, 0, wallH + 0.42, fz + 0.16, b.width + 0.7, 0.78, 0.72);
    dentilCourse(wallH + 0.05, fz + 0.42, b.width * 0.96);
    bracketRow(wallH - 0.15, fz + 0.02, b.width);
    for (const side of [-1, 1]) {
      box(body, side * (b.width / 2 + 0.05), wallH + parapetH / 2 - 0.35, fz - 1.15, 0.7, parapetH, 2.2);
      box(mats.trim, side * (b.width / 2 + 0.08), wallH + 0.42, fz - 0.85, 0.7, 0.78, 1.5);
    }
    if (style === 4 || (era1880 && style <= 2)) {
      drawPediment(body, b.width * 0.42, era1880 ? 3.4 : 3.1, wallH + parapetH - 0.05, fz + 0.12);
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
    // No hitch rails or barrels at the store fronts from 1950 (1954 photographs, p.113-p.116).
    if (eraYear >= 1950) return;
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

  const NAMED_LANDMARKS = new Set([
    "markham-house-1854",
    "markham-gridley-store",
    "vail-house-1870",
    "west-house-1870",
    "wyckoff-house-1870",
    "masonic-hall-28",
    "zook---johnson-7",
    "jas-cole-flats-1906",
    "home-steam-laundry-1898",
    "bushnell-house-9",
    "st--charles-hotel-51",
    "national-hotel",
    "boarding-house-35",
  ]);
  const hasCustomFacade = (b) =>
    Boolean(
      b.facadeSpec ||
        b.facade?.photoMatch ||
        b.facade?.pioneer ||
        b.facade?.bays ||
        b.facade?.peak ||
        b.facade?.ironFront ||
        b.facade?.hendeeHome ||
        b.facade?.turretHouse ||
        b.facade?.hurst292 ||
        b.facade?.funeralHome ||
        b.facade?.stBernardRectory ||
        b.facade?.cityHall ||
        b.facade?.engineHouse ||
        b.facade?.fireHouse1953 ||
        b.facade?.americanHouse ||
        b.facade?.cornerBay ||
        b.facade?.cornerPediment,
    );
  const buildingYearNum = (b) => {
    const m = String(b.year || "").match(/\d{4}/);
    return m ? parseInt(m[0], 10) : 1880;
  };
  const genericEra = (b) => {
    if (NAMED_LANDMARKS.has(b.id) || hasCustomFacade(b)) return null;
    const yr = buildingYearNum(b);
    if (yr <= 1895) return "v1880";
    if (yr <= 1925) return "e1900";
    if (yr >= 1940) return "p1950";
    return null;
  };
  const PAL1880 = [
    mats.siding1880.warmCream,
    mats.siding1880.buff,
    mats.siding1880.sage,
    mats.siding1880.slateGray,
    mats.siding1880.ochre,
    mats.siding1880.barnRed,
    mats.siding1880.chalkWhite,
    mats.siding1880.taupe,
  ];
  const PAL1880_BY_PAINT = {
    cream: mats.siding1880.warmCream,
    white: mats.siding1880.chalkWhite,
    yellow: mats.siding1880.ochre,
    green: mats.siding1880.sage,
    red: mats.siding1880.barnRed,
    gray: mats.siding1880.slateGray,
    tan: mats.siding1880.buff,
  };
  const paintOf1880 = (b, h) => PAL1880_BY_PAINT[b.paint] || PAL1880[h % PAL1880.length];
  const PAL1910 = [
    mats.siding1910.white,
    mats.siding1910.olive,
    mats.siding1910.mustard,
    mats.siding1910.warmGray,
    mats.siding1910.russet,
    mats.siding1910.cream,
  ];
  const paintOf1910 = (b, h) => PAL1910[h % PAL1910.length];
  const PAL1950 = [
    mats.siding1950.white,
    mats.siding1950.mint,
    mats.siding1950.butter,
    mats.siding1950.blueGray,
    mats.siding1950.sand,
    mats.siding1950.lightGray,
  ];
  const paintOf1950 = (b, h) => PAL1950[h % PAL1950.length];

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

  // facade.signs: exactly the signs a photograph shows, each placed on a face:
  // { text, sub, face: "front" | "side", side: 1 | -1, y, along, width, height, style, reach }.
  // "along" runs to the building's local +x on the front, and toward the front on a side.
  const photoSigns = (b) => {
    const rot = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
    const up = new THREE.Vector3(0, 1, 0);
    const out = new THREE.Vector3(0, 0, 1).applyAxisAngle(up, rot);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(up, rot);
    for (const sg of b.facade.signs) {
      const flat = sg.style === "wall" || sg.style === "wallDark" || sg.style === "glass";
      const reach = sg.reach ?? (flat ? 0.12 : 0.5);
      const pos = new THREE.Vector3(b.x, sg.y ?? 12, b.z);
      let r = rot;
      if (sg.face === "side") {
        const sd = sg.side || 1;
        pos.addScaledVector(right, sd * (b.width / 2 + reach)).addScaledVector(out, sg.along ?? 0);
        r = rot + sd * (Math.PI / 2);
      } else {
        pos.addScaledVector(out, b.depth / 2 + reach).addScaledVector(right, sg.along ?? 0);
      }
      signs.push({ title: sg.text, subtitle: sg.sub || "", style: sg.style || "board", position: pos, rotation: r, width: sg.width ?? 10, height: sg.height, flush: true });
    }
  };

  const signFor = (b, wallH) => {
    if (b.facade?.signs) {
      if (b.id === "bushnell-engine-house" && b.sign === "") return;
      photoSigns(b);
      return;
    }
    if (!b.sign) return;
    // Round 4: most hanging boards come off the stores. A trade word on a stand-in or on a
    // Sanborn-labelled room (GROCERY, DRY GOODS, BARBER...) was never read on the building,
    // so it is not painted. Firm and hall names stay, and so do words read off a
    // photograph (facade.signRead). Upper signs from photographs are kept below.
    const store = b.kind === "brick-store" || b.kind === "frame-store" || (b.kind === "hotel" && b.confidence !== "sourced");
    if (store && !b.facade?.signRead && !b.signRead && (b.confidence !== "sourced" || GENERIC_SIGNS.has(String(b.sign).toUpperCase()))) {
      if (b.facade?.upperSign) {
        const rot0 = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
        const out0 = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot0);
        const y0 = Math.min(wallH - 1.2, b.stories * 8 + 4);
        signs.push({
          title: b.facade.upperSign,
          subtitle: "",
          style: "board",
          position: new THREE.Vector3(b.x, b.facade.upperSignAbove ? wallH + 2.4 : y0 + 4.2, b.z).addScaledVector(out0, b.depth / 2 + 0.55),
          rotation: rot0,
          width: Math.min(b.width * 0.46, 14),
        });
      }
      return;
    }
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
    // signAt: a small board at a chosen spot, e.g. on the Hendee porch roof edge (PDF p.25),
    // so it does not cover the upper windows.
    if (b.facade?.signAt) {
      const at = b.facade.signAt;
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      signs.push({
        title: b.sign,
        subtitle: "",
        style: "board",
        position: new THREE.Vector3(b.x, at.y ?? 12.5, b.z)
          .addScaledVector(outward, b.depth / 2 + (at.reach ?? 0.55))
          .addScaledVector(right, at.along ?? 0),
        rotation: rot,
        width: at.width ?? 12,
      });
      return;
    }
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
        // upperSignAbove: letter the board above the cornice line, where a tall front would
        // otherwise hide it (the Opera House over Sperling's, PDF p.55).
        position: new THREE.Vector3(b.x, b.facade.upperSignAbove ? wallH + 2.4 : y + 4.2, b.z).addScaledVector(outward, reach),
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

  // 1889-1914 City Water Works standpipe (August 1893 Sanborn s4: "IR. W. TANK 53' HIGH, 12' DIAM. ON BR. BASE 56'").
  const addStandpipe1889 = (b) => {
    const bw = b.width * 0.96;
    const baseH = 56;
    box(mats.stone, 0, 1.25, 0, b.width + 0.8, 2.5, b.depth + 0.8);
    box(mats.brick.red, 0, 2.5 + (baseH - 2.5) / 2, 0, bw, baseH - 2.5, bw);
    box(mats.stone, 0, baseH - 0.5, 0, b.width + 0.8, 1.0, b.depth + 0.8);
    box(mats.trimDark, 0, 5.2, bw / 2 + 0.08, 3.2, 6.8, 0.14);
    for (const y of [18, 32, 46]) {
      for (const side of [-1, 1]) {
        box(mats.trimDark, 0, y, side * (bw / 2 + 0.06), 1.4, 3.4, 0.1);
        box(mats.trimDark, side * (bw / 2 + 0.06), y, 0, 0.1, 3.4, 1.4);
      }
    }
    const tankH = 53;
    const tankR = 6.0;
    const tank = new THREE.CylinderGeometry(tankR, tankR, tankH, 24);
    tank.translate(0, baseH + tankH / 2, 0);
    tank.applyMatrix4(buildingMatrix);
    put(mats.metal, tank);
    for (const ry of [baseH + 1, baseH + 14, baseH + 27, baseH + 40, baseH + tankH - 0.4]) {
      const band = new THREE.CylinderGeometry(tankR + 0.15, tankR + 0.15, 0.45, 24);
      band.translate(0, ry, 0);
      band.applyMatrix4(buildingMatrix);
      put(mats.trimDark, band);
    }
    const cap = new THREE.ConeGeometry(tankR + 0.5, 3.2, 24);
    cap.translate(0, baseH + tankH + 1.6, 0);
    cap.applyMatrix4(buildingMatrix);
    put(mats.roofDark, cap);
    return baseH + tankH + 3.2;
  };

  // 1914+ elevated steel water tower (1954 book p.32, 1974 USGS WT, Nagel Bros. photo; dimensions estimated).
  const addWaterTower1914 = (b) => {
    const legSpan = 9.5;
    const topSpan = 6.4;
    const legTopY = 68;
    const strut = (x1, y1, z1, x2, y2, z2, r, mat) => {
      const a = new THREE.Vector3(x1, y1, z1);
      const c = new THREE.Vector3(x2, y2, z2);
      const dir = new THREE.Vector3().subVectors(c, a);
      const len = dir.length();
      const geo = new THREE.CylinderGeometry(r, r, len, 8);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      geo.applyQuaternion(q);
      geo.translate((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
      geo.applyMatrix4(buildingMatrix);
      put(mat, geo);
    };
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of corners) {
      box(mats.stone, sx * legSpan, 1.0, sz * legSpan, 2.8, 2.0, 2.8);
      strut(sx * legSpan, 1.8, sz * legSpan, sx * topSpan, legTopY, sz * topSpan, 0.55, mats.metal);
    }
    const levels = [
      [1.8, legSpan],
      [24, legSpan + (topSpan - legSpan) * (22.2 / (legTopY - 1.8))],
      [46, legSpan + (topSpan - legSpan) * (44.2 / (legTopY - 1.8))],
      [66, topSpan + 0.15],
    ];
    for (let li = 1; li < levels.length; li++) {
      const [y, sp] = levels[li];
      const [py, psp] = levels[li - 1];
      for (let ci = 0; ci < 4; ci++) {
        const [ax, az] = corners[ci];
        const [bx, bz] = corners[(ci + 1) % 4];
        strut(ax * sp, y, az * sp, bx * sp, y, bz * sp, 0.28, mats.metal);
        strut(ax * psp, py, az * psp, bx * sp, y, bz * sp, 0.14, mats.trimDark);
        strut(bx * psp, py, bz * psp, ax * sp, y, az * sp, 0.14, mats.trimDark);
      }
    }
    const riser = new THREE.CylinderGeometry(1.15, 1.15, legTopY - 2, 14);
    riser.translate(0, (legTopY - 2) / 2, 0);
    riser.applyMatrix4(buildingMatrix);
    put(mats.metal, riser);
    const tankR = 9.5;
    const tankH = 22;
    const bowl = new THREE.SphereGeometry(tankR, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    bowl.translate(0, legTopY, 0);
    bowl.applyMatrix4(buildingMatrix);
    put(mats.metal, bowl);
    const tank = new THREE.CylinderGeometry(tankR, tankR, tankH, 24);
    tank.translate(0, legTopY + tankH / 2, 0);
    tank.applyMatrix4(buildingMatrix);
    put(mats.metal, tank);
    const walk = new THREE.CylinderGeometry(tankR + 1.3, tankR + 1.3, 0.4, 24);
    walk.translate(0, legTopY + 0.2, 0);
    walk.applyMatrix4(buildingMatrix);
    put(mats.trimDark, walk);
    const cap = new THREE.ConeGeometry(tankR + 0.8, 8.5, 24);
    cap.translate(0, legTopY + tankH + 4.25, 0);
    cap.applyMatrix4(buildingMatrix);
    put(mats.roofDark, cap);
    const mast = new THREE.CylinderGeometry(0.18, 0.24, 4.5, 8);
    mast.translate(0, legTopY + tankH + 10.5, 0);
    mast.applyMatrix4(buildingMatrix);
    put(mats.trimDark, mast);
    return legTopY + tankH + 12.8;
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

  // True hipped roof: two trapezoid slopes and two triangular hips meeting a ridge, so the
  // ends do not stand up as flat boards. Both windings are emitted so the faces show from
  // outside whatever the mirror does to the winding.
  const trueHip = (width, depth, rise, yBase, mat, ox = 0, oz = 0, overhang = 1.2) => {
    const W = width / 2 + overhang;
    const D = depth / 2 + overhang;
    const alongX = W >= D;
    const r = alongX ? W - D : D - W;
    const top = yBase + rise;
    const P = (x, y, z) => [x + ox, y, z + oz];
    const a = P(-W, yBase, -D), b2 = P(W, yBase, -D), c = P(W, yBase, D), d = P(-W, yBase, D);
    const e = alongX ? P(-r, top, 0) : P(0, top, -r);
    const f = alongX ? P(r, top, 0) : P(0, top, r);
    const tris = alongX
      ? [[d, c, f], [d, f, e], [b2, a, e], [b2, e, f], [a, d, e], [c, b2, f]]
      : [[d, c, f], [a, e, b2], [c, b2, e], [c, e, f], [a, d, f], [a, f, e]];
    const pos = [];
    for (const [p1, p2, p3] of tris) pos.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const uv = [];
    for (let i = 0; i < pos.length / 3; i++) uv.push(pos[i * 3] / 8, (pos[i * 3 + 1] + pos[i * 3 + 2]) / 8);
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    // Indexed like every other piece, so it merges into the same material batch.
    geo.setIndex([...Array(pos.length / 3).keys()]);
    geo.computeVertexNormals();
    geo.applyMatrix4(buildingMatrix);
    put(mat, geo);
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

  const sashFront = (x, y, z, w, h, lights, shutters, hood, shutterMat = mats.shutter) => {
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
    } else if (lights === "two") {
      box(mats.trim, x, y + up, glassZ + 0.06, 0.05, paneH * 0.92, 0.05);
      box(mats.trim, x, y - up, glassZ + 0.06, 0.05, paneH * 0.92, 0.05);
    } else if (lights === "three") {
      box(mats.trim, x - w * 0.16, y + up, glassZ + 0.06, 0.045, paneH * 0.92, 0.05);
      box(mats.trim, x + w * 0.16, y + up, glassZ + 0.06, 0.045, paneH * 0.92, 0.05);
    }
    box(mats.trim, x, y - h / 2 - 0.12, outerZ + 0.06, w + 0.55, 0.13, 0.5);
    if (hood) localBox(mats.trim, x, y + h / 2 + 0.3, outerZ + 0.12, w + 0.55, 0.08, 0.72, -0.42);
    else box(mats.trim, x, y + h / 2 + 0.16, outerZ, w + 0.42, 0.14, 0.34);
    if (shutters) {
      const sw = Math.min(0.5, w * 0.36);
      box(shutterMat, x - w / 2 - sw * 0.56, y, outerZ - 0.06, sw, h * 0.88, 0.06);
      box(shutterMat, x + w / 2 + sw * 0.56, y, outerZ - 0.06, sw, h * 0.88, 0.06);
    }
  };

  const sashSide = (x, y, z, out, w, h, lights, shutters, shutterMat = mats.shutter) => {
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
    } else if (lights === "two") {
      box(mats.trim, glassX + out * 0.06, y + up, z, 0.045, paneH * 0.9, 0.05);
      box(mats.trim, glassX + out * 0.06, y - up, z, 0.045, paneH * 0.9, 0.05);
    } else if (lights === "three") {
      box(mats.trim, glassX + out * 0.06, y + up, z - w * 0.16, 0.04, paneH * 0.9, 0.04);
      box(mats.trim, glassX + out * 0.06, y + up, z + w * 0.16, 0.04, paneH * 0.9, 0.04);
    }
    box(mats.trim, x + out * (outer + 0.04), y - h / 2 - 0.1, z, 0.42, 0.12, w + 0.4);
    box(mats.trim, x + out * outer, y + h / 2 + 0.12, z, 0.28, 0.12, w + 0.36);
    if (shutters) {
      const sw = Math.min(0.42, w * 0.34);
      box(shutterMat, x + out * (outer - 0.04), y, z - w / 2 - sw * 0.55, 0.055, h * 0.86, sw);
      box(shutterMat, x + out * (outer - 0.04), y, z + w / 2 + sw * 0.55, 0.055, h * 0.86, sw);
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

  const squarePost = (x, z, top) => {
    box(mats.trimDark, x, 0.34, z, 0.52, 0.46, 0.52);
    box(mats.trim, x, (0.58 + top) / 2, z, 0.34, Math.max(1.2, top - 0.68), 0.34);
    box(mats.trimDark, x, top - 0.2, z, 0.52, 0.28, 0.52);
  };

  const craftsmanPost = (x, z, top, pierMat = mats.brick.red) => {
    const pierH = 3.2;
    box(pierMat, x, pierH / 2 + 0.25, z, 1.15, pierH, 1.15);
    box(mats.stone, x, pierH + 0.3, z, 1.32, 0.22, 1.32);
    const colH = Math.max(1.2, top - pierH - 0.55);
    box(mats.trim, x, pierH + 0.42 + colH / 2, z, 0.62, colH, 0.62);
    box(mats.trimDark, x, top - 0.22, z, 0.78, 0.26, 0.78);
  };

  const dormerFront = (x, yBase, z, w, h, roofMat, bodyMat, lights = "one", shutterMat = mats.shutter) => {
    const d = 4.2;
    box(bodyMat, x, yBase + h / 2, z, w, h, d);
    gableFrontAt(w + 0.4, d + 0.6, w * 0.38, yBase + h, roofMat, x, z);
    clapboardTriangle(bodyMat, w, w * 0.35, yBase + h, "z", z + d / 2 + 0.02, x, z);
    sashFront(x, yBase + h * 0.52, z + d / 2 + 0.06, Math.min(2.1, w * 0.46), h * 0.68, lights, false, false, shutterMat);
  };

  const frontPorch = (x, z, span, depth, doorX, opt = {}) => {
    const top = opt.top ?? 8.15;
    const deckMat = opt.deckMat || mats.plank;
    box(deckMat, x, 0.38, z, span, 0.24, depth);
    if (opt.deckMat === mats.concreteBase) {
      box(mats.concreteBase, x, 0.16, z, span + 0.2, 0.32, depth + 0.2);
    }
    localBox(mats.roof, x, top, z, span + 0.7, 0.14, depth + 0.45, opt.pitch ?? 0.2);
    box(mats.trim, x, top - 0.15, z - depth / 2 + 0.15, span + 0.3, 0.28, 0.22);
    const n = opt.posts ?? Math.max(2, Math.round(span / 7.5));
    const posts = [];
    for (let i = 0; i < n; i++) posts.push(x - span / 2 + (span * i) / (n - 1));
    for (const px of posts) {
      const pz = z + depth / 2 - 0.42;
      if (opt.postStyle === "craftsman") craftsmanPost(px, pz, top - 0.15, opt.pierMat || mats.brick.red);
      else if (opt.postStyle === "square") squarePost(px, pz, top - 0.15);
      else turnedPost(px, pz, top - 0.15);
    }
    if (opt.noRail) return;
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
    const era = genericEra(b);
    const yr = buildingYearNum(b);
    const gridley = (b.name || "").startsWith("Gridley") || (b.id || "").startsWith("gridley-");
    const onCrafford =
      (b.facing === "+z" || b.facing === "-z") && Math.abs(b.z - 581) > 40 && Math.abs(b.z - 581) < 100;
    let plan = b.plan;
    if (era === "e1900") {
      const st = Number(b.stories) || 1.5;
      const roll = h % 3;
      if (roll === 0) plan = "queen-anne";
      else if (roll === 1 && (st >= 1.75 || (b.width >= 24 && b.depth >= 24 && h % 2 === 0))) plan = "foursquare";
      else plan = "bungalow";
    } else if (era === "p1950") {
      plan = yr >= 1960 ? "ranch" : "cape-cod";
    } else if (!plan) {
      if (gridley || onCrafford) plan = "gable-front";
      else if (era === "v1880") {
        const roll = h % 20;
        if (roll < 5) plan = "italianate";
        else if (roll < 12) plan = "gable-front";
        else if (roll < 16) plan = "gable-ell";
        else plan = "i-house";
      } else {
        const roll = h % 12;
        if (roll === 0) plan = "italianate";
        else if (roll <= 4) plan = "gable-ell";
        else if (roll <= 7) plan = "gable-front";
        else if (roll <= 9) plan = "i-house";
        else plan = "cottage";
      }
    }
    const stories = Number(b.stories) || (plan === "cottage" || plan === "ranch" ? 1 : 2);
    const floors = Math.max(1, Math.floor(stories + 0.001));
    const half = stories - floors > 0.4 || (plan === "gable-front" && !b.plan && h % 3 === 1);
    const brick = b.material === "brick";
    const body = brick
      ? brickOf(b)
      : era === "v1880"
        ? paintOf1880(b, h)
        : era === "e1900"
          ? paintOf1910(b, h)
          : era === "p1950"
            ? paintOf1950(b, h)
            : paintOf(b);
    const lights =
      b.sash ||
      (era === "v1880"
        ? "two"
        : era === "e1900"
          ? plan === "bungalow"
            ? "three"
            : "one"
          : era === "p1950"
            ? "one"
            : plan === "italianate"
              ? "two"
              : plan === "cottage"
                ? "six"
                : h % 2 === 0
                  ? "six"
                  : "two");
    const shutterMat = era === "v1880" ? mats.shutter1880 : mats.shutter;
    const shutters =
      era === "v1880"
        ? h % 5 < 3
        : era === "e1900"
          ? false
          : era === "p1950"
            ? plan === "cape-cod" && h % 2 === 0
            : true;
    const hood = plan === "italianate";
    const foundMat = era === "p1950" ? mats.concreteBase : mats.stone;
    const porchOpt =
      era === "v1880"
        ? { postStyle: h % 10 < 7 ? "square" : "turned" }
        : era === "e1900"
          ? plan === "bungalow" || plan === "foursquare"
            ? { postStyle: "craftsman", pierMat: h % 2 === 0 ? mats.brick.red : mats.stone, pitch: 0.14 }
            : { postStyle: "square" }
          : {};
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
      box(foundMat, x, 0.32, z, width + 0.28, 0.64, depth + 0.28);
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
        trueHip(width, depth, rise, plate, mats.roof, x, z, 1.3);
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
        sashFront(px, winY1, fz, ww, winH1, lights, shutters, hood, shutterMat);
        if (fl > 1) sashFront(px, winY2, fz, ww * 0.94, winH2, lights, shutters, hood, shutterMat);
      }
      return fz;
    };

    const sideWindows = (x, z, width, depth, fl, out) => {
      const rows = depth > 28 ? 2 : 1;
      for (let i = 0; i < rows; i++) {
        const pz = z - depth * 0.18 + i * depth * 0.36;
        sashSide(x + out * (width / 2 + 0.06), winY1, pz, out, 2.05, 4.4, lights, shutters && h % 2 === 0, shutterMat);
        if (fl > 1) sashSide(x + out * (width / 2 + 0.06), winY2, pz, out, 1.9, 4.2, lights, false, shutterMat);
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
      frontPorch(0, yardFront + 3.15, b.width * 0.96, 6.1, doorX, porchOpt);
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
      frontPorch(0, b.depth / 2 + 3.15, b.width * 0.94, 6.2, 0, porchOpt);
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
        roof: era === "v1880" && h % 5 < 3 ? "hip" : "side",
        rise: Math.max(5.6, Math.min(b.width, b.depth) * 0.23),
      });
      const fullPorch = h % 2 === 0;
      const doorX = 0;
      frontWindows(0, 0, b.width, b.depth, 2, doorX);
      paneledDoor(doorX, b.depth / 2 + 0.06, 2.8, 7.15, true);
      sideWindows(0, 0, b.width, b.depth, 2, -1);
      sideWindows(0, 0, b.width, b.depth, 2, 1);
      houseBrackets(0, b.depth / 2, b.width, main.plate);
      if (fullPorch) frontPorch(0, b.depth / 2 + 3.2, b.width * 0.9, 6.3, 0, porchOpt);
      else frontPorch(0, b.depth / 2 + 3.05, Math.min(12, b.width * 0.5), 6, 0, porchOpt);
      houseChimney(b.width * 0.22, -b.depth * 0.08, main.plate, main.rise + 1.5);
      top = main.plate + main.rise + 2;
    } else if (plan === "foursquare") {
      const fl = Math.max(2, floors);
      const main = drawMass({
        x: 0,
        z: 0,
        width: b.width,
        depth: b.depth,
        floors: fl,
        half: false,
        roof: "hip",
        rise: Math.max(5.8, Math.min(b.width, b.depth) * 0.28),
      });
      const doorX = 0;
      frontWindows(0, 0, b.width, b.depth, fl, doorX);
      paneledDoor(doorX, b.depth / 2 + 0.06, 2.7, 7.0, true);
      sideWindows(0, 0, b.width, b.depth, fl, -1);
      sideWindows(0, 0, b.width, b.depth, fl, 1);
      dormerFront(0, main.plate + 0.2, b.depth / 2 - 4.8, Math.min(6.4, b.width * 0.28), 3.6, mats.roof, body, "one", shutterMat);
      frontPorch(0, b.depth / 2 + 3.1, b.width * 0.94, 6.0, doorX, { ...porchOpt, posts: 4 });
      houseChimney(b.width * 0.22, -b.depth * 0.08, main.plate, main.rise);
      top = main.plate + main.rise;
    } else if (plan === "queen-anne") {
      const fl = Math.max(2, floors);
      const main = drawMass({
        x: 0,
        z: 0,
        width: b.width,
        depth: b.depth,
        floors: fl,
        half: true,
        roof: "front",
        rise: Math.max(8.2, b.width * 0.44),
      });
      const side = h % 2 === 0 ? -1 : 1;
      const doorX = -side * Math.min(b.width * 0.22, b.width / 2 - 3.2);
      const bayX = side * Math.min(b.width * 0.22, b.width / 2 - 4.2);
      // Shallow projecting front gable bay strictly within lot footprint
      box(body, bayX, main.plate / 2, b.depth / 2 + 0.55, 7.4, main.plate, 1.3);
      gableFrontAt(7.6, 4.0, 3.6, main.plate, mats.roof, bayX, b.depth / 2 - 1.2);
      frontWindows(0, 0, b.width, b.depth, fl, doorX);
      paneledDoor(doorX, b.depth / 2 + 0.06, 2.65, 7.05, true);
      sideWindows(0, 0, b.width, b.depth, fl, -1);
      sideWindows(0, 0, b.width, b.depth, fl, 1);
      sashFront(0, main.plate + main.rise * 0.4, b.depth / 2 + 0.16, 2.2, 3.3, "one", false, false, shutterMat);
      frontPorch(-side * (b.width * 0.12), b.depth / 2 + 3.05, b.width * 0.68, 5.9, doorX, { postStyle: "square", pitch: 0.18 });
      houseChimney(-side * b.width * 0.25, -b.depth * 0.12, main.plate, main.rise);
      top = main.plate + main.rise;
    } else if (plan === "bungalow") {
      const fl = 1;
      const main = drawMass({
        x: 0,
        z: 0,
        width: b.width,
        depth: b.depth,
        floors: fl,
        half: stories >= 1.4,
        roof: "side",
        rise: Math.max(5.8, Math.min(b.width, b.depth) * 0.26),
      });
      const doorX = h % 3 === 0 ? -b.width * 0.14 : h % 3 === 1 ? b.width * 0.14 : 0;
      frontWindows(0, 0, b.width, b.depth, fl, doorX);
      paneledDoor(doorX, b.depth / 2 + 0.06, 2.75, 6.8, false);
      sideWindows(0, 0, b.width, b.depth, fl, -1);
      sideWindows(0, 0, b.width, b.depth, fl, 1);
      // Exposed Craftsman knee-brace brackets under eaves
      for (const bx of [-b.width * 0.36, 0, b.width * 0.36]) {
        box(mats.trimDark, bx, main.plate - 0.55, b.depth / 2 + 0.28, 0.24, 0.9, 0.65);
      }
      if (stories >= 1.4) {
        dormerFront(0, main.plate + 0.15, b.depth / 2 - 4.4, Math.min(7.2, b.width * 0.32), 3.4, mats.roof, body, "three", shutterMat);
      }
      frontPorch(0, b.depth / 2 + 3.25, b.width * 0.92, 6.2, doorX, doorX === 0 ? { ...porchOpt, posts: 4 } : porchOpt);
      houseChimney(b.width * 0.28, 0, main.plate, main.rise);
      top = main.plate + main.rise;
    } else if (plan === "cape-cod") {
      const main = drawMass({
        x: 0,
        z: 0,
        width: b.width,
        depth: b.depth,
        floors: 1,
        half: true,
        roof: "side",
        rise: Math.max(6.8, Math.min(b.width, b.depth) * 0.34),
      });
      const doorX = 0;
      frontWindows(0, 0, b.width, b.depth, 1, doorX);
      paneledDoor(doorX, b.depth / 2 + 0.06, 2.6, 6.7, false);
      sideWindows(0, 0, b.width, b.depth, 1, -1);
      sideWindows(0, 0, b.width, b.depth, 1, 1);
      // Pair of front Cape Cod dormers
      const dOff = Math.min(b.width * 0.26, b.width / 2 - 4.2);
      for (const dx of [-dOff, dOff]) {
        dormerFront(dx, main.plate + 0.15, b.depth / 2 - 4.0, 4.2, 3.4, mats.roof, body, "one", shutterMat);
      }
      // Concrete front stoop & modest gable entry hood (no Victorian veranda)
      box(mats.concreteBase, 0, 0.32, b.depth / 2 + 1.85, 5.4, 0.64, 3.6);
      gableFrontAt(5.0, 3.4, 1.5, 7.65, mats.roof, 0, b.depth / 2 + 1.7);
      houseChimney(b.width * 0.28, 0, main.plate, main.rise);
      top = main.plate + main.rise;
    } else if (plan === "ranch") {
      const main = drawMass({
        x: 0,
        z: 0,
        width: b.width,
        depth: b.depth,
        floors: 1,
        half: false,
        roof: h % 2 === 0 ? "hip" : "side",
        rise: Math.max(4.0, Math.min(b.width, b.depth) * 0.16),
      });
      // Optional brick wainscot skirt along lower 3.2 ft of front wall
      if (h % 5 < 3) {
        box(mats.brick.red, 0, 1.85, b.depth / 2 + 0.06, b.width + 0.12, 3.0, 0.14);
      }
      // Attached garage bay inside right/left end of the 36-ft frontage, plus picture window & entry stoop
      const garSide = h % 2 === 0 ? 1 : -1;
      const garW = Math.min(11.5, b.width * 0.34);
      const garX = garSide * (b.width / 2 - garW / 2 - 0.8);
      const fz = b.depth / 2 + 0.08;
      box(mats.trim, garX, 3.85, fz + 0.02, garW - 1.2, 6.9, 0.16);
      box(mats.trim, garX, 3.85, fz + 0.07, garW - 1.7, 6.4, 0.1);
      for (const gy of [2.1, 3.8, 5.5]) box(mats.trimDark, garX, gy, fz + 0.13, garW - 1.8, 0.08, 0.04);
      const doorX = -garSide * 1.4;
      paneledDoor(doorX, fz, 2.6, 6.65, false);
      box(mats.concreteBase, doorX, 0.32, b.depth / 2 + 1.65, 4.8, 0.64, 3.2);
      localBox(mats.roof, doorX, 7.85, b.depth / 2 + 1.5, 5.2, 0.14, 3.0, 0.18);
      // Wide horizontal picture window on living room wing
      const picX = -garSide * Math.min(b.width * 0.27, b.width / 2 - 4.4);
      sashFront(picX, 4.75, fz, Math.min(5.2, b.width * 0.18), 3.8, "one", false, false, shutterMat);
      sideWindows(0, 0, b.width, b.depth, 1, -1);
      sideWindows(0, 0, b.width, b.depth, 1, 1);
      houseChimney(-garSide * b.width * 0.15, -b.depth * 0.1, main.plate, main.rise);
      top = main.plate + main.rise;
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
      frontPorch(0, b.depth / 2 + 3.15, b.width * 0.92, 6.1, doorX, porchOpt);
      houseChimney(frontGable ? 0 : b.width * 0.26, frontGable ? -b.depth * 0.12 : 0, mass.plate, mass.rise);
      top = mass.plate + mass.rise;
    }

    const wantFence =
      era === "v1880"
        ? !b.id.startsWith("rural-") && h % 3 === 0
        : era === "e1900" || era === "p1950"
          ? false
          : h % 6 !== 0;
    if (wantFence) {
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
    const isRural = b.id.startsWith("rural-");
    const wantPrivy = era === "p1950" ? false : era === "e1900" ? (isRural && h % 3 === 0) : h % 5 !== 0;
    const wantShed = era === "p1950" ? (isRural && h % 4 === 0) : h % 3 !== 1;
    const wantWell = era === "p1950" || era === "e1900" ? false : h % 4 === 0;
    if (wantPrivy || (era !== "p1950" && era !== "e1900" && !wantPrivy && !wantShed)) {
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
    // facade.floorH: taller storeys for the photo-matched brick blocks (estimate, round 3).
    if (b.id === "cole-building-10") tint.set("#c6c8d6"); // Round 7: duller, greyer buff (p.13, p.35; estimate).
    const storeEra = genericEra(b);
    const era1880 = storeEra === "v1880";
    const floorH = b.facade?.floorH ?? 12;
    const wallH = b.stories * floorH;
    const body = frame ? (era1880 ? paintOf1880(b, idHash(b.id)) : paintOf(b)) : brickOf(b);
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
        drawFalseFront(b, wallH, body, era1880);
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
      // With the deep crown the pediment sits on the crown molding (PDF p.41), not in the air.
      const rise = b.facade?.crown ? 5.8 : 6.4;
      const yBase = b.facade?.crown ? wallH + 1.3 : wallH + 2.7;
      // pedimentWidth / pedimentRise / finial: the p.41 front pediment spans most of the
      // narrow front and carries a tall turned finial.
      const pw = b.facade?.pedimentWidth ?? Math.min(18, b.width + 1.2);
      const pr = b.facade?.pedimentRise ?? rise;
      if (b.facade?.crown) box(brickOf(b), 0, yBase + 1.0, b.depth / 2 - 0.2, pw - 1, 2.0, 1.2);
      drawPediment(brickOf(b), pw, pr, yBase, b.depth / 2 + 0.55);
      const peak = yBase + pr;
      if (b.facade?.finial === "tall") {
        box(mats.trim, 0, peak + 0.9, b.depth / 2 + 0.7, 1.4, 1.8, 1.4);
        const urn = new THREE.SphereGeometry(0.75, 10, 8);
        urn.translate(0, peak + 2.4, b.depth / 2 + 0.7);
        urn.applyMatrix4(buildingMatrix);
        put(mats.trim, urn);
        box(mats.trim, 0, peak + 3.6, b.depth / 2 + 0.7, 0.3, 1.6, 0.3);
      } else {
        box(mats.trim, 0, peak + 1.3, b.depth / 2 + 0.7, 0.38, 2.6, 0.38);
        box(mats.trimDark, 0, peak + 2.75, b.depth / 2 + 0.7, 0.85, 0.4, 0.85);
      }
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
    // Outside stair up the side wall, chimneys, and a sign on the side wall, as in the
    // "Bank of Bushnell corner in the 90's" photograph (centennial book, PDF p.41).
    if (b.facade?.sideStair) {
      const side = b.facade.sideStair;
      const sx = side * (b.width / 2 + 1.9);
      const z0 = b.facade.stairAt ?? b.depth / 2 - 12;
      const z1 = z0 - 15;
      const rise = floorH + 0.4;
      const run = Math.abs(z0 - z1);
      const len = Math.hypot(run, rise);
      // Open stair: two stringers and separate treads (it read as a solid ramp, p.41).
      for (const off of [-1.35, 1.35]) {
        const stringer = new THREE.BoxGeometry(0.25, 0.9, len);
        stringer.rotateX(Math.atan2(rise, run));
        stringer.translate(sx + off, rise / 2, (z0 + z1) / 2);
        stringer.applyMatrix4(buildingMatrix);
        put(mats.trimDark, stringer);
      }
      const steps = Math.round(rise / 0.62);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        box(mats.plank, sx, rise * t, z0 + (z1 - z0) * t, 2.6, 0.14, 0.8);
      }
      for (const rail of [-1.4, 1.4]) {
        const r = new THREE.BoxGeometry(0.14, 0.14, len);
        r.rotateX(Math.atan2(rise, run));
        r.translate(sx + rail, rise / 2 + 3.0, (z0 + z1) / 2);
        r.applyMatrix4(buildingMatrix);
        put(mats.trimDark, r);
      }
      box(mats.trimDark, sx, rise - 0.1, z1 - 2.2, 3.2, 0.32, 4.6);
      box(mats.trimDark, sx + 1.4, rise + 1.5, z1 - 2.2, 0.14, 3.0, 4.6);
      box(mats.trimDark, sx + side * 1.45, rise / 2, z1 - 4.3, 0.3, rise, 0.3);
      box(mats.trimDark, side * (b.width / 2 + 0.1), rise + 3.9, z1 - 2.2, 0.2, 7.2, 3.2);
    }
    for (let i = 0; i < (b.facade?.chimneys || 0); i++) {
      const n = b.facade.chimneys;
      const z = -b.depth / 2 + (b.depth * (i + 0.6)) / (n + 0.2);
      // chimneySide puts every stack on one side wall (Hendee engraving p.25, bank photo p.41).
      const cx = b.facade.chimneySide ? b.facade.chimneySide * (b.width / 2 - 1.4) : (i % 2 ? -1 : 1) * (b.width / 2 - 2.2);
      chimneyStack(brickOf(b), cx, wallH + 3.4, z, 2.4, 5.6, 2.4);
    }
    if (b.facade?.sideSign) {
      const side = b.facade.sideSign.side || 1;
      const rot = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
      const outward = new THREE.Vector3(side, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      const along = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      signs.push({
        title: b.facade.sideSign.text,
        subtitle: "",
        style: "board",
        position: new THREE.Vector3(b.x, b.facade.sideSign.y ?? 12.6, b.z)
          .addScaledVector(outward, b.width / 2 + 0.55)
          .addScaledVector(along, b.depth / 2 - (b.facade.sideSign.from ?? 9)),
        rotation: rot + side * (Math.PI / 2),
        width: b.facade.sideSign.width ?? 14,
      });
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
  // First Presbyterian Church enlarged 1916-1917 (Mark's postcard & PDF p.66):
  // Left 2-story Smith Memorial Hall gable wing with basement lights and wide stained-glass
  // gable windows, central crenellated brick tower with entrance canopy and louvered belfry,
  // and right sanctuary gable wing with 3-light pointed window and cross gable.
  const addGothicChurch = (b) => {
    const body = brickOf(b);
    const st = mats.stone;
    const rf = mats.roofDark;
    const W = b.width;
    const D = b.depth;
    const fz = D / 2;

    // Rear sanctuary nave mass tying the wings together.
    const naveW = W - 4;
    const naveD = D - 18;
    const naveZc = -9;
    box(body, 2, 11.5, naveZc, naveW, 23, naveD);
    box(st, 2, 1.8, naveZc, naveW + 0.6, 3.6, naveD + 0.6);
    gableAt(naveW, naveD, 12, 23, rf, 2, naveZc);

    // Left 2-story gabled Smith Memorial Hall wing (p.66).
    const hw = 21;
    const hd = D - 4;
    const hx = -W / 2 + hw / 2;
    const hzc = 2;
    const hWall = 23;
    const hRise = 10.5;
    box(body, hx, hWall / 2, hzc, hw, hWall, hd);
    box(mats.brick.dark, hx, 1.9, hzc, hw + 0.5, 3.8, hd + 0.5);
    box(st, hx, 3.9, hzc, hw + 0.7, 0.45, hd + 0.7);
    gableFrontAt(hw, hd, hRise, hWall, rf, hx, hzc);
    clapboardTriangle(body, hw, hRise * 0.96, hWall, "z", fz, hx, 0);
    clapboardTriangle(body, hw, hRise * 0.96, hWall, "z", hzc - hd / 2, hx, 0);
    gableCoping(mats.trim, hw + 1.0, hRise * 0.96 + 0.3, hWall, fz + 0.35, hx, 0.55);
    // Half-timber truss in the Smith Hall gable peak (p.66).
    box(mats.trim, hx, hWall + 2.8, fz + 0.12, hw * 0.68, 0.35, 0.25);
    box(mats.trim, hx, hWall + 5.8, fz + 0.12, 0.35, 6.2, 0.25);
    const MHall = faceM(0, hx, fz);
    // 1st-floor wide 3-light square stained-glass window + 2nd-floor wide arched 3-light window.
    for (const bx of [-5.2, -1.7, 1.7, 5.2]) {
      fbox(MHall, mats.trimDark, bx, 1.8, 0.28, 1.8, 1.6, 0.12);
      fbox(MHall, st, bx, 1.8, 0.2, 2.3, 2.0, 0.2);
    }
    fbox(MHall, st, 0, 7.6, 0.12, 8.6, 5.6, 0.24);
    fbox(MHall, shopGlass, 0, 7.6, 0.18, 7.6, 4.8, 0.08);
    for (const u of [-1.25, 1.25]) fbox(MHall, mats.trim, u, 7.6, 0.25, 0.26, 4.8, 0.14);
    fbox(MHall, st, 0, 10.6, 0.26, 9.2, 0.5, 0.45);
    fbox(MHall, st, 0, 4.8, 0.26, 9.2, 0.45, 0.45);
    // 2nd floor wide round-arched 3-light window.
    roundWin(MHall, 0, 14.2, 7.8, 3.2, { lights: 3, circle: false, surround: 0.55, mat: st });
    // Left return wall of Smith Memorial Hall: 3 bays of triple flat windows per story (p.66).
    const MHL = faceM(-Math.PI / 2, -W / 2, hzc);
    for (const u of [-16, -2, 12]) {
      fbox(MHL, mats.trimDark, u, 1.8, 0.28, 3.0, 1.6, 0.12);
      fbox(MHL, st, u, 1.8, 0.2, 3.6, 2.0, 0.2);
      for (const yy of [7.6, 16.5]) {
        for (const dx of [-2.0, 0, 2.0]) {
          fbox(MHL, mats.trim, u + dx, yy, 0.14, 1.6, 4.8, 0.2);
          fbox(MHL, shopGlass, u + dx, yy, 0.18, 1.2, 4.2, 0.08);
        }
        fbox(MHL, st, u, yy + 2.6, 0.24, 6.2, 0.42, 0.38);
        fbox(MHL, st, u, yy - 2.6, 0.24, 6.2, 0.38, 0.38);
      }
    }

    // Central square crenellated tower (14x14, 41 ft tall).
    const tw = 14;
    const tx = 0.5;
    const tz = fz - tw / 2 + 1.5;
    const th = 41;
    box(body, tx, th / 2, tz, tw, th, tw);
    box(mats.brick.dark, tx, 1.9, tz, tw + 0.5, 3.8, tw + 0.5);
    box(st, tx, 3.9, tz, tw + 0.7, 0.45, tw + 0.7);
    box(st, tx, 13.8, tz, tw + 0.7, 0.55, tw + 0.7);
    box(st, tx, 27.6, tz, tw + 0.5, 0.45, tw + 0.5);
    box(st, tx, th + 0.25, tz, tw + 0.7, 0.55, tw + 0.7);
    // 5 crenellated merlons per side with stone caps.
    for (let i = 0; i < 5; i++) {
      const o = -tw / 2 + 1.1 + i * ((tw - 2.2) / 4);
      for (const sd of [-1, 1]) {
        box(body, tx + o, th + 1.4, tz + sd * (tw / 2 - 0.55), 1.6, 1.9, 1.1);
        box(st, tx + o, th + 2.45, tz + sd * (tw / 2 - 0.55), 1.85, 0.32, 1.3);
        box(body, tx + sd * (tw / 2 - 0.55), th + 1.4, tz + o, 1.1, 1.9, 1.6);
        box(st, tx + sd * (tw / 2 - 0.55), th + 2.45, tz + o, 1.3, 0.32, 1.85);
      }
    }
    const MTF = faceM(0, tx, tz + tw / 2);
    // Arched double entrance + flat bracketed canopy (p.66) + steps.
    gothicWin(MTF, 0, 1.4, 5.4, 5.2, { glass: mats.trimDark, surround: 0.65, mat: st });
    fbox(MTF, mats.trim, -1.25, 4.0, 0.18, 2.1, 5.4, 0.16);
    fbox(MTF, mats.trim, 1.25, 4.0, 0.18, 2.1, 5.4, 0.16);
    box(mats.trim, tx, 9.6, tz + tw / 2 + 2.4, 11.2, 0.5, 4.8);
    box(mats.roofDark, tx, 9.95, tz + tw / 2 + 2.4, 11.4, 0.25, 5.0);
    for (const px of [-4.6, 4.6]) box(mats.trimDark, tx + px, 5.1, tz + tw / 2 + 4.3, 0.4, 8.8, 0.4);
    box(st, tx, 0.45, tz + tw / 2 + 2.6, 8.8, 0.9, 5.2);
    // Middle stage triple lancet windows on tower front (p.66).
    for (const u of [-2.4, 0, 2.4]) {
      fbox(MTF, st, u, 19.2, 0.12, 1.55, 5.8, 0.22);
      fbox(MTF, shopGlass, u, 19.2, 0.18, 1.1, 5.2, 0.08);
    }
    // Belfry louvered pointed/slotted openings on all 4 tower faces.
    for (const M of towerFaces(tx, tz, tw / 2)) {
      gothicWin(M, 0, 29.8, 3.8, 5.8, { glass: mats.reveal, surround: 0.55, mat: st, louvres: true, lights: 2 });
    }
    // Flanking narrow stained-glass windows beside the tower front.
    const MF = faceM(0, 0, fz);
    for (const fx of [-6.8, 8.6]) {
      fbox(MF, st, fx, 7.6, 0.12, 2.0, 4.8, 0.22);
      fbox(MF, shopGlass, fx, 7.6, 0.18, 1.5, 4.2, 0.08);
      fbox(MF, st, fx, 16.5, 0.12, 2.0, 4.6, 0.22);
      fbox(MF, shopGlass, fx, 16.5, 0.18, 1.5, 4.0, 0.08);
    }

    // Right gabled sanctuary wing (postcard + p.66).
    const sw = W / 2 - (tx + tw / 2) + 2;
    const sx = W / 2 - sw / 2;
    const sd = D - 10;
    const szc = -1;
    const sWall = 18.5;
    const sRise = 10.5;
    box(body, sx, sWall / 2, szc, sw, sWall, sd);
    box(mats.brick.dark, sx, 1.9, szc, sw + 0.5, 3.8, sd + 0.5);
    box(st, sx, 3.9, szc, sw + 0.7, 0.45, sd + 0.7);
    gableFrontAt(sw, sd, sRise, sWall, rf, sx, szc);
    clapboardTriangle(body, sw, sRise * 0.96, sWall, "z", szc + sd / 2, sx, 0);
    clapboardTriangle(body, sw, sRise * 0.96, sWall, "z", szc - sd / 2, sx, 0);
    gableCoping(st, sw + 0.8, sRise * 0.96 + 0.3, sWall, szc + sd / 2 + 0.3, sx, 0.5);
    const MS = faceM(0, sx, szc + sd / 2);
    gothicWin(MS, 0, 5.2, 8.4, 6.2, { lights: 3, circle: true, surround: 0.6, mat: st });
    roseWin(MS, 0, sWall + 4.4, 1.6, { tube: 0.26, mat: st });

    // Right (+x) side sanctuary cross-gable with pitched roof mass + 3-light pointed window (postcard).
    {
      const cgw = 22;
      const cgd = 16;
      const cgx = W / 2 - cgd / 2;
      const cgz = 4;
      const cRise = 10.5;
      const cHalf = cgw / 2 + 0.6;
      const cLen = Math.hypot(cHalf, cRise) + 0.4;
      const cAng = Math.atan2(cRise, cHalf);
      for (const sd of [-1, 1]) {
        const rg = new THREE.BoxGeometry(cgd + 0.8, 0.38, cLen);
        scaleBoxUVs(rg, cgd + 0.8, 0.38, cLen, rf);
        rg.rotateX(sd * cAng);
        rg.translate(cgx, sWall + cRise / 2, cgz + (sd * cHalf) / 2);
        rg.applyMatrix4(buildingMatrix);
        put(rf, rg);
      }
    }
    const MR = faceM(Math.PI / 2, W / 2, 4);
    faceGable(MR, body, st, 0, sWall, 22, 10.5);
    gothicWin(MR, 0, 5.2, 8.2, 6.0, { lights: 3, circle: true, surround: 0.6, mat: st });
    roseWin(MR, 0, sWall + 4.2, 1.5, { tube: 0.25, mat: st });
    gothicWin(MR, -18, 5.8, 2.4, 5.2, { surround: 0.4, mat: st });

    box(st, 0, 0.2, fz + 6, W + 6, 0.25, 6);
    const tree = new THREE.Vector3(W * 0.55, 0, fz + 9);
    tree.applyMatrix4(buildingMatrix);
    extraTrees.push({ x: tree.x, z: tree.z, kind: "maple", scale: 0.7 });
    signFor(b, 16);
    return th + 4;
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
    const wallH = 24;
    const body = mats.brick.buff;
    const wood = mats.siding.darkred;
    const fz = b.depth / 2 + 0.14;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.4, 0, b.width + 0.3, 0.8, b.depth + 0.3);
    box(body, 0, wallH + 0.7, fz, b.width + 0.4, 1.3, 0.7);
    const n = Math.max(8, Math.round(b.width / 1.6));
    for (let i = 0; i < n; i++) {
      const x = -b.width / 2 + ((i + 0.5) * b.width) / n;
      box(body, x, wallH - 0.35, fz + 0.15, 0.7, 0.7, 0.45);
    }
    const cols = 4;
    const gap = b.width / cols;
    for (let i = 0; i < cols; i++) {
      const x = -b.width / 2 + gap * (i + 0.5);
      box(mats.plank, x, wallH * 0.68, fz, gap - 1.6, 8.2, 0.16);
      box(mats.trimDark, x, wallH * 0.68, fz + 0.08, 0.12, 7.6, 0.06);
      archHood(body, x, wallH * 0.68 + 3.6, fz + 0.12, gap - 1.2, 2.2, "z");
    }
    box(wood, 0, 6.2, fz + 0.2, b.width + 0.2, 11.2, 0.5);
    for (const x of [-b.width * 0.26, b.width * 0.26]) {
      box(mats.glass, x, 5.4, fz + 0.62, b.width * 0.3, 6.6, 0.08);
      archHood(wood, x, 8.5, fz + 0.48, b.width * 0.38, 4.4, "z");
      archHood(mats.glass, x, 8.6, fz + 0.66, b.width * 0.3, 3.2, "z");
      box(wood, x, 5.2, fz + 0.62, 0.4, 8.4, 0.22);
    }
    box(wood, 0, 5.6, fz + 0.7, b.width * 0.14, 9.2, 0.34);
    return wallH + 4;
  };

  const addHurstPressed = (b) => {
    const wallH = 24;
    const body = mats.brick.red;
    const black = mats.coal;
    const fz = b.depth / 2 + 0.14;
    box(body, 0, wallH / 2 + 2, 0, b.width, wallH - 4, b.depth);
    box(mats.siding.gray, 0, 1.3, 0, b.width, 2.6, b.depth);
    box(mats.siding.white, 0, 7.2, fz + 0.08, b.width, 8.4, 0.35);
    box(black, 0, 11.6, fz + 0.12, b.width + 0.2, 0.7, 0.28);
    const piers = 5;
    for (let i = 0; i < piers; i++) {
      const x = -b.width / 2 + (b.width * i) / (piers - 1);
      box(black, x, 6.4, fz + 0.2, 0.45, 10, 0.28);
    }
    for (const x of [-b.width * 0.28, b.width * 0.05, b.width * 0.32]) {
      box(mats.glass, x, 6.2, fz + 0.28, 2.2, 3.2, 0.06);
    }
    box(mats.siding.white, b.width * 0.18, 4.8, fz + 0.3, 2.4, 6.4, 0.12);
    const cols = 5;
    const gap = (b.width - 2) / cols;
    for (let i = 0; i < cols; i++) {
      const x = -b.width / 2 + 1 + gap * (i + 0.5);
      box(mats.siding.white, x, wallH * 0.7, fz, gap - 1.1, 8.4, 0.14);
      archHood(mats.siding.white, x, wallH * 0.7 + 3.4, fz + 0.16, gap - 0.5, 2.6, "z");
    }
    box(black, 0, wallH + 0.45, fz, b.width + 0.5, 1.1, 0.7);
    drawPediment(black, b.width * 0.34, 4.2, wallH + 0.8, fz + 0.2);
    return wallH + 8;
  };

  // 292 West Hurst, the 2010 photograph: brick first story, slate mansard, arched porch.
  const addHurst292 = (b) => {
    const brickH = 11.4;
    const base = 2.15;
    const makeBrick = (mortar, shades) => {
      const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.92 });
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      const g = canvas.getContext("2d");
      g.fillStyle = mortar;
      g.fillRect(0, 0, 128, 64);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 32 : 0;
        for (let col = -1; col < 5; col++) {
          g.fillStyle = shades[(row + col + 8) % shades.length];
          g.fillRect(col * 32 + off + 1, row * 16 + 1, 30, 14);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      mat.map = tex;
      mat.userData.uvFeet = { u: 4, v: 2 };
      return mat;
    };
    const body = makeBrick("#C2B6A8", ["#7A5344", "#6E4A3C", "#825848", "#654338", "#745040", "#6B473A"]);
    const water = makeBrick("#6a4a4a", ["#5A3A3E", "#624044", "#54363A", "#5E3C40"]);
    const slateTex = (() => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const g = canvas.getContext("2d");
      g.fillStyle = "#9AA6B6";
      g.fillRect(0, 0, 256, 256);
      const rows = 14;
      const cols = 12;
      const rh = 256 / rows;
      const cw = 256 / cols;
      for (let r = 0; r < rows + 1; r++) {
        const off = r % 2 ? cw / 2 : 0;
        for (let c = -1; c < cols + 1; c++) {
          const x = c * cw + off;
          const y = r * rh;
          const shade = 132 + ((r * 17 + c * 13) % 26);
          const blue = 158 + ((r * 11 + c * 7) % 20);
          g.fillStyle = `rgb(${shade},${shade + 4},${blue})`;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + cw - 1, y);
          g.lineTo(x + cw - 1, y + rh * 0.55);
          g.arc(x + cw / 2, y + rh * 0.55, cw / 2 - 0.5, 0, Math.PI, false);
          g.closePath();
          g.fill();
          g.strokeStyle = "rgba(30,36,44,0.45)";
          g.lineWidth = 1;
          g.stroke();
        }
      }
      // A few slightly lighter slates in a loose diamond, as in the photograph — no hard grid.
      for (let y = 20; y < 256; y += 56) {
        for (let x = 28; x < 256; x += 56) {
          g.fillStyle = "rgba(188,198,214,0.32)";
          g.beginPath();
          const cw2 = 256 / 12;
          const rh2 = 256 / 14;
          g.moveTo(x, y);
          g.lineTo(x + cw2 - 1, y);
          g.lineTo(x + cw2 - 1, y + rh2 * 0.55);
          g.arc(x + cw2 / 2, y + rh2 * 0.55, cw2 / 2 - 0.5, 0, Math.PI, false);
          g.closePath();
          g.fill();
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    })();
    const slate = new THREE.MeshStandardMaterial({
      color: "#C4CCD8",
      roughness: 0.78,
      metalness: 0.05,
      map: slateTex,
    });
    slate.userData.uvFeet = { u: 6, v: 6 };
    const putOwn = (mat, geo) => {
      const m = mat.clone();
      if (mat.map) m.map = mat.map;
      put(m, geo);
    };
    const band = new THREE.MeshStandardMaterial({ color: "#efe8d8", roughness: 0.68 });
    const cream = new THREE.MeshStandardMaterial({ color: "#f0eadc", roughness: 0.66 });
    const darkBand = new THREE.MeshStandardMaterial({ color: "#3e3230", roughness: 0.72 });
    const maroon = new THREE.MeshStandardMaterial({ color: "#6b2e2c", roughness: 0.7 });
    const purple = new THREE.MeshStandardMaterial({ color: "#5c4e78", roughness: 0.62 });
    const stone = new THREE.MeshStandardMaterial({ color: "#ddd4c4", roughness: 0.74 });
    const lawn = new THREE.MeshStandardMaterial({ color: "#6a8f48", roughness: 0.96 });
    const walkMat = new THREE.MeshStandardMaterial({ color: "#d8d2c6", roughness: 0.9 });
    const fz = b.depth / 2;
    buildingMatrix.premultiply(new THREE.Matrix4().makeTranslation(0, base, 0));
    box(water, 0, -base / 2, 0, b.width + 0.5, base, b.depth + 0.5);
    box(stone, 0, 0.08, 0, b.width + 0.55, 0.22, b.depth + 0.55);
    box(body, 0, brickH / 2, 0, b.width, brickH, b.depth);

    const mansardH = 9.6;
    const wallT = 1.2;
    box(slate, 0, brickH + 0.7 + mansardH / 2, b.depth / 2 + 0.45, b.width - 0.2, mansardH, wallT);
    box(slate, 0, brickH + 0.7 + mansardH / 2, -b.depth / 2 - 0.45, b.width - 0.2, mansardH, wallT);
    box(slate, b.width / 2 + 0.45, brickH + 0.7 + mansardH / 2, 0, wallT, mansardH, b.depth - 0.2);
    box(slate, -b.width / 2 - 0.45, brickH + 0.7 + mansardH / 2, 0, wallT, mansardH, b.depth - 0.2);
    const flare = (yaw, ex, ez) => {
      const span = Math.abs(yaw) === Math.PI / 2 ? b.depth + 1.2 : b.width + 1.2;
      const geo = new THREE.BoxGeometry(span, 0.22, 1.7);
      geo.translate(0, 0, 0.85);
      geo.rotateX(0.42);
      geo.rotateY(yaw);
      geo.translate(ex, brickH + 1.15, ez);
      geo.applyMatrix4(buildingMatrix);
      putOwn(slate, geo);
    };
    flare(0, 0, b.depth / 2 + 0.55);
    flare(Math.PI, 0, -b.depth / 2 - 0.55);
    flare(Math.PI / 2, b.width / 2 + 0.55, 0);
    flare(-Math.PI / 2, -b.width / 2 - 0.55, 0);
    const pyramidRise = 3.4;
    const putPyr = (yaw, eaveX, eaveZ, span, run) => {
      const length = Math.hypot(run, pyramidRise);
      const geo = new THREE.BoxGeometry(span, 0.36, length);
      geo.translate(0, 0, -length / 2);
      geo.rotateX(Math.atan2(pyramidRise, run));
      geo.rotateY(yaw);
      geo.translate(eaveX, brickH + 0.85 + mansardH, eaveZ);
      geo.applyMatrix4(buildingMatrix);
      putOwn(slate, geo);
    };
    putPyr(0, 0, b.depth / 2 - 0.15, b.width - 0.4, b.depth / 2 + 1.2);
    putPyr(Math.PI, 0, -b.depth / 2 + 0.15, b.width - 0.4, b.depth / 2 + 1.2);
    putPyr(Math.PI / 2, b.width / 2 - 0.15, 0, b.depth - 0.4, b.width / 2 + 1.2);
    putPyr(-Math.PI / 2, -b.width / 2 + 0.15, 0, b.depth - 0.4, b.width / 2 + 1.2);

    // Cornice: dark band with cream circular bosses and cream brackets, as in the photograph.
    box(cream, 0, brickH + 0.22, 0, b.width + 1.15, 0.5, b.depth + 1.15);
    box(darkBand, 0, brickH + 0.62, fz + 0.72, b.width + 0.5, 0.55, 0.95);
    const bossN = Math.max(10, Math.round(b.width / 2.15));
    for (let i = 0; i < bossN; i++) {
      const x = -b.width / 2 + 1.1 + ((b.width - 2.2) * i) / Math.max(1, bossN - 1);
      const disc = new THREE.CylinderGeometry(0.32, 0.32, 0.1, 16);
      disc.rotateX(Math.PI / 2);
      disc.translate(x, brickH + 0.58, fz + 0.92);
      disc.applyMatrix4(buildingMatrix);
      put(cream, disc);
    }
    const brN = Math.max(8, Math.round(b.width / 3.1));
    for (let i = 0; i < brN; i++) {
      const x = -b.width / 2 + 0.9 + ((b.width - 1.8) * i) / Math.max(1, brN - 1);
      box(cream, x, brickH - 0.55, fz + 0.7, 0.28, 0.85, 0.42);
      box(cream, x, brickH - 0.12, fz + 0.95, 0.28, 0.22, 0.7);
    }

    // Porch arch, viewer's left-of-center.
    const archX = -2.2;
    const openW = b.width * 0.42;
    const rad = openW / 2;
    const spring = 0.95;
    const porchD = 8.4;
    const porchFront = fz + porchD;
    const pier = 1.45;
    const porchRoofY = brickH;
    box(body, archX - openW / 2 - pier / 2, (brickH - base) / 2, fz + porchD / 2, pier, brickH + base, porchD);
    box(body, archX + openW / 2 + pier / 2, (brickH - base) / 2, fz + porchD / 2, pier, brickH + base, porchD);
    const crown = spring + rad;
    box(body, archX, (crown + porchRoofY) / 2 + 0.2, porchFront - 0.55, openW + 0.5, Math.max(0.9, porchRoofY - crown + 0.4), 1.5);
    // Deep limestone arch ring with a keystone, as in the 2010 photograph.
    const nVous = 21;
    const ringT = 0.95;
    const ringD = 2.4;
    const outerR = rad + ringT;
    for (let i = 0; i < nVous; i++) {
      const ang = (Math.PI * (i + 0.5)) / nVous;
      const arc = (Math.PI * outerR) / nVous;
      const isKey = i === Math.floor(nVous / 2);
      const geo = new THREE.BoxGeometry(arc * (isKey ? 1.18 : 0.94), isKey ? 1.25 : ringT, ringD);
      geo.rotateZ(ang - Math.PI / 2);
      geo.translate(archX + Math.cos(ang) * (rad + ringT * 0.48), spring + Math.sin(ang) * (rad + ringT * 0.48), porchFront - ringD / 2 + 0.2);
      geo.applyMatrix4(buildingMatrix);
      put(stone, geo);
    }
    box(stone, archX - rad - 0.15, spring - 0.15, porchFront - ringD / 2 + 0.2, 1.85, 1.15, ringD + 0.15);
    box(stone, archX + rad + 0.15, spring - 0.15, porchFront - ringD / 2 + 0.2, 1.85, 1.15, ringD + 0.15);
    // Dark shadowed recess: the same reddish-brown brick, in shade. No pink fill.
    const recessD = 7.2;
    const recessBack = porchFront - recessD;
    const recessBrick = makeBrick("#3a322c", ["#3A2A22", "#32241E", "#2A201A", "#403028", "#2E221C"]);
    box(recessBrick, archX, brickH / 2 - 0.2, recessBack + 0.22, openW - 0.5, brickH - 0.4, 0.5);
    box(recessBrick, archX - openW / 2 + 0.28, brickH / 2 - 0.2, recessBack + recessD / 2, 0.55, brickH - 0.4, recessD - 0.6);
    box(recessBrick, archX + openW / 2 - 0.28, brickH / 2 - 0.2, recessBack + recessD / 2, 0.55, brickH - 0.4, recessD - 0.6);
    box(recessBrick, archX, crown - 0.2, recessBack + recessD / 2, openW - 0.8, 0.4, recessD - 0.6);
    const porchFloor = new THREE.MeshStandardMaterial({ color: "#3A3228", roughness: 0.92 });
    box(porchFloor, archX, 0.1, recessBack + recessD / 2, openW - 1.0, 0.12, recessD - 1.0);
    // Door on the viewer's right, tall leaded window to its left, both readable in the shadow.
    const doorLite = new THREE.MeshStandardMaterial({ color: "#d8d2c6", roughness: 0.62, emissive: "#3a3830", emissiveIntensity: 0.22 });
    const doorX = archX + 2.65;
    box(stone, doorX, 5.15, recessBack + 0.38, 3.15, 9.0, 0.22);
    box(doorLite, doorX, 4.7, recessBack + 0.52, 2.25, 7.2, 0.14);
    box(cream, doorX, 4.4, recessBack + 0.62, 1.55, 2.5, 0.06);
    box(cream, doorX, 6.85, recessBack + 0.62, 1.55, 2.15, 0.06);
    box(mats.glass, doorX, 8.95, recessBack + 0.58, 1.55, 1.25, 0.05);
    // Tall narrow leaded window with a stone surround.
    const winX = archX - 0.85;
    box(stone, winX, 6.55, recessBack + 0.4, 1.7, 7.6, 0.2);
    box(mats.glass, winX, 6.55, recessBack + 0.54, 1.15, 6.6, 0.06);
    box(doorLite, winX, 6.55, recessBack + 0.62, 0.1, 6.5, 0.05);
    box(doorLite, winX, 6.55, recessBack + 0.62, 1.05, 0.1, 0.05);
    for (const dy of [-2.0, 0, 2.0]) {
      box(doorLite, winX, 6.55 + dy, recessBack + 0.62, 1.05, 0.07, 0.04);
    }
    // Gold mailbox on the left back wall, from the photograph.
    const mail = new THREE.MeshStandardMaterial({ color: "#c4a44a", roughness: 0.45, metalness: 0.35 });
    box(mail, archX - 4.4, 4.55, recessBack + 0.55, 0.85, 0.7, 0.12);
    for (let i = 0; i < 4; i++) {
      box(stone, archX, -base + 0.32 + i * 0.5, porchFront + 2.55 - i * 0.95, 8.6, 0.42, 1.05);
    }

    // Left porch: round white columns, a sloped slate roof, sitting on the dark water table.
    const leftEdge = -b.width / 2 + 0.35;
    const rightEdge = archX - openW / 2 - pier * 0.15;
    const roofMid = (leftEdge + rightEdge) / 2;
    const roofW = rightEdge - leftEdge;
    box(water, roofMid, -base / 2, fz + porchD * 0.5, roofW + 0.6, base, porchD + 0.4);
    box(stone, roofMid, 0.08, fz + porchD * 0.5, roofW + 0.7, 0.2, porchD + 0.5);
    box(mats.plank, roofMid, 0.22, fz + porchD * 0.52, roofW - 0.4, 0.14, porchD - 0.6);
    const colXs = [leftEdge + 1.15, leftEdge + 4.15, leftEdge + 7.15];
    for (const x of colXs) {
      const col = new THREE.CylinderGeometry(0.3, 0.36, 10.4, 14);
      col.translate(x, 5.55, porchFront + 0.15);
      col.applyMatrix4(buildingMatrix);
      put(cream, col);
      const cap = new THREE.CylinderGeometry(0.42, 0.34, 0.28, 14);
      cap.translate(x, 10.85, porchFront + 0.15);
      cap.applyMatrix4(buildingMatrix);
      put(cream, cap);
      const foot = new THREE.CylinderGeometry(0.4, 0.42, 0.32, 14);
      foot.translate(x, 0.45, porchFront + 0.15);
      foot.applyMatrix4(buildingMatrix);
      put(cream, foot);
    }
    box(cream, (colXs[0] + colXs[2]) / 2, 3.2, porchFront + 0.32, colXs[2] - colXs[0], 0.14, 0.12);
    box(cream, (colXs[0] + colXs[2]) / 2, 1.75, porchFront + 0.32, colXs[2] - colXs[0], 0.12, 0.1);
    for (let i = 0; i < 9; i++) {
      const x = colXs[0] + ((colXs[2] - colXs[0]) * i) / 8;
      box(cream, x, 2.45, porchFront + 0.32, 0.1, 1.5, 0.1);
    }
    box(cream, roofMid, porchRoofY + 0.15, fz + porchD / 2, roofW + 0.8, 0.28, porchD + 0.7);
    const porchSlope = new THREE.BoxGeometry(roofW + 1.1, 0.28, porchD * 0.62);
    porchSlope.translate(0, 0, -porchD * 0.18);
    porchSlope.rotateX(-0.28);
    porchSlope.translate(roofMid, porchRoofY + 1.15, fz + porchD * 0.55);
    porchSlope.applyMatrix4(buildingMatrix);
    putOwn(slate, porchSlope);
    box(cream, roofMid, porchRoofY + 0.35, porchFront + 0.35, roofW + 0.9, 0.28, 0.4);

    // Bow bay on the right, with a curved slate roof and stone lintels.
    const bayX = 12.0;
    const bayR = 5.5;
    const bayFront = fz + 5.0;
    const bow = new THREE.CylinderGeometry(bayR, bayR, brickH + base, 20, 1, false, Math.PI - 0.95, 1.9);
    bow.translate(bayX, (brickH - base) / 2, fz + 0.15);
    bow.applyMatrix4(buildingMatrix);
    putOwn(body, bow);
    const bowBase = new THREE.CylinderGeometry(bayR + 0.12, bayR + 0.12, base, 20, 1, false, Math.PI - 0.95, 1.9);
    bowBase.translate(bayX, -base / 2, fz + 0.15);
    bowBase.applyMatrix4(buildingMatrix);
    putOwn(water, bowBase);
    const winAngs = [-0.48, 0, 0.48];
    for (const ang of winAngs) {
      const wx = bayX + Math.sin(ang) * (bayR - 0.15);
      const wz = fz + 0.15 + Math.cos(ang) * (bayR - 0.15);
      frontSash(wx, 5.55, wz, 2.2, 5.2, "flat", false, cream);
      box(stone, wx, 8.45, wz + 0.12, 2.85, 0.42, 0.7);
    }
    // Curved slate skirt over the bay.
    const skirt = new THREE.CylinderGeometry(bayR + 0.55, bayR + 0.15, 1.35, 20, 1, false, Math.PI - 1.05, 2.1);
    skirt.translate(bayX, brickH + 0.55, fz + 0.15);
    skirt.applyMatrix4(buildingMatrix);
    putOwn(slate, skirt);
    box(darkBand, bayX, brickH + 0.15, bayFront - 0.4, bayR * 1.55, 0.28, 0.55);
    for (const ang of [-0.55, -0.22, 0.22, 0.55]) {
      const bx = bayX + Math.sin(ang) * (bayR + 0.2);
      const bz = fz + 0.15 + Math.cos(ang) * (bayR + 0.2);
      box(cream, bx, brickH - 0.25, bz, 0.2, 0.55, 0.28);
    }

    const curtain = new THREE.MeshStandardMaterial({ color: "#d8d0c4", roughness: 0.88 });
    // Mansard pair of windows, left of the Flemish gable.
    const pairX = -8.0;
    const pairY = brickH + 0.95 + mansardH * 0.46;
    const pairZ = fz + 1.35;
    box(cream, pairX, pairY, pairZ, 6.5, 5.8, 0.32);
    for (const dx of [-1.5, 1.5]) {
      box(curtain, pairX + dx, pairY, pairZ + 0.08, 1.7, 4.3, 0.04);
      box(mats.glass, pairX + dx, pairY, pairZ + 0.18, 1.75, 4.4, 0.06);
      box(purple, pairX + dx - 0.78, pairY, pairZ + 0.24, 0.1, 4.35, 0.06);
      box(purple, pairX + dx + 0.78, pairY, pairZ + 0.24, 0.1, 4.35, 0.06);
      box(purple, pairX + dx, pairY + 0.05, pairZ + 0.24, 1.6, 0.1, 0.06);
      box(cream, pairX + dx - 1.02, pairY, pairZ + 0.22, 0.18, 4.7, 0.14);
      box(cream, pairX + dx + 1.02, pairY, pairZ + 0.22, 0.18, 4.7, 0.14);
      box(cream, pairX + dx, pairY + 2.3, pairZ + 0.22, 2.15, 0.16, 0.14);
      box(cream, pairX + dx, pairY - 2.3, pairZ + 0.22, 2.15, 0.16, 0.14);
    }
    box(cream, pairX, pairY, pairZ + 0.22, 0.2, 4.7, 0.14);

    // Flat Flemish gable — a shaped front, not a tower. Outline follows the 2010 photograph.
    const gableH = 15.2;
    const halfW = 6.7;
    const gableY0 = brickH + 0.7;
    const gableZ = bayFront - 0.15;
    const rightPts = [
      [halfW * 0.9, 0],
      [halfW * 0.94, gableH * 0.36],
      [halfW * 1.02, gableH * 0.46],
      [halfW * 1.08, gableH * 0.52],
      [halfW * 0.78, gableH * 0.58],
      [halfW * 0.92, gableH * 0.66],
      [halfW * 0.55, gableH * 0.73],
      [halfW * 0.36, gableH * 0.84],
      [halfW * 0.16, gableH * 0.94],
      [0.05, gableH],
    ];
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-rightPts[0][0], rightPts[0][1]);
    for (let i = 1; i < rightPts.length; i++) gableShape.lineTo(-rightPts[i][0], rightPts[i][1]);
    for (let i = rightPts.length - 2; i >= 0; i--) gableShape.lineTo(rightPts[i][0], rightPts[i][1]);
    gableShape.closePath();
    const gableFace = new THREE.ExtrudeGeometry(gableShape, { depth: 1.15, bevelEnabled: false, curveSegments: 6 });
    // UVs for the fishscale texture.
    {
      const uv = gableFace.getAttribute("uv");
      const pos = gableFace.getAttribute("position");
      if (uv && pos) {
        for (let i = 0; i < pos.count; i++) {
          uv.setXY(i, (pos.getX(i) + halfW) / 10, pos.getY(i) / 10);
        }
        uv.needsUpdate = true;
      }
    }
    gableFace.translate(bayX, gableY0, gableZ - 1.15);
    gableFace.applyMatrix4(buildingMatrix);
    putOwn(slate, gableFace);
    // Cream molding along the upper scrolls, as in the photograph.
    const moldPts = [];
    const upper = rightPts.slice(2);
    for (let i = upper.length - 1; i >= 0; i--) moldPts.push(new THREE.Vector3(-upper[i][0], upper[i][1], 0));
    for (const p of upper) moldPts.push(new THREE.Vector3(p[0], p[1], 0));
    const moldPath = new THREE.CatmullRomCurve3(moldPts);
    const mold = new THREE.TubeGeometry(moldPath, 48, 0.11, 8, false);
    mold.translate(bayX, gableY0, gableZ + 0.08);
    mold.applyMatrix4(buildingMatrix);
    putOwn(cream, mold);
    // Small cap at the peak.
    const cap = new THREE.SphereGeometry(0.72, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
    cap.translate(bayX, gableY0 + gableH + 0.15, gableZ - 0.45);
    cap.applyMatrix4(buildingMatrix);
    putOwn(slate, cap);
    const knop = new THREE.SphereGeometry(0.22, 10, 8);
    knop.translate(bayX, gableY0 + gableH + 0.85, gableZ - 0.45);
    knop.applyMatrix4(buildingMatrix);
    putOwn(maroon, knop);
    // Burgundy pilaster at the left of the gable, with a cream cap and a small urn.
    const pilX = bayX - halfW - 0.55;
    box(maroon, pilX, brickH + mansardH * 0.55, fz + 1.55, 0.7, mansardH + 2.2, 0.55);
    box(cream, pilX, brickH + mansardH + 1.85, fz + 1.55, 0.95, 0.55, 0.75);
    const urn = new THREE.SphereGeometry(0.32, 10, 8);
    urn.translate(pilX, brickH + mansardH + 2.45, fz + 1.55);
    urn.applyMatrix4(buildingMatrix);
    putOwn(maroon, urn);
    const urnNeck = new THREE.CylinderGeometry(0.08, 0.1, 0.35, 8);
    urnNeck.translate(pilX, brickH + mansardH + 2.85, fz + 1.55);
    urnNeck.applyMatrix4(buildingMatrix);
    putOwn(maroon, urnNeck);
    // Palladian window in the gable: two rectangular sashes and a round arch above, cream and purple trim.
    const gwY = gableY0 + 4.55;
    const gwZ = gableZ + 0.12;
    for (const dx of [-1.55, 1.55]) {
      box(curtain, bayX + dx, gwY, gwZ - 0.08, 2.05, 4.85, 0.04);
      box(mats.glass, bayX + dx, gwY, gwZ, 2.15, 5.0, 0.06);
      box(purple, bayX + dx - 0.95, gwY, gwZ + 0.08, 0.1, 4.9, 0.06);
      box(purple, bayX + dx + 0.95, gwY, gwZ + 0.08, 0.1, 4.9, 0.06);
      box(purple, bayX + dx, gwY + 0.05, gwZ + 0.08, 1.95, 0.1, 0.06);
      box(cream, bayX + dx - 1.22, gwY, gwZ + 0.12, 0.2, 5.3, 0.14);
      box(cream, bayX + dx + 1.22, gwY, gwZ + 0.12, 0.2, 5.3, 0.14);
      box(cream, bayX + dx, gwY + 2.55, gwZ + 0.12, 2.55, 0.18, 0.14);
      box(cream, bayX + dx, gwY - 2.55, gwZ + 0.12, 2.55, 0.18, 0.14);
    }
    box(cream, bayX, gwY, gwZ + 0.12, 0.22, 5.3, 0.14);
    const archRad = 2.55;
    const archSpring = gwY + 2.55;
    const fan = new THREE.CircleGeometry(archRad * 0.95, 22, 0, Math.PI);
    fan.translate(bayX, archSpring, gwZ);
    fan.applyMatrix4(buildingMatrix);
    putOwn(mats.glass, fan);
    const archRing = new THREE.TorusGeometry(archRad, 0.16, 10, 24, Math.PI);
    archRing.translate(bayX, archSpring, gwZ + 0.12);
    archRing.applyMatrix4(buildingMatrix);
    putOwn(cream, archRing);
    const archInner = new THREE.TorusGeometry(archRad * 0.78, 0.08, 8, 20, Math.PI);
    archInner.translate(bayX, archSpring, gwZ + 0.14);
    archInner.applyMatrix4(buildingMatrix);
    putOwn(purple, archInner);
    // Decorative cream scrolls on the arch band.
    for (let i = 1; i < 8; i++) {
      const ang = (Math.PI * i) / 8;
      const ox = Math.cos(ang) * archRad;
      const oy = Math.sin(ang) * archRad;
      const bump = new THREE.SphereGeometry(0.14, 8, 6);
      bump.translate(bayX + ox, archSpring + oy, gwZ + 0.2);
      bump.applyMatrix4(buildingMatrix);
      putOwn(cream, bump);
    }

    // One compact dormer sitting on the mansard, above the pair of windows.
    const dormL = pairX;
    const dormY = brickH + mansardH + 0.55;
    const dormZ = fz + 2.15;
    box(darkBand, dormL, dormY, dormZ, 6.2, 1.85, 2.15);
    box(cream, dormL, dormY + 1.05, dormZ + 0.15, 6.5, 0.3, 2.45);
    for (const dx of [-2.0, -0.68, 0.68, 2.0]) {
      box(cream, dormL + dx, dormY - 0.55, dormZ + 0.7, 0.22, 0.7, 0.4);
    }
    for (const dx of [-1.4, 0, 1.4]) {
      const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 12);
      disc.rotateX(Math.PI / 2);
      disc.translate(dormL + dx, dormY, dormZ + 1.05);
      disc.applyMatrix4(buildingMatrix);
      putOwn(cream, disc);
    }
    // Solid cream pediment with a red recessed face.
    const ped = new THREE.Shape();
    ped.moveTo(-3.35, 0);
    ped.lineTo(3.35, 0);
    ped.lineTo(0, 2.85);
    ped.closePath();
    const pedGeo = new THREE.ExtrudeGeometry(ped, { depth: 0.55, bevelEnabled: false });
    pedGeo.translate(dormL, dormY + 1.05, dormZ + 0.55);
    pedGeo.applyMatrix4(buildingMatrix);
    putOwn(cream, pedGeo);
    const redTri = new THREE.Shape();
    redTri.moveTo(-2.5, 0.08);
    redTri.lineTo(2.5, 0.08);
    redTri.lineTo(0, 2.3);
    redTri.closePath();
    const redFace = new THREE.ExtrudeGeometry(redTri, { depth: 0.2, bevelEnabled: false });
    redFace.translate(dormL, dormY + 1.12, dormZ + 1.05);
    redFace.applyMatrix4(buildingMatrix);
    putOwn(maroon, redFace);

    // Lawn, walk, foundation shrubs, hostas, and the yellow-green shrub along the walk, from the photograph.
    box(lawn, 0, -base + 0.08, fz + 18, b.width + 28, 0.16, 42);
    box(walkMat, archX, -base + 0.22, porchFront + 16, 5.0, 0.14, 32);
    const shrub = mats.leaf.clone();
    shrub.color.set("#3a6a32");
    const shrubLime = mats.leaf.clone();
    shrubLime.color.set("#7a9a3c");
    const hosta = mats.leaf.clone();
    hosta.color.set("#4a6e38");
    const shrubSpots = [
      [-18.4, fz + 2.6, 1.15, shrub],
      [-15.0, fz + 2.2, 0.98, shrub],
      [-11.4, fz + 2.5, 1.0, shrub],
      [-8.0, fz + 3.0, 0.7, shrub],
      [4.8, fz + 3.8, 0.95, shrub],
      [6.8, fz + 3.6, 1.55, shrubLime],
      [8.8, fz + 3.4, 1.7, shrubLime],
      [10.6, fz + 3.0, 1.25, shrubLime],
      [13.0, fz + 2.6, 1.15, shrub],
      [16.0, fz + 2.5, 1.1, shrub],
      [19.2, fz + 2.2, 0.95, shrub],
      [-6.2, fz + 8.5, 0.7, hosta],
      [-4.6, fz + 11.8, 0.68, hosta],
      [-3.4, fz + 15.2, 0.65, hosta],
      [-4.0, fz + 18.0, 0.58, hosta],
      [3.8, fz + 8.2, 0.7, hosta],
      [5.4, fz + 11.2, 1.05, shrubLime],
      [3.4, fz + 14.2, 0.65, hosta],
      [6.4, fz + 15.5, 0.72, shrubLime],
      [4.6, fz + 18.0, 0.6, hosta],
      [5.8, fz + 20.5, 0.85, shrubLime],
    ];
    for (const [x, z, s, mat] of shrubSpots) {
      const flat = mat === hosta ? 0.55 : 1;
      for (const [dx, dy, dz, sc] of [
        [0, 0.9, 0, 1],
        [0.58, 0.52, 0.28, 0.7],
        [-0.5, 0.5, 0.22, 0.64],
        [0.15, 0.7, -0.3, 0.58],
      ]) {
        const geo = new THREE.SphereGeometry(s * sc, 12, 10);
        geo.scale(1.15, flat, 1.15);
        geo.translate(x + dx * s, -base + dy * s * flat, z + dz * s);
        geo.applyMatrix4(buildingMatrix);
        put(mat, geo);
      }
    }
    // Foreground trees, spring foliage, one on each side, as in the photograph.
    const leafA = mats.leaf.clone();
    leafA.color.set("#6a9a44");
    const leafB = mats.leaf.clone();
    leafB.color.set("#8aaa50");
    const leafC = mats.leafDark.clone();
    leafC.color.set("#4a7a34");
    const plantTree = (tx, tz, trunkH, spreads) => {
      const trunk = new THREE.CylinderGeometry(0.45, 0.7, trunkH, 10);
      trunk.translate(tx, -base + trunkH / 2, tz);
      trunk.applyMatrix4(buildingMatrix);
      put(mats.trunk, trunk);
      for (const [dx, dy, dz, r, which] of spreads) {
        const ball = new THREE.SphereGeometry(r, 14, 12);
        ball.translate(tx + dx, -base + dy, tz + dz);
        ball.applyMatrix4(buildingMatrix);
        put(which === 0 ? leafA : which === 1 ? leafB : leafC, ball);
      }
    };
    const leftSpreads = [];
    const rightSpreads = [];
    let seed = 292;
    const rnd = () => {
      seed = (seed * 16807 + 17) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 44; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 1.2 + rnd() * 5.2;
      leftSpreads.push([Math.cos(a) * r * 0.7 - 1.0, 8 + rnd() * 14, Math.sin(a) * r * 0.75 + 4.0, 1.7 + rnd() * 1.3, i % 3]);
    }
    seed = 708;
    for (let i = 0; i < 48; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 1.2 + rnd() * 4.8;
      // Outward from the right wall, at the facade depth, so the tree sits in-frame at the right edge.
      const dx = Math.abs(Math.cos(a) * r * 0.7) + 0.3;
      rightSpreads.push([dx, 7 + rnd() * 15, Math.sin(a) * r * 0.5 + 1.2, 1.7 + rnd() * 1.35, i % 3]);
    }
    plantTree(-b.width * 0.55, fz + 16, 9, leftSpreads);
    plantTree(b.width * 0.50, fz + 7, 10, rightSpreads);
    return brickH + mansardH + pyramidRise + gableH * 0.25;
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
  // Original Hendee building at Hurst & West Main (centennial book PDF p.25 engraving):
  // two stories of warm buff/stuccoed masonry with quoined pilasters, six tall pointed-arch
  // Gothic upper windows in two groups of three, six semicircular arched ground-floor shop
  // openings between masonry piers, a heavy closely-bracketed cornice wrapping the Hurst side,
  // three side chimneys, and a real sloped veranda porch on posts with curved arch braces
  // carrying the bold HENDEE. signboard. Estimates: heights, exact molding depths, wall warmth.
  const addHendeeStore = (b) => {
    const wallH = 29.0;
    const fz = b.depth / 2 + 0.14;
    const body = mats.brick.buff;
    const trim = mats.siding.white;
    const stone = mats.stone;

    const bays = 6;
    const gap = b.width / bays;
    const pierW = 1.6;
    const archR = (gap - pierW) / 2;
    const archSpring = 8.4;
    const archWallTop = 13.2;

    // Recess the ground-floor front wall behind the arched shopfront openings.
    box(body, 0, wallH / 2, -0.65, b.width, wallH, b.depth - 1.3);
    box(body, 0, (archWallTop + wallH) / 2, b.depth / 2 - 0.65, b.width, wallH - archWallTop, 1.3);
    box(stone, 0, 0.6, -0.5, b.width + 0.6, 1.2, b.depth - 0.4);
    box(trim, 0, 13.6, fz + 0.25, b.width + 0.6, 0.65, 0.6);
    box(trim, b.width / 2 + 0.18, 13.6, 0, 0.5, 0.65, b.depth + 0.4);

    // Quoined corner & center pilasters (two 3-window groups, p.25).
    for (const qx of [-b.width / 2 + 0.6, 0, b.width / 2 - 0.6]) {
      box(trim, qx, wallH * 0.68, fz + 0.18, 1.2, wallH * 0.46, 0.35);
      for (let q = 0; q < 8; q++) {
        box(trim, qx, 14.3 + q * 1.45, fz + 0.25, q % 2 === 0 ? 1.65 : 1.15, 0.9, 0.42);
      }
    }
    for (let q = 0; q < 8; q++) {
      box(trim, b.width / 2 + 0.18, 14.3 + q * 1.45, -b.depth / 2 + 0.65, 0.42, 0.9, q % 2 === 0 ? 1.65 : 1.15);
    }

    // Ground floor: six semicircular arched bays between seven masonry piers (p.25).
    for (let i = 0; i <= bays; i++) {
      const px = -b.width / 2 + gap * i;
      const pw = i === 0 || i === bays ? pierW * 0.95 : pierW;
      box(body, px, archWallTop / 2, fz - 0.45, pw, archWallTop, 1.15);
      box(stone, px, 0.65, fz + 0.18, pw + 0.25, 1.3, 0.45);
      box(trim, px, archSpring - 0.25, fz + 0.18, pw + 0.3, 0.5, 0.45);
    }

    {
      const segs = 12;
      const pos = [];
      const uvs = [];
      const feet = body?.userData?.uvFeet || { u: 2.67, v: 1.78 };
      const pushTri = (a, b3, c) => {
        for (const p3 of [a, b3, c]) {
          pos.push(p3[0], p3[1], p3[2]);
          uvs.push(p3[0] / feet.u, p3[1] / feet.v);
        }
      };
      const zF = fz + 0.12;
      const zB = fz - 0.9;
      for (let col = 0; col < bays; col++) {
        const cx = -b.width / 2 + gap * (col + 0.5);
        const xL = cx - archR;
        const xR = cx + archR;
        const outerPt = (ang) => {
          if (ang <= Math.PI * 0.25) return [xR, archSpring + (archWallTop - archSpring) * (ang / (Math.PI * 0.25))];
          if (ang <= Math.PI * 0.75) return [xR - (xR - xL) * ((ang - Math.PI * 0.25) / (Math.PI * 0.5)), archWallTop];
          return [xL, archWallTop - (archWallTop - archSpring) * ((ang - Math.PI * 0.75) / (Math.PI * 0.25))];
        };
        for (let i = 0; i < segs; i++) {
          const a0 = (Math.PI * i) / segs;
          const a1 = (Math.PI * (i + 1)) / segs;
          const ix0 = cx + Math.cos(a0) * archR, iy0 = archSpring + Math.sin(a0) * archR;
          const ix1 = cx + Math.cos(a1) * archR, iy1 = archSpring + Math.sin(a1) * archR;
          const [ox0, oy0] = outerPt(a0);
          const [ox1, oy1] = outerPt(a1);
          pushTri([ix0, iy0, zF], [ox0, oy0, zF], [ox1, oy1, zF]);
          pushTri([ix0, iy0, zF], [ox1, oy1, zF], [ix1, iy1, zF]);
          pushTri([ix0, iy0, zB], [ox1, oy1, zB], [ox0, oy0, zB]);
          pushTri([ix0, iy0, zB], [ix1, iy1, zB], [ox1, oy1, zB]);
          pushTri([ix0, iy0, zF], [ix1, iy1, zF], [ix1, iy1, zB]);
          pushTri([ix0, iy0, zF], [ix1, iy1, zB], [ix0, iy0, zB]);
        }
        ringArch(trim, cx, archSpring, fz + 0.22, archR + 0.12, 0.26);
        box(trim, cx, archSpring + archR + 0.22, fz + 0.28, 0.55, 0.75, 0.4);
        const head = new THREE.CircleGeometry(archR - 0.05, 18, 0, Math.PI);
        head.translate(cx, archSpring, fz - 0.35);
        head.applyMatrix4(buildingMatrix);
        put(shopGlass, head);
        if (col === 1 || col === 4) {
          box(mats.reveal, cx, 4.4, fz - 0.55, archR * 1.9, 8.2, 0.2);
          paneledDoor(cx, fz - 0.45, 4.6, 7.8, true);
          box(stone, cx, 0.45, fz + 0.2, 5.4, 0.7, 1.4);
        } else {
          box(mats.trimDark, cx, 1.35, fz - 0.3, archR * 1.92, 1.7, 0.3);
          box(mats.reveal, cx, 5.3, fz - 0.45, archR * 1.9, 6.2, 0.16);
          box(shopGlass, cx, 5.3, fz - 0.35, archR * 1.78, 6.0, 0.08);
          for (const mx of [-1.2, 1.2]) box(trim, cx + mx, 6.3, fz - 0.26, 0.12, 8.0, 0.1);
          for (const my of [4.8, 8.4]) box(trim, cx, my, fz - 0.26, archR * 1.84, 0.14, 0.12);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex([...Array(pos.length / 3).keys()]);
      geo.computeVertexNormals();
      geo.applyMatrix4(buildingMatrix);
      put(body, geo);
    }

    // Upper story: six pointed-arch Gothic lancet windows in two groups of three (p.25).
    const lancet = (cx, ySill, w, rectH, apexH) => {
      const ySpring = ySill + rectH;
      const yTop = ySpring + apexH;
      const hw = w / 2;
      const shape = new THREE.Shape();
      shape.moveTo(-hw, 0);
      shape.lineTo(hw, 0);
      shape.lineTo(hw, rectH);
      shape.lineTo(0, rectH + apexH);
      shape.lineTo(-hw, rectH);
      shape.closePath();
      const glassGeo = new THREE.ShapeGeometry(shape);
      if (!glassGeo.index) glassGeo.setIndex([...Array(glassGeo.getAttribute("position").count).keys()]);
      glassGeo.translate(cx, ySill, fz + 0.04);
      glassGeo.applyMatrix4(buildingMatrix);
      put(shopGlass, glassGeo);

      const frameGeo = new THREE.ShapeGeometry(shape);
      if (!frameGeo.index) frameGeo.setIndex([...Array(frameGeo.getAttribute("position").count).keys()]);
      frameGeo.scale(1.06, 1.03, 1);
      frameGeo.translate(cx, ySill - 0.08, fz + 0.01);
      frameGeo.applyMatrix4(buildingMatrix);
      put(mats.reveal, frameGeo);

      for (const mx of [-hw * 0.34, hw * 0.34]) {
        box(trim, cx + mx, ySill + rectH * 0.58, fz + 0.1, 0.09, rectH * 1.08, 0.08);
      }
      for (const my of [ySill + rectH * 0.33, ySill + rectH * 0.67, ySpring]) {
        box(trim, cx, my, fz + 0.1, w * 0.96, 0.1, 0.08);
      }
      for (const sd of [-1, 1]) box(trim, cx + sd * (hw + 0.12), ySill + rectH / 2, fz + 0.14, 0.24, rectH, 0.24);
      box(stone, cx, ySill - 0.22, fz + 0.26, w + 1.0, 0.38, 0.72);
      const len = Math.hypot(hw + 0.28, apexH + 0.22);
      const ang = Math.atan2(apexH + 0.22, hw + 0.28);
      for (const sd of [-1, 1]) {
        const bar = new THREE.BoxGeometry(len, 0.36, 0.44);
        scaleBoxUVs(bar, len, 0.36, 0.44, trim);
        bar.rotateZ(-sd * ang);
        bar.translate(cx + sd * (hw / 2 + 0.12), ySpring + apexH / 2 + 0.14, fz + 0.24);
        bar.applyMatrix4(buildingMatrix);
        put(trim, bar);
        box(trim, cx + sd * (hw + 0.25), ySpring - 0.1, fz + 0.26, 0.44, 0.42, 0.44);
      }
      box(trim, cx, yTop + 0.18, fz + 0.28, 0.5, 0.65, 0.48);
    };

    for (const ux of [-20.4, -13.6, -6.8, 6.8, 13.6, 20.4]) {
      lancet(ux, 15.1, 2.9, 6.6, 2.7);
    }

    for (let i = 0; i < 5; i++) {
      const sz = -b.depth / 2 + ((i + 0.65) * b.depth) / 5.5;
      sideSash(b.width / 2 + 0.08, 19.6, sz, 1, 2.5, 7.2, "pointed", false, trim);
      sideSash(b.width / 2 + 0.08, 6.4, sz, 1, 2.4, 7.0, "flat", false, trim);
    }

    deepCrown(b, wallH, { proj: 2.2, frieze: 2.1, mat: "white", spacing: 1.75 });
    for (const cz of [-20, 0, 20]) chimneyStack(mats.brick.red, b.width / 2 - 2.0, wallH + 3.6, cz, 2.4, 5.8, 2.4);

    // Real sloped veranda porch with curved spandrel braces & Hurst wrap (p.25).
    const pd = 8.4;
    const pWrap = 32;
    const pZ = fz + pd / 2;
    const eaveZ = fz + pd;
    const eaveX = b.width / 2 + pd;
    box(stone, pd / 2, 0.45, pZ, b.width + pd, 0.9, pd);
    box(mats.plank, pd / 2, 0.94, pZ, b.width + pd - 0.3, 0.12, pd - 0.3);
    box(stone, b.width / 2 + pd / 2, 0.45, fz - pWrap / 2, pd, 0.9, pWrap);
    box(mats.plank, b.width / 2 + pd / 2, 0.94, fz - pWrap / 2, pd - 0.3, 0.12, pWrap - 0.3);

    {
      const froof = new THREE.BoxGeometry(b.width + pd + 0.5, 0.22, pd + 0.6);
      scaleBoxUVs(froof, b.width + pd + 0.5, 0.22, pd + 0.6, mats.roofSlate);
      froof.rotateX(0.18);
      froof.translate(pd / 2, 12.85, pZ);
      froof.applyMatrix4(buildingMatrix);
      put(mats.roofSlate, froof);

      const sroof = new THREE.BoxGeometry(pd + 0.6, 0.22, pWrap + 0.4);
      scaleBoxUVs(sroof, pd + 0.6, 0.22, pWrap + 0.4, mats.roofSlate);
      sroof.rotateZ(-0.18);
      sroof.translate(b.width / 2 + pd / 2, 12.85, fz - pWrap / 2);
      sroof.applyMatrix4(buildingMatrix);
      put(mats.roofSlate, sroof);
    }
    box(trim, pd / 2, 11.95, eaveZ - 0.2, b.width + pd + 0.4, 0.65, 0.36);
    box(trim, eaveX - 0.2, 11.95, fz - pWrap / 2 + pd / 2, 0.36, 0.65, pWrap + pd);

    const frontPosts = [-b.width / 2 + 0.4, -13.5, 0, 13.5, b.width / 2 - 0.4, eaveX - 0.25];
    for (let i = 0; i < frontPosts.length; i++) {
      const px = frontPosts[i];
      box(trim, px, 1.5, eaveZ - 0.25, 0.85, 1.2, 0.85);
      box(trim, px, 6.8, eaveZ - 0.25, 0.42, 9.8, 0.42);
      if (i < frontPosts.length - 1) {
        const span = frontPosts[i + 1] - px;
        const r = Math.min(3.8, span * 0.34);
        for (const sd of [-1, 1]) {
          const sx = sd === 1 ? px + 0.2 : frontPosts[i + 1] - 0.2;
          const arc = new THREE.TorusGeometry(r, 0.1, 5, 12, Math.PI / 2);
          if (sd === 1) arc.rotateZ(Math.PI / 2);
          arc.translate(sx + sd * r, 11.7 - r, eaveZ - 0.25);
          arc.applyMatrix4(buildingMatrix);
          put(mats.trimDark, arc);
        }
      }
    }
    for (let j = 1; j <= 3; j++) {
      const pz = fz - (pWrap * j) / 3;
      box(trim, eaveX - 0.25, 1.5, pz, 0.85, 1.2, 0.85);
      box(trim, eaveX - 0.25, 6.8, pz, 0.42, 9.8, 0.42);
    }

    const rail = (x0, x1, zPos) => {
      const rw = x1 - x0;
      const rcx = (x0 + x1) / 2;
      box(trim, rcx, 2.25, zPos, rw, 0.14, 0.16);
      box(trim, rcx, 1.05, zPos, rw, 0.14, 0.16);
      const bars = Math.max(4, Math.round(rw * 1.4));
      for (let k = 0; k <= bars; k++) {
        box(trim, x0 + (rw * k) / bars, 1.65, zPos, 0.1, 1.15, 0.1);
      }
    };
    rail(-8.5, 8.5, eaveZ - 0.25);
    rail(18.5, b.width / 2 - 0.6, eaveZ - 0.25);

    {
      const rot = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
      const up = new THREE.Vector3(0, 1, 0);
      const out = new THREE.Vector3(0, 0, 1).applyAxisAngle(up, rot);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(up, rot);
      signs.push({
        title: "HENDEE.",
        subtitle: "",
        style: "painted",
        position: new THREE.Vector3(b.x, 13.45, b.z).addScaledVector(out, eaveZ + 0.15).addScaledVector(right, -19.2),
        rotation: rot,
        width: 15.2,
        height: 2.7,
        flush: true,
      });
      signs.push({
        title: "BANK",
        subtitle: "",
        style: "glass",
        position: new THREE.Vector3(b.x, 5.6, b.z).addScaledVector(out, fz - 0.18).addScaledVector(right, 22.5),
        rotation: rot,
        width: 4.4,
        flush: true,
      });
      signs.push({
        title: "BURNS & SANDERS",
        subtitle: "ATTY AT LAW",
        style: "painted",
        position: new THREE.Vector3(b.x, 18.5, b.z).addScaledVector(right, b.width / 2 + 0.25).addScaledVector(out, 26),
        rotation: rot + Math.PI / 2,
        width: 6.5,
        height: 2.5,
        flush: true,
      });
    }
    return wallH + 3;
  };

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

  // ---- Centennial book (Bushnell, Illinois, centennial, 1854-1954) builders. ----
  // All hand-built and parametric; no photo textures. Page numbers are PDF pages.

  // Frame engine house, "The City Hall and Fire Department, for many years" (PDF p.125):
  // two clapboard stories, gable to the street, large double doors, a painted
  // BUSHNELL FIRE DEPARTMENT band, and an open belfry with a bell on the ridge.
  // Proportions are read from the photograph; no dimensions are printed (estimate).
  const addEngineHouse = (b) => {
    const body = paintOf(b);
    const wallH = 22;
    const rise = Math.max(8, b.width * 0.36);
    const fz = b.depth / 2 + 0.14;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.35, 0, b.width + 0.3, 0.7, b.depth + 0.3);
    gableFrontAt(b.width, b.depth, rise, wallH, mats.roofDark, 0, 0);
    clapboardTriangle(body, b.width, rise * 0.95, wallH, "z", b.depth / 2 + 0.02, 0, 0);
    clapboardTriangle(body, b.width, rise * 0.95, wallH, "z", -b.depth / 2 - 0.02, 0, 0);
    for (const x of [-b.width / 2, b.width / 2]) box(mats.trim, x, wallH / 2, fz, 0.42, wallH, 0.3);
    box(mats.trim, 0, wallH + 0.1, fz + 0.1, b.width + 0.6, 0.45, 0.5);
    // Gable crown (PDF p.125): wide raking boards, a frieze board under the eaves on both
    // sides, and short cornice returns at the front corners.
    {
      const half = b.width / 2 + 0.6;
      const r = rise * 0.95 + 0.4;
      const len = Math.hypot(half, r) + 0.3;
      const ang = Math.atan2(r, half);
      for (const sd of [-1, 1]) {
        const rake = new THREE.BoxGeometry(len, 0.75, 0.5);
        rake.rotateZ(-sd * ang);
        rake.translate(sd * half / 2, wallH + r / 2 + 0.1, fz + 0.3);
        rake.applyMatrix4(buildingMatrix);
        put(mats.trim, rake);
        box(mats.trim, sd * (b.width / 2 + 0.6), wallH + 0.25, fz - 0.4, 1.4, 0.6, 1.6);
        box(mats.trim, sd * (b.width / 2 + 0.12), wallH - 0.7, 0, 0.3, 1.4, b.depth);
        box(mats.trim, sd * (b.width / 2 + 0.55), wallH + 0.05, 0, 1.1, 0.35, b.depth + 0.6);
      }
    }
    // Two pairs of tall doors and a single door at the left, as in the photograph.
    const pair = (x, w, h) => {
      box(mats.trim, x, h / 2 + 0.2, fz, w + 0.6, h + 0.5, 0.18);
      for (const s2 of [-1, 1]) {
        box(mats.plank, x + s2 * (w / 4), h / 2 + 0.2, fz + 0.08, w / 2 - 0.15, h, 0.12);
        box(mats.trimDark, x + s2 * (w / 4), h / 2 + 0.2, fz + 0.16, 0.16, h * 0.96, 0.04);
        box(mats.trimDark, x + s2 * (w / 4), h * 0.5, fz + 0.16, w / 2 - 0.4, 0.16, 0.04);
        // Diagonal braces on each leaf, as on the p.125 doors.
        for (const yy of [h * 0.27, h * 0.73]) {
          const lw = w / 2 - 0.4;
          const dl = Math.hypot(lw, h * 0.44);
          const br = new THREE.BoxGeometry(0.2, dl, 0.05);
          br.rotateZ(s2 * Math.atan2(lw, h * 0.44));
          br.translate(x + s2 * (w / 4), yy + 0.2, fz + 0.17);
          br.applyMatrix4(buildingMatrix);
          put(mats.trimDark, br);
        }
      }
    };
    pair(-b.width * 0.175, Math.min(8.6, b.width * 0.28), 10.6);
    pair(b.width * 0.255, Math.min(8.6, b.width * 0.28), 10.6);
    paneledDoor(-b.width * 0.42, fz, 2.8, 7.2, false);
    frontSash(b.width * 0.04, 6.6, fz, 2.2, 5.4, "flat");
    frontSash(-b.width * 0.22, 16.4, fz, 2.6, 5.2, "flat");
    frontSash(b.width * 0.22, 16.4, fz, 2.6, 5.2, "flat");
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = -b.depth / 2 + ((i + 0.6) * b.depth) / 3.2;
        sideSash(side * (b.width / 2 + 0.08), 16, z, side, 2.4, 5, "flat");
      }
    }
    // Open belfry on the ridge, toward the street end; square posts, bell, pyramid cap.
    const by = wallH + rise - 0.6;
    const bz = b.depth / 2 - 6;
    const bw = 5.4;
    box(body, 0, by + 1.1, bz, bw + 0.8, 2.2, bw + 0.8);
    box(mats.trim, 0, by + 2.3, bz, bw + 1.2, 0.35, bw + 1.2);
    for (const px of [-bw / 2, bw / 2]) {
      for (const pz of [-bw / 2, bw / 2]) box(mats.trim, px, by + 5.6, bz + pz, 0.7, 6.4, 0.7);
    }
    // Arched openings on all four faces and a low rail (the p.125 belfry).
    archHood(mats.trim, 0, by + 7.0, bz + bw / 2, bw - 0.5, 1.4, "z");
    archHood(mats.trim, 0, by + 7.0, bz - bw / 2, bw - 0.5, 1.4, "z");
    archHood(mats.trim, bw / 2, by + 7.0, bz, bw - 0.5, 1.4, "x");
    archHood(mats.trim, -bw / 2, by + 7.0, bz, bw - 0.5, 1.4, "x");
    for (const pz of [-bw / 2, bw / 2]) box(mats.trim, 0, by + 3.4, bz + pz, bw, 0.25, 0.2);
    for (const px of [-bw / 2, bw / 2]) box(mats.trim, px, by + 3.4, bz, 0.2, 0.25, bw);
    box(mats.trim, 0, by + 8.75, bz, bw + 1.0, 0.7, bw + 1.0);
    // Flared eave: a wide thin skirt under the pyramid cap, on small brackets.
    box(mats.roofDark, 0, by + 9.25, bz, bw + 3.0, 0.25, bw + 3.0);
    for (const px of [-1, 1]) for (const pz of [-1, 1]) box(mats.trim, px * (bw / 2 + 0.7), by + 8.85, bz + pz * (bw / 2 + 0.7), 0.3, 0.6, 0.3);
    const bell = new THREE.CylinderGeometry(0.7, 1.35, 1.9, 12);
    bell.translate(0, by + 6.2, bz);
    bell.applyMatrix4(buildingMatrix);
    put(mats.metal, bell);
    box(mats.trimDark, 0, by + 7.6, bz, 0.25, 1.4, 0.25);
    const cap = new THREE.ConeGeometry(bw * 0.92, 4.0, 4);
    cap.rotateY(Math.PI / 4);
    cap.translate(0, by + 11.35, bz);
    cap.applyMatrix4(buildingMatrix);
    put(mats.roofDark, cap);
    box(mats.trimDark, 0, by + 14, bz, 0.18, 1.8, 0.18);
    const ball = new THREE.SphereGeometry(0.3, 8, 6);
    ball.translate(0, by + 13.5, bz);
    ball.applyMatrix4(buildingMatrix);
    put(mats.trimDark, ball);
    signFor(b, 13);
    return by + 15;
  };

  // Two-story brick City Hall beside the engine house (PDF p.125): round-arched windows
  // under light hoods, a bracketed cornice, an arched center door, a hipped roof with a
  // gabled dormer. The dormer is lettered CITY ... 18__ in the photograph; it is not
  // lettered here because the rest is unreadable.
  const addCityHall = (b) => {
    const body = brickOf(b);
    const wallH = 26;
    const fz = b.depth / 2 + 0.14;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.5, 0, b.width + 0.4, 1.0, b.depth + 0.4);
    const cols = [-b.width * 0.3, 0, b.width * 0.3];
    for (const x of cols) frontSash(x, 18.4, fz, 3.4, 7.2, "flat", false, mats.stone);
    frontSash(cols[0], 6.4, fz, 3.4, 7.0, "flat", false, mats.stone);
    frontSash(cols[2], 6.4, fz, 3.4, 7.0, "flat", false, mats.stone);
    // Full semicircular light hoods over each opening, the strongest feature of the p.125
    // front, with a glazed head inside the arch.
    const semi = (x, ySpring, span) => {
      ringArch(mats.stone, x, ySpring, fz + 0.5, span / 2, 0.42, true);
      for (const sd of [-1, 1]) box(mats.stone, x + sd * (span / 2), ySpring - 0.2, fz + 0.45, 0.85, 0.5, 0.6);
    };
    for (const x of cols) semi(x, 18.4 + 3.7, 4.2);
    semi(cols[0], 6.4 + 3.6, 4.2);
    semi(cols[2], 6.4 + 3.6, 4.2);
    ringArch(mats.stone, 0, 8.4, fz + 0.5, 3.0, 0.45, true);
    paneledDoor(0, fz, 4.4, 8.0, false);

    // Heavy dark bracketed cornice with corner urns (PDF p.125).
    deepCrown(b, wallH, { proj: 2.4, frieze: 2.4, mat: "dark", spacing: 2.6, finials: true });
    for (const x of [-b.width / 2 + 0.4, b.width / 2 - 0.4]) box(mats.trim, x, wallH * 0.45, fz + 0.3, 0.8, wallH * 0.9, 0.6);
    trueHip(b.width, b.depth, 7, wallH + 1.2, mats.roofDark, 0, 0, 0.4);
    // Gabled dormer above the cornice, toward the street.
    const dz = b.depth / 2 - 5;
    box(body, 0, wallH + 4.2, dz, 8, 6.4, 4.5);
    clapboardTriangle(body, 9, 3.6, wallH + 7.4, "z", dz + 2.3, 0, 0);
    // Dormer crown: a cornice band, raking trim, and a blank name panel (the lettering
    // CITY ... 18__ cannot be read, so it is left blank).
    box(mats.trimDark, 0, wallH + 7.45, dz + 2.4, 9.6, 0.4, 0.8);
    box(mats.trim, 0, wallH + 4.6, dz + 2.3, 5.6, 2.2, 0.12);
    {
      const len = Math.hypot(4.8, 3.8) + 0.2;
      const ang = Math.atan2(3.8, 4.8);
      for (const sd of [-1, 1]) {
        const rk = new THREE.BoxGeometry(len, 0.4, 0.4);
        rk.rotateZ(-sd * ang);
        rk.translate(sd * 2.4, wallH + 7.4 + 1.9, dz + 2.55);
        rk.applyMatrix4(buildingMatrix);
        put(mats.trimDark, rk);
      }
    }
    // Second, smaller gabled dormer to the left of the lettered one (round 3, p.125).
    {
      const dx = -7.2;
      const dz2 = b.depth / 2 - 4.5;
      box(body, dx, wallH + 3.3, dz2, 4.6, 4.6, 3.6);
      frontSash(dx, wallH + 3.4, dz2 + 1.82, 1.8, 2.6, "flat");
      clapboardTriangle(body, 5.4, 2.4, wallH + 5.6, "z", dz2 + 1.82, dx, 0);
      box(mats.trimDark, dx, wallH + 5.65, dz2 + 1.9, 5.8, 0.32, 0.6);
      const len = Math.hypot(2.9, 2.5) + 0.2;
      const ang = Math.atan2(2.5, 2.9);
      for (const sd of [-1, 1]) {
        const rk = new THREE.BoxGeometry(len, 0.32, 0.36);
        rk.rotateZ(-sd * ang);
        rk.translate(dx + sd * 1.45, wallH + 5.6 + 1.25, dz2 + 2.0);
        rk.applyMatrix4(buildingMatrix);
        put(mats.trimDark, rk);
      }
      gableFrontAt(4.8, 3.8, 2.4, wallH + 5.6, mats.roofDark, dx, dz2 - 0.1);
    }
    box(mats.trimDark, b.width / 2 - 1, wallH + 2.6, fz - 0.4, 0.5, 2.6, 0.5);
    chimneyStack(body, -b.width * 0.3, wallH + 5.5, -b.depth * 0.2, 2.4, 6, 2.4);
    downspouts(b.width, b.depth, wallH);
    signFor(b, wallH);
    return wallH + 14;
  };

  // West Side School, built 1896-97 and burned in 1936 (PDF p.70-71): rebuilt to match
  // the p.71 photograph — rusticated stone Romanesque massing (dark rock-faced basement,
  // weathered stone walls, dressed limestone belt courses and copings), wide gabled wings
  // filling right up to a projecting central tower with a big deeply recessed round-arched
  // entrance, triplet of arched windows, and a fat round belfry turret with conical roof.
  // Book text (p.70) mentions buff brick; photo reads as rusticated stone. Heights,
  // stone tones, and turret proportions are estimates from the photograph.
  const addWestSide1897 = (b) => {
    const wallStone = mats.rusticStone;
    const baseStone = mats.rusticStoneDark;
    const trimStone = mats.stone;
    const roofMat = mats.roofDark;
    const base = 6.5;
    const floor = 12.0;
    const wall = base + 2 * floor;
    const fz = b.depth / 2 + 0.12;

    const scaleCylUVs = (geo, radius, height, mat) => {
      const uv = geo.getAttribute("uv");
      if (!uv) return;
      const feet = mat?.userData?.uvFeet || { u: 6.4, v: 3.4 };
      const su = (2 * Math.PI * radius) / feet.u;
      const sv = height / feet.v;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
      uv.needsUpdate = true;
    };

    // Main block: rough dark stone basement, continuous limestone water-table, weathered stone walls.
    box(baseStone, 0, base / 2, 0, b.width + 1.0, base, b.depth + 1.0);
    box(trimStone, 0, base + 0.25, 0, b.width + 1.5, 0.6, b.depth + 1.5);
    box(wallStone, 0, base + floor, 0, b.width, 2 * floor, b.depth);
    // Horizontal Romanesque stone belt courses wrapping the main block.
    box(trimStone, 0, base + 9.2, 0, b.width + 0.5, 0.5, b.depth + 0.5);
    box(trimStone, 0, base + floor, 0, b.width + 0.7, 0.55, b.depth + 0.7);
    box(trimStone, 0, wall - 1.0, 0, b.width + 0.6, 0.8, b.depth + 0.6);
    box(mats.trimDark, 0, wall + 0.05, 0, b.width + 2.6, 0.45, b.depth + 2.6);
    trueHip(b.width, b.depth, 15.5, wall + 0.25, roofMat, 0, 0, 1.5);

    // Corner rusticated quoins/piers on the rear corners too.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(baseStone, sx * (b.width / 2 - 0.5), base / 2, sz * (b.depth / 2 - 0.5), 2.4, base, 2.4);
      }
    }

    // Wide gabled wings spanning from outer corners right up to the central tower (p.71).
    const tw = 20;
    const wingW = (b.width - tw) / 2; // 38 ft each on a 96 ft front — no blank wall gaps.
    const wingProj = 2.2;
    const wfz = fz + wingProj;
    const gableRise = 15.5;
    for (const side of [-1, 1]) {
      const wx = side * (tw / 2 + wingW / 2);
      box(baseStone, wx, base / 2, fz + wingProj / 2 + 0.2, wingW + 0.5, base, wingProj + 0.9);
      box(trimStone, wx, base + 0.25, fz + wingProj / 2 + 0.25, wingW + 0.9, 0.6, wingProj + 1.3);
      box(wallStone, wx, (wall + base) / 2, fz + wingProj / 2, wingW, wall - base, wingProj);
      // Continuous wing belt courses & lintel bands.
      box(trimStone, wx, base + 9.2, wfz + 0.12, wingW + 0.4, 0.5, 0.55);
      box(trimStone, wx, base + floor, wfz + 0.15, wingW + 0.5, 0.55, 0.6);
      box(trimStone, wx, wall - 1.0, wfz + 0.14, wingW + 0.5, 0.85, 0.6);
      // Corner parapet shoulder / pier as seen at outer wing eaves in p.71.
      const shX = wx + side * (wingW / 2 - 1.6);
      box(wallStone, shX, wall + 1.5, wfz - 0.25, 3.2, 3.0, 2.6);
      box(trimStone, shX, wall + 3.15, wfz - 0.25, 3.6, 0.55, 2.9);
      // Steep stone front gable + coping + cross-gable roof back into main hip.
      clapboardTriangle(wallStone, wingW - 0.8, gableRise, wall, "z", wfz - 0.25, wx, 0);
      gableCoping(trimStone, wingW - 0.6, gableRise, wall + 0.4, wfz - 0.05, wx, 0.85);
      box(trimStone, wx, wall + gableRise + 0.9, wfz - 0.05, 1.5, 1.5, 1.3);
      const wd = b.depth * 0.58;
      gableFrontAt(wingW - 0.4, wd, gableRise + 0.3, wall, roofMat, wx, wfz - wd / 2 - 0.2);
      // Gable arched window.
      frontSash(wx, wall + 5.0, wfz + 0.05, 3.0, 4.4, "open", false, trimStone, false, false);
      ringArch(trimStone, wx, wall + 7.2, wfz + 0.32, 1.75, 0.3, true);
      // Six tall narrow windows per wing per floor in three pairs, matching p.71.
      const dxList = [-12.6, -8.8, -1.9, 1.9, 8.8, 12.6];
      for (const dx of dxList) {
        frontSash(wx + dx, base + 4.8, wfz + 0.05, 2.7, 7.2, "open", false, trimStone, false, false);
        frontSash(wx + dx, base + floor + 4.6, wfz + 0.05, 2.7, 7.0, "open", false, trimStone, false, false);
        // Basement slit below each pair center.
      }
      for (const bdx of [-10.7, 0, 10.7]) {
        box(mats.trimDark, wx + bdx, base * 0.5, wfz + 0.3, 3.2, 1.8, 0.22);
        box(trimStone, wx + bdx, base * 0.5 + 1.0, wfz + 0.34, 3.6, 0.35, 0.35);
      }
    }

    // Side walls: six grouped tall windows per floor (3 pairs) matching the right side in p.71.
    for (const side of [-1, 1]) {
      const szList = [-19.5, -15.5, -2.0, 2.0, 15.5, 19.5];
      for (const z of szList) {
        sideSash(side * (b.width / 2 + 0.08), base + 4.8, z, side, 2.4, 7.0, "open", false, trimStone);
        sideSash(side * (b.width / 2 + 0.08), base + floor + 4.6, z, side, 2.4, 6.8, "open", false, trimStone);
      }
      for (const bz of [-17.5, 0, 17.5]) {
        box(mats.trimDark, side * (b.width / 2 + 0.52), base * 0.5, bz, 0.16, 1.7, 3.0);
      }
    }

    // Central projecting entrance tower: square shaft below, fat round belfry turret & conical roof above.
    const tfz = fz + 6.8;
    const tDepth = 20;
    const tz = tfz - tDepth / 2;
    const shaft = 43.0;
    const archR = 5.4;
    const archSpring = 6.2;
    const archWallTop = 15.0;

    // Lower tower piers flanking the big recessed round-arched entrance.
    const pierW = (tw - archR * 2) / 2; // 4.6 ft
    for (const sd of [-1, 1]) {
      const px = sd * (archR + pierW / 2);
      box(baseStone, px, base / 2, tz, pierW + 0.4, base, tDepth + 0.4);
      box(wallStone, px, (archWallTop + base) / 2, tz, pierW, archWallTop - base, tDepth);
      // Dressed stone imposts & jamb pilasters framing the portal.
      box(trimStone, sd * (archR + 0.7), archSpring - 0.35, tfz + 0.25, 1.8, 0.85, 1.1);
      box(baseStone, sd * (archR + 0.75), (archSpring - 0.8) / 2, tfz + 0.2, 1.6, archSpring - 0.8, 0.9);
    }

    // Spandrel & deep arched tunnel (tfz - 4.0 to tfz) built indexed so it merges cleanly.
    {
      const segs = 18;
      const zF = tfz;
      const zB = tfz - 4.0;
      const pos = [];
      const uvs = [];
      const feet = wallStone?.userData?.uvFeet || { u: 6.4, v: 3.4 };
      const pushTri = (a, b3, c) => {
        for (const p3 of [a, b3, c]) {
          pos.push(p3[0], p3[1], p3[2]);
          uvs.push(p3[0] / feet.u, p3[1] / feet.v);
        }
      };
      const outerPt = (ang) => {
        if (ang <= Math.PI * 0.25) return [tw / 2, archSpring + (archWallTop - archSpring) * (ang / (Math.PI * 0.25))];
        if (ang <= Math.PI * 0.75) return [tw / 2 - tw * ((ang - Math.PI * 0.25) / (Math.PI * 0.5)), archWallTop];
        return [-tw / 2, archWallTop - (archWallTop - archSpring) * ((ang - Math.PI * 0.75) / (Math.PI * 0.25))];
      };
      for (let i = 0; i < segs; i++) {
        const a0 = (Math.PI * i) / segs;
        const a1 = (Math.PI * (i + 1)) / segs;
        const ix0 = Math.cos(a0) * archR, iy0 = archSpring + Math.sin(a0) * archR;
        const ix1 = Math.cos(a1) * archR, iy1 = archSpring + Math.sin(a1) * archR;
        const [ox0, oy0] = outerPt(a0);
        const [ox1, oy1] = outerPt(a1);
        // Front spandrel quad (two tris, both windings for safety? No, standard outward + corner fill).
        pushTri([ix0, iy0, zF], [ox0, oy0, zF], [ox1, oy1, zF]);
        pushTri([ix0, iy0, zF], [ox1, oy1, zF], [ix1, iy1, zF]);
        // Back spandrel quad.
        pushTri([ix0, iy0, zB], [ox1, oy1, zB], [ox0, oy0, zB]);
        pushTri([ix0, iy0, zB], [ix1, iy1, zB], [ox1, oy1, zB]);
        // Inner arch soffit barrel.
        pushTri([ix0, iy0, zF], [ix1, iy1, zF], [ix1, iy1, zB]);
        pushTri([ix0, iy0, zF], [ix1, iy1, zB], [ix0, iy0, zB]);
      }
      // Side cheeks of the spandrel box from zB back to tz - tDepth / 2.
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex([...Array(pos.length / 3).keys()]);
      geo.computeVertexNormals();
      geo.applyMatrix4(buildingMatrix);
      put(wallStone, geo);
    }

    // Recessed vestibule back wall, dark arch shadow, and double school doors.
    box(mats.reveal, 0, (archSpring + archR) / 2, tfz - 4.05, archR * 2 + 0.4, archSpring + archR, 0.35);
    box(wallStone, 0, (archWallTop + archSpring + archR) / 2, tfz - tDepth / 2 - 2.0, tw, archWallTop - (archSpring + archR) + 1.0, tDepth - 4.0);
    // Double doors recessed inside the dark porch.
    box(mats.trimDark, 0, 5.2, tfz - 3.7, 6.2, 8.2, 0.3);
    for (const sd of [-1, 1]) {
      box(mats.glass, sd * 1.4, 6.2, tfz - 3.5, 1.9, 3.2, 0.12);
      box(mats.trim, sd * 1.4, 6.2, tfz - 3.45, 2.1, 0.15, 0.14);
    }
    box(mats.stone, 0, 0.75, tfz - 1.6, archR * 2 + 0.8, 1.5, 4.4);
    // Broad stone entrance steps & walk leading toward Twyman.
    box(trimStone, 0, 0.95, tfz + 1.2, 12.4, 0.55, 2.2);
    box(trimStone, 0, 0.45, tfz + 2.6, 13.6, 0.55, 2.4);
    box(trimStone, 0, 0.18, tfz + 22.0, 6.5, 0.2, 38.0);

    // Bold radial cut-stone voussoirs + outer molded limestone archivolt over the entry arch.
    {
      const n = 15;
      const rad = archR + 0.58;
      const thick = 1.25;
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * (i + 0.5)) / n;
        const arc = (Math.PI * rad) / n;
        const geo = new THREE.BoxGeometry(arc * 0.86, thick, 0.75);
        scaleBoxUVs(geo, arc * 0.86, thick, 0.75, trimStone);
        geo.rotateZ(ang - Math.PI / 2);
        geo.translate(Math.cos(ang) * rad, archSpring + Math.sin(ang) * rad, tfz + 0.22);
        geo.applyMatrix4(buildingMatrix);
        put(trimStone, geo);
      }
      ringArch(trimStone, 0, archSpring, tfz + 0.35, archR + 1.25, 0.32);
    }

    // Upper square tower shaft (y = archWallTop .. shaft).
    box(trimStone, 0, archWallTop, tz, tw + 1.0, 0.65, tDepth + 1.0);
    box(wallStone, 0, (shaft + archWallTop) / 2, tz, tw, shaft - archWallTop, tDepth);
    // Belt courses on the tower shaft.
    box(trimStone, 0, 16.2, tz, tw + 0.6, 0.45, tDepth + 0.6);
    box(trimStone, 0, 26.2, tz, tw + 0.9, 0.6, tDepth + 0.9);
    // Triplet of round-arched windows on the 2nd floor of the tower (center taller, p.71).
    for (const [dx, wy, ww, wh] of [[-4.0, 19.3, 2.4, 5.2], [0, 19.9, 2.7, 6.2], [4.0, 19.3, 2.4, 5.2]]) {
      frontSash(dx, wy, tfz + 0.05, ww, wh, "open", false, trimStone, false, false);
      ringArch(trimStone, dx, wy + wh / 2, tfz + 0.30, ww / 2 + 0.22, 0.28, true);
    }
    // Third-stage recessed stone-framed window/tablet bay (p.71).
    frontSash(0, 32.8, tfz + 0.05, 4.8, 5.4, "open", false, trimStone, false, false);
    box(trimStone, 0, 35.8, tfz + 0.32, 6.2, 0.7, 0.85);
    box(trimStone, 0, 29.8, tfz + 0.32, 6.2, 0.65, 0.85);
    for (const sd of [-1, 1]) {
      box(trimStone, sd * 2.8, 32.8, tfz + 0.28, 0.85, 6.2, 0.7);
      // Side slits on the projecting flanks of the tower.
      sideSash(sd * (tw / 2 + 0.06), 19.6, tfz - 4.2, sd, 2.0, 5.2, "open", false, trimStone);
      sideSash(sd * (tw / 2 + 0.06), 32.8, tfz - 4.2, sd, 2.0, 4.8, "open", false, trimStone);
    }

    // Bold square tower cornice + stone corbels transitioning to the fat round turret.
    box(trimStone, 0, shaft + 0.2, tz, tw + 1.8, 1.0, tDepth + 1.8);
    for (let k = -4; k <= 4; k++) {
      box(trimStone, k * 2.1, shaft - 0.65, tfz + 0.45, 0.7, 1.0, 0.9);
      box(trimStone, k * 2.1, shaft - 0.65, tz - tDepth / 2 - 0.45, 0.7, 1.0, 0.9);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(trimStone, sx * (tw / 2 - 1.2), shaft + 1.2, tz + sz * (tDepth / 2 - 1.2), 3.4, 1.2, 3.4);
      }
    }

    // Fat round Romanesque belfry turret (cylinder drum + open arched openings + flared conical roof).
    const drumR = 9.4;
    const drumBase = shaft + 0.7;
    const drumSolidH = 3.2;
    const belfryH = 5.4;
    const drumTop = drumBase + drumSolidH + belfryH;

    // Lower solid stone cylinder.
    {
      const g = new THREE.CylinderGeometry(drumR, drumR + 0.25, drumSolidH, 24);
      scaleCylUVs(g, drumR, drumSolidH, wallStone);
      g.translate(0, drumBase + drumSolidH / 2, tz);
      g.applyMatrix4(buildingMatrix);
      put(wallStone, g);

      const sill = new THREE.CylinderGeometry(drumR + 0.55, drumR + 0.55, 0.55, 24);
      scaleCylUVs(sill, drumR + 0.55, 0.55, trimStone);
      sill.translate(0, drumBase + drumSolidH + 0.15, tz);
      sill.applyMatrix4(buildingMatrix);
      put(trimStone, sill);
    }

    // Recessed dark core inside the round belfry so all openings read deeply shadowed.
    {
      const core = new THREE.CylinderGeometry(drumR - 1.7, drumR - 1.7, belfryH + 0.4, 24);
      core.translate(0, drumBase + drumSolidH + belfryH / 2, tz);
      core.applyMatrix4(buildingMatrix);
      put(mats.trimDark, core);
    }

    // Ten radial stone piers around the round turret framing arched belfry openings.
    const piers = 10;
    const py0 = drumBase + drumSolidH + 0.35;
    for (let i = 0; i < piers; i++) {
      const ang = (Math.PI * 2 * i) / piers;
      const rPier = drumR - 0.45;
      const pg = new THREE.BoxGeometry(1.75, belfryH - 0.5, 1.5);
      scaleBoxUVs(pg, 1.75, belfryH - 0.5, 1.5, wallStone);
      pg.rotateY(-ang);
      pg.translate(Math.sin(ang) * rPier, py0 + (belfryH - 0.5) / 2, tz + Math.cos(ang) * rPier);
      pg.applyMatrix4(buildingMatrix);
      put(wallStone, pg);

      const cap = new THREE.BoxGeometry(2.05, 0.55, 1.75);
      scaleBoxUVs(cap, 2.05, 0.55, 1.75, trimStone);
      cap.rotateY(-ang);
      cap.translate(Math.sin(ang) * rPier, py0 + belfryH - 0.55, tz + Math.cos(ang) * rPier);
      cap.applyMatrix4(buildingMatrix);
      put(trimStone, cap);

      // Bracket under the flared turret eave.
      const br = new THREE.BoxGeometry(0.65, 1.1, 1.4);
      scaleBoxUVs(br, 0.65, 1.1, 1.4, trimStone);
      br.rotateY(-ang);
      br.translate(Math.sin(ang) * (drumR + 0.7), drumTop + 0.65, tz + Math.cos(ang) * (drumR + 0.7));
      br.applyMatrix4(buildingMatrix);
      put(trimStone, br);
    }

    // Upper stone drum frieze & circular cornice ring.
    {
      const frieze = new THREE.CylinderGeometry(drumR + 0.3, drumR, 1.4, 24);
      scaleCylUVs(frieze, drumR + 0.15, 1.4, wallStone);
      frieze.translate(0, drumTop + 0.5, tz);
      frieze.applyMatrix4(buildingMatrix);
      put(wallStone, frieze);

      const corn = new THREE.CylinderGeometry(drumR + 0.9, drumR + 0.4, 0.65, 24);
      scaleCylUVs(corn, drumR + 0.65, 0.65, trimStone);
      corn.translate(0, drumTop + 1.35, tz);
      corn.applyMatrix4(buildingMatrix);
      put(trimStone, corn);
    }

    // Flared conical roof eave + broad conical slate turret roof (matched to p.71).
    const eaveTop = drumTop + 3.6;
    const coneH = 19.0;
    {
      const skirt = new THREE.CylinderGeometry(drumR + 0.4, drumR + 3.2, 2.1, 24);
      scaleCylUVs(skirt, drumR + 1.8, 2.1, roofMat);
      skirt.translate(0, drumTop + 2.55, tz);
      skirt.applyMatrix4(buildingMatrix);
      put(roofMat, skirt);

      const cone = new THREE.ConeGeometry(drumR + 0.5, coneH, 24);
      scaleCylUVs(cone, (drumR + 0.5) * 0.5, coneH, roofMat);
      cone.translate(0, eaveTop + coneH / 2, tz);
      cone.applyMatrix4(buildingMatrix);
      put(roofMat, cone);
    }

    // Finial ball & slender flagstaff at the cone apex.
    const apex = eaveTop + coneH;
    {
      const ball = new THREE.SphereGeometry(0.55, 10, 8);
      ball.translate(0, apex + 0.35, tz);
      ball.applyMatrix4(buildingMatrix);
      put(trimStone, ball);
    }
    box(mats.trimDark, 0, apex + 3.4, tz, 0.22, 6.2, 0.22);

    // Stout stone/brick chimneys behind the wing roofs (right-slope stack visible in p.71).
    chimneyStack(wallStone, -b.width * 0.23, wall + 10.5, -b.depth * 0.12, 2.8, 8.5, 2.8);
    chimneyStack(wallStone, b.width * 0.23, wall + 10.5, -b.depth * 0.12, 2.8, 8.5, 2.8);
    signFor(b, wall - 1);
    return apex + 6.5;
  };

  // Flat-roofed brick school of the 1920s-30s: the 1922 high school addition (PDF p.72)
  // and the 1937 West Side School (PDF p.73). Window rows and a stone entrance surround;
  // the footprints are estimates.
  const addFlatSchool = (b) => {
    const body = brickOf(b);
    const floors = Math.max(1, Number(b.stories) || 2);
    const floor = 13;
    const wall = 3 + floors * floor;
    const fz = b.depth / 2 + 0.12;
    box(body, 0, wall / 2, 0, b.width, wall, b.depth);
    box(mats.stone, 0, 1.5, 0, b.width + 0.4, 3, b.depth + 0.4);
    // Brick parapet with stone coping and a stone band below it (PDF p.72-73).
    box(body, 0, wall + 1.3, 0, b.width, 2.6, b.depth);
    box(mats.stone, 0, wall + 2.75, 0, b.width + 0.6, 0.5, b.depth + 0.6);
    box(mats.stone, 0, wall - 0.6, 0, b.width + 0.3, 0.9, b.depth + 0.3);
    box(mats.roofDark, 0, wall + 2.3, 0, b.width - 1.4, 0.3, b.depth - 1.4);
    const cols = Math.max(4, Math.round(b.width / 7));
    const gap = b.width / cols;
    const mid = Math.floor(cols / 2);
    for (let c = 0; c < cols; c++) {
      if (c === mid) continue;
      const x = -b.width / 2 + gap * (c + 0.5);
      for (let f2 = 0; f2 < floors; f2++) frontSash(x, 3 + f2 * floor + floor * 0.52, fz, Math.min(4.2, gap * 0.6), 7.2, "flat", false, mats.stone);
    }
    const ex = -b.width / 2 + gap * (mid + 0.5);
    box(mats.stone, ex, wall / 2, fz + 0.4, Math.max(8, gap), wall, 0.8);
    box(mats.stone, ex, wall + 2.6, fz + 0.4, Math.max(9, gap + 1), 4.6, 0.9);
    box(mats.stone, ex, wall + 5.1, fz + 0.5, Math.max(9.6, gap + 1.6), 0.5, 1.2);
    paneledDoor(ex, fz + 0.85, 4.6, 8.2, true);
    frontSash(ex, 3 + floor * 1.52, fz + 0.85, 3.2, 6.8, "flat", false, mats.stone);
    for (const side of [-1, 1]) {
      const n = Math.max(2, Math.round(b.depth / 12));
      for (let i = 0; i < n; i++) {
        const z = -b.depth / 2 + ((i + 0.5) * b.depth) / n;
        for (let f2 = 0; f2 < floors; f2++) sideSash(side * (b.width / 2 + 0.08), 3 + f2 * floor + floor * 0.52, z, side, 3, 7, "flat", false, mats.stone);
      }
    }
    signFor(b, wall - 1);
    return wall + 6;
  };

  // ---- Round 7: Gothic pieces built in a wall's own frame (u across, y up, +n out of the wall).
  // faceM(angle, x, z): angle 0 is the front (+z), PI/2 the +x side, -PI/2 the -x side, PI the back.
  // On a side wall u runs opposite to local z on the +x side and along local z on the -x side.
  const faceM = (angle, x, z) =>
    new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(angle));
  const fput = (M, mat, geo) => {
    if (!geo.index) geo.setIndex([...Array(geo.getAttribute("position").count).keys()]);
    geo.applyMatrix4(M);
    geo.applyMatrix4(buildingMatrix);
    put(mat, geo);
  };
  const fbox = (M, mat, cx, cy, cz, w, h, d) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (mat === mats.glass) gradeGlassUV(geo);
    else scaleBoxUVs(geo, w, h, d, mat);
    geo.translate(cx, cy, cz);
    fput(M, mat, geo);
  };
  const feetUV = (geo, mat) => {
    const feet = mat?.userData?.uvFeet;
    const uv = geo.getAttribute("uv");
    if (!feet || !uv) return geo;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / feet.u, uv.getY(i) / feet.v);
    return geo;
  };
  // Equilateral pointed arch: straight jambs to rectH, then two arcs of radius w meeting at the apex.
  const pointedShape = (hw, rectH, Ctor = THREE.Shape) => {
    const s = new Ctor();
    const w = hw * 2;
    s.moveTo(-hw, 0);
    s.lineTo(hw, 0);
    s.lineTo(hw, rectH);
    s.absarc(-hw, rectH, w, 0, Math.PI / 3, false);
    s.absarc(hw, rectH, w, (2 * Math.PI) / 3, Math.PI, false);
    s.lineTo(-hw, 0);
    return s;
  };
  // Pointed window: glass (or a dark louvre/door field), a stone surround that follows the
  // arch, mullions, and optional sub-arches and a circle (or star circle) in the head.
  const gothicWin = (M, cx, ySill, w, rectH, opt = {}) => {
    const hw = w / 2;
    const st = opt.mat || mats.stone;
    const s = opt.surround ?? 0.5;
    const lights = opt.lights || 1;
    const apex = 0.866 * w;
    const glass = new THREE.ShapeGeometry(pointedShape(hw, rectH), 10);
    glass.translate(cx, ySill, 0.05);
    fput(M, opt.glass || shopGlass, glass);
    const outer = pointedShape(hw + s, rectH);
    outer.holes.push(pointedShape(hw, rectH, THREE.Path));
    const ring = new THREE.ExtrudeGeometry(outer, { depth: 0.34, bevelEnabled: false, curveSegments: 10 });
    feetUV(ring, st);
    ring.translate(cx, ySill, 0);
    fput(M, st, ring);
    fbox(M, st, cx, ySill - 0.22, 0.32, w + s * 2 + 0.5, 0.42, 0.75);
    const archY = (u) => rectH + Math.sqrt(Math.max(0, w * w - (Math.abs(u) + hw) ** 2));
    if (lights > 1) {
      const lw = w / lights;
      const headY = opt.circle ? rectH : null;
      for (let k = 1; k < lights; k++) {
        const u = -hw + lw * k;
        const top = headY ?? archY(u) - 0.15;
        fbox(M, st, cx + u, ySill + top / 2, 0.16, 0.26, top, 0.22);
      }
      if (opt.circle) {
        // A small pointed head over each light, then a circle filling the arch head.
        const r = lw * 0.5;
        const rise = 0.866 * lw * 0.8;
        const len = Math.hypot(r, rise);
        const ang = Math.atan2(rise, r);
        for (let k = 0; k < lights; k++) {
          const lc = -hw + lw * (k + 0.5);
          for (const sd of [-1, 1]) {
            const bar = new THREE.BoxGeometry(len, 0.22, 0.2);
            bar.rotateZ(-sd * ang);
            bar.translate(cx + lc + (sd * r) / 2, ySill + rectH + rise / 2, 0.16);
            fput(M, st, bar);
          }
        }
        const cr = Math.min(hw * 0.46, apex * 0.3);
        const cy = ySill + rectH + rise + cr + 0.15;
        const t = new THREE.TorusGeometry(cr, 0.16, 6, 28);
        t.translate(cx, cy, 0.18);
        fput(M, st, t);
        if (opt.star) {
          for (const base of [Math.PI / 2, -Math.PI / 2]) {
            for (let k = 0; k < 3; k++) {
              const a0 = base + (k * 2 * Math.PI) / 3;
              const a1 = a0 + (2 * Math.PI) / 3;
              const x0 = Math.cos(a0) * cr, y0 = Math.sin(a0) * cr;
              const x1 = Math.cos(a1) * cr, y1 = Math.sin(a1) * cr;
              const bar = new THREE.BoxGeometry(Math.hypot(x1 - x0, y1 - y0), 0.14, 0.14);
              bar.rotateZ(Math.atan2(y1 - y0, x1 - x0));
              bar.translate(cx + (x0 + x1) / 2, cy + (y0 + y1) / 2, 0.2);
              fput(M, st, bar);
            }
          }
        }
      }
    }
    if (opt.transom) fbox(M, st, cx, ySill + opt.transom, 0.16, w, 0.22, 0.22);
    if (opt.louvres) {
      for (let y = ySill + 0.6; y < ySill + rectH; y += 0.85) fbox(M, mats.trimDark, cx, y, 0.12, w - 0.2, 0.16, 0.2);
    }
    return ySill + rectH + apex;
  };
  // Round window, optionally with the six-pointed star tracery of the p.62 drawing.
  const roseWin = (M, cx, cy, r, opt = {}) => {
    const g = new THREE.CircleGeometry(r, 28);
    g.translate(cx, cy, 0.05);
    fput(M, opt.glass || shopGlass, g);
    const t = new THREE.TorusGeometry(r + 0.16, opt.tube ?? 0.3, 6, 28);
    t.translate(cx, cy, 0.18);
    fput(M, opt.mat || mats.stone, t);
    if (!opt.star) return;
    for (const base of [Math.PI / 2, -Math.PI / 2]) {
      for (let k = 0; k < 3; k++) {
        const a0 = base + (k * 2 * Math.PI) / 3;
        const a1 = a0 + (2 * Math.PI) / 3;
        const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
        const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
        const bar = new THREE.BoxGeometry(Math.hypot(x1 - x0, y1 - y0), 0.16, 0.16);
        bar.rotateZ(Math.atan2(y1 - y0, x1 - x0));
        bar.translate(cx + (x0 + x1) / 2, cy + (y0 + y1) / 2, 0.2);
        fput(M, opt.mat || mats.stone, bar);
      }
    }
  };
  // Triangular gable field on a wall, with raking trim.
  const faceGable = (M, mat, trim, cx, yBase, span, rise) => {
    const s = new THREE.Shape();
    s.moveTo(-span / 2, 0);
    s.lineTo(span / 2, 0);
    s.lineTo(0, rise);
    s.lineTo(-span / 2, 0);
    const g = feetUV(new THREE.ShapeGeometry(s), mat);
    g.translate(cx, yBase, 0.02);
    fput(M, mat, g);
    if (!trim) return;
    const len = Math.hypot(span / 2, rise) + 0.3;
    const ang = Math.atan2(rise, span / 2);
    for (const sd of [-1, 1]) {
      const rk = new THREE.BoxGeometry(len, 0.4, 0.5);
      scaleBoxUVs(rk, len, 0.4, 0.5, trim);
      rk.rotateZ(-sd * ang);
      rk.translate(cx + (sd * span) / 4, yBase + rise / 2 + 0.15, 0.2);
      fput(M, trim, rk);
    }
  };
  const towerFaces = (tx, tz, half) =>
    [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => faceM(a, tx + Math.sin(a) * half, tz + Math.cos(a) * half));

  // Second Methodist Episcopal church, dedicated May 1884, burned 4 February 1923 (PDF p.61,
  // p.38; drawing p.62): brick front gable with a large pointed traceried window and a star
  // circle, small pointed windows, a low side aisle on the left, a square corner tower at the
  // right front (pointed door, star window, blank tablet, corbelled band, belfry with gablets,
  // tall spire), and a gabled side wing behind the tower. Sizes are estimates from the drawing.
  const addMethodist1884 = (b) => {
    const body = brickOf(b);
    const st = mats.stone;
    const rf = mats.roofSlate;
    const W = b.width;
    const D = b.depth;
    const fz = D / 2;
    const nx0 = -W / 2 + 5;
    const nx1 = W / 2 - 12;
    const nw = nx1 - nx0;
    const ncx = (nx0 + nx1) / 2;
    const wallH = 22;
    const rise = nw * 0.48;
    box(body, ncx, wallH / 2, 0, nw, wallH, D);
    box(st, ncx, 0.7, 0, nw + 0.6, 1.4, D + 0.6);
    gableFrontAt(nw, D, rise, wallH, rf, ncx, 0);
    clapboardTriangle(body, nw, rise * 0.96, wallH, "z", fz + 0.02, ncx, 0);
    clapboardTriangle(body, nw, rise * 0.96, wallH, "z", -fz - 0.02, ncx, 0);
    gableCoping(mats.trim, nw + 0.8, rise * 0.96 + 0.3, wallH, fz + 0.3, ncx, 0.45);
    box(st, ncx, 11.2, fz + 0.12, nw + 0.3, 0.45, 0.34);
    box(st, ncx, wallH - 0.3, fz + 0.12, nw + 0.3, 0.45, 0.34);
    const MF = faceM(0, 0, fz);
    gothicWin(MF, ncx, 12.4, nw * 0.4, 7.0, { lights: 4, circle: true, star: true, surround: 0.6 });
    for (const dx of [-nw * 0.36, nw * 0.36]) gothicWin(MF, ncx + dx, 13.4, 1.9, 4.6, { surround: 0.32 });
    for (let i = 0; i < 5; i++) gothicWin(MF, nx0 + 2.6 + i * ((nw - 5.2) / 4), 3.0, 1.9, 4.8, { surround: 0.32 });
    // Round vents at the apex and the feet of the gable bargeboard (p.62).
    roseWin(MF, ncx, wallH + rise - 3.6, 0.9, { tube: 0.2, glass: mats.reveal });
    for (const sd of [-1, 1]) roseWin(MF, ncx + sd * (nw / 2 - 2.6), wallH + 1.3, 0.6, { tube: 0.18, glass: mats.reveal });
    // Low side aisle on the left with a lean-to roof.
    const ax = -W / 2 + 2.5;
    box(body, ax, 7, 0, 5, 14, D - 4);
    {
      const ang = Math.atan2(3.2, 5);
      const g = new THREE.BoxGeometry(Math.hypot(5, 3.2) + 1.2, 0.3, D - 2.5);
      scaleBoxUVs(g, 7, 0.3, D - 2.5, rf);
      g.rotateZ(ang);
      g.translate(ax - 0.4, 15.4, 0);
      g.applyMatrix4(buildingMatrix);
      put(rf, g);
    }
    const ML = faceM(-Math.PI / 2, -W / 2, 0);
    for (const z of [-26, -14, -2, 10, 22]) gothicWin(ML, z, 3.4, 2.0, 5.0, { surround: 0.3 });
    // Right side of the nave behind the wing, and the gabled side wing behind the tower.
    const MR = faceM(Math.PI / 2, nx1, 0);
    for (const z of [-28, -18, -8]) gothicWin(MR, -z, 8.5, 2.6, 7.2, { surround: 0.4 });
    const wx = (nx1 + W / 2) / 2;
    const ww = W / 2 - nx1;
    const wz0 = 0;
    const wz1 = fz - 14;
    const wzc = (wz0 + wz1) / 2;
    const wd = wz1 - wz0;
    box(body, wx, 10, wzc, ww, 20, wd);
    box(st, wx, 0.7, wzc, ww + 0.6, 1.4, wd + 0.6);
    gableAt(ww, wd, 8, 20, rf, wx, wzc);
    const MW = faceM(Math.PI / 2, W / 2, wzc);
    faceGable(MW, body, mats.trim, 0, 20, wd, 7.7);
    for (const u of [-wd * 0.22, wd * 0.22]) gothicWin(MW, u, 6.5, 2.5, 8.0, { surround: 0.4 });
    roseWin(MW, 0, 23.4, 0.8, { tube: 0.2, glass: mats.reveal });
    // Corner tower.
    const tw = 12;
    const tx = W / 2 - tw / 2;
    const tz = fz - tw / 2 + 2;
    const th = 40;
    box(body, tx, th / 2, tz, tw, th, tw);
    box(st, tx, 0.8, tz, tw + 0.6, 1.6, tw + 0.6);
    for (const px of [-1, 1]) for (const pz of [-1, 1]) {
      box(body, tx + px * (tw / 2 + 0.1), (th - 2) / 2, tz + pz * (tw / 2 + 0.1), 1.2, th - 2, 1.2);
    }
    const MT = faceM(0, tx, tz + tw / 2);
    gothicWin(MT, 0, 0.35, 4.4, 6.2, { glass: mats.trimDark, surround: 0.7, lights: 2 });
    box(st, tx, 0.25, tz + tw / 2 + 1.6, 6.4, 0.5, 3.2);
    roseWin(MT, 0, 17.2, 2.3, { star: true });
    fbox(MT, st, 0, 22.4, 0.14, 3.8, 1.5, 0.28);
    const faces = towerFaces(tx, tz, tw / 2);
    for (const M of faces) {
      fbox(M, st, 0, 25.4, 0.18, tw + 0.4, 0.4, 0.4);
      for (let i = 0; i < 6; i++) fbox(M, body, -tw / 2 + 1 + i * 2, 26.3, 0.3, 1.1, 1.3, 0.6);
    }
    box(st, tx, th + 0.3, tz, tw + 0.9, 0.6, tw + 0.9);
    // Belfry with a louvred pointed opening a face, gablets with an oculus, and the spire.
    const bw = tw - 1.5;
    const bTop = th + 12;
    box(body, tx, (th + bTop) / 2 + 0.3, tz, bw, bTop - th - 0.6, bw);
    for (const M of towerFaces(tx, tz, bw / 2)) {
      gothicWin(M, 0, th + 2.4, 3.4, 4.6, { glass: mats.reveal, surround: 0.45, louvres: true });
      faceGable(M, body, mats.trim, 0, bTop, bw, 6.2);
      roseWin(M, 0, bTop + 2.3, 0.75, { tube: 0.18, glass: mats.reveal });
    }
    box(mats.trim, tx, bTop + 0.15, tz, bw + 0.8, 0.4, bw + 0.8);
    const spire = new THREE.ConeGeometry(bw * 0.72, 26, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(tx, bTop + 13, tz);
    spire.applyMatrix4(buildingMatrix);
    put(rf, spire);
    box(mats.trimDark, tx, bTop + 27.4, tz, 0.22, 3.2, 0.22);
    box(mats.trimDark, tx, bTop + 26.4, tz, 0.6, 0.6, 0.6);
    return bTop + 29;
  };

  // Methodist church dedicated 12 July 1925 (PDF p.61, p.39; photograph p.63): dark brick and
  // light stone, a large front gable with a big pointed traceried window between buttresses,
  // a lower hip-roofed wing on the left with round-arched windows, a square corner tower on the
  // right with paired louvred pointed belfry openings and a flat coped top, a gabled entrance
  // porch at the foot of the tower, and a large hipped roof behind. Sizes are estimates.
  const addMethodist1925 = (b) => {
    const body = brickOf(b);
    const st = mats.stone;
    const rf = mats.roofDark;
    const W = b.width;
    const D = b.depth;
    const fz = D / 2;
    const zSplit = 10;
    // Main mass behind the front, under one big hipped roof.
    const md = zSplit + fz;
    const mzc = (zSplit - fz) / 2;
    box(body, 0, 11, mzc, W, 22, md);
    box(st, 0, 0.7, mzc, W + 0.6, 1.4, md + 0.6);
    trueHip(W, md, 13, 22, rf, 0, mzc, 1.2);
    // Front gable bay.
    const gw = 18;
    const gd = fz - zSplit;
    const gzc = (zSplit + fz) / 2;
    box(body, 0, 12, gzc, gw, 24, gd);
    box(st, 0, 0.7, gzc, gw + 0.6, 1.4, gd + 0.6);
    gableFrontAt(gw, gd, 9, 24, rf, 0, gzc);
    clapboardTriangle(body, gw, 8.7, 24, "z", fz + 0.02, 0, 0);
    gableCoping(st, gw + 0.8, 9.1, 24, fz + 0.3, 0, 0.6);
    for (const sx of [-gw / 2 - 0.3, gw / 2 + 0.3]) {
      box(body, sx, 11.5, fz + 0.5, 1.9, 23, 1.7);
      box(st, sx, 23.2, fz + 0.6, 2.1, 0.5, 1.9);
      box(st, sx, 12.5, fz + 1.45, 2.1, 0.45, 0.35);
    }
    const MF = faceM(0, 0, fz);
    gothicWin(MF, 0, 9.4, 9.4, 8.0, { lights: 4, circle: true, surround: 0.75 });
    box(st, 0, 7.8, fz + 0.15, gw, 0.45, 0.32);
    for (const x of [-5, 0, 5]) {
      fbox(MF, shopGlass, x, 4.2, 0.05, 2.8, 2.2, 0.06);
      fbox(MF, st, x, 2.9, 0.22, 3.4, 0.3, 0.45);
      fbox(MF, mats.trim, x, 4.2, 0.12, 0.14, 2.2, 0.08);
    }
    // Lower left wing with its own hipped roof.
    const lx0 = -W / 2;
    const lx1 = -gw / 2;
    const lw = lx1 - lx0;
    const lcx = (lx0 + lx1) / 2;
    const lz1 = fz - 2;
    const ld = lz1 - zSplit;
    const lzc = (zSplit + lz1) / 2;
    box(body, lcx, 10, lzc, lw, 20, ld);
    box(st, lcx, 0.7, lzc, lw + 0.6, 1.4, ld + 0.6);
    trueHip(lw, ld, 5, 20, rf, lcx, lzc, 1.0);
    box(st, lcx, 19.6, lz1 + 0.1, lw + 0.2, 0.5, 0.3);
    frontSash(lcx - lw * 0.24, 12.6, lz1, 2.8, 8.2, "round", false, st);
    frontSash(lcx + lw * 0.24, 12.6, lz1, 2.8, 8.2, "round", false, st);
    paneledDoor(lcx - lw * 0.24, lz1 + 0.1, 3.0, 6.4, false);
    box(st, lcx - lw * 0.24, 0.3, lz1 + 1.2, 4.4, 0.6, 2.2);
    for (const z of [zSplit + 4, zSplit + 12]) sideSash(lx0 - 0.08, 12.6, z, -1, 2.8, 8.2, "round", false, st);
    // Side walls of the main mass: pointed windows between stone-capped buttresses.
    for (const sd of [-1, 1]) {
      const M = faceM((sd * Math.PI) / 2, sd * (W / 2), 0);
      for (const z of [-28, -18, -8, 2]) gothicWin(M, -sd * z, 8.6, 3.4, 7.0, { lights: 2, surround: 0.5 });
      for (const z of [-34.5, -23, -13, -3, 7]) {
        box(body, sd * (W / 2 + 0.6), 9.5, z, 1.2, 19, 1.7);
        box(st, sd * (W / 2 + 0.7), 19.2, z, 1.5, 0.5, 2.0);
        box(st, sd * (W / 2 + 1.15), 10, z, 0.35, 0.45, 2.0);
      }
    }
    // Corner tower.
    const tw = 13;
    const tx = W / 2 - tw / 2;
    const tz = fz - tw / 2 + 2;
    const th = 52;
    box(body, tx, th / 2, tz, tw, th, tw);
    box(st, tx, 0.8, tz, tw + 0.6, 1.6, tw + 0.6);
    for (const y of [16, 31.5]) box(st, tx, y, tz, tw + 0.35, 0.45, tw + 0.35);
    box(st, tx, th + 0.25, tz, tw + 0.5, 0.5, tw + 0.5);
    for (const px of [-1, 1]) for (const pz of [-1, 1]) {
      const qx = tx + px * (tw / 2 - 0.3);
      const qz = tz + pz * (tw / 2 - 0.3);
      box(body, qx, (th + 2) / 2, qz, 1.9, th + 2, 1.9);
      box(st, qx, th + 2.2, qz, 2.3, 0.45, 2.3);
    }
    const faces = towerFaces(tx, tz, tw / 2);
    faces.forEach((M, i) => {
      for (const u of [-2.6, 2.6]) gothicWin(M, u, 36.2, 2.8, 8.0, { glass: mats.reveal, surround: 0.45, louvres: true });
      if (i <= 1) {
        fbox(M, shopGlass, 0, 24.5, 0.05, 3.8, 4.4, 0.06);
        for (const u of [-0.65, 0.65]) fbox(M, st, u, 24.5, 0.14, 0.24, 4.4, 0.2);
        fbox(M, st, 0, 22.1, 0.24, 4.6, 0.35, 0.5);
        fbox(M, st, 0, 26.9, 0.2, 4.6, 0.4, 0.4);
      }
    });
    // Gabled entrance porch at the foot of the tower, pointed doorway.
    const pw = 10;
    const pdp = 5;
    const pz0 = tz + tw / 2;
    const pzc = pz0 + pdp / 2;
    box(body, tx, 6.5, pzc, pw, 13, pdp);
    box(st, tx, 0.7, pzc, pw + 0.5, 1.4, pdp + 0.5);
    gableFrontAt(pw, pdp, 4.5, 13, rf, tx, pzc);
    clapboardTriangle(body, pw, 4.3, 13, "z", pz0 + pdp + 0.02, tx, 0);
    gableCoping(st, pw + 0.6, 4.6, 13, pz0 + pdp + 0.3, tx, 0.5);
    const MP = faceM(0, tx, pz0 + pdp);
    gothicWin(MP, 0, 0.35, 5.0, 5.8, { glass: mats.trimDark, surround: 0.7 });
    paneledDoor(tx - 1.15, pz0 + pdp + 0.1, 2.1, 5.6, false);
    paneledDoor(tx + 1.15, pz0 + pdp + 0.1, 2.1, 5.6, false);
    box(st, tx, 0.3, pz0 + pdp + 1.6, 8.5, 0.6, 3.2);
    chimneyStack(body, -W * 0.3, 33, -8, 2.8, 14, 2.8);
    return th + 4;
  };

  // St. Bernard rectory, built in the autumn of 1916 (PDF p.60; photograph p.61, left of the
  // 1953 church): two-and-a-half-story brick house, hipped main roof with a row of dormers, a
  // front gable on the church side, a tall chimney, a broad flat-roofed porch on the corner
  // side. Sizes and colours are estimates.
  const addStBernardRectory = (b) => {
    const body = brickOf(b);
    const trim = mats.siding.white;
    const rf = mats.roofDark;
    const W = b.width;
    const D = b.depth;
    const fz = D / 2;
    const base = 0.9;
    const wallH = 20.5;
    const top = base + wallH;
    box(body, 0, top / 2, 0, W, top, D);
    box(mats.stone, 0, base / 2 + 0.2, 0, W + 0.5, base + 0.4, D + 0.5);
    box(trim, 0, top - 0.3, 0, W + 1.0, 0.6, D + 1.0);
    trueHip(W, D, 10, top, rf, 0, 0, 1.5);
    // Front gable on the church side (local +x).
    const gx = W / 2 - 6.5;
    const gwid = 12;
    const proj = 1.0;
    box(body, gx, top / 2, fz - 3 + proj / 2, gwid, top, 6 + proj);
    gableFrontAt(gwid, 12, 9, top, rf, gx, fz - 5 + proj);
    clapboardTriangle(body, gwid, 8.6, top, "z", fz + proj + 0.02, gx, 0);
    gableCoping(trim, gwid + 0.9, 8.9, top, fz + proj + 0.3, gx, 0.35);
    const gz = fz + proj;
    frontSash(gx - 1.4, top + 3.2, gz, 1.7, 3.4, "flat", false, trim);
    frontSash(gx + 1.4, top + 3.2, gz, 1.7, 3.4, "flat", false, trim);
    frontSash(gx, 15.8, gz, 2.6, 5.0, "flat", false, trim);
    frontSash(gx - 1.7, 6.6, gz, 2.3, 5.2, "flat", false, trim);
    frontSash(gx + 1.7, 6.6, gz, 2.3, 5.2, "flat", false, trim);
    // Left part: upstairs windows above the porch, door and windows behind it.
    const lx0 = -W / 2;
    const lx1 = gx - gwid / 2;
    const lc = (lx0 + lx1) / 2;
    const lw = lx1 - lx0;
    for (const dx of [-lw * 0.32, 0, lw * 0.32]) frontSash(lc + dx, 15.8, fz, 2.5, 5.0, "flat", false, trim);
    frontSash(lc - lw * 0.3, 6.6, fz, 2.6, 5.4, "flat", false, trim);
    frontSash(lc + lw * 0.3, 6.6, fz, 2.6, 5.4, "flat", false, trim);
    paneledDoor(lc, fz + 0.05, 3.2, 7.2, true);
    // Flat-roofed porch across the left part.
    const pd = 8;
    const pzc = fz + pd / 2;
    box(mats.plank, lc - 0.5, base + 0.7, pzc, lw + 1.5, 0.3, pd);
    box(mats.stone, lc - 0.5, (base + 0.5) / 2, pzc, lw + 1.5, base + 0.5, pd);
    box(rf, lc - 0.5, 10.9, pzc + 0.2, lw + 2.2, 0.3, pd + 0.8);
    box(trim, lc - 0.5, 10.3, fz + pd + 0.5, lw + 2.2, 1.2, 0.3);
    box(trim, lx0 - 1.1, 10.3, pzc + 0.2, 0.3, 1.2, pd + 0.8);
    const posts = [lx0 + 0.2, lc - lw * 0.17, lc + lw * 0.17, lx1 - 0.2];
    for (const px of posts) {
      box(body, px, base + 1.6, fz + pd - 0.4, 1.3, 2.4, 1.3);
      box(trim, px, 6.8, fz + pd - 0.4, 0.75, 6.8, 0.75);
    }
    for (let i = 0; i < posts.length - 1; i++) {
      if (i === 1) continue;
      const x0 = posts[i] + 0.6;
      const x1 = posts[i + 1] - 0.6;
      box(trim, (x0 + x1) / 2, 4.2, fz + pd - 0.4, x1 - x0, 0.2, 0.22);
    }
    box(mats.stone, lc, 0.45, fz + pd + 1.3, 5, 0.9, 2.6);
    // Row of dormers on the front slope.
    for (const dx of [-lw * 0.32, 0, lw * 0.32]) {
      const x = lc + dx;
      box(body, x, top + 3.1, fz - 3.6, 4.0, 4.6, 4.0);
      box(rf, x, top + 5.6, fz - 3.4, 4.9, 0.35, 5.0);
      frontSash(x, top + 3.0, fz - 1.6, 2.2, 2.8, "flat", false, trim);
    }
    for (const sd of [-1, 1]) {
      for (const z of [-fz * 0.45, fz * 0.25]) {
        sideSash(sd * (W / 2 + 0.06), 15.8, z, sd, 2.4, 5.0, "flat", false, trim);
        sideSash(sd * (W / 2 + 0.06), 6.6, z, sd, 2.4, 5.2, "flat", false, trim);
      }
    }
    chimneyStack(body, -1.5, top + 8.5, -3.5, 3.2, 15, 3.2);
    chimneyStack(body, gx + 3.5, top + 6.5, fz - 9, 2.2, 11, 2.2);
    // Trees in the front yard (p.61).
    const t = new THREE.Vector3(lx0 + 4, 0, fz + 16).applyMatrix4(buildingMatrix);
    extraTrees.push({ x: t.x, z: t.z, kind: "elm", scale: 1.6 });
    return top + 14;
  };

  // Semicircular round-arched window with optional mullions & radial head tracery (p.67, p.66).
  const roundShape = (hw, rectH, Ctor = THREE.Shape) => {
    const s = new Ctor();
    s.moveTo(-hw, 0);
    s.lineTo(hw, 0);
    s.lineTo(hw, rectH);
    s.absarc(0, rectH, hw, 0, Math.PI, false);
    s.lineTo(-hw, 0);
    return s;
  };
  const roundWin = (M, cx, ySill, w, rectH, opt = {}) => {
    const hw = w / 2;
    const st = opt.mat || mats.trim;
    const s = opt.surround ?? 0.45;
    const lights = opt.lights || 1;
    const glass = new THREE.ShapeGeometry(roundShape(hw, rectH), 14);
    glass.translate(cx, ySill, 0.05);
    fput(M, opt.glass || shopGlass, glass);
    const outer = roundShape(hw + s, rectH);
    outer.holes.push(roundShape(hw, rectH, THREE.Path));
    const ring = new THREE.ExtrudeGeometry(outer, { depth: 0.32, bevelEnabled: false, curveSegments: 14 });
    feetUV(ring, st);
    ring.translate(cx, ySill, 0);
    fput(M, st, ring);
    fbox(M, st, cx, ySill - 0.22, 0.3, w + s * 2 + 0.4, 0.4, 0.7);
    if (lights > 1) {
      const lw = w / lights;
      fbox(M, st, cx, ySill + rectH, 0.16, w, 0.22, 0.22);
      for (let k = 1; k < lights; k++) {
        const u = -hw + lw * k;
        const headH = Math.sqrt(Math.max(0, hw * hw - u * u));
        fbox(M, st, cx + u, ySill + (rectH + headH) / 2, 0.16, 0.24, rectH + headH, 0.22);
      }
      if (opt.circle) {
        const cr = hw * 0.38;
        const cy = ySill + rectH + hw * 0.5;
        const t = new THREE.TorusGeometry(cr, 0.14, 6, 24);
        t.translate(cx, cy, 0.18);
        fput(M, st, t);
      }
    }
    return ySill + rectH + hw;
  };

  // Original First Presbyterian Church, dedicated 1869 (PDF p.64): cream/white frame
  // steep gable front, center gabled vestibule, slender left corner pinnacle turret, tall
  // right corner tower with circular medallions, open gabled belfry, tall spire, and
  // pointed lancet side windows. Turned to face Hurst in 1903 (1910 stop).
  const addPresbyterian1869 = (b) => {
    const body = paintOf(b);
    const trim = mats.trim;
    const rf = mats.roofDark;
    const W = b.width;
    const D = b.depth;
    const fz = D / 2;

    // Main nave slightly inset on the right to sit beside the corner tower.
    const nw = W - 8;
    const ncx = -4;
    const nd = D - 4;
    const nzc = -2;
    const wallH = 19;
    const rise = 16;
    box(body, ncx, wallH / 2, nzc, nw, wallH, nd);
    box(mats.stone, ncx, 0.8, nzc, nw + 0.6, 1.6, nd + 0.6);
    gableFrontAt(nw, nd, rise, wallH, rf, ncx, nzc);
    clapboardTriangle(body, nw, rise * 0.96, wallH, "z", nzc + nd / 2 + 0.02, ncx, 0);
    clapboardTriangle(body, nw, rise * 0.96, wallH, "z", nzc - nd / 2 - 0.02, ncx, 0);
    gableCoping(trim, nw + 0.8, rise * 0.96 + 0.3, wallH, nzc + nd / 2 + 0.25, ncx, 0.45);
    box(trim, ncx, wallH - 0.2, nzc + nd / 2 + 0.15, nw + 0.4, 0.45, 0.35);

    // Left-front corner pinnacle turret with slender spire (p.64).
    const px = ncx - nw / 2 + 1.2;
    const pz = nzc + nd / 2 - 1.2;
    box(body, px, (wallH + 5) / 2, pz, 3.2, wallH + 5, 3.2);
    box(trim, px, wallH + 5.2, pz, 3.8, 0.5, 3.8);
    pinnacle(rf, px, wallH + 5.5, pz, 2.2, 8.5);
    box(mats.trimDark, px, wallH + 14.5, pz, 0.16, 2.2, 0.16);

    // Center gabled entrance vestibule (p.64).
    const vw = 12;
    const vd = 5.5;
    const vzc = nzc + nd / 2 + vd / 2;
    const vWall = 11.5;
    const vRise = 7.5;
    box(body, ncx, vWall / 2, vzc, vw, vWall, vd);
    box(mats.stone, ncx, 0.8, vzc, vw + 0.5, 1.6, vd + 0.5);
    gableFrontAt(vw, vd, vRise, vWall, rf, ncx, vzc);
    clapboardTriangle(body, vw, vRise * 0.96, vWall, "z", vzc + vd / 2 + 0.02, ncx, 0);
    gableCoping(trim, vw + 0.6, vRise * 0.96 + 0.25, vWall, vzc + vd / 2 + 0.22, ncx, 0.4);
    const MV = faceM(0, ncx, vzc + vd / 2);
    gothicWin(MV, 0, 1.4, 4.6, 5.4, { glass: mats.trimDark, surround: 0.45, mat: trim });
    paneledDoor(ncx - 1.0, vzc + vd / 2 + 0.12, 1.9, 6.2, false);
    paneledDoor(ncx + 1.0, vzc + vd / 2 + 0.12, 1.9, 6.2, false);
    box(mats.stone, ncx, 0.45, vzc + vd / 2 + 1.8, 6.4, 0.9, 3.4);

    // Small round louver/medallion high in the front nave gable above the vestibule (p.64).
    const MF = faceM(0, ncx, nzc + nd / 2);
    roseWin(MF, 0, 25.0, 1.15, { tube: 0.22, mat: trim, glass: mats.reveal });

    // Tall right-front corner tower with medallions, gabled open belfry, and spire (p.64).
    const tw = 11.5;
    const tx = W / 2 - tw / 2;
    const tz = nzc + nd / 2 - tw / 2 + 2.5;
    const th = 34;
    box(body, tx, th / 2, tz, tw, th, tw);
    box(mats.stone, tx, 0.9, tz, tw + 0.7, 1.8, tw + 0.7);
    for (const cx of [-tw / 2 + 0.5, tw / 2 - 0.5]) {
      for (const cz of [-tw / 2 + 0.5, tw / 2 - 0.5]) {
        box(trim, tx + cx, th / 2, tz + cz, 0.9, th, 0.9);
      }
    }
    for (const y of [15.5, 24.5, 32.8]) box(trim, tx, y, tz, tw + 0.8, 0.6, tw + 0.8);
    box(trim, tx, th + 0.35, tz, tw + 1.5, 0.7, tw + 1.5);
    const MTF = faceM(0, tx, tz + tw / 2);
    const MTR = faceM(Math.PI / 2, tx + tw / 2, tz);
    gothicWin(MTF, 0, 4.2, 2.8, 6.6, { surround: 0.45, mat: trim });
    gothicWin(MTR, 0, 4.2, 2.8, 6.6, { surround: 0.45, mat: trim });
    // Circular medallions on the upper shaft below the belfry (p.64).
    for (const M of towerFaces(tx, tz, tw / 2)) {
      roseWin(M, 0, 28.5, 1.35, { tube: 0.25, mat: trim, glass: mats.reveal });
    }
    // Open gabled belfry + tall slender spire.
    const bw = tw - 1.6;
    const bTop = th + 10.5;
    box(body, tx, (th + bTop) / 2 + 0.3, tz, bw, bTop - th - 0.6, bw);
    for (const M of towerFaces(tx, tz, bw / 2)) {
      gothicWin(M, 0, th + 1.6, 3.2, 4.6, { glass: mats.reveal, surround: 0.4, mat: trim, louvres: true });
      faceGable(M, body, trim, 0, bTop, bw, 5.4);
    }
    box(trim, tx, bTop + 0.15, tz, bw + 0.9, 0.45, bw + 0.9);
    const bCap = new THREE.ConeGeometry(bw * 0.72, 4.8, 4);
    bCap.rotateY(Math.PI / 4);
    bCap.translate(tx, bTop + 2.6, tz);
    bCap.applyMatrix4(buildingMatrix);
    put(rf, bCap);
    for (const px2 of [-1, 1]) for (const pz2 of [-1, 1]) {
      pinnacle(trim, tx + px2 * (bw / 2 - 0.3), bTop + 0.35, tz + pz2 * (bw / 2 - 0.3), 0.7, 2.6);
    }
    const spire = new THREE.ConeGeometry(bw * 0.56, 26, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(tx, bTop + 13.5, tz);
    spire.applyMatrix4(buildingMatrix);
    put(rf, spire);
    box(mats.trimDark, tx, bTop + 28.2, tz, 0.2, 4.0, 0.2);
    const ball = new THREE.SphereGeometry(0.45, 8, 6);
    ball.translate(tx, bTop + 27.6, tz);
    ball.applyMatrix4(buildingMatrix);
    put(trim, ball);

    // Four pointed lancet windows along both nave sides + rear chimney.
    const ML = faceM(-Math.PI / 2, ncx - nw / 2, nzc);
    const MR = faceM(Math.PI / 2, ncx + nw / 2, nzc);
    for (let i = 0; i < 4; i++) {
      const u = -nd * 0.32 + i * (nd * 0.2);
      gothicWin(ML, u, 4.8, 2.3, 6.2, { surround: 0.35, mat: trim });
      gothicWin(MR, -u, 4.8, 2.3, 6.2, { surround: 0.35, mat: trim });
    }
    chimneyStack(mats.brick.red, ncx, wallH + rise - 1, nzc - nd * 0.36, 2.2, 7.5, 2.2);
    return bTop + 30;
  };

  // Baptist Church, built 1866 on Crafford (PDF p.66-67): white clapboard gable-front
  // frame church on a dark raised basement, NO tower, large 3-light round-arched traceried
  // window left of center, single round-arched window far left, small hip-roofed entrance
  // vestibule on the right, 4 tall side windows, rear chimney.
  const addBaptistChurch = (b) => {
    const body = paintOf(b);
    const trim = mats.trim;
    const rf = mats.roofDark;
    const W = b.width;
    const D = b.depth;
    const fz = D / 2;
    const baseH = 2.2;
    const wallH = 17.5;
    const rise = 12.5;

    box(body, 0, wallH / 2 + baseH * 0.5, 0, W, wallH - baseH * 0.5, D);
    box(mats.brick.dark, 0, baseH / 2, 0, W + 0.5, baseH, D + 0.5);
    gableFrontAt(W, D, rise, wallH, rf, 0, 0);
    clapboardTriangle(body, W, rise * 0.96, wallH, "z", fz + 0.02, 0, 0);
    clapboardTriangle(body, W, rise * 0.96, wallH, "z", -fz - 0.02, 0, 0);
    // Raking cornice + classical cornice returns (p.67).
    {
      const half = W / 2 + 0.6;
      const r = rise * 0.96 + 0.35;
      const len = Math.hypot(half, r) + 0.3;
      const ang = Math.atan2(r, half);
      for (const sd of [-1, 1]) {
        const rk = new THREE.BoxGeometry(len, 0.55, 0.55);
        rk.rotateZ(-sd * ang);
        rk.translate((sd * half) / 2, wallH + r / 2 + 0.1, fz + 0.3);
        rk.applyMatrix4(buildingMatrix);
        put(trim, rk);
        box(trim, sd * (W / 2 - 1.2), wallH + 0.05, fz + 0.25, 3.2, 0.55, 0.7);
      }
    }
    const MF = faceM(0, 0, fz);
    // Basement lights under the main front windows.
    for (const bx of [-12.0, -5.0, 0.5]) {
      fbox(MF, mats.trimDark, bx, 1.15, 0.28, 2.0, 1.1, 0.1);
      fbox(MF, trim, bx, 1.15, 0.2, 2.4, 1.4, 0.16);
    }
    // Large 3-light round-arched traceried window slightly left of center + single round window far left.
    roundWin(MF, -2.0, 4.4, 7.6, 5.8, { lights: 3, circle: true, surround: 0.55, mat: trim });
    roundWin(MF, -12.0, 4.8, 2.7, 5.8, { surround: 0.4, mat: trim });

    // Small hip-roofed entrance vestibule on the right (p.67).
    const vx = 10.6;
    const vw = 7.6;
    const vd = 3.8;
    const vzc = fz + vd / 2;
    const vh = 10.2;
    box(body, vx, vh / 2, vzc, vw, vh, vd);
    box(mats.brick.dark, vx, baseH / 2, vzc, vw + 0.4, baseH, vd + 0.4);
    box(trim, vx, vh + 0.15, vzc, vw + 0.9, 0.45, vd + 0.9);
    trueHip(vw + 0.4, vd + 0.4, 2.4, vh + 0.35, rf, vx, vzc, 0.7);
    paneledDoor(vx - 1.25, fz + vd + 0.1, 2.3, 7.2, false);
    paneledDoor(vx + 1.25, fz + vd + 0.1, 2.3, 7.2, false);
    box(mats.stone, vx, 0.35, fz + vd + 1.8, vw * 0.85, 0.7, 3.4);

    // Four tall side windows + basement lights + rear chimney.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const z = -D * 0.34 + i * (D * 0.22);
        sideSash(side * (W / 2 + 0.08), 8.6, z, side, 2.5, 7.2, "flat", false, trim);
        box(mats.trimDark, side * (W / 2 + 0.28), 1.15, z, 0.1, 1.0, 2.0);
      }
    }
    chimneyStack(mats.brick.red, 0, wallH + rise - 1, -D * 0.38, 2.0, 6.5, 2.0);
    return wallH + rise + 2;
  };

  // American House, 1855 white frame hotel (PDF p.14 engraving):
  // Left 3-story gable-front block (AMERICAN HOUSE. painted between 2nd & 3rd floors),
  // right 2.5-story gable-front wing (2 chimneys, attic louver), continuous full-width
  // 1-story porch (9 posts, BILLIARD HALL on right fascia) supporting an open-sky
  // 2nd-story balcony with continuous turned balustrade.
  const addAmericanHouse = (b) => {
    const body = paintOf(b);
    const trim = mats.trim;
    const rf = mats.roofDark;
    const W = b.width;
    const D = b.depth;
    const fz = D / 2;

    // Left 3-story gable-front block (x: -28 .. -2, w = 26).
    const lw = 26;
    const lcx = -W / 2 + lw / 2;
    const lWall = 29;
    const lRise = 9.5;
    box(body, lcx, lWall / 2, 0, lw, lWall, D);
    box(mats.stone, lcx, 0.45, 0, lw + 0.4, 0.9, D + 0.4);
    gableFrontAt(lw, D, lRise, lWall, rf, lcx, 0);
    clapboardTriangle(body, lw, lRise * 0.96, lWall, "z", fz + 0.02, lcx, 0);
    clapboardTriangle(body, lw, lRise * 0.96, lWall, "z", -fz - 0.02, lcx, 0);
    gableCoping(trim, lw + 0.8, lRise * 0.96 + 0.3, lWall, fz + 0.25, lcx, 0.45);
    for (const x of [lcx - lw / 2, lcx + lw / 2]) box(trim, x, lWall / 2, fz + 0.1, 0.4, lWall, 0.28);
    // 3 bays on 2nd & 3rd floors with shutters (p.14); AMERICAN HOUSE. sits at y = 20.6.
    for (const x of [lcx - 7.5, lcx, lcx + 7.5]) {
      frontSash(x, 24.4, fz + 0.08, 2.5, 4.6, "flat", true);
      frontSash(x, 15.8, fz + 0.08, 2.5, 5.2, "flat", true);
    }
    // Ground floor under left porch: corner entry + tall multi-pane shop/parlor windows.
    paneledDoor(lcx - 9.8, fz + 0.1, 2.5, 7.6, false);
    for (const x of [lcx - 4.4, lcx + 1.0, lcx + 7.2]) {
      frontSash(x, 5.6, fz + 0.08, 3.4, 7.2, "flat", false);
    }
    chimneyStack(mats.brick.red, lcx + 2, lWall + lRise - 1, -D * 0.18, 2.0, 5.5, 2.0);

    // Right 2.5-story gable-front wing (x: -2 .. +28, w = 30, flush front at fz).
    const rw = W - lw;
    const rcx = lcx + lw / 2 + rw / 2;
    const rDepth = D - 4;
    const rzc = fz - rDepth / 2;
    const rWall = 19.5;
    const rRise = 10.5;
    box(body, rcx, rWall / 2, rzc, rw, rWall, rDepth);
    box(mats.stone, rcx, 0.45, rzc, rw + 0.4, 0.9, rDepth + 0.4);
    gableFrontAt(rw, rDepth, rRise, rWall, rf, rcx, rzc);
    clapboardTriangle(body, rw, rRise * 0.96, rWall, "z", fz + 0.02, rcx, 0);
    clapboardTriangle(body, rw, rRise * 0.96, rWall, "z", rzc - rDepth / 2 - 0.02, rcx, 0);
    gableCoping(trim, rw + 0.8, rRise * 0.96 + 0.3, rWall, fz + 0.25, rcx, 0.45);
    box(trim, rcx, rWall - 0.15, fz + 0.18, rw + 0.4, 0.45, 0.35);
    box(trim, rcx + rw / 2, rWall / 2, fz + 0.1, 0.4, rWall, 0.28);
    // Gable attic shuttered louver + two ridge chimneys (p.14).
    box(mats.trimDark, rcx, rWall + 4.2, fz + 0.14, 2.2, 4.4, 0.14);
    box(trim, rcx, rWall + 4.2, fz + 0.08, 2.8, 5.0, 0.12);
    chimneyStack(mats.brick.red, rcx - 3.5, rWall + rRise - 1, rzc - 8, 2.0, 5.5, 2.0);
    chimneyStack(mats.brick.red, rcx + 3.5, rWall + rRise - 1, rzc + 8, 2.0, 5.5, 2.0);
    // 2nd floor bays on right wing: alternating shuttered windows & balcony doors.
    for (let i = 0; i < 6; i++) {
      const x = rcx - rw / 2 + 2.8 + (i * (rw - 5.6)) / 5;
      if (i === 1 || i === 4) {
        box(trim, x, 14.6, fz + 0.08, 2.5, 6.6, 0.18);
        box(mats.trimDark, x, 14.6, fz + 0.16, 2.0, 6.1, 0.12);
        box(mats.glass, x, 15.6, fz + 0.22, 1.4, 2.6, 0.05);
      }
      else frontSash(x, 15.6, fz + 0.08, 2.1, 4.8, "flat", i !== 2);
    }
    // 1st floor billiard hall front under right porch.
    paneledDoor(rcx - 1.5, fz + 0.1, 2.6, 7.6, false);
    for (const x of [rcx - 10.0, rcx - 5.8, rcx + 4.2, rcx + 9.6]) {
      frontSash(x, 5.6, fz + 0.08, 3.2, 7.2, "flat", false);
    }

    // Side wall windows on left 3-story wall & right 2.5-story wall.
    for (const z of [-12, 8]) {
      sideSash(-W / 2 - 0.08, 15.8, z, -1, 2.2, 4.8, "flat", true);
      sideSash(-W / 2 - 0.08, 24.4, z, -1, 2.2, 4.4, "flat", true);
    }
    for (const z of [-6, 10]) {
      sideSash(W / 2 + 0.08, 6.2, z, 1, 2.2, 5.0, "flat", true);
      sideSash(W / 2 + 0.08, 15.6, z, 1, 2.2, 4.6, "flat", true);
    }

    // Continuous full-width 1st-story porch + open-sky 2nd-story balcony with balustrade.
    const pd = 7.2;
    const pzc = fz + pd / 2;
    const pfz = fz + pd;
    box(mats.plank, 0, 0.55, pzc, W + 1.2, 0.45, pd + 0.6);
    box(trim, 0, 10.6, pzc, W + 0.8, 1.1, pd + 0.4);
    box(mats.plank, 0, 11.2, pzc, W + 0.6, 0.25, pd + 0.2);
    // 9 slender porch posts across the 56-ft front.
    for (let i = 0; i < 9; i++) {
      const px = -W / 2 + 0.8 + ((W - 1.6) * i) / 8;
      box(trim, px, 5.5, pfz - 0.25, 0.45, 9.6, 0.45);
    }
    // 2nd-floor continuous turned balustrade across front + both ends.
    box(trim, 0, 14.0, pfz - 0.15, W + 0.6, 0.28, 0.34);
    box(trim, 0, 11.45, pfz - 0.15, W + 0.6, 0.24, 0.3);
    const balN = 54;
    for (let i = 0; i <= balN; i++) {
      const bx = -W / 2 + 0.4 + ((W - 0.8) * i) / balN;
      box(trim, bx, 12.75, pfz - 0.15, 0.22, 2.4, 0.22);
    }
    for (const sx of [-W / 2 + 0.15, W / 2 - 0.15]) {
      box(trim, sx, 14.0, pzc, 0.34, 0.28, pd);
      box(trim, sx, 11.45, pzc, 0.3, 0.24, pd);
      for (let i = 1; i < 7; i++) {
        box(trim, sx, 12.75, fz + (pd * i) / 7, 0.22, 2.4, 0.22);
      }
    }
    signFor(b, lWall);
    return lWall + lRise + 2;
  };

  // St. Bernard Catholic Church, brick, built 1906 and dedicated 15 May 1907; burned
  // 20 December 1951 (PDF p.59-60, photograph p.59): gable to the street, a square
  // corner tower with a louvered belfry and a tall spire, round-arched windows.
  const addStBernard1907 = (b) => {
    const body = brickOf(b);
    const wallH = 20;
    const rise = b.width * 0.42;
    const fz = b.depth / 2 + 0.12;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.7, 0, b.width + 0.6, 1.4, b.depth + 0.6);
    gableFrontAt(b.width, b.depth, rise, wallH, mats.roofDark, 0, 0);
    clapboardTriangle(body, b.width, rise * 0.96, wallH, "z", b.depth / 2 + 0.02, 0, 0);
    clapboardTriangle(body, b.width, rise * 0.96, wallH, "z", -b.depth / 2 - 0.02, 0, 0);
    gableCoping(mats.stone, b.width + 0.8, rise * 0.96 + 0.3, wallH, fz + 0.25, 0, 0.55);
    box(mats.stone, 0, wallH - 0.2, fz + 0.15, b.width + 0.4, 0.5, 0.4);
    // Brick buttresses at the corners of the nave front (p.59 photograph).
    box(body, b.width / 2 - 0.6, wallH * 0.45, fz + 0.6, 1.6, wallH * 0.9, 1.4);
    box(mats.stone, b.width / 2 - 0.6, wallH * 0.9, fz + 0.75, 1.8, 0.4, 1.7);
    // Round 3 (p.59): pointed Gothic windows with light surrounds, buttresses between the
    // side windows, and a cross gable over the middle of the side.
    const sb = b.facade?.palette ? mats.trim : mats.stone;
    frontSash(b.width * 0.12, 10, fz, 3.0, 9, "pointed", false, sb);
    frontSash(b.width * 0.36, 10, fz, 3.0, 9, "pointed", false, sb);
    frontSash(b.width * 0.22, wallH + rise * 0.35, fz, 2.2, 4, "pointed", false, sb);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const z = -b.depth * 0.36 + i * (b.depth * 0.22);
        sideSash(side * (b.width / 2 + 0.08), 10.5, z, side, 2.8, 9, "round", false, sb);
        // Pointed head over the round-headed side sash.
        box(sb, side * (b.width / 2 + 0.35), 15.6, z, 0.3, 0.9, 1.0);
      }
      for (let i = 0; i <= 4; i++) {
        const z = -b.depth * 0.47 + i * (b.depth * 0.22);
        box(body, side * (b.width / 2 + 0.55), wallH * 0.42, z, 1.1, wallH * 0.84, 1.4);
        box(mats.stone, side * (b.width / 2 + 0.6), wallH * 0.84, z, 1.3, 0.35, 1.6);
      }
    }
    if (b.facade?.crossGable) {
      const cg = b.facade.crossGable;
      const sd = cg.side || 1;
      const zc = cg.z ?? -b.depth * 0.03;
      const span = cg.span ?? 14;
      const cr = cg.rise ?? 7;
      const xf = sd * (b.width / 2 + 0.3);
      const pos = [xf, wallH, zc - span / 2, xf, wallH, zc + span / 2, xf, wallH + cr, zc];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute([sd, 0, 0, sd, 0, 0, sd, 0, 0], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, span / 4, 0, span / 8, cr / 3.2], 2));
      g.setIndex(sd > 0 ? [0, 2, 1] : [0, 1, 2]);
      g.applyMatrix4(buildingMatrix);
      put(body, g);
      const run = span / 2 + 0.8;
      const ang = Math.atan2(cr, span / 2);
      const sl = Math.hypot(run, cr * (run / (span / 2)));
      const reach = b.width / 2 + 0.6;
      for (const k of [-1, 1]) {
        const slab = new THREE.BoxGeometry(reach, 0.3, sl);
        slab.rotateX(k * ang);
        slab.translate(sd * reach / 2, wallH + cr / 2 + 0.2, zc + k * (span / 4 + 0.2));
        slab.applyMatrix4(buildingMatrix);
        put(mats.roofDark, slab);
        const rake = new THREE.BoxGeometry(0.3, 0.6, sl);
        rake.rotateX(k * ang);
        rake.translate(xf + sd * 0.3, wallH + cr / 2 + 0.1, zc + k * (span / 4 + 0.2));
        rake.applyMatrix4(buildingMatrix);
        put(mats.trim, rake);
      }
    }
    const tw = 12;
    const tx = -b.width / 2 + tw / 2 - 1;
    const tz = fz - tw / 2 + 2;
    const th = 50;
    box(body, tx, th / 2, tz, tw, th, tw);
    box(mats.stone, tx, 0.8, tz, tw + 0.6, 1.6, tw + 0.6);
    box(mats.trimDark, tx, 4.8, tz + tw / 2 + 0.06, 4.2, 8.6, 0.2);
    pointedHood(sb, tx, 9.1, tz + tw / 2 + 0.25, 4.8);
    frontSash(tx, 22, tz + tw / 2 + 0.02, 1.8, 5.2, "pointed", false, sb);
    // Two tall louvered openings a face (p.59).
    for (const face of [0, 1, 2, 3]) {
      const ang = (face * Math.PI) / 2;
      const ox = Math.sin(ang) * (tw / 2 + 0.06);
      const oz = Math.cos(ang) * (tw / 2 + 0.06);
      for (const k of [-1, 1]) {
        const ax = face % 2 ? 0 : k * 2.4;
        const az = face % 2 ? k * 2.4 : 0;
        box(mats.trim, tx + ox + ax, th - 6.5, tz + oz + az, face % 2 ? 0.2 : 3.6, 9, face % 2 ? 3.6 : 0.2);
        for (let q = 0; q < 7; q++) box(mats.trimDark, tx + ox * 1.01 + ax, th - 10.2 + q * 1.2, tz + oz * 1.01 + az, face % 2 ? 0.12 : 3.0, 0.22, face % 2 ? 3.0 : 0.12);
      }
    }
    box(mats.trim, tx, th + 0.3, tz, tw + 1, 0.6, tw + 1);
    // Tower crown: corbel band under the belfry cornice and corner pinnacles (p.59).
    box(mats.stone, tx, th - 12.2, tz, tw + 0.5, 0.5, tw + 0.5);
    box(body, tx, th - 0.9, tz, tw + 0.6, 1.0, tw + 0.6);
    for (const px of [-1, 1]) for (const pz of [-1, 1]) {
      pinnacle(mats.stone, tx + px * (tw / 2 - 0.3), th + 0.5, tz + pz * (tw / 2 - 0.3), 1.1, 4.2);
      box(body, tx + px * (tw / 2 + 0.2), (th - 12) / 2, tz + pz * (tw / 2 + 0.2), 1.3, th - 12, 1.3);
    }
    // Gablets over each belfry face, at the foot of the spire ("gabled belfry tops", p.59).
    clapboardTriangle(body, tw - 1.2, 4.2, th + 0.6, "z", tz + tw / 2 - 0.4, tx, 0);
    clapboardTriangle(body, tw - 1.2, 4.2, th + 0.6, "z", tz - tw / 2 + 0.4, tx, 0);
    for (const sd of [-1, 1]) {
      const pos = [tx + sd * (tw / 2 - 0.4), th + 0.6, tz - (tw - 1.2) / 2, tx + sd * (tw / 2 - 0.4), th + 0.6, tz + (tw - 1.2) / 2, tx + sd * (tw / 2 - 0.4), th + 4.8, tz];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute([sd, 0, 0, sd, 0, 0, sd, 0, 0], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2.7, 0, 1.35, 1.3], 2));
      g.setIndex(sd > 0 ? [0, 2, 1] : [0, 1, 2]);
      g.applyMatrix4(buildingMatrix);
      put(body, g);
    }
    for (const sd of [-1, 1]) {
      gableCoping(mats.trim, tw - 0.6, 4.4, th + 0.6, tz + sd * (tw / 2 - 0.2), tx, 0.35);
    }
    const spire = new THREE.ConeGeometry(tw * 0.62, 28, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(tx, th + 14.4, tz);
    spire.applyMatrix4(buildingMatrix);
    put(mats.roofDark, spire);
    box(mats.trimDark, tx, th + 30, tz, 0.24, 3.4, 0.24);
    box(mats.trimDark, tx, th + 30.6, tz, 1.6, 0.24, 0.24);
    if (b.facade?.palette) {
      // White rake boards on the nave gable, as the photograph shows.
      gableCoping(mats.trim, b.width + 1.0, rise * 0.96 + 0.35, wallH, fz + 0.45, 0, 0.45);
    }
    signFor(b, 15);
    return th + 32;
  };

  // St. Bernard Church completed in 1953 after the 1951 fire (PDF p.59; photograph p.61):
  // brick, gable to the street, a cross on the peak, a tall round-arched window over the
  // door, no tower.
  const addStBernard1953 = (b) => {
    const body = brickOf(b);
    const wallH = 18;
    const rise = b.width * 0.4;
    const fz = b.depth / 2 + 0.12;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.6, 0, b.width + 0.5, 1.2, b.depth + 0.5);
    gableFrontAt(b.width, b.depth, rise, wallH, mats.roofDark, 0, 0);
    clapboardTriangle(body, b.width, rise * 0.96, wallH, "z", b.depth / 2 + 0.02, 0, 0);
    clapboardTriangle(body, b.width, rise * 0.96, wallH, "z", -b.depth / 2 - 0.02, 0, 0);
    // Round 3 (p.61): a wide pointed tracery window over a broad light stone door surround.
    box(mats.stone, 0, 5.4, fz + 0.05, 9.0, 10.8, 0.25);
    frontSash(0, wallH * 0.98, fz + 0.2, 6.4, 10.5, "pointed", false, mats.stone);
    for (const dx of [-1.6, 0, 1.6]) box(mats.stone, dx, wallH * 0.98, fz + 0.75, 0.22, 10.0, 0.12);
    gableCoping(mats.stone, b.width + 0.8, rise * 0.96 + 0.3, wallH, fz + 0.25, 0, 0.6);
    paneledDoor(0, fz + 0.3, 6.2, 8.4, false);
    box(mats.stone, 0, 9.4, fz + 0.9, 9.4, 0.5, 1.6);
    frontSash(-b.width * 0.32, 8.5, fz, 2.2, 5, "round", false, mats.stone);
    frontSash(b.width * 0.32, 8.5, fz, 2.2, 5, "round", false, mats.stone);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const z = -b.depth * 0.38 + i * (b.depth * 0.18);
        sideSash(side * (b.width / 2 + 0.08), 9.5, z, side, 2.6, 7.6, "round", false, mats.stone);
      }
    }
    box(mats.stone, 0, wallH + rise + 2.4, fz - 0.6, 0.45, 4.4, 0.45);
    box(mats.stone, 0, wallH + rise + 3.2, fz - 0.6, 2.4, 0.45, 0.45);
    // Bare tree at the right front of the church (p.61).
    const tr = new THREE.Vector3(b.width / 2 + 6, 0, fz + 9).applyMatrix4(buildingMatrix);
    extraTrees.push({ x: tr.x, z: tr.z, kind: "elm", scale: 1.7 });
    signFor(b, 14);
    return wallH + rise + 6;
  };

  // New fire house at Hurst and Dean, built in the two years before the 1954 book
  // (PDF p.124-125, photograph p.124; corner from p.20): one story, flat roof, a row of
  // overhead doors with a band of lights, brick end wall. Footprint is an estimate.
  const addFireHouse1953 = (b) => {
    const body = brickOf(b);
    const wall = 16;
    const fz = b.depth / 2 + 0.12;
    box(body, 0, wall / 2, 0, b.width, wall, b.depth);
    box(mats.siding.white, -b.width * 0.12, wall / 2, fz - 0.02, b.width * 0.76, wall, 0.2);
    box(mats.stone, 0, wall + 0.3, 0, b.width + 0.5, 0.6, b.depth + 0.5);
    const doors = Math.max(3, b.facade?.doors || 5);
    const span = b.width * 0.72;
    for (let i = 0; i < doors; i++) {
      const x = -b.width * 0.12 - span / 2 + (span * (i + 0.5)) / doors;
      const dw = span / doors - 1.4;
      box(mats.trim, x, 5.6, fz + 0.08, dw + 0.4, 11.2, 0.12);
      box(mats.siding.white, x, 5.6, fz + 0.14, dw, 10.8, 0.08);
      // Two rows of six lights in each door, as in the p.124 photograph.
      for (let r = 0; r < 2; r++) {
        for (let k = 0; k < 6; k++) box(mats.glass, x - dw / 2 + ((k + 0.5) * dw) / 6, 7.1 + r * 1.5, fz + 0.2, dw / 6 - 0.3, 1.15, 0.05);
      }
      for (let k = 1; k < 5; k++) box(mats.trimDark, x, 0.4 + k * 2.2, fz + 0.2, dw, 0.07, 0.04);
    }
    // White fascia band over the doors.
    box(mats.siding.white, -b.width * 0.12, wall - 1.6, fz + 0.5, b.width * 0.78, 3.2, 1.0);
    signFor(b, wall);
    return wall + 2;
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

  // 771 North Crafford, the 2010 photograph: left front gable, two porches, hedge.
  const addFuneralHome = (b) => {
    const wallH = 24;
    const makeBrick = (mortar, shades) => {
      const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 });
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      const g = canvas.getContext("2d");
      g.fillStyle = mortar;
      g.fillRect(0, 0, 128, 64);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 32 : 0;
        for (let col = -1; col < 5; col++) {
          g.fillStyle = shades[(row + col + 8) % shades.length];
          g.fillRect(col * 32 + off + 1, row * 16 + 1, 30, 14);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      mat.map = tex;
      mat.userData.uvFeet = { u: 4, v: 2 };
      return mat;
    };
    const body = makeBrick("#8a6a58", ["#6E3228", "#75362C", "#693028", "#72342A", "#6A2E26"]);
    const white = new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.64 });
    const roof = new THREE.MeshStandardMaterial({ color: "#B0B4A4", roughness: 0.9 });
    const siding = new THREE.MeshStandardMaterial({ color: "#ece8de", roughness: 0.78 });
    {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 128;
      const g = canvas.getContext("2d");
      g.fillStyle = "#ece8de";
      g.fillRect(0, 0, 64, 128);
      g.fillStyle = "#d4d0c6";
      for (let y = 0; y < 128; y += 8) g.fillRect(0, y + 6, 64, 1.4);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      siding.map = tex;
      siding.userData.uvFeet = { u: 6, v: 3.2 };
    }
    const gableFace = new THREE.MeshStandardMaterial({ color: "#c8c2b0", roughness: 0.86 });
    const iron = new THREE.MeshStandardMaterial({ color: "#2a2a28", roughness: 0.55, metalness: 0.35 });
    const fz = b.depth / 2;
    const gx = -b.width * 0.28;
    const gw = 18;
    const proj = 7.5;
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 1.0, 0, b.width + 0.55, 2.0, b.depth + 0.55);
    box(body, gx, wallH / 2, fz + proj / 2, gw, wallH, proj);
    // Projecting white cornice with a dense row of brackets, wrapping the house.
    box(white, 0, wallH + 0.45, 0, b.width + 3.2, 0.85, b.depth + 3.2);
    box(white, gx, wallH + 0.45, fz + proj / 2, gw + 2.6, 0.85, proj + 2.4);
    box(white, 0, wallH + 0.95, 0, b.width + 2.4, 0.28, b.depth + 2.4);
    const corniceBrackets = (cx, cz, width, depth, alongZ) => {
      const n = Math.max(5, Math.round(width / 2.15));
      for (let i = 0; i < n; i++) {
        const x = cx - width / 2 + 1.0 + ((width - 2.0) * i) / Math.max(1, n - 1);
        if (alongZ) {
          box(white, x, wallH - 0.55, cz, 0.32, 1.15, 0.85);
          box(white, x, wallH - 0.05, cz + 0.15, 0.32, 0.28, 1.15);
        }
      }
    };
    corniceBrackets(0, fz + 1.55, b.width + 0.8, 0, true);
    corniceBrackets(gx, fz + proj + 1.35, gw + 0.8, 0, true);
    hipRoof(b.width + 0.8, b.depth + 0.8, 6.4, wallH + 1.15, roof, 0, 0);
    // Front gable over the left bay: larger, gray face, two arched windows, two peak brackets.
    const rise = 11.2;
    const y0 = wallH + 0.7;
    const faceZ = fz + proj + 0.35;
    clapboardTriangle(gableFace, gw + 2.4, rise, y0, "z", faceZ - 0.15, gx, faceZ - 0.15);
    const run = (gw + 2.0) / 2;
    const slopeLen = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run);
    for (const sign of [-1, 1]) {
      const plane = new THREE.BoxGeometry(slopeLen, 0.32, proj + 2.6);
      plane.translate(0, 0, -(proj + 2.6) / 2);
      plane.rotateZ(-sign * angle);
      plane.translate(gx + sign * run * 0.48, y0 + rise * 0.28, faceZ - 0.55);
      plane.applyMatrix4(buildingMatrix);
      put(roof, plane);
      const rake = new THREE.BoxGeometry(slopeLen + 0.4, 0.38, 0.42);
      rake.rotateZ(-sign * angle);
      rake.translate(gx + sign * run * 0.46, y0 + rise * 0.32, faceZ + 0.22);
      rake.applyMatrix4(buildingMatrix);
      put(white, rake);
    }
    // Two large white brackets under the gable peak.
    for (const dx of [-1.55, 1.55]) {
      box(white, gx + dx, y0 + rise * 0.42, faceZ + 0.05, 0.55, 1.85, 0.95);
      box(white, gx + dx, y0 + rise * 0.58, faceZ + 0.2, 0.55, 0.4, 1.35);
    }
    frontSash(gx - 1.85, y0 + rise * 0.36, faceZ + 0.2, 2.55, 5.2, "round", false, white);
    frontSash(gx + 1.85, y0 + rise * 0.36, faceZ + 0.2, 2.55, 5.2, "round", false, white);
    const pair = (x, y, z, w, h) => {
      frontSash(x - w * 0.28, y, z, w * 0.42, h, "flat", false, white);
      frontSash(x + w * 0.28, y, z, w * 0.42, h, "flat", false, white);
    };
    pair(gx, 17.2, faceZ - 0.2, 8.0, 5.8);
    pair(gx, 7.15, faceZ - 0.2, 8.0, 5.6);
    pair(4.2, 17.3, fz + 0.18, 7.8, 5.8);
    pair(b.width * 0.34, 17.3, fz + 0.18, 7.0, 5.8);
    pair(4.2, 7.2, fz + 0.18, 7.8, 5.6);
    frontSash(b.width * 0.34, 7.2, fz + 0.18, 2.8, 5.6, "flat", false, white);

    // Left side of the house extends a little past the gable, so the building reads wider.
    const leftExt = 5.5;
    box(body, -b.width / 2 - leftExt / 2, wallH / 2, 0, leftExt, wallH, b.depth);
    box(mats.stone, -b.width / 2 - leftExt / 2, 1.0, 0, leftExt + 0.55, 2.0, b.depth + 0.55);
    box(white, -b.width / 2 - leftExt / 2, wallH + 0.45, 0, leftExt + 3.2, 0.85, b.depth + 3.2);
    box(white, -b.width / 2 - leftExt / 2, wallH + 0.95, 0, leftExt + 2.4, 0.28, b.depth + 2.4);
    corniceBrackets(-b.width / 2 - leftExt / 2, fz + 1.55, leftExt + 0.8, 0, true);
    // Left porch: a wide, shallow white pediment on white columns, as asked from the photograph.
    const porchD = 9.0;
    const porchW = 20.5;
    const porchFrontZ = fz + proj + porchD;
    const porchZ = fz + proj + porchD / 2;
    const porchCx = gx - 2.4;
    box(mats.plank, porchCx, 1.0, porchZ, porchW - 0.4, 0.32, porchD - 0.3);
    // One-story white clapboard sunroom under the porch, set back so the columns stand in front.
    box(siding, porchCx - 0.6, 5.15, fz + proj + 0.8, porchW - 1.0, 8.5, 3.0);
    const blinds = new THREE.MeshStandardMaterial({ color: "#6a6860", roughness: 0.8 });
    box(white, porchCx - 5.2, 5.5, fz + proj + 2.25, 3.0, 4.4, 0.18);
    box(blinds, porchCx - 5.2, 5.5, fz + proj + 2.38, 2.5, 3.9, 0.06);
    for (let k = 0; k < 9; k++) {
      box(white, porchCx - 5.2, 3.9 + k * 0.38, fz + proj + 2.42, 2.5, 0.05, 0.04);
    }
    const pRise = 3.05;
    const pY0 = 9.95;
    const porchRoofMat = new THREE.MeshStandardMaterial({ color: "#d0ccc0", roughness: 0.88 });
    const soffitDark = new THREE.MeshStandardMaterial({ color: "#b4ae9e", roughness: 0.84 });
    // Wide, shallow entablature and a flat triangular pediment facing the street.
    box(white, porchCx, pY0 + 0.18, porchZ, porchW + 3.6, 0.5, porchD + 2.0);
    box(white, porchCx, pY0 + 0.52, porchFrontZ + 0.2, porchW + 3.0, 0.32, 1.2);
    clapboardTriangle(white, porchW + 3.8, pRise, pY0 + 0.35, "z", porchFrontZ + 0.75, porchCx, porchFrontZ + 0.75);
    const pRun = (porchW + 3.2) / 2;
    const pLen = Math.hypot(pRun, pRise);
    const pAng = Math.atan2(pRise, pRun);
    for (const sign of [-1, 1]) {
      const plane = new THREE.BoxGeometry(pLen, 0.3, porchD + 1.2);
      plane.translate(0, 0, -(porchD + 1.2) / 2);
      plane.rotateZ(-sign * pAng);
      plane.translate(porchCx + sign * pRun * 0.48, pY0 + 0.35 + pRise * 0.28, porchFrontZ);
      plane.applyMatrix4(buildingMatrix);
      put(porchRoofMat, plane);
      const under = new THREE.BoxGeometry(pLen, 0.08, porchD + 1.1);
      under.translate(0, -0.16, -(porchD + 1.1) / 2);
      under.rotateZ(-sign * pAng);
      under.translate(porchCx + sign * pRun * 0.48, pY0 + 0.35 + pRise * 0.28, porchFrontZ);
      under.applyMatrix4(buildingMatrix);
      put(soffitDark, under);
      const rake = new THREE.BoxGeometry(pLen + 0.4, 0.42, 0.44);
      rake.rotateZ(-sign * pAng);
      rake.translate(porchCx + sign * pRun * 0.48, pY0 + 0.35 + pRise * 0.32, porchFrontZ + 0.82);
      rake.applyMatrix4(buildingMatrix);
      put(white, rake);
    }
    // White columns with molded bases and capitals, on their own material so they merge cleanly.
    const colWhite = white.clone();
    const colAt = (x, z) => {
      const shaft = new THREE.CylinderGeometry(0.52, 0.6, 8.05, 16);
      shaft.translate(x, 5.15, z);
      shaft.applyMatrix4(buildingMatrix);
      put(colWhite, shaft);
      box(white, x, 9.35, z, 1.85, 0.48, 1.85);
      box(white, x, 9.72, z, 1.55, 0.28, 1.55);
      box(white, x, 1.15, z, 1.75, 0.42, 1.75);
    };
    colAt(porchCx - porchW / 2 + 2.15, porchFrontZ - 0.3);
    colAt(porchCx + porchW / 2 - 2.15, porchFrontZ - 0.3);
    // Right porch still uses square brick piers; keep a brick pier helper for it.
    const pierAt = (x, z) => {
      box(body, x, 5.05, z, 2.05, 7.8, 2.05);
      box(white, x, 9.05, z, 2.75, 0.62, 2.75);
      box(white, x, 9.48, z, 2.35, 0.32, 2.35);
      box(white, x, 1.15, z, 2.4, 0.42, 2.4);
    };

    // Right porch: square brick piers, a wide white roof, steps with a black iron rail.
    const rx = b.width * 0.32;
    const rw = 13.5;
    const rd = 8.2;
    box(mats.plank, rx, 0.95, fz + rd / 2, rw - 0.3, 0.3, rd - 0.25);
    box(white, rx, 9.15, fz + rd / 2, rw + 1.8, 0.28, rd + 1.4);
    box(white, rx, 9.45, fz + rd / 2, rw + 0.9, 0.2, rd + 0.5);
    for (let i = 0; i < 5; i++) {
      const bx = rx - rw / 2 + 1.6 + ((rw - 3.2) * i) / 4;
      box(white, bx, 8.55, fz + rd + 0.15, 0.28, 0.85, 0.7);
    }
    pierAt(rx - rw / 2 + 1.55, fz + rd - 0.5);
    pierAt(rx + rw / 2 - 1.55, fz + rd - 0.5);
    for (let i = 0; i < 4; i++) {
      box(mats.stone, rx + rw / 2 - 0.2, 0.28 + i * 0.42, fz + rd + 2.4 - i * 0.85, 5.4, 0.36, 1.0);
    }
    // Black iron stair rail, visible at the outer end of the right porch.
    const railX = rx + rw / 2 + 1.6;
    box(iron, railX, 2.6, fz + rd + 1.1, 0.1, 4.4, 0.1);
    box(iron, railX - 1.5, 1.8, fz + rd + 0.2, 0.1, 3.2, 0.1);
    box(iron, railX - 0.75, 3.55, fz + rd + 0.65, 0.08, 0.08, 2.4);
    for (let i = 0; i < 5; i++) {
      box(iron, railX - 0.3 * i, 2.2 + i * 0.15, fz + rd + 0.4 + i * 0.35, 0.07, 2.0, 0.07);
    }

    const lawn = new THREE.MeshStandardMaterial({ color: "#6a8f48", roughness: 0.96 });
    box(lawn, 0, 0.1, fz + 16, 80, 0.16, 32);
    const hedgeMat = mats.leaf.clone();
    hedgeMat.color.set("#3d6a32");
    const hedgeLit = mats.leaf.clone();
    hedgeLit.color.set("#4a7a38");
    const hedgeDark = mats.leafDark.clone();
    hedgeDark.color.set("#2e5428");
    // Long continuous foreground hedge across the whole lower-left, as in the photograph.
    // Ends before the red shrub and the right porch. Low enough that the white columns show.
    const hedgeZ = porchFrontZ + 7.2;
    const hedgeLen = 54;
    const hedgeX0 = porchCx - 22;
    const hedgeMats = [hedgeMat, hedgeLit, hedgeDark];
    for (let row = 0; row < 3; row++) {
      const n = 78 - row * 8;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const x = hedgeX0 + u * hedgeLen;
        const z = hedgeZ + (row - 1) * 1.15 + ((i % 3) - 1) * 0.28;
        const y = 1.55 + ((i * 11 + row * 5) % 7) * 0.14;
        const r = 1.4 + (i % 5) * 0.12 + row * 0.06;
        const top = new THREE.SphereGeometry(r, 10, 8);
        top.translate(x, y + r * 0.28, z);
        top.applyMatrix4(buildingMatrix);
        put(hedgeMats[(i + row) % 3], top);
      }
    }
    for (let i = 0; i < 50; i++) {
      const x = hedgeX0 + 0.4 + (i / 49) * (hedgeLen - 0.8);
      const ball = new THREE.SphereGeometry(1.25 + (i % 3) * 0.1, 10, 8);
      ball.translate(x, 1.2, hedgeZ + ((i % 3) - 1) * 0.4);
      ball.applyMatrix4(buildingMatrix);
      put(hedgeMats[(i + 1) % 3], ball);
    }
    // Overhead draping canopy: fills the upper right of the frame and hangs over the right roof.
    // No exposed trunk — the tree sits to the right, and we are under its edge.
    const leaf = mats.leaf.clone();
    leaf.color.set("#4a8a32");
    const leafMid = mats.leaf.clone();
    leafMid.color.set("#6a9a3c");
    const leafLit = mats.leaf.clone();
    leafLit.color.set("#8aaa48");
    const leafDk = mats.leafDark.clone();
    leafDk.color.set("#2e5e28");
    const leafSpr = mats.leaf.clone();
    leafSpr.color.set("#5a8a30");
    const leafMats = [leaf, leafMid, leafLit, leafDk, leafSpr];
    let seed = 771;
    const rnd = () => {
      seed = (seed * 16807 + 31) % 2147483647;
      return seed / 2147483647;
    };
    const putLeaf = (x, y, z, r, k) => {
      const ball = new THREE.SphereGeometry(r, 10, 8);
      ball.translate(x, y, z);
      ball.applyMatrix4(buildingMatrix);
      put(leafMats[k % leafMats.length], ball);
    };
    // Bigger main canopy over and to the right of the house.
    for (let i = 0; i < 120; i++) {
      const a = rnd() * Math.PI * 2;
      const b = (rnd() - 0.05) * Math.PI * 0.6;
      const rad = 0.2 + rnd() * 0.9;
      const x = 18 + Math.cos(a) * Math.cos(b) * 24 * rad;
      const y = 22 + Math.sin(b) * 16 * rad;
      const z = fz + 16 + Math.sin(a) * Math.cos(b) * 16 * rad;
      putLeaf(x, y, z, 1.8 + rnd() * 2.0, i);
    }
    // Branches reaching left, over the right roof and toward the gable.
    for (let i = 0; i < 48; i++) {
      const x = 2 + rnd() * 18;
      const y = 22 + rnd() * 14;
      const z = fz + 4 + rnd() * 16;
      putLeaf(x, y, z, 1.7 + rnd() * 1.7, i);
    }
    // Large foreground overhead mass that fills the upper-right of the frame, as in the photograph.
    for (let i = 0; i < 90; i++) {
      const x = 16 + rnd() * 28;
      const y = 18 + rnd() * 22;
      const z = porchFrontZ + 4 + rnd() * 24;
      putLeaf(x, y, z, 2.1 + rnd() * 2.2, i);
    }
    // Mid-height clumps on the right hide the trunk, leaving a gap in front of the right porch.
    for (let i = 0; i < 14; i++) {
      putLeaf(24 + rnd() * 10, 10 + rnd() * 12, fz + 8 + rnd() * 6, 2.2 + rnd() * 1.3, i);
    }
    // Extra mass in the very top-right corner of the frame.
    for (let i = 0; i < 28; i++) {
      putLeaf(22 + rnd() * 20, 28 + rnd() * 14, porchFrontZ + 10 + rnd() * 18, 2.2 + rnd() * 2.0, i);
    }
    // Reddish ornamental shrub in front of the right porch, from the photograph.
    const redLeaf = mats.leaf.clone();
    redLeaf.color.set("#9a3020");
    const redLeaf2 = mats.leaf.clone();
    redLeaf2.color.set("#7a2418");
    const redLeaf3 = mats.leaf.clone();
    redLeaf3.color.set("#b04028");
    const redZ = fz + rd + 6.8;
    for (const [dx, dy, dz, r, mat] of [
      [0, 4.2, 0.4, 2.55, redLeaf],
      [-1.7, 3.6, 1.0, 1.9, redLeaf2],
      [1.6, 3.7, 0.9, 1.85, redLeaf3],
      [0.2, 5.8, 0.0, 1.7, redLeaf],
      [-1.1, 5.0, -0.3, 1.55, redLeaf3],
      [1.0, 2.8, 1.3, 1.5, redLeaf2],
      [-0.5, 3.2, 1.6, 1.45, redLeaf],
    ]) {
      const ball = new THREE.SphereGeometry(r, 12, 10);
      ball.translate(rx - 0.6 + dx, dy, redZ + dz);
      ball.applyMatrix4(buildingMatrix);
      put(mat, ball);
    }
    chimneyStack(body, b.width * 0.12, wallH + 7.2, -b.depth * 0.08, 1.8, 6.5, 1.8);
    return wallH + 18;
  };


  const pioneerGlass = mats.glass.clone();
  pioneerGlass.color.set("#28333b");
  pioneerGlass.envMapIntensity = 0.4;
  pioneerGlass.roughness = 0.35;

  const pioneerSashFront = (x, y, z, w, h) => {
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
    box(pioneerGlass, x, y + up, glassZ, paneW, paneH, 0.035);
    box(pioneerGlass, x, y - up, glassZ, paneW, paneH, 0.035);
    box(mats.trim, x - w / 2, y, frameZ, stile, h + stile, frameD);
    box(mats.trim, x + w / 2, y, frameZ, stile, h + stile, frameD);
    box(mats.trim, x, y + h / 2, frameZ, w + stile, stile, frameD);
    box(mats.trim, x, y - h / 2, frameZ, w + stile, stile * 0.8, frameD);
    box(mats.trim, x, y, glassZ + 0.08, w - stile, meet, 0.1);
    for (const yy of [y + up, y - up]) {
      box(mats.trim, x - w * 0.16, yy, glassZ + 0.06, 0.04, paneH * 0.92, 0.05);
      box(mats.trim, x + w * 0.16, yy, glassZ + 0.06, 0.04, paneH * 0.92, 0.05);
      box(mats.trim, x, yy, glassZ + 0.06, paneW * 0.94, 0.04, 0.05);
    }
    box(mats.trim, x, y - h / 2 - 0.12, outerZ + 0.06, w + 0.55, 0.13, 0.5);
    box(mats.trim, x, y + h / 2 + 0.16, outerZ, w + 0.42, 0.14, 0.34);
  };

  const pioneerSashSide = (x, y, z, out, w, h) => {
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
    box(pioneerGlass, glassX, y + up, z, 0.035, paneH, paneW);
    box(pioneerGlass, glassX, y - up, z, 0.035, paneH, paneW);
    box(mats.trim, frameX, y, z - w / 2, frameD, h, stile);
    box(mats.trim, frameX, y, z + w / 2, frameD, h, stile);
    box(mats.trim, frameX, y + h / 2, z, frameD, stile, w);
    box(mats.trim, frameX, y - h / 2, z, frameD, stile * 0.8, w);
    box(mats.trim, glassX + out * 0.07, y, z, 0.08, meet, w - stile);
    for (const yy of [y + up, y - up]) {
      box(mats.trim, glassX + out * 0.06, yy, z - w * 0.16, 0.04, paneH * 0.9, 0.04);
      box(mats.trim, glassX + out * 0.06, yy, z + w * 0.16, 0.04, paneH * 0.9, 0.04);
      box(mats.trim, glassX + out * 0.06, yy, z, 0.04, 0.04, paneW * 0.92);
    }
    box(mats.trim, x + out * (outer + 0.04), y - h / 2 - 0.1, z, 0.42, 0.12, w + 0.4);
    box(mats.trim, x + out * outer, y + h / 2 + 0.12, z, 0.28, 0.12, w + 0.36);
  };

  // Correct-winding gable infill wall (overlaps slightly into the wall top to prevent any seam gap).
  const pioneerGableWall = (mat, span, rise, yBase, along, at, cx, cz) => {
    const overlap = 0.15;
    const yb = yBase - overlap;
    const r = rise + overlap;
    const thick = 0.42;
    const feet = mat?.userData?.uvFeet || { u: 8, v: 3.2 };
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const push = (x, y, z, nx, ny, nz) => {
      positions.push(x, y, z);
      normals.push(nx, ny, nz);
      const u = (along === "z" ? x - cx + span / 2 : z - cz + span / 2) / feet.u;
      uvs.push(u, (y - yb) / feet.v);
      return positions.length / 3 - 1;
    };
    const tri = (a, b, c) => indices.push(a, b, c);
    if (along === "z") {
      const zf = at + thick / 2;
      const zb = at - thick / 2;
      const x0 = cx - span / 2;
      const x1 = cx + span / 2;
      const fl = push(x0, yb, zf, 0, 0, 1);
      const fr = push(x1, yb, zf, 0, 0, 1);
      const fp = push(cx, yb + r, zf, 0, 0, 1);
      tri(fl, fr, fp);
      const bl = push(x0, yb, zb, 0, 0, -1);
      const bp = push(cx, yb + r, zb, 0, 0, -1);
      const br = push(x1, yb, zb, 0, 0, -1);
      tri(bl, bp, br);
    } else {
      const xf = at + thick / 2;
      const xb = at - thick / 2;
      const z0 = cz - span / 2;
      const z1 = cz + span / 2;
      const fl = push(xf, yb, z0, 1, 0, 0);
      const fr = push(xf, yb, z1, 1, 0, 0);
      const fp = push(xf, yb + r, cz, 1, 0, 0);
      tri(fl, fp, fr);
      const bl = push(xb, yb, z0, -1, 0, 0);
      const bp = push(xb, yb + r, cz, -1, 0, 0);
      const br = push(xb, yb, z1, -1, 0, 0);
      tri(bl, br, bp);
    }
    const face = new THREE.BufferGeometry();
    face.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    face.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    face.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    face.setIndex(indices);
    face.applyMatrix4(buildingMatrix);
    put(mat, face);
  };

  const pioneerStoop = (x, z, w = 4.4, d = 2.8) => {
    box(mats.plank, x, 0.28, z + d / 2, w, 0.45, d);
    box(mats.trimDark, x, 0.14, z + d + 0.4, w * 0.9, 0.24, 0.8);
  };

  const pioneerShedPorch = (x, z, span, depth = 4.2) => {
    const top = 7.95;
    box(mats.plank, x, 0.26, z + depth / 2, span, 0.36, depth);
    localBox(mats.roof, x, top, z + depth / 2 + 0.15, span + 0.6, 0.16, depth + 0.6, 0.22);
    const n = span >= 17 ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const px = x - span / 2 + 0.45 + ((span - 0.9) * i) / (n - 1);
      box(mats.trimDark, px, (top - 0.4) / 2 + 0.2, z + depth - 0.3, 0.24, top - 0.7, 0.24);
    }
  };

  const pioneerSplitRailFence = (span, frontZ) => {
    const zf = frontZ + 6.5;
    const gap = 3.2;
    for (const side of [-1, 1]) {
      const xStart = side * gap;
      const xEnd = side * (span / 2 + 3.5);
      const len = Math.abs(xEnd - xStart);
      if (len < 3) continue;
      const mid = (xStart + xEnd) / 2;
      const posts = Math.max(2, Math.round(len / 7) + 1);
      for (let i = 0; i < posts; i++) {
        const px = xStart + ((xEnd - xStart) * i) / (posts - 1);
        box(mats.trimDark, px, 1.3, zf, 0.24, 2.6, 0.24);
      }
      box(mats.trimDark, mid, 1.9, zf, len, 0.14, 0.12);
      box(mats.trimDark, mid, 1.0, zf, len, 0.14, 0.12);
    }
  };

  const addPioneerHouse = (b) => {
    const h = idHash(b.id);
    const plan = b.plan || "side-gable";
    const stories = Number(b.stories) || 1;
    const isTwo = stories >= 1.95;
    const isHalf = !isTwo && stories >= 1.4;
    const plate = isTwo ? 17.4 : isHalf ? 11.4 : 8.8;
    const body = paintOf(b);
    const roofMat = h % 3 === 0 ? mats.roofDark : mats.roof;
    const cornerMat = b.paint === "weathered" ? mats.trimDark : mats.trim;
    const winW = 1.9;
    const winH = 3.75;
    const y1 = 4.65;

    if (plan === "gable-ell") {
      const uw = Math.max(12.5, b.width * 0.54);
      const ud = b.depth;
      const side = h % 2 === 0 ? -1 : 1;
      const ux = side * (b.width - uw) / 2;
      const uPlate = isTwo ? 17.2 : 11.6;
      const uRise = Math.max(6.4, uw * 0.48);

      const ew = b.width - uw + 0.5;
      const ed = Math.max(12.5, b.depth * 0.64);
      const ex = -side * (b.width - ew) / 2;
      const ez = b.depth / 2 - 2.4 - ed / 2;
      const ePlate = 8.8;
      const eRise = Math.max(5.8, ed * 0.46);

      box(mats.stone, ux, 0.28, 0, uw + 0.2, 0.56, ud + 0.2);
      box(body, ux, uPlate / 2 + 0.35, 0, uw, uPlate, ud);
      gableFrontAt(uw, ud, uRise, uPlate + 0.35, roofMat, ux, 0);
      pioneerGableWall(body, uw, uRise * 0.92, uPlate + 0.35, "z", ud / 2 - 0.18, ux, 0);
      pioneerGableWall(body, uw, uRise * 0.92, uPlate + 0.35, "z", -ud / 2 + 0.18, ux, 0);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          box(cornerMat, ux + sx * (uw / 2 - 0.14), uPlate / 2 + 0.35, sz * (ud / 2 - 0.14), 0.34, uPlate, 0.34);
        }
      }

      const eFrontZ = ez + ed / 2;
      box(mats.stone, ex, 0.28, ez, ew + 0.2, 0.56, ed + 0.2);
      box(body, ex, ePlate / 2 + 0.35, ez, ew, ePlate, ed);
      gableAt(ew, ed, eRise, ePlate + 0.35, roofMat, ex, ez);
      pioneerGableWall(body, ed, eRise * 0.92, ePlate + 0.35, "x", ex - side * (ew / 2 - 0.18), ex, ez);
      box(cornerMat, ex - side * (ew / 2 - 0.14), ePlate / 2 + 0.35, ez + ed / 2 - 0.14, 0.34, ePlate, 0.34);
      box(cornerMat, ex - side * (ew / 2 - 0.14), ePlate / 2 + 0.35, ez - ed / 2 + 0.14, 0.34, ePlate, 0.34);

      if (uw >= 18) {
        pioneerSashFront(ux - uw * 0.23, y1, ud / 2, winW, winH);
        pioneerSashFront(ux + uw * 0.23, y1, ud / 2, winW, winH);
      } else {
        pioneerSashFront(ux, y1, ud / 2, winW, winH);
      }
      if (isTwo) {
        if (uw >= 18) {
          pioneerSashFront(ux - uw * 0.23, 13.2, ud / 2, winW, winH * 0.94);
          pioneerSashFront(ux + uw * 0.23, 13.2, ud / 2, winW, winH * 0.94);
        } else {
          pioneerSashFront(ux, 13.2, ud / 2, winW, winH * 0.94);
        }
      } else {
        pioneerSashFront(ux, uPlate + uRise * 0.34, ud / 2, 1.55, 2.7);
      }

      const doorX = ex - side * ew * 0.14;
      paneledDoor(doorX, eFrontZ, 2.5, 6.4, false);
      if (ew >= 13) pioneerSashFront(ex + side * ew * 0.22, y1, eFrontZ, winW * 0.92, winH * 0.94);
      if (b.porch === "shed") pioneerShedPorch(ex, eFrontZ, Math.max(8.5, ew - 0.8), 4.0);
      else pioneerStoop(doorX, eFrontZ, 4.2, 2.6);

      const outerX = ux + side * (uw / 2);
      pioneerSashSide(outerX, y1, ud * 0.22, side, winW, winH);
      pioneerSashSide(outerX, y1, -ud * 0.22, side, winW, winH);
      if (isTwo) {
        pioneerSashSide(outerX, 13.2, ud * 0.22, side, winW, winH * 0.94);
        pioneerSashSide(outerX, 13.2, -ud * 0.22, side, winW, winH * 0.94);
      }

      chimneyStack(mats.brick.red, ux, uPlate + uRise * 0.72 + 1.5, -ud * 0.15, 1.3, 4.8, 1.3);
      if (h % 13 === 0) pioneerSplitRailFence(b.width, b.depth / 2);
      return uPlate + uRise + 4;
    }

    box(mats.stone, 0, 0.28, 0, b.width + 0.2, 0.56, b.depth + 0.2);
    box(body, 0, plate / 2 + 0.35, 0, b.width, plate, b.depth);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(cornerMat, sx * (b.width / 2 - 0.14), plate / 2 + 0.35, sz * (b.depth / 2 - 0.14), 0.34, plate, 0.34);
      }
    }

    const fz = b.depth / 2;
    if (plan === "side-gable") {
      const rise = Math.max(6.8, b.depth * 0.48);
      gableAt(b.width, b.depth, rise, plate + 0.35, roofMat, 0, 0);
      pioneerGableWall(body, b.depth, rise * 0.92, plate + 0.35, "x", b.width / 2 - 0.18, 0, 0);
      pioneerGableWall(body, b.depth, rise * 0.92, plate + 0.35, "x", -b.width / 2 + 0.18, 0, 0);

      paneledDoor(0, fz, 2.55, 6.45, false);
      if (b.width >= 19) {
        pioneerSashFront(-b.width * 0.3, y1, fz, winW, winH);
        pioneerSashFront(b.width * 0.3, y1, fz, winW, winH);
      } else {
        pioneerSashFront(b.width * 0.28, y1, fz, winW * 0.9, winH * 0.94);
      }
      if (isTwo) {
        pioneerSashFront(-b.width * 0.28, 13.2, fz, winW, winH * 0.94);
        pioneerSashFront(0, 13.2, fz, winW, winH * 0.94);
        pioneerSashFront(b.width * 0.28, 13.2, fz, winW, winH * 0.94);
      }

      for (const side of [-1, 1]) {
        pioneerSashSide(side * (b.width / 2), y1, 0, side, winW, winH);
        if (isHalf || isTwo) {
          pioneerSashSide(side * (b.width / 2), plate + rise * 0.32, 0, side, 1.55, 2.65);
        }
      }

      if (b.porch === "shed") pioneerShedPorch(0, fz, Math.min(b.width - 1.6, Math.max(12, b.width * 0.72)), 4.2);
      else pioneerStoop(0, fz, 4.4, 2.8);

      const chimX = h % 2 === 0 ? -b.width * 0.22 : b.width * 0.22;
      chimneyStack(mats.brick.red, chimX, plate + rise * 0.75 + 1.5, 0, 1.3, 4.8, 1.3);
      if (h % 13 === 0) pioneerSplitRailFence(b.width, fz);
      return plate + rise + 4;
    }

    const rise = Math.max(6.8, b.width * 0.48);
    gableFrontAt(b.width, b.depth, rise, plate + 0.35, roofMat, 0, 0);
    pioneerGableWall(body, b.width, rise * 0.92, plate + 0.35, "z", fz - 0.18, 0, 0);
    pioneerGableWall(body, b.width, rise * 0.92, plate + 0.35, "z", -fz + 0.18, 0, 0);

    const doorSide = h % 2 === 0 ? -1 : 1;
    const doorX = doorSide * Math.min(4.8, b.width * 0.23);
    paneledDoor(doorX, fz, 2.55, 6.45, false);
    pioneerSashFront(-doorX, y1, fz, winW, winH);
    if (isTwo) {
      pioneerSashFront(-b.width * 0.23, 13.2, fz, winW, winH * 0.94);
      pioneerSashFront(b.width * 0.23, 13.2, fz, winW, winH * 0.94);
    }
    if (isHalf || isTwo) {
      pioneerSashFront(0, plate + rise * 0.33, fz, 1.55, 2.7);
    }

    for (const side of [-1, 1]) {
      pioneerSashSide(side * (b.width / 2), y1, b.depth * 0.22, side, winW, winH);
      pioneerSashSide(side * (b.width / 2), y1, -b.depth * 0.22, side, winW, winH);
      if (isTwo) {
        pioneerSashSide(side * (b.width / 2), 13.2, b.depth * 0.22, side, winW, winH * 0.94);
        pioneerSashSide(side * (b.width / 2), 13.2, -b.depth * 0.22, side, winW, winH * 0.94);
      }
    }

    if (b.porch === "shed") pioneerShedPorch(0, fz, Math.max(10, b.width - 1.2), 4.0);
    else pioneerStoop(doorX, fz, 4.2, 2.7);

    chimneyStack(mats.brick.red, 0, plate + rise * 0.75 + 1.5, -b.depth * 0.12, 1.3, 4.8, 1.3);
    if (h % 13 === 0) pioneerSplitRailFence(b.width, fz);
    return plate + rise + 4;
  };

  const addPioneerStore = (b) => {
    const h = idHash(b.id);
    const stories = Number(b.stories) || 1;
    const wallH = stories >= 2 ? 19.4 : 10.8;
    const rise = Math.max(4.5, b.width * 0.26);
    const parapetH = rise + 0.85;
    const body = paintOf(b);
    const trimMat = b.paint === "weathered" ? mats.trimDark : mats.trim;
    const roofMat = h % 2 === 0 ? mats.roofDark : mats.roof;
    const fz = b.depth / 2;

    box(mats.stone, 0, 0.24, 0, b.width + 0.2, 0.48, b.depth + 0.2);
    box(body, 0, wallH / 2 + 0.35, 0, b.width, wallH, b.depth);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(trimMat, sx * (b.width / 2 - 0.14), wallH / 2 + 0.35, sz * (b.depth / 2 - 0.14), 0.36, wallH, 0.36);
      }
    }

    // Steep wood-shingle gable behind false front (peak stays below parapet top)
    gableFrontAt(b.width, b.depth - 1.1, rise, wallH + 0.2, roofMat, 0, -0.55);
    pioneerGableWall(body, b.width, rise * 0.92, wallH + 0.2, "z", -fz + 0.18, 0, 0);

    // Plain rectangular false-front parapet with simple flat cap board (no brackets/dentils/awnings)
    box(body, 0, wallH + 0.35 + parapetH / 2, fz - 0.42, b.width, parapetH, 0.9);
    box(trimMat, 0, wallH + 0.35 + parapetH + 0.14, fz - 0.3, b.width + 0.7, 0.32, 1.25);
    box(trimMat, 0, wallH + 0.25, fz + 0.08, b.width + 0.28, 0.22, 0.3);

    // Plain board sign area across the upper false front, NO lettering
    const signW = Math.min(b.width - 2.6, b.width * 0.82);
    const signH = Math.min(2.6, parapetH * 0.42);
    const signY = wallH + 0.35 + parapetH * 0.52;
    box(mats.trimDark, 0, signY, fz + 0.08, signW + 0.48, signH + 0.38, 0.14);
    const signBoardMat = b.paint === "weathered" ? mats.siding.agedWhite : mats.trimCream;
    box(signBoardMat, 0, signY, fz + 0.14, signW, signH, 0.08);

    // Ground-floor door + small multi-pane 6-over-6 shop windows
    paneledDoor(0, fz, 2.8, 6.65, false);
    const winOff = Math.max(5.0, b.width * 0.28);
    pioneerSashFront(-winOff, 4.75, fz, 2.65, 4.6);
    pioneerSashFront(winOff, 4.75, fz, 2.65, 4.6);

    if (stories >= 2) {
      const n2 = b.width >= 26 ? 3 : 2;
      for (let i = 0; i < n2; i++) {
        const wx = n2 === 1 ? 0 : -b.width * 0.26 + ((b.width * 0.52) * i) / (n2 - 1);
        pioneerSashFront(wx, 14.8, fz, 2.0, 3.85);
      }
    }

    for (const side of [-1, 1]) {
      pioneerSashSide(side * (b.width / 2), 5.0, fz * 0.38, side, 1.9, 3.7);
      pioneerSashSide(side * (b.width / 2), 5.0, -fz * 0.35, side, 1.9, 3.7);
      if (stories >= 2) {
        pioneerSashSide(side * (b.width / 2), 14.8, fz * 0.38, side, 1.9, 3.7);
        pioneerSashSide(side * (b.width / 2), 14.8, -fz * 0.35, side, 1.9, 3.7);
      }
    }

    box(mats.plank, 0, 0.22, fz + 1.9, b.width, 0.36, 3.8);
    chimneyStack(mats.brick.red, b.width * 0.22, wallH + rise * 0.65 + 1.4, -fz * 0.5, 1.3, 4.5, 1.3);
    return wallH + parapetH + 2;
  };

  const addPioneerBarn = (b) => {
    const mat = mats.boardBatten[b.paint] || mats.boardBatten.weathered;
    const roofMat = mats.roofDark;
    const wallH = b.kind === "barn" ? 13.0 : 9.4;
    const rise = Math.max(5.5, b.width * 0.44);
    const fz = b.depth / 2;

    box(mats.stone, 0, 0.22, 0, b.width + 0.15, 0.44, b.depth + 0.15);
    box(mat, 0, wallH / 2 + 0.25, 0, b.width, wallH, b.depth);

    gableFrontAt(b.width, b.depth, rise, wallH + 0.25, roofMat, 0, 0);
    pioneerGableWall(mat, b.width, rise * 0.92, wallH + 0.25, "z", fz - 0.18, 0, 0);
    pioneerGableWall(mat, b.width, rise * 0.92, wallH + 0.25, "z", -fz + 0.18, 0, 0);

    const dw = Math.min(9.2, b.width * 0.44);
    const dh = b.kind === "barn" ? 7.6 : 6.4;
    box(mats.trimDark, 0, dh / 2 + 0.3, fz + 0.06, dw + 0.4, dh + 0.2, 0.14);
    box(mat, -dw * 0.25, dh / 2 + 0.3, fz + 0.12, dw * 0.47, dh - 0.15, 0.12);
    box(mat, dw * 0.25, dh / 2 + 0.3, fz + 0.12, dw * 0.47, dh - 0.15, 0.12);
    for (const sx of [-1, 1]) {
      const dx = sx * dw * 0.25;
      box(mats.trimDark, dx, dh * 0.82 + 0.3, fz + 0.19, dw * 0.44, 0.28, 0.08);
      box(mats.trimDark, dx, dh * 0.22 + 0.3, fz + 0.19, dw * 0.44, 0.28, 0.08);
      box(mats.trimDark, dx, dh * 0.52 + 0.3, fz + 0.19, dw * 0.44, 0.24, 0.08);
    }

    if (b.kind === "barn") {
      box(mats.trimDark, 0, wallH + 2.0, fz + 0.08, 2.9, 3.3, 0.14);
      box(mat, 0, wallH + 2.0, fz + 0.14, 2.5, 2.9, 0.1);
      for (const side of [-1, 1]) {
        pioneerSashSide(side * (b.width / 2), 5.2, 0, side, 1.8, 2.4);
      }
    }
    return wallH + rise + 2;
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
    // facade.palette swaps the shared trim, iron, stone, hood and white materials for this
    // building only, so a photo-matched front can carry muted, weathered colours.
    const pal = b.facade?.palette;
    const savedMats = pal ? { trim: mats.trim, trimDark: mats.trimDark, stone: mats.stone, voussoir: mats.voussoir, siding: mats.siding } : null;
    if (pal) {
      for (const k of ["trim", "trimDark", "stone", "voussoir"]) if (pal[k] && mats[pal[k]]) mats[k] = mats[pal[k]];
      if (pal.white && mats[pal.white]) mats.siding = { ...mats.siding, white: mats[pal.white] };
    }
    let height = 20;
    const handDrawn = Boolean(
      b.facade?.hendeeHome || b.facade?.turretHouse || b.facade?.studBarn || b.facade?.hoseTower || b.facade?.standpipe1889 || b.facade?.waterTower1914 ||
      b.facade?.ballCream || b.facade?.mcpCorner || b.facade?.hurst292 || b.facade?.funeralHome ||
      b.facade?.hurstBuff || b.facade?.hurstPressed || b.facade?.signBand || b.facade?.pentRoof ||
      (b.id === "millinery-2" && b.facade?.storefront === "plate") ||
      b.facade?.bays || b.facade?.norcross ||
      b.facade?.plainPlant || b.facade?.eastSide1904 ||
      b.facade?.engineHouse || b.facade?.cityHall || b.facade?.westSide1897 || b.facade?.flatSchool ||
      b.facade?.stBernard1907 || b.facade?.stBernard1953 || b.facade?.fireHouse1953 ||
      b.facade?.methodist1884 || b.facade?.methodist1925 || b.facade?.stBernardRectory ||
      b.facade?.presbyterian1869 || b.facade?.presbyterian1917 || b.facade?.baptist1866 || b.facade?.americanHouse || b.facade?.pioneer ||
      b.id === "presbyterian-church-1917" || b.id === "junction-depot" || b.id === "hurst-crossing-shanty" ||
      b.id === "hendee-house-26" || b.id === "hendee-store-22"
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
    else if (b.facade?.standpipe1889) height = addStandpipe1889(b);
    else if (b.facade?.waterTower1914) height = addWaterTower1914(b);
    else if (b.facade?.ballCream) height = addBallCream(b);
    else if (b.facade?.mcpCorner) height = addMcpCorner(b);
    else if (b.facade?.hurst292) height = addHurst292(b);
    else if (b.facade?.funeralHome) height = addFuneralHome(b);
    else if (b.facade?.signBand) height = addSomethingSpecial(b);
    else if (b.facade?.pentRoof) height = addGreenNeighbor(b);
    else if (b.id === "millinery-2" && b.facade?.storefront === "plate") height = addGrayHoods(b);
    else if (b.facade?.hurstBuff) height = addHurstBuff(b);
    else if (b.facade?.hurstPressed) height = addHurstPressed(b);
    else if (b.facade?.engineHouse) height = addEngineHouse(b);
    else if (b.facade?.cityHall) height = addCityHall(b);
    else if (b.facade?.westSide1897) height = addWestSide1897(b);
    else if (b.facade?.flatSchool) height = addFlatSchool(b);
    else if (b.facade?.stBernard1907) height = addStBernard1907(b);
    else if (b.facade?.stBernard1953) height = addStBernard1953(b);
    else if (b.facade?.fireHouse1953) height = addFireHouse1953(b);
    else if (b.facade?.methodist1884) height = addMethodist1884(b);
    else if (b.facade?.methodist1925) height = addMethodist1925(b);
    else if (b.facade?.stBernardRectory) height = addStBernardRectory(b);
    else if (b.facade?.presbyterian1869) height = addPresbyterian1869(b);
    else if (b.facade?.presbyterian1917) height = addGothicChurch(b);
    else if (b.facade?.baptist1866) height = addBaptistChurch(b);
    else if (b.facade?.americanHouse) height = addAmericanHouse(b);
    else if (b.facade?.pioneer && b.kind === "house") height = addPioneerHouse(b);
    else if (b.facade?.pioneer && (b.kind === "frame-store" || b.kind === "brick-store")) height = addPioneerStore(b);
    else if (b.facade?.pioneer && (b.kind === "barn" || b.kind === "shed")) height = addPioneerBarn(b);
    else if (b.kind === "house") height = addHouse(b);
    else if (b.id === "hendee-store-22") height = addHendeeStore(b);
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
    if (savedMats) Object.assign(mats, savedMats);

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
  const groundYear = data.meta?.sliderYear || data.meta?.shownYear || 1880;
  const pioneerPrairie = groundYear <= 1860;
  const groundGrassMat = pioneerPrairie ? mats.prairie : mats.grass;
  const groundParkMat = pioneerPrairie ? mats.prairiePark : mats.park;
  // Round 4: the plane is split into small cells and sits a little below the streets. As two
  // 40,000-foot triangles at y = 0 it won the depth test over the dirt streets in the
  // software renderer, so every dirt street read as lawn.
  const prairie = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000, 100, 100), groundGrassMat);
  prairie.rotation.x = -Math.PI / 2;
  prairie.position.y = -0.3;
  prairie.receiveShadow = true;
  scene.add(prairie);

  for (const block of data.blocks) {
    if (block.use !== "park") continue;
    const w = block.x1 - block.x0;
    const d = block.z1 - block.z0;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), groundParkMat);
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

  // Round 4: the ground by year (centennial book). Before 1902 the streets are dirt and the
  // business walks are boards. The old board walks gave way to brick from 1902 and to concrete
  // from 1907 (p.24, p.26). Paving districts follow the dated ordinances and contracts below.
  // From 1938 the W.P.A. black-topped every main street not already paved (p.46).
  // The book does not name the pavement itself. Brick for 1902-1906 and concrete from 1907
  // follow the walk dates (estimate). Spans are in plat feet after the mirror: +z is east.
  const walkEra = groundYear < 1902 ? "board" : groundYear < 1907 ? "brick" : "concrete";
  const modernPaved = (data.meta?.shownYear || 0) >= 1970;
  const blacktopAll = groundYear >= 1938;
  const PAVING = [
    // First ordinance Sept 1902, Hail from East Main to Crafford, finished April 1903 (p.24).
    { year: 1902, name: "Hail Street", from: 121, to: 611, business: true },
    // East and West Main from Gridley south, finished summer 1904 (p.26). The March 1903
    // meeting names Gridley to Barnes (p.25). The book's "fourteen blocks" is not resolved,
    // so the span is Gridley to Barnes (estimate).
    { year: 1904, name: "East Main Street", from: -870, to: 450, business: true },
    { year: 1904, name: "West Main Street", from: -870, to: 450, business: true },
    // 1907 districts: Crafford north from Hail five blocks, and Hurst from East Main to Crafford (p.26).
    { year: 1907, name: "Crafford Street", from: -30, to: 1600 },
    { year: 1907, name: "Hurst Street", from: 121, to: 611, business: true },
    // August 1909 contract: around both parks, and from the First National Bank west to the
    // west park (p.30). The park blocks are the model's inferred park blocks.
    { year: 1909, name: "Barnes Street", from: 121, to: 611 },
    { year: 1909, name: "Crafford Street", from: -870, to: -390 },
    { year: 1909, name: "Barnes Street", from: -611, to: -121 },
    { year: 1909, name: "Hurst Street", from: -611, to: -121 },
    { year: 1909, name: "Dean Street", from: -870, to: -390 },
    // Districts seven and eight, let in late 1910: Dean from Hail to the schoolhouse, three
    // blocks (p.31). Shown from 1911 (estimate). The two Crafford blocks south of the
    // Methodist church are not placed, because that church's lot is not fixed in the model.
    { year: 1911, name: "Dean Street", from: -30, to: 1290 },
    // West Main from Gridley north, contract July 1924 (p.39).
    { year: 1924, name: "West Main Street", from: 390, to: 1600 },
    // Hail and Hurst from the East Park east to the state road on Cole, ordinance Sept 1926 (p.40).
    { year: 1926, name: "Hail Street", from: 581, to: 1871 },
    { year: 1926, name: "Hurst Street", from: 581, to: 1871 },
  ];
  const pavedSpans = (name) => PAVING.filter((span) => span.name === name && span.year <= groundYear);
  const flatMat = (color, rough = 0.95, key = color, joints = 0) => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSurfW;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurfW = transformed;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
varying vec3 vSurfW;
float sHash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
float sNoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(sHash(i),sHash(i+vec2(1.0,0.0)),f.x), mix(sHash(i+vec2(0.0,1.0)),sHash(i+vec2(1.0,1.0)),f.x), f.y); }`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          float sn = sNoise(vSurfW.xz * 0.06) * 0.6 + sNoise(vSurfW.xz * 0.45) * 0.4;
          diffuseColor.rgb *= mix(vec3(0.9), vec3(1.06), sn);
          ${joints ? `vec2 jc = abs(fract(vSurfW.xz / ${joints.toFixed(1)}) - 0.5) * ${joints.toFixed(1)};
          float joint = 1.0 - smoothstep(0.08, 0.22, min(jc.x, jc.y));
          diffuseColor.rgb *= 1.0 - joint * 0.14;` : ""}`);
    };
    mat.customProgramCacheKey = () => `surface-r4b-${key}`;
    return mat;
  };
  // Pale, worn concrete, as in the 1954 Main Street photographs (p.113-p.116).
  // Geometry is in plat feet, so the joints run square to the streets.
  const concretePave = flatMat("#aaa498", 0.94, "concrete", 20);
  const concreteWalk = flatMat("#c4beb2", 0.9, "walk", 5);
  // W.P.A. black-top with a gravel base (p.46).
  const blacktop = flatMat("#6c6a66", 0.97, "blacktop");
  const brickPave = mats.brick.red.clone();
  brickPave.vertexColors = false;
  // Vitrified paving brick reads duller and browner than wall brick.
  brickPave.color.set("#8c7d74");
  brickPave.polygonOffset = true;
  brickPave.polygonOffsetFactor = -1;
  brickPave.polygonOffsetUnits = -1;
  const pavedMat = walkEra === "brick" ? brickPave : concretePave;
  const walkMat = walkEra === "brick" ? brickPave : concreteWalk;
  const curbMat = mats.stone.clone();
  curbMat.vertexColors = false;
  curbMat.color.set("#cfc9bd");
  const groundParts = new Map();
  const addPart = (mat, geo) => {
    if (!groundParts.has(mat)) groundParts.set(mat, []);
    groundParts.get(mat).push(geo);
  };
  // A flat strip on the street: axis "x" runs along x at z = across, axis "z" runs along z.
  const flatStrip = (mat, axis, from, to, across, size, y, thick = 0) => {
    const len = Math.abs(to - from);
    const mid = (from + to) / 2;
    if (len < 0.5) return;
    let geo;
    if (thick > 0) {
      geo = axis === "x" ? new THREE.BoxGeometry(len, thick, size) : new THREE.BoxGeometry(size, thick, len);
      if (mat.userData?.uvFeet) scaleBoxUVs(geo, axis === "x" ? len : size, thick, axis === "x" ? size : len, mat);
      geo.translate(axis === "x" ? mid : across, y - thick / 2, axis === "x" ? across : mid);
    } else {
      geo = axis === "x" ? new THREE.PlaneGeometry(len, size) : new THREE.PlaneGeometry(size, len);
      const uv = geo.getAttribute("uv");
      const feet = mat.userData?.uvFeet || { u: 3.2, v: 3.2 };
      const uScale = (axis === "x" ? len : size) / feet.u;
      const vScale = (axis === "x" ? size : len) / feet.v;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
      geo.rotateX(-Math.PI / 2);
      geo.translate(axis === "x" ? mid : across, y, axis === "x" ? across : mid);
    }
    addPart(mat, geo);
  };

  for (const street of data.streets) {
    if (street.points) {
      // Town streets drawn as lines are black-topped with the rest; country roads stay dirt.
      const townStreet = /Street|Drive|Lane|Avenue|Boulevard/.test(street.name);
      addPolylineStreet(street, blacktopAll && townStreet ? blacktop : mats.street, scene);
      continue;
    }
    const len = street.to - street.from;
    const spans = pavedSpans(street.name);
    if (blacktopAll || spans.length === 0 || spans.some((sp) => sp.from > street.from || sp.to < street.to)) {
      // Base surface: dirt, or black-top once the W.P.A. work is done.
      if (blacktopAll) {
        flatStrip(blacktop, street.axis, street.from, street.to, street.at, street.width - 2, 0.06);
      } else {
        const geo =
          street.axis === "x"
            ? new THREE.PlaneGeometry(len, street.width)
            : new THREE.PlaneGeometry(street.width, len);
        const mesh = new THREE.Mesh(geo, street.axis === "x" ? mats.street : mats.streetCross);
        mesh.rotation.x = -Math.PI / 2;
        if (street.axis === "x") mesh.position.set((street.from + street.to) / 2, 0.05, street.at);
        else mesh.position.set(street.at, 0.05, (street.from + street.to) / 2);
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
    }
    // The 1970 stop keeps its own photo-matched paving on East Main, Hurst, and North Crafford.
    for (const span of spans) {
      const from = Math.max(street.from, span.from);
      const to = Math.min(street.to, span.to);
      if (to <= from) continue;
      const margin = street.width >= 70 ? 10 : 12;
      const carriage = street.width - margin * 2;
      flatStrip(pavedMat, street.axis, from, to, street.at, carriage, 0.1);
      for (const side of [-1, 1]) {
        const edge = street.at + side * (carriage / 2 + 0.35);
        flatStrip(curbMat, street.axis, from, to, edge, 0.7, 0.42, 0.42);
        const rowMid = street.at + side * (carriage / 2 + 0.7 + (margin - 0.7) / 2);
        // Business blocks get a walk to the lot line; the rest keep a grass parkway.
        if (span.business) flatStrip(walkMat, street.axis, from, to, rowMid, margin - 0.7, 0.2);
        else flatStrip(groundGrassMat, street.axis, from, to, rowMid, margin - 0.7, 0.09);
      }
    }
  }

  // Board walks before 1902; brick and then concrete walks after, on the same lines.
  for (const walk of data.boardwalks) {
    if (modernPaved) {
      const onMain = walk.axis === "x" && Math.abs(Math.abs(walk.at) - 156) < 50;
      const onHurst = walk.axis === "z" && Math.abs(Math.abs(walk.at) - 420) < 55;
      if (onMain || onHurst) continue;
    }
    const len = Math.abs(walk.to - walk.from);
    if (walkEra !== "board") {
      flatStrip(walkMat, walk.axis, walk.from, walk.to, walk.at, walk.width + 2, 0.24);
      continue;
    }
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

  for (const [mat, geos] of groundParts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.receiveShadow = true;
    if (mat === curbMat) mesh.castShadow = true;
    scene.add(mesh);
  }

  const vergeParts = [];
  for (const street of data.streets) {
    if (street.points) continue;
    if (modernPaved && (street.name === "East Main Street" || street.name === "Hurst Street")) continue;
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
    const vergeMesh = new THREE.Mesh(mergeGeometries(vergeParts, false), groundGrassMat);
  vergeMesh.receiveShadow = true;
  scene.add(vergeMesh);

  if (pioneerPrairie) {
    const distPointSeg = (px, pz, ax, az, bx, bz) => {
      const dx = bx - ax;
      const dz = bz - az;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq)) : 0;
      return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
    };
    const trackDist = (px, pz) => {
      let best = Infinity;
      for (const tr of data.tracks || []) {
        const pts = tr.points || [];
        for (let i = 0; i + 1 < pts.length; i++) {
          const d = distPointSeg(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (d < best) best = d;
        }
      }
      return best;
    };
    const inStreet = (px, pz, pad = 0) => {
      for (const st of data.streets) {
        if (st.points) continue;
        const hw = st.width / 2 + pad;
        if (st.axis === "x") {
          if (px >= st.from - pad && px <= st.to + pad && Math.abs(pz - st.at) <= hw) return true;
        } else {
          if (pz >= st.from - pad && pz <= st.to + pad && Math.abs(px - st.at) <= hw) return true;
        }
      }
      return false;
    };
    const yardGeos = [];
    const yardExclusions = [];
    const pushDirtPatch = (cx, cz, w, d, rotY = 0, excludeInset = 1.5) => {
      if (w < 2 || d < 2) return;
      if (trackDist(cx, cz) < 12) return;
      const geo = new THREE.PlaneGeometry(w, d);
      geo.rotateX(-Math.PI / 2);
      if (rotY) geo.rotateY(rotY);
      geo.translate(cx, 0.095, cz);
      yardGeos.push(geo);
      const c = Math.abs(Math.cos(rotY));
      const sn = Math.abs(Math.sin(rotY));
      const hw = (w * c + d * sn) * 0.5 - excludeInset;
      const hd = (w * sn + d * c) * 0.5 - excludeInset;
      if (hw > 1 && hd > 1) yardExclusions.push({ x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd });
    };
    const addWornPath = (x0, z0, x1, z1, width, seed) => {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 4) return;
      const nx = -dz / len;
      const nz = dx / len;
      const segs = Math.max(2, Math.min(4, Math.ceil(len / 28)));
      const sway = ((seed % 7) - 3) * 0.8;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs;
        const t1 = (i + 1) / segs;
        const tm = (t0 + t1) * 0.5;
        const off0 = Math.sin(t0 * Math.PI) * sway;
        const off1 = Math.sin(t1 * Math.PI) * sway;
        const ax = x0 + dx * t0 + nx * off0;
        const az = z0 + dz * t0 + nz * off0;
        const bx = x0 + dx * t1 + nx * off1;
        const bz = z0 + dz * t1 + nz * off1;
        const mx = (ax + bx) * 0.5;
        const mz = (az + bz) * 0.5;
        if (inStreet(mx, mz, -2.5) || trackDist(mx, mz) < 12) continue;
        const segLen = Math.hypot(bx - ax, bz - az) + 5.5;
        const ang = Math.atan2(bx - ax, bz - az);
        pushDirtPatch(mx, mz, width + ((seed + i) % 3) * 0.7, segLen, ang, 0.8);
      }
    };

    const houses = [];
    const barns = [];
    for (const b of data.buildings) {
      const h = idHash(b.id);
      const fp = footprint(b);
      const cx = (fp.minX + fp.maxX) / 2;
      const cz = (fp.minZ + fp.maxZ) / 2;
      const bw = fp.maxX - fp.minX;
      const bd = fp.maxZ - fp.minZ;
      const yaw = (FACING[b.facing] ?? 0) + ((b.rotation || 0) * Math.PI) / 180;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const isStore = b.kind === "frame-store" || b.kind === "brick-store" || b.kind === "hotel";
      const isBarn = b.kind === "barn" || b.kind === "shed";
      if (b.kind === "house") houses.push({ b, cx, cz, fp });
      if (isBarn) barns.push({ b, cx, cz, fx, fz, bw, bd, h });

      const padW = bw + (isBarn ? 32 : isStore ? 26 : 24) + (h % 7);
      const padD = bd + (isBarn ? 34 : isStore ? 28 : 26) + ((h >> 3) % 7);
      const fwdShift = isStore ? 6.5 : isBarn ? 2.0 : 4.5;
      const yx = cx + fx * fwdShift;
      const yz = cz + fz * fwdShift;
      pushDirtPatch(yx, yz, padW, padD, ((h % 9) - 4) * 0.025, 2.0);
      // Secondary slightly offset packed-earth patch for irregular yard boundary.
      const sx = ((h % 11) - 5) * 1.4;
      const sz = (((h >> 4) % 11) - 5) * 1.4;
      pushDirtPatch(cx + sx - fx * 3, cz + sz - fz * 3, bw + 14 + (h % 5), bd + 14 + ((h >> 2) % 5), 0.14, 2.2);

      // Worn footpath from front door/steps to the nearest facing street shoulder.
      if (!isBarn) {
        const frontHalf = Math.abs(fx) * (bw * 0.5) + Math.abs(fz) * (bd * 0.5);
        const startX = cx + fx * (frontHalf + 2);
        const startZ = cz + fz * (frontHalf + 2);
        let bestDist = 175;
        let endX = null;
        let endZ = null;
        for (const st of data.streets) {
          if (st.points) continue;
          if (Math.abs(fz) > 0.6 && st.axis === "x") {
            if (startX < st.from || startX > st.to) continue;
            const d = (st.at - startZ) * fz;
            const edge = d - (st.width * 0.5 - 1.5);
            if (edge > 2 && edge < bestDist) {
              bestDist = edge;
              endX = startX + ((h % 5) - 2) * 1.2;
              endZ = st.at - fz * (st.width * 0.5 - 1.5);
            }
          } else if (Math.abs(fx) > 0.6 && st.axis === "z") {
            if (startZ < st.from || startZ > st.to) continue;
            const d = (st.at - startX) * fx;
            const edge = d - (st.width * 0.5 - 1.5);
            if (edge > 2 && edge < bestDist) {
              bestDist = edge;
              endX = st.at - fx * (st.width * 0.5 - 1.5);
              endZ = startZ + ((h % 5) - 2) * 1.2;
            }
          }
        }
        if (endX !== null) {
          addWornPath(startX, startZ, endX, endZ, isStore ? 10 : 6.8, h);
        }
      }
    }

    // Worn paths linking barns/sheds to the nearest house on the same block.
    for (const barn of barns) {
      let best = null;
      let bestD = 195;
      for (const hs of houses) {
        const d = Math.hypot(hs.cx - barn.cx, hs.cz - barn.cz);
        if (d >= bestD) continue;
        const mx = (hs.cx + barn.cx) * 0.5;
        const mz = (hs.cz + barn.cz) * 0.5;
        if (inStreet(mx, mz, 0) || trackDist(mx, mz) < 12) continue;
        bestD = d;
        best = hs;
      }
      if (best) addWornPath(barn.cx, barn.cz, best.cx, best.cz, 6.2, barn.h);
    }

    if (yardGeos.length) {
      const mergedYards = mergeGeometries(yardGeos, false);
      yardGeos.forEach((g) => g.dispose());
      if (mergedYards) {
        const yardMesh = new THREE.Mesh(mergedYards, mats.dirtPatch);
        yardMesh.receiveShadow = true;
        yardMesh.renderOrder = 0;
        scene.add(yardMesh);
      }
    }

    // Taller tan-green uneven prairie grass tufts across unbuilt prairie & lots.
    const buildTuftGeo = () => {
      const positions = [];
      const normals = [];
      const uvs = [];
      const bladeCount = 12;
      for (let i = 0; i < bladeCount; i++) {
        const ring = i < 4 ? 0.16 : 0.44 + (i % 3) * 0.16;
        const posAng = i * 2.399963;
        const bx = Math.cos(posAng) * ring;
        const bz = Math.sin(posAng) * ring;
        const faceAng = posAng + 0.55 + (i % 3) * 0.4;
        const w = 0.14 + (i % 4) * 0.03;
        const h = 0.52 + ((i * 7) % 5) * 0.12;
        const lean = 0.32 + (i % 4) * 0.14;
        const c = Math.cos(faceAng);
        const sn = Math.sin(faceAng);
        const hw = w * 0.5;
        const outX = Math.cos(posAng);
        const outZ = Math.sin(posAng);
        const midX = bx + outX * lean * 0.38;
        const midZ = bz + outZ * lean * 0.38;
        const tipX = bx + outX * lean;
        const tipZ = bz + outZ * lean;
        const lx0 = bx - c * hw, lz0 = bz - sn * hw;
        const rx0 = bx + c * hw, rz0 = bz + sn * hw;
        const lx1 = midX - c * (hw * 0.55), lz1 = midZ - sn * (hw * 0.55);
        const rx1 = midX + c * (hw * 0.55), rz1 = midZ + sn * (hw * 0.55);
        const mh = h * 0.54;
        positions.push(
          lx0, 0, lz0, rx0, 0, rz0, rx1, mh, rz1,
          lx0, 0, lz0, rx1, mh, rz1, lx1, mh, lz1,
          lx1, mh, lz1, rx1, mh, rz1, tipX, h, tipZ,
        );
        for (let k = 0; k < 9; k++) normals.push(0, 1, 0);
        uvs.push(0, 0, 1, 0, 1, 0.5, 0, 0, 1, 0.5, 0, 0.5, 0, 0.5, 1, 0.5, 0.5, 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      return geo;
    };

    const inYardOrBuilding = (px, pz) => {
      for (const c of colliders) {
        if (px >= c.minX - 4.5 && px <= c.maxX + 4.5 && pz >= c.minZ - 4.5 && pz <= c.maxZ + 4.5) return true;
      }
      for (const y of yardExclusions) {
        if (px >= y.x0 && px <= y.x1 && pz >= y.z0 && pz <= y.z1) return true;
      }
      return false;
    };

    let seed = 1860054;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const tufts = [];
    const tryAddTuft = (tx, tz, clumpBoost = 0) => {
      if (inStreet(tx, tz, 2.5) || trackDist(tx, tz) < 13.5 || inYardOrBuilding(tx, tz)) return;
      const clump =
        0.52 +
        0.28 * Math.sin(tx * 0.019 + tz * 0.013) +
        0.22 * Math.cos(tx * 0.037 - tz * 0.029) +
        clumpBoost;
      if (rand() > Math.max(0.22, Math.min(0.95, clump))) return;
      const tall = 1.35 + clump * 1.45 + rand() * 0.75;
      const wide = 1.55 + rand() * 1.25;
      tufts.push({ tx, tz, tall, wide, rot: rand() * Math.PI * 2, shade: rand() });
    };

    for (let x = -1220; x <= 1140; x += 10) {
      for (let z = -1320; z <= 1320; z += 10) {
        tryAddTuft(x + (rand() - 0.5) * 8.5, z + (rand() - 0.5) * 8.5, 0.08);
      }
    }
    for (let x = -2250; x <= 2250; x += 34) {
      for (let z = -2250; z <= 2250; z += 34) {
        if (x > -1240 && x < 1160 && z > -1340 && z < 1340) continue;
        tryAddTuft(x + (rand() - 0.5) * 24, z + (rand() - 0.5) * 24, -0.05);
      }
    }

    if (tufts.length) {
      const tuftGeo = buildTuftGeo();
      const tuftMat = new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.94,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const grassMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, tufts.length);
      const tDummy = new THREE.Object3D();
      const tCol = new THREE.Color();
      const palette = [
        new THREE.Color("#bfa558"),
        new THREE.Color("#ad9248"),
        new THREE.Color("#8b8a42"),
        new THREE.Color("#6e7d3b"),
        new THREE.Color("#5f6e32"),
      ];
      tufts.forEach((tf, i) => {
        tDummy.position.set(tf.tx, 0.02, tf.tz);
        tDummy.rotation.set(0, tf.rot, 0);
        tDummy.scale.set(tf.wide, tf.tall, tf.wide);
        tDummy.updateMatrix();
        grassMesh.setMatrixAt(i, tDummy.matrix);
        const baseC = palette[Math.floor(tf.shade * palette.length) % palette.length];
        tCol.copy(baseC).offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.05);
        grassMesh.setColorAt(i, tCol);
      });
      grassMesh.instanceMatrix.needsUpdate = true;
      if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
      grassMesh.castShadow = false;
      grassMesh.receiveShadow = true;
      scene.add(grassMesh);
    }
  }
  vergeMesh.receiveShadow = true;
  scene.add(vergeMesh);

  const named = data.streets.filter((street) => street.name.endsWith("Street"));
  const eastWest = named.filter((street) => street.axis === "x");
  const northSouth = named.filter((street) => street.axis === "z");
  // Plank crossings belong to the board-walk years only.
  const crossingParts = [];
  if (walkEra === "board") {
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
  }
  if (crossingParts.length) {
    const crossings = new THREE.Mesh(mergeGeometries(crossingParts, false), mats.plank);
    crossings.castShadow = true;
    crossings.receiveShadow = true;
    scene.add(crossings);
  }

  // Mud holes on the unpaved business streets only.
  const puddleParts = [];
  for (const road of named) {
    if (blacktopAll) break;
    if (!/Main|Hail|Hurst|Gridley/.test(road.name)) continue;
    const spans = pavedSpans(road.name);
    const span = road.to - road.from;
    const count = Math.max(3, Math.floor(Math.abs(span) / 180));
    for (let i = 0; i < count; i++) {
      const along = road.from + ((i + 0.35) * span) / count;
      if (spans.some((sp) => along > sp.from - 8 && along < sp.to + 8)) continue;
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
  wire.position.set(-480, 22.6, -18);
  scene.add(wire);

  // Props. From the 1950 stop the horses, wagons, hitching rails, and troughs are gone:
  // the 1954 Main Street photographs (p.113-p.116) show parked cars and none of them (estimate of the year).
  const horseYears = groundYear < 1950;
  const propRoot = new THREE.Group();
  for (const p of data.props) {
    if (!horseYears && ["horse", "wagon", "hitching", "trough"].includes(p.type)) continue;
    propRoot.add(makeProp(p, mats));
  }
  scene.add(propRoot);
  addVehicles(data, mats, scene, groundYear, modernPaved);

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
  // These stone walks and curbs are the concrete-walk years only (from 1907, p.26).
  if (eastMain && walkEra === "concrete") dressStreet({ ...eastMain, from: -520, to: 560 }, { curb: true, walk: true, inset: 8, sides: [1] });
  const craffordNorth = streetByName("Crafford Street");
  if (craffordNorth && walkEra === "concrete") dressStreet({ ...craffordNorth, from: 980, to: 1280 }, { curb: true, walk: true, inset: 6, sides: [-1] });
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
    const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 12, 8), mats.trimDark);
    lampPost.position.set(330, 6, 179);
    const lampGlobe = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshStandardMaterial({ color: "#f4f1e4", emissive: "#fff6dd", emissiveIntensity: 0.35, roughness: 0.4 }));
    lampGlobe.position.set(330, 12.3, 179);
    const lampCap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.42, 0.35, 8), mats.trimDark);
    lampCap.position.set(330, 12.8, 179);
    scene.add(lampPost, lampGlobe, lampCap);
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
      span.position.set(-280, 22, street.at);
      scene.add(span);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 1.4), mats.lamp);
      lamp.position.set(-280, 21.2, street.at);
      scene.add(lamp);
    }
  }

  let allTrees;
  let lobeCount = 18;
  if (pioneerPrairie) {
    // 1854/1860: no mature shade trees on the open prairie; only a few small settler-planted saplings.
    lobeCount = 8;
    const saplingClear = (sx, sz) => {
      for (const c of colliders) {
        if (sx >= c.minX - 9 && sx <= c.maxX + 9 && sz >= c.minZ - 9 && sz <= c.maxZ + 9) return false;
      }
      for (const st of data.streets) {
        if (st.points) continue;
        const hw = st.width / 2 + 5;
        if (st.axis === "x") {
          if (sx >= st.from - 4 && sx <= st.to + 4 && Math.abs(sz - st.at) <= hw) return false;
        } else {
          if (sz >= st.from - 4 && sz <= st.to + 4 && Math.abs(sx - st.at) <= hw) return false;
        }
      }
      for (const tr of data.tracks || []) {
        const pts = tr.points || [];
        for (let i = 0; i + 1 < pts.length; i++) {
          const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((sx - ax) * dx + (sz - az) * dz) / l2)) : 0;
          if (Math.hypot(sx - (ax + t * dx), sz - (az + t * dz)) < 18) return false;
        }
      }
      return true;
    };
    const saplings = [];
    for (const b of data.buildings) {
      const h = idHash(b.id);
      if (b.kind === "house" && h % 5 === 0) {
        const side = h % 2 === 0 ? 1 : -1;
        const sx = b.x + side * (b.width / 2 + 12 + (h % 5));
        const sz = b.z + ((h % 7) - 3) * 2;
        if (saplingClear(sx, sz)) saplings.push({ x: sx, z: sz, scale: 0.48 + (h % 4) * 0.06 });
      }
      if (b.id === "markham-house-1854") {
        for (const [dx, dz, sc] of [[24, 14, 0.50], [-22, -18, 0.44], [42, -26, 0.54]]) {
          if (saplingClear(b.x + dx, b.z + dz)) saplings.push({ x: b.x + dx, z: b.z + dz, scale: sc });
        }
      }
      if (b.id === "american-house-52" || b.id === "german-methodist-1857") {
        const sx = b.x + 34;
        const sz = b.z - 20;
        if (saplingClear(sx, sz)) saplings.push({ x: sx, z: sz, scale: 0.58 });
      }
    }
    if (groundYear >= 1860) {
      for (const block of data.blocks) {
        if (block.use !== "park") continue;
        for (const [fx, fz, sc] of [[0.25, 0.3, 0.54], [0.75, 0.7, 0.48]]) {
          const sx = block.x0 + (block.x1 - block.x0) * fx;
          const sz = block.z0 + (block.z1 - block.z0) * fz;
          if (saplingClear(sx, sz)) saplings.push({ x: sx, z: sz, scale: sc });
        }
      }
    }
    allTrees = saplings;
  } else {
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
    allTrees = data.trees.concat(extraTrees);
  }
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
  const leafMat = foliage(pioneerPrairie ? "#568040" : "#3e6b34", pioneerPrairie ? "leaf-sapling-a" : "leaf-gaps-a");
  const leafDarkMat = foliage(pioneerPrairie ? "#436830" : "#2c5228", pioneerPrairie ? "leaf-sapling-b" : "leaf-gaps-b");
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
    const ts = pioneerPrairie ? s * 0.55 : s * 0.85;
    dummy.scale.set(ts, trunkH, ts);
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
    const flat = s.style === "wall" || s.style === "wallDark" || s.style === "glass";
    const h = s.height || (flat ? s.width * 0.2 : s.style === "molded" ? s.width * 0.2 : s.style === "band" ? s.width * 0.22 : s.style === "letter" ? s.width * 0.95 : s.subtitle ? s.width * 0.36 : s.width * 0.28);
    if (s.style === "letter" || s.style === "molded" || flat) {
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
    if (flat) mesh.position.z = 0.04;
    if (s.style === "letter" || s.style === "molded" || s.style === "band" || flat) group.add(mesh);
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

function addPolylineStreet(street, surfaceMat, scene) {
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
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, surfaceMat);
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
      // Dirt roads sit near 0.05. 1970 asphalt tops out near 0.25, and the
      // 400-block approach slab that replaces grass in the Something Special
      // photograph tops out near 1.3. Keep the letters on the walking surface.
      const pavedNow = (data.meta?.shownYear || 0) >= 1970;
      let y = 0.16;
      if (pavedNow) {
        y = 0.36;
        const onApproach =
          street.name === "East Main Street" &&
          street.axis === "x" &&
          along > -480 &&
          along < -220;
        if (onApproach) y = 1.38;
      }
      mesh.position.set(
        street.axis === "x" ? along : street.at + lane,
        y,
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

// Round 4: period motor cars, parked at the curb on the business streets.
// The White Way photograph of 1905 (p.39) shows one early open car among the buggies.
// The town had about 25 autos in 1908 and 35 assessed in 1912 (p.29, p.32). The 1954 Main
// Street photographs (p.113-p.116) show rounded late-1940s and early-1950s sedans.
// Counts and models per stop are estimates; sizes are real sizes in feet.
function carStyleFor(year) {
  if (year < 1905) return null;
  if (year < 1915) return "touring";
  if (year < 1935) return "tee";
  if (year < 1956) return "fifties";
  if (year < 1980) return "sixties";
  return "modern";
}

const carPaint = new Map();
function paintMat(color, gloss = 0.42) {
  const key = `${color}:${gloss}`;
  if (!carPaint.has(key)) carPaint.set(key, new THREE.MeshStandardMaterial({ color, roughness: gloss, metalness: 0.25 }));
  return carPaint.get(key);
}

function buildCar(style, color, accent, mats, put) {
  const body = paintMat(color);
  const second = paintMat(accent || color);
  const tire = paintMat("#1b1a19", 0.9);
  const chrome = paintMat("#d9dcdf", 0.25);
  const brass = paintMat("#a8853c", 0.35);
  const wood = paintMat("#7a5a36", 0.7);
  const seat = paintMat("#3a2a22", 0.8);
  // Car glass reads dark from the street.
  const glass = paintMat("#27323b", 0.12);
  const box = (mat, x, y, z, w, h, d) => put(mat, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const rounded = (mat, x, y, z, w, h, d, radius = 0.35) => put(mat, new RoundedBoxGeometry(w, h, d, 2, radius).translate(x, y, z));
  const wheel = (x, z, r, w, hub, spokes) => {
    put(tire, new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2).translate(x, r, z));
    put(hub, new THREE.CylinderGeometry(r * 0.42, r * 0.42, w + 0.06, 12).rotateZ(Math.PI / 2).translate(x, r, z));
    if (spokes) {
      for (let i = 0; i < 6; i++) {
        const spoke = new THREE.BoxGeometry(0.1, r * 1.5, 0.12).rotateX((i / 6) * Math.PI).translate(x + Math.sign(x) * 0.02, r, z);
        put(spokes, spoke);
      }
    }
  };
  if (style === "touring") {
    // An open touring car of about 1909: 34-inch wheels, brass radiator, no top raised.
    for (const x of [-2.35, 2.35]) for (const z of [-4.1, 4.1]) wheel(x, z, 1.42, 0.32, wood, wood);
    box(paintMat("#222", 0.8), 0, 1.55, 0, 3.8, 0.3, 10.6);
    box(body, 0, 2.75, 3.9, 3.1, 1.7, 3.0);
    box(brass, 0, 2.95, 5.55, 3.2, 2.1, 0.35);
    box(body, 0, 2.95, -0.9, 5.0, 2.1, 6.3);
    box(seat, 0, 4.45, 0.75, 4.7, 1.3, 0.5);
    box(seat, 0, 4.6, -3.75, 4.8, 1.6, 0.5);
    box(glass, 0, 4.8, 2.3, 4.2, 1.5, 0.06);
    box(brass, 0, 4.05, 2.3, 4.4, 0.12, 0.12);
    box(paintMat("#2b2522", 0.85), 0, 4.35, -4.6, 4.9, 0.55, 1.1);
    for (const x of [-2.5, 2.5]) {
      box(body, x, 3.0, 4.1, 0.95, 0.14, 3.1);
      box(body, x, 3.0, -4.1, 0.95, 0.14, 3.1);
      box(paintMat("#2a2a2a", 0.8), x * 1.04, 1.75, 0, 0.9, 0.12, 5.0);
      put(brass, new THREE.CylinderGeometry(0.36, 0.3, 0.55, 12).rotateX(Math.PI / 2).translate(x * 0.62, 3.3, 5.9));
    }
    put(paintMat("#1a1a1a", 0.7), new THREE.TorusGeometry(0.62, 0.06, 6, 16).rotateX(-0.9).translate(0.95, 4.65, 1.3));
    return 12.4;
  }
  if (style === "tee") {
    // A black Model T-type touring car with the top up: about 11 feet long and 7 feet high.
    for (const x of [-2.3, 2.3]) for (const z of [-3.95, 3.95]) wheel(x, z, 1.25, 0.28, wood, wood);
    box(paintMat("#1e1e1e", 0.8), 0, 1.35, 0, 3.6, 0.28, 10.0);
    box(body, 0, 2.55, 3.65, 2.9, 1.65, 2.9);
    box(body, 0, 2.7, 5.15, 3.0, 2.0, 0.3);
    box(body, 0, 2.75, -1.1, 4.9, 2.3, 5.9);
    box(seat, 0, 4.25, 0.5, 4.6, 1.2, 0.45);
    box(seat, 0, 4.4, -3.6, 4.6, 1.5, 0.45);
    box(glass, 0, 4.7, 2.05, 4.2, 1.6, 0.06);
    box(paintMat("#151515", 0.9), 0, 6.95, -1.0, 4.9, 0.16, 6.3);
    for (const x of [-2.35, 2.35]) for (const z of [2.0, -4.1]) box(paintMat("#151515", 0.9), x, 5.45, z, 0.12, 2.9, 0.12);
    for (const x of [-2.4, 2.4]) {
      box(body, x, 2.7, 3.95, 0.9, 0.13, 2.8);
      box(body, x, 2.7, -3.95, 0.9, 0.13, 2.8);
      box(paintMat("#222", 0.8), x * 1.04, 1.55, 0, 0.85, 0.12, 4.8);
      put(chrome, new THREE.CylinderGeometry(0.3, 0.26, 0.45, 12).rotateX(Math.PI / 2).translate(x * 0.6, 3.05, 5.45));
    }
    return 11;
  }
  if (style === "fifties") {
    // A rounded sedan of the late 1940s or early 1950s: about 16.5 feet long, 5.3 feet high.
    for (const x of [-2.6, 2.6]) for (const z of [-4.7, 4.75]) wheel(x, z, 1.15, 0.62, chrome, null);
    rounded(body, 0, 2.15, 0, 6.0, 1.9, 15.6, 0.5);
    for (const x of [-2.75, 2.75]) {
      rounded(body, x, 2.35, 4.75, 0.9, 1.45, 4.3, 0.42);
      rounded(body, x, 2.35, -4.7, 0.9, 1.45, 4.2, 0.42);
    }
    rounded(body, 0, 3.0, 5.1, 5.4, 0.85, 5.2, 0.4);
    rounded(second, 0, 4.75, -0.6, 5.3, 0.9, 6.4, 0.44);
    rounded(glass, 0, 4.0, -0.6, 5.45, 1.3, 7.0, 0.5);
    rounded(body, 0, 3.0, -6.0, 5.6, 0.9, 3.4, 0.44);
    box(chrome, 0, 1.45, 8.0, 6.3, 0.5, 0.35);
    box(chrome, 0, 1.45, -8.0, 6.3, 0.5, 0.35);
    box(chrome, 0, 2.3, 7.85, 3.0, 0.9, 0.12);
    for (const x of [-2.15, 2.15]) put(chrome, new THREE.CylinderGeometry(0.34, 0.34, 0.2, 12).rotateX(Math.PI / 2).translate(x, 2.75, 7.9));
    return 16.5;
  }
  if (style === "sixties") {
    // A long, low sedan of the 1960s: about 17.5 feet long and 4.6 feet high.
    for (const x of [-2.75, 2.75]) for (const z of [-4.9, 5.0]) wheel(x, z, 1.08, 0.66, chrome, null);
    rounded(body, 0, 2.05, 0, 6.5, 1.75, 17.2, 0.2);
    box(glass, 0, 3.4, -0.9, 5.6, 0.95, 7.2);
    box(second, 0, 4.05, -0.9, 5.5, 0.35, 6.4);
    box(chrome, 0, 1.3, 8.7, 6.6, 0.45, 0.3);
    box(chrome, 0, 1.3, -8.7, 6.6, 0.45, 0.3);
    box(chrome, 0, 2.2, 8.6, 5.6, 0.7, 0.1);
    box(chrome, 0, 2.95, 0, 6.55, 0.08, 17.0);
    return 17.5;
  }
  // Modern sedan or pickup, for slider years after 1980 that show the 1970 town.
  for (const x of [-2.55, 2.55]) for (const z of [-4.6, 4.6]) wheel(x, z, 1.05, 0.62, chrome, null);
  rounded(body, 0, 2.05, 0, 6.0, 2.0, 15.4, 0.4);
  rounded(glass, 0, 3.65, -0.4, 5.4, 1.2, 7.6, 0.4);
  rounded(second, 0, 4.35, -0.6, 5.2, 0.3, 6.4, 0.14);
  box(paintMat("#2a2b2c", 0.7), 0, 1.35, 7.75, 6.1, 0.6, 0.3);
  box(paintMat("#2a2b2c", 0.7), 0, 1.35, -7.75, 6.1, 0.6, 0.3);
  return 15.4;
}

function addVehicles(data, mats, scene, year, modernPaved) {
  const style = carStyleFor(year);
  if (!style) return;
  const palettes = {
    touring: [["#1f2a22"], ["#2a1d1a"]],
    tee: [["#1a1a1a"], ["#1a1a1a"], ["#22261f"], ["#1a1a1a"]],
    fifties: [["#1c1c1e"], ["#e8e2d2"], ["#2f4436", "#d8d2c0"], ["#5a2a28"], ["#3d4d5e"], ["#1c1c1e"], ["#8a8172", "#e8e2d2"]],
    sixties: [["#e9e5da"], ["#6b1f1f"], ["#36506e"], ["#2f4a3a"], ["#c7b98e"], ["#1d1e20"], ["#8fa4ad", "#e9e5da"]],
    modern: [["#b9bcbf"], ["#efefec"], ["#7a1d1f"], ["#2a3b5c"], ["#3c3e40"]],
  }[style];
  // How many cars stand at the curbs downtown in each period (estimate).
  const counts = { touring: 2, tee: 6, fifties: 16, sixties: 16, modern: 12 };
  const n = counts[style];
  const byName = (name) => data.streets.find((s) => s.name === name && s.axis);
  const spots = [];
  // Between the hitching rails (every 42 feet from x = -760) while they stand.
  const between = (x) => (year < 1950 ? Math.round((x + 739) / 42) * 42 - 739 : x);
  const mainXs = [-392, -350, -300, -255, -205, -150, -95, -45, 45, 95, 150, 210, 265, 330, -520, -600];
  const eastMain = byName("East Main Street");
  const westMain = byName("West Main Street");
  mainXs.forEach((x0, i) => {
    const x = between(x0);
    if (Math.abs(x + 420) < 34 || Math.abs(x) < 34 || Math.abs(x - 420) < 34) return;
    const onEast = i % 3 !== 2;
    const street = onEast ? eastMain : westMain;
    if (!street) return;
    // The 1970 photo-matched slab in front of the 400 block stands above the street.
    if (modernPaved && onEast && x > -495 && x < -205) return;
    const half = modernPaved && onEast ? 19 : 25;
    const side = Math.sign(street.at);
    spots.push({ x, z: street.at + side * (half - 3.4), heading: i % 2 ? Math.PI / 2 : -Math.PI / 2 });
  });
  const hurst = byName("Hurst Street");
  if (hurst && year >= 1920) {
    for (const [z, side] of [[240, -1], [300, 1], [470, -1], [-260, 1], [-330, -1]]) {
      spots.push({ x: hurst.at + side * 14.6, z, heading: side > 0 ? 0 : Math.PI });
    }
  }
  const parts = new Map();
  const picked = spots.slice(0, n);
  picked.forEach((spot, i) => {
    const [color, accent] = palettes[i % palettes.length];
    const m = new THREE.Matrix4().makeRotationY(spot.heading);
    m.setPosition(spot.x, 0.1, spot.z);
    const put = (mat, geo) => {
      geo.applyMatrix4(m);
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(geo);
    };
    buildCar(style, color, accent, mats, put);
  });
  for (const [mat, geos] of parts) {
    const normalized = geos.map((g) => {
      const flat = g.index ? g.toNonIndexed() : g;
      if (mat.vertexColors && !flat.getAttribute("color")) {
        flat.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(flat.getAttribute("position").count * 3).fill(1), 3));
      }
      return flat;
    });
    const mesh = new THREE.Mesh(mergeGeometries(normalized, false), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
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
