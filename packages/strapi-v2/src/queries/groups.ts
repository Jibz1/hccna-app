import { Schema } from "effect";

import { mediaUrl, Meta, Text } from "./shared";

import type { CmsDepartment, CmsMinistry } from "../records";

export const DEPARTMENTS_OPERATION = "StrapiV2Departments";
export const DEPARTMENTS_DOCUMENT = `query StrapiV2Departments {
  departments(pagination: { pageSize: 100 }) { slug Name CCBID Header { title description featureImage { url } } }
}`;

export const MINISTRIES_OPERATION = "StrapiV2Ministries";
export const MINISTRIES_DOCUMENT = `query StrapiV2Ministries {
  ministries(pagination: { pageSize: 100 }) { slug PageName CCBID Header { title description featureImage { url } } }
}`;

export const DepartmentsData = Schema.Struct({
	departments: Schema.Array(Schema.Struct({ slug: Text, Name: Text, CCBID: Text, Header: Meta })),
});

export const MinistriesData = Schema.Struct({
	ministries: Schema.Array(Schema.Struct({ slug: Text, PageName: Text, CCBID: Text, Header: Meta })),
});

// Firestore stores a numeric `id` that nothing reads. Strapi 5's own numeric ids
// change on every publish, so the stable CCB group id (the onboarding match key) is used.
const ccbNumber = (ccbId: string | null): number | null => {
	const trimmed = ccbId?.trim();
	if (trimmed === undefined || trimmed === "") {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
};

export const toDepartments = (data: typeof DepartmentsData.Type): CmsDepartment[] =>
	data.departments.flatMap((department) => {
		const id = ccbNumber(department.CCBID);
		return id === null
			? []
			: [
					{
						id,
						slug: department.slug,
						ccbId: department.CCBID,
						name: department.Name,
						fullName: department.Header?.title ?? null,
						description: department.Header?.description ?? null,
						image: mediaUrl(department.Header?.featureImage ?? null),
					},
				];
	});

export const toMinistries = (data: typeof MinistriesData.Type): CmsMinistry[] =>
	data.ministries.flatMap((ministry) => {
		const id = ccbNumber(ministry.CCBID);
		return id === null
			? []
			: [
					{
						id,
						slug: ministry.slug,
						ccbId: ministry.CCBID,
						name: ministry.Header?.title ?? null,
						description: ministry.Header?.description ?? null,
						image: mediaUrl(ministry.Header?.featureImage ?? null),
					},
				];
	});
