// The town file keeps the 1854 plat: +x runs northeast along the Burlington,
// and +z in the file is the side where West Main, Dean, Jackson, and Washington
// were drawn. On a right-handed ground that side is geographic east once +x
// points northeast, which had swapped East Main and West Main.
// mirrorPlat flips that axis. The town group is then rotated so +x points
// 29.8 degrees east of true north, the bearing of the BNSF line through
// downtown (the same graded alignment). World +x is east and world -z is north.

export const TRACK_BEARING_DEG = 29.8;
const bearing = (TRACK_BEARING_DEG * Math.PI) / 180;
export const ORIENT = Math.PI / 2 - bearing;

const flipFacing = { "+z": "-z", "-z": "+z", "+x": "+x", "-x": "-x" };

function flipSpan(item) {
  if (item.axis === "x") {
    item.at = -item.at;
    return;
  }
  const a = -item.from;
  const b = -item.to;
  item.from = Math.min(a, b);
  item.to = Math.max(a, b);
}

export function mirrorPlat(data) {
  if (data.meta?.oriented) return data;
  for (const street of data.streets) flipSpan(street);
  for (const walk of data.boardwalks || []) flipSpan(walk);
  for (const building of data.buildings) {
    building.z = -building.z;
    if (building.facing) building.facing = flipFacing[building.facing] || building.facing;
    if (building.rotation) building.rotation = -building.rotation;
  }
  for (const block of data.blocks) {
    const z0 = -block.z1;
    const z1 = -block.z0;
    block.z0 = Math.min(z0, z1);
    block.z1 = Math.max(z0, z1);
  }
  for (const lot of data.lots || []) lot.z = -lot.z;
  for (const track of data.tracks) {
    for (const point of track.points) point[1] = -point[1];
  }
  for (const tree of data.trees || []) tree.z = -tree.z;
  for (const prop of data.props || []) prop.z = -prop.z;
  for (const place of data.places || []) {
    place.z = -place.z;
    if (place.look) place.look[1] = -place.look[1];
  }
  if (data.meta) data.meta.oriented = true;
  return data;
}

export function platToEnu(x, z) {
  const c = Math.cos(ORIENT);
  const s = Math.sin(ORIENT);
  return {
    east: c * x + s * z,
    north: s * x - c * z,
    x: c * x + s * z,
    z: -s * x + c * z,
  };
}

export function worldToPlat(x, z) {
  const c = Math.cos(ORIENT);
  const s = Math.sin(ORIENT);
  return { x: c * x - s * z, z: s * x + c * z };
}
