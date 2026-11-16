import { getCorrelationContext } from "@/platform/observability";
import { Context } from "effect";
import { getConnInfo } from "hono/bun";

import type { Context as HonoContext } from "hono";

export interface RequestAuthPrincipal {
	readonly uid?: string | undefined;
	readonly email?: string | undefined;
	readonly authType?: string | null | undefined;
	readonly authorized?: boolean | undefined;
}

export interface RequestContextInput {
	readonly requestId?: string | undefined;
	readonly method: string;
	readonly path: string;
	readonly headers: Headers;
	readonly signal: AbortSignal;
	readonly clientIp?: string | undefined;
	readonly auth?: RequestAuthPrincipal | undefined;
}

export interface RequestContextContract extends RequestContextInput {
	readonly correlation: {
		readonly requestId?: string | undefined;
		readonly traceId?: string | undefined;
		readonly spanId?: string | undefined;
	};
}

export class RequestContext extends Context.Service<RequestContext, RequestContextContract>()(
	"RequestContext",
) {}

export function buildRequestContextFromInput(input: RequestContextInput): RequestContextContract {
	return {
		...input,
		correlation: getCorrelationContext(input.headers, input.requestId),
	};
}

export function buildRequestContext(context: HonoContext): RequestContextContract {
	let clientIp = context.req.header("X-Forwarded-For");

	if (!clientIp) {
		try {
			clientIp = getConnInfo(context).remote.address;
		} catch {
			clientIp = undefined;
		}
	}

	return buildRequestContextFromInput({
		requestId: context.var.requestId,
		method: context.req.method,
		path: context.req.path,
		headers: context.req.raw.headers,
		signal: context.req.raw.signal,
		clientIp,
	});
}

export function buildRequestContextFromRequest(
	request: Request,
	input?: {
		readonly requestId?: string | undefined;
		readonly clientIp?: string | undefined;
		readonly auth?: RequestAuthPrincipal | undefined;
	},
): RequestContextContract {
	return buildRequestContextFromInput({
		requestId: input?.requestId,
		method: request.method,
		path: new URL(request.url).pathname,
		headers: request.headers,
		signal: request.signal,
		clientIp: input?.clientIp,
		auth: input?.auth,
	});
}
