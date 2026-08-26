import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "path";

// Build the SPA straight into the extension's media/web folder, which the
// extension's RemoteServer serves as static assets.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "../media/web"),
    emptyOutDir: true,
    // Single JS/CSS bundle keeps the static server trivial.
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  server: {
    // Dev proxy so `npm run dev` can talk to a running extension server.
    proxy: {
      "/api": "http://127.0.0.1:7377",
    },
  },
});
