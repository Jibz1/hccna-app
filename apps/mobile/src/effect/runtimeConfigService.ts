import {
  flow,
  Predicate,
  Config,
  ConfigProvider,
  Context,
  Effect,
  Option,
  Schema,
} from "effect";

const RuntimeConfigRecord = Schema.Record(Schema.String, Schema.Unknown);
type RuntimeConfigRecord = typeof RuntimeConfigRecord.Type;

export type RuntimeConfigSources = {
  readonly easProjectId?: string;
  readonly embeddedManifestExtra?: unknown;
  readonly expoConfigExtra?: unknown;
  readonly updatesManifestExtra?: unknown;
};

export type RuntimeConfigServiceDependencies = {
  readonly getSources: () => RuntimeConfigSources;
};

export type RuntimeConfigServiceApi = {
  readonly getEasProjectId: () => Effect.Effect<string | undefined>;
  readonly getEnvString: (key: string) => Effect.Effect<string | undefined>;
  readonly getExpoExtra: () => Effect.Effect<RuntimeConfigRecord>;
  readonly getExpoExtraString: (
    key: string,
  ) => Effect.Effect<string | undefined>;
};

export class RuntimeConfigService extends Context.Service<
  RuntimeConfigService,
  RuntimeConfigServiceApi
>()("RuntimeConfigService") {}

const asRecord = flow(
  Schema.decodeUnknownOption(RuntimeConfigRecord),
  Option.getOrUndefined,
);

export function resolveExpoExtra(
  sources: RuntimeConfigSources,
): RuntimeConfigRecord {
  const expoConfigExtra = asRecord(sources.expoConfigExtra);
  if (expoConfigExtra) {
    return expoConfigExtra;
  }

  const embeddedManifestExtra = asRecord(sources.embeddedManifestExtra);
  if (embeddedManifestExtra) {
    return embeddedManifestExtra;
  }

  const updatesManifestExtra = asRecord(sources.updatesManifestExtra);
  const updatesExpoClientExtra = asRecord(
    asRecord(updatesManifestExtra?.expoClient)?.extra,
  );
  if (updatesExpoClientExtra) {
    return updatesExpoClientExtra;
  }

  return {};
}

export function makeRuntimeConfigService(
  dependencies: RuntimeConfigServiceDependencies,
): RuntimeConfigServiceApi {
  const getExpoExtraSync = () => resolveExpoExtra(dependencies.getSources());

  const getEnvString = Effect.fn("RuntimeConfigService.getEnvString")(
    function* (key: string) {
      const value = yield* Config.option(Config.String(key))
        .parse(ConfigProvider.fromEnv())
        .pipe(Effect.orElseSucceed(() => Option.none<string>()));
      const stringValue = Option.getOrUndefined(value);
      return stringValue && stringValue.length > 0 ? stringValue : undefined;
    },
  );

  const getExpoExtra = Effect.fn("RuntimeConfigService.getExpoExtra")(
    function* () {
      yield* Effect.void;
      return getExpoExtraSync();
    },
  );

  const getExpoExtraString = Effect.fn(
    "RuntimeConfigService.getExpoExtraString",
  )(function* (key: string) {
    const value = (yield* getExpoExtra())[key];
    return Predicate.isString(value) && value.length > 0 ? value : undefined;
  });

  const getEasProjectId = Effect.fn("RuntimeConfigService.getEasProjectId")(
    function* () {
      const easProjectId = dependencies.getSources().easProjectId;
      if (Predicate.isString(easProjectId) && easProjectId.length > 0) {
        return easProjectId;
      }

      const extraEas = asRecord((yield* getExpoExtra()).eas);
      const extraProjectId = extraEas?.projectId;

      return Predicate.isString(extraProjectId) && extraProjectId.length > 0
        ? extraProjectId
        : undefined;
    },
  );

  return {
    getEasProjectId,
    getEnvString,
    getExpoExtra,
    getExpoExtraString,
  };
}

export const getRuntimeExpoExtra = Effect.fn(
  "RuntimeConfigService.access.getExpoExtra",
)(function* () {
  const service = yield* RuntimeConfigService;
  return yield* service.getExpoExtra();
});

export const getRuntimeExpoExtraString = Effect.fn(
  "RuntimeConfigService.access.getExpoExtraString",
)(function* (key: string) {
  const service = yield* RuntimeConfigService;
  return yield* service.getExpoExtraString(key);
});

export const getRuntimeEnvString = Effect.fn(
  "RuntimeConfigService.access.getEnvString",
)(function* (key: string) {
  const service = yield* RuntimeConfigService;
  return yield* service.getEnvString(key);
});

export const getRuntimeEasProjectId = Effect.fn(
  "RuntimeConfigService.access.getEasProjectId",
)(function* () {
  const service = yield* RuntimeConfigService;
  return yield* service.getEasProjectId();
});
