// Render one photographed building beside its source photo.
// Usage: npm run compare -- <building-id>
// The dev server must already be running on port 4179.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2];
if (!id) {
  console.error("Usage: npm run compare -- <building-id>");
  process.exit(1);
}

function loadSpecs() {
  const files = [
    "bushnell-1880.json",
    "bushnell-1890.json",
    "bushnell-1900.json",
    "bushnell-1910.json",
    "bushnell-1920.json",
    "bushnell-1950.json",
    "bushnell-1960.json",
    "bushnell-1970.json",
  ];
  const found = [];
  for (const name of files) {
    const data = JSON.parse(readFileSync(resolve(root, "public/data", name), "utf8"));
    for (const list of [data.buildings, data.add, data.update]) {
      for (const building of list || []) {
        if (building.id === id && building.facadeSpec) found.push(building.facadeSpec);
      }
    }
  }
  return found.at(-1);
}

const spec = loadSpecs();
if (!spec?.camera) {
  console.error(`No facadeSpec.camera for ${id}`);
  process.exit(1);
}
const camera = spec.camera;
const fov = camera.fov ? `&fov=${camera.fov}` : "";
const pitch = camera.pitch != null ? `&pitch=${camera.pitch}` : "";
const query = `year=${camera.year}&shot=at&x=${camera.x}&z=${camera.z}&lx=${camera.lx}&lz=${camera.lz}${fov}${pitch}`;
const outDir = resolve(root, "artifacts");
mkdirSync(outDir, { recursive: true });
const renderPath = resolve(outDir, `compare-${id}-render.png`);
const sidePath = resolve(outDir, `compare-${id}.png`);

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 720 });
await page.goto(`http://127.0.0.1:4179/?${query}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => window.__townReady === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: renderPath });
await browser.close();

const photoPath = spec.sourcePhoto ? resolve(root, spec.sourcePhoto) : "";
const photoData = photoPath && existsSync(photoPath) ? readFileSync(photoPath).toString("base64") : "";
const renderData = readFileSync(renderPath).toString("base64");
const page2 = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=angle", "--use-angle=swiftshader"],
});
const sheet = await page2.newPage();
await sheet.setViewport({ width: 1920, height: 780 });
const left = photoData
  ? `<img id="photo" src="data:image/png;base64,${photoData}" alt="source photo">`
  : `<div class="missing">Source photo is not in the workspace yet.<br>${spec.sourcePhoto || "no sourcePhoto"}</div>`;
await sheet.setContent(`<!doctype html><style>
  body { margin: 0; background: #1c1916; font-family: Georgia, serif; color: #f4efe4; }
  .pair { display: flex; height: 720px; }
  img, .missing { width: 960px; height: 720px; object-fit: contain; background: #111; }
  .missing { display: flex; align-items: center; justify-content: center; text-align: center; padding: 40px; }
  .score { height: 60px; display: flex; align-items: center; justify-content: center; font-size: 28px; letter-spacing: 0.02em; }
</style><body><div class="pair">${left}<img id="render" src="data:image/png;base64,${renderData}" alt="render"></div><div class="score" id="score">scoring…</div></body>`);
await sheet.waitForFunction(() => {
  const photo = document.getElementById("photo");
  const render = document.getElementById("render");
  return (!photo || photo.complete) && render.complete;
});
const score = await sheet.evaluate(() => {
  const photo = document.getElementById("photo");
  const render = document.getElementById("render");
  if (!photo) return null;
  const sample = (img) => {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 72;
    const g = c.getContext("2d", { willReadFrequently: true });
    const scale = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
    return g.getImageData(0, 0, c.width, c.height).data;
  };
  const a = sample(photo);
  const b = sample(render);
  const bins = 8;
  const ha = new Float64Array(bins ** 3);
  const hb = new Float64Array(bins ** 3);
  const ea = new Float64Array(a.length / 4);
  const eb = new Float64Array(b.length / 4);
  const gray = (data, i) => data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  for (let p = 0, i = 0; i < a.length; i += 4, p++) {
    ha[(((a[i] >> 5) * bins + (a[i + 1] >> 5)) * bins) + (a[i + 2] >> 5)]++;
    hb[(((b[i] >> 5) * bins + (b[i + 1] >> 5)) * bins) + (b[i + 2] >> 5)]++;
    ea[p] = gray(a, i);
    eb[p] = gray(b, i);
  }
  let inter = 0;
  let total = 0;
  for (let i = 0; i < ha.length; i++) {
    inter += Math.min(ha[i], hb[i]);
    total += ha[i];
  }
  const color = inter / total;
  const w = 96;
  const h = 72;
  const edge = (src) => {
    const out = new Float64Array(src.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = src[i + 1] - src[i - 1];
        const gy = src[i + w] - src[i - w];
        out[i] = Math.hypot(gx, gy);
      }
    }
    return out;
  };
  const ga = edge(ea);
  const gb = edge(eb);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < ga.length; i++) {
    dot += ga[i] * gb[i];
    na += ga[i] * ga[i];
    nb += gb[i] * gb[i];
  }
  const edges = dot / (Math.sqrt(na * nb) || 1);
  const combined = color * 0.45 + edges * 0.55;
  const text = `color ${color.toFixed(2)}  ·  edges ${edges.toFixed(2)}  ·  score ${combined.toFixed(2)}`;
  document.getElementById("score").textContent = text;
  return { color, edges, score: combined, text };
});
await new Promise((r) => setTimeout(r, 200));
await sheet.screenshot({ path: sidePath });
await page2.close();
writeFileSync(resolve(outDir, `compare-${id}.json`), JSON.stringify({ id, camera, sourcePhoto: spec.sourcePhoto, photoFound: Boolean(photoData), score }, null, 2));
console.log(sidePath);
