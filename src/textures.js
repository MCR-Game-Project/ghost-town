import * as THREE from "three";

// Procedural maps. One repeat is a few feet of wall, roof, or street.
// Color maps are sRGB. Normal and roughness maps stay linear.

function hash(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function canvasTex(w, h, draw, colorSpace) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = colorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function texFromImageData(imageData, colorSpace) {
  const c = document.createElement("canvas");
  c.width = imageData.width;
  c.height = imageData.height;
  c.getContext("2d").putImageData(imageData, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = colorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function normalsFromHeight(height, w, h, scale) {
  const img = new ImageData(w, h);
  const d = img.data;
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * scale;
      const ny = (at(x, y - 1) - at(x, y + 1)) * scale;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * w + x) * 4;
      d[i] = (nx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return texFromImageData(img, THREE.LinearSRGBColorSpace);
}

function roughnessFrom(values, w, h) {
  const img = new ImageData(w, h);
  const d = img.data;
  for (let i = 0; i < values.length; i++) {
    const v = Math.max(0, Math.min(255, values[i] * 255));
    const o = i * 4;
    d[o] = d[o + 1] = d[o + 2] = v;
    d[o + 3] = 255;
  }
  return texFromImageData(img, THREE.LinearSRGBColorSpace);
}

function packMaps(w, h, paint) {
  const colorCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  colorCtx.canvas.width = w;
  colorCtx.canvas.height = h;
  const img = colorCtx.createImageData(w, h);
  const height = new Float32Array(w * h);
  const rough = new Float32Array(w * h);
  paint(img.data, height, rough, w, h);
  colorCtx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(colorCtx.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return {
    map,
    normalMap: normalsFromHeight(height, w, h, 2.4),
    roughnessMap: roughnessFrom(rough, w, h),
  };
}

function brickMaps() {
  const w = 256;
  const h = 256;
  const periodX = 64;
  const periodY = 32;
  const mortar = 4;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const row = Math.floor(y / periodY);
        const off = row % 2 ? periodX / 2 : 0;
        const lx = (x + off) % periodX;
        const ly = y % periodY;
        const inBrick = lx >= mortar && lx < periodX - 1 && ly >= mortar && ly < periodY - 1;
        const i = y * w + x;
        const o = i * 4;
        const n = (hash(x, y) - 0.5) * 18;
        if (!inBrick) {
          const m = 196 + (hash(x * 3, y * 5) - 0.5) * 24;
          px[o] = m + n * 0.3;
          px[o + 1] = m - 8 + n * 0.3;
          px[o + 2] = m - 22 + n * 0.2;
          height[i] = 0.08;
          rough[i] = 0.96;
        } else {
          const brickId = row * 17 + Math.floor((x + off) / periodX);
          const tone = hash(brickId, row * 3);
          const weather = hash(brickId * 5, 9);
          let r = 148 + tone * 55;
          let g = 62 + tone * 28;
          let b = 46 + tone * 16;
          if (weather > 0.82) {
            r += 28;
            g += 24;
            b += 18;
          } else if (weather < 0.12) {
            r *= 0.72;
            g *= 0.7;
            b *= 0.68;
          }
          const edge = Math.min(lx - mortar, periodX - 1 - lx, ly - mortar, periodY - 1 - ly);
          const bevel = Math.max(0, Math.min(1, edge / 3));
          px[o] = Math.max(0, Math.min(255, r + n));
          px[o + 1] = Math.max(0, Math.min(255, g + n * 0.85));
          px[o + 2] = Math.max(0, Math.min(255, b + n * 0.7));
          height[i] = 0.35 + bevel * 0.65;
          rough[i] = 0.78 + (1 - bevel) * 0.12 + (weather < 0.12 ? 0.08 : 0);
        }
        px[o + 3] = 255;
      }
    }
  });
}

function sidingMaps(stain) {
  const w = 256;
  const h = 128;
  const lap = 16;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const board = Math.floor(y / lap);
        const ly = y % lap;
        const tone = hash(board, 4);
        const grain = (hash(x, board) - 0.5) * 16 + (hash(x * 2, y) - 0.5) * 8;
        let r = 232 + tone * 14 + grain;
        let g = 224 + tone * 10 + grain;
        let b = 208 + tone * 8 + grain;
        if (ly < 2) {
          r *= 0.62;
          g *= 0.6;
          b *= 0.55;
        } else if (ly > lap - 3) {
          r = Math.min(255, r + 10);
          g = Math.min(255, g + 10);
          b = Math.min(255, b + 8);
        }
        if (stain > 0 && hash(board, x >> 3) > 0.92) {
          r *= 0.9;
          g *= 0.88;
          b *= 0.82;
        }
        const i = y * w + x;
        const o = i * 4;
        px[o] = Math.max(0, Math.min(255, r));
        px[o + 1] = Math.max(0, Math.min(255, g));
        px[o + 2] = Math.max(0, Math.min(255, b));
        px[o + 3] = 255;
        const bevel = ly < 2 ? 0.15 : ly / lap;
        height[i] = bevel;
        rough[i] = 0.72 + (ly < 2 ? 0.15 : 0);
      }
    }
  });
}

function shingleMaps() {
  const w = 256;
  const h = 256;
  const cw = 32;
  const ch = 32;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const row = Math.floor(y / ch);
        const off = row % 2 ? cw / 2 : 0;
        const lx = (x + off) % cw;
        const ly = y % ch;
        const id = row * 13 + Math.floor((x + off) / cw);
        const tone = hash(id, row);
        let r = 92 + tone * 48;
        let g = 68 + tone * 32;
        let b = 48 + tone * 20;
        const gap = lx < 2 || ly > ch - 3;
        if (gap) {
          r *= 0.45;
          g *= 0.42;
          b *= 0.4;
        }
        const n = (hash(x, y) - 0.5) * 14;
        const i = y * w + x;
        const o = i * 4;
        px[o] = Math.max(0, Math.min(255, r + n));
        px[o + 1] = Math.max(0, Math.min(255, g + n));
        px[o + 2] = Math.max(0, Math.min(255, b + n * 0.8));
        px[o + 3] = 255;
        height[i] = gap ? 0.12 : 0.45 + (1 - ly / ch) * 0.5;
        rough[i] = gap ? 0.95 : 0.84;
      }
    }
  });
}

function tinMaps() {
  const w = 256;
  const h = 256;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const seam = x % 64 < 3 || x % 64 > 61;
        const streak = hash(x, Math.floor(y / 6));
        let v = seam ? 70 : 168 + streak * 28;
        const n = (hash(x * 2, y) - 0.5) * 10;
        v += n;
        if (!seam && hash(Math.floor(x / 8), Math.floor(y / 40)) > 0.9) v -= 30;
        const i = y * w + x;
        const o = i * 4;
        px[o] = Math.max(0, Math.min(255, v));
        px[o + 1] = Math.max(0, Math.min(255, v + 2));
        px[o + 2] = Math.max(0, Math.min(255, v + 6));
        px[o + 3] = 255;
        height[i] = seam ? 0.95 : 0.4;
        rough[i] = seam ? 0.55 : 0.32 + (v < 140 ? 0.25 : 0);
      }
    }
  });
}

function stoneMaps() {
  const w = 256;
  const h = 128;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const row = Math.floor(y / 32);
        const off = row % 2 ? 28 : 0;
        const lx = (x + off) % 56;
        const ly = y % 32;
        const joint = lx < 3 || ly < 3 || lx > 52;
        const id = row * 9 + Math.floor((x + off) / 56);
        const tone = hash(id, 2);
        let v = joint ? 92 : 168 + tone * 40;
        const n = (hash(x, y) - 0.5) * 16;
        v += n;
        const i = y * w + x;
        const o = i * 4;
        px[o] = Math.max(0, Math.min(255, v));
        px[o + 1] = Math.max(0, Math.min(255, v - 4));
        px[o + 2] = Math.max(0, Math.min(255, v - 12));
        px[o + 3] = 255;
        height[i] = joint ? 0.1 : 0.55 + tone * 0.3;
        rough[i] = joint ? 0.98 : 0.9;
      }
    }
  });
}

function plankMaps() {
  const w = 256;
  const h = 128;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const board = Math.floor(y / 18);
        const ly = y % 18;
        const tone = hash(board, 11);
        const grain = Math.sin(x * 0.35 + board) * 6 + (hash(x, board) - 0.5) * 18;
        let r = 168 + tone * 30 + grain;
        let g = 128 + tone * 18 + grain * 0.7;
        let b = 86 + tone * 10 + grain * 0.4;
        const gap = ly === 0 || ly === 17;
        if (gap) {
          r *= 0.45;
          g *= 0.4;
          b *= 0.35;
        }
        if (hash(Math.floor(x / 40), board) > 0.85 && ly > 6 && ly < 11 && x % 40 > 16 && x % 40 < 22) {
          r *= 0.55;
          g *= 0.5;
          b *= 0.45;
        }
        const i = y * w + x;
        const o = i * 4;
        px[o] = Math.max(0, Math.min(255, r));
        px[o + 1] = Math.max(0, Math.min(255, g));
        px[o + 2] = Math.max(0, Math.min(255, b));
        px[o + 3] = 255;
        height[i] = gap ? 0.05 : 0.5 + Math.sin((ly / 18) * Math.PI) * 0.25;
        rough[i] = 0.86;
      }
    }
  });
}

function groundMaps(ruts) {
  const w = 512;
  const h = 512;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = hash(x, y);
        const blot = hash(x >> 3, y >> 3);
        let r = 126 + blot * 36 + (n - 0.5) * 22;
        let g = 96 + blot * 24 + (n - 0.5) * 16;
        let b = 58 + blot * 14 + (n - 0.5) * 10;
        let hv = 0.45 + blot * 0.15;
        if (ruts) {
          const along = ruts === "v" ? y : x;
          const across = ruts === "v" ? x : y;
          const groove = (cy) => {
            const wobble = Math.sin(along * 0.02) * 10;
            const d = Math.abs(across - (cy + wobble));
            if (d < 16) return 1 - d / 16;
            return 0;
          };
          const g1 = groove(150);
          const g2 = groove(300);
          const rut = Math.max(g1, g2);
          if (rut > 0) {
            r *= 1 - rut * 0.28;
            g *= 1 - rut * 0.3;
            b *= 1 - rut * 0.22;
            hv -= rut * 0.45;
          }
          if (hash(x >> 2, y >> 1) > 0.97) {
            r += 20;
            g += 16;
            b += 10;
            hv += 0.2;
          }
        } else if (n > 0.96) {
          r -= 18;
          g -= 10;
          hv -= 0.1;
        }
        const i = y * w + x;
        const o = i * 4;
        px[o] = Math.max(0, Math.min(255, r));
        px[o + 1] = Math.max(0, Math.min(255, g));
        px[o + 2] = Math.max(0, Math.min(255, b));
        px[o + 3] = 255;
        height[i] = Math.max(0, hv);
        rough[i] = 0.96;
      }
    }
  });
}

function grassMaps(deep) {
  const w = 128;
  const h = 128;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = hash(x, y);
        const clump = hash(x >> 2, y >> 2);
        let r = (deep ? 70 : 92) + clump * 30;
        let g = (deep ? 110 : 128) + clump * 36 + (n > 0.7 ? 16 : 0);
        let b = (deep ? 42 : 52) + clump * 12;
        const i = y * w + x;
        const o = i * 4;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = 255;
        height[i] = 0.4 + (n > 0.55 ? 0.35 : 0);
        rough[i] = 0.95;
      }
    }
  });
}

function ballastMaps() {
  const w = 128;
  const h = 128;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tie = y % 22 < 5;
        const n = hash(x, y);
        let r;
        let g;
        let b;
        if (tie) {
          r = 92;
          g = 70;
          b = 48;
        } else {
          const v = 130 + n * 50;
          r = v;
          g = v - 4;
          b = v - 10;
        }
        const i = y * w + x;
        const o = i * 4;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = 255;
        height[i] = tie ? 0.25 : 0.4 + n * 0.5;
        rough[i] = 0.94;
      }
    }
  });
}

function awningMaps() {
  const w = 256;
  const h = 128;
  return canvasTex(w, h, (g) => {
    for (let x = 0; x < w; x += 32) {
      const stripe = (x / 32) % 2 === 0;
      const grad = g.createLinearGradient(0, 0, 0, h);
      if (stripe) {
        grad.addColorStop(0, "#f3e6cf");
        grad.addColorStop(0.55, "#e4d2b0");
        grad.addColorStop(1, "#b45348");
      } else {
        grad.addColorStop(0, "#a8443c");
        grad.addColorStop(0.55, "#8d342e");
        grad.addColorStop(1, "#5e241f");
      }
      g.fillStyle = grad;
      g.fillRect(x, 0, 32, h);
    }
    g.strokeStyle = "rgba(40,16,10,0.35)";
    for (let x = 0; x < w; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
  }, THREE.SRGBColorSpace);
}

function std(opts) {
  const { uvFeet, vary, normalScale, ...rest } = opts;
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
    ...rest,
  });
  mat.vertexColors = Boolean(vary);
  mat.userData.uvFeet = uvFeet || { u: 4, v: 3.2 };
  mat.userData.vary = Boolean(vary);
  if (normalScale && mat.normalScale) mat.normalScale.set(normalScale, normalScale);
  return mat;
}

export function makeMaterials() {
  const brickTex = brickMaps();
  const sidingTex = sidingMaps(0.2);
  const shingleTex = shingleMaps();
  const tinTex = tinMaps();
  const stoneTex = stoneMaps();
  const plankTex = plankMaps();
  const streetTex = groundMaps("u");
  const streetCrossTex = groundMaps("v");
  const dirtTex = groundMaps(false);
  const grassTex = grassMaps(false);
  const parkTex = grassMaps(true);
  const ballastTex = ballastMaps();
  const awningTex = awningMaps();

  const brickFeet = { u: 2.67, v: 1.78 };
  const brick = (color) =>
    std({
      map: brickTex.map,
      normalMap: brickTex.normalMap,
      roughnessMap: brickTex.roughnessMap,
      color,
      roughness: 1,
      uvFeet: brickFeet,
      vary: true,
      normalScale: 0.8,
    });

  const sidingFeet = { u: 8, v: 3.2 };
  const siding = (color) =>
    std({
      map: sidingTex.map,
      normalMap: sidingTex.normalMap,
      roughnessMap: sidingTex.roughnessMap,
      color,
      roughness: 1,
      uvFeet: sidingFeet,
      vary: true,
      normalScale: 0.65,
    });

  const shingle = (color) =>
    std({
      map: shingleTex.map,
      normalMap: shingleTex.normalMap,
      roughnessMap: shingleTex.roughnessMap,
      color,
      roughness: 1,
      uvFeet: { u: 5.3, v: 4 },
      vary: true,
      normalScale: 0.7,
    });

  return {
    brick: {
      red: brick("#9a4034"),
      dark: brick("#7d332c"),
      soft: brick("#a85a3e"),
    },
    siding: {
      white: siding("#f4efe4"),
      cream: siding("#f0e2c4"),
      yellow: siding("#e6d48a"),
      gray: siding("#c9c2b6"),
      red: siding("#8d3a32"),
      green: siding("#7f8f72"),
      tan: siding("#d9c4a0"),
      darkred: siding("#6e2e2a"),
      depot: siding("#8d4d3a"),
    },
    roof: shingle("#8a7562"),
    roofDark: shingle("#5c4a3c"),
    tin: std({
      map: tinTex.map,
      normalMap: tinTex.normalMap,
      roughnessMap: tinTex.roughnessMap,
      color: "#d5dbe0",
      metalness: 0.82,
      roughness: 0.55,
      envMapIntensity: 1.05,
      uvFeet: { u: 6, v: 8 },
      vary: true,
      normalScale: 0.55,
    }),
    plank: std({
      map: plankTex.map,
      normalMap: plankTex.normalMap,
      roughnessMap: plankTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 10, v: 1.35 },
      normalScale: 0.7,
    }),
    dirt: std({
      map: dirtTex.map,
      normalMap: dirtTex.normalMap,
      roughnessMap: dirtTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 18, v: 18 },
      normalScale: 0.5,
    }),
    street: std({
      map: streetTex.map,
      normalMap: streetTex.normalMap,
      roughnessMap: streetTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 22, v: 22 },
      normalScale: 0.85,
    }),
    streetCross: std({
      map: streetCrossTex.map,
      normalMap: streetCrossTex.normalMap,
      roughnessMap: streetCrossTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 22, v: 22 },
      normalScale: 0.85,
    }),
    grass: std({
      map: grassTex.map,
      normalMap: grassTex.normalMap,
      roughnessMap: grassTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 8, v: 8 },
      normalScale: 0.35,
    }),
    park: std({
      map: parkTex.map,
      normalMap: parkTex.normalMap,
      roughnessMap: parkTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 7, v: 7 },
      normalScale: 0.35,
    }),
    ballast: std({
      map: ballastTex.map,
      normalMap: ballastTex.normalMap,
      roughnessMap: ballastTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 6, v: 6 },
      normalScale: 0.6,
    }),
    awning: std({
      map: awningTex,
      color: "#ffffff",
      roughness: 0.86,
      uvFeet: { u: 3.4, v: 4.2 },
      normalScale: 0.2,
    }),
    awningShade: std({
      color: "#6a2e28",
      roughness: 0.92,
      uvFeet: { u: 4, v: 4 },
    }),
    shutter: siding("#3f5344"),
    trim: std({ color: "#f3ead7", roughness: 0.72, uvFeet: { u: 6, v: 6 } }),
    trimDark: std({ color: "#4a3424", roughness: 0.7, uvFeet: { u: 4, v: 4 } }),
    voussoir: std({ color: "#8a4036", roughness: 0.86, uvFeet: { u: 2, v: 2 } }),
    reveal: std({ color: "#1c140f", roughness: 0.95, uvFeet: { u: 4, v: 4 } }),
    glass: std({
      color: "#9eb6c2",
      roughness: 0.07,
      metalness: 0.78,
      envMapIntensity: 1.2,
      emissive: "#3a2c1c",
      emissiveIntensity: 0.28,
      uvFeet: { u: 8, v: 8 },
    }),
    stone: std({
      map: stoneTex.map,
      normalMap: stoneTex.normalMap,
      roughnessMap: stoneTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 4.2, v: 2.2 },
      vary: true,
      normalScale: 0.75,
    }),
    metal: std({
      color: "#5a636b",
      metalness: 0.72,
      roughness: 0.42,
      envMapIntensity: 0.8,
      uvFeet: { u: 2, v: 6 },
    }),
    coal: std({ color: "#2a2c30", roughness: 0.95, uvFeet: { u: 4, v: 4 } }),
    leaf: std({ color: "#3f6b34", roughness: 0.9, uvFeet: { u: 4, v: 4 } }),
    leafDark: std({ color: "#2f5228", roughness: 0.9, uvFeet: { u: 4, v: 4 } }),
    trunk: std({ color: "#6b4a32", roughness: 0.92, uvFeet: { u: 2, v: 4 } }),
    horse: std({ color: "#6a4630", roughness: 0.8, uvFeet: { u: 2, v: 2 } }),
    horseDark: std({ color: "#3e2a1c", roughness: 0.8, uvFeet: { u: 2, v: 2 } }),
    lamp: std({
      color: "#f6e2a8",
      emissive: "#e7b15a",
      emissiveIntensity: 0.7,
      roughness: 0.4,
      uvFeet: { u: 1, v: 1 },
    }),
    whitewash: std({ color: "#f7f4ee", roughness: 0.8, uvFeet: { u: 4, v: 4 } }),
  };
}

export function makeSignTexture(title, subtitle, style = "board") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = subtitle ? 180 : 128;
  const g = c.getContext("2d");
  if (style === "painted") {
    g.fillStyle = "#f4ead4";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#6b5340";
    g.lineWidth = 8;
    g.strokeRect(12, 12, c.width - 24, c.height - 24);
    g.fillStyle = "#24180f";
  } else {
    g.fillStyle = "#3b2718";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#e6d3a8";
    g.lineWidth = 8;
    g.strokeRect(8, 8, c.width - 16, c.height - 16);
    g.fillStyle = "#f6ecd4";
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  const line = (text, y, start) => {
    let size = start;
    do {
      g.font = `600 ${size}px Georgia, "Palatino Linotype", Palatino, serif`;
      if (g.measureText(text).width <= 460) break;
      size -= 2;
    } while (size > 22);
    g.fillText(text, c.width / 2, y);
  };
  if (subtitle) {
    line(title.toUpperCase(), 68, 54);
    g.fillStyle = "#e4c98a";
    line(subtitle, 128, 28);
  } else {
    line(title.toUpperCase(), c.height / 2, 58);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
