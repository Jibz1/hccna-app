import { users } from "@/db/schema/users";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { ProfileService } from "@/effect/services/ProfileService";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

interface UserProfileUpdateInput {
	firstName?: string | undefined;
	lastName?: string | undefined;
	phone?: string | undefined;
	img?: string | undefined;
}

interface UserProfileUpdateResult {
	success: boolean;
	message: string;
}

export class UserProfileUpdateError extends Schema.TaggedError<UserProfileUpdateError>()(
	"UserProfileUpdateError",
	{
		detail: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `User profile update failed: ${this.detail}`;
	}
}

export class UserNotFoundError extends Schema.TaggedError<UserNotFoundError>()(
	"UserNotFoundError",
	{
		firebaseUid: Schema.String,
		detail: Schema.String,
	},
) {
	override get message() {
		return this.detail;
	}
}

export class UserNotAuthenticatedError extends Schema.TaggedError<UserNotAuthenticatedError>()(
	"UserNotAuthenticatedError",
	{
		detail: Schema.String,
	},
) {
	override get message() {
		return this.detail;
	}
}

interface UserProfileUpdateServiceContract {
	updateUserProfileV2: (
		firebaseUid: string | null | undefined,
		input: UserProfileUpdateInput,
	) => Effect.Effect<
		UserProfileUpdateResult,
		UserProfileUpdateError | UserNotFoundError | UserNotAuthenticatedError
	>;
}

export class UserProfileUpdateService extends Context.Service<
	UserProfileUpdateService,
	UserProfileUpdateServiceContract
>()("UserProfileUpdateService", {
	make: Effect.gen(function* () {
		const firebase = yield* FirebaseAdminService;
		const profileService = yield* ProfileService;
		const { db } = yield* DrizzleService;

		const updateUserProfileV2Base = Effect.fn("UserProfileUpdateService.updateUserProfileV2")(
			function* (firebaseUid: string | null | undefined, input: UserProfileUpdateInput) {
				if (!firebaseUid) {
					return yield* Effect.fail(
						new UserNotAuthenticatedError({
							detail: "User not authenticated",
						}),
					);
				}

				const updates = {
					...(input.firstName !== undefined && { firstName: input.firstName }),
					...(input.lastName !== undefined && { lastName: input.lastName }),
					...(input.phone !== undefined && { phone: input.phone }),
					...(input.img !== undefined && { img: input.img }),
				};

				let updatedUser: {
					id: string;
					email: string | null;
				} | null = null;

				return yield* Effect.gen(function* () {
					updatedUser = yield* Effect.tryPromise({
						try: () =>
							db.transaction(async (tx) => {
								const [user] = await tx
									.update(users)
									.set(updates)
									.where(eq(users.firebaseUid, firebaseUid))
									.returning({ id: users.id, email: users.email });

								if (!user) {
									throw new UserNotFoundError({
										firebaseUid,
										detail: "User not found",
									});
								}

								return user;
							}),
						catch: (cause) =>
							cause instanceof UserNotFoundError
								? cause
								: new UserProfileUpdateError({
										detail: "Failed to update user profile stores",
										cause,
									}),
					});

					yield* firebase.mergeUserDocument(firebaseUid, updates).pipe(
						Effect.catchTag("FirebaseFirestoreWriteError", (error) =>
							Effect.logWarning("Post-commit Firebase profile mirror failed").pipe(
								Effect.annotateLogs({
									firebaseUid,
									userId: updatedUser?.id,
									detail: error.detail,
								}),
							),
						),
					);

					return {
						success: true,
						message: "User profile updated successfully",
					} satisfies UserProfileUpdateResult;
				}).pipe(
					Effect.ensuring(
						Effect.suspend(() =>
							updatedUser
								? profileService.clearCache({
										firebaseUid,
										id: updatedUser.id,
										...(updatedUser.email && { email: updatedUser.email }),
									})
								: Effect.void,
						),
					),
					Effect.tap(() =>
						Effect.logInfo("Updated user profile successfully").pipe(
							Effect.annotateLogs({
								firebaseUid,
								userId: updatedUser?.id,
							}),
						),
					),
					Effect.withSpan("UserProfileUpdateService.updateStores"),
				);
			},
		);

		const updateUserProfileV2: UserProfileUpdateServiceContract["updateUserProfileV2"] = (
			firebaseUid,
			input,
		) =>
			updateUserProfileV2Base(firebaseUid, input).pipe(
				Effect.withSpan("UserProfileUpdateService.updateUserProfileV2"),
			);

		return {
			updateUserProfileV2,
		};
	}),
}) {}

export const UserProfileUpdateServiceLive = Layer.effect(
	UserProfileUpdateService,
	UserProfileUpdateService.make,
);
