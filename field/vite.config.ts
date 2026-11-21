import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/llm": { target: "http://localhost:8787", changeOrigin: true },
      "/mcp": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: { outDir: "dist" },
});
