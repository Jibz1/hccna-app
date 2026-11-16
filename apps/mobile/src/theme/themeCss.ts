import { darkTheme, lightTheme, spacing, type ScreenTheme } from "./tokens";

function declarations(theme: ScreenTheme, indent: string) {
  const colors = Object.entries(theme.colors).map(([name, value]) => {
    const token = name.replace(
      /[A-Z]/g,
      (letter) => `-${letter.toLowerCase()}`,
    );
    return `${indent}--color-design-${token}: ${value};`;
  });

  return [
    ...colors,
    `${indent}--color-background-surface: ${theme.surfaces.card};`,
    `${indent}--color-background-surface-muted: ${theme.surfaces.muted};`,
  ].join("\n");
}

export function renderThemeCss() {
  const spacingDeclarations = Object.entries(spacing)
    .map(([name, value]) => `  --spacing-${name}: ${value}px;`)
    .join("\n");
  return `/* Generated from tokens.ts by bun run theme:generate. Do not edit. */

@theme {
${spacingDeclarations}

${declarations(darkTheme, "  ")}
}

@layer theme {
  :root {
    @variant dark {
${declarations(darkTheme, "      ")}
    }

    @variant light {
${declarations(lightTheme, "      ")}
    }
  }
}
`;
}
