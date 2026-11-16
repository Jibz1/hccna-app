import { graphql, useLazyLoadQuery, useRelayEnvironment } from "react-relay";
import { createOperationDescriptor, getRequest } from "relay-runtime";

import type { VerseOfTheDayQuery } from "@/hooks/relay/__generated__/VerseOfTheDayQuery.graphql";
import type { ConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import {
  resolveVerseOfTheDay,
  type VerseOfTheDayData,
} from "@/relay/verseOfTheDay";

export const VerseOfTheDayQueryDocument = graphql`
  query VerseOfTheDayQuery {
    verseOfTheDayV2 {
      __typename
      ... on Scripture {
        book
        date
        image
        stBook
        text
        verseId
      }
      ... on VodFetchError {
        message
      }
      ... on VodNotFoundError {
        message
      }
    }
  }
`;

export function useHasCachedVerseOfTheDay(): boolean {
  const environment = useRelayEnvironment();
  const operation = createOperationDescriptor(
    getRequest(VerseOfTheDayQueryDocument),
    {},
  );

  if (environment.check(operation).status !== "available") {
    return false;
  }

  const snapshot = environment.lookup(operation.fragment);
  const result = snapshot.data as VerseOfTheDayQuery["response"];
  return result.verseOfTheDayV2?.__typename === "Scripture";
}

export function useVerseOfTheDay({
  fetchKey,
  fetchPolicy,
}: {
  fetchKey: string;
  fetchPolicy: ConnectivityAwareFetchPolicy;
}): VerseOfTheDayData | null {
  const result = useLazyLoadQuery<VerseOfTheDayQuery>(
    VerseOfTheDayQueryDocument,
    {},
    {
      fetchKey,
      fetchPolicy,
    },
  );

  return resolveVerseOfTheDay(result.verseOfTheDayV2);
}
