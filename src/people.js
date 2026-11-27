import * as THREE from "three";
import { worldToPlat } from "./orient.js";
import {
  makeHeadGeo,
  makeEyeWhitesGeo,
  makeIrisesGeo,
  makeBrowsGeo,
  makeMouthGeo,
  makeBeardGeo,
  makeNeckGeo,
  makeHairBaseGeo,
  makeHairBunGeo,
  makeHairSideBobGeo,
  makeTorsoMenGeo,
  makeTorsoShirtGeo,
  makeTorsoWomenGeo,
  makePelvisGeo,
  makeCoatTailGeo,
  makeShirtFrontGeo,
  makeWomanCollarGeo,
  makeLapelsGeo,
  makeTieGeo,
  makeVestGeo,
  makeOverallsBibGeo,
  makeShawlGeo,
  makeSkirtFullGeo,
  makeSkirtBustleGeo,
  makeSkirtMidGeo,
  makeSkirtShortGeo,
  makeThighGeo,
  makeCalfGeo,
  makeShoeGeo,
  makeUpperArmGeo,
  makeForearmGeo,
  makeHandGeo,
  makePuffSleeveGeo,
  makeHatCrownCylGeo,
  makeFedoraCrownGeo,
  makeHatDomeGeo,
  makeHatBrimCurvedGeo,
  makeHatBrimFlatGeo,
  makeHatBandGeo,
  makeBonnetGeo,
} from "./people-geo.js";

// Period pedestrians (preview/people): parametric articulated figures rendered with
// InstancedMesh (no photo textures). Smooth sculpted forms (~7.5 heads tall), facial
// features, voluminous hair, tailored coats/skirts, articulated 2-segment limbs,
// hands, shoes, varied builds, and natural weight-shift / walking poses.

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
  if (year < 1910) return "edwardian";   // 1900-1909: sack suits, bowlers; shirtwaists & long flared skirts
  if (year < 1930) return "jazz";        // 1910-1929: boaters, fedoras; shorter skirts & cloche hats
  if (year < 1950) return "depression";  // 1930-1949: fedoras, overalls; print dresses
  return "midcentury";                   // 1950-1970+: casual slacks, skirts, work clothes
}

export function peopleBand(year) {
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

const SKIN_TONES = ["#d6a785", "#c89672", "#b98460", "#dcb18f", "#ae7b58", "#c28e6b"];
const HAIR_TONES = ["#261d17", "#3f2c1f", "#5e432c", "#7c603f", "#55504c", "#1a1614", "#8e877e"];
const EYE_TONES = ["#2c2018", "#352c24", "#2f3d48", "#483526"];

function lipToneFor(skinHex) {
  const c = new THREE.Color(skinHex);
  c.lerp(new THREE.Color("#844038"), 0.56);
  return `#${c.getHexString()}`;
}

function colorDist2(a, b) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  const dr = ca.r - cb.r;
  const dg = ca.g - cb.g;
  const db = ca.b - cb.b;
  return dr * dr + dg * dg + db * db;
}

function isSkinLike(hex, skin = null) {
  if (skin && colorDist2(hex, skin) < 0.012) return true;
  return SKIN_TONES.some((tone) => colorDist2(hex, tone) < 0.007);
}

const SAFE_SHIRTS = ["#d8d2c4", "#7d93a8", "#6a7b5c", "#8b5a4a", "#4f6270", "#eae5da", "#6e8aa4", "#7a8b68"];

function shiftHex(hex, turns, rng) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.h = (hsl.h + turns + rng() * 0.06) % 1;
  if (hsl.h < 0) hsl.h += 1;
  // Keep cloth out of the skin value range if it drifted toward pale peach
  if (hsl.s < 0.12) hsl.s = 0.18;
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return `#${c.getHexString()}`;
}

function ensureClothed(profile) {
  const clothEqualsTorso = profile.sleeveColor === profile.torsoColor;
  const dressMatched = profile.skirtKind !== "none" && profile.skirtKind !== "short" && profile.skirtColor === profile.torsoColor;
  if (isSkinLike(profile.torsoColor, profile.skin)) {
    const safe = SAFE_SHIRTS.filter((c) => !isSkinLike(c, profile.skin));
    profile.torsoColor = safe[Math.floor((profile.hScale * 97) % safe.length)];
    if (clothEqualsTorso) profile.sleeveColor = profile.torsoColor;
    if (dressMatched) profile.skirtColor = profile.torsoColor;
  }
  if (isSkinLike(profile.sleeveColor, profile.skin)) {
    profile.sleeveColor = isSkinLike(profile.torsoColor, profile.skin) ? SAFE_SHIRTS[0] : profile.torsoColor;
  }
}

function ensureNeighborVariety(actors, rng) {
  const poses = ["casual", "hip", "folded", "chatting"];
  const hatSwap = {
    cloche: "none",
    none: "cloche",
    boater: "fedora",
    fedora: "boater",
    bowler: "boater",
    wide: "cap",
    cap: "wide",
    bonnet: "edwardian",
    edwardian: "bonnet",
    tophat: "wide",
  };
  const done = [];
  for (const a of actors) {
    const near = done.filter((b) => Math.hypot(a.x - b.x, a.z - b.z) < 16);
    const p = a.profile;
    if (near.some((b) => b.poseType === a.poseType)) {
      const used = new Set(near.map((b) => b.poseType));
      const free = poses.filter((pose) => !used.has(pose));
      if (free.length) a.poseType = pick(free, rng);
    }
    const clothClash = (color) =>
      near.some(
        (b) => colorDist2(b.profile.torsoColor, color) < 0.03 && colorDist2(b.profile.skirtColor, p.skirtColor) < 0.03,
      );
    if (clothClash(p.torsoColor)) {
      const sleeveFollows = p.sleeveColor === p.torsoColor;
      const dressFollows = (p.skirtKind === "full" || p.skirtKind === "mid" || p.skirtKind === "bustle") && p.skirtColor === p.torsoColor;
      let next = shiftHex(p.torsoColor, 0.18, rng);
      for (let k = 0; k < 12 && (clothClash(next) || isSkinLike(next, p.skin)); k++) {
        next = shiftHex(next, 0.14, rng);
      }
      p.torsoColor = next;
      if (sleeveFollows) p.sleeveColor = next;
      if (dressFollows) p.skirtColor = next;
      else if (p.skirtKind === "short") {
        const skirtClash = near.some((b) => colorDist2(b.profile.skirtColor, p.skirtColor) < 0.03);
        if (skirtClash) p.skirtColor = shiftHex(p.skirtColor, 0.18, rng);
      }
    }
    const hatClash = near.find(
      (b) => b.profile.hatStyle === p.hatStyle && colorDist2(b.profile.hatColor, p.hatColor) < 0.025,
    );
    if (hatClash) {
      const alt = hatSwap[p.hatStyle];
      if (alt && !near.some((b) => b.profile.hatStyle === alt)) {
        p.hatStyle = alt;
      } else {
        p.hatColor = shiftHex(p.hatColor, 0.2, rng);
      }
    }
    done.push(a);
  }
}


function dressProfile(era, role, rng) {
  // role: "man" | "woman" | "farmer" | "boy" | "girl"
  const skin = pick(SKIN_TONES, rng);
  const hair = pick(HAIR_TONES, rng);
  const eyeColor = pick(EYE_TONES, rng);
  const lipColor = lipToneFor(skin);
  const buildW = 0.90 + rng() * 0.22; // slender -> stocky build variation

  if (role === "farmer") {
    const shirt = pick(["#b7c2cb", "#d6ceb8", "#97a693", "#c4b296", "#7a8fa0"], rng);
    const denim = pick(["#384c68", "#415776", "#4e565f", "#5a4f43"], rng);
    const hatColor = era === "pioneer" ? "#6c563f" : era === "jazz" ? "#cbb47d" : "#6b645a";
    const hatStyle = era === "pioneer" ? "wide" : era === "midcentury" ? "cap" : rng() < 0.6 ? "wide" : "cap";
    return {
      role,
      skin,
      hair,
      eyeColor,
      lipColor,
      hScale: 0.95 + rng() * 0.09,
      buildW,
      torsoKind: "shirt",
      torsoColor: shirt,
      sleeveColor: shirt,
      shortSleeve: false,
      legColor: denim,
      skirtKind: "none",
      skirtColor: denim,
      coatTailLen: 0,
      hasLapels: false,
      shirtColor: shirt,
      tieColor: null,
      vestColor: null,
      overallsColor: denim,
      shawlColor: null,
      puffSleeve: false,
      beard: era !== "midcentury" && rng() < 0.42,
      hairStyle: "short",
      hatStyle,
      hatColor,
      bandColor: "#332c26",
      showHair: true,
    };
  }

  if (role === "boy" || role === "girl") {
    const hScale = 0.64 + rng() * 0.16;
    if (role === "boy") {
      const shirt = pick(["#d8d2c4", "#7d93a8", "#6a7b5c", "#8b5a4a", "#4f6270"], rng);
      const pants = pick(["#453f38", "#3a4554", "#594c3d", "#505459"], rng);
      const hatStyle = era === "pioneer" ? "wide" : era === "midcentury" ? "none" : rng() < 0.55 ? "cap" : "none";
      return {
        role,
        skin,
        hair,
        eyeColor,
        lipColor,
        hScale,
        buildW: 0.88 + rng() * 0.14,
        torsoKind: "shirt",
        torsoColor: shirt,
        sleeveColor: shirt,
        shortSleeve: era === "midcentury" && rng() < 0.55,
        legColor: pants,
        skirtKind: "none",
        skirtColor: pants,
        coatTailLen: 0,
        hasLapels: false,
        shirtColor: shirt,
        tieColor: null,
        vestColor: null,
        overallsColor: null,
        shawlColor: null,
        puffSleeve: false,
        beard: false,
        hairStyle: "short",
        hatStyle,
        hatColor: pick(["#584c40", "#6e655a", "#3d4248"], rng),
        bandColor: "#2e2a26",
        showHair: true,
      };
    }
    const dress = pick(
      era === "midcentury"
        ? ["#c87878", "#7498b8", "#d8c474", "#82aa82", "#b88aa8"]
        : ["#b88d82", "#7c94a6", "#c6b692", "#8e9d86", "#a88392"],
      rng,
    );
    const hatStyle = era === "pioneer" ? (rng() < 0.65 ? "bonnet" : "none") : "none";
    return {
      role,
      skin,
      hair,
      eyeColor,
      lipColor,
      hScale,
      buildW: 0.86 + rng() * 0.14,
      torsoKind: "woman",
      torsoColor: dress,
      sleeveColor: dress,
      shortSleeve: era === "midcentury" && rng() < 0.65,
      legColor: "#d6cab6",
      skirtKind: "short",
      skirtColor: dress,
      coatTailLen: 0,
      hasLapels: false,
      shirtColor: null,
      tieColor: null,
      vestColor: "#e0dacb",
      overallsColor: null,
      shawlColor: null,
      puffSleeve: false,
      beard: false,
      hairStyle: "bob",
      hatStyle,
      hatColor: pick(["#d4c8b4", "#a88a74", "#8896a2"], rng),
      bandColor: "#785a4e",
      showHair: hatStyle === "none",
    };
  }

  if (role === "man") {
    const hScale = 0.94 + rng() * 0.11;
    const whiteShirt = pick(["#e7e3d8", "#dde2e6", "#eae4d6"], rng);
    const tie = pick(["#5e2c2a", "#2b384c", "#3a4a3a", "#443a32", "#262528"], rng);

    if (era === "pioneer") {
      const coat = pick(["#2a2826", "#39312a", "#2e343c", "#473c32"], rng);
      const pants = pick(["#49443e", "#5b5247", "#36383d", "#62594d"], rng);
      const vest = pick(["#6c5342", "#7b6c52", "#4e5b52", "#72433f"], rng);
      const hatStyle = rng() < 0.22 ? "tophat" : "wide";
      return {
        role,
        skin,
        hair,
        eyeColor,
        lipColor,
        hScale,
        buildW,
        torsoKind: "man",
        torsoColor: coat,
        sleeveColor: coat,
        shortSleeve: false,
        legColor: pants,
        skirtKind: "none",
        skirtColor: coat,
        coatTailLen: 1.0, // knee-length frock coat tails
        hasLapels: true,
        shirtColor: whiteShirt,
        tieColor: tie,
        vestColor: vest,
        overallsColor: null,
        shawlColor: null,
        puffSleeve: false,
        beard: rng() < 0.58,
        hairStyle: "short",
        hatStyle,
        hatColor: pick(["#282421", "#463a2f", "#5e5042"], rng),
        bandColor: "#1f1c19",
        showHair: true,
      };
    }

    if (era === "victorian" || era === "edwardian") {
      const suit = pick(["#2e3036", "#3c3732", "#484541", "#343b45", "#52463c"], rng);
      const hatStyle = rng() < 0.78 ? "bowler" : "boater";
      return {
        role,
        skin,
        hair,
        eyeColor,
        lipColor,
        hScale,
        buildW,
        torsoKind: "man",
        torsoColor: suit,
        sleeveColor: suit,
        shortSleeve: false,
        legColor: suit,
        skirtKind: "none",
        skirtColor: suit,
        coatTailLen: 0.62, // sack suit jacket hem
        hasLapels: true,
        shirtColor: whiteShirt,
        tieColor: tie,
        vestColor: pick(["#544c44", "#665c50", "#444c54", "#645242"], rng),
        overallsColor: null,
        shawlColor: null,
        puffSleeve: false,
        beard: rng() < 0.36,
        hairStyle: "short",
        hatStyle,
        hatColor: hatStyle === "boater" ? "#dcc686" : pick(["#252527", "#3d352e"], rng),
        bandColor: hatStyle === "boater" ? "#263246" : "#1a1919",
        showHair: true,
      };
    }

    if (era === "jazz") {
      const suit = pick(["#454950", "#584f46", "#39404b", "#6c6357", "#3b3937"], rng);
      const hatStyle = rng() < 0.48 ? "boater" : "fedora";
      return {
        role,
        skin,
        hair,
        eyeColor,
        lipColor,
        hScale,
        buildW,
        torsoKind: "man",
        torsoColor: suit,
        sleeveColor: suit,
        shortSleeve: false,
        legColor: suit,
        skirtKind: "none",
        skirtColor: suit,
        coatTailLen: 0.58,
        hasLapels: true,
        shirtColor: whiteShirt,
        tieColor: tie,
        vestColor: pick(["#5b534b", "#6c6255", "#4b535b"], rng),
        overallsColor: null,
        shawlColor: null,
        puffSleeve: false,
        beard: rng() < 0.14,
        hairStyle: "short",
        hatStyle,
        hatColor: hatStyle === "boater" ? "#dec886" : pick(["#59534c", "#47413b", "#6d6861"], rng),
        bandColor: hatStyle === "boater" ? "#28344a" : "#2f2a26",
        showHair: true,
      };
    }

    if (era === "depression") {
      const coat = pick(["#4f4c48", "#5b5146", "#3e464f", "#686259", "#4a443e"], rng);
      const slacks = pick(["#44423f", "#534e47", "#394048"], rng);
      return {
        role,
        skin,
        hair,
        eyeColor,
        lipColor,
        hScale,
        buildW,
        torsoKind: "man",
        torsoColor: coat,
        sleeveColor: coat,
        shortSleeve: false,
        legColor: slacks,
        skirtKind: "none",
        skirtColor: slacks,
        coatTailLen: 0.55,
        hasLapels: true,
        shirtColor: whiteShirt,
        tieColor: tie,
        vestColor: null,
        overallsColor: null,
        shawlColor: null,
        puffSleeve: false,
        beard: false,
        hairStyle: "short",
        hatStyle: rng() < 0.85 ? "fedora" : "none",
        hatColor: pick(["#5b544b", "#45413c", "#746b5f"], rng),
        bandColor: "#2d2824",
        showHair: true,
      };
    }

    // midcentury 1950-1970+
    const shirt = pick(["#eae5da", "#6e8aa4", "#c46a5a", "#7a8b68", "#d6c278", "#5d6d7c", "#c4b896"], rng);
    const slacks = pick(["#42474e", "#5b5346", "#353a41", "#6c655a"], rng);
    const hatStyle = rng() < 0.22 ? "fedora" : rng() < 0.36 ? "cap" : "none";
    return {
      role,
      skin,
      hair,
      eyeColor,
      lipColor,
      hScale,
      buildW,
      torsoKind: "shirt",
      torsoColor: shirt,
      sleeveColor: shirt,
      shortSleeve: rng() < 0.45,
      legColor: slacks,
      skirtKind: "none",
      skirtColor: slacks,
      coatTailLen: 0,
      hasLapels: false,
      shirtColor: null,
      tieColor: null,
      vestColor: null,
      overallsColor: null,
      shawlColor: null,
      puffSleeve: false,
      beard: false,
      hairStyle: "short",
      hatStyle,
      hatColor: pick(["#5b564e", "#484e58", "#6d665b"], rng),
      bandColor: "#2d2926",
      showHair: true,
    };
  }

  // role === "woman"
  const hScale = 0.89 + rng() * 0.08;
  const wBuild = 0.88 + rng() * 0.18;

  if (era === "pioneer") {
    const dress = pick(["#5c4a57", "#465865", "#6b5a47", "#4d5b49", "#764b4a", "#5b564f"], rng);
    const shawl = pick(["#864542", "#596555", "#7a6850", "#3b3836", "#8d7e68"], rng);
    return {
      role,
      skin,
      hair,
      eyeColor,
      lipColor,
      hScale,
      buildW: wBuild,
      torsoKind: "woman",
      torsoColor: dress,
      sleeveColor: dress,
      shortSleeve: false,
      legColor: "#2a2522",
      skirtKind: "full",
      skirtColor: dress,
      coatTailLen: 0,
      hasLapels: false,
      shirtColor: "#e6dfd1",
      tieColor: null,
      vestColor: null,
      overallsColor: null,
      shawlColor: shawl,
      puffSleeve: false,
      beard: false,
      hairStyle: "bun",
      hatStyle: "bonnet",
      hatColor: pick(["#b8a990", "#685848", "#494d54", "#846858"], rng),
      bandColor: shawl,
      showHair: true,
    };
  }

  if (era === "victorian") {
    const gown = pick(["#484050", "#3a4d57", "#624448", "#4b5442", "#594b3e"], rng);
    const hatStyle = rng() < 0.58 ? "bonnet" : "edwardian";
    return {
      role,
      skin,
      hair,
      eyeColor,
      lipColor,
      hScale,
      buildW: wBuild,
      torsoKind: "woman",
      torsoColor: gown,
      sleeveColor: gown,
      shortSleeve: false,
      legColor: "#282422",
      skirtKind: "bustle",
      skirtColor: gown,
      coatTailLen: 0,
      hasLapels: false,
      shirtColor: "#dfd8ca",
      tieColor: null,
      vestColor: null,
      overallsColor: null,
      shawlColor: pick(["#7e6f5c", "#3a3533", "#6a4b47", "#585147"], rng),
      puffSleeve: true,
      beard: false,
      hairStyle: "bun",
      hatStyle,
      hatColor: pick(["#3f3834", "#5c4d44", "#7e7262"], rng),
      bandColor: "#332a28",
      showHair: true,
    };
  }

  if (era === "edwardian") {
    const blouse = pick(["#ded8ca", "#d2d9de", "#daccc4", "#d6dacb"], rng);
    const skirt = pick(["#30343a", "#453b35", "#38423a", "#4c393c"], rng);
    return {
      role,
      skin,
      hair,
      eyeColor,
      lipColor,
      hScale,
      buildW: wBuild,
      torsoKind: "woman",
      torsoColor: blouse,
      sleeveColor: blouse,
      shortSleeve: false,
      legColor: "#262322",
      skirtKind: "full",
      skirtColor: skirt,
      coatTailLen: 0,
      hasLapels: false,
      shirtColor: null,
      tieColor: null,
      vestColor: skirt,
      overallsColor: null,
      shawlColor: null,
      puffSleeve: false,
      beard: false,
      hairStyle: "bun",
      hatStyle: "edwardian",
      hatColor: pick(["#4d443d", "#6d5f50", "#c9bfa6"], rng),
      bandColor: skirt,
      showHair: true,
    };
  }

  if (era === "jazz") {
    const dress = pick(["#647482", "#8e6a6a", "#a39072", "#5e6e5c", "#4b4b54", "#9e8b92"], rng);
    return {
      role,
      skin,
      hair,
      eyeColor,
      lipColor,
      hScale,
      buildW: wBuild,
      torsoKind: "woman",
      torsoColor: dress,
      sleeveColor: dress,
      shortSleeve: false,
      legColor: "#cbb39a",
      skirtKind: "mid",
      skirtColor: dress,
      coatTailLen: 0,
      hasLapels: false,
      shirtColor: "#e2dcd0",
      tieColor: null,
      vestColor: pick(["#dfd8c8", "#353330", "#7c5850"], rng),
      overallsColor: null,
      shawlColor: null,
      puffSleeve: false,
      beard: false,
      hairStyle: "bob",
      hatStyle: "cloche",
      hatColor: pick(["#7e695c", "#4c5660", "#b8a890", "#6e4e52"], rng),
      bandColor: "#383230",
      showHair: true,
    };
  }

  if (era === "depression") {
    const dress = pick(["#7b94a6", "#b27a7c", "#8d9e7a", "#b6a06a", "#937c98", "#6c8480"], rng);
    const trim = pick(["#e0dacc", "#dcd0b5", "#c4746e", "#4b5b69"], rng);
    return {
      role,
      skin,
      hair,
      eyeColor,
      lipColor,
      hScale,
      buildW: wBuild,
      torsoKind: "woman",
      torsoColor: dress,
      sleeveColor: dress,
      shortSleeve: rng() < 0.35,
      legColor: "#cfa88c",
      skirtKind: "mid",
      skirtColor: dress,
      coatTailLen: 0,
      hasLapels: false,
      shirtColor: trim,
      tieColor: null,
      vestColor: trim,
      overallsColor: null,
      shawlColor: null,
      puffSleeve: false,
      beard: false,
      hairStyle: "bob",
      hatStyle: rng() < 0.38 ? "cloche" : "none",
      hatColor: pick(["#5c544d", "#48525c", "#a4927c"], rng),
      bandColor: "#3c3532",
      showHair: true,
    };
  }

  // midcentury 1950-1970+
  const blouse = pick(["#eae5da", "#6e8aa4", "#c46a5a", "#7a8b68", "#d8c47a", "#c4b896"], rng);
  const skirt = pick(["#49525c", "#6c5a4d", "#4c5c4e", "#6b474d", "#3d424a"], rng);
  return {
    role,
    skin,
    hair,
    eyeColor,
    lipColor,
    hScale,
    buildW: wBuild,
    torsoKind: "woman",
    torsoColor: blouse,
    sleeveColor: blouse,
    shortSleeve: rng() < 0.55,
    legColor: "#d4ae92",
    skirtKind: "short",
    skirtColor: skirt,
    coatTailLen: 0,
    hasLapels: false,
    shirtColor: null,
    tieColor: null,
    vestColor: skirt,
    overallsColor: null,
    shawlColor: null,
    puffSleeve: false,
    beard: false,
    hairStyle: "bob",
    hatStyle: "none",
    hatColor: "#5c544c",
    bandColor: "#3c3532",
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
      if (b.id === "tpw-depot" && x >= b.x - b.width / 2 - 8 && x <= b.x + b.width / 2 + 8 && Math.abs(z - (b.z - 19.2)) <= 6.2) return 0.36;
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
        const sz = b.z - 18.0;
        if (isClear(sx, sz, true)) depotSpots.push({ x: sx, z: sz, yaw: Math.PI - 0.1, minX: b.x - 36, maxX: b.x + 36 });
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
    actors.push({
      ...spec,
      profile,
      phase: rng() * Math.PI * 2,
      weightSide: rng() < 0.5 ? -1 : 1,
      poseType: pick(["casual", "hip", "folded", "chatting"], rng),
      lookBias: (rng() - 0.5) * 0.56,
      headTilt: (rng() - 0.5) * 0.10,
      armBiasL: 0.22 + rng() * 0.32,
      armBiasR: 0.22 + rng() * 0.32,
    });
  };

  // Group nearby storefront spots so 2-3 people stand talking together.
  const storeGroups = [];
  const claimed = new Set();
  const storeOrder = storeSpots.slice().sort((a, b) => {
    const aMain = a.z >= 160 && a.z <= 220 ? 0 : 1;
    const bMain = b.z >= 160 && b.z <= 220 ? 0 : 1;
    const aCore = Math.abs(a.x + 80);
    const bCore = Math.abs(b.x + 80);
    return aMain - bMain || aCore - bCore;
  });
  for (let i = 0; i < storeOrder.length; i++) {
    if (claimed.has(i)) continue;
    const g = [storeOrder[i]];
    claimed.add(i);
    for (let j = i + 1; j < storeOrder.length; j++) {
      if (claimed.has(j)) continue;
      if (Math.hypot(storeOrder[j].x - storeOrder[i].x, storeOrder[j].z - storeOrder[i].z) < 16) {
        g.push(storeOrder[j]);
        claimed.add(j);
      }
    }
    storeGroups.push(g);
  }
  const isMainGroup = (g) => g.some((p) => p.z >= 160 && p.z <= 220);
  const mainFirst = storeGroups.filter(isMainGroup);
  const otherGroups = storeGroups.filter((g) => !isMainGroup(g));
  const anchors = [-320, -180, -40, 120, 300];
  const spread = [];
  const remaining = mainFirst.slice();
  for (const ax of anchors) {
    remaining.sort((a, b) => {
      const ca = a.reduce((s, p) => s + p.x, 0) / a.length;
      const cb = b.reduce((s, p) => s + p.x, 0) / b.length;
      return Math.abs(ca - ax) - Math.abs(cb - ax);
    });
    if (remaining.length) spread.push(remaining.shift());
  }
  storeGroups.length = 0;
  storeGroups.push(...spread, ...remaining, ...otherGroups);

  const fillCluster = (spots, n) => {
    const cluster = spots.slice(0, 3);
    if (cluster.length && cluster.length < n) {
      const c = cluster[0];
      // Keep the conversation partner cleanly on the walk/yard without straddling boardwalk curbs.
      const towardStreet = c.z > 156 ? -2.2 : 2.2;
      const tx = c.x + (cluster.length === 2 ? (c.x > cluster[0].x ? -2.4 : 2.4) : 1.6);
      const tz = c.z + towardStreet;
      if (isClear(tx, tz)) cluster.push({ x: tx, z: tz, yaw: c.yaw + Math.PI });
    }
    const take = Math.min(n, cluster.length);
    const cx = cluster.slice(0, take).reduce((s, p) => s + p.x, 0) / take;
    const cz = cluster.slice(0, take).reduce((s, p) => s + p.z, 0) / take;
    for (let k = 0; k < take; k++) {
      const sp = cluster[k];
      const yaw = Math.hypot(cx - sp.x, cz - sp.z) > 0.4 ? Math.atan2(cx - sp.x, cz - sp.z) : sp.yaw;
      addActor({ kind: "idle", x: sp.x, z: sp.z, y: groundYAt(sp.x, sp.z), yaw });
    }
  };

  if (year <= 1860) {
    const nGroups = year <= 1854 ? 1 : 2;
    const per = year <= 1854 ? 2 : 3;
    for (let g = 0; g < Math.min(nGroups, storeGroups.length); g++) {
      fillCluster(storeGroups[g], per);
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

    let storeAdded = 0;
    for (let g = 0; g < storeGroups.length && storeAdded < nStore; g++) {
      const before = actors.length;
      fillCluster(storeGroups[g], Math.min(3, nStore - storeAdded));
      storeAdded += actors.length - before;
    }

    for (let i = 0; i < nDepot && depotSpots.length; i++) {
      const sp = depotSpots[i % depotSpots.length];
      const jx = sp.x + (i >= depotSpots.length ? (rng() - 0.5) * 6 : 0);
      if (isClear(jx, sp.z, true) && !actors.some((a) => Math.hypot(a.x - jx, a.z - sp.z) < 3.4)) {
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

  const varietyRng = makeRng(year * 977 + 131 + 17);
  for (const a of actors) ensureClothed(a.profile);
  ensureNeighborVariety(actors, varietyRng);

  const count = actors.length;
  if (!count) return null;

  // Two clean PBR materials (no photo textures): matte skin/fabric + slightly satin shoes/eyes.
  const matCloth = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.02,
  });
  const matSkin = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.68,
    metalness: 0.02,
  });
  const matTrim = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.05,
  });

  const parts = [];
  // farOk: part is drawn at the far LOD (beyond ~60 ft). Facial/trim details stay close-only.
  const makePart = (geoHi, geoLo = null, mat = matCloth, shadow = true, farOk = true) => {
    const used = new Int8Array(count);
    const colorOf = new Array(count);
    const part = { geoHi, geoLo, mat, shadow, farOk, used, colorOf, meshHi: null, meshLo: null, hiN: 0, loN: 0 };
    parts.push(part);
    return part;
  };
  const bind = (part, i, color) => {
    part.used[i] = 1;
    part.colorOf[i] = new THREE.Color(color);
  };

  // Head & Face
  const heads = makePart(makeHeadGeo("hi"), makeHeadGeo("lo"), matSkin);
  const eyeWhites = makePart(makeEyeWhitesGeo(), null, matTrim, false, false);
  const irises = makePart(makeIrisesGeo(), null, matTrim, false, false);
  const brows = makePart(makeBrowsGeo(), null, matCloth, false, false);
  const mouths = makePart(makeMouthGeo(), null, matCloth, false, false);
  const beards = makePart(makeBeardGeo("hi"), makeBeardGeo("lo"), matCloth, false);
  const necks = makePart(makeNeckGeo("hi"), makeNeckGeo("lo"), matSkin);
  const hairBases = makePart(makeHairBaseGeo("hi"), makeHairBaseGeo("lo"));
  const hairBuns = makePart(makeHairBunGeo("hi"), makeHairBunGeo("lo"), matCloth, false);
  const hairBobs = makePart(makeHairSideBobGeo("hi"), makeHairSideBobGeo("lo"), matCloth, false);

  // Torsos & Tailoring
  const torsosMen = makePart(makeTorsoMenGeo("hi"), makeTorsoMenGeo("lo"));
  const torsosShirt = makePart(makeTorsoShirtGeo("hi"), makeTorsoShirtGeo("lo"));
  const torsosWomen = makePart(makeTorsoWomenGeo("hi"), makeTorsoWomenGeo("lo"));
  const pelvises = makePart(makePelvisGeo("hi"), makePelvisGeo("lo"));
  const coatTails = makePart(makeCoatTailGeo("hi"), makeCoatTailGeo("lo"));
  const shirtFronts = makePart(makeShirtFrontGeo(), null, matCloth, false, false);
  const womanCollars = makePart(makeWomanCollarGeo(), null, matCloth, false, false);
  const lapels = makePart(makeLapelsGeo(), null, matCloth, false, false);
  const ties = makePart(makeTieGeo(), null, matCloth, false, false);
  const vests = makePart(makeVestGeo("hi"), makeVestGeo("lo"), matCloth, false);
  const overallsBibs = makePart(makeOverallsBibGeo("hi"), makeOverallsBibGeo("lo"), matCloth, false);
  const shawls = makePart(makeShawlGeo("hi"), makeShawlGeo("lo"));

  // Skirts
  const skirtsFull = makePart(makeSkirtFullGeo("hi"), makeSkirtFullGeo("lo"));
  const skirtsBustle = makePart(makeSkirtBustleGeo("hi"), makeSkirtBustleGeo("lo"));
  const skirtsMid = makePart(makeSkirtMidGeo("hi"), makeSkirtMidGeo("lo"));
  const skirtsShort = makePart(makeSkirtShortGeo("hi"), makeSkirtShortGeo("lo"));

  // Articulated 2-segment Limbs, Hands & Shoes
  const thighHi = makeThighGeo("hi");
  const thighLo = makeThighGeo("lo");
  const calfHi = makeCalfGeo("hi");
  const calfLo = makeCalfGeo("lo");
  const shoeHi = makeShoeGeo("hi");
  const shoeLo = makeShoeGeo("lo");
  const uArmHi = makeUpperArmGeo("hi");
  const uArmLo = makeUpperArmGeo("lo");
  const fArmHi = makeForearmGeo("hi");
  const fArmLo = makeForearmGeo("lo");
  const handHi = makeHandGeo("hi");
  const handLo = makeHandGeo("lo");
  const puffHi = makePuffSleeveGeo("hi");
  const puffLo = makePuffSleeveGeo("lo");

  const thighsL = makePart(thighHi, thighLo);
  const thighsR = makePart(thighHi, thighLo);
  const calvesL = makePart(calfHi, calfLo);
  const calvesR = makePart(calfHi, calfLo);
  const shoesL = makePart(shoeHi, shoeLo, matTrim);
  const shoesR = makePart(shoeHi, shoeLo, matTrim);
  const uArmsL = makePart(uArmHi, uArmLo);
  const uArmsR = makePart(uArmHi, uArmLo);
  const fArmsL = makePart(fArmHi, fArmLo);
  const fArmsR = makePart(fArmHi, fArmLo);
  const handsL = makePart(handHi, handLo, matSkin, false);
  const handsR = makePart(handHi, handLo, matSkin, false);
  const puffsL = makePart(puffHi, puffLo);
  const puffsR = makePart(puffHi, puffLo);

  // Hats
  const hatCrowns = makePart(makeHatCrownCylGeo("hi"), makeHatCrownCylGeo("lo"));
  const hatFedoras = makePart(makeFedoraCrownGeo("hi"), makeFedoraCrownGeo("lo"));
  const hatDomes = makePart(makeHatDomeGeo("hi"), makeHatDomeGeo("lo"));
  const hatBrimsCurved = makePart(makeHatBrimCurvedGeo("hi"), makeHatBrimCurvedGeo("lo"));
  const hatBrimsFlat = makePart(makeHatBrimFlatGeo("hi"), makeHatBrimFlatGeo("lo"));
  const hatBands = makePart(makeHatBandGeo(), null, matCloth, false, false);
  const hatBonnets = makePart(makeBonnetGeo("hi"), makeBonnetGeo("lo"));

  const c = new THREE.Color();
  actors.forEach((a, i) => {
    const p = a.profile;
    const shoeCol = p.role === "farmer" ? "#3b2e23" : "#1b1512";
    const forearmCol = p.shortSleeve ? p.skin : p.sleeveColor;
    const calfCol = p.skirtKind === "mid" || p.skirtKind === "short" ? p.skin : p.legColor;
    const lapelCol = c.set(p.torsoColor).multiplyScalar(0.92).getStyle();
    const hasSkirt = p.skirtKind !== "none";
    const longSkirt = p.skirtKind === "full" || p.skirtKind === "bustle";
    const tucked = p.hatStyle === "bonnet" || p.hatStyle === "cloche";

    bind(heads, i, p.skin);
    bind(eyeWhites, i, "#f4f1ea");
    bind(irises, i, p.eyeColor);
    bind(brows, i, p.hair);
    bind(mouths, i, p.lipColor);
    if (p.beard) bind(beards, i, p.hair);
    bind(necks, i, p.skin);
    if (p.showHair) {
      bind(hairBases, i, p.hair);
      if (p.hairStyle === "bun" && !tucked) bind(hairBuns, i, p.hair);
      else if (p.hairStyle === "bob" && !tucked) bind(hairBobs, i, p.hair);
    }

    if (p.torsoKind === "man") bind(torsosMen, i, p.torsoColor);
    else if (p.torsoKind === "shirt") bind(torsosShirt, i, p.torsoColor);
    else bind(torsosWomen, i, p.torsoColor);

    if (!hasSkirt) bind(pelvises, i, p.legColor);
    if (p.coatTailLen > 0) bind(coatTails, i, p.torsoColor);
    if (p.hasLapels) {
      bind(lapels, i, lapelCol);
      bind(shirtFronts, i, p.shirtColor || "#e7e3d8");
    } else if (p.shirtColor && (p.role === "woman" || p.role === "girl")) {
      bind(womanCollars, i, p.shirtColor);
    }
    if (p.tieColor) bind(ties, i, p.tieColor);
    if (p.vestColor) bind(vests, i, p.vestColor);
    if (p.overallsColor) bind(overallsBibs, i, p.overallsColor);
    if (p.shawlColor) bind(shawls, i, p.shawlColor);

    if (p.skirtKind === "full") bind(skirtsFull, i, p.skirtColor);
    else if (p.skirtKind === "bustle") bind(skirtsBustle, i, p.skirtColor);
    else if (p.skirtKind === "mid") bind(skirtsMid, i, p.skirtColor);
    else if (p.skirtKind === "short") bind(skirtsShort, i, p.skirtColor);

    if (!hasSkirt) {
      bind(thighsL, i, p.legColor);
      bind(thighsR, i, p.legColor);
    }
    if (!longSkirt) {
      bind(calvesL, i, calfCol);
      bind(calvesR, i, calfCol);
    }
    bind(shoesL, i, shoeCol);
    bind(shoesR, i, shoeCol);

    bind(uArmsL, i, p.sleeveColor);
    bind(uArmsR, i, p.sleeveColor);
    bind(fArmsL, i, forearmCol);
    bind(fArmsR, i, forearmCol);
    bind(handsL, i, p.skin);
    bind(handsR, i, p.skin);
    if (p.puffSleeve) {
      bind(puffsL, i, p.sleeveColor);
      bind(puffsR, i, p.sleeveColor);
    }

    const hsMode = p.hatStyle;
    if (hsMode === "wide" || hsMode === "fedora") {
      bind(hatFedoras, i, p.hatColor);
      bind(hatBrimsCurved, i, p.hatColor);
      bind(hatBands, i, p.bandColor);
    } else if (hsMode === "tophat") {
      bind(hatCrowns, i, p.hatColor);
      bind(hatBrimsCurved, i, p.hatColor);
      bind(hatBands, i, p.bandColor);
    } else if (hsMode === "bonnet") {
      bind(hatBonnets, i, p.hatColor);
      bind(hatBands, i, p.bandColor);
    } else if (hsMode === "bowler" || hsMode === "cloche") {
      bind(hatDomes, i, p.hatColor);
      bind(hatBrimsCurved, i, p.hatColor);
      bind(hatBands, i, p.bandColor);
    } else if (hsMode === "boater" || hsMode === "edwardian") {
      bind(hatCrowns, i, p.hatColor);
      bind(hatBrimsFlat, i, p.hatColor);
      bind(hatBands, i, p.bandColor);
    } else if (hsMode === "cap") {
      bind(hatDomes, i, p.hatColor);
      bind(hatBrimsFlat, i, p.hatColor);
    }
  });

  const allMeshes = [];
  const mkInst = (geo, part, n) => {
    const m = new THREE.InstancedMesh(geo, part.mat, n);
    m.castShadow = part.shadow;
    m.receiveShadow = part.shadow;
    m.frustumCulled = false;
    m.count = 0;
    allMeshes.push(m);
    return m;
  };
  for (const part of parts) {
    let n = 0;
    for (let i = 0; i < count; i++) if (part.used[i]) n++;
    if (!n) continue;
    part.meshHi = mkInst(part.geoHi, part, n);
    if (part.geoLo && part.farOk) part.meshLo = mkInst(part.geoLo, part, n);
  }

  const group = new THREE.Group();
  group.name = "pedestrians";
  group.add(...allMeshes);
  scene.add(group);

  // Reusable scratch transforms
  const rootMat = new THREE.Matrix4();
  const partMat = new THREE.Matrix4();
  const headMat = new THREE.Matrix4();
  const tParent = new THREE.Matrix4();
  const hipMat = new THREE.Matrix4();
  const kneeMat = new THREE.Matrix4();
  const ankleMat = new THREE.Matrix4();
  const shoulderMat = new THREE.Matrix4();
  const elbowMat = new THREE.Matrix4();
  const wristMat = new THREE.Matrix4();
  const finalMat = new THREE.Matrix4();

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();
  const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);

  const lodFar = new Int8Array(count);

  const setMat = (part, i, mat) => {
    if (!part.used[i]) return;
    const far = lodFar[i] && part.meshLo;
    if (lodFar[i] && !part.farOk) return;
    const mesh = far ? part.meshLo : part.meshHi;
    if (!mesh) return;
    const slot = far ? part.loN++ : part.hiN++;
    mesh.setMatrixAt(slot, mat);
    mesh.setColorAt(slot, part.colorOf[i]);
  };

  const setLocal = (part, i, parentMat, lx, ly, lz, rx, ry, rz, sx, sy, sz) => {
    if (!part.used[i]) return;
    pos.set(lx, ly, lz);
    euler.set(rx, ry, rz, "YXZ");
    quat.setFromEuler(euler);
    scl.set(sx, sy, sz);
    partMat.compose(pos, quat, scl);
    finalMat.multiplyMatrices(parentMat, partMat);
    setMat(part, i, finalMat);
  };

  const computeLegChain = (hipX, hipY, hipRx, hipRz, kneeRx, ankleRx, buildS, soleOut, out) => {
    pos.set(hipX, hipY, 0);
    euler.set(hipRx, 0, hipRz, "YXZ");
    quat.setFromEuler(euler);
    scl.set(buildS, 1, buildS);
    hipMat.compose(pos, quat, scl);

    pos.set(0, -1.36, 0);
    euler.set(kneeRx, 0, 0, "YXZ");
    quat.setFromEuler(euler);
    scl.set(1, 1, 1);
    partMat.compose(pos, quat, scl);
    kneeMat.multiplyMatrices(hipMat, partMat);

    pos.set(0, -1.34, 0);
    euler.set(ankleRx, 0, 0, "YXZ");
    quat.setFromEuler(euler);
    scl.set(1, 1, 1);
    partMat.compose(pos, quat, scl);
    ankleMat.multiplyMatrices(kneeMat, partMat);

    // Lowest point of shoe sole in actor local Y (sole sits at local y = -0.22 in ankle space)
    const e = ankleMat.elements;
    const soleY = e[13] - 0.22 * e[5];
    soleOut.y = soleY;
    out.hip.copy(hipMat);
    out.knee.copy(kneeMat);
    out.ankle.copy(ankleMat);
  };

  const setArmChain = (i, side, sx, sy, uRx, uRy, uRz, elbowRx, buildS, uPart, fPart, hPart, puffPart, showPuff) => {
    pos.set(sx, sy, 0);
    euler.set(uRx, uRy, uRz, "YXZ");
    quat.setFromEuler(euler);
    scl.set(buildS, 1, buildS);
    shoulderMat.compose(pos, quat, scl);

    finalMat.multiplyMatrices(rootMat, shoulderMat);
    setMat(uPart, i, finalMat);

    if (showPuff) {
      pos.set(0, 0, 0);
      euler.set(0, 0, 0, "YXZ");
      quat.setFromEuler(euler);
      scl.set(1.08, 1.08, 1.08);
      partMat.compose(pos, quat, scl);
      finalMat.multiplyMatrices(rootMat, shoulderMat).multiply(partMat);
      setMat(puffPart, i, finalMat);
    }

    pos.set(0, -0.98, 0);
    euler.set(elbowRx, 0, side * -0.05, "YXZ");
    quat.setFromEuler(euler);
    scl.set(1, 1, 1);
    partMat.compose(pos, quat, scl);
    elbowMat.multiplyMatrices(shoulderMat, partMat);

    finalMat.multiplyMatrices(rootMat, elbowMat);
    setMat(fPart, i, finalMat);

    pos.set(0, -0.86, 0);
    euler.set(-0.08, side * 0.14, side * -0.04, "YXZ");
    quat.setFromEuler(euler);
    scl.set(1, 1, 1);
    partMat.compose(pos, quat, scl);
    wristMat.multiplyMatrices(elbowMat, partMat);

    finalMat.multiplyMatrices(rootMat, wristMat);
    setMat(hPart, i, finalMat);
  };

  const soleL = { y: 0 };
  const soleR = { y: 0 };
  const chainL = { hip: new THREE.Matrix4(), knee: new THREE.Matrix4(), ankle: new THREE.Matrix4() };
  const chainR = { hip: new THREE.Matrix4(), knee: new THREE.Matrix4(), ankle: new THREE.Matrix4() };

  const applyPose = (elapsed, camera) => {
    for (const part of parts) {
      part.hiN = 0;
      part.loN = 0;
    }
    let camX = 0;
    let camZ = 0;
    let haveCam = false;
    if (camera && camera.position) {
      const plat = worldToPlat(camera.position.x, camera.position.z);
      camX = plat.x;
      camZ = plat.z;
      haveCam = true;
    }

    actors.forEach((a, i) => {
      const p = a.profile;
      const hs = p.hScale;
      const child = p.role === "boy" || p.role === "girl";
      const bw = p.buildW;
      const bz = 0.52 + 0.48 * bw;

      let px = a.x;
      let pz = a.z;
      let py = a.y;
      let yaw = a.yaw;

      let hipRxL = 0;
      let hipRxR = 0;
      let hipRzL = 0.025;
      let hipRzR = -0.025;
      let kneeRxL = 0.04;
      let kneeRxR = 0.04;
      let ankleRxL = -0.04;
      let ankleRxR = -0.04;

      let uArmRxL = 0.05;
      let uArmRxR = 0.05;
      let uArmRyL = 0.04;
      let uArmRyR = -0.04;
      let uArmRzL = 0;
      let uArmRzR = 0;
      let elbowRxL = -0.28;
      let elbowRxR = -0.28;
      let torsoYaw = 0;
      let torsoLean = 0.02;
      let headYaw = 0;
      let headPitch = 0;
      let headRoll = 0;

      const longSkirt = p.skirtKind === "full" || p.skirtKind === "bustle";
      const hasSkirt = p.skirtKind !== "none";

      if (a.kind === "walk") {
        const dist = Math.hypot(a.bx - a.ax, a.bz - a.az);
        const period = Math.max(4, (dist * 2) / a.speed);
        if (a.u0 == null) {
          const along = dist > 0.1 ? ((a.x - a.ax) * (a.bx - a.ax) + (a.z - a.az) * (a.bz - a.az)) / (dist * dist) : 0.5;
          a.u0 = Math.max(0.02, Math.min(0.48, along * 0.5));
        }
        const u = (elapsed / period + a.u0) % 1;
        const going = u < 0.5;
        const t = going ? u * 2 : (1 - u) * 2;
        px = a.ax + (a.bx - a.ax) * t;
        pz = a.az + (a.bz - a.az) * t;
        py = groundYAt(px, pz);
        yaw = Math.atan2(a.bx - a.ax, a.bz - a.az) + (going ? 0 : Math.PI);

        const stride = elapsed * a.speed * 1.85 + a.phase;
        const s = Math.sin(stride);
        const c = Math.cos(stride);
        const maxStride = longSkirt ? 0.14 : hasSkirt ? 0.22 : 0.38;

        hipRxL = -s * maxStride;
        hipRxR = s * maxStride;
        kneeRxL = Math.max(0.05, (longSkirt ? 0.16 : 0.40) * Math.max(0, c) + 0.10 * Math.max(0, s));
        kneeRxR = Math.max(0.05, (longSkirt ? 0.16 : 0.40) * Math.max(0, -c) + 0.10 * Math.max(0, -s));
        ankleRxL = -(hipRxL + kneeRxL) * 0.85;
        ankleRxR = -(hipRxR + kneeRxR) * 0.85;

        uArmRxL = s * 0.34;
        uArmRxR = -s * 0.34;
        elbowRxL = -0.28 - 0.22 * Math.max(0, -s);
        elbowRxR = -0.28 - 0.22 * Math.max(0, s);
        torsoYaw = -s * 0.09;
        torsoLean = 0.055;
        headYaw = a.lookBias * 0.45 + Math.sin(stride * 0.5) * 0.06;
        headRoll = a.headTilt * 0.5;
      } else {
        // Varied natural contrapposto idle poses (non-stiff even in static shots)
        const idle = elapsed * 1.05 + a.phase;
        const ws = a.weightSide;
        const legReach = longSkirt ? 0.03 : hasSkirt ? 0.07 : 0.17;
        const legSide = longSkirt ? 0.03 : hasSkirt ? 0.04 : 0.075;
        if (ws < 0) {
          hipRxL = 0.03;
          kneeRxL = 0.03;
          ankleRxL = -0.06;
          hipRzL = 0.02;
          hipRxR = -legReach;
          kneeRxR = legReach * 1.55;
          ankleRxR = -kneeRxR * 0.45;
          hipRzR = -legSide;
        } else {
          hipRxR = 0.03;
          kneeRxR = 0.03;
          ankleRxR = -0.06;
          hipRzR = -0.02;
          hipRxL = -legReach;
          kneeRxL = legReach * 1.55;
          ankleRxL = -kneeRxL * 0.45;
          hipRzL = legSide;
        }

        torsoYaw = ws * 0.10 + Math.sin(idle * 0.5) * 0.025;
        torsoLean = 0.035;
        headYaw = a.lookBias + Math.sin(idle) * 0.13;
        headPitch = 0.02 + Math.sin(idle * 0.7) * 0.035;
        headRoll = a.headTilt;

        if (a.poseType === "hip") {
          // One hand resting at hip/pocket, opposite arm relaxed
          if (ws < 0) {
            uArmRxR = 0.10;
            uArmRyR = 0.10;
            uArmRzR = 0.18;
            elbowRxR = -0.68;
            uArmRxL = -0.04 + Math.sin(idle * 0.8) * 0.03;
            elbowRxL = -a.armBiasL;
          } else {
            uArmRxL = 0.10;
            uArmRyL = -0.10;
            uArmRzL = -0.18;
            elbowRxL = -0.68;
            uArmRxR = -0.04 - Math.sin(idle * 0.8) * 0.03;
            elbowRxR = -a.armBiasR;
          }
        } else if (a.poseType === "folded") {
          // Relaxed forearms brought inward in front of waist
          uArmRxL = -0.14;
          uArmRxR = -0.12;
          uArmRyL = -0.34;
          uArmRyR = 0.34;
          elbowRxL = -0.78 - Math.sin(idle * 0.6) * 0.04;
          elbowRxR = -0.74 + Math.sin(idle * 0.6) * 0.04;
        } else if (a.poseType === "chatting") {
          // Conversational stance with one gesturing forearm
          torsoLean = 0.055;
          if (ws < 0) {
            uArmRxL = -0.22 + Math.sin(idle * 1.1) * 0.05;
            uArmRyL = -0.22;
            elbowRxL = -0.86 + Math.sin(idle * 1.3) * 0.08;
            uArmRxR = 0.06;
            elbowRxR = -0.34;
          } else {
            uArmRxR = -0.22 + Math.sin(idle * 1.1) * 0.05;
            uArmRyR = 0.22;
            elbowRxR = -0.86 + Math.sin(idle * 1.3) * 0.08;
            uArmRxL = 0.06;
            elbowRxL = -0.34;
          }
        } else {
          // Asymmetrical casual weight-shift stance
          uArmRxL = -0.04 + Math.sin(idle * 0.8) * 0.035;
          uArmRxR = 0.08 - Math.sin(idle * 0.8) * 0.035;
          elbowRxL = -a.armBiasL;
          elbowRxR = -(a.armBiasR + 0.18);
        }
      }

      if (haveCam) {
        const dist = Math.hypot(px - camX, pz - camZ);
        if (a._far) a._far = dist > 60;
        else a._far = dist > 72;
        lodFar[i] = a._far ? 1 : 0;
      } else {
        lodFar[i] = 0;
      }

      const hipX = child ? 0.19 : 0.225;
      const legScale = bw * (p.role === "woman" || child ? 0.88 : 0.96);
      computeLegChain(-hipX, 2.92, hipRxL, hipRzL, kneeRxL, ankleRxL, legScale, soleL, chainL);
      computeLegChain(hipX, 2.92, hipRxR, hipRzR, kneeRxR, ankleRxR, legScale, soleR, chainR);

      // Grounding correction: keep the lowest planted sole flush on py (zero float, zero sink).
      const groundLift = -Math.min(soleL.y, soleR.y);

      pos.set(px, py + groundLift * hs, pz);
      euler.set(0, yaw, 0, "YXZ");
      quat.setFromEuler(euler);
      scl.set(hs, hs, hs);
      rootMat.compose(pos, quat, scl);

      // Legs & Shoes
      if (!hasSkirt) {
        finalMat.multiplyMatrices(rootMat, chainL.hip);
        setMat(thighsL, i, finalMat);
        finalMat.multiplyMatrices(rootMat, chainR.hip);
        setMat(thighsR, i, finalMat);
      }
      if (!longSkirt) {
        finalMat.multiplyMatrices(rootMat, chainL.knee);
        setMat(calvesL, i, finalMat);
        finalMat.multiplyMatrices(rootMat, chainR.knee);
        setMat(calvesR, i, finalMat);
      }
      finalMat.multiplyMatrices(rootMat, chainL.ankle);
      setMat(shoesL, i, finalMat);
      finalMat.multiplyMatrices(rootMat, chainR.ankle);
      setMat(shoesR, i, finalMat);

      // Torso & Pelvis (with subtle natural yaw/lean)
      pos.set(0, 0, 0);
      euler.set(torsoLean, torsoYaw, 0, "YXZ");
      quat.setFromEuler(euler);
      scl.set(bw, 1, bz);
      partMat.compose(pos, quat, scl);
      tParent.multiplyMatrices(rootMat, partMat);

      if (p.torsoKind === "man") setMat(torsosMen, i, tParent);
      else if (p.torsoKind === "shirt") setMat(torsosShirt, i, tParent);
      else setMat(torsosWomen, i, tParent);

      if (!hasSkirt) setMat(pelvises, i, tParent);
      setLocal(necks, i, tParent, 0, 0, 0, 0, 0, 0, 1 / bw, 1, 1 / bz);

      // Tailoring layers
      if (p.coatTailLen > 0) {
        setLocal(coatTails, i, tParent, 0, 3.44 * (1 - p.coatTailLen), 0, 0, 0, 0, 1, p.coatTailLen, 1);
      }
      if (p.hasLapels) {
        setMat(lapels, i, tParent);
        setMat(shirtFronts, i, tParent);
      } else if (p.shirtColor && (p.role === "woman" || p.role === "girl")) {
        setMat(womanCollars, i, tParent);
      }
      if (p.tieColor) setMat(ties, i, tParent);
      if (p.vestColor) {
        if (p.role === "woman" || p.role === "girl") {
          setLocal(vests, i, tParent, 0, 3.42 - 3.74 * 0.25, 0, 0, 0, 0, 0.84, 0.25, 0.84);
        } else {
          setMat(vests, i, tParent);
        }
      }
      if (p.overallsColor) setMat(overallsBibs, i, tParent);
      if (p.shawlColor) setMat(shawls, i, tParent);

      // Skirts
      if (p.skirtKind === "full") setMat(skirtsFull, i, tParent);
      else if (p.skirtKind === "bustle") setMat(skirtsBustle, i, tParent);
      else if (p.skirtKind === "mid") setMat(skirtsMid, i, tParent);
      else if (p.skirtKind === "short") setMat(skirtsShort, i, tParent);

      // Arms & Hands
      const shoulderX = (p.torsoKind === "woman" ? 0.45 : p.torsoKind === "shirt" ? 0.50 : 0.54) * bw;
      const armFlare = hasSkirt ? 0.16 : 0.08;
      const armBuild = bw * (p.role === "woman" || child ? 0.84 : 0.96);
      setArmChain(i, -1, -shoulderX, 4.48, uArmRxL, uArmRyL, -armFlare + uArmRzL, elbowRxL, armBuild, uArmsL, fArmsL, handsL, puffsL, p.puffSleeve);
      setArmChain(i, 1, shoulderX, 4.48, uArmRxR, uArmRyR, armFlare + uArmRzR, elbowRxR, armBuild, uArmsR, fArmsR, handsR, puffsR, p.puffSleeve);

      // Head matrix (shared by skull, eyes, brows, mouth, beard, hair, and hat)
      const headS = child ? 1.18 : 1.0;
      pos.set(0, 4.95, 0.035);
      euler.set(headPitch, torsoYaw + headYaw, headRoll, "YXZ");
      quat.setFromEuler(euler);
      scl.set(headS, headS, headS);
      partMat.compose(pos, quat, scl);
      headMat.multiplyMatrices(rootMat, partMat);

      setMat(heads, i, headMat);
      setMat(eyeWhites, i, headMat);
      setMat(irises, i, headMat);
      setMat(brows, i, headMat);
      setMat(mouths, i, headMat);
      if (p.beard) setMat(beards, i, headMat);

      if (p.showHair) {
        const tucked = p.hatStyle === "bonnet" || p.hatStyle === "cloche";
        if (tucked) setLocal(hairBases, i, headMat, 0, -0.02, -0.04, 0, 0, 0, 0.85, 0.90, 0.88);
        else setMat(hairBases, i, headMat);
        if (p.hairStyle === "bun" && !tucked) setMat(hairBuns, i, headMat);
        else if (p.hairStyle === "bob" && !tucked) setMat(hairBobs, i, headMat);
      }

      // Hats
      const hsMode = p.hatStyle;
      if (hsMode === "wide") {
        setLocal(hatFedoras, i, headMat, 0, 0.82, -0.01, -0.03, 0, 0, 1.08, 1.20, 1.10);
        setLocal(hatBrimsCurved, i, headMat, 0, 0.62, -0.01, -0.03, 0, 0, 0.78, 1.0, 0.80);
        setLocal(hatBands, i, headMat, 0, 0.67, -0.01, -0.03, 0, 0, 1.04, 1.0, 1.08);
      } else if (hsMode === "tophat") {
        setLocal(hatCrowns, i, headMat, 0, 1.03, -0.01, 0, 0, 0, 1.02, 0.76, 1.08);
        setLocal(hatBrimsCurved, i, headMat, 0, 0.65, -0.01, 0, 0, 0, 0.62, 1.0, 0.65);
        setLocal(hatBands, i, headMat, 0, 0.71, -0.01, 0, 0, 0, 1.02, 1.1, 1.08);
      } else if (hsMode === "bonnet") {
        setLocal(hatBonnets, i, headMat, 0, 0.44, -0.04, -0.18, 0, 0, 1.0, 1.0, 1.0);
        setLocal(hatBands, i, headMat, 0, 0.22, -0.12, -0.18, 0, 0, 0.78, 0.7, 0.84);
      } else if (hsMode === "bowler") {
        setLocal(hatDomes, i, headMat, 0, 0.72, -0.01, 0, 0, 0, 1.02, 1.12, 1.06);
        setLocal(hatBrimsCurved, i, headMat, 0, 0.61, -0.01, 0, 0, 0, 0.56, 1.0, 0.58);
        setLocal(hatBands, i, headMat, 0, 0.65, -0.01, 0, 0, 0, 0.99, 0.85, 1.04);
      } else if (hsMode === "boater") {
        setLocal(hatCrowns, i, headMat, 0, 0.77, -0.01, 0.03, 0, 0, 1.08, 0.28, 1.16);
        setLocal(hatBrimsFlat, i, headMat, 0, 0.65, -0.01, 0.03, 0, 0, 0.76, 1.0, 0.80);
        setLocal(hatBands, i, headMat, 0, 0.71, -0.01, 0.03, 0, 0, 1.05, 0.9, 1.13);
      } else if (hsMode === "fedora") {
        setLocal(hatFedoras, i, headMat, 0, 0.80, 0.00, 0.06, 0, 0, 1.05, 1.14, 1.08);
        setLocal(hatBrimsCurved, i, headMat, 0, 0.62, 0.01, 0.08, 0, 0, 0.70, 1.0, 0.74);
        setLocal(hatBands, i, headMat, 0, 0.66, 0.00, 0.06, 0, 0, 1.01, 0.9, 1.06);
      } else if (hsMode === "edwardian") {
        setLocal(hatCrowns, i, headMat, 0, 0.78, -0.01, -0.03, 0, 0, 1.08, 0.26, 1.14);
        setLocal(hatBrimsFlat, i, headMat, 0, 0.67, -0.01, -0.03, 0, 0, 0.90, 1.0, 0.92);
        setLocal(hatBands, i, headMat, 0, 0.72, -0.01, -0.03, 0, 0, 1.05, 0.85, 1.11);
      } else if (hsMode === "cloche") {
        setLocal(hatDomes, i, headMat, 0, 0.64, 0.00, 0.04, 0, 0, 1.03, 1.10, 1.07);
        setLocal(hatBrimsCurved, i, headMat, 0, 0.52, 0.02, 0.07, 0, 0, 0.45, 1.0, 0.49);
        setLocal(hatBands, i, headMat, 0, 0.55, 0.00, 0.04, 0, 0, 1.01, 0.8, 1.05);
      } else if (hsMode === "cap") {
        setLocal(hatDomes, i, headMat, 0, 0.68, -0.02, -0.04, 0, 0, 1.00, 0.82, 1.06);
        setLocal(hatBrimsFlat, i, headMat, 0, 0.60, 0.22, 0.08, 0, 0, 0.35, 1.0, 0.45);
      }
    });

    for (const part of parts) {
      if (part.meshHi) {
        part.meshHi.count = part.hiN;
        part.meshHi.instanceMatrix.needsUpdate = true;
        if (part.meshHi.instanceColor) part.meshHi.instanceColor.needsUpdate = true;
      }
      if (part.meshLo) {
        part.meshLo.count = part.loN;
        part.meshLo.instanceMatrix.needsUpdate = true;
        if (part.meshLo.instanceColor) part.meshLo.instanceColor.needsUpdate = true;
      }
    }
  };

  applyPose(0);

  return (elapsed, camera) => applyPose(elapsed, camera);
}
