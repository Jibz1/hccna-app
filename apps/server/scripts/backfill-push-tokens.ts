// One-off backfill: copy legacy anonymousPushTokens docs into the pushTokens
// registry. Idempotent (skips tokens already registered) and dry-run by
// default; pass --execute to write. Does not delete the legacy collection.
import { AppCollections, db, dbFieldValue } from "@/utils/firebase";
import { NotificationTopic } from "@/utils/messages";
import { omitUndefined } from "@/utils/omitUndefined";
import { Predicate } from "effect";

const LEGACY_COLLECTION = "anonymousPushTokens";
const execute = process.argv.includes("--execute");

const isAlreadyExists = (cause: unknown): boolean =>
	Predicate.isObject(cause) &&
	cause !== null &&
	"code" in cause &&
	(cause.code === 6 || cause.code === "already-exists");

const snapshot = await db.collection(LEGACY_COLLECTION).get();
let migrated = 0;
let skipped = 0;
let invalid = 0;

const migrateDoc = async (
	doc: (typeof snapshot.docs)[number],
): Promise<"migrated" | "skipped" | "invalid"> => {
	const data = doc.data();
	const token = Predicate.isString(data.token) && data.token.length > 0 ? data.token : doc.id;

	if (!token || token.includes("/")) {
		console.warn(`[invalid] skipping doc ${doc.id}: unusable token`);
		return "invalid";
	}

	const targetRef = db.collection(AppCollections.pushTokens).doc(token);
	// Legacy registrations were only ever subscribed to the announcement topic
	// (the old sendBroadcast ignored channels), so migrate exactly that — never
	// legacy `channel` values FCM was never told about.
	const payload = omitUndefined({
		token,
		topics: [NotificationTopic],
		userId: Predicate.isString(data.userId) && data.userId.length > 0 ? data.userId : undefined,
		createdAt: data.createdAt ?? dbFieldValue.serverTimestamp(),
		updatedAt: dbFieldValue.serverTimestamp(),
		migratedFrom: LEGACY_COLLECTION,
	});

	if (!execute) {
		const existing = await targetRef.get();
		return existing.exists ? "skipped" : "migrated";
	}

	try {
		// create() is atomic: it fails on an existing doc, so a concurrent live
		// registration can never be overwritten with legacy data.
		await targetRef.create(payload);
		return "migrated";
	} catch (error) {
		if (isAlreadyExists(error)) {
			return "skipped";
		}
		throw error;
	}
};

for (const doc of snapshot.docs) {
	// oxlint-disable-next-line no-await-in-loop -- Deliberately serial to avoid Firestore bursts.
	const outcome = await migrateDoc(doc);
	if (outcome === "migrated") {
		migrated += 1;
	} else if (outcome === "skipped") {
		skipped += 1;
	} else {
		invalid += 1;
	}
}

console.log(
	`${execute ? "MIGRATED" : "DRY RUN — would migrate"} ${migrated} tokens, skipped ${skipped} already-registered, ${invalid} invalid, out of ${snapshot.size} legacy docs`,
);
