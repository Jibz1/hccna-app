import { cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

const FONT_SIZE_KEYS = [
  "heading-xl",
  "heading-lg",
  "heading",
  "heading-sm",
  "heading-xs",
  "label-xl",
  "label-lg",
  "label",
  "label-sm",
  "label-xs",
  "label-xxs",
  "label-xxxs",
  "p-xl",
  "p-lg",
  "p",
  "p-sm",
  "p-xs",
  "caption-sm",
  "caption",
  "body",
  "body-lg",
  "title",
  "feature-title",
  "title-lg",
  "screen-title",
  "scripture",
];

const customTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": FONT_SIZE_KEYS.map((fontSizeKey) => `text-${fontSizeKey}`),
    },
  },
});

export function cn(...inputs: Parameters<typeof cx>) {
  return customTwMerge(cx(inputs));
}
