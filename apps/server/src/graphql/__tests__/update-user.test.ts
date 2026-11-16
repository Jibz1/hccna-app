import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Effect } from "effect";

void mock.module("@/utils/firebase", () => ({
	app: {},
	secondaryApp: {},
	auth: {
		getUserByEmail: mock(),
	},
	db: {
		collection: mock(() => ({
			doc: mock(() => ({
				get: mock(),
				delete: mock(),
			})),
		})),
	},
	secondaryDb: {},
	dbFieldValue: {},
	fieldPath: {},
	FBPaths: {},
	getStorageBucket: mock(),
	AppCollections: {
		users: "app-users",
		signInCode: "sign-in-code",
		deleteAccountCode: "delete-account-code",
	},
}));

void mock.module("@/redis", () => ({
	redis: {
		get: mock(),
		set: mock(),
		mget: mock(),
		expire: mock(),
	},
}));

const { createVerifyAndCleanupEffect } = await import("../schema/user/user");

const mockGetUserByEmail = mock();
const mockDeleteUserFireStoreEffect = mock();

describe("postDeletionCleanup", () => {
	const mockUid = "test-user-uid-123";
	const mockEmail = "test@example.com";

	beforeEach(() => {
		mockGetUserByEmail.mockClear();
		mockDeleteUserFireStoreEffect.mockClear();
	});

	it("should return failure when auth account still exists", async () => {
		mockGetUserByEmail.mockResolvedValue({
			uid: mockUid,
			email: mockEmail,
		});

		const result = await Effect.runPromise(
			createVerifyAndCleanupEffect({
				uid: mockUid,
				email: mockEmail,
				getUserByEmail: mockGetUserByEmail,
				deleteUserFireStore: mockDeleteUserFireStoreEffect,
			}),
		);

		expect(result).toEqual({
			success: false,
			message: "Auth account still exists; cannot proceed with cleanup",
		});

		expect(mockGetUserByEmail).toHaveBeenCalledWith(mockEmail);
		expect(mockDeleteUserFireStoreEffect).not.toHaveBeenCalled();
	});

	it("should proceed with cleanup when user is not found in auth", async () => {
		const userNotFoundError = { code: "auth/user-not-found" };
		mockGetUserByEmail.mockRejectedValue(userNotFoundError);
		mockDeleteUserFireStoreEffect.mockReturnValue(Effect.void);

		const result = await Effect.runPromise(
			createVerifyAndCleanupEffect({
				uid: mockUid,
				email: mockEmail,
				getUserByEmail: mockGetUserByEmail,
				deleteUserFireStore: mockDeleteUserFireStoreEffect,
			}),
		);

		expect(result).toEqual({
			success: true,
			message: "done successfully",
		});

		expect(mockGetUserByEmail).toHaveBeenCalledWith(mockEmail);
		expect(mockDeleteUserFireStoreEffect).toHaveBeenCalledWith(mockUid);
	});

	it("should fail when auth returns a different error", async () => {
		const otherError = {
			code: "auth/internal-error",
			message: "Internal error",
		};
		mockGetUserByEmail.mockRejectedValue(otherError);

		try {
			await Effect.runPromise(
				createVerifyAndCleanupEffect({
					uid: mockUid,
					email: mockEmail,
					getUserByEmail: mockGetUserByEmail,
					deleteUserFireStore: mockDeleteUserFireStoreEffect,
				}),
			);
			expect.unreachable("Should have thrown");
		} catch {
			expect(mockDeleteUserFireStoreEffect).not.toHaveBeenCalled();
		}
	});

	it("should handle auth error without code property", async () => {
		const errorWithoutCode = { message: "Unknown error" };
		mockGetUserByEmail.mockRejectedValue(errorWithoutCode);

		try {
			await Effect.runPromise(
				createVerifyAndCleanupEffect({
					uid: mockUid,
					email: mockEmail,
					getUserByEmail: mockGetUserByEmail,
					deleteUserFireStore: mockDeleteUserFireStoreEffect,
				}),
			);
			expect.unreachable("Should have thrown");
		} catch {
			expect(mockDeleteUserFireStoreEffect).not.toHaveBeenCalled();
		}
	});
});
