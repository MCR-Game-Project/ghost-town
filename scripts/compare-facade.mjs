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
const query = `year=${camera.year}&shot=at&x=${camera.x}&z=${camera.z}&lx=${camera.lx}&lz=${camera.lz}`;
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
await sheet.setViewport({ width: 1920, height: 720 });
const left = photoData
  ? `<img src="data:image/png;base64,${photoData}" alt="source photo">`
  : `<div class="missing">Source photo is not in the workspace yet.<br>${spec.sourcePhoto || "no sourcePhoto"}<br>Put the file there and run this again.</div>`;
await sheet.setContent(`<!doctype html><style>
  body { margin: 0; display: flex; height: 720px; background: #d7d2c8; font-family: Georgia, serif; }
  img, .missing { width: 960px; height: 720px; object-fit: cover; }
  .missing { display: flex; align-items: center; justify-content: center; text-align: center; padding: 40px; background: #efe8dc; color: #3a2c22; }
</style><body>${left}<img src="data:image/png;base64,${renderData}" alt="render"></body>`);
await new Promise((r) => setTimeout(r, 400));
await sheet.screenshot({ path: sidePath });
await page2.close();
writeFileSync(resolve(outDir, `compare-${id}.json`), JSON.stringify({ id, camera, sourcePhoto: spec.sourcePhoto, photoFound: Boolean(photoData) }, null, 2));
console.log(sidePath);
