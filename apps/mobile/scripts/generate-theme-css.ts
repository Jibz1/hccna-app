import { writeFileSync } from "node:fs";

import { renderThemeCss } from "../src/theme/themeCss";

writeFileSync(
  new URL("../src/theme/tokens.css", import.meta.url),
  renderThemeCss(),
);
