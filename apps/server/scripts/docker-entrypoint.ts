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

// Set RUN_MIGRATIONS=false on instances that must not migrate at start.
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
