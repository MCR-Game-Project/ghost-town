// Parametric facade parts. Each function draws in the building's local space
// through the api passed from the town builder: box, frontSash, archHood, and so on.

export function windowPart(api, opts) {
  const { x, y, z, w, h, type = "flat", frame } = opts;
  const arch = type === "round" || type === "pair-arch" ? "round" : type === "segmental" ? "segmental" : "flat";
  if (type === "pair" || type === "pair-arch") {
    const half = w * 0.42;
    api.frontSash(x - half * 0.55, y, z, half, h, arch, false, frame);
    api.frontSash(x + half * 0.55, y, z, half, h, arch, false, frame);
    if (type === "pair-arch") api.archHood(frame, x, y + h * 0.35, z + 0.2, w + 0.4, w * 0.28, "z");
    return;
  }
  if (type === "bay") {
    api.box(frame, x, y, z + 1.1, w, h + 0.6, 2.2);
    api.frontSash(x, y, z + 2.2, w * 0.7, h * 0.8, "flat", false, frame);
    return;
  }
  api.frontSash(x, y, z, w, h, arch, false, frame);
}

export function storefrontBay(api, opts) {
  const { x, z, w, h = 9.2, frame, recess = 0.35 } = opts;
  const glass = api.mats.glass;
  const kick = api.mats.trimDark;
  api.box(api.mats.reveal, x, h * 0.5, z - recess, w * 0.86, h * 0.9, 0.2);
  api.box(frame, x - w / 2, h * 0.52, z + 0.16, 0.32, h, 0.34);
  api.box(frame, x + w / 2, h * 0.52, z + 0.16, 0.32, h, 0.34);
  api.box(frame, x, h, z + 0.16, w + 0.3, 0.32, 0.34);
  api.box(frame, x, 1.05, z + 0.14, w, 0.55, 0.26);
  api.box(glass, x, h * 0.62, z + 0.05, w * 0.78, h * 0.52, 0.05);
  api.box(glass, x, h * 0.94, z + 0.08, w * 0.78, h * 0.12, 0.05);
  api.box(frame, x, h * 0.86, z + 0.12, w * 0.82, 0.12, 0.12);
  api.box(kick, x, h * 0.22, z + 0.1, w * 0.74, h * 0.16, 0.1);
  api.box(frame, x, h * 0.48, z + 0.18, w * 0.28, h * 0.7, 0.14);
  api.box(glass, x, h * 0.52, z + 0.24, w * 0.18, h * 0.46, 0.04);
}

export function pilaster(api, opts) {
  const { x, z, h, w = 0.7, mat } = opts;
  api.box(mat, x, h * 0.5, z, w, h, w);
  api.box(mat, x, h - 0.2, z + 0.06, w * 1.35, 0.4, w * 1.2);
  api.box(api.mats.stone, x, 0.35, z + 0.04, w * 1.25, 0.5, w * 1.15);
}

export function cornice(api, opts) {
  const { y, z, width, type = "bracket", mat } = opts;
  api.box(mat, 0, y + 0.7, z + 0.45, width + 1.2, 0.9, 1.2);
  api.box(api.mats.trim, 0, y + 0.15, z + 0.75, width + 0.4, 0.28, 0.45);
  api.dentilCourse(y - 0.15, z + 0.9, width * 0.96);
  if (type === "bracket" || type === "corbel") api.bracketRow(y - 0.65, z + 0.25, width * 0.94);
}

export function medallion(api, opts) {
  const { x, y, z, letter, building, rot, outward, right } = opts;
  const disk = new api.THREE.CylinderGeometry(1.15, 1.15, 0.42, 16);
  disk.rotateX(Math.PI / 2);
  disk.translate(x, y, z);
  disk.applyMatrix4(api.buildingMatrix);
  api.put(api.mats.siding.white, disk);
  if (!letter) return;
  api.signs.push({
    title: letter,
    subtitle: "",
    style: "painted",
    position: new api.THREE.Vector3(building.x, y, building.z).addScaledVector(right, x).addScaledVector(outward, building.depth / 2 + 0.6),
    rotation: rot,
    width: 2.6,
  });
}

export function signboard(api, opts) {
  const { text, x, y, zReach, width, building, rot, outward, right } = opts;
  api.signs.push({
    title: text,
    subtitle: "",
    style: "painted",
    position: new api.THREE.Vector3(building.x, y, building.z).addScaledVector(right, x).addScaledVector(outward, zReach),
    rotation: rot,
    width,
  });
}

export function porch(api, opts) {
  const { x, z, w, d, baseY = 0, mat, trim, roofMat } = opts;
  api.box(trim, x, baseY + 8.6, z + d * 0.45, w, 0.35, d);
  if (api.hipRoof) api.hipRoof(w + 0.8, d + 0.6, 2.2, baseY + 8.8, roofMat, x, z + d * 0.45);
  const piers = opts.piers || [
    [x - w / 2 + 0.9, z + d - 0.6],
    [x + w / 2 - 0.9, z + d - 0.6],
  ];
  for (const [px, pz] of piers) {
    api.box(mat, px, baseY + 4.2, pz, 1.45, 7.6, 1.45);
    api.box(trim, px, baseY + 8.15, pz, 1.8, 0.35, 1.8);
    if (opts.columns !== false) api.box(trim, px, baseY + 4.4, pz - 1.15, 0.42, 8, 0.42);
  }
  if (opts.door) {
    api.paneledDoor(opts.door.x ?? x, z + 0.1, opts.door.w || 3.2, opts.door.h || 7.2);
  }
  const steps = opts.steps || 4;
  for (let i = 0; i < steps; i++) {
    api.box(api.mats.stone, opts.door?.x ?? x, 0.2 + i * 0.26, z + d * 0.15 + i * 0.8, 4.6, 0.26, 0.95);
  }
}

export function dormer(api, opts) {
  const { x = 0, z, w = 14, rise = 6.2, windows = 2, frame, roofMat } = opts;
  const y0 = opts.y;
  api.box(frame, x, y0 + 2.2, z, w - 0.8, 4.2, 5.2);
  api.clapboardTriangle(frame, w, rise, y0 + 4.1, "z", z + 2.7, x, z);
  if (api.gableAt) api.gableAt(w + 0.6, 6, rise, y0 + 4.1, roofMat, x, z);
  const tilt = Math.atan2(rise, w / 2);
  const rakeLen = Math.hypot(w / 2, rise);
  for (const [angle, rx] of [[tilt, -w / 4], [Math.PI - tilt, w / 4]]) {
    const rake = new api.THREE.BoxGeometry(rakeLen, 0.55, 0.28);
    rake.applyMatrix4(new api.THREE.Matrix4().makeRotationZ(angle));
    rake.applyMatrix4(new api.THREE.Matrix4().makeTranslation(x + rx, y0 + 4.1 + rise / 2, z + 2.9));
    rake.applyMatrix4(api.buildingMatrix);
    api.put(frame, rake);
  }
  const gap = w / (windows + 1);
  for (let i = 0; i < windows; i++) {
    windowPart(api, {
      x: x - w / 2 + gap * (i + 1),
      y: y0 + 2.6,
      z: z + 2.85,
      w: 2.4,
      h: 4.4,
      type: "round",
      frame,
    });
  }
}

export function chimney(api, opts) {
  api.chimneyStack(opts.mat, opts.x, opts.y, opts.z, opts.w || 1.6, opts.h || 6, opts.d || 1.6);
}

export function awning(api, opts) {
  api.localBox(opts.mat || api.mats.awning, opts.x || 0, opts.y, opts.z, opts.w, 0.12, opts.d || 4.2, -0.35);
}

export function hedge(api, opts) {
  const { z, width, count = 14 } = opts;
  for (let i = 0; i < count; i++) {
    const lump = 1.8 + (i % 4) * 0.6 + (i % 3) * 0.3;
    const x = -width / 2 + ((i + 0.5) * width) / count;
    const zz = z + (i % 3) * 0.55 - (i % 2) * 0.35;
    api.box(i % 2 ? api.mats.leaf : api.mats.leafDark, x, lump / 2, zz, 1.8 + (i % 3) * 0.6, lump, 1.6 + (i % 2) * 0.5);
  }
}
