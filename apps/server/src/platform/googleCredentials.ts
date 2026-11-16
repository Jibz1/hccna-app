import { Option, Schema } from "effect";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const decodeCredentials = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Struct({ type: Schema.String })),
);

/**
 * Hosts without a GCP metadata server (Railway) receive the service-account key
 * as GOOGLE_APPLICATION_CREDENTIALS_JSON. Writes it to a private file so
 * Application Default Credentials find it through GOOGLE_APPLICATION_CREDENTIALS,
 * and returns the server process environment without the raw JSON. Without
 * GOOGLE_APPLICATION_CREDENTIALS_JSON the environment passes through unchanged.
 */
export async function withGoogleCredentialsFile(
	env: NodeJS.ProcessEnv,
	directory = tmpdir(),
): Promise<NodeJS.ProcessEnv> {
	const { GOOGLE_APPLICATION_CREDENTIALS_JSON: json, ...rest } = env;
	if (!json || env.GOOGLE_APPLICATION_CREDENTIALS) {
		return env;
	}

	// Never include the value or a parser message in the error: both can echo the key.
	if (Option.isNone(decodeCredentials(json))) {
		throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON must be a Google credentials JSON object");
	}

	const file = join(await mkdtemp(join(directory, "google-credentials-")), "credentials.json");
	await writeFile(file, json, { mode: 0o600, flag: "wx" });
	return { ...rest, GOOGLE_APPLICATION_CREDENTIALS: file };
}
