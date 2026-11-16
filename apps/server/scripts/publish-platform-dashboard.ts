import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const grafanaOrigin = "https://hccna.grafana.net";
const dashboardUid = "hccna-backend-platforms";
const dashboardPath = new URL(
	"../observability/grafana/dashboards/backend-platforms.json",
	import.meta.url,
);

interface Panel {
	id: number;
	title: string;
	targets?: { expr?: string }[];
}

interface Dashboard {
	uid: string;
	id?: number;
	version?: number;
	panels: Panel[];
	templating: { list: { name: string; allValue?: string }[] };
}

interface SavedDashboard {
	dashboard: Dashboard & { id: number; version: number };
	meta: { folderUid: string };
}

interface PublishRequest {
	dashboard: Dashboard;
	folderUid: string;
	overwrite: false;
	message: string;
}

const [mode, ...extraArgs] = process.argv.slice(2);
if ((mode !== "--check" && mode !== "--publish") || extraArgs.length > 0) {
	throw new Error("Usage: bun scripts/publish-platform-dashboard.ts --check|--publish");
}

const token = process.env.GRAFANA_TOKEN;
if (!token) {
	throw new Error("Set GRAFANA_TOKEN in the environment or apps/server/.env");
}

class GrafanaHttpError extends Error {
	override readonly name = "GrafanaHttpError";
	readonly status: number;
	readonly detail: string;

	constructor(status: number, detail: string) {
		super(
			status === 412
				? `Grafana returned HTTP 412: ${detail}. The dashboard changed after it was read; inspect it before retrying.`
				: `Grafana returned HTTP ${status}: ${detail}`,
		);
		this.status = status;
		this.detail = detail;
	}
}

// Prometheus explains a rejected query in `error`; Grafana explains its own failures in `message`.
function errorDetail(body: string): string {
	try {
		const parsed = JSON.parse(body) as { error?: string; message?: string };
		return parsed.error ?? parsed.message ?? body.slice(0, 300);
	} catch {
		return body.slice(0, 300);
	}
}

async function grafana<ResponseBody>(
	path: string,
	payload?: PublishRequest,
): Promise<ResponseBody> {
	const response = await fetch(new URL(path, grafanaOrigin), {
		method: payload === undefined ? "GET" : "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: payload === undefined ? null : JSON.stringify(payload),
		redirect: "error",
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new GrafanaHttpError(response.status, errorDetail(await response.text()));
	}
	return (await response.json()) as ResponseBody;
}

const dashboard = JSON.parse(await readFile(dashboardPath, "utf8")) as Dashboard;
if (dashboard.uid !== dashboardUid) {
	throw new Error(`Expected dashboard UID ${dashboardUid}`);
}
const current = await grafana<SavedDashboard>(`/api/dashboards/uid/${dashboardUid}`);
const jobPattern = dashboard.templating.list.find((variable) => variable.name === "job")?.allValue;
if (!jobPattern) {
	throw new Error("The dashboard must define the job variable's allValue");
}

// Check PromQL against the real data source before changing the saved dashboard.
// Empty results are valid: idle backends and historical deployments may have no samples.
// Prometheus rejects a query with HTTP 400 or 422; return why, and let other failures stop the run.
async function queryProblem(expression: string, jobs: string): Promise<string | undefined> {
	// Validate the selected-range summary at the dashboard's default six-hour window.
	let query = expression.replaceAll("$job", jobs).replaceAll("$__range", "6h");
	for (const variable of dashboard.templating.list) {
		if (variable.allValue !== undefined) {
			query = query.replaceAll(`$${variable.name}`, variable.allValue);
		}
	}
	const params = new URLSearchParams({ query });
	try {
		const result = await grafana<{ status: string; error?: string }>(
			`/api/datasources/proxy/uid/grafanacloud-prom/api/v1/query?${params}`,
		);
		return result.status === "success" ? undefined : (result.error ?? result.status);
	} catch (error) {
		if (error instanceof GrafanaHttpError && (error.status === 400 || error.status === 422)) {
			return error.detail;
		}
		throw error;
	}
}

const queries: { panel: Panel; expression: string }[] = [];
for (const panel of dashboard.panels) {
	for (const target of panel.targets ?? []) {
		if (target.expr) {
			queries.push({ panel, expression: target.expr });
		}
	}
}
const problems = await Promise.all(
	queries.map(async ({ panel, expression }) => {
		const problem = await queryProblem(expression, jobPattern);
		return problem === undefined ? undefined : `Panel ${panel.id} (${panel.title}): ${problem}`;
	}),
);
const failures = problems.filter((problem) => problem !== undefined);
if (failures.length > 0) {
	throw new Error(
		`${failures.length} of ${queries.length} dashboard queries failed validation:\n${failures.join("\n")}`,
	);
}
console.log(`Validated ${queries.length} dashboard queries against Grafana.`);

if (mode === "--publish") {
	// Keep the live identity, folder, and version for optimistic concurrency control.
	// Never force-overwrite a dashboard changed after the read above.
	dashboard.id = current.dashboard.id;
	dashboard.version = current.dashboard.version;
	await grafana("/api/dashboards/db", {
		dashboard,
		folderUid: current.meta.folderUid,
		overwrite: false,
		message: "Publish the backend comparison dashboard from source",
	});
	const saved = await grafana<SavedDashboard>(`/api/dashboards/uid/${dashboardUid}`);
	if (!isDeepStrictEqual(saved.dashboard.panels, dashboard.panels)) {
		throw new Error("The saved panels differ from the submitted dashboard; inspect Grafana.");
	}
	console.log(`Published and verified dashboard version ${saved.dashboard.version}.`);
}
console.log(`${grafanaOrigin}/d/${dashboardUid}`);
