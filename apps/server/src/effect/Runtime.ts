import { AppConfigLive } from "@/effect/AppConfig";
import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import { LRUServiceLive } from "@/effect/LRUService";
import { RedisServiceLive } from "@/effect/RedisService";
import { AppLoggerServiceLive, PinoEffectLoggerLive } from "@/effect/services/AppLoggerService";
import { AttendanceExportServiceLive } from "@/effect/services/AttendanceExportService";
import { AuthServiceLive } from "@/effect/services/AuthService";
import { CampusPreferenceStoreLive } from "@/effect/services/CampusPreferenceStore";
import { CampusPushServiceLive } from "@/effect/services/CampusPushService";
import { CastrServiceLive } from "@/effect/services/CastrService";
import { CCBServiceLive } from "@/effect/services/CCBService";
import { CmsContentV5Live } from "@/effect/services/cms/content/v5Layer";
import { CMSServiceLive } from "@/effect/services/CMSService";
import { DbHealthServiceLive } from "@/effect/services/DbHealthService";
import { DrizzleServiceLive } from "@/effect/services/DrizzleService";
import { ExportStorageServiceLive } from "@/effect/services/ExportStorageService";
import { FirebaseAdminServiceLive } from "@/effect/services/FirebaseAdminService";
import { FirebaseAppCheckServiceLive } from "@/effect/services/FirebaseAppCheckService";
import { FirebaseAuthServiceLive } from "@/effect/services/FirebaseAuthService";
import { GivingServiceLive } from "@/effect/services/GivingService";
import { GraphQLRateLimitStoreServiceLive } from "@/effect/services/GraphQLRateLimitStoreService";
import { GraphQLResponseCacheServiceLive } from "@/effect/services/GraphQLResponseCacheService";
import { MailServiceLive } from "@/effect/services/MailService";
import { OperationalReadinessServiceLive } from "@/effect/services/OperationalReadinessService";
import { ProfileServiceLive } from "@/effect/services/ProfileService";
import { PushTokenServiceLive } from "@/effect/services/PushTokenService";
import { SavedVerseStoreLive } from "@/effect/services/SavedVerseStore";
import { ScriptureCatalogLive } from "@/effect/services/ScriptureCatalog";
import { ShortsServiceLive } from "@/effect/services/shorts/ShortsService";
import { StrapiStreamAclProviderLive } from "@/effect/services/StrapiStreamAclProvider";
import { StreamAuthorizationServiceLive } from "@/effect/services/StreamAuthorizationService";
import { StreamMappingServiceLive } from "@/effect/services/StreamMappingService";
import { StreamProjectionStoreLive } from "@/effect/services/StreamProjectionStore";
import { UserProfileUpdateServiceLive } from "@/effect/services/UserProfileUpdateService";
import { VodServiceLive } from "@/effect/services/VodService";
import { WordOfActivationServiceLive } from "@/effect/services/WordOfActivationService";
import { StatsigServiceLive } from "@/effect/StatsigService";
import { createIntegrationPluginLayer } from "@/modules/integrations/registry";
import { setObservabilityMetricContext } from "@/platform/observability/metricContext";
import { RedactedHeaderNamesLive } from "@/platform/observability/redaction";
import { UserProfileProvisioningServiceLive } from "@/services/onboarding/ensureUserProfile";
import { OnboardingProfileStoreLive } from "@/services/onboarding/onboardingProfileStore";
import { OnboardingQueueLive } from "@/services/onboarding/onboardingQueue";
import { HybridObservabilityLive } from "@/telemetry";
import {
	app,
	AppCollections,
	db,
	dbFieldValue,
	FBPaths,
	fieldPath,
	secondaryApp,
	secondaryDb,
} from "@/utils/firebase";
import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import { Effect, Layer, ManagedRuntime, Metric, type Context } from "effect";

const FirebaseLive = Layer.succeed(FirebaseAdminContext, {
	app,
	secondaryApp,
	db,
	secondaryDb,
	dbFieldValue,
	fieldPath,
	FBPaths,
	AppCollections,
});

const ObservabilityMetricContextLive = Layer.effectDiscard(
	Effect.contextWith((context: Context.Context<never>) =>
		Effect.sync(() => {
			setObservabilityMetricContext(context);
		}),
	),
);

// ─── Tier 0: Core infrastructure ─────────────────────────────
// PinoEffectLoggerLive sits beneath everything so Effect's default console
// logger is replaced by the pino sink before HybridObservabilityLive's OTLP
// logger merges itself on top — one JSON line shape for both logging worlds.
const CoreLayer = Layer.mergeAll(
	BunCrypto.layer,
	AppConfigLive,
	AppLoggerServiceLive,
	DrizzleServiceLive,
	FirebaseAdminServiceLive,
	FirebaseLive,
	HybridObservabilityLive,
	Metric.enableRuntimeMetricsLayer,
	ObservabilityMetricContextLive,
	RedactedHeaderNamesLive,
	createIntegrationPluginLayer(),
).pipe(Layer.provideMerge(PinoEffectLoggerLive));

// ─── Tier 1: Config/cache/auth foundations ───────────────────
const CacheLayer = Layer.mergeAll(RedisServiceLive, LRUServiceLive).pipe(
	Layer.provideMerge(CoreLayer),
);
const FirebaseAuthLayer = FirebaseAuthServiceLive.pipe(Layer.provideMerge(CacheLayer));

// ─── Tier 2: Infrastructure services ─────────────────────────
const InfraLayer = Layer.mergeAll(
	OnboardingQueueLive,
	ExportStorageServiceLive,
	MailServiceLive,
	StatsigServiceLive,
	GraphQLResponseCacheServiceLive,
	GraphQLRateLimitStoreServiceLive,
	OperationalReadinessServiceLive,
	AuthServiceLive,
	FirebaseAppCheckServiceLive,
)
	.pipe(Layer.provideMerge(DbHealthServiceLive))
	.pipe(Layer.provideMerge(FirebaseAuthLayer));

// ─── Tier 3: External foundations ────────────────────────────
const BaseLayer = CmsContentV5Live.pipe(Layer.provideMerge(InfraLayer));

// ─── Tier 4: Independent domain services ─────────────────────
const DomainLayer = Layer.mergeAll(
	CampusPreferenceStoreLive,
	VodServiceLive,
	CastrServiceLive,
	CCBServiceLive,
	CMSServiceLive,
	ProfileServiceLive,
	PushTokenServiceLive,
	SavedVerseStoreLive,
	ScriptureCatalogLive,
	ShortsServiceLive,
	StrapiStreamAclProviderLive,
	StreamProjectionStoreLive,
).pipe(Layer.provideMerge(BaseLayer));

// ─── Tier 5: Domain services with domain dependencies ─────────
// Exported so the HttpApi web handler can share the same layer object (and,
// through the shared memoMap, the same service instances) as managedRuntime.
const CampusLayer = Layer.mergeAll(CampusPushServiceLive, OnboardingProfileStoreLive).pipe(
	Layer.provideMerge(DomainLayer),
);

export const AppLayer = Layer.mergeAll(
	WordOfActivationServiceLive,
	GivingServiceLive,
	UserProfileProvisioningServiceLive,
	UserProfileUpdateServiceLive,
	StreamAuthorizationServiceLive,
	StreamMappingServiceLive,
	AttendanceExportServiceLive,
).pipe(Layer.provideMerge(CampusLayer));

export const managedRuntime = ManagedRuntime.make(AppLayer);
