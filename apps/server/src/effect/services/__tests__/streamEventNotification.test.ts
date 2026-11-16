import { planStreamEvent, type StreamEventState } from "@/effect/services/stream/notification";
import { describe, expect, it } from "bun:test";

const minutes = (count: number) => count * 60_000;
const hours = (count: number) => minutes(count * 60);
const at = (offsetMs: number) => new Date(Date.UTC(2026, 9, 14, 23, 0) + offsetMs);

const NEVER_LIVE: StreamEventState = {
	eventStartedAt: undefined,
	eventEndedAt: undefined,
	notifiedAt: undefined,
	notifiedFingerprint: undefined,
	revision: 0,
};

interface Save {
	readonly live: boolean;
	readonly after: number;
	readonly title?: string;
	readonly description?: string;
	readonly campusSlug?: string | undefined;
}

/** Replays saves against one stream, persisting each plan's state like the transaction does. */
const replay = (saves: readonly Save[], initial: StreamEventState = NEVER_LIVE) => {
	let state = initial;
	const notifications = [];
	for (const save of saves) {
		const plan = planStreamEvent({
			previous: state,
			live: save.live,
			now: at(save.after),
			campusSlug: "campusSlug" in save ? save.campusSlug : "new-breed",
			streamId: "stream-1",
			title: save.title ?? "Galatians III | Refresh | Oct 14th",
			description: save.description ?? "Follow us on social media",
		});
		const { notification } = plan;
		({ state } = plan);
		if (notification) {
			notifications.push(notification);
		}
	}
	return { state, notifications };
};

describe("planStreamEvent", () => {
	it("notifies once when a stream goes live with new details", () => {
		const { notifications } = replay([{ live: true, after: 0 }]);

		expect(notifications).toEqual([
			{
				campusSlug: "new-breed",
				streamId: "stream-1",
				revision: 1,
				title: "Galatians III | Refresh | Oct 14th",
				body: "We're live now. Tap to watch.",
			},
		]);
	});

	it("notifies a new event whose title changed and whose description did not", () => {
		const { notifications } = replay([
			{ live: true, after: 0, title: "Galatians II" },
			{ live: false, after: hours(2), title: "Galatians II" },
			{ live: true, after: hours(24 * 7), title: "Galatians III" },
		]);

		expect(notifications.map((notification) => notification.title)).toEqual([
			"Galatians II",
			"Galatians III",
		]);
	});

	it("notifies a new event whose description changed and whose title did not", () => {
		const { notifications } = replay([
			{ live: true, after: 0, description: "Week one" },
			{ live: false, after: hours(2), description: "Week one" },
			{ live: true, after: hours(24 * 7), description: "Week two" },
		]);

		expect(notifications).toHaveLength(2);
	});

	it("sends one notification per event however often the details are corrected", () => {
		const { notifications } = replay([
			{ live: true, after: 0, title: "Galatins III" },
			{ live: true, after: minutes(3), title: "Galatians III" },
			{ live: true, after: minutes(40), description: "Updated giving link" },
			{ live: true, after: hours(2), title: "Galatians III (replay)" },
		]);

		expect(notifications).toHaveLength(1);
	});

	it("notifies when details saved while offline go live in a later save", () => {
		const lastWeek = replay([
			{ live: true, after: 0, title: "Galatians II" },
			{ live: false, after: hours(2), title: "Galatians II" },
		]).state;

		const { notifications } = replay(
			[
				{ live: false, after: hours(24 * 7 - 1), title: "Galatians III" },
				{ live: true, after: hours(24 * 7), title: "Galatians III" },
			],
			lastWeek,
		);

		expect(notifications.map((notification) => notification.title)).toEqual(["Galatians III"]);
	});

	it("treats a restart within the grace period as the same event", () => {
		const { notifications } = replay([
			{ live: true, after: 0 },
			{ live: false, after: minutes(30) },
			{ live: true, after: minutes(35), title: "Fixed the title after a restart" },
			{ live: true, after: hours(2), title: "Fixed it again" },
		]);

		expect(notifications).toHaveLength(1);
	});

	it("starts a new event when the stream goes live after being ended past the grace period", () => {
		const { notifications } = replay([
			{ live: true, after: 0, title: "Morning prayer" },
			{ live: false, after: hours(1), title: "Morning prayer" },
			{ live: false, after: hours(8), title: "Evening service" },
			{ live: true, after: hours(9), title: "Evening service" },
		]);

		expect(notifications.map((notification) => notification.title)).toEqual([
			"Morning prayer",
			"Evening service",
		]);
	});

	it("starts a new event when a stream left live is saved again after twelve hours", () => {
		const { notifications } = replay([
			{ live: true, after: 0, title: "Sunday service" },
			{ live: true, after: hours(11), title: "Sunday service, edited" },
			{ live: true, after: hours(24 * 7), title: "Next Sunday service" },
		]);

		expect(notifications.map((notification) => notification.title)).toEqual([
			"Sunday service",
			"Next Sunday service",
		]);
	});

	it("waits for a details change when an event reuses the last notified title and description", () => {
		const { notifications } = replay([
			{ live: true, after: 0, title: "Sunday service" },
			{ live: false, after: hours(2), title: "Sunday service" },
			{ live: true, after: hours(24 * 7), title: "Sunday service" },
			{ live: true, after: hours(24 * 7) + minutes(4), title: "Sunday service: Galatians" },
			{ live: true, after: hours(24 * 7) + minutes(9), title: "Sunday service: Galatians 3" },
		]);

		expect(notifications.map((notification) => notification.title)).toEqual([
			"Sunday service",
			"Sunday service: Galatians",
		]);
	});

	it("keeps one notification per event when concurrent saves commit out of timestamp order", () => {
		const lastWeek = replay([
			{ live: true, after: 0, title: "Sunday service" },
			{ live: false, after: hours(2), title: "Sunday service" },
		]).state;
		const service = hours(24 * 7);

		const { notifications } = replay(
			[
				// Two phones save together; the later timestamp commits first.
				{ live: true, after: service + 2000, title: "Sunday service" },
				{ live: true, after: service + 1000, title: "Sunday service: Galatians" },
				{ live: true, after: service + 3000, title: "Sunday service: Galatians 3" },
			],
			lastWeek,
		);

		expect(notifications.map((notification) => notification.title)).toEqual([
			"Sunday service: Galatians",
		]);
	});

	it("ignores whitespace, line ending and Unicode composition differences", () => {
		const { notifications } = replay([
			{ live: true, after: 0, title: "Café night", description: "Line one\nLine two" },
			{ live: false, after: hours(2) },
			{
				live: true,
				after: hours(24 * 7),
				title: "  Café   night ",
				description: "Line one\r\nLine two\n",
			},
		]);

		expect(notifications).toHaveLength(1);
	});

	it("does not notify saves that leave the stream offline", () => {
		const { notifications, state } = replay([
			{ live: false, after: 0 },
			{ live: false, after: minutes(5), title: "Draft title" },
		]);

		expect(notifications).toEqual([]);
		expect(state.notifiedFingerprint).toBeUndefined();
	});

	it("tracks the event without notifying when the campus is not eligible", () => {
		const { notifications } = replay([
			{ live: true, after: 0, campusSlug: undefined },
			{ live: true, after: minutes(10), campusSlug: "joseph-siju", title: "Edited" },
			{ live: true, after: minutes(20), title: "Edited again" },
		]);

		expect(notifications.map((notification) => notification.title)).toEqual(["Edited again"]);
	});

	it("does not notify when the title and description are blank", () => {
		const { notifications } = replay([{ live: true, after: 0, title: " ", description: "" }]);

		expect(notifications).toEqual([]);
	});

	it("gives a stream saved without a title its own headline", () => {
		const { notifications } = replay([{ live: true, after: 0, title: " " }]);

		expect(notifications).toEqual([
			expect.objectContaining({ title: "Live now", body: "We're live now. Tap to watch." }),
		]);
	});

	it("keeps a notification claimed before event tracking as the current event", () => {
		const legacy: StreamEventState = { ...NEVER_LIVE, notifiedAt: at(0), revision: 11 };

		const { notifications } = replay(
			[
				{ live: true, after: minutes(30), title: "Corrected mid-service" },
				{ live: true, after: hours(24 * 7), title: "Next week" },
			],
			legacy,
		);

		expect(notifications).toEqual([expect.objectContaining({ title: "Next week", revision: 12 })]);
	});
});
