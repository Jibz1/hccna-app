import { CampusSlugSchema } from "@/utils/campuses";
import { Schema } from "effect";

export interface CampusPreference {
	readonly userId: string;
	readonly firebaseUid: string;
	readonly preferredCampusSlug: string | null;
	readonly campusPreferenceVersion: number;
}

export interface SetCampusPreferenceInput {
	readonly firebaseUid: string;
	readonly campusSlug: string;
	readonly expectedVersion: number;
}

export class CampusPreferenceError extends Schema.TaggedError<CampusPreferenceError>()(
	"CampusPreferenceError",
	{ detail: Schema.String, cause: Schema.optional(Schema.Unknown) },
) {}

export class InvalidCampusPreferenceError extends Schema.TaggedError<InvalidCampusPreferenceError>()(
	"InvalidCampusPreferenceError",
	{ detail: Schema.String },
) {}

export const SetCampusPreferenceSchema = Schema.Struct({
	firebaseUid: Schema.NonEmptyString,
	campusSlug: CampusSlugSchema,
	expectedVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const preferenceChange = (
	current: CampusPreference,
	input: SetCampusPreferenceInput,
): "unchanged" | "conflict" | "update" => {
	if (current.preferredCampusSlug === input.campusSlug) {
		return "unchanged";
	}
	return current.campusPreferenceVersion === input.expectedVersion ? "update" : "conflict";
};
