import { awning, chimney, cornice, dormer, hedge, medallion, pilaster, porch, signboard, storefrontBay, windowPart } from "./parts.js";

function active(item, year) {
  if (!item) return false;
  if (item.from != null && year < item.from) return false;
  if (item.to != null && year > item.to) return false;
  return true;
}

function hexMat(api, kind, hex) {
  const key = `${kind}:${hex}`;
  if (!api._mats) api._mats = new Map();
  if (api._mats.has(key)) return api._mats.get(key);
  const base =
    kind === "brick" ? api.mats.brick.red
    : kind === "stone" ? api.mats.stone
    : kind === "clapboard" ? api.mats.siding.white
    : kind === "slate" ? api.mats.roofSlate
    : kind === "shingle" ? api.mats.roofTan
    : api.mats.trim;
  const mat = base.clone();
  mat.color = new api.THREE.Color(hex || "#ffffff");
  if (base.userData) mat.userData = base.userData;
  api._mats.set(key, mat);
  return mat;
}

function facingVectors(api, building) {
  const rot = (api.FACING[building.facing] ?? 0) + api.THREE.MathUtils.degToRad(building.rotation || 0);
  const outward = new api.THREE.Vector3(0, 0, 1).applyAxisAngle(new api.THREE.Vector3(0, 1, 0), rot);
  const right = new api.THREE.Vector3(1, 0, 0).applyAxisAngle(new api.THREE.Vector3(0, 1, 0), rot);
  return { rot, outward, right };
}

// Draws a facade from a photo spec. Returns the wall height used for picking.
export function drawFacadeSpec(building, api) {
  let spec = building.facadeSpec;
  const year = api.year ?? 1880;
  for (const change of building.facadeSpec.alterations || []) {
    if (!active(change, year)) continue;
    spec = { ...spec, ...change, alterations: spec.alterations };
  }
  const floors = spec.floors?.length ? spec.floors : [12, 12];
  const wallH = floors.reduce((sum, floor) => sum + floor, 0);
  const fz = building.depth / 2;
  const wall = hexMat(api, spec.wallKind || "brick", spec.wall || "#8d3a32");
  const trim = hexMat(api, "trim", spec.trim || "#f4efe4");
  const roofMat = hexMat(api, spec.roof?.kind || "shingle", spec.roof?.color || "#b7a56a");
  api.tint?.setRGB(1, 1, 1);

  api.box(wall, 0, wallH / 2, 0, building.width, wallH, building.depth);
  api.box(api.mats.stone, 0, 1.05, 0, building.width + 0.5, 2.1, building.depth + 0.5);

  const bays = spec.bays || [];
  const total = bays.reduce((sum, bay) => sum + (bay.width || 8), 0) || building.width;
  let cursor = -building.width / 2;
  const placed = bays.map((bay) => {
    const width = ((bay.width || 8) / total) * building.width;
    const x = cursor + width / 2;
    cursor += width;
    return { ...bay, x, width };
  });

  placed.forEach((bay, index) => {
    if (index > 0 && spec.pilasters) {
      pilaster(api, { x: bay.x - bay.width / 2, z: fz + 0.4, h: wallH * 0.72, mat: hexMat(api, "clapboard", spec.pilasters) });
    }
    floors.forEach((floorH, floor) => {
      const y = floors.slice(0, floor).reduce((sum, value) => sum + value, 0) + floorH * 0.55;
      const kind = bay.windows?.[floor] || (floor === 0 ? "storefront" : "flat");
      if (kind === "storefront" || kind === "door") return;
      windowPart(api, {
        x: bay.x,
        y,
        z: fz + 0.16,
        w: Math.min(bay.width * 0.62, 4.2),
        h: Math.min(floorH * 0.62, 6.4),
        type: kind,
        frame: trim,
      });
    });
  });

  const shop = spec.storefronts?.find((item) => active(item, year)) || spec.storefront;
  if (shop) {
    const openings = shop.bays || placed.filter((bay) => bay.windows?.[0] === "storefront" || bay.windows?.[0] === "door");
    const targets = openings.length ? openings : placed.slice(0, Math.min(2, placed.length));
    for (const bay of targets) {
      storefrontBay(api, {
        x: bay.x,
        z: fz + 0.05,
        w: Math.min((bay.width || building.width / targets.length) * 0.86, bay.width ? bay.width * 0.9 : 8),
        h: shop.height || floors[0] * 0.78 || 9,
        frame: hexMat(api, "trim", shop.frame || spec.trim || "#f4efe4"),
      });
    }
  }

  if (spec.cornice) cornice(api, { y: wallH, z: fz, width: building.width, type: spec.cornice, mat: trim });
  if (spec.pediment) {
    api.drawPediment(trim, building.width * (spec.pediment.width || 0.46), spec.pediment.rise || 4.8, wallH + 0.8, fz + 0.55, spec.pediment.x || 0);
  }
  if (spec.parapet) {
    api.box(wall, 0, wallH + 1.3, 0, building.width + 0.3, 2.2, building.depth + 0.2);
    if (spec.parapet.finial) {
      const ball = new api.THREE.SphereGeometry(0.9, 12, 10);
      ball.translate(spec.parapet.finial.x || 0, wallH + 3.2, fz);
      ball.applyMatrix4(api.buildingMatrix);
      api.put(hexMat(api, "clapboard", spec.parapet.finial.color || "#8d3a32"), ball);
    }
  }

  const roof = spec.roof || { type: "hip" };
  const rise = roof.rise || Math.max(6, building.width * 0.22);
  if (roof.type === "hip" && api.hipRoof) api.hipRoof(building.width + 1.4, building.depth + 1.4, rise, wallH, roofMat, 0, 0);
  else if (roof.type === "gable" && api.gable) api.gable(building.width, building.depth, rise, wallH, roofMat);
  else if (roof.type === "curved") {
    const vault = new api.THREE.CylinderGeometry(roof.radius || 4.4, roof.radius || 4.4, building.depth * 0.4, 16, 1, false, 0, Math.PI);
    vault.rotateX(Math.PI / 2);
    vault.translate(roof.x || building.width * 0.28, wallH + (roof.radius || 4.4) * 0.7, roof.z || -1);
    vault.applyMatrix4(api.buildingMatrix);
    api.put(roofMat, vault);
  } else if (roof.type === "mansard") {
    api.box(roofMat, 0, wallH + 3.2, 0, building.width * 0.9, 6, building.depth * 0.86);
  }

  if (spec.dormer) {
    dormer(api, {
      y: wallH,
      z: fz - 2.4,
      w: spec.dormer.width || 14,
      windows: spec.dormer.windows || 2,
      frame: trim,
      roofMat,
      rise: spec.dormer.rise || 6,
    });
  }
  if (spec.porch) {
    porch(api, {
      x: spec.porch.x || 0,
      z: fz,
      w: spec.porch.width || building.width * 0.6,
      d: spec.porch.depth || 8,
      mat: wall,
      trim,
      roofMat,
      door: spec.porch.door === false ? null : { x: spec.porch.doorX || 0 },
      columns: spec.porch.columns !== false,
    });
  }
  if (spec.awning && active(spec.awning, year)) {
    awning(api, { y: floors[0] + 1.2, z: fz + 2.2, w: building.width * 0.9, mat: api.mats.awning });
  }
  if (spec.hedge) hedge(api, { z: fz + (spec.hedge.z || 16), width: building.width + 8, count: spec.hedge.count || 16 });
  if (spec.chimney) chimney(api, { mat: wall, x: building.width * 0.2, y: wallH + 5, z: -building.depth * 0.1 });

  const { rot, outward, right } = facingVectors(api, building);
  for (const sign of spec.signs || []) {
    if (!active(sign, year)) continue;
    if (sign.medallion) {
      medallion(api, { x: sign.x || 0, y: sign.y || wallH * 0.86, z: fz + 0.4, letter: sign.text, building, rot, outward, right });
    } else {
      signboard(api, {
        text: sign.text,
        x: sign.x || 0,
        y: sign.y || wallH + 2,
        zReach: building.depth / 2 + 1,
        width: sign.width || 8,
        building,
        rot,
        outward,
        right,
      });
    }
  }
  for (const letter of spec.medallions || []) {
    medallion(api, { x: letter.x, y: letter.y || wallH * 0.86, z: fz + 0.4, letter: letter.text, building, rot, outward, right });
  }
  return wallH + (spec.dormer ? 14 : roof.type === "hip" ? 10 : 6);
}
