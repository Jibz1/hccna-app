import { CMSService, type CoreData } from "@/effect/services/CMSService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect } from "effect";

import type { GraphQLContext } from "@/graphql/context";

const STATSIG_CORE_SORT_MORE_LINKS_GATE = "graphql_core_sort_more_links";

interface MoreLinks {
	title: string;
	subTitle: string;
	iconName: string;
	link: string;
	group: "Other" | "Get Connected";
}

interface CCBform {
	id: number;
	title: string;
	url: string;
	campus_id: number;
	status: string;
}

interface CCBFormsSuccess {
	_tag: "CCBFormsSuccess";
	forms: CCBform[];
}

interface CCBFormsFetchError {
	_tag: "CCBFormsFetchError";
	message: string;
}

interface CCBFormsNotFoundError {
	_tag: "CCBFormsNotFoundError";
	message: string;
}

type CCBFormsResult = CCBFormsSuccess | CCBFormsFetchError | CCBFormsNotFoundError;

function sortMoreLinks(links: MoreLinks[]): MoreLinks[] {
	return links.toSorted((left, right) => {
		const groupComparison = left.group.localeCompare(right.group);
		if (groupComparison !== 0) {
			return groupComparison;
		}

		return left.title.localeCompare(right.title);
	});
}

const CCBFormRef = builder.objectRef<CCBform>("CCBForm").implement({
	fields: (t) => ({
		id: t.exposeInt("id"),
		title: t.exposeString("title"),
		// description: t.exposeString('description'),
		url: t.exposeString("url"),
		campus_id: t.exposeInt("campus_id"),
		status: t.exposeString("status"),
	}),
});

const CCBFormsSuccessType = builder.objectRef<CCBFormsSuccess>("CCBFormsSuccess").implement({
	fields: (t) => ({
		forms: t.field({
			type: [CCBFormRef],
			description: "Active publicly listed CCB forms",
			resolve: (root) => root.forms,
		}),
	}),
});

const CCBFormsFetchErrorType = builder
	.objectRef<CCBFormsFetchError>("CCBFormsFetchError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message describing what went wrong",
			}),
		}),
	});

const CCBFormsNotFoundErrorType = builder
	.objectRef<CCBFormsNotFoundError>("CCBFormsNotFoundError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message when CCB forms cannot be found",
			}),
		}),
	});

const CCBFormsResultType = builder.unionType("CCBFormsResult", {
	types: [CCBFormsSuccessType, CCBFormsFetchErrorType, CCBFormsNotFoundErrorType],
	resolveType: (value) => {
		switch (value._tag) {
			case "CCBFormsSuccess": {
				return CCBFormsSuccessType;
			}
			case "CCBFormsFetchError": {
				return CCBFormsFetchErrorType;
			}
			case "CCBFormsNotFoundError": {
				return CCBFormsNotFoundErrorType;
			}
		}
	},
});

const BaseRef = builder.objectRef<{ featureImge: string; copy: string }>("Base").implement({
	fields: (t) => ({
		featureImge: t.exposeString("featureImge"),
		copy: t.exposeString("copy"),
	}),
});

const MoreLinksRef = builder.objectRef<MoreLinks>("MoreLinks").implement({
	fields: (t) => ({
		title: t.exposeString("title"),
		subTitle: t.exposeString("subTitle"),
		iconName: t.exposeString("iconName"),
		link: t.exposeString("link"),
		group: t.exposeString("group"),
	}),
});

const MoreLinksRefType = builder
	.objectRef<{
		featureImge: string;
		copy: string;
		links: MoreLinks[];
	}>("MoreLinksRefType")
	.implement({
		fields: (t) => ({
			featureImge: t.exposeString("featureImge"),
			copy: t.exposeString("copy"),
			links: t.field({
				type: [MoreLinksRef],
				resolve: (root, _args, ctx) =>
					ctx.statsig.checkGate(STATSIG_CORE_SORT_MORE_LINKS_GATE)
						? sortMoreLinks(root.links)
						: root.links,
			}),
		}),
	});

const CoreRef = builder.objectRef<CoreData>("Core").implement({
	fields: (t) => ({
		giving: t.field({ type: BaseRef, resolve: (root) => root.giving }),
		profile: t.field({ type: BaseRef, resolve: (root) => root.profile }),
		sermons: t.field({ type: BaseRef, resolve: (root) => root.sermons }),
		hccexpression: t.field({
			type: BaseRef,
			resolve: (root) => root.hccexpression,
		}),
		events: t.field({ type: BaseRef, resolve: (root) => root.events }),
		more: t.field({ type: MoreLinksRefType, resolve: (root) => root.more }),
	}),
});

const toCCBFormsFetchMessage = (cause: unknown) =>
	cause instanceof Error ? cause.message : "Failed to fetch CCB forms";

const resolveCCBFormsV2 = (ctx: GraphQLContext): Promise<CCBFormsResult> => {
	const program = Effect.tryPromise({
		try: () => ctx.loaders.ccbForms.load("ccbForms"),
		catch: (error) => error,
	}).pipe(
		Effect.map((forms): CCBFormsResult => {
			if (!forms) {
				return {
					_tag: "CCBFormsNotFoundError",
					message: "CCB forms were not found",
				};
			}

			return {
				_tag: "CCBFormsSuccess",
				forms,
			};
		}),
		Effect.withSpan("GraphQL.ccbFormsV2"),
		Effect.catch((error) =>
			Effect.succeed({
				_tag: "CCBFormsFetchError" as const,
				message: toCCBFormsFetchMessage(error),
			}),
		),
	);

	return ctx.effect.runPromise(program);
};

builder.queryFields((t) => ({
	core: t.field({
		type: CoreRef,
		authScopes: authScope.authorized,
		resolve: async (_, __, ctx) => {
			const program = Effect.gen(function* () {
				const service = yield* CMSService;
				return yield* service.getCoreSettings;
			}).pipe(Effect.withSpan("GraphQL.core"));

			return await ctx.effect.runPromise(program);
		},
	}),

	ccbFormsV2: t.field({
		type: CCBFormsResultType,
		description: "Get CCB forms with typed success and error responses",
		resolve: (_, __, ctx) => resolveCCBFormsV2(ctx),
	}),
}));
