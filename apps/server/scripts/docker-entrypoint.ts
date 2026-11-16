import { withGoogleCredentialsFile } from "@/platform/googleCredentials";

async function runCommand(command: string[], envOverrides: NodeJS.ProcessEnv = {}) {
	const processEnv = { ...process.env, ...envOverrides };
	const child = Bun.spawn({
		cmd: command,
		env: processEnv,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});

	const exitCode = await child.exited;
	if (exitCode !== 0) {
		process.exit(exitCode);
	}
}

// Production (Railway) sets RUN_MIGRATIONS=false and migrates only through the
// manual "Drizzle Migrations CI" workflow.
if (process.env.RUN_MIGRATIONS !== "false") {
	console.log("Running database migrations...");
	await runCommand(["bun", "run", "db:migrate:run"]);
}

const serverProcess = Bun.spawn({
	cmd: ["bun", "./src/index.ts"],
	env: {
		...(await withGoogleCredentialsFile(process.env)),
		RUN_MIGRATIONS: "false",
	},
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});

const shutdown = () => {
	serverProcess.kill("SIGTERM");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.exit(await serverProcess.exited);
