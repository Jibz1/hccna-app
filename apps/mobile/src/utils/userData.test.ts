import { beforeEach, describe, expect, test, vi } from "vitest";

const { cancelRegistration, captureException, clearStorage, operations } =
  vi.hoisted(() => {
    const operations: string[] = [];
    return {
      operations,
      cancelRegistration: vi.fn(async () => {
        operations.push("cancel-registration");
      }),
      captureException: vi.fn(),
      clearStorage: vi.fn(async () => {
        operations.push("clear-storage");
      }),
    };
  });

const auth = vi.hoisted(() => ({ uid: "old" as string | undefined }));
vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: auth.uid ? { uid: auth.uid } : null }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  auth.uid = "old";
  operations.length = 0;
});

vi.mock("@/utils/pushRegistration", () => ({
  cancelAndClearPushRegistration: cancelRegistration,
}));
vi.mock("@/utils/sentry", () => ({ captureException }));
vi.mock("@/utils/storageRegistry", () => ({
  clearUserScopedPersistence: clearStorage,
}));

describe("clearUserData", () => {
  test("cancels active push registration before clearing user storage", async () => {
    operations.length = 0;
    const { clearUserData } = await import("@/utils/userData");

    await clearUserData();

    expect(operations).toEqual(["cancel-registration", "clear-storage"]);
  });

  test("still purges user storage when registration cancellation fails", async () => {
    operations.length = 0;
    cancelRegistration.mockImplementationOnce(async () => {
      operations.push("cancel-registration");
      throw new Error("registration unavailable");
    });
    const { clearUserData } = await import("@/utils/userData");

    await expect(clearUserData()).resolves.toBeUndefined();

    expect(operations).toEqual(["cancel-registration", "clear-storage"]);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error));
  });
});

test("does not retire the next account or guest while clearing old user data", async () => {
  auth.uid = "new";
  const { clearUserData } = await import("@/utils/userData");
  await clearUserData("old");
  expect(cancelRegistration).not.toHaveBeenCalled();
  expect(clearStorage).toHaveBeenCalledOnce();
});

test("begins persistence cleanup before waiting for cancellation", async () => {
  let resolve!: () => void;
  cancelRegistration.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const { clearUserData } = await import("@/utils/userData");
  const cleanup = clearUserData("old");
  expect(clearStorage).toHaveBeenCalledOnce();
  resolve();
  await cleanup;
});
