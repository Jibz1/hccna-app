import { loadAppConfigSync } from "@/effect/AppConfig";

import type { PluginCapability } from "@/modules/integrations/telemetry/contracts";

const requiredPluginCapabilities: PluginCapability[] = [
	"auth",
	"cache",
	"churchApi",
	"cms",
	"messaging",
	"streaming",
];

export interface PluginActivationConfig {
	enabledPluginIds: "all" | string[];
	requiredCapabilities: PluginCapability[];
	expectedContractVersion: string;
}

const appConfig = loadAppConfigSync();

export function getPluginActivationConfig(): PluginActivationConfig {
	return {
		enabledPluginIds: appConfig.plugins.enabledPluginIds,
		requiredCapabilities: requiredPluginCapabilities,
		expectedContractVersion: appConfig.plugins.expectedContractVersion,
	};
}
