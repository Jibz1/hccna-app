import { loadAppConfigSync } from "@/effect/AppConfig";

const appConfig = loadAppConfigSync();
const STELLATE_SERVICE_NAME = appConfig.observability.stellateServiceName;
const STELLATE_PURGE_TOKEN = appConfig.observability.stellatePurgeToken;

/**
 * Purges Stellate edge cache for the specified GraphQL operation names.
 * @see https://stellate.co/docs/graphql-edge-cache/purging-api
 */
export async function purgeStellateOperations(operationNames: string[]): Promise<void> {
	if (!STELLATE_PURGE_TOKEN) {
		console.warn("STELLATE_PURGE_TOKEN not set, skipping Stellate cache purge");
		return;
	}

	if (operationNames.length === 0) {
		return;
	}

	const namesJson = JSON.stringify(operationNames);
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 5000);

	try {
		const response = await fetch(`https://admin.stellate.co/${STELLATE_SERVICE_NAME}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"stellate-token": STELLATE_PURGE_TOKEN,
			},
			body: JSON.stringify({
				query: `mutation { _purgeOperationName(names: ${namesJson}) }`,
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			console.error(`Stellate purge failed: ${response.status} ${response.statusText}`);
		}
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			console.error("Stellate purge timed out");
			return;
		}
		console.error("Stellate purge error:", error);
	} finally {
		clearTimeout(timeoutId);
	}
}
