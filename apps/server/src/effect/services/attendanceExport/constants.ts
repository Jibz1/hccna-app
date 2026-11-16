import { loadAppConfigSync } from "@/effect/AppConfig";

export const ATTENDANCE_CACHE_PREFIX = "event-attendance:v1";
export const ATTENDANCE_LRU_TTL_MS = 5 * 60 * 1000;
export const ATTENDANCE_REDIS_TTL_SECONDS = 15 * 60;
export const ATTENDANCE_DB_STALE_AFTER_MS = 30 * 60 * 1000;
export const BULK_CONCURRENCY_LIMIT = 5;
export const EXPORT_BUCKET = loadAppConfigSync().integrations.gcsExportBucket ?? "app-hccnj";
export const EXPORT_RENDER_VERSION = "v2-attended-only-with-meta";
export const OCCURRENCE_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/u;
