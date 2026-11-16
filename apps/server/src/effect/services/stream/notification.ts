import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { streamNotificationTargets } from "@/effect/services/push/streamAudience";
import { CampusSlugSchema, type CampusSlug } from "@/utils/campuses";
import { Effect, Schema } from "effect";
import { createHash } from "node:crypto";

export interface CampusStreamNotification {
	readonly campusSlug: CampusSlug;
	readonly streamId: string;
	readonly revision: number;
	readonly title: string;
	readonly body: string;
}

/**
 * The live event a stream's notification belongs to, persisted on its
 * `castr-streams` document. An event starts when the stream goes live, ends
 * with a save that leaves nothing live, and continues if the stream is
 * restarted within `RESTART_GRACE_MS`.
 */
export interface StreamEventState {
	readonly eventStartedAt: Date | undefined;
	readonly eventEndedAt: Date | undefined;
	readonly notifiedAt: Date | undefined;
	/** Fingerprint of the title and description of the last notification. */
	readonly notifiedFingerprint: string | undefined;
	readonly revision: number;
}

export interface StreamEventPlan {
	readonly state: StreamEventState;
	readonly notification: CampusStreamNotification | undefined;
}

/** Ending and restarting the stream within this window continues the same event. */
const RESTART_GRACE_MS = 30 * 60_000;
/** A stream that is never turned off starts a new event on the first live save after this. */
const EVENT_WINDOW_MS = 12 * 60 * 60_000;
const NOTIFICATION_BODY = "We're live now. Tap to watch.";
/** Headlines a stream saved without a title, so the headline never repeats the body. */
const UNTITLED_HEADLINE = "Live now";

const normalize = (value: string) => value.normalize("NFC").replaceAll(/\s+/gu, " ").trim();

/** Identifies a title and description, ignoring whitespace and Unicode composition. */
export const detailsFingerprint = (title: string, description: string) =>
	createHash("sha256")
		.update(JSON.stringify([normalize(title), normalize(description)]))
		.digest("hex");

/** A destination's switch as the status poll last stored it from Castr. */
export interface StoredDestination {
	readonly id: string;
	readonly enabled: boolean;
}

/**
 * Whether a save leaves any destination switched on: one Castr accepted turning
 * on, or one the save left alone that is stored as on. Castr's broadcasting
 * status lags a stop, so it does not count.
 */
export const hasDestinationOn = (
	stored: readonly StoredDestination[],
	enabledChanges: ReadonlyMap<string, boolean>,
) =>
	[...enabledChanges.values()].some(Boolean) ||
	stored.some((destination) => !enabledChanges.has(destination.id) && destination.enabled);

const latest = (...instants: readonly (Date | undefined)[]) =>
	new Date(Math.max(...instants.map((instant) => instant?.getTime() ?? Number.NEGATIVE_INFINITY)));

/**
 * Plans one save's effect on the stream's event and decides whether it sends
 * a notification. An event notifies at most once: on its first live save
 * whose title or description differs from the last notification's. A
 * reused title and description wait for the first edit during the event.
 */
export const planStreamEvent = (input: {
	readonly previous: StreamEventState;
	/** Whether anything is live after the save, counting destinations it didn't touch. */
	readonly live: boolean;
	readonly now: Date;
	/** Set only when this campus's stream notifications are enabled. */
	readonly campusSlug: string | undefined;
	readonly streamId: string;
	readonly title: string;
	readonly description: string;
}): StreamEventPlan => {
	const { previous } = input;
	// Concurrent saves can commit out of request order. Keeping time monotonic per
	// stream means a claim is never dated before the event it belongs to.
	const now = latest(
		input.now,
		previous.eventStartedAt,
		previous.eventEndedAt,
		previous.notifiedAt,
	);
	if (!input.live) {
		// Keep the first end so offline edits before the next event don't extend the grace period.
		return {
			state: { ...previous, eventEndedAt: previous.eventEndedAt ?? now },
			notification: undefined,
		};
	}
	// A claim made before events were tracked stands in for the event's start.
	const previousStart = previous.eventStartedAt ?? previous.notifiedAt;
	const startsEvent =
		previousStart === undefined ||
		now.getTime() - previousStart.getTime() >= EVENT_WINDOW_MS ||
		(previous.eventEndedAt !== undefined &&
			now.getTime() - previous.eventEndedAt.getTime() >= RESTART_GRACE_MS);
	const eventStartedAt = startsEvent ? now : previousStart;
	const state: StreamEventState = { ...previous, eventStartedAt, eventEndedAt: undefined };

	const title = normalize(input.title);
	const description = normalize(input.description);
	const details = detailsFingerprint(input.title, input.description);
	const notifiedThisEvent =
		previous.notifiedAt !== undefined && previous.notifiedAt.getTime() >= eventStartedAt.getTime();
	if (
		!Schema.is(CampusSlugSchema)(input.campusSlug) ||
		notifiedThisEvent ||
		(!title && !description) ||
		details === previous.notifiedFingerprint
	) {
		return { state, notification: undefined };
	}
	const revision = previous.revision + 1;
	return {
		state: { ...state, notifiedAt: now, notifiedFingerprint: details, revision },
		notification: {
			campusSlug: input.campusSlug,
			streamId: input.streamId,
			revision,
			title: title || UNTITLED_HEADLINE,
			body: NOTIFICATION_BODY,
		},
	};
};

// A committed claim gets one send attempt per audience. Retrying an ambiguous FCM response
// could deliver the same event twice, so failures are logged rather than replayed.
export const sendCampusStreamNotification = Effect.fn("CampusStreamNotification.send")(function* (
	event: CampusStreamNotification,
	campusDeliveryEnabled: boolean,
) {
	const firebase = yield* FirebaseAdminService;
	const eventId = `${event.streamId}:${event.revision}`;
	const data = {
		type: "campus-stream",
		campusSlug: event.campusSlug,
		streamId: event.streamId,
		eventId,
	};
	yield* Effect.forEach(
		streamNotificationTargets(event.campusSlug, campusDeliveryEnabled),
		(target) =>
			firebase
				.sendMessage({
					...target,
					notification: { title: event.title, body: event.body },
					data,
					// Installed Expo iOS builds read content.data from APNs' body object.
					apns: { payload: { aps: {}, body: data } },
				})
				.pipe(
					Effect.catchTag("FirebaseMessagingError", (error) =>
						Effect.logError("Campus stream notification send failed; claim will not be replayed", {
							eventId,
							campusSlug: event.campusSlug,
							errorTag: error._tag,
						}),
					),
				),
		{ discard: true },
	);
});
