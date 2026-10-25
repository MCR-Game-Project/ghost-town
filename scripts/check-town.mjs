import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../public/data/bushnell-1880.json", import.meta.url)));
const ids = new Set();
const required = [
  "cole-building",
  "hendee-store",
  "hendee-house",
  "bushnell-house",
  "national-hotel",
  "cbq-depot",
  "hendee-elevator",
  "tpw-depot",
  "christian-church",
];
for (const building of data.buildings) {
  if (!building.id || ids.has(building.id)) throw new Error(`Bad or duplicate id ${building.id}`);
  ids.add(building.id);
  for (const key of ["name", "kind", "use", "material", "x", "z", "width", "depth", "facing", "confidence"]) {
    if (building[key] === undefined || building[key] === null || building[key] === "") {
      throw new Error(`${building.id} missing ${key}`);
    }
  }
}
for (const id of required) {
  const found = [...ids].find((item) => item === id || item.startsWith(id));
  if (!found) throw new Error(`Missing sourced building ${id}`);
}
if (data.blocks.length < 20) throw new Error("Too few blocks");
if (data.lots.length < 200) throw new Error("Too few lots");
const parks = data.blocks.filter((block) => block.use === "park");
if (parks.length !== 2) throw new Error("Expected two parks");
console.log(
  `ok buildings=${data.buildings.length} sourced=${data.buildings.filter((b) => b.confidence === "sourced").length} lots=${data.lots.length} blocks=${data.blocks.length}`,
);
