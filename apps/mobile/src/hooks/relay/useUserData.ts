import { getAuth } from "@react-native-firebase/auth";
import { useAtomValue } from "jotai";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  fetchQuery,
  graphql,
  useRelayEnvironment,
  type GraphQLTaggedNode,
} from "react-relay";
import {
  Observable,
  createOperationDescriptor,
  getRequest,
  type Environment,
  type FetchQueryFetchPolicy,
  type OperationType,
} from "relay-runtime";

import { environmentAtom } from "@/environment";
import type { UserGivingQuery } from "@/hooks/relay/__generated__/UserGivingQuery.graphql";
import type { UserProfileQuery } from "@/hooks/relay/__generated__/UserProfileQuery.graphql";
import type { UserWoaQuery } from "@/hooks/relay/__generated__/UserWoaQuery.graphql";
import { useConnectivityStatus } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { createRelayQuerySnapshotStore } from "@/relay/querySnapshotStore";
import {
  resolveGivingHistory,
  resolveUserProfile,
  resolveWordOfActivation,
  type UserProfile,
  type WordOfActivation,
  type YearlyGiving,
} from "@/relay/userData";
import { createUserDataRefreshCoordinator } from "@/relay/userDataRefreshCoordinator";
import { getRelayAuthScope } from "@/utils/relayPersistence";

export type {
  UserProfile,
  WordOfActivation,
  YearlyGiving,
} from "@/relay/userData";

export const UserProfileQueryDocument = graphql`
  query UserProfileQuery {
    user {
      profile {
        ccbFamilyId
        ccbId
        createdAt
        email
        enrichmentPending
        firstName
        img
        isVerified
        lastName
        phone
        provider
        uid
        preferredCampusSlug
        campusPreferenceVersion
        departments {
          ccbId
          description
          fullName
          image
          link
          name
          slug
        }
      }
    }
  }
`;

export const UserWoaQueryDocument = graphql`
  query UserWoaQuery {
    user {
      woa {
        book
        email
        image
        month
        monthlySub
        name
        stBook
        text
        verseId
      }
    }
  }
`;

export const UserGivingQueryDocument = graphql`
  query UserGivingQuery {
    myGivingHistory {
      __typename
      ... on MyGivingHistorySuccess {
        years {
          ccbId
          numberOfGiving
          total
          year
          giving {
            amount
            campus
            campusId
            date
            name
            paymentType
            taxDeductible
            transactionId
          }
          groupGivingByMonth {
            month
            givingList {
              amount
              campus
              campusId
              date
              name
              paymentType
              taxDeductible
              transactionId
            }
            number
            total
          }
        }
      }
      ... on MyGivingHistoryFetchError {
        message
      }
      ... on MyGivingHistoryNotFoundError {
        message
      }
    }
  }
`;

const EMPTY_VARIABLES = {};
export const USER_DATA_REFRESH_INTERVAL_MS = 60_000;
const lastGivingSuccesses = new WeakMap<
  Environment,
  Map<string, readonly YearlyGiving[]>
>();
const completedRefreshes = new WeakMap<Environment, Map<string, number>>();
const loadedProfileUids = new WeakMap<Environment, string>();
const profileRequests = new WeakMap<
  Environment,
  {
    readonly promise: Promise<UserProfile | null>;
    readonly uid: string;
  }
>();
const userDataRefreshCoordinator = createUserDataRefreshCoordinator({
  onComplete: (environment, operationName) => {
    recordUserDataQueryRefresh(environment, operationName);
  },
  onError: (error) => {
    console.warn("[Relay] Failed to refresh user data:", error);
  },
});

export function useAuthenticatedUid(): string | undefined {
  const authScope = useAtomValue(environmentAtom)?.authScope;
  const user = getAuth().currentUser;
  const uid = user?.isAnonymous ? undefined : user?.uid;
  return uid && authScope === getRelayAuthScope(uid) ? uid : undefined;
}

export function shouldRefreshUserDataQuery(
  environment: Environment,
  operationName: string,
  now: number = Date.now(),
): boolean {
  const completedAt = completedRefreshes.get(environment)?.get(operationName);
  return (
    completedAt === undefined ||
    now - completedAt >= USER_DATA_REFRESH_INTERVAL_MS
  );
}

export function recordUserDataQueryRefresh(
  environment: Environment,
  operationName: string,
  completedAt: number = Date.now(),
): void {
  const refreshes = completedRefreshes.get(environment) ?? new Map();
  refreshes.set(operationName, completedAt);
  completedRefreshes.set(environment, refreshes);
}

export function useRelayQuerySnapshot<TQuery extends OperationType>(
  query: GraphQLTaggedNode,
): TQuery["response"] {
  const environment = useRelayEnvironment();
  const operation = useMemo(
    () => createOperationDescriptor(getRequest(query), EMPTY_VARIABLES),
    [query],
  );
  const snapshotStore = useMemo(
    () =>
      createRelayQuerySnapshotStore<TQuery["response"]>(environment, operation),
    [environment, operation],
  );

  return useSyncExternalStore(
    snapshotStore.subscribe,
    snapshotStore.getSnapshot,
    snapshotStore.getSnapshot,
  );
}

export function useRefreshQuery<TQuery extends OperationType>({
  enabled,
  fetchPolicy,
  query,
}: {
  enabled: boolean;
  fetchPolicy: FetchQueryFetchPolicy;
  query: GraphQLTaggedNode;
}) {
  const environment = useRelayEnvironment();
  const connectivity = useConnectivityStatus();

  const [attempt, setAttempt] = useState(0);
  const [requestState, setRequestState] = useState<{
    environment: Environment;
    query: GraphQLTaggedNode;
    status: "error" | "complete";
    attempt: number;
  }>();
  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled || connectivity === "offline") {
      return;
    }

    const operationName = getRequest(query).params.name;
    if (
      attempt === 0 &&
      !shouldRefreshUserDataQuery(environment, operationName)
    ) {
      return;
    }

    let active = true;
    const refresh = userDataRefreshCoordinator.start({
      environment,
      execute: () =>
        fetchQuery<TQuery>(environment, query, EMPTY_VARIABLES, {
          fetchPolicy,
        }),
      operationName,
    });

    void refresh.promise.then(
      () => {
        if (active) {
          setRequestState({ environment, query, attempt, status: "complete" });
        }
      },
      () => {
        if (active) {
          setRequestState({ environment, query, attempt, status: "error" });
        }
      },
    );
    return () => {
      active = false;
      refresh.release();
    };
  }, [attempt, connectivity, enabled, environment, fetchPolicy, query]);

  const currentRequest =
    requestState?.environment === environment &&
    requestState.query === query &&
    requestState.attempt === attempt;
  const shouldStart =
    attempt > 0 ||
    shouldRefreshUserDataQuery(environment, getRequest(query).params.name);
  const status =
    !enabled || connectivity === "offline"
      ? undefined
      : currentRequest
        ? requestState.status
        : shouldStart
          ? "loading"
          : undefined;
  return { status, retry };
}

export async function fetchUserProfileQuery(
  environment: Environment,
  fetchPolicy: FetchQueryFetchPolicy = "network-only",
  signal?: AbortSignal,
): Promise<UserProfile | null> {
  const expectedUid = getAuth().currentUser?.uid;
  if (!expectedUid || signal?.aborted) {
    return null;
  }

  const request = fetchQuery<UserProfileQuery>(
    environment,
    UserProfileQueryDocument,
    EMPTY_VARIABLES,
    { fetchPolicy },
  );
  const cancellableRequest = signal
    ? Observable.create<UserProfileQuery["response"]>((sink) => {
        const onAbort = () => {
          sink.complete();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          sink.complete();
        }
        const subscription = sink.closed ? null : request.subscribe(sink);
        return () => {
          signal.removeEventListener("abort", onAbort);
          subscription?.unsubscribe();
        };
      })
    : request;
  const result = await cancellableRequest.toPromise();
  if (signal?.aborted || getAuth().currentUser?.uid !== expectedUid) {
    return null;
  }

  const profile = resolveUserProfile(result, expectedUid);
  if (profile) {
    loadedProfileUids.set(environment, expectedUid);
    return profile;
  }

  return null;
}

export function ensureUserProfileQuery(
  environment: Environment,
): Promise<UserProfile | null> {
  const expectedUid = getAuth().currentUser?.uid;
  if (!expectedUid) {
    return Promise.resolve(null);
  }

  if (loadedProfileUids.get(environment) === expectedUid) {
    const operation = createOperationDescriptor(
      getRequest(UserProfileQueryDocument),
      EMPTY_VARIABLES,
    );
    const result = environment.lookup(operation.fragment)
      .data as UserProfileQuery["response"];
    const profile = resolveUserProfile(result, expectedUid);
    if (profile) {
      return Promise.resolve(profile);
    }
  }

  const currentRequest = profileRequests.get(environment);
  if (currentRequest?.uid === expectedUid) {
    return currentRequest.promise;
  }

  const request = fetchUserProfileQuery(environment);
  profileRequests.set(environment, { promise: request, uid: expectedUid });
  const clearRequest = () => {
    if (profileRequests.get(environment)?.promise === request) {
      profileRequests.delete(environment);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export function useUserProfile(): UserProfile | null {
  const environment = useRelayEnvironment();
  const connectivity = useConnectivityStatus();
  const result = useRelayQuerySnapshot<UserProfileQuery>(
    UserProfileQueryDocument,
  );
  const expectedUid = useAuthenticatedUid();

  useEffect(() => {
    if (!expectedUid || connectivity === "offline") {
      return;
    }

    void ensureUserProfileQuery(environment).catch((error) => {
      console.warn("[Relay] Failed to load user profile:", error);
    });
  }, [connectivity, environment, expectedUid]);

  return resolveUserProfile(result, expectedUid);
}

export function useWordOfActivation({
  refresh = true,
}: {
  refresh?: boolean;
} = {}): WordOfActivation | null {
  const result = useRelayQuerySnapshot<UserWoaQuery>(UserWoaQueryDocument);
  const expectedUid = useAuthenticatedUid();
  useRefreshQuery<UserWoaQuery>({
    enabled: expectedUid !== undefined && refresh,
    fetchPolicy: "network-only",
    query: UserWoaQueryDocument,
  });

  return resolveWordOfActivation(result);
}

export function useGivingHistory({
  refresh = true,
}: {
  refresh?: boolean;
} = {}) {
  const environment = useRelayEnvironment();
  const result = useRelayQuerySnapshot<UserGivingQuery>(
    UserGivingQueryDocument,
  );
  const expectedUid = useAuthenticatedUid();
  const connectivity = useConnectivityStatus();
  const request = useRefreshQuery<UserGivingQuery>({
    enabled: expectedUid !== undefined && refresh,
    fetchPolicy: "network-only",
    query: UserGivingQueryDocument,
  });
  const previousYears = expectedUid
    ? lastGivingSuccesses.get(environment)?.get(expectedUid)
    : undefined;
  const history = resolveGivingHistory(
    expectedUid ? result : undefined,
    previousYears,
  );

  useEffect(() => {
    if (
      expectedUid &&
      (history.status === "success" || history.status === "empty")
    ) {
      const successes =
        lastGivingSuccesses.get(environment) ??
        new Map<string, readonly YearlyGiving[]>();
      successes.set(expectedUid, history.years);
      lastGivingSuccesses.set(environment, successes);
    }
  }, [environment, expectedUid, history.status, history.years]);

  const failed =
    request.status === "error" ||
    connectivity === "offline" ||
    (request.status === "complete" && history.status === "loading");
  return {
    ...history,
    status: failed ? ("error" as const) : history.status,
    isRefreshing: request.status === "loading" && connectivity !== "offline",
    retry: request.retry,
  };
}
