import { Suspense, createElement } from "react";
import { RelayEnvironmentProvider } from "react-relay";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  createOperationDescriptor,
  type GraphQLResponse,
} from "relay-runtime";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";

import Query, {
  type EventDetailQuery,
} from "./__generated__/EventDetailQuery.graphql";
import { EventDetail } from "./EventDetail";

const mocks = vi.hoisted(() => ({
  fetchPolicy: vi.fn<() => ConnectivityAwareFetchPolicy>(),
}));

vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ Redirect: "Redirect" }));
vi.mock("react-native", () => ({ View: "View", ScrollView: "ScrollView" }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("react-relay", async (importOriginal) => {
  const relay = await importOriginal<typeof import("react-relay")>();
  const query = (await import("./__generated__/EventDetailQuery.graphql"))
    .default;
  return { ...relay, graphql: () => query };
});
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("@/components/content/RichText", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/content/RichText")>()),
  RichText: "RichText",
}));
vi.mock("@/components/providers/ErrorBoundaryWithRetry", () => ({
  useRetryKey: () => 0,
}));
vi.mock("@/cssInterop", () => ({
  StyledAnimatedScrollView: "ScrollView",
  StyledImage: "Image",
}));
vi.mock("@/hooks/relay/useConnectivityAwareFetchPolicy", () => ({
  useConnectivityAwareFetchPolicy: mocks.fetchPolicy,
}));
vi.mock("@/hooks/useScrollHeaderTitle", () => ({
  useScrollHeaderTitle: () => ({ showHeaderTitle: true }),
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: {} }),
}));
vi.mock("@/ui/Link", () => ({ Link: "Link" }));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));
vi.mock("./EventLayout", () => ({
  EventLayout: "EventLayout",
  EventEmptyState: "EventEmptyState",
}));

const props = {
  slug: "spring-retreat",
  campusSlug: "house-of-stars",
  campusName: "House of Stars",
};

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
let environment: Environment;
let requests: {
  next(value: GraphQLResponse): void;
  complete(): void;
}[];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchPolicy.mockReturnValue("store-and-network");
  requests = [];
  environment = new Environment({
    network: Network.create(() =>
      Observable.create((sink) => {
        requests.push(sink);
      }),
    ),
    store: new Store(new RecordSource()),
  });
  environment.commitPayload(
    createOperationDescriptor(Query, {
      slug: props.slug,
      campusSlug: props.campusSlug,
    }),
    { events: [] },
  );
});

afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
});

async function render() {
  await act(async () => {
    renderer = create(
      <RelayEnvironmentProvider environment={environment}>
        <Suspense
          fallback={createElement("Loading", { testID: "event-loading" })}
        >
          <EventDetail {...props} />
        </Suspense>
      </RelayEnvironmentProvider>,
    );
  });
}

function expectLoadingWithoutRedirect() {
  expect(requests).toHaveLength(1);
  expect(
    renderer!.root.findAllByProps({ testID: "event-loading" }),
  ).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ href: "/" })).toHaveLength(0);
}

async function respond(events: EventDetailQuery["response"]["events"]) {
  await act(async () => {
    requests[0].next({ data: { events } });
    requests[0].complete();
  });
}

test.each([{ events: [] }, { events: null }])(
  "a cached empty result redirects only after the network confirms no event: $events",
  async ({ events }) => {
    await render();
    expectLoadingWithoutRedirect();

    await respond(events);

    expect(renderer!.root.findAllByProps({ href: "/" })).toHaveLength(1);
  },
);

test("an offline cache miss keeps the event unavailable screen without fetching", async () => {
  mocks.fetchPolicy.mockReturnValue("store-only");

  await render();

  expect(requests).toHaveLength(0);
  expect(
    renderer!.root.findAllByProps({ title: "Event unavailable" }),
  ).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ href: "/" })).toHaveLength(0);
});

test("a cached empty result opens event details when the network finds the event", async () => {
  await render();
  expectLoadingWithoutRedirect();

  await respond([
    {
      content: null,
      description: null,
      eventDate: null,
      eventImageUrl: null,
      eventMonth: null,
      eventSpeakers: [],
      eventTime: null,
      eventTitle: "Spring Retreat",
      pageName: "Spring Retreat",
      pageTitle: "Spring Retreat",
      reoccurring: null,
      room: null,
      sessions: [],
      slug: props.slug,
      zoomLink: null,
    },
  ]);

  expect(
    renderer!.root.findAllByProps({ title: "Spring Retreat" }),
  ).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ href: "/" })).toHaveLength(0);
});

test("event content opens as rich text", async () => {
  const content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Join us" }] },
    ],
  };
  await render();

  await respond([
    {
      content,
      description: null,
      eventDate: null,
      eventImageUrl: null,
      eventMonth: null,
      eventSpeakers: [],
      eventTime: null,
      eventTitle: "Spring Retreat",
      pageName: "Spring Retreat",
      pageTitle: "Spring Retreat",
      reoccurring: null,
      room: null,
      sessions: [],
      slug: props.slug,
      zoomLink: null,
    },
  ]);

  const richText = renderer!.root.findAll(
    (node) => String(node.type) === "RichText",
  );
  expect(richText).toHaveLength(1);
  expect(richText[0]?.props.content).toEqual(content);
});

test("a service held more than once a day lists every time", async () => {
  await render();

  await respond([
    {
      content: null,
      description: null,
      eventDate: "2026-10-11T09:00:00.000-04:00",
      eventImageUrl: null,
      eventMonth: null,
      eventSpeakers: [],
      eventTime: null,
      eventTitle: "Sunday Service",
      pageName: "Sunday Service",
      pageTitle: "Sunday Service",
      reoccurring: "Weekly",
      room: null,
      sessions: [
        {
          id: "sunday-service@2026-10-11T13:00:00.000Z",
          startsAt: "2026-10-11T13:00:00.000Z",
          label: "First Service",
        },
        {
          id: "sunday-service@2026-10-11T15:00:00.000Z",
          startsAt: "2026-10-11T15:00:00.000Z",
          label: "Second Service",
        },
      ],
      slug: props.slug,
      zoomLink: null,
    },
  ]);

  const [times] = renderer!.root.findAllByProps({ label: "Times" });
  const lines = String(times?.props.children).split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/ · First Service$/);
  expect(lines[1]).toMatch(/ · Second Service$/);
});

test("a service held once a day keeps its single time", async () => {
  await render();

  await respond([
    {
      content: null,
      description: null,
      eventDate: "2026-10-11T10:00:00.000-04:00",
      eventImageUrl: null,
      eventMonth: null,
      eventSpeakers: [],
      eventTime: null,
      eventTitle: "Sunday Service",
      pageName: "Sunday Service",
      pageTitle: "Sunday Service",
      reoccurring: "Weekly",
      room: null,
      sessions: [
        {
          id: "sunday-service@2026-10-11T14:00:00.000Z",
          startsAt: "2026-10-11T14:00:00.000Z",
          label: "Second Service",
        },
      ],
      slug: props.slug,
      zoomLink: null,
    },
  ]);

  expect(renderer!.root.findAllByProps({ label: "Times" })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ label: "Time" })).toHaveLength(1);
});
