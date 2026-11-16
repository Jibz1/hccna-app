import { graphql, useLazyLoadQuery, useRelayEnvironment } from "react-relay";
import { createOperationDescriptor, getRequest } from "relay-runtime";

import type { CoreDataQuery } from "@/hooks/relay/__generated__/CoreDataQuery.graphql";
import type { ConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { resolveCoreData, type CoreDataView } from "@/relay/coreData";

export const CoreDataQueryDocument = graphql`
  query CoreDataQuery {
    core {
      giving {
        featureImge
        copy
      }
      profile {
        featureImge
        copy
      }
      sermons {
        featureImge
        copy
      }
      hccexpression {
        featureImge
        copy
      }
      events {
        featureImge
        copy
      }
      more {
        featureImge
        copy
        links {
          title
          link
          iconName
          subTitle
          group
        }
      }
    }
  }
`;

export function useHasCachedCoreData(): boolean {
  const environment = useRelayEnvironment();
  const operation = createOperationDescriptor(
    getRequest(CoreDataQueryDocument),
    {},
  );

  if (environment.check(operation).status !== "available") {
    return false;
  }

  const snapshot = environment.lookup(operation.fragment);
  const result = snapshot.data as CoreDataQuery["response"];
  return result.core != null;
}

export function useCoreData({
  fetchKey,
  fetchPolicy,
}: {
  fetchKey: string;
  fetchPolicy: ConnectivityAwareFetchPolicy;
}): CoreDataView | null {
  const result = useLazyLoadQuery<CoreDataQuery>(
    CoreDataQueryDocument,
    {},
    {
      fetchKey,
      fetchPolicy,
    },
  );

  return resolveCoreData(result.core);
}
