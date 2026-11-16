import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import EditProfileScreen from "@/app/edit-profile";
import { AccountAvatarImage } from "@/components/profile/AccountAvatar";
import {
  ProfilePhotoSheet,
  type ProfilePhotoSheetProps,
} from "@/components/profile/ProfilePhotoSheet";

type FormValues = {
  firstName: string;
  lastName: string;
  profilePicture: string | null;
  phone: string;
};

const mocks = vi.hoisted(() => {
  const user = {
    uid: "user-1",
    firstName: "Chloe",
    lastName: "Jones",
    img: "https://example.com/profile.jpg",
    phone: "5551234567",
  };
  const state = {
    values: {
      firstName: user.firstName,
      lastName: user.lastName,
      profilePicture: user.img,
      phone: user.phone,
    } as FormValues,
    submitPromise: undefined as Promise<unknown> | undefined,
  };
  return {
    user,
    state,
    pickImage: vi.fn(),
    mutation: { mutateAsync: vi.fn(), isPending: false, error: null },
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    captureException: vi.fn(),
    goBack: vi.fn(),
    form: {
      control: {},
      formState: { isSubmitting: false, isValid: true, isDirty: false },
      reset: (values: FormValues) => {
        state.values = values;
      },
      handleSubmit:
        (onSubmit: (values: FormValues) => Promise<unknown>) => () => {
          state.submitPromise = onSubmit(state.values);
          return state.submitPromise;
        },
    },
  };
});

vi.mock("@/cssInterop", () => ({
  StyledImage: "Image",
  StyledLinearGradient: "LinearGradient",
}));
vi.mock("@expo/vector-icons/FontAwesome6", () => ({ default: "FontAwesome6" }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: mocks.pickImage,
  launchCameraAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  CameraType: { front: "front" },
}));
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Linking: { openSettings: vi.fn() },
  Platform: { OS: "ios" },
  ActivityIndicator: "ActivityIndicator",
  Keyboard: {
    dismiss: vi.fn(),
    isVisible: () => false,
    addListener: () => ({ remove: vi.fn() }),
  },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("react-hook-form", () => ({
  Controller: ({
    name,
    render,
  }: {
    name: keyof FormValues;
    render: (props: {
      field: { value: string | null; onChange: () => void; onBlur: () => void };
      fieldState: object;
    }) => ReactNode;
  }) =>
    render({
      field: {
        value: mocks.state.values[name],
        onChange: () => {},
        onBlur: () => {},
      },
      fieldState: {},
    }),
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({
    isDark: false,
    colors: { background: "#FFFFFF", text: "#342B27", accent: "#995234" },
    backgroundGradient: ["#FFFFFF", "#FFE6DD"],
    backgroundGradientLocations: [0, 1],
  }),
}));
vi.mock("@/components/profile/AccountAvatar", () => ({
  AccountAvatarImage: "AccountAvatarImage",
}));
vi.mock("@/components/layout/DynamicKeyboardAvoidingView", () => ({
  DynamicKeyboardAvoidingView: "DynamicKeyboardAvoidingView",
}));
vi.mock("@/components/profile/ProfilePhotoSheet", () => ({
  ProfilePhotoSheet: "ProfilePhotoSheet",
}));
vi.mock("@/hooks/profile/useUpdateProfileMutation", () => ({
  useUpdateProfileMutation: () => mocks.mutation,
}));
vi.mock("@/hooks/relay/useUserData", () => ({
  useUserProfile: () => mocks.user,
}));
vi.mock("@/theme/usePreferencesTheme", () => ({
  usePreferencesTheme: () => "purple-light",
}));
vi.mock("@/hooks/utils/useZodForm", () => ({
  useZodForm: () => mocks.form,
}));
vi.mock("@/ui/Text", () => ({ Text: "Text" }));
vi.mock("@/ui/toast/Toast", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@/utils/navigation", () => ({ goBackOrReplace: mocks.goBack }));
vi.mock("@/utils/devicePrefs", () => ({
  DevicePrefs: { setTheme: vi.fn() },
}));
vi.mock("@/utils/sentry", () => ({ captureException: mocks.captureException }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const acceptedPhoto = "file:///accepted-photo.jpg";
let renderer: ReactTestRenderer | null = null;

function render() {
  act(() => {
    renderer = create(createElement(EditProfileScreen));
  });
}

function sheet() {
  return renderer!.root.findByType(ProfilePhotoSheet)
    .props as ProfilePhotoSheetProps;
}

function avatarUri() {
  return renderer!.root.findByType(AccountAvatarImage).props.img;
}

function saveButton() {
  return renderer!.root.findByProps({ accessibilityLabel: "Save changes" });
}

function openPhotoEditor() {
  act(() => {
    renderer!.root
      .findByProps({ accessibilityLabel: "Edit profile photo" })
      .props.onPress();
  });
}

async function acceptPhoto() {
  openPhotoEditor();
  mocks.pickImage.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: acceptedPhoto }],
  });
  await act(async () => {
    await sheet().onChoosePhoto();
  });
  act(() => {
    sheet().onConfirm();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pickImage.mockReset();
  mocks.mutation.mutateAsync.mockReset().mockResolvedValue(undefined);
  mocks.state.submitPromise = undefined;
});

afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = null;
});

test("Use photo updates the local draft and only Save changes sends it to the server", async () => {
  render();
  await acceptPhoto();

  expect(sheet().visible).toBe(false);
  expect(avatarUri()).toBe(acceptedPhoto);
  expect(saveButton().props.disabled).toBe(false);
  expect(mocks.mutation.mutateAsync).not.toHaveBeenCalled();

  await act(async () => {
    saveButton().props.onPress();
    await mocks.state.submitPromise;
  });

  expect(mocks.mutation.mutateAsync).toHaveBeenCalledExactlyOnceWith(
    {
      firstName: mocks.user.firstName,
      lastName: mocks.user.lastName,
      phone: mocks.user.phone,
      profilePicture: acceptedPhoto,
    },
    expect.any(Object),
  );
});

test("a rejected save is handled and leaves the accepted photo available for retry", async () => {
  const error = new Error("Upload failed");
  mocks.mutation.mutateAsync.mockImplementationOnce(async (_data, options) => {
    options.onError(error);
    throw error;
  });
  render();
  await acceptPhoto();

  await act(async () => {
    saveButton().props.onPress();
    await expect(mocks.state.submitPromise).resolves.toBeUndefined();
  });

  expect(mocks.toastError).toHaveBeenCalledWith({
    title: "Failed to update profile",
  });
  expect(mocks.captureException).toHaveBeenCalledWith(error);
  expect(mocks.goBack).not.toHaveBeenCalled();
  expect(avatarUri()).toBe(acceptedPhoto);
  expect(saveButton().props.disabled).toBe(false);
  openPhotoEditor();
  expect(sheet().imageUri).toBe(acceptedPhoto);
});
