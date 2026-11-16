import { buildStatsigUser } from "@/statsig/user";
import { describe, expect, it } from "bun:test";

describe("buildStatsigUser", () => {
	it("maps authenticated users to userID and private email", () => {
		const user = buildStatsigUser({
			currentUserUid: "firebase-user-123",
			currentUserEmail: "member@example.com",
			environment: "staging",
		});

		expect(user.userID).toBe("firebase-user-123");
		expect(user.privateAttributes).toEqual({ email: "member@example.com" });
		expect(user.custom).toEqual({ environment: "staging" });
		expect(user.statsigEnvironment).toEqual({ tier: "staging" });
	});
});
