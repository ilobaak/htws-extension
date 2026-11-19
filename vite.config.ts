import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: "dist",
    rollupOptions: {
      input: {
        activity: resolve(import.meta.dirname, "activity.html"),
        hibernated: resolve(import.meta.dirname, "hibernated.html"),
        options: resolve(import.meta.dirname, "options.html"),
        observer: resolve(import.meta.dirname, "src/content/observer.ts"),
        popup: resolve(import.meta.dirname, "popup.html"),
        "service-worker": resolve(
          import.meta.dirname,
          "src/background/service-worker.ts",
        ),
      },
      output: {
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: (chunk) =>
          chunk.name === "service-worker" || chunk.name === "observer"
            ? `${chunk.name}.js`
            : "assets/[name]-[hash].js",
      },
    },
    sourcemap: false,
  },
});
