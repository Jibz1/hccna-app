import { Predicate } from "effect";

type WithoutUndefined<T> = {
	[K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
	[K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Build an exact-optional object without manufacturing present `undefined` properties. */
export function omitUndefined<T>(value: T): WithoutUndefined<T> {
	const entries = Object.entries(value as Readonly<Record<string, never>>).filter(([, entry]) =>
		Predicate.isNotUndefined(entry),
	);
	return Object.fromEntries(entries) as WithoutUndefined<T>;
}
