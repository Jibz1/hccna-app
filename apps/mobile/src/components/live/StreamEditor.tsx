import { useRouter } from "expo-router";
import { Suspense } from "react";
import { View } from "react-native";
import { graphql, useLazyLoadQuery } from "react-relay";

import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { ProfileSettingsRow } from "@/components/profile/ProfileSettingsRow";
import {
  useRetryKey,
  ErrorBoundaryWithRetry,
} from "@/components/providers/ErrorBoundaryWithRetry";
import { useUserProfile } from "@/hooks/relay/useUserData";
import { Text } from "@/ui/Text";

import { StreamEditorQuery } from "./__generated__/StreamEditorQuery.graphql";
import { CastrDestinationStatus } from "./CastrDestinationStatus";

const StreamEditorQ = graphql`
  query StreamEditorQuery($campusSlug: String!) {
    castrStream(campusSlug: $campusSlug) {
      id
      name
      title
      platforms {
        id
        template
        broadcasting_status
      }
    }
  }
`;

type StreamEditorProps = {
  campusSlug: string;
};

export function StreamEditor({ campusSlug }: StreamEditorProps) {
  const profile = useUserProfile();

  if (!profile) {
    return null;
  }

  return (
    <ErrorBoundaryWithRetry
      title="Something went wrong"
      subtitle="Please try again later"
      fallbackClassName="w-full"
    >
      <Suspense
        fallback={
          <View className="m-3xs items-center justify-center">
            <FullLoadingState />
          </View>
        }
      >
        <StreamEditorImpl campusSlug={campusSlug} />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}

function StreamEditorImpl({ campusSlug }: StreamEditorProps) {
  const fetchKey = useRetryKey();
  const { navigate } = useRouter();

  const { castrStream } = useLazyLoadQuery<StreamEditorQuery>(
    StreamEditorQ,
    { campusSlug },
    {
      fetchPolicy: "network-only",
      fetchKey,
    },
  );

  const stream = castrStream;
  if (!stream) {
    return null;
  }

  return (
    <View className="border-continuous bg-design-surface overflow-hidden rounded-[28px]">
      <ProfileSettingsRow
        title="Edit Castr Channel"
        icon="video"
        last
        onPress={() => {
          navigate(`/castr-stream?slug=${campusSlug}`);
        }}
      />
      <View className="gap-3xs px-[22px] pb-[18px]">
        <CastrDestinationStatus destinations={stream.platforms} />
        <View className="gap-6xs">
          <Text variant="pXs/regular" color="designMuted">
            {stream.title}
          </Text>
          {stream.platforms?.length ? (
            <Text variant="labelXs/regular" color="designMuted">
              On {stream.platforms.map((item) => item.template).join(", ")}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
