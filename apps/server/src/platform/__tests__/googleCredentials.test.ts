import { withGoogleCredentialsFile } from "@/platform/googleCredentials";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const serviceAccountJson = JSON.stringify({
	type: "service_account",
	project_id: "example-project",
	client_email: "runtime@example-project.iam.gserviceaccount.com",
	private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
});

describe("withGoogleCredentialsFile", () => {
	let directory = "";

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "google-credentials-test-"));
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("writes the JSON to a 0600 file and points GOOGLE_APPLICATION_CREDENTIALS at it", async () => {
		const env = await withGoogleCredentialsFile(
			{ NODE_ENV: "production", GOOGLE_APPLICATION_CREDENTIALS_JSON: serviceAccountJson },
			directory,
		);

		const file = env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
		expect(file.startsWith(directory)).toBe(true);
		expect(await readFile(file, "utf8")).toBe(serviceAccountJson);
		const { mode } = await stat(file);
		expect(mode & 0o777).toBe(0o600);
		expect(env).toEqual({ NODE_ENV: "production", GOOGLE_APPLICATION_CREDENTIALS: file });
	});

	it("leaves the environment untouched without GOOGLE_APPLICATION_CREDENTIALS_JSON", async () => {
		const input = { NODE_ENV: "production", PORT: "8080" };

		expect(await withGoogleCredentialsFile(input, directory)).toEqual(input);
		expect(await readdir(directory)).toEqual([]);
	});

	it("keeps an explicit GOOGLE_APPLICATION_CREDENTIALS", async () => {
		const input = {
			GOOGLE_APPLICATION_CREDENTIALS: "/secrets/key.json",
			GOOGLE_APPLICATION_CREDENTIALS_JSON: serviceAccountJson,
		};

		expect(await withGoogleCredentialsFile(input, directory)).toEqual(input);
		expect(await readdir(directory)).toEqual([]);
	});

	it.each(["not json", "[]", JSON.stringify({ project_id: "missing-type" })])(
		"rejects malformed credentials without echoing them (%p)",
		async (value) => {
			const failure = withGoogleCredentialsFile(
				{ GOOGLE_APPLICATION_CREDENTIALS_JSON: value },
				directory,
			);

			await expect(failure).rejects.toThrow(
				"GOOGLE_APPLICATION_CREDENTIALS_JSON must be a Google credentials JSON object",
			);
			const rejection = await failure.catch((error: Error) => error);
			expect(String(rejection)).not.toContain(value);
			expect(await readdir(directory)).toEqual([]);
		},
	);
});
