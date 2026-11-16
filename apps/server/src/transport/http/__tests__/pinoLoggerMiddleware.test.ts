import { CMS_WEBHOOK_SECRET_HEADER } from "@/effect/services/cms/strapiWebhook";
import { prometheusRegistry } from "@/platform/observability/prometheusRegistry";
import { logOptions, pinoLogger } from "@/transport/http/pinoLoggerMiddleware";
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
// A dedicated Pino sink captures the actual middleware output without mocking logging.
// oxlint-disable-next-line no-restricted-imports
import pino from "pino";

describe("log levels", () => {
	it("writes the level as a name Railway can filter on", () => {
		const lines: string[] = [];
		const logger = pino(logOptions, { write: (line) => lines.push(line) });

		logger.warn("slow");
		logger.error("broken");

		expect(lines.map((line) => JSON.parse(line).level)).toEqual(["warn", "error"]);
	});
});

const requestLogsFor = async (path: string, status: 200 | 503) => {
	const lines: string[] = [];
	const app = new Hono();
	app.use(pinoLogger(pino(logOptions, { write: (line) => lines.push(line) })));
	app.get(path, (context) => context.text("probe", status));
	await app.request(`http://localhost${path}`);
	return lines.map((line) => JSON.parse(line));
};

const recordedLabels = async (label: "method" | "path_group") => {
	const histogram = prometheusRegistry.getSingleMetric("http_server_request_duration_seconds");
	const values = histogram ? (await histogram.get()).values : [];
	return new Set(values.map(({ labels }) => String(labels[label])));
};

describe("request metrics", () => {
	// Scanners probe thousands of paths; one label value per path exhausted Grafana's series limit.
	it("groups requests by the route that answered and every unmatched path together", async () => {
		const app = new Hono();
		app.use(pinoLogger(pino(logOptions, { write: () => {} })));
		app.get("/items/:id", (context) => context.text("item"));
		app.all("/v9/*", (context) => context.text("api"));

		await app.request("http://localhost/items/abc-123");
		await app.request("http://localhost/v9/reports/xyz");
		await app.request("http://localhost/.env.scanner-probe");
		await app.request("http://localhost/wp-admin/scanner-probe.php");

		const groups = await recordedLabels("path_group");
		expect(groups).toContain("/items/:id");
		expect(groups).toContain("/v9/*");
		expect(groups).toContain("unmatched");
		expect([...groups].filter((group) => /scanner-probe|abc-123|reports/u.test(group))).toEqual([]);
	});

	it("records methods outside the HTTP standard set as OTHER", async () => {
		const app = new Hono();
		app.use(pinoLogger(pino(logOptions, { write: () => {} })));

		await app.request("http://localhost/scanner-verb-probe", { method: "PROPFIND" });

		const methods = await recordedLabels("method");
		expect(methods).toContain("OTHER");
		expect(methods).not.toContain("PROPFIND");
	});
});

describe("health probe request logs", () => {
	it.each(["/", "/healthz", "/readyz"])(
		"leaves a passing %s probe out of info logs",
		async (path) => {
			expect(await requestLogsFor(path, 200)).toEqual([]);
		},
	);

	it("still logs a failing readiness probe", async () => {
		expect(await requestLogsFor("/readyz", 503)).toMatchObject([
			{ level: "info", path: "/readyz", status: 503 },
		]);
	});
});

describe("log redaction", () => {
	it("removes the CMS webhook secret header wherever a log line carries it", () => {
		const lines: string[] = [];
		const logger = pino(logOptions, {
			write: (line) => {
				lines.push(line);
			},
		});
		logger.info(
			{
				req: { headers: { [CMS_WEBHOOK_SECRET_HEADER]: "s3cret", "user-agent": "strapi" } },
				[CMS_WEBHOOK_SECRET_HEADER]: "s3cret",
			},
			"notice",
		);
		logger.child({ [CMS_WEBHOOK_SECRET_HEADER]: "s3cret" }).info("child");

		expect(lines.join("")).not.toContain("s3cret");
		expect(lines.map((line) => JSON.parse(line))).toMatchObject([
			{ req: { headers: { "user-agent": "strapi" } }, msg: "notice" },
			{ msg: "child" },
		]);
	});
});

describe("request log privacy", () => {
	it.each([200, 403, 404, 500] as const)(
		"omits all query parameters for status %s",
		async (status) => {
			const lines: string[] = [];
			const logger = pino(
				{ timestamp: false },
				{
					write: (line) => {
						lines.push(line);
					},
				},
			);
			const app = new Hono();
			app.use(pinoLogger(logger));
			app.get("/v1/attendance-exports/:id", (context) => context.text("result", status));
			const response = await app.request(
				"http://localhost/v1/attendance-exports/example?token=download-secret&token=second-secret&email=member%40example.com",
			);
			expect(response.status).toBe(status);
			const output = lines.join("");
			expect(output).not.toContain("download-secret");
			expect(output).not.toContain("second-secret");
			expect(output).not.toContain("member%40example.com");
			expect(output).not.toContain("?token");
			const requestLog = lines
				.map((line) => JSON.parse(line))
				.find((entry) => entry.method === "GET");
			expect(requestLog).toMatchObject({
				path: "/v1/attendance-exports/example",
				method: "GET",
				status,
			});
		},
	);
});
