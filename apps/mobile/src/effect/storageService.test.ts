import { Effect, Layer } from "effect";
import type { MMKV } from "react-native-mmkv";
import { describe, expect, test, vi } from "vitest";

import {
  createNativeMMKV,
  makeStorageService,
  StorageService,
  StorageServiceDependencies,
} from "@/effect/storageService";

function provideStorage(dependencies: StorageServiceDependencies) {
  return Layer.succeed(StorageService, makeStorageService(dependencies));
}

function makeDependencies(
  overrides: Partial<StorageServiceDependencies> = {},
): StorageServiceDependencies {
  return {
    createMMKV: vi.fn((config) => config as MMKV),
    getEncryptionKey: vi.fn(() => undefined),
    isDevelopment: vi.fn(() => false),
    supportsEncryption: vi.fn(() => true),
    ...overrides,
  };
}

describe("StorageService", () => {
  test("fails in production when an encrypted store has no encryption key", async () => {
    const dependencies = makeDependencies();

    const result = await Effect.runPromiseExit(
      createNativeMMKV({
        id: "secure-store",
        requiresEncryption: true,
      }).pipe(Effect.provide(provideStorage(dependencies))),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(String(result.cause)).toContain(
        "StorageEncryptionKeyMissingError",
      );
      expect(String(result.cause)).toContain("secure-store");
    }
    expect(dependencies.createMMKV).not.toHaveBeenCalled();
  });

  test("passes configured encryption key into MMKV", async () => {
    const dependencies = makeDependencies({
      getEncryptionKey: vi.fn(() => "secret-key"),
    });

    await Effect.runPromise(
      createNativeMMKV({
        id: "secure-store",
        requiresEncryption: true,
      }).pipe(Effect.provide(provideStorage(dependencies))),
    );

    expect(dependencies.createMMKV).toHaveBeenCalledWith({
      id: "secure-store",
      encryptionKey: "secret-key",
    });
  });
});
