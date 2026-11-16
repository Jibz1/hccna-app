import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { Effect } from "effect";

const fallbackImage =
	"https://storage.googleapis.com/app-hccnj/Image/events_f7b00973f5/events_f7b00973f5.jpg";

const logAndWrap = (message: string) => (error: { readonly message: string }) => {
	const failure = new Error(message, { cause: error });
	return Effect.logError(message).pipe(
		Effect.annotateLogs({ error: error.message }),
		Effect.andThen(Effect.fail(failure)),
	);
};

// Onboarding profiles store these as strings, so a missing CMS value becomes "".
export const getDepartmentsEffect = Effect.gen(function* () {
	const cms = yield* CmsContent;
	const departments = yield* cms.departments.pipe(
		Effect.catch(logAndWrap("Failed to get departments")),
	);

	return departments.map((department) => {
		const slug = department.slug ?? "";
		return {
			id: department.id,
			slug,
			ccbId: department.ccbId ?? "",
			name: department.name ?? "",
			fullName: department.fullName ?? "",
			description: department.description ?? "",
			link: `https://hccnj.org/ministries/departments/${slug}`,
			image: department.image ?? fallbackImage,
		};
	});
});

export const getMinistriesEffect = Effect.gen(function* () {
	const cms = yield* CmsContent;
	const ministries = yield* cms.ministries.pipe(
		Effect.catch(logAndWrap("Failed to get ministries")),
	);

	return ministries.map((ministry) => {
		const slug = ministry.slug ?? "";
		return {
			id: ministry.id,
			slug,
			ccbId: ministry.ccbId ?? "",
			name: ministry.name ?? "",
			description: ministry.description ?? "",
			link: `https://hccnj.org/ministries/${slug}`,
			image: ministry.image ?? fallbackImage,
		};
	});
});
