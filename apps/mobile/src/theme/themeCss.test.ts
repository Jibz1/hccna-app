import { expect, it } from "vitest";

import { renderThemeCss } from "./themeCss";

import css from "./tokens.css?raw";

it("keeps native and Tailwind palettes in sync", () => {
  // Formatting can change independently of generated declarations.
  expect(css.replace(/\s+/g, "")).toBe(renderThemeCss().replace(/\s+/g, ""));
});
