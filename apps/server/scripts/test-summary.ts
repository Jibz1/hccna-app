#!/usr/bin/env bun
import { $ } from "bun";
/**
 * Test Summary Script
 * Runs tests and outputs a formatted summary
 *
 * Usage: bun scripts/test-summary.ts [path]
 * Example: bun scripts/test-summary.ts src/graphql/__tests__/
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const COLORS = {
	reset: "\u001B[0m",
	bold: "\u001B[1m",
	green: "\u001B[32m",
	red: "\u001B[31m",
	yellow: "\u001B[33m",
	cyan: "\u001B[36m",
	dim: "\u001B[2m",
};

interface TestResult {
	file: string;
	tests: number;
	passed: number;
	failed: number;
}

interface FailedTest {
	name: string;
	file: string;
	duration?: string;
}

interface ParsedTestOutput {
	totalPass: number;
	totalFail: number;
	totalExpect: number;
	totalFiles: number;
	duration: string;
	files: TestResult[];
	failedTests: FailedTest[];
}

const DEFAULT_TEST_ROOTS = ["src", "packages"] as const;
const TEST_FILE_PATTERN = /\.(?:test|spec)\.tsx?$/u;
const PROJECT_TEST_FILE_PATTERN = /(?:src|packages)\/[^\s:]+\.(?:test|spec)\.tsx?/gu;

function collectTestFiles(directory: string): string[] {
	if (!existsSync(directory)) {
		return [];
	}

	const files: string[] = [];

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...collectTestFiles(path));
		} else if (entry.isFile() && TEST_FILE_PATTERN.test(path)) {
			files.push(path);
		}
	}

	return files;
}

function collectDefaultTestFiles(): string[] {
	return DEFAULT_TEST_ROOTS.flatMap((root) => collectTestFiles(root)).toSorted();
}

async function runTests(args: string[]): Promise<{
	output: string;
	exitCode: number;
}> {
	const testArgs = args.length > 0 ? args : collectDefaultTestFiles();

	if (testArgs.length === 0) {
		throw new Error("No test files found under src or packages.");
	}

	const result = await $`bun test ${testArgs}`.quiet().nothrow();
	return {
		output: result.stderr.toString() + result.stdout.toString(),
		exitCode: result.exitCode,
	};
}

function parseTestOutput(output: string): ParsedTestOutput {
	// Parse summary line: " 46 pass\n 0 fail\n 123 expect() calls\nRan 46 tests across 11 files. [927.00ms]"
	const passMatch = output.match(/(?<count>\d+)\s+pass/u);
	const failMatch = output.match(/(?<count>\d+)\s+fail/u);
	const expectMatch = output.match(/(?<count>\d+)\s+expect\(\)/u);
	const summaryMatch = output.match(
		/Ran\s+(?<tests>\d+)\s+tests\s+across\s+(?<files>\d+)\s+files\.\s+\[(?<duration>[^\]]+)\]/u,
	);

	const totalPass = passMatch ? Number(passMatch.groups?.count ?? "0") : 0;
	const totalFail = failMatch ? Number(failMatch.groups?.count ?? "0") : 0;
	const totalExpect = expectMatch ? Number(expectMatch.groups?.count ?? "0") : 0;
	const totalFiles = summaryMatch ? Number(summaryMatch.groups?.files ?? "0") : 0;
	const duration = summaryMatch?.groups?.duration ?? "unknown";

	// Parse individual file results
	const files: TestResult[] = [];
	const fileMatches = output.match(PROJECT_TEST_FILE_PATTERN) || [];
	const uniqueFiles = [...new Set(fileMatches)];

	for (const file of uniqueFiles) {
		files.push({
			file,
			tests: 0,
			passed: 0,
			failed: output.includes(`${file}:`) ? 1 : 0,
		});
	}

	// Parse failed test names
	// Bun format: "(fail) TestSuite > testName [duration]"
	const failedTests: FailedTest[] = [];
	const failedTestPattern = /\(fail\)\s+(?<name>.+?)\s+\[(?<duration>[^\]]+)\]/gu;
	let match = failedTestPattern.exec(output);
	while (match !== null) {
		const testName = match.groups?.name?.trim() ?? "";
		const testDuration = match.groups?.duration ?? "";

		// Try to find the file for this test by looking for file path before the fail line
		const beforeFail = output.slice(0, match.index);
		const fileInContext = beforeFail.match(PROJECT_TEST_FILE_PATTERN);
		const file = fileInContext?.at(-1) ?? "unknown";

		failedTests.push({
			name: testName,
			file,
			duration: testDuration,
		});
		match = failedTestPattern.exec(output);
	}

	return {
		totalPass,
		totalFail,
		totalExpect,
		totalFiles,
		duration,
		files,
		failedTests,
	};
}

function printSummary(results: ReturnType<typeof parseTestOutput>): void {
	const { totalPass, totalFail, totalExpect, totalFiles, duration, failedTests } = results;
	const allPassed = totalFail === 0;

	console.log("\n");
	console.log(
		`${COLORS.bold}═══════════════════════════════════════════════════════════${COLORS.reset}`,
	);
	console.log(
		`${COLORS.bold}                    TEST SUMMARY                           ${COLORS.reset}`,
	);
	console.log(
		`${COLORS.bold}═══════════════════════════════════════════════════════════${COLORS.reset}`,
	);
	console.log();

	// Status
	if (allPassed) {
		console.log(`  ${COLORS.green}${COLORS.bold}✓ ALL TESTS PASSED${COLORS.reset}`);
	} else {
		console.log(`  ${COLORS.red}${COLORS.bold}✗ SOME TESTS FAILED${COLORS.reset}`);
	}
	console.log();

	// Display failed tests if any
	if (failedTests.length > 0) {
		console.log(`  ${COLORS.red}${COLORS.bold}Failed Tests:${COLORS.reset}`);
		console.log();
		for (const test of failedTests) {
			console.log(`  ${COLORS.red}✗${COLORS.reset} ${test.name}`);
			console.log(
				`    ${COLORS.dim}${test.file}${test.duration ? ` [${test.duration}]` : ""}${COLORS.reset}`,
			);
		}
		console.log();
	}

	// Stats table
	console.log(`  ${COLORS.cyan}┌─────────────────┬──────────┐${COLORS.reset}`);
	console.log(
		`  ${COLORS.cyan}│${COLORS.reset} ${COLORS.bold}Metric${COLORS.reset}          ${COLORS.cyan}│${COLORS.reset} ${COLORS.bold}Value${COLORS.reset}    ${COLORS.cyan}│${COLORS.reset}`,
	);
	console.log(`  ${COLORS.cyan}├─────────────────┼──────────┤${COLORS.reset}`);
	console.log(
		`  ${COLORS.cyan}│${COLORS.reset} Tests Passed    ${COLORS.cyan}│${COLORS.reset} ${COLORS.green}${String(totalPass).padStart(6)}${COLORS.reset}   ${COLORS.cyan}│${COLORS.reset}`,
	);
	console.log(
		`  ${COLORS.cyan}│${COLORS.reset} Tests Failed    ${COLORS.cyan}│${COLORS.reset} ${totalFail > 0 ? COLORS.red : COLORS.dim}${String(totalFail).padStart(6)}${COLORS.reset}   ${COLORS.cyan}│${COLORS.reset}`,
	);
	console.log(
		`  ${COLORS.cyan}│${COLORS.reset} Assertions      ${COLORS.cyan}│${COLORS.reset} ${String(totalExpect).padStart(6)}   ${COLORS.cyan}│${COLORS.reset}`,
	);
	console.log(
		`  ${COLORS.cyan}│${COLORS.reset} Test Files      ${COLORS.cyan}│${COLORS.reset} ${String(totalFiles).padStart(6)}   ${COLORS.cyan}│${COLORS.reset}`,
	);
	console.log(
		`  ${COLORS.cyan}│${COLORS.reset} Duration        ${COLORS.cyan}│${COLORS.reset} ${duration.padStart(6)}   ${COLORS.cyan}│${COLORS.reset}`,
	);
	console.log(`  ${COLORS.cyan}└─────────────────┴──────────┘${COLORS.reset}`);

	console.log();

	// Pass rate
	const total = totalPass + totalFail;
	const passRate = total > 0 ? ((totalPass / total) * 100).toFixed(1) : "100.0";
	const barWidth = 30;
	const filledWidth = Math.round((Number(passRate) / 100) * barWidth);
	const emptyWidth = barWidth - filledWidth;
	const progressBar = `${COLORS.green}${"█".repeat(filledWidth)}${COLORS.dim}${"░".repeat(emptyWidth)}${COLORS.reset}`;

	console.log(`  ${COLORS.bold}Pass Rate:${COLORS.reset} ${passRate}%`);
	console.log(`  ${progressBar}`);

	console.log();
	console.log(
		`${COLORS.dim}═══════════════════════════════════════════════════════════${COLORS.reset}`,
	);
	console.log();
}

const testArgs = process.argv.slice(2);
const isVerbose = testArgs.includes("--verbose") || testArgs.includes("-v");
const filteredArgs = testArgs.filter((arg) => arg !== "--verbose" && arg !== "-v");

console.log(
	`\n${COLORS.cyan}Running tests${filteredArgs.length > 0 ? ` with args: ${filteredArgs.join(" ")}` : " in src and packages"}...${COLORS.reset}\n`,
);

const { output, exitCode } = await runTests(filteredArgs);
const results = parseTestOutput(output);

printSummary(results);

// Output raw test output when tests fail (for CI debugging)
if (results.totalFail > 0 || isVerbose) {
	console.log(`${COLORS.dim}─── Raw Test Output ───${COLORS.reset}`);
	console.log(output);
	console.log(`${COLORS.dim}─── End Raw Output ───${COLORS.reset}\n`);
}

process.exit(exitCode);
