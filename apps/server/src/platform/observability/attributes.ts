import { Predicate } from "effect";

import type { Attributes } from "@opentelemetry/api";

type AttributeValue = Attributes[string];
type AttributeInputValue = AttributeValue | null | undefined;

function isSpanAttributeValue<Input>(value: Input): value is Input & AttributeValue {
	if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) {
		return true;
	}

	return (
		Array.isArray(value) &&
		value.every(
			(item) => Predicate.isString(item) || Predicate.isNumber(item) || Predicate.isBoolean(item),
		)
	);
}

export function compactSpanAttributes(
	attributes: Readonly<Record<string, AttributeInputValue>>,
): Attributes {
	return Object.fromEntries(
		Object.entries(attributes).filter((entry): entry is [string, AttributeValue] =>
			isSpanAttributeValue(entry[1]),
		),
	);
}
