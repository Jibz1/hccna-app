// One-off copy: `User.woa` used to create Word of Activation subscriptions in the primary
// project's wordActivationSub, which neither the lookup nor the monthly rotation reads (both use
// the secondary project). This copies each such member's subscription to the secondary project
// under the same document id, keeping their verse and monthlySub, so the next rotation assigns
// and delivers it.
//
// Idempotent: emails that already have a secondary subscription are skipped, and create() never
// overwrites a document. Dry run by default; pass --execute to write. It prints counts only,
// because the documents hold members' names and emails. Does not delete the primary documents.
import { AppCollections, db, fieldPath, secondaryDb } from "@/utils/firebase";
import { Option, Predicate, Schema } from "effect";

import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

const execute = process.argv.includes("--execute");

const isAlreadyExists = (cause: unknown): boolean =>
	Predicate.isObject(cause) &&
	"code" in cause &&
	(cause.code === 6 || cause.code === "already-exists");

// Only the email is read; the copy writes each document's data as it is.
const decodeEmail = Schema.decodeUnknownOption(Schema.Struct({ email: Schema.String }));

const emailOf = (doc: QueryDocumentSnapshot): string | undefined =>
	Option.getOrUndefined(decodeEmail(doc.data()))?.email || undefined;

const [primary, secondary] = await Promise.all([
	// Firestore's document-id order, which the lookup's first match also follows.
	db.collection(AppCollections.wordActivationSub).orderBy(fieldPath.documentId()).get(),
	secondaryDb.collection(AppCollections.wordActivationSub).get(),
]);

const subscribed = new Set(
	secondary.docs.map((doc) => emailOf(doc)).filter((email) => email !== undefined),
);

// The lookup takes the first match in document-id order: that is the verse the member sees.
const current = new Map<string, (typeof primary.docs)[number]>();
let withoutEmail = 0;
let duplicates = 0;
for (const doc of primary.docs) {
	const email = emailOf(doc);
	if (email === undefined) {
		withoutEmail += 1;
	} else if (current.has(email)) {
		duplicates += 1;
	} else {
		current.set(email, doc);
	}
}

let copied = 0;
let alreadySubscribed = 0;
let idTaken = 0;
for (const [email, doc] of current) {
	if (subscribed.has(email)) {
		alreadySubscribed += 1;
	} else if (execute) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- Deliberately serial to avoid Firestore bursts.
			await secondaryDb.collection(AppCollections.wordActivationSub).doc(doc.id).create(doc.data());
			copied += 1;
		} catch (error) {
			if (!isAlreadyExists(error)) {
				throw error;
			}
			idTaken += 1;
		}
	} else {
		copied += 1;
	}
}

console.log(
	[
		`${execute ? "COPIED" : "DRY RUN — would copy"} ${copied} subscriptions to the secondary project`,
		`${alreadySubscribed} members already subscribed there`,
		`${duplicates} duplicate primary docs (only the first per email counts)`,
		`${withoutEmail} primary docs without an email`,
		`${idTaken} document ids already taken in the secondary project`,
		`out of ${primary.size} primary and ${secondary.size} secondary docs`,
	].join("\n"),
);
