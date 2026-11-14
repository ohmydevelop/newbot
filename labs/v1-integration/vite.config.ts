import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const fonts = fileURLToPath(
  new URL("./node_modules/katex/dist/fonts/", import.meta.url),
);
export default defineConfig({
  plugins: [react(), tailwind()],
  css: {
    postcss: {
      plugins: [
        {
          postcssPlugin: "newbot-local-katex-fonts",
          Declaration(declaration) {
            // Apps SDK UI's default font URLs are external. Bundle the same
            // named KaTeX assets through Vite so private hosts need no CDN.
            declaration.value = declaration.value.replace(
              /https:\/\/cdn\.openai\.com\/common\/fonts\/katex\/(KaTeX_[A-Za-z0-9_-]+\.woff2)/g,
              (_, name: string) => fonts + name,
            );
          },
        },
      ],
    },
  },
  define: {
    "process.env.COPILOTKIT_TELEMETRY_DISABLED": JSON.stringify("1"),
    "process.env.DO_NOT_TRACK": JSON.stringify("1"),
  },
  build: { outDir: "dist", emptyOutDir: true },
});
