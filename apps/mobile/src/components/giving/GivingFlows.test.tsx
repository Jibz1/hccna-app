import { createElement, type ReactNode, StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import YearlyGivingModalScreen from "@/app/yearly-giving-modal";
import { MyGiving } from "@/components/giving/MyGiving";
import type { YearlyGiving } from "@/relay/userData";

const mocks = vi.hoisted(() => ({
  profile: { ccbId: "person", ccbFamilyId: "family" } as {
    ccbId: string;
    ccbFamilyId: string;
  } | null,
  years: [] as readonly YearlyGiving[],
  year: "2026",
  setParams: vi.fn(),
  navigate: vi.fn(),
  appListeners: new Set<(state: string) => void>(),
  exportHook: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("react-native", () => ({
  View: "View",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  ActivityIndicator: "ActivityIndicator",
  Platform: { OS: "ios" },
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.appListeners.add(listener);
      return { remove: () => mocks.appListeners.delete(listener) };
    },
  },
}));
vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
  useLocalSearchParams: () => ({ year: mocks.year }),
  router: { setParams: mocks.setParams },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({
    colors: {},
    backgroundGradient: ["#fff", "#fff"],
  }),
}));
vi.mock("@/components/providers/ErrorBoundaryWithRetry", () => ({
  ErrorBoundaryWithRetry: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/hooks/relay/useUserData", () => ({
  useUserProfile: () => mocks.profile,
  useGivingHistory: () => ({
    years: mocks.years,
    status: "success",
    retry: vi.fn(),
    isRefreshing: false,
  }),
}));
vi.mock("@/hooks/giving/useExportMyYearlyGiving", () => ({
  useExportYearGiving: (
    year:
      | import("@/hooks/giving/useExportMyYearlyGiving").YearGivingData
      | null
      | undefined,
  ) => {
    mocks.exportHook(year);
    return { mutate: mocks.mutate, isPending: false, error: null };
  },
}));
vi.mock("@/components/giving/AnimatedGivingAmount", () => ({
  AnimatedGivingAmount: "Amount",
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));
vi.mock("@/ui/AnimatedCounter", () => ({ AnimatedCounter: "Counter" }));
vi.mock("@/cssInterop", () => ({
  StyledLinearGradient: "Gradient",
  StyledLegendList: "List",
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
const currentYear = new Date().getFullYear();

function givingYear(year: number, total = 500): YearlyGiving {
  const donation = {
    amount: total,
    date: `${year}-07-26`,
    name: "Tithe",
    transactionId: "transaction",
    campus: null,
    campusId: null,
    paymentType: "Online",
    taxDeductible: true,
  };
  return {
    year,
    ccbId: "person",
    total,
    numberOfGiving: 1,
    giving: [donation],
    groupGivingByMonth: [
      { month: "July", number: 1, total, givingList: [donation] },
    ],
  };
}

function render() {
  act(() => {
    renderer = create(createElement(YearlyGivingModalScreen));
  });
}
function button(label: string) {
  return renderer.root.findByProps({ accessibilityLabel: label });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile = { ccbId: "person", ccbFamilyId: "family" };
  mocks.years = [givingYear(currentYear), givingYear(currentYear - 1, 250)];
  mocks.year = String(currentYear);
});
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  expect(mocks.appListeners.size).toBe(0);
  if (vi.isFakeTimers()) {
    const pendingTimers = vi.getTimerCount();
    vi.useRealTimers();
    expect(pendingTimers).toBe(0);
  }
});

test("switches the details, activity and export data together when the year changes", () => {
  render();
  act(() => {
    button(`Show ${currentYear - 1} giving`).props.onPress();
  });
  expect(mocks.setParams).toHaveBeenCalledWith({
    year: String(currentYear - 1),
  });
  mocks.year = String(currentYear - 1);
  act(() => {
    renderer.update(createElement(YearlyGivingModalScreen));
  });
  expect(mocks.exportHook).toHaveBeenLastCalledWith(mocks.years[1]);
  expect(renderer.root.findByType("List" as React.ElementType).props.data).toBe(
    mocks.years[1]?.groupGivingByMonth,
  );
  act(() => {
    button(`Export ${currentYear - 1} giving statement`).props.onPress();
  });
  expect(mocks.mutate).toHaveBeenCalledOnce();
});

test("does not expose retained giving details or exports after the profile is gone", () => {
  mocks.profile = null;
  render();
  expect(mocks.exportHook).toHaveBeenLastCalledWith(undefined);
  expect(renderer.root.findAllByType("List" as React.ElementType)).toHaveLength(
    0,
  );
  expect(
    renderer.root.findAllByProps({
      accessibilityLabel: `Export ${currentYear} giving statement`,
    }),
  ).toHaveLength(0);
});

test.each(["midnight", "resume"])(
  "refreshes the summary and modal year on %s with both years already cached",
  (trigger) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59, 500));
    mocks.years = [givingYear(2027, 700), givingYear(2026, 500)];
    act(() => {
      renderer = create(
        createElement(StrictMode, null, createElement(MyGiving)),
      );
    });
    expect(
      renderer.root.findByType("Amount" as React.ElementType).props.value,
    ).toBe(500);
    expect(
      renderer.root
        .findAllByType("Text" as React.ElementType)
        .some((text) => text.props.children === 2026),
    ).toBe(true);

    if (trigger === "resume") {
      act(() => {
        mocks.appListeners.forEach((listener) => {
          listener("background");
        });
      });
      // Simulate suspended timers: move the clock without running callbacks.
      vi.setSystemTime(new Date(2027, 0, 1, 10));
      act(() => {
        mocks.appListeners.forEach((listener) => {
          listener("active");
        });
      });
    } else {
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }

    expect(
      renderer.root.findByType("Amount" as React.ElementType).props.value,
    ).toBe(700);
    expect(
      renderer.root
        .findAllByType("Text" as React.ElementType)
        .some((text) => text.props.children === 2027),
    ).toBe(true);
    act(() => {
      button("View 2027 giving details").props.onPress();
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: "/yearly-giving-modal",
      params: { year: 2027 },
    });
    expect(mocks.appListeners.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  },
);
