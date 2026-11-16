import type { Config } from "stellate";

const config: Config = {
	config: {
		name: "hccna",
		schema: "https://api.hccnj.org/graphql",
		// bypassCacheHeaders: [{ name: 'authorization' }],
		originUrl: "https://api.hccnj.org/graphql",
		enablePlayground: true,
		mutationPolicy: "List",
		scopes: {
			AUTHENTICATED: {
				definition: "header:authorization",
			},
		},
		rootTypeNames: {
			query: "Query",
		},
		nonCacheable: ["Mutation", "User.profile", "getPreviousFiveYearsGivingV2", "profile"],
		rules: [
			{
				types: {
					Query: [
						"campuses",
						"campusesV2",
						"ccbForms",
						"ccbFormsV2",
						"events",
						"home",
						"featuredEvents",
						"thoughtOfGod",
						"core",
						"verseOfTheDay",
						"verseOfTheDayV2",
						"sermons",
					],
				},
				maxAge: 1800,
				swr: 1800,
				description: "Cache Core and Campuses",
			},
		],
		schemaPolling: {
			enabled: true,
		},
		cacheIntrospection: true,
		devPortal: {
			enabled: false,
		},
		graphiql: {
			enabled: true,
		},
		persistedOperations: {
			// We do not use APQ, so disable:
			apq: false,
			// We use Stellate as our persisted operation registry, so no need to forward them to the server:
			sendHashToOrigin: false,
			// Only allow persisted queries in API requests (DISABLED FOR NOW, ENABLE BEFORE WE GO LIVE)
			rejectInvalidHashes: false,
		},
	},
};

export default config;
