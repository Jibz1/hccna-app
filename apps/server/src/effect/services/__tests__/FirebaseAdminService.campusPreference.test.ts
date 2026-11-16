import { makeMirrorUserCampusPreference } from "@/effect/services/FirebaseAdminService";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";

import type { CampusPreference } from "@/effect/services/campus/preference";
import type { UserProfileDoc } from "@/types/userProfile";

interface UserDocument {
	readonly path: string;
}

interface CampusTransaction {
	readonly get: (document: UserDocument) => Promise<{ get: (field: string) => unknown }>;
	readonly set: (
		document: UserDocument,
		data: Pick<CampusPreference, "preferredCampusSlug" | "campusPreferenceVersion">,
		options: { merge: boolean },
	) => void;
}

interface StoredUser extends Partial<Pick<UserProfileDoc, "uid" | "firstName" | "userMetadata">> {
	readonly preferredCampusSlug?: string | null;
	readonly campusPreferenceVersion?: unknown;
}

function harness(initial: StoredUser) {
	const documents = new Map<string, StoredUser>([["app-users/user-1", initial]]);
	const writes: string[] = [];
	const firestore: Parameters<typeof makeMirrorUserCampusPreference>[0] = {
		collection: ((collection: string) => ({
			doc: (uid: string) => ({ path: `${collection}/${uid}` }),
		})) as never,
		runTransaction: (async (callback: (tx: CampusTransaction) => Promise<void>) => {
			await callback({
				get: (document) =>
					Promise.resolve({
						get: (field) => {
							expect(field).toBe("campusPreferenceVersion");
							return documents.get(document.path)?.campusPreferenceVersion;
						},
					}),
				set: (document, data, options) => {
					const stored = options.merge ? documents.get(document.path) : undefined;
					documents.set(document.path, { ...stored, ...data });
					writes.push(document.path);
				},
			});
		}) as never,
	};
	const mirror = makeMirrorUserCampusPreference(firestore);
	return {
		documents,
		writes,
		save: (slug: string, version: number) =>
			Effect.runPromise(
				mirror({
					firebaseUid: "user-1",
					userId: "postgres-user-1",
					preferredCampusSlug: slug,
					campusPreferenceVersion: version,
				}),
			),
	};
}

describe("FirebaseAdminService campus preference mirror", () => {
	it("merges the Postgres selection into the authenticated user's document", async () => {
		const h = harness({ uid: "user-1", firstName: "Ada", userMetadata: { provider: "apple" } });
		h.documents.set("app-users/other-user", { firstName: "Grace" });
		await h.save("new-breed", 2);
		expect(h.documents.get("app-users/user-1")).toEqual({
			uid: "user-1",
			firstName: "Ada",
			userMetadata: { provider: "apple" },
			preferredCampusSlug: "new-breed",
			campusPreferenceVersion: 2,
		});
		expect(h.documents.get("app-users/other-user")).toEqual({ firstName: "Grace" });
		expect(h.writes).toEqual(["app-users/user-1"]);
	});
});
