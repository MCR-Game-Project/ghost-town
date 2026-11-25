// Period vehicles, street lamps, and rolling stock (preview/vehicles).
// Everything is parametric geometry in real feet; no photo textures. Each kind is merged
// per material (cars, trains, wagons) or instanced (street lamps) to keep draw calls low.
// Dates, sizes, and colours are documented in SOURCES.md; most are estimates.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const TAU = Math.PI * 2;
const KEEP = new Set(["position", "normal", "uv", "color"]);

const paintCache = new Map();
export function paintMat(color, rough = 0.42, metal = 0.25, opts = {}) {
  const key = `${color}:${rough}:${metal}:${opts.emissive || ""}`;
  if (!paintCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity ?? 0.5;
    }
    paintCache.set(key, m);
  }
  return paintCache.get(key);
}

// Shared finishes.
const F = {
  tire: () => paintMat("#1c1b1a", 0.92, 0),
  chrome: () => paintMat("#dfe3e6", 0.16, 0.92),
  nickel: () => paintMat("#c9c6bb", 0.28, 0.8),
  brass: () => paintMat("#b58e3e", 0.3, 0.85),
  glass: () => paintMat("#253039", 0.14, 0.3),
  lens: () => paintMat("#f3eedb", 0.2, 0.1, { emissive: "#fff4d2", emissiveIntensity: 0.25 }),
  tail: () => paintMat("#9e1c16", 0.35, 0.1, { emissive: "#5a0905", emissiveIntensity: 0.3 }),
  black: () => paintMat("#151515", 0.55, 0.2),
  leather: () => paintMat("#2b211c", 0.75, 0),
  canvas: () => paintMat("#1f1d1b", 0.85, 0),
  iron: () => paintMat("#2b2b2a", 0.6, 0.55),
  white: () => paintMat("#f1efe8", 0.4, 0.05),
};

// A collector of geometry per material. Each piece is placed by a base matrix and merged.
export class Kit {
  constructor(base = new THREE.Matrix4()) {
    this.parts = new Map();
    this.base = base;
  }
  put(mat, geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    if (!g.getAttribute("uv")) {
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
    }
    if (mat.vertexColors) {
      if (!g.getAttribute("color")) {
        g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(1), 3));
      }
    } else if (g.getAttribute("color")) g.deleteAttribute("color");
    g.clearGroups();
    g.applyMatrix4(this.base);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return g;
  }
  place(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    if (rx || ry || rz) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")));
    geo.translate(x, y, z);
    return this.put(mat, geo);
  }
  box(mat, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) {
    return this.place(mat, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  }
  rbox(mat, x, y, z, w, h, d, r = 0.2, rx = 0, ry = 0, rz = 0) {
    const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
    return this.place(mat, new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, rr)), x, y, z, rx, ry, rz);
  }
  // Cylinder along an axis ("x", "y", or "z").
  cyl(mat, rt, rb, len, x, y, z, axis = "y", seg = 12, open = false, thetaStart = 0, thetaLen = TAU) {
    const g = new THREE.CylinderGeometry(rt, rb, len, seg, 1, open, thetaStart, thetaLen);
    if (axis === "x") g.rotateZ(-Math.PI / 2);
    else if (axis === "z") g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    return this.put(mat, g);
  }
  sphere(mat, r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 10) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return this.put(mat, g);
  }
  // Torus whose ring lies in the plane normal to `axis`.
  ring(mat, R, tube, x, y, z, axis = "x", seg = 22, arc = TAU, rot = 0) {
    const g = new THREE.TorusGeometry(R, tube, 5, seg, arc);
    if (rot) g.rotateZ(rot);
    if (axis === "x") g.rotateY(Math.PI / 2);
    else if (axis === "y") g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    return this.put(mat, g);
  }
  // A bar between two points in the y–z plane at a fixed x.
  strut(mat, x, z0, y0, z1, y1, w, t) {
    const dz = z1 - z0;
    const dy = y1 - y0;
    const len = Math.hypot(dz, dy);
    return this.box(mat, x, (y0 + y1) / 2, (z0 + z1) / 2, w, t, len, -Math.atan2(dy, dz));
  }
  // A round bar between two 3D points.
  rod(mat, a, b, r, seg = 6) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
    return this.put(mat, g);
  }
  // Extrude a side profile drawn in (z, y) across x, centred on x0.
  profile(mat, shape, width, x0 = 0, bevel = 0.1, curveSegments = 10) {
    const b = Math.min(bevel, width / 2 - 0.01);
    const depth = Math.max(0.01, width - 2 * b);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: b > 0,
      bevelThickness: b,
      bevelSize: b,
      bevelSegments: 2,
      curveSegments,
    });
    g.rotateY(-Math.PI / 2);
    g.translate(x0 + depth / 2, 0, 0);
    return this.put(mat, g);
  }
  // Build with an extra transform (applied before the kit's base).
  within(m, fn) {
    const prev = this.base;
    this.base = prev.clone().multiply(m);
    try {
      fn();
    } finally {
      this.base = prev;
    }
  }
  // Merge another kit's pieces into this one under a transform.
  absorb(other, m) {
    for (const [mat, geos] of other.parts) {
      if (!this.parts.has(mat)) this.parts.set(mat, []);
      for (const g of geos) this.parts.get(mat).push(g.applyMatrix4(m));
    }
  }
  merged() {
    const out = [];
    for (const [mat, geos] of this.parts) {
      if (!geos.length) continue;
      const geo = mergeGeometries(geos, false);
      if (geo) out.push([mat, geo]);
    }
    return out;
  }
  addTo(parent, shadow = true) {
    for (const [mat, geo] of this.merged()) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    return parent;
  }
}

// Build a Shape from a short command list in (z, y): ["M", z, y], ["L", z, y],
// ["Q", cz, cy, z, y], ["C", c1z, c1y, c2z, c2y, z, y], ["A", cz, cy, r, a0, a1, clockwise].
export function shp(cmds) {
  const s = new THREE.Shape();
  for (const c of cmds) {
    const [op, ...a] = c;
    if (op === "M") s.moveTo(a[0], a[1]);
    else if (op === "L") s.lineTo(a[0], a[1]);
    else if (op === "Q") s.quadraticCurveTo(a[0], a[1], a[2], a[3]);
    else if (op === "C") s.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
    else if (op === "A") s.absarc(a[0], a[1], a[2], a[3], a[4], Boolean(a[5]));
    else if (op === "W") {
      // Wheel arch cut into a bottom edge drawn rear-to-front: ["W", wheelZ, wheelCY, R, edgeY].
      const [wz, cy, R, yb] = a;
      const t = Math.asin(Math.max(-1, Math.min(1, (cy - yb) / R)));
      s.lineTo(wz - Math.cos(t) * R, yb);
      s.absarc(wz, cy, R, Math.PI + t, -t, true);
    }
  }
  return s;
}

// A crescent fender over a wheel in (z, y), extruded across x; optional tails.
function fenderShape(cz, cy, rIn, rOut, a0, a1, tailFront = null, tailRear = null) {
  const s = new THREE.Shape();
  const p = (r, a) => [cz + Math.cos(a) * r, cy + Math.sin(a) * r];
  const [sz, sy] = p(rIn, a0);
  s.moveTo(sz, sy);
  if (tailFront) s.lineTo(tailFront[0], tailFront[1]);
  const [oz, oy] = p(rOut, a0);
  s.lineTo(oz, oy);
  s.absarc(cz, cy, rOut, a0, a1, false);
  if (tailRear) s.lineTo(tailRear[0], tailRear[1]);
  const [ez, ey] = p(rIn, a1);
  s.lineTo(ez, ey);
  s.absarc(cz, cy, rIn, a1, a0, true);
  return s;
}

// ---------------------------------------------------------------- wheels
// Wooden artillery wheel (cars to the later 1920s) or carriage wheel (wagons, buggies).
function spokedWheel(k, x, cy, z, r, o) {
  const tw = o.tread ?? 0.28;
  const side = Math.sign(x) || 1;
  const tire = o.tire || F.tire();
  const rim = o.rim || o.spoke;
  if (o.pneumatic) {
    k.ring(tire, r - tw * 0.5, tw * 0.5, x, cy, z, "x", 24);
    k.ring(rim, r - tw * 0.95, 0.07, x, cy, z, "x", 22);
  } else {
    // Iron tyre over a wooden felloe.
    k.ring(tire, r - 0.04, 0.06, x, cy, z, "x", 24);
    k.cyl(rim, r - 0.08, r - 0.08, tw, x, cy, z, "x", 24, true);
    k.ring(rim, r - 0.16, 0.07, x, cy, z, "x", 22);
  }
  const n = o.spokes ?? 12;
  const inner = o.hubR ?? r * 0.2;
  const outer = r - (o.pneumatic ? tw * 0.9 : 0.15);
  const len = outer - inner;
  const mid = (outer + inner) / 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (o.phase || 0);
    k.box(o.spoke, x, cy + Math.sin(a) * mid, z + Math.cos(a) * mid, o.spokeW ?? 0.09, len, o.spokeD ?? 0.13, Math.PI / 2 - a);
  }
  const hl = o.hubLen ?? 0.6;
  k.cyl(o.hub || o.spoke, inner, inner, hl, x + side * hl * 0.15, cy, z, "x", 10);
  k.cyl(o.cap || F.iron(), inner * 0.55, inner * 0.7, 0.25, x + side * (hl * 0.65), cy, z, "x", 8);
}

// Steel disc wheel with hubcap and optional whitewall (1930s on).
function discWheel(k, x, cy, z, r, w, o = {}) {
  const side = Math.sign(x) || 1;
  k.cyl(F.tire(), r, r, w, x, cy, z, "x", 20);
  k.ring(F.tire(), r - w * 0.28, w * 0.34, x + side * 0.02, cy, z, "x", 20);
  if (o.whitewall) k.cyl(F.white(), r * o.whitewall, r * o.whitewall, w + 0.03, x, cy, z, "x", 20);
  k.cyl(o.rim || paintMat("#1d1d1d", 0.45, 0.4), r * 0.62, r * 0.62, w + 0.05, x, cy, z, "x", 18);
  k.cyl(F.chrome(), r * (o.cap ?? 0.42), r * (o.cap ?? 0.42) * 0.86, w + 0.12, x, cy, z, "x", 16);
  if (o.trim) k.ring(F.chrome(), r * 0.6, 0.035, x + side * (w / 2 + 0.03), cy, z, "x", 18);
}

// ---------------------------------------------------------------- horses
export function ensureColor(root) {
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.material?.vertexColors) return;
    const geo = mesh.geometry;
    if (!geo?.getAttribute("position") || geo.getAttribute("color")) return;
    const colors = new Float32Array(geo.getAttribute("position").count * 3);
    colors.fill(1);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  });
}

const HORSE_COATS = ["#5b3a24", "#3b2a1f", "#7a4f2e", "#6b5a4a", "#2a221d"];
// Horse facing +z built into a Kit: a driving horse of about 15 hands (withers ~5 ft),
// or with `heavy` a farm draft horse of about 16 hands with feathered fetlocks.
function horseInto(k, x, z, coat, heavy = false) {
  const hide = paintMat(coat || "#5b3a24", 0.78, 0);
  const dark = paintMat("#211a15", 0.8, 0);
  const strap = paintMat("#1b1612", 0.7, 0.05);
  const s = heavy ? 1.08 : 1;
  const bx = heavy ? 1.12 : 1;
  const cyB = 3.75 * s;
  // Barrel, chest, and quarters.
  k.cyl(hide, 0.86 * bx, 0.92 * bx, 3.4 * s, x, cyB, z, "z", 12);
  k.sphere(hide, 0.86, x, cyB - 0.05, z + 1.55 * s, bx * 0.95, 1.06, 1.05, 12);
  k.sphere(hide, 0.95, x, cyB + 0.12, z - 1.5 * s, bx * 0.98, 1.05, 1.02, 12);
  // Neck rising to the poll; head angled down to the muzzle.
  const poll = [x, cyB + 2.2 * s, z + 2.8 * s];
  const muzzle = [x, cyB + 0.95 * s, z + 3.75 * s];
  k.rod(hide, [x, cyB + 0.45, z + 1.65 * s], poll, 0.45 * bx, 9);
  k.rod(hide, [x, cyB + 0.05, z + 1.95 * s], [x, cyB + 1.85 * s, z + 2.95 * s], 0.38 * bx, 8);
  k.rod(hide, poll, muzzle, 0.3 * bx, 8);
  k.sphere(hide, 0.34, poll[0], poll[1] - 0.15, poll[2] + 0.1, bx, 1, 1.15, 8);
  k.sphere(dark, 0.24, muzzle[0], muzzle[1] - 0.05, muzzle[2] + 0.05, bx, 0.9, 1.2, 8);
  for (const sd of [-1, 1]) {
    k.place(dark, new THREE.ConeGeometry(0.09, 0.4, 5), x + sd * 0.16, poll[1] + 0.28, poll[2] - 0.08, -0.25, 0, sd * 0.2);
    k.sphere(dark, 0.06, x + sd * 0.27, poll[1] - 0.45, poll[2] + 0.45, 1, 1, 1, 6);
    // Bridle cheek piece and blinker.
    k.rod(strap, [x + sd * 0.3, poll[1] - 0.05, poll[2] + 0.05], [x + sd * 0.27, muzzle[1] + 0.05, muzzle[2] - 0.1], 0.035, 4);
    k.box(strap, x + sd * 0.34, poll[1] - 0.4, poll[2] + 0.35, 0.04, 0.32, 0.32, 0.6);
  }
  // Mane along the crest.
  k.rod(dark, [x, cyB + 0.95, z + 1.6 * s], [x, poll[1] + 0.1, poll[2] - 0.15], 0.13, 5);
  // Legs: forearm/gaskin, cannon, fetlock and hoof.
  const leg = (lx, lz, front) => {
    const top = cyB - 0.55;
    const knee = 1.55;
    k.place(hide, new THREE.CylinderGeometry(front ? 0.24 : 0.3, 0.15, top - knee, 7), x + lx, (top + knee) / 2, lz);
    k.place(dark, new THREE.CylinderGeometry(0.12, heavy ? 0.18 : 0.12, knee - 0.3, 6), x + lx, knee / 2 + 0.15, lz + (front ? 0.02 : -0.05));
    k.place(dark, new THREE.CylinderGeometry(heavy ? 0.2 : 0.15, heavy ? 0.23 : 0.17, 0.3, 7), x + lx, 0.15, lz + 0.05);
  };
  leg(-0.42 * bx, z + 1.35 * s, true);
  leg(0.42 * bx, z + 1.2 * s, true);
  leg(-0.46 * bx, z - 1.45 * s, false);
  leg(0.46 * bx, z - 1.3 * s, false);
  // Tail.
  k.rod(dark, [x, cyB + 0.6, z - 2.3 * s], [x, cyB - 1.3, z - 2.65 * s], 0.16, 6);
  // Harness: collar and brass hames, back pad and bellyband, breeching, traces.
  k.ring(strap, 0.55 * bx, 0.14, x, cyB + 0.85, z + 1.95 * s, "z", 14);
  k.ring(F.brass(), 0.64 * bx, 0.04, x, cyB + 0.92, z + 2.02 * s, "z", 12, Math.PI * 1.1, -0.05);
  k.box(strap, x, cyB + 0.93, z + 0.1, 0.7, 0.12, 0.8);
  k.ring(strap, 0.98 * bx, 0.05, x, cyB, z + 0.15, "z", 14);
  k.ring(strap, 1.0 * bx, 0.05, x, cyB + 0.05, z - 1.75 * s, "z", 14, Math.PI * 1.2, -0.1);
  for (const sd of [-1, 1]) k.box(strap, x + sd * 0.9 * bx, cyB - 0.1, z - 0.45, 0.06, 0.1, 4.6);
}

// ---------------------------------------------------------------- wagons
function wagonWheelSet(k, xs, cy, z, r, spokes, paint, tread = 0.22) {
  for (const x of xs) {
    spokedWheel(k, x, cy, z, r, { spokes, spoke: paint, rim: paint, hub: paint, tire: F.iron(), tread, hubR: 0.3, hubLen: 0.85, spokeW: 0.1, spokeD: 0.15 });
  }
}

// Farm or freight wagon (Studebaker/Bain pattern) with a pair of draft horses on the pole.
// Green box and red running gear were the common factory finish (estimate).
function farmWagon(k, variant, h) {
  const box = paintMat(variant === "freight" ? "#5d4a36" : "#3f5a3a", 0.75, 0);
  const gear = paintMat("#8a3426", 0.7, 0);
  const stripe = paintMat("#c9a24a", 0.6, 0.1);
  const iron = F.iron();
  const wood = paintMat("#8a6a45", 0.85, 0);
  const longBox = variant === "freight" ? 12 : 10.5;
  const zr = -3.9;
  const zf = 3.0;
  const rr = 2.2;
  const rf = 1.85;
  // Running gear: axles, bolsters, reach, hounds.
  k.cyl(iron, 0.12, 0.12, 5.2, 0, rr, zr, "x", 8);
  k.cyl(iron, 0.12, 0.12, 5.0, 0, rf, zf, "x", 8);
  k.box(gear, 0, rr + 0.25, zr, 4.4, 0.32, 0.42);
  k.box(gear, 0, rr + 0.62, zr, 3.7, 0.38, 0.4);
  k.box(gear, 0, rf + 0.25, zf, 4.2, 0.3, 0.4);
  k.box(gear, 0, rf + 0.62, zf, 3.6, 0.32, 0.38);
  k.box(gear, 0, rf + 0.98, zf, 3.6, 0.34, 0.42);
  k.box(gear, 0, rr - 0.1, (zr + zf) / 2 - 0.6, 0.24, 0.22, zf - zr + 2.8);
  for (const sd of [-1, 1]) {
    k.strut(gear, sd * 0.85, zf + 0.1, rf + 0.15, zf - 3.2, rr - 0.05, 0.16, 0.16);
    k.strut(gear, sd * 0.75, zr - 0.1, rr + 0.1, zr + 2.4, rr - 0.08, 0.14, 0.14);
  }
  wagonWheelSet(k, [-2.45, 2.45], rr, zr, rr, 14, gear);
  wagonWheelSet(k, [-2.35, 2.35], rf, zf, rf, 12, gear);
  // Box: floor, lower box, flare boards (top box), cleats and irons.
  const yb = rr + 0.85;
  const zc = -0.35;
  const hw = variant === "freight" ? 1.85 : 1.68;
  const lowH = variant === "freight" ? 1.5 : 1.15;
  k.box(box, 0, yb, zc, hw * 2, 0.16, longBox);
  for (const sd of [-1, 1]) {
    k.box(box, sd * hw, yb + lowH / 2, zc, 0.12, lowH, longBox);
    k.box(stripe, sd * (hw + 0.07), yb + lowH - 0.15, zc, 0.02, 0.06, longBox - 0.3);
    k.box(box, sd * (hw + 0.14), yb + lowH + 0.42, zc, 0.1, 0.85, longBox - 0.05, 0, 0, -sd * 0.18);
    for (let i = 0; i < 6; i++) {
      const cz = zc - longBox / 2 + 0.4 + (i * (longBox - 0.8)) / 5;
      k.box(iron, sd * (hw + 0.08), yb + lowH / 2, cz, 0.05, lowH + 0.1, 0.14);
      k.box(iron, sd * (hw + 0.23), yb + lowH + 0.4, cz, 0.05, 0.85, 0.12, 0, 0, -sd * 0.18);
    }
  }
  for (const ez of [zc - longBox / 2, zc + longBox / 2]) {
    k.box(box, 0, yb + lowH / 2, ez, hw * 2 + 0.12, lowH, 0.12);
    k.box(iron, 0, yb + lowH * 0.35, ez + Math.sign(ez) * 0.08, hw * 2 + 0.3, 0.06, 0.05);
  }
  // Spring seat across the box.
  const sz = zc + longBox / 2 - 1.4;
  const sy = yb + lowH + 1.05;
  for (const sd of [-1, 1]) k.box(iron, sd * 1.2, sy - 0.35, sz, 0.12, 0.55, 0.9);
  k.box(wood, 0, sy, sz, 3.5, 0.14, 1.05);
  k.box(wood, 0, sy + 0.45, sz - 0.55, 3.5, 0.6, 0.1, 0.12);
  // Load.
  const sack = paintMat("#c8b48a", 0.95, 0);
  if (variant === "freight") {
    const crate = paintMat("#a58456", 0.9, 0);
    const barrel = paintMat("#7b5a36", 0.85, 0);
    k.box(crate, -0.7, yb + 0.85, zc - 2.5, 1.9, 1.6, 2.2);
    k.box(crate, 0.85, yb + 0.7, zc - 2.3, 1.5, 1.3, 1.8);
    k.cyl(barrel, 0.75, 0.82, 2.1, -0.6, yb + 1.1, zc + 0.6, "y", 10);
    k.cyl(barrel, 0.75, 0.82, 2.1, 0.9, yb + 1.1, zc + 0.9, "y", 10);
    k.box(crate, 0, yb + 0.6, zc + 2.6, 2.8, 1.1, 1.6);
  } else if (h % 2 === 0) {
    for (let i = 0; i < 5; i++) k.rbox(sack, -0.8 + (i % 2) * 1.5, yb + 0.5 + Math.floor(i / 2) * 0.5, zc - 3 + i * 0.9, 1.3, 0.75, 1.9, 0.3, 0, 0.2 * (i % 3), 0);
  }
  // Pole (tongue), doubletree, singletrees, neck yoke.
  const tipZ = zf + 9.2;
  k.strut(gear, 0, zf + 0.5, rf + 0.35, tipZ, 3.9, 0.24, 0.26);
  k.box(gear, 0, rf + 0.55, zf + 1.6, 3.4, 0.16, 0.2);
  for (const sd of [-1, 1]) k.box(gear, sd * 1.55, rf + 0.55, zf + 1.85, 2.0, 0.12, 0.16);
  k.box(gear, 0, 4.05, tipZ - 1.0, 3.4, 0.16, 0.18);
  // Team either side of the pole.
  horseInto(k, -1.6, zf + 6.4, HORSE_COATS[h % HORSE_COATS.length], true);
  horseInto(k, 1.6, zf + 6.4, HORSE_COATS[(h + 2) % HORSE_COATS.length], true);
}

// Top buggy or two-seat surrey on light wheels, one driving horse in shafts.
function townRig(k, variant, h) {
  const surrey = variant === "surrey";
  const body = paintMat("#141312", 0.35, 0.15);
  const gear = paintMat(h % 2 ? "#7e2a22" : "#1a1918", 0.45, 0.1);
  const leather = F.leather();
  const top = F.canvas();
  const zr = surrey ? -3.0 : -2.3;
  const zf = surrey ? 3.1 : 2.4;
  const rr = 1.85;
  const rf = 1.68;
  k.cyl(F.iron(), 0.08, 0.08, 4.8, 0, rr, zr, "x", 8);
  k.cyl(F.iron(), 0.08, 0.08, 4.6, 0, rf, zf, "x", 8);
  for (const x of [-2.35, 2.35]) {
    spokedWheel(k, x, rr, zr, rr, { spokes: 16, spoke: gear, rim: gear, hub: gear, tire: F.iron(), tread: 0.12, hubR: 0.22, hubLen: 0.6, spokeW: 0.06, spokeD: 0.08 });
    spokedWheel(k, x, rf, zf, rf, { spokes: 14, spoke: gear, rim: gear, hub: gear, tire: F.iron(), tread: 0.12, hubR: 0.2, hubLen: 0.55, spokeW: 0.06, spokeD: 0.08 });
  }
  // Elliptic springs over each axle and a perch between them.
  for (const [zz, ry] of [[zr, rr], [zf, rf]]) {
    const g = new THREE.TorusGeometry(0.42, 0.045, 4, 16);
    g.scale(2.4, 0.42, 1);
    k.place(F.iron(), g, 0, ry + 0.55, zz);
  }
  k.box(gear, 0, rr + 0.2, (zr + zf) / 2, 0.16, 0.14, zf - zr);
  // Body: piano box, dash, seat(s).
  const len = surrey ? 7.6 : 5.6;
  const zc = (zr + zf) / 2 + 0.1;
  const yb = rr + 0.95;
  k.box(body, 0, yb + 0.4, zc, 2.1, 0.85, len);
  k.box(F.brass(), 0, yb + 0.86, zc, 2.16, 0.05, len + 0.04);
  k.box(body, 0, yb + 1.0, zc + len / 2 - 0.05, 2.0, 1.1, 0.06, -0.28);
  const seats = surrey ? [zc + 0.9, zc - 2.0] : [zc - 0.9];
  for (const s of seats) {
    k.rbox(leather, 0, yb + 1.15, s, 2.4, 0.42, 1.35, 0.12);
    k.rbox(body, 0, yb + 0.95, s, 2.45, 0.3, 1.4, 0.08);
    k.rbox(leather, 0, yb + 1.75, s - 0.7, 2.4, 0.95, 0.18, 0.08, -0.12);
    for (const sd of [-1, 1]) k.box(body, sd * 1.2, yb + 1.5, s - 0.2, 0.08, 0.5, 1.0);
  }
  if (surrey) {
    // Flat fringed canopy on four posts.
    const ty = yb + 4.0;
    for (const sd of [-1, 1]) for (const pz of [zc + 1.8, zc - 2.7]) k.cyl(F.iron(), 0.04, 0.04, ty - yb - 1.0, sd * 1.15, (ty + yb + 1.0) / 2, pz, "y", 5);
    k.rbox(top, 0, ty, zc - 0.45, 2.7, 0.14, 5.1, 0.05);
    const fringe = paintMat("#d8cdb0", 0.9, 0);
    for (const sd of [-1, 1]) k.box(fringe, sd * 1.37, ty - 0.2, zc - 0.45, 0.04, 0.3, 5.1);
    for (const ez of [zc + 2.1, zc - 3.0]) k.box(fringe, 0, ty - 0.2, ez, 2.75, 0.3, 0.04);
  } else {
    // Folding leather top on bows, raised.
    const s = seats[0];
    const cy = yb + 2.15;
    k.cyl(top, 1.22, 1.22, 1.5, 0, cy, s - 0.35, "z", 16, true, -Math.PI / 2, Math.PI);
    k.box(top, 0, cy - 0.4, s - 1.1, 2.44, 0.8, 0.05);
    const back = new THREE.CircleGeometry(1.22, 16, 0, Math.PI);
    k.place(top, back, 0, cy, s - 1.1);
    for (const bz of [s - 1.05, s - 0.55, s + 0.35]) k.ring(F.iron(), 1.23, 0.03, 0, cy, bz, "z", 14, Math.PI);
    for (const sd of [-1, 1]) k.strut(F.iron(), sd * 1.22, s + 0.4, cy, s - 0.2, yb + 1.2, 0.05, 0.05);
  }
  // Shafts to the horse, crossbar, whiffletree.
  const ys = yb + 0.15;
  for (const sd of [-1, 1]) k.strut(gear, sd * 1.05, zf + 0.2, ys, zf + 8.6, 3.95, 0.12, 0.14);
  k.box(gear, 0, ys + 0.05, zf + 0.6, 2.2, 0.12, 0.14);
  k.box(gear, 0, ys + 0.1, zf + 1.0, 1.6, 0.1, 0.12);
  horseInto(k, 0, zf + 5.4, HORSE_COATS[(h + 1) % HORSE_COATS.length], false);
}

// Wagon kind by year and slot (estimates; SOURCES.md).
export function wagonKindFor(year, slot) {
  if (year >= 1925) return slot % 3 === 1 ? "freight" : "farm";
  const kinds = year < 1890 ? ["farm", "freight", "buggy"] : ["farm", "surrey", "buggy"];
  return kinds[slot % 3];
}

export function makeWagon(kind = "farm", seed = 0) {
  const g = new THREE.Group();
  const k = new Kit();
  if (kind === "buggy" || kind === "surrey") townRig(k, kind, seed);
  else farmWagon(k, kind, seed);
  k.addTo(g);
  return g;
}

// Saddle horse tied at a rail.
export function makeHorse(seed = 0) {
  const g = new THREE.Group();
  const k = new Kit();
  horseInto(k, 0, 0, HORSE_COATS[seed % HORSE_COATS.length], false);
  const leather = paintMat("#4a2e1d", 0.7, 0);
  k.rbox(leather, 0, 4.72, 0.1, 1.5, 0.3, 1.9, 0.12);
  k.rbox(leather, 0, 4.92, -0.65, 1.1, 0.42, 0.35, 0.1);
  k.box(leather, 0, 4.85, 0.75, 0.4, 0.4, 0.3);
  for (const sd of [-1, 1]) k.box(leather, sd * 0.8, 4.0, 0.1, 0.06, 1.3, 0.9);
  k.addTo(g);
  return g;
}

// ---------------------------------------------------------------- motor cars
// Each model is built facing +z, centred on the origin, ground at y = 0, in feet.
// Left-hand drive puts the driver at +x (car faces +z); brass-era cars were often right-hand
// drive. Every builder returns the car's overall length for curb spacing.

function fourWheels(k, track, zf, zr, fn) {
  for (const x of [-track, track]) for (const z of [zf, zr]) fn(x, z);
}

function steering(k, x, y, z, r, rimMat) {
  const g = new THREE.TorusGeometry(r, 0.045, 5, 16);
  k.place(rimMat, g, x, y, z, -2.25);
  k.rod(F.black(), [x, y, z], [x, y - 0.9, z + 1.0], 0.05, 5);
}

function headlamp(k, x, y, z, r, shell, len = 0.5) {
  k.cyl(shell, r, r * 0.85, len, x, y, z, "z", 12);
  k.cyl(F.lens(), r * 0.88, r * 0.88, 0.04, x, y, z + len / 2 + 0.01, "z", 12);
}

function plate(k, z, y, faceSign) {
  k.box(paintMat("#d9cf6a", 0.5, 0.1), 0, y, z + faceSign * 0.02, 1.0, 0.5, 0.04);
}

// Brass-era runabout (about 1905-1910, Olds/Ford N type) or five-seat touring car
// (about 1909-1913): 32-34 inch wood artillery wheels, brass radiator and lamps.
function brassCar(k, kind, pal) {
  const tour = kind === "touring";
  const body = paintMat(pal.body, 0.38, 0.2);
  const trim = paintMat(pal.accent || "#141414", 0.5, 0.2);
  const wood = paintMat("#b0834a", 0.55, 0.05);
  const r = tour ? 1.42 : 1.32;
  const track = tour ? 2.3 : 2.15;
  const zf = tour ? 4.3 : 3.3;
  const zr = tour ? -4.3 : -3.3;
  fourWheels(k, track, zf, zr, (x, z) =>
    spokedWheel(k, x, r, z, r, { pneumatic: true, tread: 0.3, spokes: 12, spoke: wood, rim: wood, hub: wood, cap: F.brass(), hubR: 0.26, hubLen: 0.5 }),
  );
  k.cyl(F.iron(), 0.07, 0.07, track * 2, 0, r, zf, "x", 6);
  k.cyl(F.iron(), 0.09, 0.09, track * 2, 0, r, zr, "x", 6);
  for (const sd of [-1, 1]) k.box(F.black(), sd * 1.4, 1.85, (zf + zr) / 2 + 0.3, 0.18, 0.35, zf - zr + 2.6);
  // Brass radiator, hood, wooden dash with oil side lamps.
  const zRad = zf + 1.05;
  const hoodLen = tour ? 2.6 : 1.8;
  k.rbox(F.brass(), 0, 3.0, zRad, 2.35, 1.85, 0.3, 0.1);
  k.box(paintMat("#2a2725", 0.8, 0.2), 0, 3.0, zRad + 0.12, 2.0, 1.5, 0.1);
  k.rbox(body, 0, 2.95, zRad - 0.15 - hoodLen / 2, 2.2, 1.35, hoodLen, 0.22);
  const zDash = zRad - 0.15 - hoodLen;
  k.box(wood, 0, 3.0, zDash, 3.4, 1.5, 0.12);
  for (const sd of [-1, 1]) {
    k.cyl(F.brass(), 0.16, 0.2, 0.5, sd * 1.85, 3.5, zDash + 0.12, "y", 8);
    k.sphere(F.brass(), 0.14, sd * 1.85, 3.85, zDash + 0.12, 1, 1, 1, 8);
  }
  // Acetylene headlamps on fork brackets ahead of the radiator.
  for (const sd of [-1, 1]) {
    headlamp(k, sd * 0.95, 3.15, zRad + 0.6, 0.42, F.brass(), 0.6);
    k.box(F.brass(), sd * 0.95, 2.6, zRad + 0.4, 0.07, 0.8, 0.07);
  }
  if (tour) {
    // Tonneau with a rear door step and the rounded "tulip" back.
    k.profile(body, shp([["M", -5.45, 1.95], ["L", zDash, 1.95], ["L", zDash, 3.6], ["L", -0.9, 3.75], ["L", -1.2, 4.05], ["L", -5.0, 4.05], ["Q", -5.95, 3.95, -5.6, 2.6], ["L", -5.45, 1.95]]), 4.3, 0, 0.14);
    k.box(trim, 0, 3.75, -1.05, 4.4, 0.05, 0.04);
    k.rbox(F.leather(), 0, 3.95, 0.4, 3.7, 0.45, 1.6, 0.12);
    k.rbox(F.leather(), 0, 4.55, -0.45, 3.9, 1.3, 0.4, 0.15, -0.12);
    k.rbox(F.leather(), 0, 4.15, -3.6, 3.9, 0.45, 1.9, 0.12);
    k.rbox(F.leather(), 0, 4.75, -4.75, 4.1, 1.5, 0.45, 0.18, -0.15);
    // Upright windshield in a brass frame and the folded top at the back.
    k.box(F.glass(), 0, 4.55, zDash - 0.05, 3.3, 1.5, 0.05);
    k.box(F.brass(), 0, 5.32, zDash - 0.05, 3.4, 0.07, 0.08);
    k.box(F.brass(), 0, 3.8, zDash - 0.05, 3.4, 0.07, 0.08);
    for (const sd of [-1, 1]) k.box(F.brass(), sd * 1.68, 4.55, zDash - 0.05, 0.07, 1.6, 0.08);
    k.rbox(F.canvas(), 0, 4.7, -5.75, 4.2, 0.65, 1.0, 0.28);
    for (const sd of [-1, 1]) k.strut(F.black(), sd * 2.05, -5.7, 4.6, -3.2, 3.9, 0.05, 0.06);
    steering(k, -1.0, 4.85, -0.05, 0.62, wood);
  } else {
    // Runabout: one seat and a rear deck.
    k.profile(body, shp([["M", -4.6, 2.0], ["L", zDash, 2.0], ["L", zDash, 3.4], ["L", -0.6, 3.5], ["L", -2.6, 3.4], ["Q", -4.7, 3.4, -4.6, 2.0]]), 3.6, 0, 0.14);
    k.rbox(F.leather(), 0, 3.75, -0.7, 3.3, 0.45, 1.5, 0.12);
    k.rbox(F.leather(), 0, 4.35, -1.55, 3.5, 1.2, 0.4, 0.15, -0.12);
    steering(k, -0.85, 4.6, -0.1, 0.55, wood);
  }
  // Fenders and running boards (the boards carry a tool box and the horn).
  const fm = paintMat(pal.fender || "#161616", 0.45, 0.15);
  for (const sd of [-1, 1]) {
    k.profile(fm, fenderShape(zf, r, r + 0.12, r + 0.22, 0.45, Math.PI), 0.85, sd * track, 0.04);
    k.profile(fm, fenderShape(zr, r, r + 0.12, r + 0.22, 0, Math.PI - 0.5), 0.85, sd * track, 0.04);
    k.box(paintMat("#2a2a2a", 0.9, 0), sd * track, 1.35, (zf + zr) / 2 - 0.1, 0.85, 0.08, zf - zr - 2 * r - 0.35);
    for (const zz of [zf - r - 0.2, zr + r + 0.2]) k.box(F.iron(), sd * (track - 0.3), 1.6, zz, 0.08, 0.5, 0.08);
  }
  k.box(paintMat("#1a1a1a", 0.7, 0.1), -track, 1.75, -0.2, 0.6, 0.5, 1.2);
  k.cyl(F.brass(), 0.05, 0.2, 0.8, track - 0.25, 3.3, zDash + 0.5, "z", 8);
  return tour ? 12.6 : 10.4;
}

// Black Model T-type touring car with the top up (about 1915-1927).
function modelT(k, pal) {
  const body = paintMat(pal.body, 0.4, 0.15);
  const black = F.black();
  const wood = paintMat("#5a4027", 0.6, 0.05);
  const r = 1.25;
  const track = 2.33;
  const zf = 4.17;
  const zr = -4.17;
  fourWheels(k, track, zf, zr, (x, z) =>
    spokedWheel(k, x, r, z, r, { pneumatic: true, tread: 0.27, spokes: 12, spoke: wood, rim: wood, hub: wood, cap: F.nickel(), hubR: 0.22, hubLen: 0.45 }),
  );
  k.cyl(F.iron(), 0.07, 0.07, track * 2, 0, r, zf, "x", 6);
  k.cyl(F.iron(), 0.09, 0.09, track * 2, 0, r, zr, "x", 6);
  k.cyl(F.iron(), 0.05, 0.05, track * 1.6, 0, r + 0.65, zf + 0.2, "x", 6);
  for (const sd of [-1, 1]) k.box(black, sd * 1.25, 1.6, 0, 0.14, 0.3, 10.6);
  // Black radiator shell, tall narrow hood, curved cowl (1917 on).
  k.rbox(body, 0, 2.95, 5.25, 2.25, 1.95, 0.32, 0.12);
  k.box(paintMat("#2b2926", 0.85, 0.2), 0, 2.85, 5.4, 1.85, 1.5, 0.05);
  k.rbox(body, 0, 2.9, 3.75, 2.1, 1.25, 2.8, 0.2);
  k.profile(body, shp([["M", 1.15, 2.1], ["L", 2.4, 2.1], ["L", 2.4, 3.55], ["Q", 1.9, 3.95, 1.15, 4.0], ["L", 1.15, 2.1]]), 3.4, 0, 0.18);
  // Touring body.
  k.profile(body, shp([["M", -5.25, 1.85], ["L", 1.2, 1.85], ["L", 1.2, 3.95], ["L", -1.05, 3.85], ["L", -5.0, 3.85], ["Q", -5.75, 3.7, -5.45, 2.5], ["L", -5.25, 1.85]]), 4.4, 0, 0.12);
  k.rbox(F.leather(), 0, 4.2, -0.3, 3.9, 1.0, 0.4, 0.12, -0.1);
  k.rbox(F.leather(), 0, 4.45, -4.6, 4.0, 1.3, 0.4, 0.12, -0.12);
  // Two-piece windshield and the folding top raised on its bows.
  k.box(F.glass(), 0, 4.95, 1.1, 3.6, 1.8, 0.05);
  k.box(black, 0, 4.95, 1.1, 3.7, 0.06, 0.08);
  for (const sd of [-1, 1]) k.box(black, sd * 1.82, 5.0, 1.12, 0.07, 2.0, 0.09);
  const topY = 6.75;
  k.rbox(F.canvas(), 0, topY, -1.85, 4.6, 0.16, 6.2, 0.06);
  k.profile(F.canvas(), shp([["M", -4.7, 3.9], ["L", -4.95, topY - 0.1], ["L", -4.65, topY], ["L", -4.4, 3.9], ["L", -4.7, 3.9]]), 4.5, 0, 0.03);
  for (const sd of [-1, 1]) {
    k.box(black, sd * 2.22, (topY + 3.9) / 2, 1.0, 0.07, topY - 3.9, 0.07);
    k.strut(black, sd * 2.22, -1.8, 3.9, -2.4, topY - 0.05, 0.06, 0.06);
  }
  // Fenders sweep down to the running boards; nickel-rimmed headlamps on the fender brace.
  for (const sd of [-1, 1]) {
    k.profile(black, fenderShape(zf, r, r + 0.1, r + 0.2, 0.5, Math.PI + 0.1), 0.8, sd * track, 0.03);
    k.profile(black, fenderShape(zr, r, r + 0.1, r + 0.2, -0.1, Math.PI - 0.55), 0.8, sd * track, 0.03);
    k.box(paintMat("#262626", 0.9, 0), sd * track, 1.15, 0, 0.8, 0.07, zf - zr - 2 * r - 0.3);
    headlamp(k, sd * 1.05, 3.3, 5.6, 0.36, black, 0.45);
    k.cyl(F.nickel(), 0.37, 0.37, 0.05, sd * 1.05, 3.3, 5.83, "z", 12);
  }
  k.cyl(black, 0.04, 0.04, 2.2, 0, 2.85, 5.6, "x", 5);
  steering(k, 1.0, 4.65, -0.25, 0.6, wood);
  return 11.1;
}

// Closed two-door sedan of the later 1920s (Model A / Chevrolet type): upright cabin,
// nickel radiator shell, bowl headlamps on a tie bar, wire wheels, spare at the back.
function sedan20s(k, pal) {
  const body = paintMat(pal.body, 0.36, 0.2);
  const fm = paintMat("#141414", 0.4, 0.2);
  const r = 1.2;
  const track = 2.35;
  const zf = 4.3;
  const zr = -4.3;
  const wheelPaint = paintMat(pal.wheel || "#1b1b1b", 0.45, 0.3);
  fourWheels(k, track, zf, zr, (x, z) =>
    spokedWheel(k, x, r, z, r, { pneumatic: true, tread: 0.4, spokes: 24, spoke: wheelPaint, rim: wheelPaint, hub: wheelPaint, cap: F.chrome(), hubR: 0.3, hubLen: 0.35, spokeW: 0.035, spokeD: 0.04, phase: 0.1 }),
  );
  for (const sd of [-1, 1]) k.box(F.black(), sd * 1.3, 1.6, 0, 0.14, 0.3, 11);
  k.rbox(F.nickel(), 0, 2.95, 5.6, 2.4, 2.05, 0.3, 0.14);
  k.box(paintMat("#24221f", 0.85, 0.2), 0, 2.9, 5.76, 1.95, 1.65, 0.04);
  k.rbox(body, 0, 2.95, 3.75, 2.35, 1.45, 3.4, 0.2);
  for (let i = 0; i < 8; i++) for (const sd of [-1, 1]) k.box(fm, sd * 1.19, 2.95, 4.6 - i * 0.18, 0.02, 0.6, 0.06);
  k.box(F.chrome(), 0, 3.0, 5.95, 2.6, 0.06, 0.06);
  for (const sd of [-1, 1]) {
    k.sphere(F.chrome(), 0.42, sd * 1.15, 3.2, 5.95, 1, 1, 0.75, 12);
    k.cyl(F.lens(), 0.36, 0.36, 0.03, sd * 1.15, 3.2, 6.27, "z", 12);
  }
  // One-piece body and cabin in side profile; window glass let into it.
  k.profile(body, shp([["M", -5.55, 1.85], ["L", 2.05, 1.85], ["L", 2.05, 3.65], ["L", 1.75, 4.0], ["L", 1.55, 6.0], ["L", -3.5, 6.05], ["Q", -4.3, 6.02, -4.45, 5.3], ["L", -4.7, 3.75], ["Q", -5.6, 3.6, -5.55, 1.85]]), 4.55, 0, 0.14);
  k.profile(F.glass(), shp([["M", 1.35, 4.2], ["L", 1.25, 5.65], ["L", -1.1, 5.65], ["L", -1.1, 4.2], ["L", 1.35, 4.2]]), 4.62, 0, 0);
  k.profile(F.glass(), shp([["M", -1.45, 4.2], ["L", -1.45, 5.65], ["L", -3.4, 5.65], ["Q", -3.95, 5.6, -4.0, 4.95], ["L", -4.1, 4.2], ["L", -1.45, 4.2]]), 4.62, 0, 0);
  k.box(F.glass(), 0, 5.0, 1.67, 3.8, 1.5, 0.05, -0.1);
  k.box(F.glass(), 0, 5.05, -4.47, 1.6, 0.6, 0.05);
  k.box(paintMat("#191919", 0.7, 0.05), 0, 6.06, -1.1, 3.9, 0.06, 4.6);
  k.box(F.chrome(), 0, 3.75, -1.2, 4.6, 0.05, 6.6);
  // Fenders, running boards, bumpers, spare tyre.
  for (const sd of [-1, 1]) {
    k.profile(fm, fenderShape(zf, r, r + 0.12, r + 0.28, 0.35, Math.PI + 0.15), 1.0, sd * (track + 0.05), 0.05);
    k.profile(fm, fenderShape(zr, r, r + 0.12, r + 0.28, -0.1, Math.PI - 0.3), 1.0, sd * (track + 0.05), 0.05);
    k.box(paintMat("#222", 0.9, 0), sd * (track + 0.05), 1.3, 0, 1.0, 0.07, zf - zr - 2 * r - 0.5);
  }
  for (const zz of [6.4, -6.2]) for (const dy of [0, 0.32]) k.box(F.chrome(), 0, 1.45 + dy, zz, 5.0, 0.13, 0.07);
  k.within(new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 3.1, -5.95), () =>
    spokedWheel(k, -0.01, 0, 0, r, { pneumatic: true, tread: 0.4, spokes: 24, spoke: wheelPaint, rim: wheelPaint, hub: wheelPaint, cap: F.chrome(), hubR: 0.3, hubLen: 0.3, spokeW: 0.035, spokeD: 0.04 }),
  );
  plate(k, -6.35, 2.2, -1);
  return 13.1;
}

// Streamlined sedan of about 1936-1948: rounded body, pontoon fenders with lamps, running
// boards, waterfall grille, pressed-steel wheels with hubcaps.
function rounded40s(k, pal) {
  const body = paintMat(pal.body, 0.3, 0.3);
  const r = 1.18;
  const track = 2.42;
  const zf = 4.8;
  const zr = -4.9;
  fourWheels(k, track, zf, zr, (x, z) => discWheel(k, x, r, z, r, 0.55, { cap: 0.4, whitewall: pal.whitewall ? 0.82 : 0, rim: paintMat(pal.body, 0.35, 0.3) }));
  k.profile(body, shp([["M", -7.55, 1.6], ["W", zr, r, 1.42, 1.6], ["W", zf, r, 1.42, 1.6], ["L", 7.45, 1.6], ["Q", 7.85, 2.6, 7.35, 3.35], ["Q", 6.9, 3.6, 5.0, 3.75], ["L", 2.0, 3.95], ["L", 1.4, 4.0], ["L", -4.6, 4.0], ["Q", -6.6, 3.85, -7.45, 2.9], ["Q", -7.75, 2.3, -7.55, 1.6]]), 4.6, 0, 0.3, 12);
  k.profile(body, shp([["M", 1.5, 3.9], ["Q", 0.4, 5.25, -0.6, 5.5], ["Q", -2.4, 5.75, -3.6, 5.35], ["Q", -4.6, 4.8, -5.1, 3.9], ["L", 1.5, 3.9]]), 4.2, 0, 0.25, 12);
  k.profile(F.glass(), shp([["M", 0.95, 4.25], ["Q", 0.2, 5.1, -0.5, 5.25], ["L", -1.55, 5.3], ["L", -1.55, 4.25], ["L", 0.95, 4.25]]), 4.72, 0, 0);
  k.profile(F.glass(), shp([["M", -1.85, 4.25], ["L", -1.85, 5.3], ["L", -3.3, 5.2], ["Q", -4.0, 4.85, -4.25, 4.25], ["L", -1.85, 4.25]]), 4.72, 0, 0);
  k.profile(F.glass(), shp([["M", 1.62, 4.0], ["Q", 0.5, 5.33, -0.45, 5.6], ["L", -0.55, 5.48], ["Q", 0.42, 5.2, 1.45, 3.98], ["L", 1.62, 4.0]]), 3.7, 0, 0.02);
  k.box(F.glass(), 0, 4.75, -4.35, 2.4, 0.65, 0.05, 0.8);
  // Pontoon fenders, with headlamps faired into the front pair.
  const fm = paintMat(pal.fender || pal.body, 0.3, 0.3);
  for (const sd of [-1, 1]) {
    const x = sd * 2.5;
    k.profile(fm, shp([["M", zf + 2.05, 1.5], ["Q", zf + 2.25, 2.85, zf + 0.5, 3.05], ["Q", zf - 1.3, 3.05, zf - 2.5, 1.75], ["L", zf - 2.5, 1.35], ["W", zf, r, 1.38, 1.35], ["L", zf + 2.05, 1.5]]), 1.15, x, 0.18, 12);
    k.profile(fm, shp([["M", zr + 1.6, 1.4], ["Q", zr + 1.6, 2.8, zr + 0.1, 2.9], ["Q", zr - 1.7, 2.85, zr - 2.25, 1.6], ["L", zr - 2.25, 1.35], ["W", zr, r, 1.38, 1.35], ["L", zr + 1.6, 1.4]]), 1.1, x, 0.18, 12);
    k.sphere(fm, 0.42, sd * 2.25, 2.75, zf + 1.35, 1, 1, 1.5, 10);
    k.cyl(F.chrome(), 0.37, 0.37, 0.05, sd * 2.25, 2.78, zf + 1.95, "z", 12);
    k.cyl(F.lens(), 0.33, 0.33, 0.04, sd * 2.25, 2.78, zf + 1.98, "z", 12);
    k.box(paintMat("#1e1e1e", 0.9, 0), sd * 2.55, 1.3, (zf + zr) / 2 - 0.1, 0.8, 0.08, zf - zr - 4.6);
    k.sphere(F.tail(), 0.14, sd * 2.4, 2.75, zr - 1.4, 1, 1.3, 1, 8);
  }
  // Waterfall grille, bumpers, trim.
  k.rbox(paintMat("#1b1b1b", 0.6, 0.3), 0, 2.4, 7.86, 1.7, 1.5, 0.12, 0.05, -0.3);
  for (let i = -4; i <= 4; i++) k.box(F.chrome(), i * 0.18, 2.4, 7.93, 0.07, 1.5, 0.08, -0.3);
  k.box(F.chrome(), 0, 3.42, 7.0, 0.1, 0.06, 1.0);
  k.rbox(F.chrome(), 0, 1.45, 7.95, 5.6, 0.45, 0.3, 0.14);
  k.rbox(F.chrome(), 0, 1.5, -7.85, 5.6, 0.45, 0.3, 0.14);
  k.box(F.chrome(), 0, 3.05, -6.2, 0.6, 0.08, 0.1);
  plate(k, -7.7, 2.15, -1);
  return 16.2;
}

// Envelope-body sedan of about 1949-1956: slab sides, two-tone roof, skirts, whitewalls.
function fifties(k, pal) {
  const body = paintMat(pal.body, 0.28, 0.3);
  const roof = paintMat(pal.accent || pal.body, 0.28, 0.3);
  const r = 1.15;
  const track = 2.5;
  const zf = 4.85;
  const zr = -4.75;
  const skirt = pal.skirt;
  fourWheels(k, track, zf, zr, (x, z) => discWheel(k, x, r, z, r, 0.6, { cap: 0.45, whitewall: 0.78, trim: true }));
  const rear = skirt ? [["L", zr - 1.4, 1.45], ["L", zr - 1.3, 1.95], ["L", zr + 1.3, 1.95], ["L", zr + 1.4, 1.45]] : [["W", zr, r, 1.38, 1.45]];
  k.profile(body, shp([["M", -8.45, 1.45], ...rear, ["W", zf, r, 1.38, 1.45], ["L", 8.3, 1.45], ["Q", 8.6, 2.0, 8.45, 2.85], ["Q", 8.2, 3.35, 7.2, 3.4], ["L", 1.8, 3.6], ["L", -5.1, 3.6], ["L", -8.1, 3.45], ["Q", -8.6, 3.3, -8.55, 2.4], ["L", -8.45, 1.45]]), 5.5, 0, 0.3, 12);
  k.profile(roof, shp([["M", 1.55, 3.5], ["Q", 0.5, 4.75, -0.3, 4.95], ["L", -3.4, 5.0], ["Q", -4.4, 4.85, -5.2, 3.5], ["L", 1.55, 3.5]]), 4.8, 0, 0.22, 12);
  k.profile(F.glass(), shp([["M", 1.05, 3.75], ["Q", 0.35, 4.6, -0.3, 4.72], ["L", -1.6, 4.75], ["L", -1.6, 3.75], ["L", 1.05, 3.75]]), 5.26, 0, 0);
  k.profile(F.glass(), shp([["M", -1.9, 3.75], ["L", -1.9, 4.75], ["L", -3.35, 4.75], ["Q", -4.0, 4.5, -4.5, 3.75], ["L", -1.9, 3.75]]), 5.26, 0, 0);
  k.profile(F.glass(), shp([["M", 1.68, 3.6], ["Q", 0.62, 4.82, -0.2, 5.05], ["L", -0.3, 4.92], ["Q", 0.52, 4.7, 1.5, 3.58], ["L", 1.68, 3.6]]), 4.4, 0, 0.02);
  k.box(F.glass(), 0, 4.3, -4.7, 3.2, 0.8, 0.05, 1.0);
  // Heavy chrome: toothy grille, bumpers with guards, side spear, hood ornament.
  k.rbox(F.chrome(), 0, 2.35, 8.8, 4.6, 0.75, 0.22, 0.1);
  for (let i = -3; i <= 3; i++) k.sphere(F.chrome(), 0.13, i * 0.55, 2.1, 8.95, 1, 1.4, 1, 6);
  k.rbox(F.chrome(), 0, 1.4, 9.0, 6.0, 0.5, 0.35, 0.16);
  k.rbox(F.chrome(), 0, 1.5, -8.95, 6.0, 0.5, 0.35, 0.16);
  for (const sd of [-1, 1]) {
    k.cyl(F.chrome(), 0.4, 0.4, 0.3, sd * 2.25, 2.95, 8.7, "z", 14);
    k.cyl(F.lens(), 0.34, 0.34, 0.05, sd * 2.25, 2.95, 8.86, "z", 14);
    k.rbox(F.tail(), sd * 2.35, 2.7, -8.88, 0.4, 0.7, 0.12, 0.05);
    k.box(F.chrome(), sd * 2.79, 2.6, 0.5, 0.04, 0.08, 10.5);
    k.box(F.chrome(), sd * 0.75, 1.6, 9.2, 0.22, 0.85, 0.2);
  }
  k.box(F.chrome(), 0, 3.5, 7.4, 0.12, 0.12, 1.0);
  plate(k, -8.92, 2.2, -1);
  return 17.2;
}

// Late-1950s finned sedan (about 1957-1962): long, low, wraparound windshield, quad lamps.
function finned(k, pal) {
  const body = paintMat(pal.body, 0.26, 0.32);
  const roof = paintMat(pal.accent || pal.body, 0.26, 0.32);
  const r = 1.1;
  const track = 2.55;
  const zf = 5.0;
  const zr = -5.05;
  fourWheels(k, track, zf, zr, (x, z) => discWheel(k, x, r, z, r, 0.6, { cap: 0.6, whitewall: 0.8, trim: true }));
  k.profile(body, shp([["M", -9.0, 1.35], ["W", zr, r, 1.33, 1.35], ["W", zf, r, 1.33, 1.35], ["L", 8.9, 1.35], ["L", 9.05, 2.75], ["L", 8.6, 3.05], ["L", 1.9, 3.2], ["L", -5.6, 3.2], ["L", -8.55, 3.95], ["L", -9.1, 3.7], ["L", -9.05, 1.35]]), 6.0, 0, 0.18, 10);
  k.profile(roof, shp([["M", 2.05, 3.15], ["L", 0.3, 4.4], ["L", -3.3, 4.48], ["L", -4.9, 3.15], ["L", 2.05, 3.15]]), 5.0, 0, 0.18);
  k.profile(F.glass(), shp([["M", 1.65, 3.3], ["L", 0.35, 4.25], ["L", -3.15, 4.3], ["L", -4.4, 3.3], ["L", 1.65, 3.3]]), 5.38, 0, 0);
  k.profile(F.glass(), shp([["M", 2.12, 3.18], ["L", 0.35, 4.48], ["L", 0.25, 4.38], ["L", 1.95, 3.15], ["L", 2.12, 3.18]]), 4.9, 0, 0.03);
  k.box(roof, 0, 3.8, -1.4, 5.42, 1.0, 0.25);
  for (const sd of [-1, 1]) {
    k.box(F.chrome(), sd * 3.01, 2.55, -0.3, 0.04, 0.1, 15.5);
    k.box(F.chrome(), sd * 3.01, 2.3, -6.5, 0.04, 0.5, 3.4);
    k.rbox(F.tail(), sd * 2.55, 3.5, -9.28, 0.55, 0.35, 0.12, 0.05);
    for (const dx of [0.62, 1.38]) {
      k.cyl(F.chrome(), 0.3, 0.3, 0.2, sd * (1.5 + dx * 0.6), 2.5, 9.2, "z", 12);
      k.cyl(F.lens(), 0.25, 0.25, 0.04, sd * (1.5 + dx * 0.6), 2.5, 9.31, "z", 12);
    }
  }
  k.box(F.chrome(), 0, 2.05, 9.26, 3.4, 0.7, 0.12);
  k.box(paintMat("#151515", 0.6, 0.4), 0, 2.05, 9.31, 3.1, 0.45, 0.05);
  k.rbox(F.chrome(), 0, 1.4, 9.4, 6.2, 0.4, 0.3, 0.12);
  k.rbox(F.chrome(), 0, 1.45, -9.4, 6.2, 0.45, 0.3, 0.12);
  plate(k, -9.5, 2.1, -1);
  return 18.3;
}

// Flat-sided 1960s-1970s sedan: crisp slab body, formal roof, full-width grille.
function sixties(k, pal) {
  const body = paintMat(pal.body, 0.26, 0.32);
  const roof = paintMat(pal.accent || pal.body, pal.accent ? 0.7 : 0.26, pal.accent ? 0.05 : 0.32);
  const r = 1.12;
  const track = 2.6;
  const zf = 5.15;
  const zr = -4.95;
  fourWheels(k, track, zf, zr, (x, z) => discWheel(k, x, r, z, r, 0.65, { cap: 0.55, whitewall: pal.whitewall ? 0.84 : 0, trim: true }));
  k.profile(body, shp([["M", -8.9, 1.3], ["W", zr, r, 1.3, 1.3], ["W", zf, r, 1.3, 1.3], ["L", 8.9, 1.3], ["L", 9.0, 3.0], ["L", 2.1, 3.15], ["L", -8.85, 3.15], ["L", -8.95, 2.9], ["L", -8.9, 1.3]]), 6.3, 0, 0.12, 8);
  k.profile(roof, shp([["M", 2.2, 3.1], ["L", 0.55, 4.45], ["L", -3.35, 4.5], ["L", -4.3, 3.1], ["L", 2.2, 3.1]]), 5.3, 0, 0.12);
  k.profile(F.glass(), shp([["M", 1.8, 3.25], ["L", 0.58, 4.3], ["L", -1.5, 4.32], ["L", -1.5, 3.25], ["L", 1.8, 3.25]]), 5.62, 0, 0);
  k.profile(F.glass(), shp([["M", -1.8, 3.25], ["L", -1.8, 4.32], ["L", -3.2, 4.32], ["L", -3.75, 3.25], ["L", -1.8, 3.25]]), 5.62, 0, 0);
  k.profile(F.glass(), shp([["M", 2.27, 3.13], ["L", 0.6, 4.5], ["L", 0.5, 4.4], ["L", 2.1, 3.1], ["L", 2.27, 3.13]]), 5.0, 0, 0.03);
  for (const sd of [-1, 1]) {
    k.box(F.chrome(), sd * 3.17, 2.2, 0, 0.04, 0.12, 17.3);
    k.box(F.tail(), sd * 2.0, 2.45, -9.17, 1.9, 0.45, 0.1);
    for (const dx of [0.65, 1.35]) {
      k.cyl(F.chrome(), 0.28, 0.28, 0.12, sd * (1.4 + dx * 0.75), 2.45, 9.2, "z", 12);
      k.cyl(F.lens(), 0.24, 0.24, 0.04, sd * (1.4 + dx * 0.75), 2.45, 9.27, "z", 12);
    }
  }
  k.box(F.chrome(), 0, 2.45, 9.17, 6.2, 0.9, 0.08);
  for (let i = -7; i <= 7; i++) k.box(paintMat("#1a1a1a", 0.6, 0.4), i * 0.3, 2.45, 9.22, 0.06, 0.7, 0.04);
  k.rbox(F.chrome(), 0, 1.45, 9.3, 6.4, 0.42, 0.25, 0.08);
  k.rbox(F.chrome(), 0, 1.5, -9.3, 6.4, 0.45, 0.25, 0.08);
  plate(k, -9.4, 2.0, -1);
  return 18.2;
}

// Pickup trucks. "early": a 1930s-1950s stepside with separate fenders and a narrow bed;
// "late": a 1957-1979 fleetside with the bed sides flush with the cab.
function pickup(k, pal, late) {
  const body = paintMat(pal.body, 0.35, 0.25);
  const r = late ? 1.2 : 1.25;
  const track = late ? 2.6 : 2.4;
  const zf = late ? 5.4 : 5.0;
  const zr = late ? -5.0 : -4.6;
  const wheelPaint = paintMat(late ? "#cfd2d4" : pal.body, 0.4, 0.4);
  fourWheels(k, track, zf, zr, (x, z) => discWheel(k, x, r, z, r, 0.62, { cap: late ? 0.35 : 0.3, rim: wheelPaint }));
  const zCabF = late ? 1.8 : 2.0;
  const zCabR = late ? -1.6 : -1.3;
  if (!late) {
    // Hood and grille, separate cab, pontoon front fenders, running boards.
    k.rbox(body, 0, 3.15, (zCabF + 7.3) / 2, 2.9, 1.7, 7.3 - zCabF, 0.35);
    for (let i = -3; i <= 3; i++) k.box(F.chrome(), i * 0.3, 3.0, 7.32, 0.1, 1.3, 0.06);
    k.profile(body, shp([["M", zCabR, 1.75], ["L", zCabF, 1.75], ["L", zCabF, 4.1], ["L", zCabF - 0.55, 6.1], ["Q", zCabF - 1.2, 6.35, zCabR + 0.4, 6.3], ["Q", zCabR, 6.2, zCabR, 5.5], ["L", zCabR, 1.75]]), 4.7, 0, 0.22, 10);
    k.profile(F.glass(), shp([["M", zCabF - 0.35, 4.35], ["L", zCabF - 0.65, 5.85], ["L", zCabR + 0.9, 5.85], ["L", zCabR + 0.9, 4.35], ["L", zCabF - 0.35, 4.35]]), 4.78, 0, 0);
    k.box(F.glass(), 0, 5.15, zCabF - 0.38, 4.0, 1.3, 0.05, -0.25);
    k.box(F.glass(), 0, 5.2, zCabR - 0.02, 2.8, 0.7, 0.05);
    const fm = paintMat(pal.fender || "#161616", 0.35, 0.25);
    for (const sd of [-1, 1]) {
      k.profile(fm, shp([["M", zf + 1.9, 1.6], ["Q", zf + 2.0, 3.0, zf + 0.4, 3.2], ["Q", zf - 1.2, 3.2, zf - 2.4, 1.6], ["L", zf - 2.4, 1.4], ["W", zf, r, 1.42, 1.4], ["L", zf + 1.9, 1.6]]), 1.0, sd * 2.5, 0.16, 10);
      k.sphere(F.chrome(), 0.38, sd * 1.75, 3.65, 6.8, 1, 1, 1.2, 10);
      k.cyl(F.lens(), 0.32, 0.32, 0.04, sd * 1.75, 3.65, 7.24, "z", 12);
      k.box(paintMat("#1d1d1d", 0.9, 0), sd * 2.55, 1.45, zCabR + 0.55, 0.8, 0.08, 2 * (zf - 2.4 - zCabR - 0.55) > 0 ? zf - 2.4 - zCabR + 0.6 : 1);
      // Rear fenders stand outside the narrow bed.
      k.profile(fm, shp([["M", zr + 1.7, 1.55], ["Q", zr + 1.6, 3.1, zr, 3.15], ["Q", zr - 1.6, 3.1, zr - 1.7, 1.55], ["L", zr - 1.7, 1.4], ["W", zr, r, 1.42, 1.4], ["L", zr + 1.7, 1.55]]), 0.95, sd * 2.45, 0.14, 10);
      k.rbox(F.tail(), sd * 2.3, 3.0, zr - 1.6, 0.2, 0.3, 0.15, 0.05);
    }
    // Bed: floor, flareboard sides, headboard and tailgate.
    const zb0 = zCabR - 0.3;
    const zb1 = zr - 2.3;
    const bl = zb0 - zb1;
    const zc = (zb0 + zb1) / 2;
    k.box(paintMat("#5c4732", 0.85, 0), 0, 2.6, zc, 3.9, 0.12, bl);
    for (const sd of [-1, 1]) k.box(body, sd * 1.95, 3.25, zc, 0.12, 1.35, bl);
    k.box(body, 0, 3.25, zb0, 4.0, 1.35, 0.12);
    k.box(body, 0, 3.2, zb1, 4.0, 1.25, 0.12);
    for (const sd of [-1, 1]) k.box(F.iron(), sd * 1.5, 2.2, zc, 0.15, 0.25, bl);
    k.rbox(F.chrome(), 0, 1.6, 7.55, 5.6, 0.4, 0.25, 0.1);
    plate(k, zb1 - 0.08, 2.6, -1);
    return 15.6;
  }
  // Fleetside: one slab from bumper to tailgate, with a cutaway for the open bed.
  const zEnd = zr - 3.0;
  k.profile(body, shp([["M", zEnd, 1.6], ["W", zr, r, 1.42, 1.6], ["W", zf, r, 1.42, 1.6], ["L", 8.45, 1.6], ["L", 8.55, 3.6], ["L", zCabF, 3.85], ["L", zCabF, 3.85], ["L", zCabR, 3.85], ["L", zEnd, 3.85], ["L", zEnd, 1.6]]), 6.0, 0, 0.1, 8);
  k.box(paintMat("#3e3a35", 0.9, 0), 0, 3.82, (zCabR - 0.2 + zEnd + 0.2) / 2, 5.5, 0.08, zCabR - zEnd - 0.6);
  k.profile(body, shp([["M", zCabF, 3.8], ["L", zCabF - 1.0, 5.95], ["L", zCabR + 0.15, 6.0], ["L", zCabR, 3.8], ["L", zCabF, 3.8]]), 5.6, 0, 0.12);
  k.profile(F.glass(), shp([["M", zCabF - 0.45, 4.05], ["L", zCabF - 1.1, 5.75], ["L", zCabR + 0.55, 5.78], ["L", zCabR + 0.5, 4.05], ["L", zCabF - 0.45, 4.05]]), 5.68, 0, 0);
  k.profile(F.glass(), shp([["M", zCabF + 0.07, 3.82], ["L", zCabF - 0.95, 6.0], ["L", zCabF - 1.05, 5.9], ["L", zCabF - 0.1, 3.82], ["L", zCabF + 0.07, 3.82]]), 5.2, 0, 0.03);
  k.box(F.glass(), 0, 5.0, zCabR - 0.08, 4.4, 1.0, 0.05);
  k.box(paintMat("#d7d7d2", 0.4, 0.2), 0, 2.75, 8.7, 5.8, 0.95, 0.06);
  for (const sd of [-1, 1]) {
    k.cyl(F.lens(), 0.32, 0.32, 0.05, sd * 2.25, 2.75, 8.74, "z", 12);
    k.box(F.tail(), sd * 2.9, 3.2, zEnd - 0.13, 0.2, 0.55, 0.06);
    k.box(F.chrome(), sd * 3.02, 3.0, 1.0, 0.04, 0.09, 14.5);
  }
  k.rbox(F.chrome(), 0, 1.6, 8.85, 6.1, 0.45, 0.25, 0.08);
  k.rbox(F.chrome(), 0, 1.6, zEnd - 0.25, 6.1, 0.4, 0.22, 0.08);
  plate(k, zEnd - 0.14, 2.5, -1);
  return 17.0;
}

// A generic late-1970s/1980s sedan for slider years past 1980.
function modernCar(k, pal) {
  const body = paintMat(pal.body, 0.3, 0.35);
  const r = 1.05;
  const track = 2.5;
  const zf = 4.6;
  const zr = -4.6;
  fourWheels(k, track, zf, zr, (x, z) => discWheel(k, x, r, z, r, 0.62, { cap: 0.62, rim: paintMat("#b8bcc0", 0.35, 0.6) }));
  k.profile(body, shp([["M", -7.8, 1.3], ["W", zr, r, 1.25, 1.3], ["W", zf, r, 1.25, 1.3], ["L", 7.7, 1.3], ["L", 7.8, 2.85], ["L", 2.2, 3.05], ["L", -7.7, 3.1], ["L", -7.85, 2.85], ["L", -7.8, 1.3]]), 5.6, 0, 0.18, 8);
  k.profile(body, shp([["M", 2.3, 3.0], ["L", 0.5, 4.5], ["L", -3.0, 4.55], ["L", -4.6, 3.0], ["L", 2.3, 3.0]]), 4.9, 0, 0.15);
  k.profile(F.glass(), shp([["M", 1.9, 3.15], ["L", 0.52, 4.35], ["L", -2.9, 4.38], ["L", -4.1, 3.15], ["L", 1.9, 3.15]]), 5.2, 0, 0);
  k.profile(F.glass(), shp([["M", 2.38, 3.03], ["L", 0.55, 4.55], ["L", 0.45, 4.45], ["L", 2.2, 3.0], ["L", 2.38, 3.03]]), 4.6, 0, 0.03);
  k.box(body, 0, 3.75, -1.1, 5.0, 1.3, 0.25);
  k.box(paintMat("#2a2b2c", 0.7, 0.1), 0, 1.5, 8.0, 5.8, 0.5, 0.3);
  k.box(paintMat("#2a2b2c", 0.7, 0.1), 0, 1.5, -8.0, 5.8, 0.5, 0.3);
  k.box(paintMat("#1b1b1b", 0.6, 0.3), 0, 2.35, 8.0, 3.6, 0.5, 0.06);
  for (const sd of [-1, 1]) {
    k.box(F.lens(), sd * 2.25, 2.35, 8.0, 1.0, 0.4, 0.06);
    k.box(F.tail(), sd * 2.1, 2.45, -8.03, 1.3, 0.45, 0.06);
  }
  plate(k, -8.08, 2.0, -1);
  return 15.6;
}

// Which models stand at the curb in a given year (estimates; see SOURCES.md). A fleet lists
// models with weights; slots walk the list so each street gets a plausible mix of old and new.
const FLEETS = [
  [1905, [["runabout", 3], ["touring", 2]]],
  [1910, [["touring", 3], ["runabout", 1], ["tee", 2]]],
  [1915, [["tee", 6], ["touring", 1]]],
  [1925, [["sedan20s", 3], ["tee", 2]]],
  [1933, [["rounded", 5], ["sedan20s", 2], ["pickup40s", 2]]],
  [1942, [["rounded", 6], ["pickup40s", 2], ["sedan20s", 1]]],
  [1949, [["fifties", 5], ["rounded", 3], ["pickup40s", 2]]],
  [1957, [["finned", 4], ["fifties", 3], ["pickup60s", 2], ["rounded", 1]]],
  [1963, [["sixties", 5], ["pickup60s", 3], ["finned", 2]]],
  [1980, [["modern", 3], ["pickup60s", 1]]],
];

function fleetFor(year) {
  let pick = null;
  for (const f of FLEETS) if (year >= f[0]) pick = f;
  return pick;
}

// The fleet band (for remounting the town when the slider crosses a change).
export function carBand(year) {
  const f = fleetFor(year);
  return f ? `c${f[0]}` : "c0";
}

// How many cars stand at the downtown curbs (estimate; the town had about 25 autos in 1908).
export function carCount(year) {
  if (year < 1905) return 0;
  if (year < 1915) return 2;
  if (year < 1935) return 6;
  if (year < 1980) return 16;
  return 12;
}

export function styleForSlot(year, slot) {
  const f = fleetFor(year);
  if (!f) return null;
  const list = [];
  for (const [name, w] of f[1]) for (let i = 0; i < w; i++) list.push(name);
  // A golden-ratio walk spreads each model along the street instead of bunching them.
  const t = (slot * 0.6180339887 + 0.13) % 1;
  return list[Math.floor(t * list.length)];
}

const PALETTES = {
  runabout: [{ body: "#2f2018" }, { body: "#1e2b22", accent: "#b39a4f" }, { body: "#5e1f1a" }],
  touring: [{ body: "#2a3a2c" }, { body: "#5a1d1a" }, { body: "#1b2333" }, { body: "#3b2a22" }],
  tee: [{ body: "#141414" }],
  sedan20s: [
    { body: "#2d3a4a", wheel: "#1b1b1b" },
    { body: "#5b5446", wheel: "#1b1b1b" },
    { body: "#151515", wheel: "#1b1b1b" },
    { body: "#3d4a3a", wheel: "#9a2c22" },
    { body: "#55606b", wheel: "#1b1b1b" },
  ],
  rounded: [
    { body: "#1a1a1b" },
    { body: "#2f3c33" },
    { body: "#4b4f55" },
    { body: "#5a2c27" },
    { body: "#263347", whitewall: true },
    { body: "#7a715f" },
  ],
  fifties: [
    { body: "#2e4b3d", accent: "#e4dfcf", skirt: true },
    { body: "#1c1c1e" },
    { body: "#7f9aa8", accent: "#ece7da" },
    { body: "#6a2a28", accent: "#e8e2d2", skirt: true },
    { body: "#c9bfa3" },
    { body: "#3b4b5e" },
  ],
  finned: [
    { body: "#86b1ad", accent: "#efece3" },
    { body: "#e9e4d6" },
    { body: "#8c1f22", accent: "#efece3" },
    { body: "#2a3550" },
    { body: "#d9c27e", accent: "#efece3" },
  ],
  sixties: [
    { body: "#e9e5da" },
    { body: "#6b1f1f", accent: "#1b1b1b" },
    { body: "#36506e" },
    { body: "#2f4a3a", whitewall: true },
    { body: "#c7b98e", accent: "#6b5a3a" },
    { body: "#1d1e20" },
    { body: "#8a5a2a" },
  ],
  pickup40s: [{ body: "#2b3d2b" }, { body: "#3a3f47" }, { body: "#5b2420" }, { body: "#1b1b1b" }],
  pickup60s: [{ body: "#2e5a7a" }, { body: "#c3c0b2" }, { body: "#6d2620" }, { body: "#4f6b3e" }, { body: "#d9cfae" }],
  modern: [{ body: "#b9bcbf" }, { body: "#efefec" }, { body: "#7a1d1f" }, { body: "#2a3b5c" }, { body: "#3c3e40" }],
};

export function paletteFor(style, slot) {
  const list = PALETTES[style] || PALETTES.modern;
  return list[(slot * 7 + 3) % list.length];
}

// Build a car of the given style into a Kit (positioned by the kit's base). Returns length.
export function buildCarInto(k, style, pal) {
  switch (style) {
    case "runabout":
      return brassCar(k, "runabout", pal);
    case "touring":
      return brassCar(k, "touring", pal);
    case "tee":
      return modelT(k, pal);
    case "sedan20s":
      return sedan20s(k, pal);
    case "rounded":
      return rounded40s(k, pal);
    case "fifties":
      return fifties(k, pal);
    case "finned":
      return finned(k, pal);
    case "sixties":
      return sixties(k, pal);
    case "pickup40s":
      return pickup(k, pal, false);
    case "pickup60s":
      return pickup(k, pal, true);
    default:
      return modernCar(k, pal);
  }
}

export const CAR_LENGTH = {
  runabout: 10.4,
  touring: 12.6,
  tee: 11.1,
  sedan20s: 13.1,
  rounded: 16.2,
  fifties: 17.2,
  finned: 18.3,
  sixties: 18.2,
  pickup40s: 15.6,
  pickup60s: 17.0,
  modern: 15.6,
};

// ---------------------------------------------------------------- street lamps
// Kerosene lanterns on wooden posts until the electric light works (1893 Sanborn); single-globe
// cast-iron curb posts after; five-globe cluster posts on Main from the 1915 curb-light
// petition; new downtown lights in 1949 (type estimated: bracket lights on wooden utility
// poles); cobra-head lights on steel davit poles from about 1960 (estimate).
export function lampStyleFor(year) {
  if (year < 1893) return "kerosene";
  if (year < 1915) return "globe";
  if (year < 1949) return "cluster";
  if (year < 1960) return "utility";
  return "cobra";
}

const globeMat = () => paintMat("#f3efe2", 0.3, 0.05, { emissive: "#fff3d6", emissiveIntensity: 0.35 });
const lanternGlass = () => paintMat("#e9dfb8", 0.15, 0.2, { emissive: "#ffe6a8", emissiveIntensity: 0.25 });

// One lamp at the origin, its arm (if any) reaching toward +z (the street).
function lampTemplate(style, main) {
  const k = new Kit();
  if (style === "kerosene") {
    const wood = paintMat("#3b3a2c", 0.8, 0);
    k.box(wood, 0, 4.25, 0, 0.36, 8.5, 0.36);
    k.place(wood, new THREE.ConeGeometry(0.3, 0.4, 4), 0, 8.6, 0, 0, Math.PI / 4);
    k.box(wood, 0, 7.6, 0, 1.7, 0.12, 0.14);
    // Four-sided lantern with a pyramid hood and vent.
    const iron = paintMat("#222220", 0.55, 0.4);
    k.box(iron, 0, 8.85, 0, 0.6, 0.1, 0.6);
    k.box(lanternGlass(), 0, 9.35, 0, 0.62, 0.9, 0.62);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(iron, sx * 0.33, 9.35, sz * 0.33, 0.05, 0.95, 0.05);
    k.place(iron, new THREE.ConeGeometry(0.58, 0.45, 4), 0, 10.02, 0, 0, Math.PI / 4);
    k.cyl(iron, 0.07, 0.1, 0.25, 0, 10.35, 0, "y", 6);
    k.sphere(iron, 0.08, 0, 10.5, 0, 1, 1, 1, 6);
    return k;
  }
  const castIron = paintMat("#1f2421", 0.5, 0.45);
  if (style === "globe" || (style === "cluster" && !main)) {
    // Cast-iron curb post: stepped base, fluted shaft, collar, single globe (1907 photo).
    k.cyl(castIron, 0.62, 0.75, 0.55, 0, 0.28, 0, "y", 10);
    k.cyl(castIron, 0.42, 0.6, 1.3, 0, 1.2, 0, "y", 10);
    k.cyl(castIron, 0.2, 0.28, 7.6, 0, 5.6, 0, "y", 10);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      k.box(castIron, Math.cos(a) * 0.24, 5.6, Math.sin(a) * 0.24, 0.06, 7.2, 0.06, 0, -a);
    }
    k.cyl(castIron, 0.32, 0.22, 0.5, 0, 9.6, 0, "y", 10);
    k.cyl(castIron, 0.28, 0.32, 0.3, 0, 10.0, 0, "y", 10);
    k.sphere(globeMat(), 0.72, 0, 10.75, 0, 1, 1.05, 1, 14);
    k.cyl(castIron, 0.12, 0.2, 0.2, 0, 11.55, 0, "y", 8);
    return k;
  }
  if (style === "cluster") {
    // Ornamental boulevard post: four globes on scrolled arms round a taller centre globe.
    k.cyl(castIron, 0.8, 0.95, 0.6, 0, 0.3, 0, "y", 12);
    k.cyl(castIron, 0.5, 0.75, 1.6, 0, 1.4, 0, "y", 12);
    k.cyl(castIron, 0.24, 0.34, 8.6, 0, 6.5, 0, "y", 10);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      k.box(castIron, Math.cos(a) * 0.29, 6.4, Math.sin(a) * 0.29, 0.06, 8.0, 0.06, 0, -a);
    }
    k.cyl(castIron, 0.4, 0.28, 0.6, 0, 11.0, 0, "y", 10);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const ax = Math.cos(a) * 1.25;
      const az = Math.sin(a) * 1.25;
      k.rod(castIron, [0, 11.0, 0], [ax * 0.7, 11.35, az * 0.7], 0.07, 5);
      k.rod(castIron, [ax * 0.7, 11.35, az * 0.7], [ax, 11.1, az], 0.07, 5);
      k.cyl(castIron, 0.12, 0.2, 0.3, ax, 11.2, az, "y", 8);
      k.sphere(globeMat(), 0.5, ax, 11.75, az, 1, 1.1, 1, 12);
      k.place(castIron, new THREE.TorusGeometry(0.45, 0.05, 4, 10, Math.PI), ax * 0.85, 11.0, az * 0.85, 0, -a, Math.PI);
    }
    k.cyl(castIron, 0.16, 0.25, 1.2, 0, 11.8, 0, "y", 8);
    k.sphere(globeMat(), 0.62, 0, 12.85, 0, 1, 1.15, 1, 14);
    k.cyl(castIron, 0.1, 0.18, 0.25, 0, 13.6, 0, "y", 8);
    return k;
  }
  if (style === "utility") {
    // Wooden utility pole with crossarm, bracket arm and a radial-wave reflector.
    const pole = paintMat("#4a3b2c", 0.9, 0);
    const steel = paintMat("#3c4144", 0.5, 0.5);
    k.cyl(pole, 0.36, 0.5, 30, 0, 15, 0, "y", 10);
    k.box(pole, 0, 28.5, 0, 6.5, 0.35, 0.4, 0, Math.PI / 2);
    for (const dz of [-2.8, -1.2, 1.2, 2.8]) k.cyl(paintMat("#5a7a68", 0.3, 0.1), 0.12, 0.14, 0.4, 0, 28.9, dz, "y", 6);
    k.rod(steel, [0, 21.5, 0.35], [0, 22.2, 5.5], 0.08, 6);
    k.rod(steel, [0, 19.6, 0.35], [0, 22.0, 3.2], 0.06, 5);
    k.cyl(steel, 0.2, 0.2, 0.5, 0, 21.95, 5.6, "y", 8);
    // Fluted reflector dish and the bulb under it.
    const dish = new THREE.ConeGeometry(1.4, 0.65, 16, 1, false);
    k.place(paintMat("#e9e7df", 0.35, 0.3), dish, 0, 21.4, 5.6);
    k.ring(steel, 1.4, 0.05, 0, 21.08, 5.6, "y", 18);
    k.sphere(globeMat(), 0.32, 0, 21.05, 5.6, 1, 1.2, 1, 10);
    k.box(steel, 0, 12, -0.4, 0.4, 0.9, 0.12);
    return k;
  }
  // Cobra-head on a tapered galvanised davit pole.
  const galv = paintMat("#a9aeb0", 0.45, 0.6);
  k.cyl(galv, 0.75, 0.85, 1.4, 0, 0.7, 0, "y", 12);
  k.cyl(galv, 0.22, 0.42, 26, 0, 14.4, 0, "y", 10);
  // Quarter-round davit arm from the pole top out over the street.
  const arm = new THREE.TorusGeometry(3.2, 0.14, 6, 14, Math.PI / 2);
  arm.rotateZ(Math.PI / 2);
  arm.rotateY(-Math.PI / 2);
  k.place(galv, arm, 0, 27.4, 3.2);
  k.cyl(galv, 0.14, 0.14, 4.6, 0, 30.6, 5.4, "z", 8);
  k.sphere(galv, 0.75, 0, 30.4, 8.3, 0.75, 0.42, 1.4, 12);
  k.box(globeMat(), 0, 30.05, 8.4, 0.9, 0.12, 1.6);
  return k;
}

// Instanced street lamps. spots: { x, z, face: [fx, fz] (toward the street), main }.
export function addStreetLamps(scene, spots, year) {
  if (!spots.length) return;
  const style = lampStyleFor(year);
  const groups = new Map();
  for (const s of spots) {
    const key = style === "cluster" && s.main ? "main" : "plain";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const dummy = new THREE.Object3D();
  for (const [key, list] of groups) {
    const kit = lampTemplate(style, key === "main");
    for (const [mat, geo] of kit.merged()) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((s, i) => {
        dummy.position.set(s.x, 0, s.z);
        dummy.rotation.set(0, Math.atan2(s.face?.[0] ?? 0, s.face?.[1] ?? 1), 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
}

// ---------------------------------------------------------------- railroad
// Rolling stock is built along +z, centred, ground at y = 0, rails 4 ft 8.5 in apart with the
// rail tops at y = 0.88 (as the track is drawn). Eras by year (estimates; SOURCES.md):
//   early (to 1879): 4-4-0 with balloon stack, short wood cars, link-and-pin couplers
//   wood (1880-1899): 4-4-0 with straight stack, 34 ft wood boxcars with truss rods
//   transition (1900-1914): 4-6-0, 36 ft cars, arch-bar trucks, wood cabooses
//   steel (1915-1949): 2-8-2 Mikado, 40 ft steel boxcars, steel hoppers and tank cars
//   diesel (1950 on): streamlined E-unit on the passenger train; steel freight
export function railEraFor(year) {
  if (year < 1856) return "none";
  if (year < 1880) return "early";
  if (year < 1900) return "wood";
  if (year < 1915) return "transition";
  if (year < 1950) return "steel";
  return "diesel";
}

const RT = 0.88;
const RX = 2.35;
// Distinct railroad colours: freight-car red/brown, reefer yellow, black hoppers and tanks.
const RC = {
  boxWood: "#8b3b2a",
  boxSteel: "#6b2b20",
  reefer: "#d8c9a2",
  hopper: "#232220",
  tank: "#121212",
  tankSilver: "#b8bdbf",
  caboose: "#b0301f",
  flat: "#6a4a32",
  coachWood: "#4a2e1f",
  coachGreen: "#2c3a2b",
  stainless: "#c7ccd1",
  loco: "#262a2a",
  locoRussia: "#4a5357",
  cabWood: "#6b2a1c",
  diesel: "#b9bfc4",
  dieselRed: "#a8261d",
};
const rmat = (c, rough = 0.7, metal = 0.25) => paintMat(c, rough, metal);
const steelDark = () => rmat("#1e1f1f", 0.6, 0.5);
const wheelSteel = () => rmat("#2c2b29", 0.5, 0.7);

function railWheelset(k, z, r) {
  const y = RT + r;
  for (const sd of [-1, 1]) {
    k.cyl(wheelSteel(), r, r, 0.42, sd * RX, y, z, "x", 16);
    k.cyl(wheelSteel(), r + 0.1, r + 0.1, 0.08, sd * (RX - 0.25), y, z, "x", 16);
  }
  k.cyl(wheelSteel(), 0.2, 0.2, RX * 2 + 0.8, 0, y, z, "x", 6);
}

function freightTruck(k, zc, cast) {
  const r = 1.375;
  const y = RT + r;
  const iron = steelDark();
  for (const dz of [-2.75, 2.75]) railWheelset(k, zc + dz, r);
  for (const sd of [-1, 1]) {
    const x = sd * (RX + 0.6);
    if (cast) {
      k.box(iron, x, y + 0.15, zc, 0.35, 0.9, 6.4);
      k.box(iron, x, y - 0.35, zc, 0.3, 0.5, 3.0);
      for (const dz of [-2.75, 2.75]) k.box(iron, x + sd * 0.1, y, zc + dz, 0.45, 0.6, 0.8);
      for (const dz of [-0.6, 0, 0.6]) k.cyl(iron, 0.17, 0.17, 0.75, x, y - 0.1, zc + dz, "y", 6);
    } else {
      // Arch-bar: top arch, bottom tie bar, column bolts, journal boxes.
      k.strut(iron, x, zc - 3.2, y + 0.45, zc - 1.4, y + 0.85, 0.22, 0.12);
      k.box(iron, x, y + 0.85, zc, 0.22, 0.12, 2.8);
      k.strut(iron, x, zc + 1.4, y + 0.85, zc + 3.2, y + 0.45, 0.22, 0.12);
      k.box(iron, x, y - 0.25, zc, 0.22, 0.12, 6.4);
      k.box(iron, x, y + 0.3, zc, 0.22, 0.1, 6.4);
      for (const dz of [-2.75, 2.75]) k.box(iron, x + sd * 0.08, y + 0.1, zc + dz, 0.45, 0.65, 0.8);
      for (const dz of [-1.0, 1.0]) k.box(iron, x, y + 0.3, zc + dz, 0.25, 1.1, 0.12);
    }
  }
  k.box(iron, 0, y + 0.55, zc, RX * 2 + 1.0, 0.6, 1.0);
}

function coupler(k, z, dir, linkPin) {
  const iron = steelDark();
  const y = RT + 2.9;
  k.box(iron, 0, y, z + dir * 0.6, 0.55, 0.5, 1.2);
  if (linkPin) k.box(iron, 0, y, z + dir * 1.25, 0.12, 0.12, 0.7);
  else k.box(iron, 0, y, z + dir * 1.25, 0.8, 0.6, 0.35);
  // Uncoupling lever and air hose (not on link-and-pin cars).
  if (!linkPin) {
    k.box(iron, 1.8, y + 0.5, z + dir * 0.15, 3.6, 0.06, 0.06);
    k.rod(rmat("#141414", 0.9, 0), [0.6, y - 0.4, z + dir * 0.6], [0.6, y - 1.2, z + dir * 1.2], 0.08, 5);
  }
}

function ladder(k, x, z, y0, y1, side) {
  const iron = steelDark();
  for (let y = y0; y <= y1; y += 1.1) k.box(iron, x + side * 0.12, y, z, 0.05, 0.05, 1.5);
}

function brakeWheel(k, z, y, dir) {
  const iron = steelDark();
  k.ring(iron, 0.75, 0.05, 0, y, z + dir * 0.35, "z", 14);
  k.cyl(iron, 0.05, 0.05, 2.2, 0, y - 1.0, z + dir * 0.35, "y", 5);
}

// Boxcar: 34 ft wood with truss rods (wood/early), 36 ft single-sheathed (transition),
// 40 ft steel with outside posts (steel/diesel).
function boxcar(k, era, kind = "box") {
  const early = era === "early" || era === "wood";
  const steel = era === "steel" || era === "diesel";
  const L = early ? (era === "early" ? 28 : 34) : steel ? 40.5 : 36;
  const W = steel ? 9.6 : 8.9;
  const top = steel ? 13.6 : early ? 11.6 : 12.4;
  const fy = 4.55;
  const reefer = kind === "reefer";
  const body = rmat(reefer ? RC.reefer : steel ? RC.boxSteel : RC.boxWood, 0.8, steel ? 0.25 : 0);
  const trim = rmat(reefer ? "#7a3324" : "#2a1b16", 0.8, 0.1);
  const roofMat = rmat(steel ? "#3a3634" : reefer ? "#5a3a2a" : "#4e2e22", 0.75, 0.2);
  const tz = L / 2 - 4.5;
  freightTruck(k, tz, steel);
  freightTruck(k, -tz, steel);
  k.box(steelDark(), 0, fy - 0.45, 0, 1.4, 0.7, L);
  for (const sd of [-1, 1]) k.box(trim, sd * (W / 2 - 0.15), fy - 0.25, 0, 0.3, 0.5, L);
  k.box(body, 0, (fy + top) / 2, 0, W, top - fy, L);
  // Roof (gently pitched), running board, end fascia.
  for (const sd of [-1, 1]) k.box(roofMat, sd * W * 0.26, top + 0.12, 0, W * 0.56, 0.12, L + 0.5, 0, 0, sd * -0.08);
  k.box(rmat("#5b4632", 0.9, 0), 0, top + 0.42, 0, 1.8, 0.1, L + 0.6);
  for (const sd of [-1, 1]) {
    const x = sd * (W / 2 + 0.03);
    if (steel) {
      for (let i = 0; i <= 12; i++) k.box(body, x + sd * 0.06, (fy + top) / 2, -L / 2 + 0.6 + (i * (L - 1.2)) / 12, 0.14, top - fy - 0.2, 0.3);
    } else {
      for (let zz = -L / 2 + 0.8; zz < L / 2; zz += 0.9) k.box(trim, x, (fy + top) / 2, zz, 0.02, top - fy - 0.1, 0.04);
      k.box(trim, x + sd * 0.04, top - 0.25, 0, 0.08, 0.3, L);
    }
    // Door (plug doors on the reefer) and its track.
    const dw = reefer ? 4.0 : steel ? 6.0 : 5.0;
    k.box(trim, x + sd * 0.12, (fy + top) / 2 - 0.1, 0.6, 0.12, top - fy - 0.6, dw);
    k.box(body, x + sd * 0.21, (fy + top) / 2 - 0.1, 0.6, 0.06, top - fy - 0.9, dw - 0.3);
    if (!reefer) k.box(steelDark(), x + sd * 0.12, top - 0.2, 0.6 - dw / 2, 0.1, 0.12, dw * 2);
    if (reefer) {
      for (const dz of [-1.4, 1.4]) k.box(steelDark(), x + sd * 0.25, (fy + top) / 2, 0.6 + dz, 0.08, 0.2, 0.6);
    }
    // Ladders at diagonal corners and grab irons.
    ladder(k, x, sd > 0 ? L / 2 - 0.9 : -L / 2 + 0.9, fy + 0.6, top - 0.3, sd);
    if (steel || era === "transition") k.box(steelDark(), x + sd * 0.15, fy + 0.2, sd > 0 ? L / 2 - 0.9 : -L / 2 + 0.9, 0.06, 0.06, 1.6);
  }
  // Ends: horizontal ribs on steel cars (Dreadnaught-style), the brake wheel on the B end.
  for (const dir of [-1, 1]) {
    if (steel) for (let i = 0; i < 6; i++) k.box(body, 0, fy + 1.0 + i * 1.5, dir * (L / 2 + 0.06), W - 0.4, 0.45, 0.12);
    coupler(k, dir * (L / 2), dir, era === "early");
  }
  brakeWheel(k, L / 2, top - 0.5, 1);
  if (reefer) for (const dir of [-1, 1]) for (const sd of [-1, 1]) k.box(rmat("#4a3a30", 0.8, 0.1), sd * 2.5, top + 0.35, dir * (L / 2 - 1.8), 2.4, 0.28, 2.2);
  if (early) {
    // Queen posts and truss rods under the floor.
    for (const xr of [-3.3, -1.1, 1.1, 3.3]) {
      for (const dir of [-1, 1]) {
        k.rod(steelDark(), [xr, fy - 0.5, dir * (L / 2 - 1.0)], [xr, fy - 1.75, dir * 4.0], 0.06, 4);
        k.box(trim, xr, fy - 1.25, dir * 4.0, 0.2, 1.0, 0.2);
      }
      k.rod(steelDark(), [xr, fy - 1.75, -4.0], [xr, fy - 1.75, 4.0], 0.06, 4);
    }
  }
  return L + 2.8;
}

function hopper(k, era) {
  const steel = era === "steel" || era === "diesel";
  const L = steel ? 34 : 30;
  const W = steel ? 10.2 : 9.0;
  const top = steel ? 11 : 9.6;
  const fy = 4.4;
  const mat = rmat(steel ? RC.hopper : RC.boxWood, 0.8, steel ? 0.35 : 0);
  const tz = L / 2 - 4.2;
  freightTruck(k, tz, steel);
  freightTruck(k, -tz, steel);
  k.box(steelDark(), 0, fy - 0.3, 0, 1.4, 0.6, L);
  // Body with sloped end sheets and twin bays.
  k.profile(mat, shp([["M", -L / 2, top], ["L", -L / 2, fy + 1.6], ["L", -L / 2 + 4.0, fy - 0.2], ["L", -2.6, fy - 0.2], ["L", -1.4, fy + 1.0], ["L", 1.4, fy + 1.0], ["L", 2.6, fy - 0.2], ["L", L / 2 - 4.0, fy - 0.2], ["L", L / 2, fy + 1.6], ["L", L / 2, top], ["L", -L / 2, top]]), W, 0, 0.04);
  for (const sd of [-1, 1]) {
    for (let i = 0; i <= 8; i++) k.box(steelDark(), sd * (W / 2 + 0.08), (fy + 1.6 + top) / 2, -L / 2 + 1 + (i * (L - 2)) / 8, 0.12, top - fy - 1.6, 0.25);
    k.box(steelDark(), sd * (W / 2 + 0.08), top - 0.1, 0, 0.16, 0.25, L);
    ladder(k, sd * W / 2, sd * (L / 2 - 0.7), fy + 0.8, top - 0.3, sd);
  }
  // Coal heaped above the sides.
  const coal = rmat("#141312", 0.95, 0);
  k.box(coal, 0, top - 0.3, 0, W - 0.4, 0.4, L - 0.4);
  for (const dz of [-L / 4, L / 4]) k.sphere(coal, 4, 0, top - 0.2, dz, (W - 0.6) / 8, 0.22, (L / 2 - 1) / 8, 10);
  for (const dir of [-1, 1]) coupler(k, dir * (L / 2), dir, false);
  brakeWheel(k, L / 2, top - 0.4, 1);
  return L + 2.8;
}

function tankcar(k, era) {
  const silver = era === "diesel";
  const L = 36;
  const tankR = 3.6;
  const cy = 4.6 + tankR + 0.1;
  const mat = rmat(silver ? RC.tankSilver : RC.tank, silver ? 0.35 : 0.5, silver ? 0.55 : 0.3);
  const tz = L / 2 - 4.2;
  freightTruck(k, tz, era !== "transition");
  freightTruck(k, -tz, era !== "transition");
  k.box(steelDark(), 0, 4.3, 0, 1.6, 0.7, L);
  k.box(rmat("#5a4632", 0.9, 0), 0, 4.75, 0, 7.6, 0.25, L - 1.0);
  k.cyl(mat, tankR, tankR, L - 3.2, 0, cy, 0, "z", 20);
  for (const dir of [-1, 1]) k.sphere(mat, tankR, 0, cy, dir * (L / 2 - 1.6), 1, 1, 0.35, 16);
  k.cyl(mat, 1.5, 1.5, 1.6, 0, cy + tankR + 0.5, 0, "y", 14);
  k.cyl(steelDark(), 1.7, 1.7, 0.2, 0, cy + tankR + 1.3, 0, "y", 14);
  for (const zz of [-tz, tz]) k.ring(steelDark(), tankR + 0.05, 0.06, 0, cy, zz, "z", 22);
  for (const sd of [-1, 1]) k.box(steelDark(), sd * (tankR + 0.25), cy + 0.6, 0, 0.06, 0.06, L - 4);
  for (const dir of [-1, 1]) coupler(k, dir * (L / 2), dir, false);
  return L + 2.8;
}

function flatcar(k, era) {
  const L = era === "wood" || era === "early" ? 32 : 40;
  const deck = rmat(RC.flat, 0.9, 0);
  const tz = L / 2 - 4.5;
  freightTruck(k, tz, era === "steel" || era === "diesel");
  freightTruck(k, -tz, era === "steel" || era === "diesel");
  k.box(steelDark(), 0, 4.0, 0, 1.4, 0.8, L);
  k.box(deck, 0, 4.55, 0, 9.0, 0.35, L);
  for (const sd of [-1, 1]) for (let i = 0; i < 8; i++) k.box(steelDark(), sd * 4.4, 4.2, -L / 2 + 2 + i * ((L - 4) / 7), 0.25, 0.5, 0.25);
  // Load of sawn lumber, chained down with stakes.
  const lumber = rmat("#c19a62", 0.9, 0);
  for (let i = 0; i < 3; i++) k.box(lumber, 0, 5.4 + i * 1.3, 0, 7.6 - i * 0.4, 1.2, L - 4 - i);
  for (const sd of [-1, 1]) for (const dz of [-L / 3, 0, L / 3]) k.box(rmat("#6b5236", 0.9, 0), sd * 4.0, 6.4, dz, 0.3, 3.6, 0.3);
  for (const dir of [-1, 1]) coupler(k, dir * (L / 2), dir, era === "early");
  return L + 2.8;
}

// Wooden caboose with cupola and end platforms (steel-era cabooses kept the same outline here).
function caboose(k, era) {
  const L = 26;
  const W = 8.8;
  const fy = 4.6;
  const top = 12.2;
  const body = rmat(RC.caboose, 0.75, 0.05);
  const trim = rmat("#2b1d17", 0.8, 0.1);
  const roofMat = rmat("#3a2a22", 0.8, 0.1);
  const steel = era === "steel" || era === "diesel";
  freightTruck(k, 8, steel);
  freightTruck(k, -8, steel);
  k.box(steelDark(), 0, fy - 0.35, 0, 1.4, 0.6, L + 5);
  k.box(trim, 0, fy - 0.05, 0, W + 0.3, 0.3, L + 5);
  k.box(body, 0, (fy + top) / 2, 0, W, top - fy, L);
  k.box(roofMat, 0, top + 0.12, 0, W + 0.6, 0.18, L + 0.8);
  // Cupola.
  k.box(body, 0, top + 1.6, 0, W - 1.2, 2.9, 6.5);
  k.box(roofMat, 0, top + 3.15, 0, W - 0.6, 0.18, 7.2);
  for (const sd of [-1, 1]) {
    for (const dz of [-1.6, 1.6]) k.box(F.glass(), sd * ((W - 1.2) / 2 + 0.02), top + 1.8, dz, 0.04, 1.2, 1.6);
    for (const dz of [-8.5, -4.5, 4.5, 8.5]) {
      k.box(F.glass(), sd * (W / 2 + 0.02), fy + 4.6, dz, 0.04, 2.0, 1.6);
      k.box(trim, sd * (W / 2 + 0.04), fy + 4.6, dz, 0.03, 2.3, 1.9);
    }
  }
  // End platforms with railings, steps, doors; stove pipe; marker lamps.
  for (const dir of [-1, 1]) {
    const ez = dir * (L / 2 + 1.25);
    k.box(trim, 0, fy + 0.2, ez, W, 0.2, 2.5);
    k.box(trim, 0, (fy + top) / 2 - 0.4, dir * (L / 2 + 0.02), 2.6, 6.4, 0.06);
    for (const sd of [-1, 1]) {
      k.box(steelDark(), sd * (W / 2 - 0.1), fy + 1.9, ez, 0.08, 3.3, 0.08);
      k.box(steelDark(), sd * (W / 2 - 0.1), fy + 3.5, dir * (L / 2 + 1.25), 0.07, 0.07, 2.5);
      k.box(steelDark(), sd * (W / 2 - 0.1), fy - 0.8, dir * (L / 2 + 1.2), 0.9, 0.08, 1.4);
    }
    k.box(steelDark(), 0, fy + 3.5, dir * (L / 2 + 2.5), W - 0.2, 0.07, 0.07);
    coupler(k, dir * (L / 2 + 2.5), dir, era === "early");
  }
  k.cyl(steelDark(), 0.22, 0.22, 2.2, 1.8, top + 1.1, -6, "y", 8);
  k.cyl(steelDark(), 0.35, 0.35, 0.15, 1.8, top + 2.2, -6, "y", 8);
  for (const sd of [-1, 1]) k.box(F.tail(), sd * (W / 2 + 0.2), top - 1.2, -(L / 2 + 0.2), 0.4, 0.55, 0.4);
  return L + 7.8;
}

function passengerTruck(k, zc, six) {
  const r = 1.5;
  const y = RT + r;
  const iron = steelDark();
  const axles = six ? [-5.5, 0, 5.5] : [-4, 4];
  for (const dz of axles) railWheelset(k, zc + dz, r);
  const half = six ? 7.2 : 5.6;
  for (const sd of [-1, 1]) {
    const x = sd * (RX + 0.65);
    k.box(iron, x, y + 0.4, zc, 0.3, 0.7, half * 2);
    k.box(iron, x, y - 0.45, zc, 0.25, 0.25, half * 1.5);
    for (const dz of axles) k.box(iron, x + sd * 0.08, y, zc + dz, 0.45, 0.7, 0.9);
    for (const dz of [-1.4, 1.4]) k.cyl(iron, 0.28, 0.28, 1.0, x, y - 0.1, zc + dz, "y", 8);
  }
  k.box(iron, 0, y + 0.8, zc, RX * 2 + 1.1, 0.6, 1.2);
}

// Passenger cars: open-platform wood coaches with clerestory roofs (to 1914), heavyweight
// steel coaches in Pullman green on six-wheel trucks (1915-1949), fluted stainless
// lightweights (1950 on, Zephyr style, estimate). `baggage` makes the head-end car.
function coach(k, era, baggage = false) {
  const wood = era === "early" || era === "wood" || era === "transition";
  const steel = era === "steel";
  const stainless = era === "diesel";
  const L = wood ? (era === "early" ? 46 : 54) : steel ? 72 : 80;
  const W = wood ? 9.8 : 10.0;
  const fy = 4.6;
  const eave = wood ? 11.8 : steel ? 12.2 : 12.0;
  const color = stainless ? RC.stainless : steel ? RC.coachGreen : era === "transition" ? RC.coachGreen : RC.coachWood;
  const body = rmat(color, stainless ? 0.28 : 0.6, stainless ? 0.85 : 0.1);
  const trim = rmat(stainless ? "#9aa1a6" : "#1b1712", 0.6, stainless ? 0.8 : 0.1);
  const roofMat = rmat(stainless ? "#b7bdc2" : "#2a2a28", 0.6, stainless ? 0.8 : 0.2);
  const tz = L / 2 - (wood ? 6 : 8.5);
  passengerTruck(k, tz, steel);
  passengerTruck(k, -tz, steel);
  const bodyL = wood ? L - 5 : L;
  k.box(steelDark(), 0, fy - 0.5, 0, 2, 0.8, L);
  if (stainless) {
    // Smooth rounded roof and fluted sides with a skirt.
    k.box(body, 0, (fy + eave) / 2, 0, W, eave - fy, bodyL);
    k.cyl(roofMat, W / 2, W / 2, bodyL, 0, eave - 0.2, 0, "z", 18, false, -Math.PI / 2, Math.PI);
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 10; i++) k.box(body, sd * (W / 2 + 0.04), fy + 0.4 + i * 0.32, 0, 0.06, 0.12, bodyL - 0.4);
      k.box(body, sd * (W / 2 + 0.02), fy - 0.6, 0, 0.06, 1.4, bodyL - 6);
    }
  } else {
    k.box(body, 0, (fy + eave) / 2, 0, W, eave - fy, bodyL);
    // Clerestory roof: lower deck, clerestory with its small windows, upper deck.
    k.box(roofMat, 0, eave + 0.25, 0, W + 0.4, 0.5, bodyL + (wood ? 2.5 : 0.4));
    k.box(body, 0, eave + 1.0, 0, W * 0.55, 1.1, bodyL - (wood ? 1 : 2));
    k.box(roofMat, 0, eave + 1.65, 0, W * 0.62, 0.25, bodyL + (wood ? 1.5 : -1.2));
    if (!baggage) for (const sd of [-1, 1]) for (let zz = -bodyL / 2 + 3; zz < bodyL / 2 - 2; zz += 2.4) k.box(F.glass(), sd * (W * 0.275 + 0.02), eave + 1.0, zz, 0.03, 0.55, 1.2);
    if (wood) for (const sd of [-1, 1]) for (let zz = -bodyL / 2 + 0.6; zz < bodyL / 2; zz += 0.8) k.box(trim, sd * (W / 2 + 0.02), fy + 1.6, zz, 0.02, 2.4, 0.04);
  }
  // Windows or baggage doors.
  for (const sd of [-1, 1]) {
    const x = sd * (W / 2 + 0.03);
    if (baggage) {
      for (const dz of [-bodyL / 6, bodyL / 6]) {
        k.box(trim, x, fy + 3.4, dz, 0.06, 6.0, 5.5);
        k.box(body, x + sd * 0.03, fy + 3.4, dz, 0.04, 5.6, 5.1);
      }
      for (const dz of [-bodyL / 2 + 3, bodyL / 2 - 3]) k.box(F.glass(), x, fy + 5.0, dz, 0.04, 1.6, 1.6);
    } else {
      const step = wood ? 2.6 : steel ? 3.4 : 5.2;
      const ww = wood ? 1.5 : steel ? 2.3 : 4.2;
      const n = Math.floor((bodyL - 8) / step);
      for (let i = 0; i < n; i++) {
        const zz = -((n - 1) * step) / 2 + i * step;
        k.box(F.glass(), x, fy + 4.4, zz, 0.04, wood ? 2.6 : 2.4, ww);
        if (!stainless) k.box(trim, x, fy + 4.4, zz, 0.03, (wood ? 2.6 : 2.4) + 0.3, ww + 0.25);
      }
    }
    if (!stainless) {
      k.box(trim, x, fy + 2.9, 0, 0.04, 0.12, bodyL);
      k.box(rmat(stainless ? "#888" : "#c9a24a", 0.5, 0.4), x + sd * 0.02, eave - 0.6, 0, 0.02, 0.35, bodyL * 0.5);
    }
  }
  for (const dir of [-1, 1]) {
    if (wood) {
      // Open end platform with railing and steps.
      const ez = dir * (bodyL / 2 + 1.2);
      k.box(trim, 0, fy - 0.1, ez, W - 0.6, 0.2, 2.4);
      for (const sd of [-1, 1]) {
        k.box(steelDark(), sd * (W / 2 - 0.8), fy + 1.8, ez + dir * 0.9, 1.6, 0.07, 0.07);
        k.box(steelDark(), sd * (W / 2 - 0.1), fy - 0.9, ez, 0.9, 0.07, 1.4);
        k.box(steelDark(), sd * (W / 2 - 0.1), fy + 1.2, ez, 0.07, 2.6, 0.07);
      }
    } else {
      // Diaphragm.
      k.box(rmat("#1b1b1b", 0.9, 0), 0, fy + 3.8, dir * (L / 2 + 0.3), W - 3, 7.5, 0.6);
    }
    coupler(k, dir * (L / 2 + (wood ? 0 : 0.4)), dir, era === "early");
  }
  return L + (wood ? 2.6 : 3.2);
}

function steamCab(k, zFront, zBack, floorY, roofY, mat, W = 9.4) {
  const len = zFront - zBack;
  const zc = (zFront + zBack) / 2;
  k.box(mat, 0, (floorY + roofY) / 2, zc, W, roofY - floorY, len);
  k.box(rmat("#1b1b1b", 0.8, 0.2), 0, roofY + 0.2, zc, W + 0.8, 0.3, len + 1.2, 0, 0, 0);
  for (const sd of [-1, 1]) {
    k.box(F.glass(), sd * (W / 2 + 0.02), roofY - 2.3, zc + len * 0.18, 0.04, 2.0, len * 0.3);
    k.box(F.glass(), sd * (W / 2 + 0.02), roofY - 2.3, zc - len * 0.22, 0.04, 2.0, len * 0.25);
  }
  for (const sd of [-1, 1]) k.box(F.glass(), sd * 2.6, roofY - 2.0, zFront + 0.02, 1.4, 1.6, 0.04);
}

// Steam locomotives (front at +z). Returns overall length.
function steamLoco(k, kind) {
  const spec = {
    early: { L: 31, drivers: [-6.5, -13.5], dr: 2.6, lead: [7.8, 3.0], bR: 2.15, bY: 7.4, color: RC.loco, wheel: "#7a1f18", stack: "balloon", cab: RC.cabWood, trail: null },
    wood: { L: 33, drivers: [-7, -14.5], dr: 2.75, lead: [8.4, 3.4], bR: 2.35, bY: 7.9, color: RC.locoRussia, wheel: "#1e1e1e", stack: "straight", cab: RC.cabWood, trail: null },
    transition: { L: 38, drivers: [-3, -8.6, -14.2], dr: 2.6, lead: [11.4, 6.6], bR: 2.65, bY: 8.6, color: RC.loco, wheel: "#1e1e1e", stack: "straight", cab: RC.loco, trail: null },
    steel: { L: 46, drivers: [3.8, -3.4, -10.6], dr: 3.05, lead: [16.2, 10.8], bR: 3.25, bY: 10.2, color: RC.loco, wheel: "#1e1e1e", stack: "short", cab: RC.loco, trail: -17.4 },
  }[kind];
  const F0 = spec.L / 2;
  const blk = rmat(spec.color, 0.45, 0.45);
  const iron = steelDark();
  const brass = F.brass();
  const wheelM = rmat(spec.wheel, 0.55, 0.4);
  // Wheels: lead truck, drivers with counterweights, trailing truck.
  for (const z of spec.lead) {
    for (const sd of [-1, 1]) k.cyl(wheelM, 1.25, 1.25, 0.4, sd * RX, RT + 1.25, z, "x", 14);
    k.cyl(iron, 0.15, 0.15, 5.6, 0, RT + 1.25, z, "x", 6);
  }
  for (const z of spec.drivers) {
    for (const sd of [-1, 1]) {
      const x = sd * RX;
      const y = RT + spec.dr;
      k.cyl(wheelM, spec.dr, spec.dr, 0.45, x, y, z, "x", 22);
      k.ring(rmat("#2a2a2a", 0.5, 0.7), spec.dr - 0.1, 0.1, x + sd * 0.2, y, z, "x", 22);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        k.box(wheelM, x + sd * 0.24, y + Math.sin(a) * spec.dr * 0.5, z + Math.cos(a) * spec.dr * 0.5, 0.06, spec.dr * 0.9, 0.16, Math.PI / 2 - a);
      }
      k.cyl(wheelM, 0.5, 0.5, 0.6, x + sd * 0.2, y, z, "x", 10);
      k.cyl(iron, 0.18, 0.18, 0.9, x + sd * 0.35, y + 0.7, z, "x", 6);
    }
  }
  if (spec.trail != null) {
    for (const sd of [-1, 1]) k.cyl(wheelM, 1.8, 1.8, 0.4, sd * RX, RT + 1.8, spec.trail, "x", 16);
  }
  // Side rods, main rod, crosshead guides, cylinders and steam chests.
  const zCyl = spec.lead[0] - 2.6;
  for (const sd of [-1, 1]) {
    const x = sd * (RX + 0.65);
    const y = RT + spec.dr + 0.7;
    const d0 = Math.max(...spec.drivers);
    const d1 = Math.min(...spec.drivers);
    k.box(rmat("#8f9396", 0.35, 0.85), x, y, (d0 + d1) / 2, 0.14, 0.32, d0 - d1);
    k.rod(rmat("#8f9396", 0.35, 0.85), [x + sd * 0.12, RT + 3.0, zCyl - 2.0], [x + sd * 0.12, y, spec.drivers[spec.drivers.length > 2 ? 1 : 0]], 0.13, 6);
    k.box(rmat("#8f9396", 0.35, 0.85), x, RT + 3.0, zCyl - 2.8, 0.12, 0.5, 4.0);
    k.cyl(blk, 1.1, 1.1, 3.0, sd * (RX + 0.9), RT + 3.2, zCyl, "z", 12);
    k.box(blk, sd * (RX + 0.8), RT + 4.7, zCyl, 1.4, 1.2, 2.6);
  }
  // Frame, pilot (cow-catcher), buffer beam.
  k.box(iron, 0, RT + 3.0, 0, 3.6, 1.2, spec.L - 3);
  k.box(rmat(kind === "steel" ? "#1a1a1a" : "#7a1f18", 0.6, 0.2), 0, RT + 3.6, F0 - 1.8, 9.0, 0.9, 0.6);
  if (kind === "steel") {
    k.box(iron, 0, RT + 1.8, F0 - 1.2, 8.4, 1.6, 1.2);
    for (let i = -4; i <= 4; i++) k.box(iron, i * 0.9, RT + 1.6, F0 - 0.6, 0.15, 1.6, 0.2);
  } else {
    for (let i = -5; i <= 5; i++) k.strut(iron, i * 0.8, F0 - 2.0, RT + 3.2, F0 + 0.8 - Math.abs(i) * 0.12, RT + 0.3, 0.1, 0.1);
    k.box(iron, 0, RT + 0.35, F0 + 0.1, 8.0, 0.15, 0.4);
  }
  // Boiler, smokebox, firebox; running boards and handrails; domes, sand box, bell, whistle.
  const zSmoke = F0 - 2.2;
  const zFire = spec.drivers[spec.drivers.length - 1] - (kind === "steel" ? 0.5 : 0.8);
  const boilerLen = zSmoke - zFire;
  k.cyl(blk, spec.bR, spec.bR * 1.04, boilerLen, 0, spec.bY, zFire + boilerLen / 2, "z", 20);
  k.cyl(rmat("#222322", 0.6, 0.4), spec.bR + 0.12, spec.bR + 0.12, kind === "steel" ? 6.5 : 4.0, 0, spec.bY, zSmoke - (kind === "steel" ? 3.25 : 2.0), "z", 20);
  k.cyl(rmat("#2c2c2c", 0.5, 0.5), spec.bR * 0.95, spec.bR * 0.95, 0.4, 0, spec.bY, zSmoke + 0.15, "z", 20);
  if (kind !== "steel") for (let i = 1; i < 5; i++) k.ring(brass, spec.bR + 0.04, 0.05, 0, spec.bY, zSmoke - 4 - (i * (boilerLen - 5)) / 5, "z", 20);
  const cabFront = zFire - 0.5;
  const cabBack = -F0 + 0.6;
  const fireboxH = kind === "steel" ? 3.6 : 2.6;
  k.box(blk, 0, spec.bY - 0.2, (zFire + cabFront) / 2 + 0.6, spec.bR * 2 + (kind === "steel" ? 0.6 : 0.2), fireboxH * 1.6, Math.max(2.4, zFire - cabFront + 4));
  for (const sd of [-1, 1]) {
    k.box(rmat("#1e1e1e", 0.7, 0.3), sd * (spec.bR + 1.2), spec.bY - spec.bR - 0.1 + (kind === "steel" ? 0.6 : 0), (zSmoke + cabFront) / 2, 1.6, 0.12, zSmoke - cabFront);
    k.cyl(brass, 0.05, 0.05, boilerLen, sd * (spec.bR + 0.25), spec.bY + spec.bR * 0.55, zFire + boilerLen / 2, "z", 5);
  }
  const top = spec.bY + spec.bR;
  const domeM = kind === "steel" ? blk : brass;
  const d1 = zFire + boilerLen * 0.38;
  const d2 = zFire + boilerLen * 0.7;
  k.cyl(domeM, 1.0, 1.25, 1.6, 0, top + 0.6, d1, "y", 14);
  k.sphere(domeM, 1.0, 0, top + 1.4, d1, 1, 0.45, 1, 12);
  k.cyl(kind === "steel" ? blk : brass, 0.85, 1.1, 1.3, 0, top + 0.5, d2, "y", 14);
  k.sphere(domeM, 0.85, 0, top + 1.15, d2, 1, 0.45, 1, 12);
  k.cyl(brass, 0.45, 0.6, 0.9, 0, top + 0.6, (d1 + d2) / 2 + (kind === "steel" ? 2.5 : 0), "y", 10);
  k.cyl(brass, 0.12, 0.12, 1.1, 0.6, top + 0.9, d1 - 0.4, "y", 6);
  // Stack.
  const zStack = zSmoke - (kind === "steel" ? 2.2 : 1.6);
  if (spec.stack === "balloon") {
    k.cyl(blk, 0.6, 0.7, 2.4, 0, top + 1.2, zStack, "y", 12);
    k.cyl(blk, 1.7, 0.65, 2.2, 0, top + 3.5, zStack, "y", 14);
    k.cyl(rmat("#3a3a3a", 0.8, 0.3), 1.72, 1.72, 0.25, 0, top + 4.7, zStack, "y", 14);
  } else if (spec.stack === "straight") {
    k.cyl(blk, 0.78, 0.7, 4.2, 0, top + 2.1, zStack, "y", 12);
    k.cyl(blk, 0.95, 0.8, 0.45, 0, top + 4.3, zStack, "y", 12);
  } else {
    k.cyl(blk, 0.95, 0.95, 1.6, 0, top + 0.8, zStack, "y", 12);
    k.cyl(blk, 1.05, 1.05, 0.25, 0, top + 1.65, zStack, "y", 12);
  }
  // Headlight: big box oil headlamp on wood-era engines, round electric on the steel era.
  if (kind === "steel") {
    k.cyl(blk, 0.75, 0.75, 1.2, 0, spec.bY + 0.4, zSmoke + 0.8, "z", 14);
    k.cyl(F.lens(), 0.62, 0.62, 0.05, 0, spec.bY + 0.4, zSmoke + 1.42, "z", 14);
    // Air pumps and the number plate.
    for (const sd of [-1, 1]) k.cyl(rmat("#2a2a2a", 0.6, 0.5), 0.6, 0.6, 2.6, sd * (spec.bR + 0.9), spec.bY - 1.1, zSmoke - 5, "y", 10);
  } else {
    k.box(blk, 0, top + 1.0, zSmoke - 0.4, 1.7, 1.9, 1.9);
    k.place(blk, new THREE.ConeGeometry(1.15, 0.6, 4), 0, top + 2.25, zSmoke - 0.4, 0, Math.PI / 4);
    k.box(F.lens(), 0, top + 1.0, zSmoke + 0.56, 1.2, 1.2, 0.05);
    k.box(brass, 0, top + 0.05, zSmoke - 0.4, 1.9, 0.12, 2.0);
  }
  // Cab.
  const cabFloor = RT + 5.2;
  const cabRoof = kind === "steel" ? 15.0 : 13.6;
  steamCab(k, cabFront, cabBack, cabFloor, cabRoof, rmat(spec.cab, 0.6, spec.cab === RC.cabWood ? 0.05 : 0.4), kind === "steel" ? 10 : 8.8);
  coupler(k, -F0, -1, kind === "early");
  return spec.L + 1;
}

function tender(k, kind) {
  const big = kind === "steel";
  const L = big ? 36 : kind === "transition" ? 28 : 22;
  const W = big ? 10 : 8.6;
  const fy = 4.8;
  const tankTop = big ? 12.6 : kind === "transition" ? 10.6 : 9.2;
  const mat = rmat(kind === "wood" ? RC.locoRussia : RC.loco, 0.5, 0.4);
  const tz = L / 2 - (big ? 6 : 4.5);
  freightTruck(k, tz, big);
  freightTruck(k, -tz, big);
  k.box(steelDark(), 0, fy - 0.3, 0, W, 0.6, L);
  k.box(mat, 0, (fy + tankTop) / 2, -L * 0.1, W, tankTop - fy, L * 0.8);
  k.box(mat, 0, (fy + tankTop - 1.2) / 2, L * 0.38, W, tankTop - 1.2 - fy, L * 0.24);
  k.box(rmat("#c9a24a", 0.5, 0.3), 0, tankTop - 0.2, -L * 0.1, W + 0.04, 0.15, L * 0.8);
  // Fuel: cordwood on early tenders, coal later.
  if (kind === "early") {
    const wood = rmat("#7a5534", 0.95, 0);
    for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) k.cyl(wood, 0.3, 0.3, W - 1.4, 0, tankTop + 0.3 + j * 0.55, L * 0.38 - 1.6 + i * 0.6, "x", 6);
  } else {
    k.sphere(rmat("#141312", 0.95, 0), 1, 0, tankTop - 0.6, L * 0.05, W / 2 - 0.4, 1.6, L * 0.32, 10);
  }
  k.cyl(mat, 0.9, 0.9, 0.3, 0, tankTop + 0.15, -L * 0.38, "y", 12);
  coupler(k, -L / 2, -1, kind === "early");
  return L + 2;
}

// EMD E7/E8-style A-unit: a tall 70 ft carbody, short 'bulldog' nose, twin headlights,
// and stainless sides with a CB&Q red band (estimate of the paint; the earlier slant-nose
// wedge read as a modern bullet train).
function dieselE(k) {
  const L = 70;
  const W = 10.4;
  const eave = 14.45;
  const crown = 15.5;
  const zF = L / 2;
  const zR = -L / 2;
  // Short, blunt bulldog: a vertical pilot, then a steep convex nose to a nearly upright windshield.
  const zPilot = zF - 0.7;
  const yPilotBot = 4.0;
  const yPilotTop = 6.55;
  const zMid = zF - 2.5;
  const yMid = 9.15;
  const zGlassBot = zF - 4.3;
  const yGlassBot = 12.05;
  const zGlassTop = zF - 4.95;
  const yGlassTop = 14.4;
  const zBrow = zF - 6.1;
  const body = rmat(RC.diesel, 0.28, 0.82);
  const red = rmat(RC.dieselRed, 0.45, 0.2);
  const trim = rmat("#9aa1a6", 0.32, 0.8);
  const dark = rmat("#1c1c1c", 0.55, 0.4);
  // A point on the two-segment nose (pilot top → mid → windshield bottom) plus an outward offset.
  const onNose = (t, outset) => {
    const a = t < 0.5 ? 0 : 0.5;
    const u = (t - a) * 2;
    const z0 = a < 0.5 ? zPilot : zMid;
    const y0 = a < 0.5 ? yPilotTop : yMid;
    const z1 = a < 0.5 ? zMid : zGlassBot;
    const y1 = a < 0.5 ? yMid : yGlassBot;
    const z = z0 + (z1 - z0) * u;
    const y = y0 + (y1 - y0) * u;
    const dz = z1 - z0;
    const dy = y1 - y0;
    const len = Math.hypot(dz, dy) || 1;
    // Outward (forward-and-up) normal in the y–z plane.
    const nz = dy / len;
    const ny = -dz / len;
    const rx = -Math.atan2(-dz, dy);
    return { x: 0, y: y + ny * outset, z: z + nz * outset, rx };
  };
  // Two 3-axle (A1A) trucks, 43 ft between centers, 14 ft wheelbase, under the body.
  const tFront = zF - 13.5;
  const tRear = zR + 13.5;
  for (const zc of [tFront, tRear]) {
    for (const dz of [-7, 0, 7]) railWheelset(k, zc + dz, 1.5);
    for (const sd of [-1, 1]) {
      const x = sd * (RX + 0.7);
      k.box(steelDark(), x, RT + 2.15, zc, 0.38, 1.4, 16.4);
      k.box(steelDark(), x, RT + 1.15, zc, 0.32, 0.4, 14.6);
      for (const dz of [-7, 0, 7]) k.box(steelDark(), x + sd * 0.08, RT + 1.7, zc + dz, 0.5, 0.85, 1.0);
    }
    k.box(steelDark(), 0, RT + 2.9, zc, RX * 2 + 1.2, 0.7, 1.4);
  }
  k.box(steelDark(), 0, 4.45, 0, W - 0.6, 1.0, L - 3);
  k.profile(
    body,
    shp([
      ["M", zR, 4.05],
      ["L", zF - 1.7, 4.05],
      ["Q", zF - 1.1, 4.0, zPilot, yPilotBot],
      ["L", zPilot, yPilotTop],
      ["Q", zF - 1.4, 7.6, zMid, yMid],
      ["Q", zF - 3.4, 10.6, zGlassBot, yGlassBot],
      ["L", zGlassTop, yGlassTop],
      ["Q", zF - 5.6, 15.3, zBrow, crown],
      ["L", zR, crown],
      ["L", zR, 4.05],
    ]),
    W,
    0,
    0.45,
    18,
  );
  {
    const g = new THREE.CylinderGeometry(W * 0.5 - 0.1, W * 0.5 - 0.1, L - 8.5, 18, 1, false, 0, Math.PI);
    g.rotateX(Math.PI / 2);
    g.scale(1, 0.22, 1);
    g.translate(0, eave + 0.05, (zR + zBrow) / 2);
    k.put(body, g);
  }
  // Red band along the sides, stopping at the cab, and wrapping the lower bulldog.
  k.profile(
    red,
    shp([
      ["M", zR + 0.35, 7.1],
      ["L", zF - 6.4, 7.1],
      ["L", zF - 6.4, 8.25],
      ["L", zR + 0.35, 8.25],
      ["L", zR + 0.35, 7.1],
    ]),
    W + 0.12,
    0,
    0.02,
  );
  {
    const p = onNose(0.28, 0.4);
    k.within(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rx, 0, 0, "YXZ")).setPosition(0, p.y, p.z), () => {
      k.rbox(red, 0, 0, 0, W * 0.7, 1.15, 0.14, 0.08);
    });
  }
  // Windshields high on the slant: two large panes, a centre post, and a visor.
  const glassRx = -Math.atan2(zGlassBot - zGlassTop, yGlassTop - yGlassBot);
  const glassY = (yGlassBot + yGlassTop) / 2;
  const glassZ = (zGlassBot + zGlassTop) / 2 + 0.12;
  for (const sd of [-1, 1]) {
    k.box(trim, sd * 2.15, glassY, glassZ - 0.02, 3.9, 2.65, 0.06, glassRx);
    k.box(F.glass(), sd * 2.15, glassY, glassZ, 3.7, 2.45, 0.1, glassRx);
  }
  k.box(body, 0, glassY, glassZ + 0.02, 0.28, 2.6, 0.14, glassRx);
  k.box(dark, 0, yGlassTop + 0.1, zGlassTop - 0.15, 7.8, 0.14, 0.7, 0.18);
  // Side cab windows and a cab door with steps, tucked just behind the windshield.
  for (const sd of [-1, 1]) {
    const x = sd * (W / 2 + 0.05);
    k.box(F.glass(), x, 13.1, zF - 7.3, 0.08, 2.05, 2.5);
    k.box(trim, x, 13.1, zF - 7.3, 0.05, 2.25, 2.7);
    k.box(F.glass(), x, 13.05, zF - 9.9, 0.08, 1.85, 1.8);
    k.box(body, x, 10.15, zF - 12.0, 0.1, 6.0, 2.15);
    k.box(F.glass(), x, 12.35, zF - 12.0, 0.12, 1.5, 1.3);
    for (let i = 0; i < 4; i++) k.box(steelDark(), x + sd * 0.25, 4.4 + i * 0.85, zF - 12.0, 0.7, 0.08, 1.5);
  }
  // Rounded nose door on the lower bulldog, with a small window.
  {
    const p = onNose(0.34, 0.55);
    k.within(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rx, 0, 0, "YXZ")).setPosition(0, p.y, p.z), () => {
      k.rbox(trim, 0, 0, 0, 2.45, 4.0, 0.28, 0.28);
      k.rbox(rmat("#8f969a", 0.35, 0.7), 0, -0.15, 0.08, 2.1, 3.55, 0.16, 0.2);
      k.rbox(F.glass(), 0, 0.85, 0.18, 1.2, 1.2, 0.1, 0.08);
    });
  }
  // Twin headlights in a protruding housing, stacked, just below the windshield, with number boards.
  {
    const p = onNose(0.78, 0.55);
    k.within(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rx, 0, 0, "YXZ")).setPosition(0, p.y, p.z), () => {
      k.rbox(dark, 0, 0, 0, 1.55, 2.7, 0.85, 0.12);
      k.box(dark, 0, 1.42, 0.05, 1.75, 0.12, 1.05);
      for (const dy of [0.58, -0.58]) {
        k.cyl(F.chrome(), 0.52, 0.52, 0.22, 0, dy, 0.42, "z", 14);
        k.cyl(F.lens(), 0.4, 0.4, 0.08, 0, dy, 0.56, "z", 14);
      }
    });
    for (const sd of [-1, 1]) {
      k.within(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rx, sd * 0.45, 0, "YXZ")).setPosition(sd * 1.85, p.y, p.z), () => {
        k.box(dark, 0, 0, 0.05, 1.5, 1.05, 0.22);
        k.box(paintMat("#efe6c8", 0.35, 0.05, { emissive: "#efe6c8", emissiveIntensity: 0.18 }), 0, 0, 0.18, 1.28, 0.82, 0.08);
      });
    }
  }
  // Classification lights at the upper corners of the nose.
  {
    const p = onNose(0.7, 0.2);
    for (const sd of [-1, 1]) {
      k.sphere(F.lens(), 0.18, sd * 3.6, p.y + 0.7, p.z - 0.8, 1, 1, 1, 8);
      k.cyl(trim, 0.22, 0.22, 0.16, sd * 3.6, p.y + 0.7, p.z - 0.9, "z", 8);
    }
  }
  // Anticlimber ribs on the short vertical pilot, coupler, and steps.
  for (let i = 0; i < 4; i++) k.box(trim, 0, yPilotBot + 0.4 + i * 0.55, zPilot + 0.12, 8.8, 0.13, 0.22);
  k.box(steelDark(), 0, 3.7, zPilot + 0.25, 2.4, 1.1, 0.55);
  coupler(k, zPilot, 1, false);
  for (const sd of [-1, 1]) {
    k.box(steelDark(), sd * 3.6, 3.2, zF - 1.6, 1.5, 0.1, 2.2);
    k.box(steelDark(), sd * 4.1, 3.7, zF - 2.2, 0.12, 1.0, 0.12);
  }
  // Grab irons up the nose corners, on the surface.
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const p = onNose(0.08 + i * 0.18, 0.12);
      k.box(steelDark(), sd * 2.45, p.y, p.z, 0.7, 0.05, 0.05);
    }
  }
  // Four porthole windows along each engine-room side.
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = zF - 18.5 - i * 6.6;
      k.cyl(trim, 0.88, 0.88, 0.12, sd * (W / 2 + 0.05), 11.35, z, "x", 16);
      k.cyl(F.glass(), 0.7, 0.7, 0.1, sd * (W / 2 + 0.1), 11.35, z, "x", 16);
    }
  }
  // Stainless fluting on the long sides, under the portholes.
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      k.box(rmat("#a3a9ae", 0.35, 0.85), sd * (W / 2 + 0.05), 9.05 + i * 0.22, -6.0, 0.04, 0.08, 42);
    }
  }
  // Rear side radiator / intake grilles.
  for (const sd of [-1, 1]) {
    k.box(dark, sd * (W / 2 + 0.06), 10.15, zR + 10.5, 0.1, 5.6, 10.5);
    for (let i = 0; i < 9; i++) k.box(trim, sd * (W / 2 + 0.1), 7.7 + i * 0.62, zR + 10.5, 0.04, 0.07, 10.1);
  }
  // Roof radiator fan housings (two 36-inch fans toward the rear) and a cab horn.
  for (const z of [zR + 11.5, zR + 18]) {
    k.cyl(trim, 2.05, 2.05, 0.4, 0, crown + 0.15, z, "y", 16);
    k.cyl(dark, 1.85, 1.85, 0.08, 0, crown + 0.38, z, "y", 16);
    for (let i = 0; i < 4; i++) k.box(trim, 0, crown + 0.42, z, 3.5, 0.05, 0.07, 0, (i / 4) * Math.PI);
  }
  k.box(dark, 0.35, crown + 0.45, zBrow - 1.6, 0.28, 0.7, 1.5);
  k.box(dark, -0.35, crown + 0.35, zBrow - 1.4, 0.22, 0.5, 1.1);
  k.box(rmat("#1b1b1b", 0.9, 0), 0, 9.6, zR - 0.25, W - 3.2, 8.2, 0.7);
  coupler(k, zR, -1, false);
  return L + 1.5;
}


// Lay units nose-to-tail: the first unit's front at `start`, the rest trailing behind it,
// all facing `dir` (a unit vector in x–z). Each unit is [builder, ...args].
function layConsist(kit, units, start, dir) {
  const yaw = Math.atan2(dir[0], dir[1]);
  let d = 0;
  for (const [fn, ...args] of units) {
    const unit = new Kit();
    const len = fn(unit, ...args);
    const c = d + len / 2;
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(start[0] - dir[0] * c, 0, start[1] - dir[1] * c);
    kit.absorb(unit, m);
    d += len;
  }
  return d;
}

// Point on a polyline track at a given x (tracks here run east-west in straight pieces).
function trackAtX(track, x) {
  const pts = track.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[i + 1];
    if ((x - x1) * (x - x2) <= 0 && x1 !== x2) {
      const t = (x - x1) / (x2 - x1);
      const len = Math.hypot(x2 - x1, z2 - z1);
      const s = Math.sign(x2 - x1);
      return { p: [x, z1 + t * (z2 - z1)], dir: [(s * (x2 - x1)) / len, (s * (z2 - z1)) / len] };
    }
  }
  return null;
}

const FREIGHT_CUTS = {
  wood: [[boxcar, "wood"], [boxcar, "wood"], [flatcar, "wood"], [boxcar, "wood", "reefer"], [boxcar, "wood"], [caboose, "wood"]],
  transition: [[boxcar, "transition"], [boxcar, "transition", "reefer"], [hopper, "transition"], [tankcar, "transition"], [boxcar, "transition"], [caboose, "transition"]],
  steel: [[boxcar, "steel"], [hopper, "steel"], [tankcar, "steel"], [boxcar, "steel", "reefer"], [boxcar, "steel"], [hopper, "steel"], [caboose, "steel"]],
  diesel: [[boxcar, "diesel"], [hopper, "diesel"], [tankcar, "diesel"], [boxcar, "diesel"], [hopper, "diesel"], [caboose, "diesel"]],
};

function passengerTrain(era) {
  if (era === "diesel") return [[dieselE], [coach, era, true], [coach, era], [coach, era]];
  const loco = era === "steel" ? "steel" : era;
  const units = [[steamLoco, loco], [tender, loco], [coach, era, true], [coach, era]];
  if (era !== "early") units.push([coach, era]);
  return units;
}

// A passenger train standing at the depot on the main line, and a cut of freight cars on the
// house track between Hail and Gridley streets (clear of the street crossings).
export function addRolling(scene, data, year) {
  const era = railEraFor(year);
  if (era === "none") return;
  const kit = new Kit();
  const main = data.tracks.find((t) => t.id === "cbq-main");
  const siding = data.tracks.find((t) => t.id === "cbq-siding");
  if (main) {
    const at = trackAtX(main, -40);
    if (at) layConsist(kit, passengerTrain(era), at.p, at.dir);
  }
  if (siding && FREIGHT_CUTS[era]) {
    const at = trackAtX(siding, 375);
    if (at) layConsist(kit, FREIGHT_CUTS[era], at.p, at.dir);
  }
  const root = new THREE.Group();
  root.name = "rolling-stock";
  kit.addTo(root);
  ensureColor(root);
  scene.add(root);
}

// Remount key: changes whenever the cars, lamps, rolling stock, or wagons change.
export function vehicleBand(year) {
  const wagon = year >= 1925 ? "w2" : year >= 1890 ? "w1" : "w0";
  return `${carBand(year)}:${lampStyleFor(year)}:${railEraFor(year)}:${wagon}`;
}
