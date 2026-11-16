import type { ElementType } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";

import { Card } from "./Card";

vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

// Uniwind 1.13 resolves conflicting utilities by stylesheet order, not className order, so an
// override only wins when the variant's conflicting class is gone (the event agenda's surface
// cards rendered transparent).
test("a className background replaces the variant's background", () => {
  act(() => {
    renderer = create(
      <Card variant="transparent" className="bg-design-surface">
        Row
      </Card>,
    );
  });

  const classes = renderer!.root
    .findAllByType("View" as ElementType)[0]
    .props.className.split(" ");
  expect(classes).toContain("bg-design-surface");
  expect(classes).not.toContain("bg-transparent");
  expect(classes).toContain("border-transparent");
});
