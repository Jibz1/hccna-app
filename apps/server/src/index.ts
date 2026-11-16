import "./instrument";
import { Main } from "@/effect/Main";
import { managedRuntime } from "@/effect/Runtime";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";

try {
	await managedRuntime.runPromise(Main);
} catch (error) {
	process.exitCode = 1;
	getLogger().error({ err: error }, "Application startup failed");
} finally {
	await managedRuntime.dispose();
}
