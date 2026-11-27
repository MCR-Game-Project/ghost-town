import { defineConfig } from "vite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function minifyPublicJson() {
  return {
    name: "minify-public-json",
    apply: "build",
    writeBundle({ dir }) {
      const dataDir = join(dir, "data");
      for (const name of readdirSync(dataDir)) {
        if (!name.endsWith(".json")) continue;
        const path = join(dataDir, name);
        const raw = readFileSync(path, "utf8");
        writeFileSync(path, JSON.stringify(JSON.parse(raw)));
      }
    },
  };
}

export default defineConfig({
  base: "/ghost-town/",
  server: { host: "0.0.0.0", port: 4179, strictPort: true },
  preview: {
    host: "0.0.0.0",
    port: 4179,
    strictPort: true,
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
        },
      },
    },
  },
  plugins: [minifyPublicJson()],
});
