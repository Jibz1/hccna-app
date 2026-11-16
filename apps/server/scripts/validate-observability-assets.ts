import { Result, Schema } from "effect";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TargetSchema = Schema.Struct({ expr: Schema.optional(Schema.String) });
const PanelSchema = Schema.Struct({ targets: Schema.optional(Schema.Array(TargetSchema)) });
const VariableSchema = Schema.Struct({ name: Schema.String });
const TemplatingSchema = Schema.Struct({ list: Schema.Array(VariableSchema) });

const DashboardSchema = Schema.Struct({
	title: Schema.NonEmptyString,
	panels: Schema.Array(PanelSchema).check(Schema.isMinLength(1)),
	templating: Schema.optional(TemplatingSchema),
});

// Every deployment pushes the same metric names; `job` (service.namespace/service.name) tells them apart.
const JOB_FILTER = 'job=~"$job"';

function assert<Condition>(condition: Condition, message: string): asserts condition {
	if (!condition) {
		throw new Error(`observability-assets: ${message}`);
	}
}

const root = process.cwd();
const dashboardDir = join(root, "observability/grafana/dashboards");
const dashboards = readdirSync(dashboardDir)
	.filter((file) => file.endsWith(".json"))
	.map((file) => join(dashboardDir, file));
assert(dashboards.length > 0, "no dashboards found");

for (const dashboardPath of dashboards) {
	const raw = readFileSync(dashboardPath, "utf8");
	const result = Schema.decodeUnknownResult(DashboardSchema)(JSON.parse(raw));
	if (Result.isFailure(result)) {
		throw new Error(
			`observability-assets: invalid dashboard schema: ${dashboardPath} (${String(result.failure)})`,
		);
	}

	const dashboard = result.success;
	assert(
		dashboard.templating?.list.some((variable) => variable.name === "job"),
		`dashboard missing job variable: ${dashboardPath}`,
	);
	const exprs = dashboard.panels
		.flatMap((panel) => panel.targets ?? [])
		.flatMap((target) => target.expr ?? []);
	for (const expr of exprs) {
		// Every range selector (`[5m]`) needs its own filter; a bare gauge still needs one.
		const selectors = Math.max(1, expr.split("[").length - 1);
		const filters = expr.split(JOB_FILTER).length - 1;
		assert(
			filters >= selectors,
			`dashboard query has a selector without ${JOB_FILTER}: ${dashboardPath}: ${expr}`,
		);
	}
}

const alertPath = join(root, "observability/grafana/alerts/slo-alerts.yaml");
const alertRaw = readFileSync(alertPath, "utf8");
const alertDoc = Bun.YAML.parse(alertRaw) as
	| {
			apiVersion?: number;
			groups?: {
				rules?: {
					alert?: string;
					title?: string;
					labels?: {
						severity?: string;
					};
					data?: {
						model?: {
							expr?: string;
						};
					}[];
				}[];
			}[];
	  }
	| undefined;

assert(alertDoc?.apiVersion === 1, "alert file missing apiVersion");
assert(Array.isArray(alertDoc.groups), "alert file missing groups block");

const rules = alertDoc.groups.flatMap((group) => group.rules ?? []);
const severities = new Set(
	rules
		.map((rule) => rule.labels?.severity)
		.filter((value): value is string => value !== undefined && value.length > 0),
);
const ruleNames = new Set(
	rules.map((rule) => rule.alert ?? rule.title ?? "").filter((value) => value.length > 0),
);

// Each host must be judged on its own traffic, so every aggregation keeps `job`.
for (const rule of rules) {
	const exprs = (rule.data ?? []).flatMap((query) => query.model?.expr ?? []);

	for (const expr of exprs) {
		for (const { groups } of expr.matchAll(/\bsum\b\s*(?:by\s*\((?<groupBy>[^)]*)\))?/gu)) {
			const groupBy = groups?.groupBy?.split(",").map((label) => label.trim()) ?? [];
			assert(
				groupBy.includes("job"),
				`alert aggregation not grouped by job: ${rule.title ?? rule.alert}: ${expr}`,
			);
		}
	}
}

assert(severities.has("page"), "alert file missing page severity rule");
assert(severities.has("warn"), "alert file missing warn severity rule");
assert(
	ruleNames.has("GraphQL p95 latency above 800ms"),
	"alert file missing GraphQL p95 alert rule",
);
assert(ruleNames.has("REST p95 latency above 500ms"), "alert file missing REST p95 alert rule");

console.log("observability-assets: ok");
