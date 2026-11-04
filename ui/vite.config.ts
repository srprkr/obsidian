import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The plugin embeds dist/index.html as one binary resource, so everything (JS, CSS, images)
// is inlined into that single file. See plugin/source/PluginEditor.cpp.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: "es2020",
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 2_000,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
