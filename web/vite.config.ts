// Vite config. The dev server proxies /functions/* to the local Deno backend
// (dev.ts, port 8787). Point it elsewhere with VITE_API_TARGET, e.g.
//   VITE_API_TARGET=http://localhost:8877 npm run dev
// PORTING: not needed in Base44 (src/api.ts switches to base44.functions.invoke).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const target = process.env.VITE_API_TARGET || "http://localhost:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  base: "./",
  server: {
    port: 5180,
    proxy: { "/functions": { target, changeOrigin: true } },
  },
  preview: {
    port: 5181,
    proxy: { "/functions": { target, changeOrigin: true } },
  },
});
