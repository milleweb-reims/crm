import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // La logique testée est pure : aucun DOM nécessaire.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
