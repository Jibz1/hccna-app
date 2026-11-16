import type { Layer } from "effect";

export type PluginCapability = "auth" | "cache" | "churchApi" | "cms" | "messaging" | "streaming";

export interface PluginManifest {
	id: string;
	version: string;
	contractVersion: string;
	capabilities: PluginCapability[];
	createLayer: () => Layer.Layer<never, never, never>;
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;

export class PluginManifestValidationError extends Error {
	readonly _tag = "PluginManifestValidationError";
	override readonly name = "PluginManifestValidationError";
}

export function validatePluginManifest(manifest: PluginManifest): PluginManifest {
	if (!manifest.id || manifest.id.trim().length === 0) {
		throw new PluginManifestValidationError("Plugin id is required");
	}

	if (!SEMVER_PATTERN.test(manifest.version)) {
		throw new PluginManifestValidationError(
			`Plugin ${manifest.id} has invalid version: ${manifest.version}`,
		);
	}

	if (!SEMVER_PATTERN.test(manifest.contractVersion)) {
		throw new PluginManifestValidationError(
			`Plugin ${manifest.id} has invalid contractVersion: ${manifest.contractVersion}`,
		);
	}

	if (manifest.capabilities.length === 0) {
		throw new PluginManifestValidationError(
			`Plugin ${manifest.id} must declare at least one capability`,
		);
	}

	return manifest;
}

export function assertCompatibleContractVersion(
	manifest: PluginManifest,
	expectedVersion: string,
): PluginManifest {
	if (manifest.contractVersion !== expectedVersion) {
		throw new PluginManifestValidationError(
			`Plugin ${manifest.id} contract version ${manifest.contractVersion} does not match expected ${expectedVersion}`,
		);
	}

	return manifest;
}
