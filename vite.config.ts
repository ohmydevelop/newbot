import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwind()],
  build: { manifest: true, outDir: "dist/web", chunkSizeWarningLimit: 1000 },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3100",
      "/sandbox": { target: "http://127.0.0.1:3100", changeOrigin: false },
      "/artifact-preview": {
        target: "http://127.0.0.1:3100",
        changeOrigin: false,
      },
      "/artifact-content": {
        target: "http://127.0.0.1:3100",
        changeOrigin: false,
      },
    },
  },
});
