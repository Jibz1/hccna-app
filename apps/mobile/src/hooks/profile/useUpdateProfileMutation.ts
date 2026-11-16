import {
  getDownloadURL,
  getStorage,
  putFile,
  ref,
} from "@react-native-firebase/storage";
import { useState } from "react";
import { graphql, useMutation, useRelayEnvironment } from "react-relay";

import type { UserUpdateProfileMutation } from "@/hooks/profile/__generated__/UserUpdateProfileMutation.graphql";
import {
  fetchUserProfileQuery,
  useUserProfile,
} from "@/hooks/relay/useUserData";

const UpdateUserProfileMutation = graphql`
  mutation UserUpdateProfileMutation($input: UpdateUserProfileInput!) {
    updateUserProfile(input: $input) {
      message
      success
    }
  }
`;

type UpdateProfileData = {
  firstName?: string;
  lastName?: string;
  profilePicture?: string | null;
  phone?: string | null;
} & (
  | { firstName: string }
  | { lastName: string }
  | { profilePicture: string | null }
  | { phone: string }
);

async function uploadImage(imageUri: string, uid: string) {
  const imageName = imageUri.substring(imageUri.lastIndexOf("/") + 1);
  const reference = ref(getStorage(), `apps/images/${uid}/${imageName}`);

  const task = putFile(reference, imageUri);

  await task;

  const url = await getDownloadURL(reference);
  return url;
}

export function useUpdateProfileMutation() {
  const environment = useRelayEnvironment();
  const user = useUserProfile();
  const [commitMutation, isInFlight] = useMutation<UserUpdateProfileMutation>(
    UpdateUserProfileMutation,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = async (
    data: UpdateProfileData,
    options?: {
      readonly onError?: (error: Error) => void;
      readonly onSuccess?: () => void;
    },
  ) => {
    setError(null);
    setIsUploading(true);

    try {
      let profilePicture: string | null = null;
      if (!user?.uid) {
        throw new Error("User not found");
      }
      if (
        !data.firstName &&
        !data.lastName &&
        !data.profilePicture &&
        !data.phone
      ) {
        throw new Error("A profile field is required");
      }
      if (data.profilePicture) {
        profilePicture = await uploadImage(data.profilePicture, user.uid);
      }

      await new Promise<void>((resolve, reject) => {
        const input: UserUpdateProfileMutation["variables"]["input"] = {};
        if (profilePicture) {
          input.img = profilePicture;
        }
        if (data.firstName) {
          input.firstName = data.firstName;
        }
        if (data.lastName) {
          input.lastName = data.lastName;
        }
        if (data.phone) {
          input.phone = data.phone;
        }
        commitMutation({
          variables: { input },
          onCompleted: (response) => {
            const result = response.updateUserProfile;
            if (!result?.success) {
              reject(new Error(result?.message ?? "Failed to update profile"));
              return;
            }

            resolve();
          },
          onError: reject,
        });
      });

      await fetchUserProfileQuery(environment, "network-only").catch(
        () => null,
      );
      options?.onSuccess?.();
    } catch (cause) {
      const nextError =
        cause instanceof Error ? cause : new Error("Failed to update profile");
      setError(nextError);
      options?.onError?.(nextError);
      throw nextError;
    } finally {
      setIsUploading(false);
    }
  };

  return {
    error,
    isPending: isUploading || isInFlight,
    mutateAsync,
  };
}
