import { Option, Schema } from "effect";
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { RichDocument, RichText } from "./RichText";

const mocks = vi.hoisted(() => ({
  openURL: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("react-native", () => ({
  Linking: { openURL: mocks.openURL },
  View: "View",
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

const text = (
  value: string,
  marks?: RichDocument["content"][number]["marks"],
) =>
  marks === undefined
    ? { type: "text", text: value }
    : { type: "text", text: value, marks };
const paragraph = (...content: RichDocument["content"]) => ({
  type: "paragraph",
  content,
});
const item = (...content: RichDocument["content"]) => ({
  type: "listItem",
  content,
});
const doc = (...content: RichDocument["content"]): RichDocument => ({
  type: "doc",
  content,
});

function render(content: RichDocument) {
  act(() => {
    renderer = create(createElement(RichText, { content }));
  });
  if (renderer === undefined) {
    throw new Error("RichText did not render");
  }
  return renderer.root;
}

const isString = Schema.is(Schema.String);

/** Every string the tree shows, in order. */
const shownText = (node: ReactTestInstance | string): string =>
  isString(node) ? node : node.children.map(shownText).join("");

// The unsafe scheme these tests check is never opened or rendered as an image.
// oxlint-disable-next-line no-script-url
const UNSAFE_URL = "javascript:alert(1)";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("decodes the server's document and rejects anything else", () => {
  const value = doc(paragraph(text("Welcome")));
  expect(
    Option.getOrNull(Schema.decodeUnknownOption(RichDocument)(value)),
  ).toEqual(value);
  expect(
    Option.isNone(Schema.decodeUnknownOption(RichDocument)({ blocks: [] })),
  ).toBe(true);
  expect(Option.isNone(Schema.decodeUnknownOption(RichDocument)(null))).toBe(
    true,
  );
});

test("renders paragraphs with bold and linked text", () => {
  const root = render(
    doc(
      paragraph(
        text("Hello "),
        text("world", [{ type: "bold" }]),
        text(" and "),
        text("our site", [
          { type: "link", attrs: { href: "https://hccnj.org" } },
        ]),
      ),
    ),
  );

  expect(shownText(root)).toBe("Hello world and our site");
  const bold = root.findAll(
    (node) =>
      node.props.variant === "labelXs/bold" && shownText(node) === "world",
  );
  expect(bold).toHaveLength(1);
  const link = root.find(
    (node) => node.props.underline === true && shownText(node) === "our site",
  );
  act(() => {
    link.props.onPress();
  });
  expect(mocks.openURL).toHaveBeenCalledWith("https://hccnj.org");
});

test("does not make links with unsafe schemes pressable", () => {
  const root = render(
    doc(
      paragraph(
        text("tap me", [{ type: "link", attrs: { href: UNSAFE_URL } }]),
      ),
    ),
  );

  expect(root.findAll((node) => node.props.onPress !== undefined)).toEqual([]);
});

test("renders nested bullet and numbered lists", () => {
  const root = render(
    doc({
      type: "bulletList",
      content: [
        item(paragraph(text("Sunday")), {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            item(paragraph(text("9am"))),
            item(paragraph(text("11am"))),
          ],
        }),
        item(paragraph(text("Wednesday"))),
      ],
    }),
  );

  expect(shownText(root)).toBe("•Sunday3.9am4.11am•Wednesday");
});

test("shows whether task items are done", () => {
  const root = render(
    doc({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [paragraph(text("Pray"))],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [paragraph(text("Read"))],
        },
      ],
    }),
  );

  expect(shownText(root)).toBe("☑Pray☐Read");
});

test("renders headings, line breaks and the children of unknown nodes", () => {
  const root = render(
    doc(
      {
        type: "heading",
        attrs: { level: 2 },
        content: [text("Service Times")],
      },
      paragraph(text("Sunday"), { type: "hardBreak" }, text("Wednesday")),
      { type: "mysteryWidget", content: [paragraph(text("inside"))] },
    ),
  );

  expect(shownText(root)).toBe("Service TimesSunday\nWednesdayinside");
  expect(
    root.findAll((node) => node.props.accessibilityRole === "header"),
  ).toHaveLength(1);
});

test("shows media figures with safe image URLs and their captions", () => {
  const root = render(
    doc(
      {
        type: "mediaFigure",
        attrs: { src: "https://img.example/choir.jpg", alt: "Choir" },
        content: [text("Choir")],
      },
      { type: "mediaFigure", attrs: { src: UNSAFE_URL } },
    ),
  );

  const images = root.findAll((node) => String(node.type) === "Image");
  expect(images).toHaveLength(1);
  expect(images[0]?.props.source).toEqual({
    uri: "https://img.example/choir.jpg",
  });
  expect(shownText(root)).toBe("Choir");
});
