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
  tex.anisotropy = 16;
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
  tex.anisotropy = 16;
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
  map.anisotropy = 16;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  return {
    map,
    normalMap: normalsFromHeight(height, w, h, 2.4),
    roughnessMap: roughnessFrom(rough, w, h),
  };
}

function brickMaps(kind = "red") {
  const w = 512;
  const h = 512;
  const periodX = 128;
  const periodY = 64;
  const mortar = 8;
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
          let r = 132 + tone * 78;
          let g = 48 + tone * 42;
          let b = 36 + tone * 24;
          if (kind === "buff") {
            r = 196 + tone * 36;
            g = 176 + tone * 30;
            b = 142 + tone * 22;
          } else if (kind === "green") {
            r = 154 + tone * 24;
            g = 164 + tone * 22;
            b = 112 + tone * 16;
          }
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
  const w = 512;
  const h = 256;
  const lap = 32;
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

function shingleMaps(kind = "dark") {
  const w = 512;
  const h = 512;
  const cw = 64;
  const ch = 64;
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
        if (kind === "tan") {
          r = 176 + tone * 42;
          g = 158 + tone * 30;
          b = 104 + tone * 18;
        }
        const gap = lx < 4 || ly > ch - 6;
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
  const w = 512;
  const h = 512;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const seam = x % 128 < 6 || x % 128 > 122;
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
  const w = 512;
  const h = 256;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const row = Math.floor(y / 64);
        const off = row % 2 ? 56 : 0;
        const lx = (x + off) % 112;
        const ly = y % 64;
        const joint = lx < 6 || ly < 6 || lx > 104;
        const id = row * 9 + Math.floor((x + off) / 112);
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
  const w = 512;
  const h = 256;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const board = Math.floor(y / 36);
        const ly = y % 36;
        const tone = hash(board, 11);
        const grain = Math.sin(x * 0.18 + board) * 6 + (hash(x, board) - 0.5) * 18;
        let r = 168 + tone * 30 + grain;
        let g = 128 + tone * 18 + grain * 0.7;
        let b = 86 + tone * 10 + grain * 0.4;
        const gap = ly < 2 || ly > 33;
        if (gap) {
          r *= 0.45;
          g *= 0.4;
          b *= 0.35;
        }
        if (hash(Math.floor(x / 80), board) > 0.85 && ly > 12 && ly < 22 && x % 80 > 32 && x % 80 < 44) {
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
        height[i] = gap ? 0.05 : 0.5 + Math.sin((ly / 36) * Math.PI) * 0.25;
        rough[i] = 0.86;
      }
    }
  });
}

function groundMaps(ruts) {
  const w = 1024;
  const h = 1024;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = hash(x, y);
        const fine = hash(x * 3, y * 5);
        const blot = hash(x >> 4, y >> 4);
        let r = 126 + blot * 36 + (n - 0.5) * 18 + (fine - 0.5) * 14;
        let g = 96 + blot * 24 + (n - 0.5) * 12 + (fine - 0.5) * 10;
        let b = 58 + blot * 14 + (n - 0.5) * 8 + (fine - 0.5) * 6;
        const edge = Math.min(x, w - 1 - x, y, h - 1 - y);
        if (edge < w * 0.06) {
          const k = 1 - edge / (w * 0.06);
          r *= 1 - k * 0.28;
          g *= 1 - k * 0.3;
          b *= 1 - k * 0.22;
        }
        let hv = 0.45 + blot * 0.15;
        if (ruts) {
          const along = ruts === "v" ? y : x;
          const across = ruts === "v" ? x : y;
          const groove = (cy) => {
            const wobble = Math.sin(along * 0.01) * 18;
            const d = Math.abs(across - (cy + wobble));
            const band = w * 0.028;
            if (d < band) return 1 - d / band;
            return 0;
          };
          const g1 = groove(w * 0.34);
          const g2 = groove(w * 0.66);
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
  const w = 1024;
  const h = 1024;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = hash(x, y);
        const blade = hash(x * 2 + 3, y * 3 + 1);
        const clump = hash(x >> 5, y >> 5);
        let r = (deep ? 70 : 88) + clump * 28 + blade * 18;
        let g = (deep ? 108 : 124) + clump * 36 + blade * 22 + (n > 0.9 ? 10 : 0);
        let b = (deep ? 42 : 48) + clump * 12 + blade * 6;
        const i = y * w + x;
        const o = i * 4;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = 255;
        height[i] = 0.3 + (n > 0.72 ? 0.1 : 0);
        rough[i] = 0.96;
      }
    }
  });
}

function ballastMaps() {
  const w = 256;
  const h = 256;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = hash(x, y);
        const across = x / w;
        // Four ties in each 8-foot repeat, about 9 inches wide and 2 feet apart.
        const onTie = y % 64 < 22 && across > 0.16 && across < 0.84;
        let r;
        let g;
        let b;
        let hv;
        if (onTie) {
          const grain = hash(x >> 1, y);
          r = 78 + grain * 16;
          g = 56 + grain * 8;
          b = 36 + grain * 6;
          hv = 0.78;
        } else {
          const speck = hash(x >> 2, y >> 2);
          const v = 108 + n * 22 + (speck - 0.5) * 14;
          r = v + 8;
          g = v + 3;
          b = v - 8;
          hv = 0.32 + n * 0.35;
        }
        const i = y * w + x;
        const o = i * 4;
        px[o] = Math.max(0, Math.min(255, r));
        px[o + 1] = Math.max(0, Math.min(255, g));
        px[o + 2] = Math.max(0, Math.min(255, b));
        px[o + 3] = 255;
        height[i] = hv;
        rough[i] = onTie ? 0.86 : 0.97;
      }
    }
  });
}

// Rail bed only. Dark rust gravel and near-black ties, so the line is not another dirt road.
function trackBedMaps() {
  const w = 256;
  const h = 256;
  return packMaps(w, h, (px, height, rough) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = hash(x, y);
        const across = x / w;
        const onTie = y % 64 < 20 && across > 0.18 && across < 0.82;
        let r;
        let g;
        let b;
        let hv;
        if (onTie) {
          const grain = hash(x >> 1, y);
          r = 34 + grain * 12;
          g = 22 + grain * 7;
          b = 14 + grain * 4;
          hv = 0.74;
        } else {
          const speck = hash(x >> 2, y >> 2);
          r = 108 + n * 32 + (speck - 0.5) * 20;
          g = 48 + n * 14 + (speck - 0.5) * 8;
          b = 26 + n * 8 + (speck - 0.5) * 5;
          if (speck > 0.9) {
            r += 24;
            g += 8;
            b += 3;
          } else if (speck < 0.08) {
            r *= 0.6;
            g *= 0.55;
            b *= 0.5;
          }
          hv = 0.26 + n * 0.3;
        }
        const i = y * w + x;
        const o = i * 4;
        px[o] = Math.max(0, Math.min(255, r));
        px[o + 1] = Math.max(0, Math.min(255, g));
        px[o + 2] = Math.max(0, Math.min(255, b));
        px[o + 3] = 255;
        height[i] = hv;
        rough[i] = onTie ? 0.9 : 0.98;
      }
    }
  });
}

function picketMaps() {
  const w = 64;
  const h = 256;
  return canvasTex(w, h, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const gap = 12;
    g.fillStyle = "#f3ecdf";
    g.beginPath();
    g.moveTo(gap / 2, H);
    g.lineTo(gap / 2, 42);
    g.lineTo(W / 2, 6);
    g.lineTo(W - gap / 2, 42);
    g.lineTo(W - gap / 2, H);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(70, 52, 34, 0.28)";
    g.fillRect(W - gap / 2 - 4, 42, 4, H - 42);
  }, THREE.SRGBColorSpace);
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

const groundWhite = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
groundWhite.colorSpace = THREE.SRGBColorSpace;
groundWhite.wrapS = groundWhite.wrapT = THREE.RepeatWrapping;
groundWhite.anisotropy = 1;
groundWhite.generateMipmaps = false;
groundWhite.minFilter = THREE.LinearFilter;
groundWhite.magFilter = THREE.LinearFilter;
groundWhite.needsUpdate = true;

// Albedo is sampled from world position, so grass and dirt do not repeat a tile.
function worldGround(kind, across) {
  const mat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    map: groundWhite,
    roughness: 0.94,
    metalness: 0,
  });
  if (kind === "street") mat.side = THREE.DoubleSide;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 1.5;
  mat.polygonOffsetUnits = 1.5;
  const key = `${kind}:${across}`;
  const grass = kind === "grass" || kind === "park";
  const ruts = kind === "street";
  const deep = kind === "park" ? "vec3(0.24, 0.36, 0.14)" : "vec3(0.30, 0.44, 0.18)";
  const light = kind === "park" ? "vec3(0.38, 0.50, 0.20)" : "vec3(0.46, 0.58, 0.24)";
  const acrossExpr = across === "x" ? "uv.x" : "uv.y";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGWorld;\nvarying vec2 vGUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvGUv = uv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vGWorld;
varying vec2 vGUv;
float gHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = gHash(i);
  float b = gHash(i + vec2(1.0, 0.0));
  float c = gHash(i + vec2(0.0, 1.0));
  float d = gHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float gFbm(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 5; i++) {
    v += a * gNoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}
vec3 gAlbedo(vec3 world, vec2 uv) {
  vec2 p = world.xz;
  float broad = gFbm(p * 0.035);
  float mid = gFbm(p * 0.16 + 4.0);
  float fine = gFbm(p * 0.72 + 11.0);
  ${grass ? `vec3 col = mix(${deep}, ${light}, broad);
  col = mix(col, vec3(0.22, 0.40, 0.14), smoothstep(0.35, 0.7, mid) * 0.45);
  col = mix(col, vec3(0.50, 0.62, 0.28), smoothstep(0.55, 0.9, fine) * 0.28);
  return col;` : `vec3 soil = mix(vec3(0.36, 0.24, 0.14), vec3(0.62, 0.46, 0.28), broad);
  soil = mix(soil, soil * vec3(0.82, 0.78, 0.7), smoothstep(0.45, 0.8, mid) * 0.35);
  soil += (fine - 0.5) * 0.08;
  ${ruts ? `float across = ${acrossExpr};
  float along = ${across === "x" ? "uv.y" : "uv.x"};
  float rut = exp(-pow((across - 0.34) / 0.07, 2.0)) + exp(-pow((across - 0.66) / 0.07, 2.0));
  float wobble = sin(along * 36.0 + broad * 5.0) * 0.015;
  rut = max(rut, exp(-pow((across - 0.34 - wobble) / 0.04, 2.0)) * 0.65);
  soil *= 1.0 - rut * 0.28;
  float gravel = smoothstep(0.72, 0.95, fine);
  soil = mix(soil, soil * vec3(1.15, 1.08, 0.95), gravel * 0.22);
  float shoulder = smoothstep(0.0, 0.08, across) * smoothstep(1.0, 0.92, across);
  soil = mix(soil * 0.72, soil, shoulder);` : ""}
  return soil;`}
}`)
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= gAlbedo(vGWorld, vGUv);");
  };
  mat.customProgramCacheKey = () => `ground-v3-${key}`;
  mat.userData.ground = key;
  return mat;
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
  const buffTex = brickMaps("buff");
  const greenTex = brickMaps("green");
  const sidingTex = sidingMaps(0.2);
  const shingleTex = shingleMaps();
  const tanShingleTex = shingleMaps("tan");
  const tinTex = tinMaps();
  const stoneTex = stoneMaps();
  const plankTex = plankMaps();
  const dirtTex = groundMaps(false);
  const ballastTex = ballastMaps();
  const trackBedTex = trackBedMaps();
  const awningTex = awningMaps();
  const picketTex = picketMaps();

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
      normalScale: 1.5,
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
      buff: std({
        map: buffTex.map,
        normalMap: buffTex.normalMap,
        roughnessMap: buffTex.roughnessMap,
        color: "#efe2c8",
        roughness: 1,
        uvFeet: brickFeet,
        vary: true,
        normalScale: 0.8,
      }),
      green: std({
        map: greenTex.map,
        normalMap: greenTex.normalMap,
        roughnessMap: greenTex.roughnessMap,
        color: "#e4e6c8",
        roughness: 1,
        uvFeet: brickFeet,
        vary: true,
        normalScale: 0.8,
      }),
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
    roofSlate: shingle("#8b98a6"),
    roofTan: std({
      map: tanShingleTex.map,
      normalMap: tanShingleTex.normalMap,
      roughnessMap: tanShingleTex.roughnessMap,
      color: "#f3e7c4",
      roughness: 1,
      uvFeet: { u: 5.3, v: 4 },
      vary: true,
      normalScale: 0.7,
    }),
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
    dirt: worldGround("dirt", "y"),
    mud: std({
      map: dirtTex.map,
      normalMap: dirtTex.normalMap,
      roughnessMap: dirtTex.roughnessMap,
      color: "#5c4030",
      roughness: 0.28,
      metalness: 0.06,
      uvFeet: { u: 10, v: 10 },
      normalScale: 0.35,
    }),
    street: worldGround("street", "y"),
    streetCross: worldGround("street", "x"),
    grass: worldGround("grass", "y"),
    park: worldGround("park", "y"),
    ballast: std({
      map: ballastTex.map,
      normalMap: ballastTex.normalMap,
      roughnessMap: ballastTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 6, v: 6 },
      normalScale: 0.6,
    }),
    trackBed: std({
      map: trackBedTex.map,
      normalMap: trackBedTex.normalMap,
      roughnessMap: trackBedTex.roughnessMap,
      color: "#ffffff",
      roughness: 1,
      uvFeet: { u: 6, v: 6 },
      normalScale: 0.65,
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
    picket: std({
      map: picketTex,
      color: "#f7f1e6",
      alphaTest: 0.4,
      roughness: 0.84,
      side: THREE.DoubleSide,
      uvFeet: { u: 0.62, v: 3.35 },
    }),
    trim: std({ color: "#f3ead7", roughness: 0.72, uvFeet: { u: 6, v: 6 } }),
    trimDark: std({ color: "#4a3424", roughness: 0.7, uvFeet: { u: 4, v: 4 } }),
    voussoir: std({ color: "#8a4036", roughness: 0.86, uvFeet: { u: 2, v: 2 } }),
    reveal: std({ color: "#1c140f", roughness: 0.95, uvFeet: { u: 4, v: 4 } }),
    glass: (() => {
      const mat = std({
        color: "#e7eef4",
        roughness: 0.16,
        metalness: 0.08,
        envMapIntensity: 0.65,
        emissive: "#c5d5e2",
        emissiveIntensity: 0.12,
        uvFeet: { u: 8, v: 8 },
      });
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           float sky = clamp(0.35 - vViewPosition.y * 0.028, 0.0, 1.0);
           diffuseColor.rgb = mix(vec3(0.80, 0.86, 0.90), vec3(0.55, 0.66, 0.74), sky);`,
        );
      };
      mat.customProgramCacheKey = () => "glass-sky";
      return mat;
    })(),
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
  c.width = 1024;
  c.height = subtitle ? 360 : 256;
  const g = c.getContext("2d");
  if (style === "band") {
    g.fillStyle = "#4a3424";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#f7f1e4";
    g.textAlign = "center";
    g.textBaseline = "middle";
    let size = 92;
    g.font = `italic 600 ${size}px Georgia, "Palatino Linotype", Palatino, serif`;
    while (size > 40 && g.measureText(title).width > 960) {
      size -= 4;
      g.font = `italic 600 ${size}px Georgia, "Palatino Linotype", Palatino, serif`;
    }
    g.fillText(title, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    return tex;
  }
  if (style === "painted") {
    g.fillStyle = "#f4ead4";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#6b5340";
    g.lineWidth = 16;
    g.strokeRect(24, 24, c.width - 48, c.height - 48);
    g.fillStyle = "#24180f";
  } else {
    g.fillStyle = "#3b2718";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#e6d3a8";
    g.lineWidth = 16;
    g.strokeRect(16, 16, c.width - 32, c.height - 32);
    g.fillStyle = "#f6ecd4";
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  const line = (text, y, start) => {
    let size = start;
    do {
      g.font = `600 ${size}px Georgia, "Palatino Linotype", Palatino, serif`;
      if (g.measureText(text).width <= 920) break;
      size -= 4;
    } while (size > 44);
    g.fillText(text, c.width / 2, y);
  };
  if (subtitle) {
    line(title.toUpperCase(), 136, 108);
    g.fillStyle = "#e4c98a";
    line(subtitle, 256, 56);
  } else {
    line(title.toUpperCase(), c.height / 2, 116);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}
