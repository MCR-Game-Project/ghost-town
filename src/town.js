import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeMaterials, makeSignTexture } from "./textures.js";

const FACING = { "+z": 0, "-z": Math.PI, "+x": Math.PI / 2, "-x": -Math.PI / 2 };

export function buildTown(data, scene) {
  const mats = makeMaterials();
  const buckets = new Map();
  const signs = [];
  const colliders = [];
  const picks = new THREE.Group();
  picks.name = "picks";
  let buildingMatrix = new THREE.Matrix4();

  const put = (mat, geo) => {
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  };

  // Box faces are 0–1 in UV. Scale them by feet so brick and siding actually repeat.
  const scaleBoxUVs = (geo, w, h, d) => {
    const uv = geo.getAttribute("uv");
    if (!uv || uv.count !== 24) return;
    const faces = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    for (let face = 0; face < 6; face++) {
      const su = faces[face][0] / 5;
      const sv = faces[face][1] / 3.2;
      for (let i = 0; i < 4; i++) {
        const idx = face * 4 + i;
        uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
      }
    }
    uv.needsUpdate = true;
  };

  const box = (mat, cx, cy, cz, w, h, d) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d);
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(cx, cy, cz));
    geo.applyMatrix4(buildingMatrix);
    put(mat, geo);
  };

  const localBox = (mat, cx, cy, cz, w, h, d, rotX = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d);
    if (rotX) geo.applyMatrix4(new THREE.Matrix4().makeRotationX(rotX));
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(cx, cy, cz));
    geo.applyMatrix4(buildingMatrix);
    put(mat, geo);
  };

  // A shallow arch of short trim blocks. "z" bulges toward the street; "x" bulges off a side wall.
  const archHood = (x, yBase, z, span, rise, outward) => {
    const steps = rise > span * 0.3 ? 7 : 5;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const u = (t - 0.5) * 2;
      const yy = yBase + rise * (1 - u * u);
      const seg = span / steps + 0.16;
      if (outward === "z") box(mats.trim, x + u * span * 0.46, yy, z, seg, 0.34, 0.3);
      else box(mats.trim, x, yy, z + u * span * 0.46, 0.3, 0.34, seg);
    }
  };

  const frontSash = (x, y, z, w, h, arch) => {
    box(mats.trim, x, y, z, w + 0.45, h + 0.4, 0.2);
    box(mats.glass, x, y, z + 0.08, w, h, 0.1);
    box(mats.trim, x, y, z + 0.14, 0.12, h, 0.06);
    box(mats.trim, x, y, z + 0.14, w, 0.1, 0.06);
    if (arch === "segmental") archHood(x, y + h / 2, z + 0.04, w + 0.3, (w + 0.3) * 0.22, "z");
    if (arch === "round") archHood(x, y + h / 2 - w * 0.18, z + 0.04, w + 0.2, (w + 0.2) * 0.48, "z");
  };

  const sideSash = (x, y, z, side, w, h, arch) => {
    box(mats.trim, x, y, z, 0.2, h + 0.4, w + 0.45);
    box(mats.glass, x + side * 0.08, y, z, 0.1, h, w);
    if (arch === "segmental") archHood(x + side * 0.04, y + h / 2, z, w + 0.3, (w + 0.3) * 0.22, "x");
    if (arch === "round") archHood(x + side * 0.04, y + h / 2 - w * 0.18, z, w + 0.2, (w + 0.2) * 0.48, "x");
  };

  const drawAwning = (width, fz) => {
    localBox(mats.siding.darkred, 0, 10.2, fz + 2.2, width, 0.12, 4.3, -0.5);
  };

  // A front taken from a photograph: bay count, arch shape, cornice, storefront, porch.
  const drawFacade = (b, wallH) => {
    const f = b.facade;
    const fz = b.depth / 2 + 0.14;
    const bays = Math.max(2, f.bays || 3);
    const gap = b.width / bays;
    const arch = f.arches || "flat";
    const doorAt =
      f.door === "center" ? Math.floor((bays - 1) / 2) : f.door === "left" ? 0 : f.door === "none" ? -1 : bays - 1;
    for (let col = 0; col < bays; col++) {
      const x = -b.width / 2 + gap * (col + 0.5);
      const gw = Math.max(3.1, gap - (f.storefront === "iron" ? 1.2 : 1.8));
      if (col === doorAt) {
        const dw = f.door === "center" ? Math.min(4.4, gap - 1) : 3.3;
        box(mats.trimDark, x, 4.3, fz, dw, 8, 0.26);
        box(mats.trim, x, 8.55, fz + 0.05, dw + 0.35, 0.5, 0.14);
        if (f.door === "center") box(mats.trim, x, 4.2, fz + 0.16, 0.12, 7.2, 0.06);
        box(mats.glass, x, 6.4, fz + 0.12, dw * 0.32, 2.1, 0.05);
      } else {
        box(mats.trimDark, x, 1.4, fz, gw, 2.05, 0.22);
        box(mats.glass, x, 5.45, fz, gw, 5.15, 0.14);
        box(mats.trim, x, 5.45, fz + 0.05, gw + 0.28, 5.45, 0.08);
        box(mats.glass, x, 8.5, fz, gw, 1.0, 0.1);
        if (f.storefront === "iron") {
          box(mats.trimDark, x - gw / 2 - 0.18, 5, fz + 0.1, 0.3, 8.3, 0.22);
          box(mats.trimDark, x + gw / 2 + 0.18, 5, fz + 0.1, 0.3, 8.3, 0.22);
        }
      }
      if (b.stories > 1) frontSash(x, wallH * 0.68, fz, Math.min(3.4, gap - 2.3), 5.1, arch);
    }
    if (f.cornice === "bracket" || f.cornice === "plain") {
      box(mats.trim, 0, wallH - 0.2, fz, b.width + 0.5, 0.8, 0.65);
      if (f.cornice === "bracket") {
        const n = Math.max(5, Math.round(b.width / 3.5));
        for (let i = 0; i < n; i++) {
          const x = -b.width / 2 + 0.7 + ((b.width - 1.4) * i) / (n - 1);
          box(mats.trimDark, x, wallH - 1.25, fz + 0.2, 0.4, 1.3, 0.7);
        }
      }
    }
    if (f.pilasters) {
      for (const x of [-b.width / 2 + 0.4, b.width / 2 - 0.4]) {
        box(mats.trim, x, wallH * 0.48, fz + 0.02, 0.65, wallH * 0.9, 0.26);
      }
    }
    if (f.awning) drawAwning(b.width * 0.9, fz);
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
        if (b.stories > 1) sideSash(x, wallH * 0.68, z, side, 2.5, 4.8, arch);
      }
    }
  };

  const tiled = (mat, tilesU, tilesV) => {
    const copy = mat.clone();
    copy.map = mat.map.clone();
    copy.map.wrapS = copy.map.wrapT = THREE.RepeatWrapping;
    copy.map.repeat.set(Math.max(1, tilesU), Math.max(1, tilesV));
    copy.map.colorSpace = THREE.SRGBColorSpace;
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
      scaleBoxUVs(geo, roofW, 0.5, slopeLen);
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

  const punch = (width, depth, stories, floorH, wallH, party, commercial) => {
    const fz = depth / 2 + 0.12;
    const cols = Math.max(2, Math.round(width / (commercial ? 9 : 11)));
    const gap = width / cols;
    for (let col = 0; col < cols; col++) {
      const x = -width / 2 + gap * (col + 0.5);
      if (commercial && col === cols - 1) {
        box(mats.trimDark, x, 4.2, fz, 3.4, 7.6, 0.25);
        box(mats.trim, x, 8.6, fz, 3.6, 1.1, 0.2);
      } else if (commercial) {
        box(mats.glass, x, 5.4, fz, Math.min(6.2, gap - 1.6), 6.4, 0.2);
        box(mats.trim, x, 5.4, fz + 0.02, Math.min(6.5, gap - 1.2), 6.7, 0.08);
        box(mats.glass, x, 5.4, fz + 0.16, Math.min(5.6, gap - 2.2), 5.6, 0.12);
      }
      for (let s = 1; s < stories; s++) {
        const y = s * floorH + floorH * 0.55;
        if (y > wallH - 1.5) continue;
        box(mats.trim, x, y, fz, 3.3, 5.2, 0.16);
        box(mats.glass, x, y, fz + 0.12, 2.5, 4.4, 0.1);
      }
    }
    // Side windows on exposed walls.
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
          box(mats.trim, x, y, z, 0.16, 4.4, 2.6);
          box(mats.glass, x + side * 0.08, y, z, 0.1, 3.6, 2);
        }
      }
    }
  };

  const signFor = (b, wallH) => {
    if (!b.sign) return;
    const rot = (FACING[b.facing] ?? 0) + THREE.MathUtils.degToRad(b.rotation || 0);
    const outward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const y = Math.min(wallH - 1.2, b.kind === "depot" ? 12.5 : b.stories * 8 + 4);
    signs.push({
      title: b.sign,
      subtitle: b.confidence === "sourced" ? b.use : "",
      position: new THREE.Vector3(b.x, y, b.z).addScaledVector(outward, b.depth / 2 + 0.45),
      rotation: rot,
      width: Math.min(Math.max(b.width * 0.62, 10), 28),
    });
  };

  const addHouse = (b) => {
    const wallH = b.stories * 9 + 1;
    const body = paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.4, 0, b.width + 0.4, 0.8, b.depth + 0.4);
    gable(b.width, b.depth, Math.max(6, b.depth * 0.38), wallH);
    punch(b.width, b.depth, b.stories, 9, wallH, b.party || [], false);
    box(mats.trimDark, 0, 3.8, b.depth / 2 + 0.15, 3.2, 7, 0.2);
    if (b.porch) {
      const z = b.depth / 2 + 3.2;
      box(mats.plank, 0, 0.7, z, b.width * 0.8, 0.35, 6);
      box(mats.roofDark, 0, 8.2, z, b.width * 0.86, 0.3, 6.4);
      for (const x of [-b.width * 0.34, b.width * 0.34]) {
        box(mats.trimDark, x, 4.4, z + 2.6, 0.45, 7.2, 0.45);
      }
    }
    box(mats.brick.red, b.width * 0.28, wallH + 3, -b.depth * 0.1, 1.6, 6, 1.6);
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
      // False front stands above the roof. A peaked one matches the Ball Bros. photograph.
      const frontH = b.facade?.peak ? 5.2 : 6.2;
      box(body, 0, wallH + 2.2, b.depth / 2 - 0.5, b.width + 0.4, frontH, 1);
      if (b.facade?.peak) {
        box(body, 0, wallH + 6.2, b.depth / 2 - 0.42, b.width * 0.42, 4.2, 1.05);
        box(mats.trim, 0, wallH + 8.2, b.depth / 2 - 0.28, b.width * 0.16, 1.4, 1.1);
      } else {
        box(mats.trim, 0, wallH + 5.2, b.depth / 2 - 0.35, b.width * 0.55, 2.2, 1.1);
      }
    } else if (b.facade?.cornice) {
      box(brickOf(b), 0, wallH + 0.7, 0, b.width + 0.35, 1.4, b.depth + 0.25);
    } else {
      box(brickOf(b), 0, wallH + 1.4, 0, b.width + 0.6, 2.8, b.depth + 0.6);
      box(mats.trim, 0, wallH + 0.3, b.depth / 2 + 0.15, b.width + 1, 0.7, 0.8);
    }
    if (b.facade?.bays) drawFacade(b, wallH);
    else {
      punch(b.width, b.depth, b.stories, floorH, wallH, b.party || [], true);
      if (b.facade?.awning) drawAwning(b.width * 0.88, b.depth / 2 + 0.14);
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
    signFor(b, frame ? wallH + 4 : wallH);
    return wallH + (frame ? 8 : 4);
  };

  const addChurch = (b) => {
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

  const addDepot = (b) => {
    const wallH = 15;
    const body = paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    box(mats.stone, 0, 0.4, 0, b.width + 0.4, 0.8, b.depth + 0.4);
    gable(b.width, b.depth, 6, wallH, mats.roofDark);
    // Operator's bay toward the track.
    box(body, 0, 8, b.depth / 2 + 2, 14, 14, 4);
    box(mats.glass, 0, 8, b.depth / 2 + 4.15, 10, 5, 0.15);
    box(mats.trim, 0, 8, b.depth / 2 + 4.05, 11, 6, 0.12);
    // Platform.
    box(mats.plank, 0, 0.7, b.depth / 2 + 6, b.width + 24, 0.45, 10);
    box(mats.brick.red, -b.width * 0.3, wallH + 2, 0, 1.8, 7, 1.8);
    // A few trackside doors.
    box(mats.trimDark, -b.width * 0.28, 4.5, b.depth / 2 + 0.2, 4.5, 8, 0.2);
    signFor(b, 13);
    return 24;
  };

  const addElevator = (b) => {
    const body = paintOf(b);
    const h = 54;
    box(body, 0, h / 2, 0, b.width, h, b.depth * 0.7);
    box(body, 0, h + 8, 0, b.width * 0.62, 16, b.depth * 0.42);
    gable(b.width * 0.62, b.depth * 0.42, 6, h + 16, mats.roofDark);
    if (b.facade?.cupola) {
      box(body, 0, h + 22, 0, b.width * 0.22, 8, b.depth * 0.16);
      box(mats.roofDark, 0, h + 26.4, 0, b.width * 0.3, 1.1, b.depth * 0.22);
      box(mats.trim, 0, h + 22, b.depth * 0.1, b.width * 0.08, 3.2, 0.12);
    }
    // Driveway shed.
    box(mats.siding.gray, 0, 8, b.depth * 0.42, b.width + 4, 16, 18);
    gable(b.width + 4, 18, 4, 16, mats.roofDark);
    box(mats.trimDark, 0, 6, b.depth * 0.42 + 9.2, 12, 10, 0.2);
    signFor(b, 40);
    return h + 24;
  };

  const addMill = (b) => {
    const wallH = b.stories * 13;
    const body = b.material === "brick" ? brickOf(b) : paintOf(b);
    box(body, 0, wallH / 2, 0, b.width, wallH, b.depth);
    gable(b.width, b.depth, 8, wallH, mats.roofDark);
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
    gable(b.width, b.depth, 6, wallH, mats.roofDark);
    punch(b.width, b.depth, 2, 11, wallH, [], false);
    box(mats.brick.dark, -b.width * 0.35, 20, b.depth * 0.2, 4, 40, 4);
    signFor(b, 18);
    return 42;
  };

  for (const b of data.buildings) {
    begin(b.x, b.z, b.facing, b.rotation || 0);
    let height = 20;
    if (b.kind === "house") height = addHouse(b);
    else if (b.kind === "frame-store") height = addStore(b, true);
    else if (b.kind === "brick-store" || b.kind === "hotel") height = addStore(b, b.material === "frame");
    else if (b.kind === "church") height = addChurch(b);
    else if (b.kind === "depot") height = addDepot(b);
    else if (b.kind === "elevator") height = addElevator(b);
    else if (b.kind === "mill") height = addMill(b);
    else if (b.kind === "barn") height = addBarn(b);
    else if (b.kind === "factory") height = addFactory(b);
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
  const prairie = new THREE.Mesh(new THREE.PlaneGeometry(6400, 5200), tiled(mats.grass, 6400 / 28, 5200 / 28));
  prairie.rotation.x = -Math.PI / 2;
  prairie.receiveShadow = true;
  scene.add(prairie);

  for (const block of data.blocks) {
    if (block.use !== "park") continue;
    const w = block.x1 - block.x0;
    const d = block.z1 - block.z0;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tiled(mats.park, w / 18, d / 18));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((block.x0 + block.x1) / 2, 0.03, (block.z0 + block.z1) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const street of data.streets) {
    const len = street.to - street.from;
    const geo =
      street.axis === "x"
        ? new THREE.PlaneGeometry(len, street.width)
        : new THREE.PlaneGeometry(street.width, len);
    const mesh = new THREE.Mesh(
      geo,
      street.axis === "x"
        ? tiled(mats.street, len / 14, street.width / 8)
        : tiled(mats.street, street.width / 8, len / 14),
    );
    mesh.rotation.x = -Math.PI / 2;
    if (street.axis === "x") mesh.position.set((street.from + street.to) / 2, 0.05, street.at);
    else mesh.position.set(street.at, 0.05, (street.from + street.to) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const walk of data.boardwalks) {
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

  const addTrack = (points) => {
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, z1] = points[i];
      const [x2, z2] = points[i + 1];
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      const mid = new THREE.Vector3((x1 + x2) / 2, 0, (z1 + z2) / 2);
      const ballast = new THREE.Mesh(new THREE.BoxGeometry(10, 0.35, len), tiled(mats.ballast, 2, len / 8));
      ballast.position.copy(mid);
      ballast.position.y = 0.12;
      ballast.rotation.y = yaw;
      ballast.receiveShadow = true;
      scene.add(ballast);
      for (const side of [-2.35, 2.35]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.35, len), mats.metal);
        rail.position.set(mid.x + Math.cos(yaw) * side, 0.45, mid.z - Math.sin(yaw) * side);
        rail.rotation.y = yaw;
        rail.castShadow = true;
        scene.add(rail);
      }
    }
  };
  for (const track of data.tracks) addTrack(track.points);

  // One wire along the telegraph line so the poles read as a line, not sticks.
  const wire = new THREE.Mesh(new THREE.BoxGeometry(3100, 0.08, 0.08), mats.trimDark);
  wire.position.set(-480, 22.6, 22);
  scene.add(wire);

  // Props.
  const propRoot = new THREE.Group();
  for (const p of data.props) {
    propRoot.add(makeProp(p, mats));
  }
  scene.add(propRoot);

  // Trees.
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.55, 0.8, 1, 6),
    mats.trunk,
    data.trees.length,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    mats.leaf,
    data.trees.length,
  );
  const dummy = new THREE.Object3D();
  data.trees.forEach((t, i) => {
    const s = t.scale || 1;
    const trunkH = (t.kind === "maple" ? 16 : 13) * s;
    dummy.position.set(t.x, trunkH / 2, t.z);
    dummy.scale.set(s, trunkH, s);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(t.x, trunkH + 6 * s, t.z);
    dummy.scale.set(7 * s, 5.5 * s, 7 * s);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
  });
  trunks.castShadow = true;
  leaves.castShadow = true;
  scene.add(trunks, leaves);

  // Street name boards at the Main crossings.
  const mains = data.streets.filter((s) => s.name.startsWith("East Main") || s.name.startsWith("West Main"));
  const crosses = data.streets.filter((s) =>
    ["Hail Street", "Hurst Street", "Barnes Street", "Gridley Street", "Davis Street"].includes(s.name),
  );
  for (const main of mains) {
    for (const cross of crosses) {
      const sign = makeStreetSign(`${cross.name.replace(" Street", "")}  ·  ${main.name.replace(" Street", "")}`, mats);
      sign.position.set(cross.at + 16, 0, main.at + (main.name.startsWith("East") ? -16 : 16));
      scene.add(sign);
    }
  }

  // Merge static building parts.
  for (const [mat, geos] of buckets) {
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const s of signs) {
    const tex = makeSignTexture(s.title, s.subtitle);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const h = s.subtitle ? s.width * 0.36 : s.width * 0.28;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.width, h), mat);
    mesh.position.copy(s.position);
    mesh.rotation.y = s.rotation;
    scene.add(mesh);
  }

  scene.add(picks);

  return { colliders, picks, materials: mats };
}

function makeStreetSign(text, mats) {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4), mats.trimDark);
  post.position.y = 4;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "#f4ead4";
  g.fillRect(0, 0, 512, 96);
  g.strokeStyle = "#3b2718";
  g.lineWidth = 8;
  g.strokeRect(4, 4, 504, 88);
  g.fillStyle = "#2a1c12";
  g.font = "600 40px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(18, 7 + text.length * 0.22), 1.5, 0.2),
    new THREE.MeshLambertMaterial({ map: tex }),
  );
  board.position.y = 8;
  group.add(post, board);
  return group;
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
    add(mats.trimDark, 0, 5, 0, 0.35, 10, 0.35);
    add(mats.trimDark, 0, 10, 0.6, 0.25, 0.25, 1.4);
    add(mats.lamp, 0, 9.4, 1.2, 0.8, 1.1, 0.8);
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
    add(mats.siding.tan, 0, 3.2, 0, 5, 2.4, 10);
    add(mats.siding.red, 0, 4.6, -1, 5.2, 1.2, 4);
    add(mats.trimDark, -2.3, 1.5, 3, 0.5, 3, 0.5);
    add(mats.trimDark, 2.3, 1.5, 3, 0.5, 3, 0.5);
    add(mats.trimDark, -2.3, 1.5, -3, 0.5, 3, 0.5);
    add(mats.trimDark, 2.3, 1.5, -3, 0.5, 3, 0.5);
  } else if (p.type === "horse") {
    add(mats.horse, 0, 4.2, 0, 2.2, 2.4, 5.2);
    add(mats.horse, 0, 6.2, 2.4, 1.2, 2.6, 1.4);
    add(mats.horseDark, 0, 6.6, 3.4, 1.1, 1.3, 1.6);
    for (const x of [-0.7, 0.7]) {
      for (const z of [-1.6, 1.5]) add(mats.horseDark, x, 1.6, z, 0.4, 3.2, 0.4);
    }
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
  return g;
}
