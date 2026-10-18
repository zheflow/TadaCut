import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve("apps/studio"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4318,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4317",
      "/media": "http://127.0.0.1:4317",
      "/artifacts": "http://127.0.0.1:4317",
    },
  },
  resolve: {
    alias: {
      "@tadacut/domain": path.resolve("packages/domain/src/index.ts"),
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
