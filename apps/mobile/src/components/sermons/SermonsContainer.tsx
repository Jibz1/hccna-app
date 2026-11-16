import { graphql, useLazyLoadQuery, useRelayEnvironment } from "react-relay";
import { createOperationDescriptor, getRequest } from "relay-runtime";

import type { AnimatedHeaderScrollProps } from "@/components/layout/AnimatedHeader";
import { useRetryKey } from "@/components/providers/ErrorBoundaryWithRetry";
import type { ConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";

import { SermonsContainerQuery } from "./__generated__/SermonsContainerQuery.graphql";
import { SermonsItems } from "./SermonsItems";

const SermonsQuery = graphql`
  query SermonsContainerQuery {
    ...SermonsItemsFragment
  }
`;

export function useHasCachedSermons() {
  const environment = useRelayEnvironment();
  const operation = createOperationDescriptor(getRequest(SermonsQuery), {});
  return environment.check(operation).status === "available";
}

export function SermonsContainer({
  fetchPolicy,
  scrollProps,
  topInset,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
  scrollProps: AnimatedHeaderScrollProps;
  topInset: number;
}) {
  // store-and-network renders cached sermons instantly, then refetches them;
  // store-or-network would pin the list to the persisted cache forever.
  const fetchKey = useRetryKey(fetchPolicy);
  const rootQuery = useLazyLoadQuery<SermonsContainerQuery>(
    SermonsQuery,
    {},
    {
      fetchKey,
      fetchPolicy,
    },
  );

  return (
    <SermonsItems
      rootQuery={rootQuery}
      scrollProps={scrollProps}
      topInset={topInset}
    />
  );
}
