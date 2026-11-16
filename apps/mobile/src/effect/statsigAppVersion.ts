export function resolveStatsigAppVersion(
  expoConfigVersion: string | null | undefined,
  nativeApplicationVersion: string | null | undefined,
): string | undefined {
  return expoConfigVersion ?? nativeApplicationVersion ?? undefined;
}
