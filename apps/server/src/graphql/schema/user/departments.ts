import { builder } from "../../builder";

import type { UserProfileData } from "@/types/userProfile";

type _Department = NonNullable<UserProfileData["departments"]>[0];

type UserDepartment = _Department;

export const Department = builder.objectRef<UserDepartment>("Department").implement({
	fields: (t) => ({
		id: t.exposeInt("id", {
			description: "Department id",
		}),
		slug: t.exposeString("slug", {
			description: "Department slug",
		}),
		ccbId: t.exposeString("ccbId", {
			description: "Department ccb id",
		}),
		name: t.exposeString("name", {
			description: "Department name",
		}),
		fullName: t.exposeString("fullName", {
			description: "Department full name",
		}),
		image: t.exposeString("image", {
			description: "Department image",
		}),
		description: t.exposeString("description", {
			description: "Department description",
		}),
		link: t.exposeString("link", {
			description: "Department link",
		}),
	}),
});
