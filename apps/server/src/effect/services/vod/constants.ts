import { loadAppConfigSync } from "@/effect/AppConfig";

export const LRU_CACHE_KEY = "vod:daily";
export const REDIS_CACHE_KEY = "vod:verseOfTheDay:v2";

// Entries carry their VOD date and are rejected after the configured timezone's
// day changes. setVerseOfTheDay invalidates both tiers, but only this replica's
// LRU and this host's Redis: other replicas, and any host the rotation never
// reaches, keep the replaced verse until these TTLs end.
export const LRU_TTL_MS = 30_000;
export const REDIS_TTL_SECONDS = 10 * 60;

export const VOD_TIMEZONE = loadAppConfigSync().vod.timezone;

// Day boundary follows the configured VOD timezone, not the server's locale.
const vodDayFormatter = new Intl.DateTimeFormat("en-CA", {
	timeZone: VOD_TIMEZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

export const getTodayDateString = (): string => vodDayFormatter.format(new Date());
