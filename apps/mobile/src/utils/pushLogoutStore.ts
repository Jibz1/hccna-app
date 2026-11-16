import { Schema } from "effect";

const Registration = Schema.Struct({
  token: Schema.String,
  uid: Schema.String,
  logoutKey: Schema.String,
  pending: Schema.Boolean,
  legacyUserId: Schema.optional(Schema.String),
});
export type PushLogoutRegistration = typeof Registration.Type;
const decode = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Registration)),
);
const KEY = "registrations";

type Storage = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

// This device-scoped queue survives user-cache cleanup. It holds only device
// push capabilities, never a Firebase ID/refresh token or account credentials.
export function makePushLogoutStore(storage: Storage, randomKey: () => string) {
  const read = (): readonly PushLogoutRegistration[] =>
    decode(storage.getString(KEY) ?? "[]");
  const write = (entries: readonly PushLogoutRegistration[]) => {
    storage.set(KEY, JSON.stringify(entries));
  };
  const keyFor = (token: string, uid: string) => {
    const entries = read();
    const existing = entries.find(
      (entry) => entry.token === token && entry.uid === uid && !entry.pending,
    );
    if (existing) {
      return existing.logoutKey;
    }
    const logoutKey = randomKey();
    write([...entries, { token, uid, logoutKey, pending: false }]);
    return logoutKey;
  };
  const retire = (uid: string, legacyToken?: string) => {
    const entries = read();
    const next: PushLogoutRegistration[] = entries.map((entry) =>
      entry.uid === uid
        ? { ...entry, pending: true, legacyUserId: uid }
        : entry,
    );
    if (
      legacyToken &&
      !entries.some((entry) => entry.token === legacyToken && entry.uid === uid)
    ) {
      next.push({
        token: legacyToken,
        uid,
        logoutKey: randomKey(),
        pending: true,
        legacyUserId: uid,
      });
    }
    write(next);
  };
  const reconcile = (currentUid: string | undefined) => {
    write(
      read().map((entry) =>
        entry.uid !== currentUid ? { ...entry, pending: true } : entry,
      ),
    );
  };
  const pending = () => read().filter((entry) => entry.pending);
  const complete = (logoutKey: string) => {
    write(
      read().filter((entry) => entry.logoutKey !== logoutKey || !entry.pending),
    );
  };
  return { keyFor, retire, reconcile, pending, complete };
}
