import { describe, expect, it } from "bun:test";

import { createUserProfileDataLoader } from "../firebaseDataLoader";

const profileDocument = {
	uid: "user-1",
	email: "ada@example.com",
	firstName: "Ada",
	lastName: "Example",
	img: "https://example.com/ada.png",
	provider: "apple",
	isVerified: true,
};

interface StoredProfileDocument extends Partial<typeof profileDocument> {
	readonly ministries?: readonly unknown[];
}

const loaderReading = (document: StoredProfileDocument) =>
	createUserProfileDataLoader((() => Promise.resolve([document])) as never);

describe("createUserProfileDataLoader", () => {
	it("loads a profile whose stored ministries predate the fullName field", async () => {
		const loader = loaderReading({
			...profileDocument,
			ministries: [
				{
					id: 7,
					slug: "choir",
					ccbId: "70",
					name: "Choir",
					image: "",
					description: "",
					link: "",
				},
			],
		});

		const profile = await loader.load("user-1");

		expect(profile).toMatchObject({ uid: "user-1", firstName: "Ada", lastName: "Example" });
		expect(profile).not.toHaveProperty("ministries");
	});

	it("still rejects a document without the required identity fields", async () => {
		const { uid: _, ...withoutUid } = profileDocument;

		expect(await loaderReading(withoutUid).load("user-1")).toBeNull();
	});
});
