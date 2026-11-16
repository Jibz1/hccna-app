import { builtInPluginManifests } from "@/modules/integrations/plugin-manifest";
import {
	assertCompatibleContractVersion,
	PluginManifestValidationError,
	validatePluginManifest,
	type PluginCapability,
	type PluginManifest,
} from "@/modules/integrations/telemetry/contracts";
import { getPluginActivationConfig, type PluginActivationConfig } from "@/platform/config/plugins";
import { Layer } from "effect";

function ensureRequiredCapabilities(
	manifests: PluginManifest[],
	requiredCapabilities: PluginCapability[],
) {
	const available = new Set(manifests.flatMap((manifest) => manifest.capabilities));

	for (const capability of requiredCapabilities) {
		if (!available.has(capability)) {
			throw new PluginManifestValidationError(
				`Missing required integration capability: ${capability}`,
			);
		}
	}
}

function resolveEnabledPluginManifests(
	config: PluginActivationConfig = getPluginActivationConfig(),
): PluginManifest[] {
	const selected =
		config.enabledPluginIds === "all"
			? builtInPluginManifests
			: builtInPluginManifests.filter((manifest) => config.enabledPluginIds.includes(manifest.id));

	if (selected.length === 0) {
		throw new PluginManifestValidationError("No integration plugins enabled for runtime");
	}

	const validated = selected.map((manifest) =>
		assertCompatibleContractVersion(
			validatePluginManifest(manifest),
			config.expectedContractVersion,
		),
	);

	ensureRequiredCapabilities(validated, config.requiredCapabilities);

	return validated;
}

export function createIntegrationPluginLayer(
	config: PluginActivationConfig = getPluginActivationConfig(),
): Layer.Layer<never, never, never> {
	const manifests = resolveEnabledPluginManifests(config);
	return manifests.reduce<Layer.Layer<never, never, never>>(
		(combinedLayer, manifest) => Layer.merge(combinedLayer, manifest.createLayer()),
		Layer.empty,
	);
}
