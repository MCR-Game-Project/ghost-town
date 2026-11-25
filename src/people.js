import * as THREE from "three";

// Period pedestrians (preview/people): parametric articulated figures rendered with
// InstancedMesh (no photo textures). Counts scale with Bushnell population; clothing
// silhouettes and hats follow each era from 1854 through 1970+. All placements are
// validated clear of buildings, street carriageways, railroad tracks, trees, and props.

const POPULATION_STOPS = [
  [1854, 20],
  [1860, 400],
  [1870, 2003],
  [1880, 2316],
  [1890, 2314],
  [1900, 2490],
  [1905, 2555],
  [1910, 2619],
  [1920, 2716],
  [1930, 2850],
  [1940, 2906],
  [1950, 3317],
  [1960, 3710],
  [1970, 3703],
];

export function populationForYear(year) {
  if (year <= POPULATION_STOPS[0][0]) return POPULATION_STOPS[0][1];
  for (let i = 1; i < POPULATION_STOPS.length; i++) {
    const [y1, p1] = POPULATION_STOPS[i];
    if (year <= y1) {
      const [y0, p0] = POPULATION_STOPS[i - 1];
      const t = (year - y0) / (y1 - y0);
      return Math.round(p0 + (p1 - p0) * t);
    }
  }
  return POPULATION_STOPS[POPULATION_STOPS.length - 1][1];
}

export function peopleEraFor(year) {
  if (year < 1880) return "pioneer";     // 1854-1879: frock coats, vests, wide hats; full skirts, shawls, bonnets
  if (year < 1900) return "victorian";   // 1880-1899: sack suits, bowlers; bustles & leg-o'-mutton sleeves
  if (year < 1910) return "edwardian";   // 1900-1909: sack suits, bowlers; shirtwaists & long skirts
  if (year < 1930) return "jazz";        // 1910-1929: boaters, fedoras; shorter skirts & cloche hats
  if (year < 1950) return "depression";  // 1930-1949: fedoras, overalls; print dresses
  return "midcentury";                   // 1950-1970+: casual slacks, skirts, work clothes
}

export function peopleBand(year) {
  // Remount across era transitions and meaningful population steps.
  const popBucket = Math.round(populationForYear(year) / 250);
  return `${peopleEraFor(year)}:${popBucket}`;
}

function peopleCountForYear(year) {
  if (year <= 1854) return 4;
  if (year <= 1860) return 10;
  const pop = populationForYear(year);
  return Math.max(12, Math.min(66, Math.round(pop / 58)));
}

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];

const SKIN_TONES = ["#e8be9e", "#dfb08e", "#d6a380", "#ecc5a8", "#cfa07e"];
const HAIR_TONES = ["#2c221b", "#483324", "#6e4e34", "#8a6d48", "#5b5550", "#1e1a18"];

function dressProfile(era, role, rng) {
  // role: "man" | "woman" | "farmer" | "boy" | "girl"
  const skin = pick(SKIN_TONES, rng);
  const hair = pick(HAIR_TONES, rng);

  if (role === "farmer") {
    const shirt = pick(["#b8c2cc", "#d8d0be", "#9aa896", "#c4b299", "#b89682"], rng);
    const denim = pick(["#394c68", "#425878", "#4f565e", "#5b5044"], rng);
    const hatColor = era === "pioneer" ? "#6c563f" : era === "jazz" ? "#c9b37c" : "#6c655c";
    const hatStyle = era === "pioneer" ? "wide" : era === "midcentury" ? "cap" : rng() < 0.55 ? "wide" : "cap";
    return {
      role,
      skin,
      hair,
      hScale: 0.98 + rng() * 0.06,
      torsoColor: shirt,
      torsoScale: [1.04, 1.0, 1.0],
      legColor: denim,
      skirtScale: [0, 0, 0],
      skirtY: 0,
      skirtZ: 0,
      skirtColor: denim,
      accentType: "overalls",
      accentColor: denim,
      puffSleeve: false,
      hatStyle,
      hatColor,
      showHair: hatStyle === "cap" || hatStyle === "none",
    };
  }

  if (role === "boy" || role === "girl") {
    const hScale = 0.66 + rng() * 0.14;
    if (role === "boy") {
      const shirt = pick(["#c9c1b0", "#8da0b2", "#9e856d", "#c98b6c", "#7d8c78"], rng);
      const pants = pick(["#453f38", "#3a4554", "#594c3d", "#51555a"], rng);
      const hatStyle = era === "pioneer" ? "wide" : era === "midcentury" ? "none" : rng() < 0.6 ? "cap" : "none";
      return {
        role,
        skin,
        hair,
        hScale,
        torsoColor: shirt,
        torsoScale: [0.92, 1.0, 0.92],
        legColor: pants,
        skirtScale: [0, 0, 0],
        skirtY: 0,
        skirtZ: 0,
        skirtColor: pants,
        accentType: "none",
        accentColor: shirt,
        puffSleeve: false,
        hatStyle,
        hatColor: pick(["#584c40", "#6e655a", "#3d4248"], rng),
        showHair: hatStyle === "none" || hatStyle === "cap",
      };
    }
    const dress = pick(
      era === "midcentury"
        ? ["#c87878", "#7498b8", "#d8c474", "#82aa82", "#b88aa8"]
        : ["#b88d82", "#7c94a6", "#c6b692", "#8e9d86", "#a88392"],
      rng,
    );
    const hatStyle = era === "pioneer" ? (rng() < 0.7 ? "bonnet" : "none") : "none";
    return {
      role,
      skin,
      hair,
      hScale,
      torsoColor: dress,
      torsoScale: [0.88, 1.0, 0.88],
      legColor: "#d8cdb8",
      skirtScale: [0.76, 1.75, 0.76],
      skirtY: 1.95,
      skirtZ: 0,
      skirtColor: dress,
      accentType: "pinafore",
      accentColor: "#ded8ca",
      puffSleeve: false,
      hatStyle,
      hatColor: pick(["#d4c8b4", "#a88a74", "#8896a2"], rng),
      showHair: hatStyle === "none",
    };
  }

  if (role === "man") {
    const hScale = 0.97 + rng() * 0.08;
    if (era === "pioneer") {
      const coat = pick(["#2b2927", "#3a322b", "#2f353d", "#473c32"], rng);
      const pants = pick(["#49443e", "#5b5247", "#36383d", "#635a4e"], rng);
      const vest = pick(["#6c5342", "#7b6c52", "#4e5b52", "#744440"], rng);
      const hatStyle = rng() < 0.18 ? "tophat" : "wide";
      return {
        role,
        skin,
        hair,
        hScale,
        torsoColor: coat,
        torsoScale: [1.02, 1.02, 1.0],
        legColor: pants,
        skirtScale: [0.60, 1.15, 0.52],
        skirtY: 2.25,
        skirtZ: -0.02,
        skirtColor: coat,
        accentType: "vest",
        accentColor: vest,
        puffSleeve: false,
        hatStyle,
        hatColor: pick(["#2a2623", "#463a2f", "#5e5042"], rng),
        showHair: false,
      };
    }
    if (era === "victorian" || era === "edwardian") {
      const suit = pick(["#2f3136", "#3d3833", "#494642", "#353c46", "#54483d"], rng);
      const hatStyle = rng() < 0.78 ? "bowler" : "boater";
      return {
        role,
        skin,
        hair,
        hScale,
        torsoColor: suit,
        torsoScale: [1.02, 1.0, 1.0],
        legColor: suit,
        skirtScale: [0, 0, 0],
        skirtY: 0,
        skirtZ: 0,
        skirtColor: suit,
        accentType: "vest",
        accentColor: pick(["#585048", "#6b6154", "#474f58", "#6d5948"], rng),
        puffSleeve: false,
        hatStyle,
        hatColor: hatStyle === "boater" ? "#d9c484" : pick(["#262628", "#3e362e"], rng),
        showHair: false,
      };
    }
    if (era === "jazz") {
      const suit = pick(["#474b52", "#595047", "#3b424d", "#6e6559", "#3c3a38"], rng);
      const hatStyle = rng() < 0.48 ? "boater" : "fedora";
      return {
        role,
        skin,
        hair,
        hScale,
        torsoColor: suit,
        torsoScale: [1.01, 1.0, 1.0],
        legColor: suit,
        skirtScale: [0, 0, 0],
        skirtY: 0,
        skirtZ: 0,
        skirtColor: suit,
        accentType: "vest",
        accentColor: pick(["#5e564e", "#706658", "#4d555e", "#725e4e"], rng),
        puffSleeve: false,
        hatStyle,
        hatColor: hatStyle === "boater" ? "#dcc786" : pick(["#5b554e", "#49433d", "#6f6a63"], rng),
        showHair: false,
      };
    }
    if (era === "depression") {
      const coat = pick(["#4f4c48", "#5b5146", "#3e464f", "#686259", "#4a443e"], rng);
      const slacks = pick(["#44423f", "#534e47", "#394048"], rng);
      return {
        role,
        skin,
        hair,
        hScale,
        torsoColor: coat,
        torsoScale: [1.01, 1.0, 1.0],
        legColor: slacks,
        skirtScale: [0, 0, 0],
        skirtY: 0,
        skirtZ: 0,
        skirtColor: slacks,
        accentType: "none",
        accentColor: coat,
        puffSleeve: false,
        hatStyle: rng() < 0.85 ? "fedora" : "none",
        hatColor: pick(["#5b544b", "#45413c", "#746b5f"], rng),
        showHair: true,
      };
    }
    // midcentury 1950-1970+
    const shirt = pick(["#d4d0c6", "#7e96ad", "#9aa58f", "#b89578", "#687a8c", "#c4b698"], rng);
    const slacks = pick(["#43484e", "#5b5346", "#363b42", "#6e675b"], rng);
    const hatStyle = rng() < 0.22 ? "fedora" : rng() < 0.34 ? "cap" : "none";
    return {
      role,
      skin,
      hair,
      hScale,
      torsoColor: shirt,
      torsoScale: [1.0, 1.0, 0.98],
      legColor: slacks,
      skirtScale: [0, 0, 0],
      skirtY: 0,
      skirtZ: 0,
      skirtColor: slacks,
      accentType: "none",
      accentColor: shirt,
      puffSleeve: false,
      hatStyle,
      hatColor: pick(["#5b564e", "#484e58"], rng),
      showHair: hatStyle === "none" || hatStyle === "cap",
    };
  }

  // role === "woman"
  const hScale = 0.90 + rng() * 0.07;
  if (era === "pioneer") {
    const dress = pick(["#5d4b58", "#475966", "#6c5b48", "#4e5c4a", "#784c4b", "#5c5750"], rng);
    const shawl = pick(["#8e4844", "#5c6858", "#7d6b52", "#3a3735", "#94856e"], rng);
    return {
      role,
      skin,
      hair,
      hScale,
      torsoColor: dress,
      torsoScale: [0.88, 0.98, 0.88],
      legColor: "#2d2825",
      skirtScale: [1.14, 2.75, 1.12],
      skirtY: 1.48,
      skirtZ: 0,
      skirtColor: dress,
      accentType: "shawl",
      accentColor: shawl,
      puffSleeve: false,
      hatStyle: "bonnet",
      hatColor: pick(["#b8a990", "#685848", "#494d54", "#846858"], rng),
      showHair: false,
    };
  }
  if (era === "victorian") {
    const gown = pick(["#484050", "#3a4d57", "#624448", "#4b5442", "#594b3e"], rng);
    const hatStyle = rng() < 0.65 ? "bonnet" : "edwardian";
    return {
      role,
      skin,
      hair,
      hScale,
      torsoColor: gown,
      torsoScale: [0.86, 0.98, 0.86],
      legColor: "#2a2624",
      skirtScale: [0.92, 2.75, 1.18],
      skirtY: 1.48,
      skirtZ: -0.22,
      skirtColor: gown,
      accentType: "shawl",
      accentColor: pick(["#c9bfae", "#393432", "#6e4e4a"], rng),
      puffSleeve: true,
      hatStyle,
      hatColor: pick(["#3f3834", "#5c4d44", "#7e7262"], rng),
      showHair: true,
    };
  }
  if (era === "edwardian") {
    // Shirtwaist blouse + long flared skirt
    const blouse = pick(["#e3ded2", "#d8dfe4", "#dfd2cc", "#dce0d2"], rng);
    const skirt = pick(["#30343a", "#453b35", "#38423a", "#4c393c"], rng);
    return {
      role,
      skin,
      hair,
      hScale,
      torsoColor: blouse,
      torsoScale: [0.88, 0.98, 0.88],
      legColor: "#282524",
      skirtScale: [0.96, 2.75, 0.98],
      skirtY: 1.48,
      skirtZ: -0.04,
      skirtColor: skirt,
      accentType: "belt",
      accentColor: skirt,
      puffSleeve: false,
      hatStyle: "edwardian",
      hatColor: pick(["#4d443d", "#6d5f50", "#c9bfa6"], rng),
      showHair: true,
    };
  }
  if (era === "jazz") {
    // 1910s-20s shorter skirts & cloche hats
    const dress = pick(["#647482", "#8e6a6a", "#a39072", "#5e6e5c", "#4b4b54", "#9e8b92"], rng);
    const hose = "#cbb39a";
    return {
      role,
      skin,
      hair,
      hScale,
      torsoColor: dress,
      torsoScale: [0.86, 0.98, 0.84],
      legColor: hose,
      skirtScale: [0.70, 1.85, 0.68],
      skirtY: 1.92,
      skirtZ: 0,
      skirtColor: dress,
      accentType: "belt",
      accentColor: pick(["#dfd8c8", "#353330", "#7c5850"], rng),
      puffSleeve: false,
      hatStyle: "cloche",
      hatColor: pick(["#7e695c", "#4c5660", "#b8a890", "#6e4e52"], rng),
      showHair: false,
    };
  }
  if (era === "depression") {
    // 1930s-40s print dresses (patterned pastel/floral-toned body + crisp collar/belt accent)
    const dress = pick(["#7d96a8", "#b47c7e", "#8fa07c", "#b8a26c", "#957e9a", "#6e8682"], rng);
    const trim = pick(["#e2dccf", "#dfd3b8", "#c87872", "#4e5e6c"], rng);
    return {
      role,
      skin,
      hair,
      hScale,
      torsoColor: dress,
      torsoScale: [0.87, 0.98, 0.86],
      legColor: "#cfa98d",
      skirtScale: [0.78, 2.05, 0.78],
      skirtY: 1.82,
      skirtZ: 0,
      skirtColor: dress,
      accentType: "belt",
      accentColor: trim,
      puffSleeve: false,
      hatStyle: rng() < 0.35 ? "cloche" : "none",
      hatColor: pick(["#5c544d", "#48525c", "#a4927c"], rng),
      showHair: true,
    };
  }
  // midcentury 1950-1970+
  const blouse = pick(["#dfd9cc", "#86a2ba", "#c88682", "#96aa88", "#d6be78"], rng);
  const skirt = pick(["#49525c", "#6c5a4d", "#4c5c4e", "#6b474d", "#3d424a"], rng);
  return {
    role,
    skin,
    hair,
    hScale,
    torsoColor: blouse,
    torsoScale: [0.87, 0.98, 0.86],
    legColor: "#d4ae92",
    skirtScale: [0.78, 1.80, 0.76],
    skirtY: 1.94,
    skirtZ: 0,
    skirtColor: skirt,
    accentType: "belt",
    accentColor: skirt,
    puffSleeve: false,
    hatStyle: "none",
    hatColor: "#5c544c",
    showHair: true,
  };
}

function distPointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export function addPeople(data, scene, year, colliders, modernPaved, trees = []) {
  const era = peopleEraFor(year);
  const targetCount = peopleCountForYear(year);
  if (!targetCount) return null;

  const streets = (data.streets || []).filter((s) => !s.points);
  const tracks = data.tracks || [];
  const props = data.props || [];
  const buildings = data.buildings || [];
  const blocks = data.blocks || [];

  const insideBuilding = (x, z, pad = 2.0) => {
    for (const c of colliders) {
      if (x >= c.minX - pad && x <= c.maxX + pad && z >= c.minZ - pad && z <= c.maxZ + pad) return true;
    }
    return false;
  };

  const inCarriageway = (x, z, pad = 0.8) => {
    for (const s of streets) {
      const margin = s.width >= 70 ? 10 : 12;
      const half = s.width / 2 - margin + pad;
      if (s.axis === "x") {
        if (x >= s.from - 2 && x <= s.to + 2 && Math.abs(z - s.at) <= half) return true;
      } else {
        if (z >= s.from - 2 && z <= s.to + 2 && Math.abs(x - s.at) <= half) return true;
      }
    }
    return false;
  };

  const onTrack = (x, z, minDist = 8.5) => {
    for (const tr of tracks) {
      const pts = tr.points || [];
      for (let i = 0; i < pts.length - 1; i++) {
        if (distPointSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < minDist) return true;
      }
    }
    return false;
  };

  const nearPropOrTree = (x, z) => {
    for (const p of props) {
      const r = p.type === "wagon" || p.type === "lumber" || p.type === "coal" ? 6.5 : p.type === "horse" || p.type === "hitching" || p.type === "trough" ? 4.2 : 2.2;
      if (Math.hypot(x - p.x, z - p.z) < r) return true;
    }
    for (const t of trees) {
      if (Math.hypot(x - t.x, z - t.z) < 2.4) return true;
    }
    return false;
  };

  const isClear = (x, z, allowPlatform = false) => {
    if (insideBuilding(x, z, 1.8)) return false;
    if (inCarriageway(x, z, 0.8)) return false;
    if (onTrack(x, z, allowPlatform ? 3.2 : 9.0)) return false;
    if (nearPropOrTree(x, z)) return false;
    return true;
  };

  const groundYAt = (x, z) => {
    if (modernPaved) {
      if (x >= -480 && x <= -220 && z >= 174 && z <= 202) return 1.325;
      if (x >= 280 && x <= 520 && z >= 80 && z <= 132) return 0.50;
      if (x >= 335 && x <= 425 && z >= 168 && z <= 184) return 0.41;
      if (Math.abs(Math.abs(z) - 156) < 42 || (Math.abs(x + 420) < 42 && z >= 180 && z <= 520)) return 0.32;
    }
    for (const b of buildings) {
      if (b.id === "cbq-depot" && x >= b.x - b.width / 2 - 8 && x <= b.x + b.width / 2 + 8 && Math.abs(z - (b.z + 21.2)) <= 6.2) return 0.75;
      if (b.id === "tpw-depot" && x >= b.x - b.width / 2 - 8 && x <= b.x + b.width / 2 + 8 && Math.abs(z - (b.z + 19.2)) <= 6.2) return 0.36;
      if (b.id === "junction-depot" && x >= b.x - b.width / 2 - 10 && x <= b.x + b.width / 2 + 10 && Math.abs(z - (b.z + 23)) <= 8.2) return 0.35;
    }
    for (const w of data.boardwalks || []) {
      const half = (year >= 1902 ? w.width + 2 : w.width) / 2 + 1.0;
      if (w.axis === "x") {
        if (x >= w.from && x <= w.to && Math.abs(z - w.at) <= half) return year < 1902 ? 0.575 : 0.24;
      } else {
        if (z >= w.from && z <= w.to && Math.abs(x - w.at) <= half) return year < 1902 ? 0.575 : 0.24;
      }
    }
    if (year >= 1902 && (Math.abs(Math.abs(z) - 186) <= 6 || (Math.abs(x + 420) <= 30 && z >= 120 && z <= 610) || (Math.abs(x) <= 30 && z >= 120 && z <= 610))) return 0.20;
    for (const blk of blocks) {
      if (x >= blk.x0 && x <= blk.x1 && z >= blk.z0 && z <= blk.z1) return 0.03;
    }
    if (year <= 1860) {
      for (const b of buildings) {
        if (Math.abs(x - b.x) <= b.width / 2 + 14 && Math.abs(z - b.z) <= b.depth / 2 + 16) return 0.085;
      }
    }
    return -0.3;
  };

  // Split boardwalks into safe single-block spans clear of cross-streets.
  const crossIntervals = (axis) => {
    const opp = axis === "x" ? "z" : "x";
    return streets
      .filter((s) => s.axis === opp)
      .map((s) => [s.at - s.width / 2 - 3, s.at + s.width / 2 + 3])
      .sort((a, b) => a[0] - b[0]);
  };
  const crossZ = crossIntervals("x");
  const crossX = crossIntervals("z");

  const splitSpan = (from, to, cuts) => {
    let segs = [[Math.min(from, to), Math.max(from, to)]];
    for (const [c0, c1] of cuts) {
      const next = [];
      for (const [a, b] of segs) {
        if (c1 <= a || c0 >= b) next.push([a, b]);
        else {
          if (c0 - a >= 26) next.push([a, c0]);
          if (b - c1 >= 26) next.push([c1, b]);
        }
      }
      segs = next;
    }
    return segs;
  };

  const sidewalkSpots = [];
  for (const w of data.boardwalks || []) {
    const cuts = w.axis === "x" ? crossZ : crossX;
    for (const [a, b] of splitSpan(w.from, w.to, cuts)) {
      const laneOff = w.axis === "x" ? (w.at > 0 ? -1.4 : 1.4) : 0;
      sidewalkSpots.push({ axis: w.axis, at: w.at + laneOff, from: a + 4, to: b - 4 });
    }
  }
  if (modernPaved) {
    sidewalkSpots.push({ axis: "x", at: 186, from: -472, to: -228 });
    sidewalkSpots.push({ axis: "x", at: 182, from: -110, to: -28 });
    sidewalkSpots.push({ axis: "x", at: 182, from: 28, to: 390 });
  }

  // Storefront standing spots.
  const storeSpots = [];
  const facingVec = { "+z": [0, 1], "-z": [0, -1], "+x": [1, 0], "-x": [-1, 0] };
  for (const b of buildings) {
    if (!["frame-store", "brick-store", "hotel", "bank"].includes(b.kind)) continue;
    const fv = facingVec[b.facing];
    if (!fv) continue;
    // Stay clear of deep 8.5 ft porches (Hendee, Cole, hotels) by stepping 10-12 ft out or onto walk.
    const porchClear = b.id === "hendee-store-22" || b.id === "cole-building-10" || b.kind === "hotel" ? 11.5 : 4.5;
    const reach = b.depth / 2 + porchClear;
    for (const lat of [-b.width * 0.22, b.width * 0.22]) {
      const sx = b.x + fv[0] * reach + (fv[0] === 0 ? lat : 0);
      const sz = b.z + fv[1] * reach + (fv[1] === 0 ? lat : 0);
      if (isClear(sx, sz)) {
        storeSpots.push({ x: sx, z: sz, yaw: Math.atan2(fv[0], fv[1]) + (lat > 0 ? -0.45 : 0.45) });
      }
    }
  }

  // Depot platform spots.
  const depotSpots = [];
  for (const b of buildings) {
    if (b.id === "cbq-depot") {
      // Platform spans x = b.x +- 50, z = -20.8 .. -8.8; stay on depot half z = -20.2..-18.6 clear of house track z=-16.
      for (const dx of [-34, -20, 16, 28, 38]) {
        const sx = b.x + dx;
        const sz = b.z + 16.5;
        const minX = dx < 0 ? b.x - 40 : b.x + 12;
        const maxX = dx < 0 ? b.x - 12 : b.x + 40;
        if (isClear(sx, sz, true)) depotSpots.push({ x: sx, z: sz, yaw: 0.2, minX, maxX });
      }
    } else if (b.id === "tpw-depot") {
      for (const dx of [-28, -10, 14, 30]) {
        const sx = b.x + dx;
        const sz = b.z + 18.0;
        if (isClear(sx, sz, true)) depotSpots.push({ x: sx, z: sz, yaw: 0.1, minX: b.x - 36, maxX: b.x + 36 });
      }
    } else if (b.id === "junction-depot") {
      for (const dx of [-24, 0, 22]) {
        const sx = b.x + dx;
        const sz = b.z + 20.5;
        if (isClear(sx, sz, true)) depotSpots.push({ x: sx, z: sz, yaw: 0.1, minX: b.x - 34, maxX: b.x + 34 });
      }
    }
  }

  // Residential yard & park spots.
  const yardSpots = [];
  for (const b of buildings) {
    if (b.kind !== "house" && b.kind !== "church") continue;
    const fv = facingVec[b.facing] || [0, 1];
    const dist = b.depth / 2 + 9.5;
    const sx = b.x + fv[0] * dist + (fv[0] === 0 ? 5.5 : 0);
    const sz = b.z + fv[1] * dist + (fv[1] === 0 ? 5.5 : 0);
    if (isClear(sx, sz)) yardSpots.push({ x: sx, z: sz, yaw: Math.atan2(fv[0], fv[1]) });
  }
  for (const blk of blocks) {
    const cx = (blk.x0 + blk.x1) / 2;
    const cz = (blk.z0 + blk.z1) / 2;
    for (const [ox, oz] of [[-48, -32], [52, 28], [-30, 58]]) {
      const sx = cx + ox;
      const sz = cz + oz;
      if (isClear(sx, sz)) yardSpots.push({ x: sx, z: sz, yaw: 0.6 });
    }
  }

  const rng = makeRng(year * 977 + 131);
  const actors = [];

  const addActor = (spec) => {
    const rRoll = rng();
    let role;
    if (rRoll < 0.34) role = "man";
    else if (rRoll < 0.68) role = "woman";
    else if (rRoll < 0.84) role = "farmer";
    else role = rng() < 0.52 ? "boy" : "girl";
    const profile = dressProfile(era, role, rng);
    actors.push({ ...spec, profile, phase: rng() * Math.PI * 2 });
  };

  // 1854/1860 pioneer distribution: Markham store + pioneer houses/stores.
  if (year <= 1860) {
    for (let i = 0; i < Math.min(storeSpots.length, year <= 1854 ? 2 : 5); i++) {
      const sp = storeSpots[(i * 3) % storeSpots.length];
      addActor({
        kind: "idle",
        x: sp.x,
        z: sp.z,
        y: groundYAt(sp.x, sp.z),
        yaw: sp.yaw,
      });
    }
    const need = targetCount - actors.length;
    for (let i = 0; i < need && yardSpots.length; i++) {
      const sp = yardSpots[(i * 7 + 1) % yardSpots.length];
      addActor({
        kind: "idle",
        x: sp.x,
        z: sp.z,
        y: groundYAt(sp.x, sp.z),
        yaw: sp.yaw + (rng() - 0.5) * 0.8,
      });
    }
  } else {
    // 1870+: sidewalks, storefronts, depots, and residential yards proportional to population.
    const nDepot = depotSpots.length ? Math.max(2, Math.round(targetCount * 0.16)) : 0;
    const nStore = storeSpots.length ? Math.max(4, Math.round(targetCount * 0.24)) : 0;
    const nYard = yardSpots.length ? Math.max(3, Math.round(targetCount * 0.18)) : 0;
    const nWalk = Math.max(0, targetCount - nDepot - nStore - nYard);

    for (let i = 0; i < nWalk && sidewalkSpots.length; i++) {
      const seg = sidewalkSpots[(i * 5 + Math.floor(rng() * 3)) % sidewalkSpots.length];
      const span = seg.to - seg.from;
      const mid = seg.from + (0.15 + rng() * 0.7) * span;
      const halfRun = Math.min(span * 0.4, 24 + rng() * 32);
      const a = Math.max(seg.from, mid - halfRun);
      const b = Math.min(seg.to, mid + halfRun);
      const ax = seg.axis === "x" ? a : seg.at;
      const az = seg.axis === "x" ? seg.at : a;
      const bx = seg.axis === "x" ? b : seg.at;
      const bz = seg.axis === "x" ? seg.at : b;
      // Validate start, midpoint, and end clear of buildings/tracks/props.
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (isClear(ax, az) && isClear(mx, mz) && isClear(bx, bz)) {
        const stroll = rng() < 0.72 && Math.hypot(bx - ax, bz - az) > 18;
        addActor(
          stroll
            ? {
                kind: "walk",
                ax,
                az,
                bx,
                bz,
                x: mx,
                z: mz,
                y: groundYAt(mx, mz),
                yaw: Math.atan2(bx - ax, bz - az),
                speed: 2.2 + rng() * 0.9,
              }
            : {
                kind: "idle",
                x: mx,
                z: mz,
                y: groundYAt(mx, mz),
                yaw: (rng() - 0.5) * Math.PI * 2,
              },
        );
      } else if (isClear(mx, mz)) {
        addActor({ kind: "idle", x: mx, z: mz, y: groundYAt(mx, mz), yaw: rng() * Math.PI * 2 });
      }
    }

    for (let i = 0; i < nStore && storeSpots.length; i++) {
      const sp = storeSpots[(i * 7 + 2) % storeSpots.length];
      if (!actors.some((a) => Math.hypot(a.x - sp.x, a.z - sp.z) < 2.2)) {
        addActor({ kind: "idle", x: sp.x, z: sp.z, y: groundYAt(sp.x, sp.z), yaw: sp.yaw });
      }
    }

    for (let i = 0; i < nDepot && depotSpots.length; i++) {
      const sp = depotSpots[i % depotSpots.length];
      const jx = sp.x + (i >= depotSpots.length ? (rng() - 0.5) * 6 : 0);
      if (isClear(jx, sp.z, true) && !actors.some((a) => Math.hypot(a.x - jx, a.z - sp.z) < 2.2)) {
        addActor({
          kind: i % 3 === 0 ? "walk" : "idle",
          ax: Math.max(sp.minX, jx - 10),
          az: sp.z,
          bx: Math.min(sp.maxX, jx + 10),
          bz: sp.z,
          x: jx,
          z: sp.z,
          y: groundYAt(jx, sp.z),
          yaw: sp.yaw + (rng() - 0.5) * 0.4,
          speed: 1.9,
        });
      }
    }

    for (let i = 0; i < nYard && yardSpots.length; i++) {
      const sp = yardSpots[(i * 11 + 3) % yardSpots.length];
      if (!actors.some((a) => Math.hypot(a.x - sp.x, a.z - sp.z) < 2.2)) {
        addActor({ kind: "idle", x: sp.x, z: sp.z, y: groundYAt(sp.x, sp.z), yaw: sp.yaw });
      }
    }
  }

  const count = actors.length;
  if (!count) return null;

  // Shared unit geometries for instancing (zero photo textures).
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.86, metalness: 0.02 });
  const makeInst = (geo) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  };

  // Pivoted limb geometries: top at y = 0 so X rotation swings cleanly around hip / shoulder.
  const legGeo = new THREE.CylinderGeometry(0.19, 0.14, 2.55, 8);
  legGeo.translate(0, -1.275, 0);
  const shoeGeo = new THREE.BoxGeometry(0.26, 0.22, 0.46);
  shoeGeo.translate(0, -2.54, 0.08);
  const armGeo = new THREE.CylinderGeometry(0.15, 0.12, 1.95, 8);
  armGeo.translate(0, -0.975, 0);
  const torsoGeo = new THREE.CylinderGeometry(0.46, 0.39, 2.05, 10);
  const skirtGeo = new THREE.CylinderGeometry(0.36, 0.78, 1.0, 12);
  const accentGeo = new THREE.CylinderGeometry(0.46, 0.42, 1.0, 10);
  const headGeo = new THREE.SphereGeometry(0.37, 10, 8);
  const hairGeo = new THREE.SphereGeometry(0.395, 10, 8);
  const puffGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const crownGeo = new THREE.CylinderGeometry(0.37, 0.40, 1.0, 10);
  const brimGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.08, 12);

  const heads = makeInst(headGeo);
  const hairs = makeInst(hairGeo);
  const torsos = makeInst(torsoGeo);
  const skirts = makeInst(skirtGeo);
  const accents = makeInst(accentGeo);
  const legsL = makeInst(legGeo);
  const legsR = makeInst(legGeo);
  const shoesL = makeInst(shoeGeo);
  const shoesR = makeInst(shoeGeo);
  const armsL = makeInst(armGeo);
  const armsR = makeInst(armGeo);
  const puffsL = makeInst(puffGeo);
  const puffsR = makeInst(puffGeo);
  const hatCrowns = makeInst(crownGeo);
  const hatBrims = makeInst(brimGeo);

  const allMeshes = [
    heads, hairs, torsos, skirts, accents,
    legsL, legsR, shoesL, shoesR, armsL, armsR, puffsL, puffsR,
    hatCrowns, hatBrims,
  ];
  const group = new THREE.Group();
  group.name = "pedestrians";
  group.add(...allMeshes);
  scene.add(group);

  const c = new THREE.Color();
  actors.forEach((a, i) => {
    const p = a.profile;
    heads.setColorAt(i, c.set(p.skin));
    hairs.setColorAt(i, c.set(p.hair));
    torsos.setColorAt(i, c.set(p.torsoColor));
    skirts.setColorAt(i, c.set(p.skirtColor));
    accents.setColorAt(i, c.set(p.accentColor));
    legsL.setColorAt(i, c.set(p.legColor));
    legsR.setColorAt(i, c.set(p.legColor));
    shoesL.setColorAt(i, c.set("#261f1a"));
    shoesR.setColorAt(i, c.set("#261f1a"));
    armsL.setColorAt(i, c.set(p.torsoColor));
    armsR.setColorAt(i, c.set(p.torsoColor));
    puffsL.setColorAt(i, c.set(p.torsoColor));
    puffsR.setColorAt(i, c.set(p.torsoColor));
    hatCrowns.setColorAt(i, c.set(p.hatColor));
    hatBrims.setColorAt(i, c.set(p.hatColor));
  });
  for (const m of allMeshes) {
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  const rootMat = new THREE.Matrix4();
  const partMat = new THREE.Matrix4();
  const finalMat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();

  const setPart = (mesh, i, lx, ly, lz, rx, ry, rz, sx, sy, sz) => {
    pos.set(lx, ly, lz);
    euler.set(rx, ry, rz, "YXZ");
    quat.setFromEuler(euler);
    scl.set(sx, sy, sz);
    partMat.compose(pos, quat, scl);
    finalMat.multiplyMatrices(rootMat, partMat);
    mesh.setMatrixAt(i, finalMat);
  };

  const applyPose = (elapsed) => {
    actors.forEach((a, i) => {
      const p = a.profile;
      const hs = p.hScale;
      let px = a.x;
      let pz = a.z;
      let py = a.y;
      let yaw = a.yaw;
      let legSwing = 0;
      let armSwing = 0;
      let bob = 0;
      let headYaw = 0;

      if (a.kind === "walk") {
        const dist = Math.hypot(a.bx - a.ax, a.bz - a.az);
        const period = Math.max(4, (dist * 2) / a.speed);
        const u = ((elapsed + a.phase * 3.1) % period) / period;
        const going = u < 0.5;
        const t = going ? u * 2 : (1 - u) * 2;
        px = a.ax + (a.bx - a.ax) * t;
        pz = a.az + (a.bz - a.az) * t;
        py = groundYAt(px, pz);
        yaw = Math.atan2(a.bx - a.ax, a.bz - a.az) + (going ? 0 : Math.PI);
        const stride = elapsed * a.speed * 1.9 + a.phase;
        legSwing = Math.sin(stride) * 0.36;
        armSwing = -Math.sin(stride) * 0.28;
        bob = Math.abs(Math.sin(stride)) * 0.05;
      } else {
        const idle = elapsed * 1.1 + a.phase;
        headYaw = Math.sin(idle) * 0.14;
        armSwing = Math.sin(idle * 0.8) * 0.04;
      }

      pos.set(px, py + bob, pz);
      euler.set(0, yaw, 0, "YXZ");
      quat.setFromEuler(euler);
      scl.set(hs, hs, hs);
      rootMat.compose(pos, quat, scl);

      setPart(heads, i, 0, 5.15, 0, 0, headYaw, 0, 1, 1.05, 1);
      if (p.showHair) {
        setPart(hairs, i, 0, 5.20, -0.06, 0, headYaw, 0, 1.02, 0.96, 1.04);
      } else {
        setPart(hairs, i, 0, 5.20, 0, 0, 0, 0, 0, 0, 0);
      }

      setPart(torsos, i, 0, 3.60, 0, 0, 0, 0, p.torsoScale[0] * 1.25, p.torsoScale[1], p.torsoScale[2] * 0.85);

      if (p.skirtScale[1] > 0) {
        setPart(skirts, i, 0, p.skirtY, p.skirtZ, 0, 0, 0, p.skirtScale[0], p.skirtScale[1], p.skirtScale[2]);
      } else {
        setPart(skirts, i, 0, 2, 0, 0, 0, 0, 0, 0, 0);
      }

      if (p.accentType === "vest") {
        setPart(accents, i, 0, 3.55, 0.16, 0, 0, 0, p.torsoScale[0] * 0.66, 1.25, p.torsoScale[2] * 0.66);
      } else if (p.accentType === "shawl") {
        setPart(accents, i, 0, 4.15, -0.02, 0, 0, 0, 1.10, 0.92, 0.92);
      } else if (p.accentType === "overalls") {
        setPart(accents, i, 0, 3.25, 0.16, 0, 0, 0, p.torsoScale[0] * 0.74, 1.40, p.torsoScale[2] * 0.68);
      } else if (p.accentType === "belt") {
        setPart(accents, i, 0, 2.75, 0, 0, 0, 0, p.torsoScale[0] * 1.06, 0.22, p.torsoScale[2] * 0.88);
      } else if (p.accentType === "pinafore") {
        setPart(accents, i, 0, 2.95, 0.10, 0, 0, 0, 0.68, 1.55, 0.66);
      } else {
        setPart(accents, i, 0, 3, 0, 0, 0, 0, 0, 0, 0);
      }

      const hideLegs = p.skirtScale[1] > 2.4;
      const ls = hideLegs ? 0 : 1;
      setPart(legsL, i, -0.22, 2.65, 0, legSwing, 0, 0, ls, ls, ls);
      setPart(legsR, i, 0.22, 2.65, 0, -legSwing, 0, 0, ls, ls, ls);
      setPart(shoesL, i, -0.22, 2.65, 0, legSwing, 0, 0, 1, 1, 1);
      setPart(shoesR, i, 0.22, 2.65, 0, -legSwing, 0, 0, 1, 1, 1);

      const shoulderX = p.torsoScale[0] * 0.68;
      setPart(armsL, i, -shoulderX, 4.52, 0, armSwing, 0, 0.06, 1, 1, 1);
      setPart(armsR, i, shoulderX, 4.52, 0, -armSwing, 0, -0.06, 1, 1, 1);

      if (p.puffSleeve) {
        setPart(puffsL, i, -shoulderX - 0.04, 4.28, 0, 0, 0, 0, 1.18, 1.32, 1.18);
        setPart(puffsR, i, shoulderX + 0.04, 4.28, 0, 0, 0, 0, 1.18, 1.32, 1.18);
      } else {
        setPart(puffsL, i, 0, 4, 0, 0, 0, 0, 0, 0, 0);
        setPart(puffsR, i, 0, 4, 0, 0, 0, 0, 0, 0, 0);
      }

      // Hats
      const hsMode = p.hatStyle;
      if (hsMode === "wide") {
        setPart(hatCrowns, i, 0, 5.56, 0, 0, headYaw, 0, 0.98, 0.42, 0.98);
        setPart(hatBrims, i, 0, 5.38, 0, 0, headYaw, 0, 0.72, 1.0, 0.72);
      } else if (hsMode === "tophat") {
        setPart(hatCrowns, i, 0, 5.75, 0, 0, headYaw, 0, 0.92, 0.80, 0.92);
        setPart(hatBrims, i, 0, 5.38, 0, 0, headYaw, 0, 0.60, 1.0, 0.60);
      } else if (hsMode === "bonnet") {
        setPart(hatCrowns, i, 0, 5.24, -0.06, -0.18, headYaw, 0, 1.12, 0.56, 1.24);
        setPart(hatBrims, i, 0, 5.30, 0, 0, 0, 0, 0, 0, 0);
      } else if (hsMode === "bowler") {
        setPart(hatCrowns, i, 0, 5.54, 0, 0, headYaw, 0, 0.94, 0.40, 0.94);
        setPart(hatBrims, i, 0, 5.36, 0, 0, headYaw, 0, 0.52, 1.0, 0.52);
      } else if (hsMode === "boater") {
        setPart(hatCrowns, i, 0, 5.50, 0, 0, headYaw, 0, 0.98, 0.30, 0.98);
        setPart(hatBrims, i, 0, 5.36, 0, 0, headYaw, 0, 0.66, 1.0, 0.66);
      } else if (hsMode === "fedora") {
        setPart(hatCrowns, i, 0, 5.54, 0, 0.04, headYaw, 0, 0.96, 0.40, 1.02);
        setPart(hatBrims, i, 0, 5.36, 0.04, 0.06, headYaw, 0, 0.62, 1.0, 0.66);
      } else if (hsMode === "edwardian") {
        setPart(hatCrowns, i, 0, 5.52, 0, 0, headYaw, 0, 0.96, 0.32, 0.96);
        setPart(hatBrims, i, 0, 5.38, 0, 0, headYaw, 0, 0.78, 1.0, 0.78);
      } else if (hsMode === "cloche") {
        setPart(hatCrowns, i, 0, 5.42, 0, 0.05, headYaw, 0, 1.04, 0.44, 1.04);
        setPart(hatBrims, i, 0, 5.24, 0.04, 0.12, headYaw, 0, 0.46, 1.0, 0.48);
      } else if (hsMode === "cap") {
        setPart(hatCrowns, i, 0, 5.46, -0.02, 0, headYaw, 0, 0.94, 0.24, 0.96);
        setPart(hatBrims, i, 0, 5.35, 0.18, 0.08, headYaw, 0, 0.36, 1.0, 0.46);
      } else {
        setPart(hatCrowns, i, 0, 5.5, 0, 0, 0, 0, 0, 0, 0);
        setPart(hatBrims, i, 0, 5.4, 0, 0, 0, 0, 0, 0, 0);
      }
    });

    for (const m of allMeshes) m.instanceMatrix.needsUpdate = true;
  };

  applyPose(0);
  return (elapsed) => applyPose(elapsed);
}
