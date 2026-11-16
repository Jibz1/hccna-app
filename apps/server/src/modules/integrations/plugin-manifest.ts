import { Layer } from "effect";

import type { PluginManifest } from "@/modules/integrations/telemetry/contracts";

const pluginContractVersion = "1.0.0";

const emptyLayer = () => Layer.empty;

export const builtInPluginManifests: PluginManifest[] = [
	{
		id: "ccb",
		version: "1.0.0",
		contractVersion: pluginContractVersion,
		capabilities: ["churchApi"],
		createLayer: emptyLayer,
	},
	{
		id: "cms",
		version: "1.0.0",
		contractVersion: pluginContractVersion,
		capabilities: ["cms"],
		createLayer: emptyLayer,
	},
	{
		id: "castr",
		version: "1.0.0",
		contractVersion: pluginContractVersion,
		capabilities: ["streaming"],
		createLayer: emptyLayer,
	},
	{
		id: "firebase",
		version: "1.0.0",
		contractVersion: pluginContractVersion,
		capabilities: ["auth", "messaging"],
		createLayer: emptyLayer,
	},
	{
		id: "sendgrid",
		version: "1.0.0",
		contractVersion: pluginContractVersion,
		capabilities: ["messaging"],
		createLayer: emptyLayer,
	},
	{
		id: "redis",
		version: "1.0.0",
		contractVersion: pluginContractVersion,
		capabilities: ["cache"],
		createLayer: emptyLayer,
	},
	{
		id: "strapi",
		version: "1.0.0",
		contractVersion: pluginContractVersion,
		capabilities: ["cms"],
		createLayer: emptyLayer,
	},
];
