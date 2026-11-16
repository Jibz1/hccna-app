import { Schema as S } from "effect";

const FormActionSchema = S.Struct({
	allowed: S.Boolean,
	reasons: S.Array(S.Unknown),
});

export const CCBFormsSchema = S.Array(
	S.Struct({
		id: S.Number,
		title: S.String,
		description: S.String,
		url: S.String,
		campus_id: S.Number,
		start: S.NullOr(S.String),
		end: S.NullOr(S.String),
		public: S.Boolean,
		status: S.String,
		created: S.String,
		actions: S.Struct({
			can_edit_form: FormActionSchema,
			can_respond_to_form: FormActionSchema,
			can_view_form: FormActionSchema,
		}),
	}),
);
