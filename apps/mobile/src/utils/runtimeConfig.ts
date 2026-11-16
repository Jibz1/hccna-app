import {
  getRuntimeEasProjectId,
  getRuntimeEnvString,
  getRuntimeExpoExtraString,
} from "@/effect/runtimeConfigService";
import { runRuntimeConfigEffect } from "@/effect/runtimeConfigServiceLive";

export function getExpoExtraString(key: string): string | undefined {
  return runRuntimeConfigEffect(getRuntimeExpoExtraString(key));
}

export function getEnvString(key: string): string | undefined {
  return runRuntimeConfigEffect(getRuntimeEnvString(key));
}

export function getEasProjectId(): string | undefined {
  return runRuntimeConfigEffect(getRuntimeEasProjectId());
}
