// oxlint-disable no-negated-condition
// oxlint-disable no-continue
// oxlint-disable no-await-in-loop
// oxlint-disable max-depth
// oxlint-disable catch-error-name
/**
 * Firebase to PostgreSQL Migration Script
 *
 * This script pulls data from Firebase collections and writes to PostgreSQL.
 *
 * Collections migrated:
 * - app-users (primary Firebase) -> app_users table
 * - wordActivationScriptures (primary Firebase) -> scriptures table
 * - wordActivationSub (secondary Firebase) -> word_activation_subs table
 * - dailyVerse/verseOfTheDay (primary Firebase) -> daily_verses table
 *
 * Usage:
 *   bun run scripts/migrate-firebase-to-postgres.ts
 *
 * Options:
 *   --dry-run    Preview changes without writing to database
 *   --collection <name>  Migrate only specific collection (users, scriptures, subscriptions, dailyVerse)
 */

// disable all linting for this file
// oxlint-disable-all
import { eq } from "drizzle-orm";

import { db as pgDb, schema } from "../src/db";
import { AppCollections, FBPaths, db as firebaseDb, secondaryDb } from "../src/utils/firebase";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface FirebaseUserDoc {
	email: string;
	uid: string;
	firstName?: string;
	lastName?: string;
	departments?: {
		id: number;
		slug: string;
		ccbId: string;
		name: string;
		image: string;
		description: string;
		link: string;
		fullName: string;
	}[];
	ministries?: {
		id: number;
		slug: string;
		ccbId: string;
		name: string;
		image: string;
		fullName: string;
		description: string;
		link: string;
	}[];
	ccbId?: string;
	ccbFamilyId?: string;
	img?: string | null;
	isVerified: boolean;
	phone?: string | null;
	userMetadata?: unknown;
	provider?: string | null;
	createdAt?: string | null;
}

interface FirebaseScriptureDoc {
	book: string;
	id?: string;
	verseId?: string;
	img: string[];
	stBook: string[];
	text: string;
	nlt_translation: string;
}

interface FirebaseWordActivationSubDoc {
	email: string;
	Name: string;
	lastUpdate: number;
	monthlySub: boolean | string;
	wordActivationId: string;
	profileID?: string;
}

interface FirebaseDailyVerseDoc {
	book: string;
	date: string;
	stBook: string;
	text: string;
	image?: string;
	verseId?: string;
	nlt_translation: string;
}

interface MigrationStats {
	users: { total: number; migrated: number; skipped: number; errors: number };
	departments: {
		total: number;
		migrated: number;
		skipped: number;
		errors: number;
	};
	ministries: {
		total: number;
		migrated: number;
		skipped: number;
		errors: number;
	};
	scriptures: {
		total: number;
		migrated: number;
		skipped: number;
		errors: number;
	};
	subscriptions: {
		total: number;
		migrated: number;
		skipped: number;
		errors: number;
	};
	dailyVerse: {
		total: number;
		migrated: number;
		skipped: number;
		errors: number;
	};
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const COLLECTION_FILTER = args.includes("--collection")
	? args[args.indexOf("--collection") + 1]
	: null;

const stats: MigrationStats = {
	users: { total: 0, migrated: 0, skipped: 0, errors: 0 },
	departments: { total: 0, migrated: 0, skipped: 0, errors: 0 },
	ministries: { total: 0, migrated: 0, skipped: 0, errors: 0 },
	scriptures: { total: 0, migrated: 0, skipped: 0, errors: 0 },
	subscriptions: { total: 0, migrated: 0, skipped: 0, errors: 0 },
	dailyVerse: { total: 0, migrated: 0, skipped: 0, errors: 0 },
};

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function log(message: string, level: "info" | "warn" | "error" = "info") {
	const prefix = DRY_RUN ? "[DRY-RUN] " : "";
	const timestamp = new Date().toISOString();
	const levelIcon = { info: "📋", warn: "⚠️", error: "❌" }[level];
	console.log(`${timestamp} ${levelIcon} ${prefix}${message}`);
}

function logProgress(current: number, total: number, entity: string) {
	const percent = Math.round((current / total) * 100);
	process.stdout.write(`\r  Processing ${entity}: ${current}/${total} (${percent}%)`);
}

// ═══════════════════════════════════════════════════════════════
// MIGRATION: SCRIPTURES (wordActivationScriptures)
// ═══════════════════════════════════════════════════════════════

async function migrateScriptures() {
	log("Starting scriptures migration...");

	const snapshot = await firebaseDb.collection(AppCollections.wordActivationScriptures).get();

	stats.scriptures.total = snapshot.size;
	log(`Found ${snapshot.size} scriptures in Firebase`);

	const scripturesToInsert: (typeof schema.scriptures.$inferInsert)[] = [];

	for (const doc of snapshot.docs) {
		const data = doc.data() as FirebaseScriptureDoc;
		const verseId = data.verseId || data.id || doc.id;

		scripturesToInsert.push({
			id: doc.id,
			book: data.book,
			stBook: Array.isArray(data.stBook) ? data.stBook.join(", ") : data.stBook,
			verseId,
			text: data.text,
			nltTranslation: data.nlt_translation || data.text,
			images: data.img || [],
		});
	}

	if (!DRY_RUN && scripturesToInsert.length > 0) {
		try {
			// Use upsert to handle existing records
			for (let i = 0; i < scripturesToInsert.length; i++) {
				const scripture = scripturesToInsert[i];
				if (!scripture) {
					log(`Skipping scripture ${i + 1}: no data`, "warn");
					// oxlint-disable-next-line no-continue
					continue;
				}

				logProgress(i + 1, scripturesToInsert.length, "scriptures");

				try {
					// oxlint-disable-next-line no-await-in-loop
					await pgDb
						.insert(schema.scriptures)
						.values(scripture)
						.onConflictDoUpdate({
							target: schema.scriptures.verseId,
							set: {
								book: scripture.book,
								stBook: scripture.stBook,
								text: scripture.text,
								nltTranslation: scripture.nltTranslation,
								images: scripture.images,
							},
						});
					stats.scriptures.migrated++;
				} catch (error) {
					log(
						`Error inserting scripture ${scripture.verseId}: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
					stats.scriptures.errors++;
				}
			}
			console.log(); // New line after progress
		} catch (error) {
			log(
				`Error in scriptures migration: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	} else {
		stats.scriptures.migrated = scripturesToInsert.length;
	}

	log(
		`Scriptures migration complete: ${stats.scriptures.migrated} migrated, ${stats.scriptures.errors} errors`,
	);
}

// ═══════════════════════════════════════════════════════════════
// MIGRATION: USERS (app-users)
// ═══════════════════════════════════════════════════════════════

async function migrateUsers() {
	log("Starting users migration...");

	const snapshot = await firebaseDb.collection(AppCollections.users).get();

	stats.users.total = snapshot.size;
	log(`Found ${snapshot.size} users in Firebase`);

	// Collect unique departments and ministries
	const departmentsMap = new Map<string, string>();
	const ministriesMap = new Map<string, string>();

	// First pass: collect all departments and ministries
	for (const doc of snapshot.docs) {
		const data = doc.data() as FirebaseUserDoc;

		if (data.departments) {
			for (const dept of data.departments) {
				if (!departmentsMap.has(dept.name)) {
					departmentsMap.set(dept.name, crypto.randomUUID());
				}
			}
		}

		if (data.ministries) {
			for (const ministry of data.ministries) {
				if (!ministriesMap.has(ministry.name)) {
					ministriesMap.set(ministry.name, crypto.randomUUID());
				}
			}
		}
	}

	stats.departments.total = departmentsMap.size;
	stats.ministries.total = ministriesMap.size;

	log(`Found ${departmentsMap.size} unique departments`);
	log(`Found ${ministriesMap.size} unique ministries`);

	// Insert departments
	if (!DRY_RUN && departmentsMap.size > 0) {
		log("Inserting departments...");
		for (const [name, id] of departmentsMap) {
			try {
				// oxlint-disable-next-line no-await-in-loop
				await pgDb.insert(schema.departments).values({ id, name }).onConflictDoNothing();
				stats.departments.migrated++;
			} catch (error) {
				log(
					`Error inserting department ${name}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				stats.departments.errors++;
			}
		}
	}

	// Insert ministries
	if (!DRY_RUN && ministriesMap.size > 0) {
		log("Inserting ministries...");
		for (const [name, id] of ministriesMap) {
			try {
				// oxlint-disable-next-line no-await-in-loop
				await pgDb.insert(schema.ministries).values({ id, name }).onConflictDoNothing();
				stats.ministries.migrated++;
			} catch (error) {
				log(
					`Error inserting ministry ${name}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				stats.ministries.errors++;
			}
		}
	}

	// Insert users
	log("Inserting users...");
	let userIndex = 0;
	for (const doc of snapshot.docs) {
		userIndex++;
		logProgress(userIndex, snapshot.size, "users");

		const data = doc.data() as FirebaseUserDoc;
		const firebaseUid = doc.id;

		if (!data.email) {
			log(`Skipping user ${firebaseUid}: no email`, "warn");
			stats.users.skipped++;
			// oxlint-disable-next-line no-continue
			continue;
		}

		const userId = crypto.randomUUID();
		// oxlint-disable-next-line no-negated-condition
		if (!DRY_RUN) {
			try {
				// Insert user
				// oxlint-disable-next-line no-await-in-loop
				await pgDb
					.insert(schema.users)
					.values({
						id: userId,
						firebaseUid,
						email: data.email,
						firstName: data.firstName,
						lastName: data.lastName,
						phone: data.phone,
						img: data.img,
						isVerified: data.isVerified ?? false,
						ccbId: data.ccbId,
						ccbFamilyId: data.ccbFamilyId,
						provider: data.provider,
						createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
					})
					.onConflictDoUpdate({
						target: schema.users.firebaseUid,
						set: {
							email: data.email,
							firstName: data.firstName,
							lastName: data.lastName,
							phone: data.phone,
							img: data.img,
							isVerified: data.isVerified ?? false,
							ccbId: data.ccbId,
							ccbFamilyId: data.ccbFamilyId,
							provider: data.provider,
						},
					});

				// Get the actual user ID (in case of upsert)
				const [existingUser] = await pgDb
					.select({ id: schema.users.id })
					.from(schema.users)
					.where(eq(schema.users.firebaseUid, firebaseUid));

				const actualUserId = existingUser?.id || userId;

				// Insert user-department relations
				if (data.departments) {
					for (const dept of data.departments) {
						const deptId = departmentsMap.get(dept.name);
						if (deptId) {
							await pgDb
								.insert(schema.userDepartments)
								.values({ userId: actualUserId, departmentId: deptId })
								.onConflictDoNothing();
						}
					}
				}

				// Insert user-ministry relations
				if (data.ministries) {
					for (const ministry of data.ministries) {
						const ministryId = ministriesMap.get(ministry.name);
						if (ministryId) {
							await pgDb
								.insert(schema.userMinistries)
								.values({ userId: actualUserId, ministryId })
								.onConflictDoNothing();
						}
					}
				}

				stats.users.migrated++;
			} catch (err) {
				log(`Error inserting user ${firebaseUid}: ${err}`, "error");
				stats.users.errors++;
			}
		} else {
			stats.users.migrated++;
		}
	}

	console.log(); // New line after progress
	log(
		`Users migration complete: ${stats.users.migrated} migrated, ${stats.users.skipped} skipped, ${stats.users.errors} errors`,
	);
}

// ═══════════════════════════════════════════════════════════════
// MIGRATION: WORD ACTIVATION SUBSCRIPTIONS (wordActivationSub)
// ═══════════════════════════════════════════════════════════════

async function migrateSubscriptions() {
	log("Starting word activation subscriptions migration...");
	log("Note: Subscriptions are in secondary Firebase (app-hccnj-17d4f)");

	const snapshot = await secondaryDb.collection(AppCollections.wordActivationSub).get();

	stats.subscriptions.total = snapshot.size;
	log(`Found ${snapshot.size} subscriptions in Firebase`);

	let subIndex = 0;
	for (const doc of snapshot.docs) {
		subIndex++;
		logProgress(subIndex, snapshot.size, "subscriptions");

		const data = doc.data() as FirebaseWordActivationSubDoc;

		if (!data.email) {
			log(`Skipping subscription ${doc.id}: no email`, "warn");
			stats.subscriptions.skipped++;
			continue;
		}

		if (!DRY_RUN) {
			try {
				// Find the user by email
				const [user] = await pgDb
					.select({ id: schema.users.id })
					.from(schema.users)
					.where(eq(schema.users.email, data.email));

				if (!user) {
					log(`Skipping subscription for ${data.email}: user not found in database`, "warn");
					stats.subscriptions.skipped++;
					continue;
				}

				// Find the scripture by verseId
				let scriptureId: string | null = null;
				if (data.wordActivationId) {
					const [scripture] = await pgDb
						.select({ id: schema.scriptures.id })
						.from(schema.scriptures)
						.where(eq(schema.scriptures.id, data.wordActivationId));

					if (scripture) {
						scriptureId = scripture.id;
					} else {
						// Try finding by verseId field
						const [scriptureByVerseId] = await pgDb
							.select({ id: schema.scriptures.id })
							.from(schema.scriptures)
							.where(eq(schema.scriptures.verseId, data.wordActivationId));

						if (scriptureByVerseId) {
							scriptureId = scriptureByVerseId.id;
						}
					}
				}

				if (!scriptureId) {
					log(
						`Skipping subscription for ${data.email}: scripture ${data.wordActivationId} not found`,
						"warn",
					);
					stats.subscriptions.skipped++;
					continue;
				}

				const monthlySub = data.monthlySub === true || data.monthlySub === "true";

				await pgDb
					.insert(schema.wordActivationSubs)
					.values({
						id: doc.id,
						userId: user.id,
						scriptureId,
						monthlySub,
						lastUpdate: data.lastUpdate ? new Date(data.lastUpdate) : new Date(),
					})
					.onConflictDoUpdate({
						target: schema.wordActivationSubs.userId,
						set: {
							scriptureId,
							monthlySub,
							lastUpdate: data.lastUpdate ? new Date(data.lastUpdate) : new Date(),
						},
					});

				stats.subscriptions.migrated++;
			} catch (err) {
				log(`Error inserting subscription ${doc.id}: ${err}`, "error");
				stats.subscriptions.errors++;
			}
		} else {
			stats.subscriptions.migrated++;
		}
	}

	console.log(); // New line after progress
	log(
		`Subscriptions migration complete: ${stats.subscriptions.migrated} migrated, ${stats.subscriptions.skipped} skipped, ${stats.subscriptions.errors} errors`,
	);
}

// ═══════════════════════════════════════════════════════════════
// MIGRATION: DAILY VERSE (dailyVerse/verseOfTheDay)
// ═══════════════════════════════════════════════════════════════

async function migrateDailyVerse() {
	log("Starting daily verse migration...");

	const docRef = await firebaseDb.collection(FBPaths.customVerse).doc(FBPaths.verseOfTheDay).get();

	if (!docRef.exists) {
		log("No verseOfTheDay document found in Firebase", "warn");
		return;
	}

	stats.dailyVerse.total = 1;
	const data = docRef.data() as FirebaseDailyVerseDoc;

	log(`Found daily verse: ${data.verseId || "unknown"}`);

	if (!DRY_RUN) {
		try {
			// Find or create the scripture
			let scriptureId: string | null = null;

			if (data.verseId) {
				// Try to find existing scripture
				const [existingScripture] = await pgDb
					.select({ id: schema.scriptures.id })
					.from(schema.scriptures)
					.where(eq(schema.scriptures.verseId, data.verseId));

				if (existingScripture) {
					scriptureId = existingScripture.id;
				}
			}

			// If no scripture found, create one
			if (!scriptureId) {
				const newScriptureId = crypto.randomUUID();
				const verseId = data.verseId || `daily-${Date.now()}`;

				await pgDb.insert(schema.scriptures).values({
					id: newScriptureId,
					book: data.book,
					stBook: data.stBook,
					verseId,
					text: data.text,
					nltTranslation: data.nlt_translation || data.text,
					images: data.image ? [data.image] : [],
				});

				scriptureId = newScriptureId;
				log(`Created new scripture for daily verse: ${verseId}`);
			}

			// Parse the date
			const verseDate = data.date ? new Date(data.date) : new Date();
			const dateString =
				verseDate.toISOString().split("T")[0] ?? verseDate.toISOString().slice(0, 10); // YYYY-MM-DD

			if (!scriptureId) {
				log("Could not find or create scripture for daily verse", "error");
				stats.dailyVerse.errors = 1;
				return;
			}

			// Insert daily verse
			await pgDb
				.insert(schema.dailyVerses)
				.values({
					date: dateString,
					scriptureId,
					image: data.image,
				})
				.onConflictDoUpdate({
					target: schema.dailyVerses.date,
					set: {
						scriptureId,
						image: data.image,
					},
				});

			stats.dailyVerse.migrated = 1;
			log(`Daily verse migrated successfully for date: ${dateString}`);
		} catch (err) {
			log(`Error migrating daily verse: ${err}`, "error");
			stats.dailyVerse.errors = 1;
		}
	} else {
		stats.dailyVerse.migrated = 1;
	}
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
	console.log("\n");
	console.log("═══════════════════════════════════════════════════════════════");
	console.log("        Firebase to PostgreSQL Migration Script");
	console.log("═══════════════════════════════════════════════════════════════");
	console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes will be made)" : "LIVE"}`);
	if (COLLECTION_FILTER) {
		console.log(`Collection filter: ${COLLECTION_FILTER}`);
	}
	console.log("═══════════════════════════════════════════════════════════════");
	console.log("\n");

	const shouldMigrate = (collection: string) =>
		!COLLECTION_FILTER || COLLECTION_FILTER === collection;

	try {
		// Order matters: scriptures first, then users, then subscriptions (which reference both)
		if (shouldMigrate("scriptures")) {
			await migrateScriptures();
			console.log("\n");
		}

		if (shouldMigrate("users")) {
			await migrateUsers();
			console.log("\n");
		}

		if (shouldMigrate("subscriptions")) {
			await migrateSubscriptions();
			console.log("\n");
		}

		if (shouldMigrate("dailyVerse")) {
			await migrateDailyVerse();
			console.log("\n");
		}

		// Print summary
		console.log("═══════════════════════════════════════════════════════════════");
		console.log("                    MIGRATION SUMMARY");
		console.log("═══════════════════════════════════════════════════════════════");
		console.log("\n");

		// oxlint-disable-next-line consistent-function-scoping
		const printStats = (
			name: string,
			s: { total: number; migrated: number; skipped: number; errors: number },
		) => {
			console.log(`  ${name}:`);
			console.log(`    Total:    ${s.total}`);
			console.log(`    Migrated: ${s.migrated}`);
			console.log(`    Skipped:  ${s.skipped}`);
			console.log(`    Errors:   ${s.errors}`);
			console.log("");
		};

		printStats("Scriptures", stats.scriptures);
		printStats("Users", stats.users);
		printStats("Departments", stats.departments);
		printStats("Ministries", stats.ministries);
		printStats("Subscriptions", stats.subscriptions);
		printStats("Daily Verse", stats.dailyVerse);

		console.log("═══════════════════════════════════════════════════════════════");

		if (DRY_RUN) {
			console.log("\n⚠️  This was a DRY RUN. No changes were made to the database.");
			console.log("   Run without --dry-run to apply changes.\n");
		} else {
			console.log("\n✅ Migration complete!\n");
		}
	} catch (error) {
		console.error("\n❌ Migration failed:", error);
		process.exit(1);
	}

	process.exit(0);
}

await main();
