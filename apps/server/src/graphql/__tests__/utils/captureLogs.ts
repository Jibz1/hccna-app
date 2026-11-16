import { Logger, References } from "effect";

/** Replaces Effect's loggers; keeps each line as `<level> <message> <annotations as JSON>`. */
export const captureLogs = () => {
	const lines: string[] = [];
	const layer = Logger.layer([
		Logger.make((options) => {
			const message = [options.message].flat().join(" ");
			const annotations = JSON.stringify(options.fiber.getRef(References.CurrentLogAnnotations));
			lines.push(`${options.logLevel} ${message} ${annotations}`);
		}),
	]);
	return { lines, layer };
};
