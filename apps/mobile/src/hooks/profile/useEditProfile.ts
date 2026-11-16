import { Schema } from "effect";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Linking, Platform } from "react-native";

import { useUpdateProfileMutation } from "@/hooks/profile/useUpdateProfileMutation";
import { useUserProfile } from "@/hooks/relay/useUserData";
import { useZodForm } from "@/hooks/utils/useZodForm";
import { toast } from "@/ui/toast/Toast";
import { nullableOptional } from "@/utils/effectSchema";
import { goBackOrReplace } from "@/utils/navigation";
import { captureException } from "@/utils/sentry";

export type ProfileValues = {
  firstName: string;
  lastName: string;
  profilePicture?: string | null;
  phone?: string | null;
};

async function launchProfileImagePicker(source: "library" | "camera") {
  // The browser picker must launch directly from the user gesture.
  if (source === "camera" && Platform.OS !== "web") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Camera access needed",
        permission.canAskAgain
          ? "Allow camera access to take a profile photo. You can also choose one from your library."
          : "Enable camera access in Settings to take a profile photo. You can also choose one from your library.",
        permission.canAskAgain
          ? [{ text: "OK" }]
          : [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open settings",
                onPress: () => {
                  void Linking.openSettings().catch((cause: unknown) => {
                    toast.error({
                      title:
                        "Unable to open Settings. Please open your device settings.",
                    });
                    captureException(cause);
                  });
                },
              },
            ],
      );
      return;
    }
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
  };
  return await (source === "camera"
    ? ImagePicker.launchCameraAsync({
        ...options,
        cameraType: ImagePicker.CameraType.front,
      })
    : ImagePicker.launchImageLibraryAsync(options));
}

export function useEditProfile() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [draftImageUri, setDraftImageUri] = useState<string | null>(null);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
  const [isChoosing, setIsChoosing] = useState(false);
  const pickerInFlight = useRef(false);
  const user = useUserProfile();
  const initializedUserUid = useRef<string | null>(null);
  const updateProfileMutation = useUpdateProfileMutation();
  const form = useZodForm({
    mode: "onChange",
    reValidateMode: "onChange",
    schema: Schema.Struct({
      firstName: Schema.String.check(
        Schema.isMinLength(1, { message: "Required" }),
      ),
      lastName: Schema.String.check(
        Schema.isMinLength(1, { message: "Required" }),
      ),
      profilePicture: nullableOptional(Schema.String),
      phone: nullableOptional(Schema.String),
    }),
    defaultValues: {
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      profilePicture: user?.img ?? null,
      phone: user?.phone ?? "",
    },
  });

  useEffect(() => {
    if (!user?.uid || initializedUserUid.current === user.uid) {
      return;
    }
    initializedUserUid.current = user.uid;
    setImageUri(null);
    setDraftImageUri(null);
    setPhotoSheetVisible(false);
    form.reset({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      profilePicture: user.img ?? null,
      phone: user.phone ?? "",
    });
  }, [form, user]);

  const chooseImage = async (source: "library" | "camera") => {
    if (pickerInFlight.current) {
      return;
    }
    pickerInFlight.current = true;
    setIsChoosing(true);
    await launchProfileImagePicker(source)
      .then((result) => {
        if (result && !result.canceled && result.assets[0]?.uri) {
          setDraftImageUri(result.assets[0].uri);
        }
      })
      .catch((cause: unknown) => {
        toast.error({
          title:
            source === "camera"
              ? "Unable to open your camera. Please try again or choose a photo."
              : "Unable to open your photos. Please try again.",
        });
        captureException(cause);
      })
      .finally(() => {
        pickerInFlight.current = false;
        setIsChoosing(false);
      });
  };
  const pickImage = () => chooseImage("library");
  const takePhoto = () => chooseImage("camera");

  const {
    formState: { isSubmitting, isValid, isDirty },
    handleSubmit,
  } = form;
  const isSaving = isSubmitting || updateProfileMutation.isPending;
  const hasChanges = isDirty || imageUri !== null;
  const previewUri = imageUri ?? user?.img;
  const saveProfile = handleSubmit(async (data) => {
    try {
      await updateProfileMutation.mutateAsync(
        {
          firstName: data.firstName,
          lastName: data.lastName,
          profilePicture: imageUri,
          phone: data.phone,
        },
        {
          onSuccess: () => {
            toast.success({ title: "Profile updated successfully" });
            goBackOrReplace("/profile");
          },
          onError: (error: Error) => {
            toast.error({ title: "Failed to update profile" });
            captureException(error);
          },
        },
      );
    } catch {
      // The mutation displays the error; keep the draft available for retry.
    }
  });

  const openPhotoSheet = () => {
    Keyboard.dismiss();
    setDraftImageUri(previewUri ?? null);
    setPhotoSheetVisible(true);
  };
  const closePhotoSheet = () => {
    setDraftImageUri(null);
    setPhotoSheetVisible(false);
  };
  const confirmPhoto = () => {
    if (draftImageUri && draftImageUri !== previewUri) {
      setImageUri(draftImageUri);
    }
    closePhotoSheet();
  };

  return {
    user,
    form,
    imageUri,
    draftImageUri,
    photoSheetVisible,
    isChoosing,
    isSaving,
    hasChanges,
    isValid,
    previewUri,
    saveProfile,
    pickImage,
    takePhoto,
    openPhotoSheet,
    closePhotoSheet,
    confirmPhoto,
    error: updateProfileMutation.error,
  };
}
