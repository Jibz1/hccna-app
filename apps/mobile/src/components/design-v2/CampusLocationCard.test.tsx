import { Schema } from "effect";
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  CAMPUS_LEAD_INTERVAL_MS,
  CAMPUS_LEAD_STAGGER_MS,
  type CampusLeadPlayback,
} from "@/hooks/useCampusLeadCycle";
import type { CampusData } from "@/relay/campuses";

import { CampusLocationCard } from "./CampusLocationCard";

vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("react-native-reanimated", () => {
  const animation = {
    duration: () => animation,
    reduceMotion: () => animation,
  };
  return {
    default: { View: "AnimatedView" },
    FadeInUp: animation,
    FadeOutUp: animation,
    ReduceMotion: { System: "system" },
  };
});
vi.mock("@/components/design-v2/CampusCard", () => ({
  CampusCard: "CampusCard",
}));
vi.mock("@/components/live/LiveStreamIndicator", () => ({
  LiveStreamIndicator: "LiveStreamIndicator",
}));
vi.mock("@/cssInterop", () => ({ StyledImage: "Image" }));
// The cycle module's playback hook (not used by the card) imports native worklets.
vi.mock("@/hooks/useCarouselAutoplay", () => ({
  useCarouselAutoplay: () => ({ autoplay: true, onLayout: vi.fn() }),
}));
vi.mock("@/hooks/events/useCampusLiveStatus", () => ({
  useCampusLiveStatus: () => false,
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: {} }),
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

const lead = (name: string) => ({
  name,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  image: `https://img.example/${name.toLowerCase().replaceAll(" ", "-")}.jpg`,
  subTitle: null,
  leadershipGroup: null,
});

const campus = (campusLeads: ReturnType<typeof lead>[]): CampusData => ({
  slug: "house-of-stars",
  campusName: "House of Stars",
  location: "Springfield, NJ",
  cityState: "Springfield, NJ",
  campusLead: campusLeads[0] ?? null,
  campusLeads,
  content: null,
  facebook: null,
  giving: null,
  givingPlatforms: null,
  image: null,
  instagram: null,
  isPreferred: false,
  streamLink: null,
});

const TWO_LEADS = [lead("Alex Rivera"), lead("Sam Rivera")];

function render(
  value: CampusData,
  leadPlayback: CampusLeadPlayback,
  staggerOrder = 0,
  isPreferred = false,
) {
  act(() => {
    const card = createElement(CampusLocationCard, {
      campus: value,
      isPreferred,
      isSingleColumn: false,
      leadPlayback,
      staggerOrder,
    });
    if (renderer) {
      renderer.update(card);
    } else {
      renderer = create(card);
    }
  });
  if (renderer === undefined) {
    throw new Error("CampusLocationCard did not render");
  }
  return renderer.root;
}

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const isString = Schema.is(Schema.String);
const shownText = (node: ReactTestInstance | string): string =>
  isString(node) ? node : node.children.map(shownText).join("");
const cyclingName = (root: ReactTestInstance) =>
  root.findAll((node) => String(node.type) === "AnimatedView").map(shownText);
const avatars = (root: ReactTestInstance) =>
  root.findAll(
    (node) =>
      String(node.type) === "View" &&
      String(node.props.className ?? "").includes("h-7 w-7"),
  );
const classesOf = (node: ReactTestInstance | null | undefined) =>
  String(node?.props.className ?? "");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

test("shows one lead name at a time, moving on after the card's stagger", () => {
  const value = campus(TWO_LEADS);
  const root = render(value, "playing", 1);
  expect(cyclingName(root)).toEqual(["Alex Rivera"]);

  advance(CAMPUS_LEAD_STAGGER_MS * 2 - 1);
  expect(cyclingName(root)).toEqual(["Alex Rivera"]);
  advance(1);
  expect(cyclingName(root)).toEqual(["Sam Rivera"]);

  advance(CAMPUS_LEAD_INTERVAL_MS);
  expect(cyclingName(root)).toEqual(["Alex Rivera"]);
});

test("puts the active lead on top of a tight avatar stack, with the ring", () => {
  const root = render(campus(TWO_LEADS), "playing");
  advance(CAMPUS_LEAD_STAGGER_MS);

  const [first, second] = avatars(root);
  expect(classesOf(second)).toContain("z-10");
  expect(classesOf(second)).toContain("border-design-accent");
  expect(classesOf(second)).toContain("-ml-5");
  expect(classesOf(first)).not.toContain("z-10");
  expect(classesOf(first)).not.toContain("border-design-accent");
});

test("shows the Leads label and the name beside the avatars", () => {
  const root = render(campus(TWO_LEADS), "playing");

  const row = avatars(root)[0]?.parent?.parent;
  expect(classesOf(row)).toMatch(/(^| )gap-1( |$)/u);
  expect(row?.findAll((node) => shownText(node) === "Leads")).not.toEqual([]);
  expect(shownText(row ?? "")).toContain("Alex Rivera");
});

test("marks the preferred campus with a check on the avatars, leaving the name its width", () => {
  const root = render(campus(TWO_LEADS), "playing", 0, true);

  const stack = avatars(root)[0]?.parent;
  const checks = root.findAll(
    (node) => String(node.type) === "Icon" && node.props.name === "check",
  );
  expect(checks).toHaveLength(1);
  expect(stack?.findAll((node) => node === checks[0])).toHaveLength(1);
});

test("hides the changing name from screen readers; the card hint names every lead", () => {
  const root = render(campus(TWO_LEADS), "playing");

  const hidden = root.findAll(
    (node) => node.props.accessibilityElementsHidden === true,
  );
  expect(hidden.some((node) => shownText(node) === "Alex Rivera")).toBe(true);
  expect(
    root.find((node) => String(node.type) === "CampusCard").props
      .accessibilityHint,
  ).toContain("Campus leads, Alex Rivera & Sam Rivera.");
});

test("lists every lead together when motion is reduced", () => {
  const root = render(campus(TWO_LEADS), "still");

  expect(cyclingName(root)).toEqual([]);
  expect(root.findAll((node) => shownText(node) === "Leads")).not.toEqual([]);
  expect(shownText(root)).toContain("Alex Rivera & Sam Rivera");
  expect(vi.getTimerCount()).toBe(0);
});

test("holds the current name while Home is hidden", () => {
  const value = campus(TWO_LEADS);
  render(value, "playing");
  advance(CAMPUS_LEAD_STAGGER_MS);

  const root = render(value, "paused");
  advance(CAMPUS_LEAD_INTERVAL_MS * 3);

  expect(cyclingName(root)).toEqual(["Sam Rivera"]);
  expect(vi.getTimerCount()).toBe(0);
});

test("does not animate a campus with one lead", () => {
  const root = render(campus([lead("Morgan Ellis")]), "playing");

  expect(cyclingName(root)).toEqual([]);
  expect(root.findAll((node) => shownText(node) === "Lead")).not.toEqual([]);
  expect(shownText(root)).toContain("Morgan Ellis");
  expect(vi.getTimerCount()).toBe(0);
});
