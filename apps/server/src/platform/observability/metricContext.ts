import { Context } from "effect";

let observabilityMetricContext: Context.Context<never> = Context.empty();

export function getObservabilityMetricContext(): Context.Context<never> {
	return observabilityMetricContext;
}

export function setObservabilityMetricContext(context: Context.Context<never>): void {
	observabilityMetricContext = context;
}
