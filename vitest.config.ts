import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: true,
    exclude: ["**/node_modules/**", "**/.claude/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["node_modules/", "tests/"],
    },
  },
});
