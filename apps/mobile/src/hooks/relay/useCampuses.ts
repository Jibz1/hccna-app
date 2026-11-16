import { useMemo, useSyncExternalStore } from "react";
import { graphql, useLazyLoadQuery, useRelayEnvironment } from "react-relay";
import { createOperationDescriptor, getRequest } from "relay-runtime";

import type { CampusesQuery } from "@/hooks/relay/__generated__/CampusesQuery.graphql";
import type { ConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { useAuthenticatedUid, useUserProfile } from "@/hooks/relay/useUserData";
import {
  getRequestedCampusSlug,
  resolveCampuses,
  type CampusData,
} from "@/relay/campuses";
import { createRelayQuerySnapshotStore } from "@/relay/querySnapshotStore";

export const CampusesQueryDocument = graphql`
  query CampusesQuery($preferredCampus: String) {
    campusesV2(preferredCampus: $preferredCampus) {
      __typename
      ... on CampusesSuccess {
        campuses {
          slug
          content
          campusName
          facebook
          instagram
          giving
          givingPlatforms {
            icon
            link
            title
            text
          }
          location
          isPreferred
          cityState
          image
          streamLink
          campusLead {
            name
            image
            subTitle
          }
          campusLeads: leadPastor {
            slug
            name
            image
            leadershipGroup
          }
        }
      }
      ... on CampusesFetchError {
        message
      }
      ... on CampusesNotFoundError {
        message
      }
    }
  }
`;

// All campus consumers use the same preference-keyed query, including offline
// details and settings. A caller can pin the order while making local selections.
function useCampusQuerySlug(preferredCampus?: string): string {
  const uid = useAuthenticatedUid();
  const profile = useUserProfile();
  return (
    preferredCampus ??
    getRequestedCampusSlug(uid ? profile?.preferredCampusSlug : null)
  );
}

export function useHasCachedCampuses(preferredCampus?: string): boolean {
  const slug = useCampusQuerySlug(preferredCampus);
  const environment = useRelayEnvironment();
  const operation = createOperationDescriptor(
    getRequest(CampusesQueryDocument),
    { preferredCampus: slug },
  );

  if (environment.check(operation).status !== "available") {
    return false;
  }

  const snapshot = environment.lookup(operation.fragment);
  const result = snapshot.data as CampusesQuery["response"];
  return result.campusesV2?.__typename === "CampusesSuccess";
}

// Headers and settings can observe campus names without starting campus requests.
export function useCachedCampuses(): readonly CampusData[] {
  const slug = useCampusQuerySlug();
  const environment = useRelayEnvironment();
  const store = useMemo(
    () =>
      createRelayQuerySnapshotStore<CampusesQuery["response"]>(
        environment,
        createOperationDescriptor(getRequest(CampusesQueryDocument), {
          preferredCampus: slug,
        }),
      ),
    [environment, slug],
  );
  const result = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return result.campusesV2?.__typename === "CampusesSuccess"
    ? result.campusesV2.campuses
    : [];
}

export function useCampuses({
  preferredCampus,
  fetchKey,
  fetchPolicy,
}: {
  preferredCampus?: string;
  fetchKey: string;
  fetchPolicy: ConnectivityAwareFetchPolicy;
}): readonly CampusData[] {
  const slug = useCampusQuerySlug(preferredCampus);
  const result = useLazyLoadQuery<CampusesQuery>(
    CampusesQueryDocument,
    { preferredCampus: slug },
    {
      fetchKey,
      fetchPolicy,
    },
  );

  return resolveCampuses(result.campusesV2);
}
