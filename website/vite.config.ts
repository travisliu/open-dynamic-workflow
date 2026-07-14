import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/open-dynamic-workflow/",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
