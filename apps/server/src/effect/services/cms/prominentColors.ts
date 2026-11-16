import { DEFAULT_PROMINENT_COLORS } from "@/effect/services/cms/constants";
import { Vibrant } from "node-vibrant/node";

import type { ProminentColors } from "@/effect/services/cms/types";

export interface StoredProminentColors {
	prominentColorDark: string | null;
	prominentColorLight: string | null;
	prominentColorAccent: string | null;
}

type ExtractedProminentColors = StoredProminentColors;

interface VibrantSwatch {
	hex: string;
}

interface VibrantPalette {
	Vibrant?: VibrantSwatch | null;
	Muted?: VibrantSwatch | null;
	DarkVibrant?: VibrantSwatch | null;
	DarkMuted?: VibrantSwatch | null;
	LightVibrant?: VibrantSwatch | null;
	LightMuted?: VibrantSwatch | null;
}

export function resolveProminentColors(
	colors: Partial<StoredProminentColors> | null | undefined,
): ProminentColors {
	return {
		dark: colors?.prominentColorDark ?? DEFAULT_PROMINENT_COLORS.dark,
		light: colors?.prominentColorLight ?? DEFAULT_PROMINENT_COLORS.light,
		accent: colors?.prominentColorAccent ?? DEFAULT_PROMINENT_COLORS.accent,
	};
}

export function hasCompleteStoredProminentColors(
	colors: StoredProminentColors | null | undefined,
): colors is StoredProminentColors {
	return Boolean(
		colors?.prominentColorDark && colors.prominentColorLight && colors.prominentColorAccent,
	);
}

export function mergeProminentColors(
	existing: StoredProminentColors | null | undefined,
	extracted: ExtractedProminentColors,
	mode: "replace" | "fill-missing",
): StoredProminentColors {
	if (mode === "replace") {
		return {
			prominentColorDark: extracted.prominentColorDark ?? null,
			prominentColorLight: extracted.prominentColorLight ?? null,
			prominentColorAccent: extracted.prominentColorAccent ?? null,
		};
	}

	return {
		prominentColorDark: existing?.prominentColorDark ?? extracted.prominentColorDark ?? null,
		prominentColorLight: existing?.prominentColorLight ?? extracted.prominentColorLight ?? null,
		prominentColorAccent: existing?.prominentColorAccent ?? extracted.prominentColorAccent ?? null,
	};
}

export async function extractProminentColorsFromImageUrl(
	imageUrl: string,
): Promise<ExtractedProminentColors> {
	const palette = (await Vibrant.from(imageUrl)
		.maxColorCount(64)
		.maxDimension(256)
		.getPalette()) as VibrantPalette;

	return {
		prominentColorDark: pickHex([palette.DarkVibrant, palette.DarkMuted, palette.Muted]) ?? null,
		prominentColorLight:
			pickHex([palette.LightVibrant, palette.LightMuted, palette.Vibrant]) ?? null,
		prominentColorAccent: pickHex([palette.Vibrant, palette.Muted, palette.DarkVibrant]) ?? null,
	};
}

function pickHex(swatches: (VibrantSwatch | null | undefined)[]): string | undefined {
	for (const swatch of swatches) {
		const hex = normalizeHex(swatch?.hex);
		if (hex) {
			return hex;
		}
	}
	return undefined;
}

function normalizeHex(value: string | null | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const hex = value.trim();
	const match = /^#?(?<hex>[0-9a-fA-F]{6})$/u.exec(hex);
	if (!match?.groups?.hex) {
		return undefined;
	}

	return `#${match.groups.hex.toUpperCase()}`;
}
