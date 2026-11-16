// ═══════════════════════════════════════════════════════════════
// DRIZZLE SCHEMA - HCCNA Backend
// ═══════════════════════════════════════════════════════════════

// Users & Auth
export * from "./users";

// Junction Tables (Many-to-Many)
export * from "./tables";

// Word of Activation / Scriptures
export * from "./scriptures";
export * from "./savedVerses";

// Donations (CCB Cached Data)
export * from "./donations";

// Event Attendance Cached Data
export * from "./eventAttendance";

// Event Attendance PDF Export Metadata
export * from "./attendanceExports";

// Core Settings & More Links
export * from "./cms-content/core";

// Home Page Content & Featured Events
export * from "./cms-content/home";
export * from "./cms-content/featuredEventSources";

// Relations (using defineRelations API)
export { relations } from "./relations";
