import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { SavedVerseDraft } from "./savedVersesStore";
import { SaveVerseButton } from "./SaveVerseButton";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  push: vi.fn(),
  save: vi.fn<(verse: SavedVerseDraft) => Promise<void>>(),
  remove: vi.fn<(verseId: string) => Promise<void>>(),
  savedVerses: {
    isSignedIn: true,
    verses: [] as { verseId: string }[],
  },
}));

vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  Pressable: "Pressable",
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));
vi.mock("./useSavedVerses", () => ({
  useSavedVerses: () => mocks.savedVerses,
}));
vi.mock("./useSavedVerseActions", () => ({
  useSavedVerseActions: () => ({
    save: mocks.save,
    remove: mocks.remove,
    isPending: false,
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
const onFeedback = vi.fn<(message: string | null) => void>();
const psalm = {
  verseId: "doc-psalm",
  book: "Psalm 23:1",
  text: "The Lord is my shepherd.",
  image: "https://images.example/psalm.png",
};

function render(props: Partial<ComponentProps<typeof SaveVerseButton>> = {}) {
  act(() => {
    renderer = create(
      createElement(SaveVerseButton, {
        verse: psalm,
        kind: "word-of-activation",
        onFeedback,
        ...props,
      }),
    );
  });
}

function button() {
  return renderer!.root.findByProps({ accessibilityRole: "button" });
}

async function press() {
  await act(async () => {
    button().props.onPress();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockReset().mockResolvedValue();
  mocks.remove.mockReset().mockResolvedValue();
  mocks.savedVerses = { isSignedIn: true, verses: [] };
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

test("asks guests to sign in instead of saving", async () => {
  mocks.savedVerses = { isSignedIn: false, verses: [] };
  render();

  await press();

  expect(button().props.accessibilityLabel).toBe("Sign in to save this verse");
  expect(mocks.push).toHaveBeenCalledWith("/account-modal-stack");
  expect(mocks.save).not.toHaveBeenCalled();
});

test("saves the displayed verse to the account", async () => {
  render();

  await press();

  expect(mocks.save).toHaveBeenCalledWith({
    verseId: "doc-psalm",
    kind: "WORD_OF_ACTIVATION",
    book: "Psalm 23:1",
    text: "The Lord is my shepherd.",
    image: "https://images.example/psalm.png",
  });
  expect(onFeedback).toHaveBeenCalledWith("Saved to your account");
});

test("removes a verse that is already saved", async () => {
  mocks.savedVerses = { isSignedIn: true, verses: [{ verseId: "doc-psalm" }] };
  render();

  await press();

  expect(button().props.accessibilityState).toEqual({ selected: true });
  expect(mocks.remove).toHaveBeenCalledWith("doc-psalm");
  expect(onFeedback).toHaveBeenCalledWith("Removed from saved verses");
});

test("explains a failed save and clears the optimistic feedback", async () => {
  mocks.save.mockRejectedValueOnce(
    new Error("You've saved the most verses you can save."),
  );
  render();

  await press();

  expect(mocks.alert).toHaveBeenCalledWith(
    "Unable to save verse",
    "You've saved the most verses you can save.",
  );
  expect(onFeedback).toHaveBeenLastCalledWith(null);
});

test("offers nothing for a verse without a catalog ID", () => {
  render({ verse: { ...psalm, verseId: null } });

  expect(renderer!.toJSON()).toBeNull();
});
