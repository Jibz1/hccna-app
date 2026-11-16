import { omitUndefined } from "@/utils/omitUndefined";
import {
	StatsigUser,
	type ClientInitResponseOptions,
	type DynamicConfig,
	type DynamicConfigEvaluationOptions,
	type Experiment,
	type ExperimentEvaluationOptions,
	type FeatureGate,
	type FeatureGateEvaluationOptions,
	type Layer,
	type LayerEvaluationOptions,
} from "@statsig/statsig-node-core";

import type { StatsigServiceContract } from "@/effect/StatsigService";

interface StatsigRequestUser {
	readonly currentUserUid: string | null;
	readonly currentUserEmail: string | null;
	readonly environment: string;
}

export interface GraphQLStatsigFacade {
	readonly enabled: boolean;
	checkGate: (gateName: string, options?: FeatureGateEvaluationOptions) => boolean;
	getFeatureGate: (gateName: string, options?: FeatureGateEvaluationOptions) => FeatureGate;
	getDynamicConfig: (configName: string, options?: DynamicConfigEvaluationOptions) => DynamicConfig;
	getExperiment: (experimentName: string, options?: ExperimentEvaluationOptions) => Experiment;
	getLayer: (layerName: string, options?: LayerEvaluationOptions) => Layer;
	getClientInitializeResponse: (options?: ClientInitResponseOptions) => string;
}

export function buildStatsigUser({
	currentUserUid,
	currentUserEmail,
	environment,
}: StatsigRequestUser): StatsigUser {
	const sharedFields = {
		custom: { environment },
		statsigEnvironment: { tier: environment },
	};

	if (currentUserUid) {
		return new StatsigUser(
			omitUndefined({
				userID: currentUserUid,
				...sharedFields,
				privateAttributes: currentUserEmail ? { email: currentUserEmail } : undefined,
			}),
		);
	}

	return new StatsigUser(
		omitUndefined({
			customIDs: { anonymousID: "server-anonymous-user" },
			...sharedFields,
			privateAttributes: currentUserEmail ? { email: currentUserEmail } : undefined,
		}),
	);
}

export function createGraphQLStatsigFacade(
	statsigService: StatsigServiceContract,
	statsigUser: StatsigUser,
): GraphQLStatsigFacade {
	return {
		enabled: statsigService.enabled,
		checkGate: (gateName, options) => statsigService.checkGate(statsigUser, gateName, options),
		getFeatureGate: (gateName, options) =>
			statsigService.getFeatureGate(statsigUser, gateName, options),
		getDynamicConfig: (configName, options) =>
			statsigService.getDynamicConfig(statsigUser, configName, options),
		getExperiment: (experimentName, options) =>
			statsigService.getExperiment(statsigUser, experimentName, options),
		getLayer: (layerName, options) => statsigService.getLayer(statsigUser, layerName, options),
		getClientInitializeResponse: (options) =>
			statsigService.getClientInitializeResponse(statsigUser, options),
	};
}
