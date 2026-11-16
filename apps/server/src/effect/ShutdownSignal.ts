import { Effect } from "effect";

export type ShutdownSignal = "SIGINT" | "SIGTERM";
type ShutdownListener = () => void;

export interface ShutdownSignalSource {
	on: (signal: ShutdownSignal, listener: ShutdownListener) => void;
	off: (signal: ShutdownSignal, listener: ShutdownListener) => void;
}

const processShutdownSignalSource: ShutdownSignalSource = {
	on: (signal, listener) => {
		process.on(signal, listener);
	},
	off: (signal, listener) => {
		process.off(signal, listener);
	},
};

export function waitForShutdownSignal(
	source: ShutdownSignalSource = processShutdownSignalSource,
): Effect.Effect<ShutdownSignal> {
	return Effect.callback<ShutdownSignal>((resume) => {
		let settled = false;

		const cleanup = () => {
			source.off("SIGINT", onSigint);
			source.off("SIGTERM", onSigterm);
		};

		const complete = (signal: ShutdownSignal) => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			resume(Effect.succeed(signal));
		};

		const onSigint = () => complete("SIGINT");
		const onSigterm = () => complete("SIGTERM");

		source.on("SIGINT", onSigint);
		source.on("SIGTERM", onSigterm);

		return Effect.sync(cleanup);
	});
}
