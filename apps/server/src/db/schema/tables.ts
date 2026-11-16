import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { departments, ministries, users } from "./users";

// ═══════════════════════════════════════════════════════════════
// USER <-> DEPARTMENTS (Many-to-Many Junction Table)
// ═══════════════════════════════════════════════════════════════

export const userDepartments = pgTable(
	"user_departments",
	{
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		departmentId: text("department_id")
			.notNull()
			.references(() => departments.id),
	},
	(table) => [primaryKey({ columns: [table.userId, table.departmentId] })],
);

// ═══════════════════════════════════════════════════════════════
// USER <-> MINISTRIES (Many-to-Many Junction Table)
// ═══════════════════════════════════════════════════════════════

export const userMinistries = pgTable(
	"user_ministries",
	{
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		ministryId: text("ministry_id")
			.notNull()
			.references(() => ministries.id),
	},
	(table) => [primaryKey({ columns: [table.userId, table.ministryId] })],
);
