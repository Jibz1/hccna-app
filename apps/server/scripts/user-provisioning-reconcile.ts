import { omitUndefined } from "@/utils/omitUndefined";
/**
 * Phase-3 user-provisioning reconciliation (safe-user-provisioning rollout).
 *
 * audit     Read-only sweep of Firebase Auth vs Firestore vs Postgres.
 *           Prints category counts and writes one JSONL line per audited
 *           user, orphaned store record, and email conflict.
 * backfill  Repairs what the audit finds through the same reconciliation
 *           core the ensureUserProfile mutation uses. DRY RUN by default:
 *           prints the planned actions and writes nothing.
 *
 * Usage:
 *   bun scripts/user-provisioning-reconcile.ts audit [--out <file>]
 *   bun scripts/user-provisioning-reconcile.ts backfill [--apply]
 *     [--create-missing] [--resume <log-file>] [--concurrency <n>] [--out <file>]
 *
 * Flags:
 *   --apply           Actually write. Without it, backfill only plans.
 *   --create-missing  Also create profiles for auth users missing BOTH
 *                     records. Off by default: an interrupted account
 *                     deletion leaves the same shape, so review the audit
 *                     before enabling this.
 *   --resume <file>   Skip users a previous run's log already marked success.
 *   --concurrency <n> Parallel users during backfill (default 5).
 *   --out <file>      Report/log destination (default ./provisioning-<mode>-<ts>.jsonl).
 *
 * Identity conflicts and orphaned store records are never written to; they
 * are reported for manual review (rollout plan Phase 3).
 */
import { appendFileSync, readFileSync } from "node:fs";

interface CliOptions {
	mode: "audit" | "backfill";
	apply: boolean;
	createMissing: boolean;
	resume?: string;
	concurrency: number;
	out?: string;
}

function usage(exitCode: number): never {
	console.log(
		"Usage: bun scripts/user-provisioning-reconcile.ts <audit|backfill> " +
			"[--apply] [--create-missing] [--resume <log-file>] [--concurrency <n>] [--out <file>]",
	);
	process.exit(exitCode);
}

function parseCliOptions(argv: string[]): CliOptions {
	const [mode, ...rest] = argv;
	if (mode === "--help" || mode === "-h" || mode === undefined) {
		usage(mode === undefined ? 1 : 0);
	}
	if (mode !== "audit" && mode !== "backfill") {
		console.error(`Unknown mode: ${mode}`);
		usage(1);
	}

	const options: CliOptions = {
		mode,
		apply: false,
		createMissing: false,
		concurrency: 5,
	};
	for (let index = 0; index < rest.length; index += 1) {
		const flag = rest[index];
		switch (flag) {
			case "--apply": {
				options.apply = true;
				break;
			}
			case "--create-missing": {
				options.createMissing = true;
				break;
			}
			case "--resume": {
				const value = rest[++index];
				if (!value) {
					console.error("--resume requires a log file path");
					usage(1);
				}
				options.resume = value;
				break;
			}
			case "--concurrency": {
				const value = Number(rest[++index]);
				if (!Number.isInteger(value) || value < 1) {
					console.error("--concurrency requires a positive integer");
					usage(1);
				}
				options.concurrency = value;
				break;
			}
			case "--out": {
				const value = rest[++index];
				if (!value) {
					console.error("--out requires a file path");
					usage(1);
				}
				options.out = value;
				break;
			}
			default: {
				console.error(`Unknown flag: ${flag}`);
				usage(1);
			}
		}
	}
	return options;
}

function readCompletedUids(logPath: string): Set<string> {
	const completed = new Set<string>();
	const contents = readFileSync(logPath, "utf8");
	for (const line of contents.split("\n")) {
		if (line.trim()) {
			try {
				const record = JSON.parse(line) as { uid?: string; status?: string };
				if (record.uid && record.status === "success") {
					completed.add(record.uid);
				}
			} catch {
				console.warn(`Skipping malformed log line: ${line.slice(0, 120)}`);
			}
		}
	}
	return completed;
}

async function main(): Promise<number> {
	const options = parseCliOptions(process.argv.slice(2));
	const timestamp = new Date().toISOString().replaceAll(":", "-");
	const outPath = options.out ?? `provisioning-${options.mode}-${timestamp}.jsonl`;

	// Heavy imports happen after arg parsing so --help never needs credentials.
	const { Effect } = await import("effect");
	const { managedRuntime } = await import("../src/effect/Runtime");
	const { auditProvisioningStateEffect, planBackfillAction, runProvisioningBackfillEffect } =
		await import("../src/services/onboarding/provisioningBackfill");

	// Log writes must never abort the run: a disk/permission hiccup mid-backfill
	// would otherwise stop in-flight repairs and truncate the --resume state.
	let appendFailures = 0;
	const appendLine = <Input>(record: Input) => {
		try {
			appendFileSync(outPath, `${JSON.stringify(record)}\n`);
		} catch (error) {
			appendFailures += 1;
			console.warn(`Failed to append to ${outPath}: ${String(error)}`);
		}
	};

	try {
		console.log(`Auditing provisioning state (${options.mode})...`);
		const audit = await managedRuntime.runPromise(auditProvisioningStateEffect);
		console.table(audit.counts);

		if (options.mode === "audit") {
			appendLine({ type: "summary", counts: audit.counts });
			for (const user of audit.users) {
				appendLine({ type: "user", ...user });
			}
			for (const orphan of audit.orphanedFirestore) {
				appendLine({ type: "orphan", store: "firestore", ...orphan });
			}
			for (const orphan of audit.orphanedPostgres) {
				appendLine({ type: "orphan", store: "postgres", ...orphan });
			}
			for (const conflict of audit.conflicts) {
				appendLine({ type: "conflict", ...conflict });
			}
			if (appendFailures > 0) {
				console.error(`${appendFailures} report lines failed to write to ${outPath}`);
				return 1;
			}
			console.log(`Audit report written to ${outPath}`);
			return 0;
		}

		const completedUids = options.resume ? readCompletedUids(options.resume) : undefined;
		if (completedUids) {
			console.log(`Resuming: ${completedUids.size} users already succeeded in ${options.resume}`);
		}
		const backfillOptions = omitUndefined({
			createMissing: options.createMissing,
			completedUids: completedUids || undefined,
		});

		if (!options.apply) {
			const planned = new Map<string, number>();
			for (const user of audit.users) {
				const plan = planBackfillAction(user, backfillOptions);
				const key = plan.action === "skip" ? `skip:${plan.reason}` : plan.action;
				planned.set(key, (planned.get(key) ?? 0) + 1);
			}
			console.log("DRY RUN — planned actions (pass --apply to execute):");
			console.table(Object.fromEntries([...planned.entries()].toSorted()));
			return 0;
		}

		console.log(`Applying backfill (concurrency ${options.concurrency})...`);
		const outcomes = await managedRuntime.runPromise(
			runProvisioningBackfillEffect(audit.users, {
				...backfillOptions,
				concurrency: options.concurrency,
				onOutcome: (outcome) => Effect.sync(() => appendLine(outcome)),
			}),
		);

		const totals = new Map<string, number>();
		for (const outcome of outcomes) {
			const key =
				outcome.status === "skipped"
					? `skipped:${outcome.reason}`
					: `${outcome.action}:${outcome.status}`;
			totals.set(key, (totals.get(key) ?? 0) + 1);
		}
		console.table(Object.fromEntries([...totals.entries()].toSorted()));
		if (appendFailures > 0) {
			console.error(
				`${appendFailures} outcome lines failed to write to ${outPath}; the --resume log is incomplete`,
			);
		} else {
			console.log(`Outcome log written to ${outPath}`);
		}

		const failures = outcomes.filter((outcome) => outcome.status === "failed");
		if (failures.length > 0) {
			console.error(`${failures.length} users failed; re-run with --resume ${outPath}`);
		}
		return failures.length > 0 || appendFailures > 0 ? 1 : 0;
	} finally {
		await managedRuntime.dispose();
	}
}

try {
	process.exit(await main());
} catch (error) {
	console.error(error);
	process.exit(1);
}
