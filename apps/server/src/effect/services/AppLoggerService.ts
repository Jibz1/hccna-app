import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import {
	Cause,
	Context,
	Effect,
	Layer,
	Logger,
	Predicate,
	References,
	type LogLevel,
} from "effect";

type LogFieldValue =
	| string
	| number
	| boolean
	| bigint
	| null
	| undefined
	| Error
	| readonly LogFieldValue[]
	| { readonly [key: string]: LogFieldValue };

export type LogFields = Readonly<Record<string, LogFieldValue>>;

interface AppLoggerServiceContract {
	debug: (message: string, fields?: LogFields) => void;
	info: (message: string, fields?: LogFields) => void;
	warn: (message: string, fields?: LogFields) => void;
	error: (message: string, fields?: LogFields) => void;
}

export class AppLoggerService extends Context.Service<AppLoggerService, AppLoggerServiceContract>()(
	"AppLoggerService",
	{
		make: Effect.succeed({
			debug: (message: string, fields: LogFields = {}) => {
				getLogger().debug(fields, message);
			},
			info: (message: string, fields: LogFields = {}) => {
				getLogger().info(fields, message);
			},
			warn: (message: string, fields: LogFields = {}) => {
				getLogger().warn(fields, message);
			},
			error: (message: string, fields: LogFields = {}) => {
				getLogger().error(fields, message);
			},
		} satisfies AppLoggerServiceContract),
	},
) {}

export const AppLoggerServiceLive = Layer.effect(AppLoggerService, AppLoggerService.make);

/**
 * Minimal pino surface the Effect logger writes through. Matches pino's
 * `logger[level](fields, message)` call shape so `getLogger()` satisfies it
 * directly and tests can substitute a recording stub.
 */
interface PinoLikeLogger {
	trace: (fields: LogFields, message: string) => void;
	debug: (fields: LogFields, message: string) => void;
	info: (fields: LogFields, message: string) => void;
	warn: (fields: LogFields, message: string) => void;
	error: (fields: LogFields, message: string) => void;
	fatal: (fields: LogFields, message: string) => void;
}

type PinoLevel = keyof PinoLikeLogger;

function toPinoLevel(level: LogLevel.LogLevel): PinoLevel | undefined {
	switch (level) {
		case "All":
		case "Trace": {
			return "trace";
		}
		case "Debug": {
			return "debug";
		}
		case "Info": {
			return "info";
		}
		case "Warn": {
			return "warn";
		}
		case "Error": {
			return "error";
		}
		case "Fatal": {
			return "fatal";
		}
		case "None": {
			return undefined;
		}
	}
}

/**
 * Effect `Logger` that writes through the shared pino instance, so Effect
 * `Effect.log*` calls and promise-land `getLogger()` calls share one sink and
 * one JSON line shape ({level, msg, time, ...fields}) in production.
 *
 * Log annotations become pino fields; a non-empty cause is rendered under
 * `cause`; non-string message parts merge into fields (single plain object)
 * or land under `messageParts`.
 */
/**
 * A structured part is only merged into top-level fields when it is a plain
 * record (Object.prototype or a null prototype). Non-plain objects — Date, Map,
 * Set, class instances — carry their data as non-enumerable/exotic state that
 * Object.assign would drop to {}, so they stay in messageParts instead.
 */
const isPlainRecord = <T>(value: T): value is T & Record<string, LogFieldValue> => {
	if (!Predicate.isObject(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

function makePinoEffectLogger(resolveLogger: () => PinoLikeLogger): Logger.Logger<unknown, void> {
	return Logger.make((options) => {
		const level = toPinoLevel(options.logLevel);
		if (level === undefined) {
			return;
		}

		const parts = Array.isArray(options.message) ? options.message : [options.message];
		const textParts = parts.filter((part) => Predicate.isString(part));
		// Errors carry message/stack as non-enumerable own properties, so the
		// Object.assign merge below would flatten them to {}. Wrap Error parts
		// into a serializable `error` field; other parts pass through.
		const structuredParts = parts
			.filter((part) => !Predicate.isString(part))
			.map((part) => {
				if (part instanceof Error) {
					const errorFields: LogFields =
						part.stack === undefined
							? { name: part.name, message: part.message }
							: { name: part.name, message: part.message, stack: part.stack };
					return { error: errorFields };
				}
				return part;
			});

		// Log annotations and structured message parts are arbitrary caller data;
		// LogFields is the widest shape pino serializes, so asserting here is the
		// sink-boundary parse. Only a single plain record is spread into fields;
		// Date/Map/class instances would Object.assign to {} (own-enumerable
		// loss), and arrays are not fields, so those land under messageParts.
		const extraFields: Record<string, LogFieldValue> = {};
		const [firstStructured] = structuredParts;
		if (structuredParts.length === 1 && isPlainRecord(firstStructured)) {
			Object.assign(extraFields, firstStructured);
		} else if (structuredParts.length > 0) {
			extraFields.messageParts = structuredParts as readonly LogFieldValue[];
		}
		if (options.cause.reasons.length > 0) {
			extraFields.cause = Cause.pretty(options.cause);
		}

		const fields = {
			...(options.fiber.getRef(References.CurrentLogAnnotations) as LogFields),
			...extraFields,
		};

		resolveLogger()[level](fields, textParts.join(" "));
	});
}

/**
 * Replaces Effect's default console logger with the pino-backed logger.
 * Provided beneath the runtime layer stack (see Runtime.ts) so every Effect
 * log call emits through pino; the OTLP logger layer still merges itself on
 * top via `mergeWithExisting: true`.
 */
export const PinoEffectLoggerLive = Logger.layer([makePinoEffectLogger(getLogger)], {
	mergeWithExisting: false,
});
