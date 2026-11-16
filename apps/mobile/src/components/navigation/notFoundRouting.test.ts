import { beforeEach, expect, test, vi } from "vitest";

import { redirectSystemPath } from "@/app/+native-intent";
import NotFoundRoute from "@/app/+not-found";
import EventPageRoute from "@/app/news-and-events/[eventSlug]";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  canGoBack: vi.fn(() => false),
  back: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("expo-router", () => ({
  Redirect: "Redirect",
  useRouter: () => navigation,
  useLocalSearchParams: () => Object.fromEntries(navigation.params),
}));
vi.mock("./NotFoundScreen", () => ({ NotFoundScreen: "NotFoundScreen" }));

beforeEach(() => {
  navigation.params = new URLSearchParams();
  vi.clearAllMocks();
  navigation.canGoBack.mockReturnValue(false);
});

test.each([true, false])(
  "unknown incoming links redirect Home (initial: %s)",
  (initial) => {
    const path = redirectSystemPath({
      path: "https://hccnj.org/a-page-that-does-not-exist",
      initial,
    });
    navigation.params = new URL(path).searchParams;

    const result = NotFoundRoute();
    expect(result.type).toBe("Redirect");
    expect(result.props.href).toBe("/");
  },
);

test.each([
  "/locations/house-of-stars",
  "https://hccnj.org/locations/house-of-stars?ref=website#visit",
  "hccna://campus-modal?slug=house-of-stars",
  "https://hccnj.org/news-and-events/spring-retreat?ref=website#schedule",
  "/event-modal?slug=test%20event#details",
])("incoming links preserve their destination and parameters: %s", (path) => {
  const before = new URL(path, "https://hccnj.org");
  const after = new URL(
    redirectSystemPath({ path, initial: false }),
    "https://hccnj.org",
  );
  expect(after.searchParams.get("incomingLink")).toBe("1");
  after.searchParams.delete("incomingLink");
  before.searchParams.sort();
  after.searchParams.sort();
  expect(after.href).toBe(before.href);
});

test("Go back falls back to Home when history is empty", () => {
  const result = NotFoundRoute();

  expect(result.type).toBe("NotFoundScreen");
  result.props.onGoBack();
  expect(navigation.replace).toHaveBeenCalledWith("/");
  expect(navigation.back).not.toHaveBeenCalled();
});

test("an in-app miss allows returning to the previous screen", () => {
  navigation.canGoBack.mockReturnValue(true);

  const result = NotFoundRoute();
  result.props.onGoBack();

  expect(navigation.back).toHaveBeenCalledOnce();
  expect(navigation.replace).not.toHaveBeenCalled();
});

test("website event links open the matching event detail", () => {
  navigation.params.set("eventSlug", "spring-retreat");
  navigation.params.set("incomingLink", "1");

  const result = EventPageRoute();

  expect(result.type).toBe("Redirect");
  expect(result.props.href).toEqual({
    pathname: "/event-modal",
    params: { slug: "spring-retreat" },
  });
});

test.each(["", "   "])("an empty event slug goes Home: %j", (slug) => {
  navigation.params.set("eventSlug", slug);

  expect(EventPageRoute().props.href).toBe("/");
});
