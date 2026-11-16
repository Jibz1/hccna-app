import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    // Read the generated palette verbatim instead of Vitest's default CSS mock.
    css: { include: [/src\/theme\/tokens\.css/] },
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "scripts/*.test.mjs"],
  },
});
