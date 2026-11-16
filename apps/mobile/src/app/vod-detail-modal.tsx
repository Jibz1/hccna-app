import { useLocalSearchParams } from "expo-router";
import { Suspense, useState } from "react";

import {
  VerseDetailScreen,
  VerseDetailStatus,
} from "@/components/design-v2/VerseDetailScreen";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";
import { useSavedVerses } from "@/components/saved-verses/useSavedVerses";
import {
  useConnectivityAwareFetchPolicy,
  type ConnectivityAwareFetchPolicy,
} from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import {
  useAuthenticatedUid,
  useWordOfActivation,
} from "@/hooks/relay/useUserData";
import {
  useHasCachedVerseOfTheDay,
  useVerseOfTheDay,
} from "@/hooks/relay/useVerseOfTheDay";
import { fromSavedVerseKind } from "@/utils/savedVerses";

function WordOfActivationModal() {
  const verse = useWordOfActivation();
  if (!verse) {
    return (
      <VerseDetailStatus title="Word of activation is unavailable right now." />
    );
  }
  return <VerseDetailScreen verse={verse} kind="word-of-activation" />;
}

function SavedVerseModal({ verseId }: { verseId: string }) {
  const { verses } = useSavedVerses();
  // Keep the opened text readable after removal, so it can also be saved again.
  const [verse] = useState(() =>
    verses.find((entry) => entry.verseId === verseId),
  );
  if (!verse) {
    return <VerseDetailStatus title="This verse is no longer saved." />;
  }
  return (
    <VerseDetailScreen verse={verse} kind={fromSavedVerseKind(verse.kind)} />
  );
}

function VerseOfTheDayModalImpl({
  fetchPolicy,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
}) {
  const fetchKey = useRetryKey(fetchPolicy);
  const verse = useVerseOfTheDay({ fetchKey, fetchPolicy });
  if (!verse) {
    return <VerseDetailStatus title="No verse is available right now." />;
  }
  return <VerseDetailScreen verse={verse} />;
}

function VerseOfTheDayModal() {
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedVerse = useHasCachedVerseOfTheDay();
  if (fetchPolicy === "store-only" && !hasCachedVerse) {
    return <VerseDetailStatus title="Verse unavailable offline" offline />;
  }
  return (
    <ErrorBoundaryWithRetry
      title="Unable to load the verse"
      subtitle="Please try again later"
      fallbackRender={(fallback) => (
        <VerseDetailStatus>{fallback}</VerseDetailStatus>
      )}
    >
      <Suspense fallback=<VerseDetailStatus loading />>
        <VerseOfTheDayModalImpl fetchPolicy={fetchPolicy} />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}

export default function ModalScreen() {
  const { slug, savedVerseId } = useLocalSearchParams<{
    slug?: string;
    savedVerseId?: string;
  }>();
  const uid = useAuthenticatedUid();
  if (savedVerseId !== undefined) {
    return (
      <SavedVerseModal
        key={JSON.stringify([uid, savedVerseId])}
        verseId={savedVerseId}
      />
    );
  }
  return slug === "word-of-activation" ? (
    <WordOfActivationModal />
  ) : (
    <VerseOfTheDayModal />
  );
}
