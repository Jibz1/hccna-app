import { pool, runMigrations } from "@/db";

async function main() {
	try {
		await runMigrations();
		console.log("Migration completed successfully");
	} catch (error) {
		console.error("Migration failed:", error);
		process.exit(1);
	} finally {
		await pool.end();
	}
}

await main();
