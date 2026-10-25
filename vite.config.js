import { defineConfig } from "vite";

export default defineConfig({
  base: "/ghost-town/",
  server: { host: "0.0.0.0", port: 4179, strictPort: true },
  preview: { host: "0.0.0.0", port: 4179, strictPort: true },
});
