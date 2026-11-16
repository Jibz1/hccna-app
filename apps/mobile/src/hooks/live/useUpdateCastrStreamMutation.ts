import { useMutation, graphql } from "react-relay";

import { captureException } from "@/utils/sentry";
import { statsig } from "@/utils/statsig";

import type {
  UpdateCastrStreamInput,
  useUpdateCastrStreamMutation as UpdateCastrStreamMutationType,
  useUpdateCastrStreamMutation$data,
} from "./__generated__/useUpdateCastrStreamMutation.graphql";

const UpdateCastrStreamMutation = graphql`
  mutation useUpdateCastrStreamMutation($input: UpdateCastrStreamInput!) {
    updateCastrStream(input: $input) {
      message
      skippedPlatformIds
    }
  }
`;

export const useUpdateCastrStreamMutation = () => {
  const [commitMutation, isInFlight] =
    useMutation<UpdateCastrStreamMutationType>(UpdateCastrStreamMutation);

  const updateCastrStream = (input: UpdateCastrStreamInput) => {
    return new Promise<useUpdateCastrStreamMutation$data>((resolve, reject) => {
      commitMutation({
        variables: {
          input: {
            ...input,
          },
        },
        // The payload carries no stream data, so copy the saved details onto
        // the cached stream; the server has persisted them by the time it
        // replies. Screens that stay mounted under the editor (the "Edit Castr
        // Channel" card) would otherwise show the old title until remounted.
        updater: (store) => {
          if (!store.getRootField("updateCastrStream")) {
            return;
          }
          const stream = store.get(input.streamId);
          stream?.setValue(input.title, "title");
          stream?.setValue(input.description, "description");
          // Omitted destination fields keep what the server already saved.
          for (const platform of input.platforms) {
            if (platform.title === undefined) {
              continue;
            }
            const record = store.get(platform.id);
            record?.setValue(platform.title, "title");
            record?.setValue(platform.description, "description");
          }
        },
        onCompleted: (response) => {
          statsig.logEvent(
            "update_castr_stream_success",
            "update_castr_stream",
            {
              campusSlug: input.campusSlug,
              description: input.description,
              platforms: input.platforms
                .map((platform) => platform.broadcasting_status)
                .join(","),
              streamId: input.streamId,
              title: input.title,
            },
          );
          resolve(response);
        },
        onError: (error) => {
          console.error("Error updating Castr stream:", error);
          statsig.logEvent("update_castr_stream_error", "update_castr_stream", {
            campusSlug: input.campusSlug,
            description: input.description,
            platforms: input.platforms
              .map((platform) => platform.broadcasting_status)
              .join(","),
            streamId: input.streamId,
            title: input.title,
          });
          captureException(error);
          reject(error);
        },
      });
    });
  };

  return {
    updateCastrStream,
    isInFlight,
  };
};
