import { defineConfig } from "react-doctor/api";

export default defineConfig({
  ignore: {
    files: ["plugins/**", "repos/**", "src/**/__generated__/**"],
  },
  textComponents: ["Text"],
});
