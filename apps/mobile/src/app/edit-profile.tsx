import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useCallback, useEffect, useRef } from "react";
import { type Control, Controller } from "react-hook-form";
import {
  type LayoutChangeEvent,
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DynamicKeyboardAvoidingView } from "@/components/layout/DynamicKeyboardAvoidingView";
import { AccountAvatarImage } from "@/components/profile/AccountAvatar";
import { ProfilePhotoSheet } from "@/components/profile/ProfilePhotoSheet";
import {
  StyledImage as Image,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import {
  type ProfileValues,
  useEditProfile,
} from "@/hooks/profile/useEditProfile";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { goBackOrReplace } from "@/utils/navigation";
import { cn } from "@/utils/styling";

function ProfileField({
  control,
  name,
  label,
  last = false,
  disabled,
  onFocus,
  onLayout,
}: {
  control: Control<ProfileValues>;
  name: "firstName" | "lastName" | "phone";
  label: string;
  last?: boolean;
  disabled: boolean;
  onFocus: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View
          onLayout={onLayout}
          className={cn(
            "py-[13px] gap-6xs border-b-design-border",
            last ? "border-b-0" : "border-b",
          )}
        >
          <Text color="designMuted" variant="caption/regular">
            {label}
          </Text>
          <TextInput
            accessibilityLabel={label}
            value={field.value ?? ""}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            onFocus={onFocus}
            editable={!disabled}
            placeholder={name === "phone" ? "Add phone number" : label}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            keyboardType={name === "phone" ? "phone-pad" : "default"}
            autoComplete={
              name === "phone"
                ? "tel"
                : name === "firstName"
                  ? "given-name"
                  : "family-name"
            }
            textContentType={
              name === "phone"
                ? "telephoneNumber"
                : name === "firstName"
                  ? "givenName"
                  : "familyName"
            }
            autoCapitalize={name === "phone" ? "none" : "words"}
            autoCorrect={false}
            className="py-5xs text-body-lg text-design-text min-h-[42px] px-0"
          />
          {fieldState.error ? (
            <Text
              accessibilityRole="alert"
              color="designAccent"
              variant="labelXXs/regular"
            >
              {fieldState.error.message}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}

export default function EditProfileScreen() {
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const focusedField = useRef<"firstName" | "lastName" | "phone" | null>(null);
  const formTop = useRef(0);
  const fieldOffsets = useRef({ firstName: 0, lastName: 0, phone: 0 });
  const revealFocusedInput = useCallback(() => {
    if (Keyboard.isVisible() && focusedField.current !== null) {
      // Use content coordinates because this screen lives inside a native modal.
      scrollRef.current?.scrollTo({
        y: Math.max(
          0,
          formTop.current + fieldOffsets.current[focusedField.current] - 12,
        ),
        animated: true,
      });
    }
  }, []);
  useEffect(() => {
    const subscription = Keyboard.addListener(
      "keyboardDidShow",
      revealFocusedInput,
    );
    return () => {
      subscription.remove();
    };
  }, [revealFocusedInput]);
  const handleFieldFocus = (name: "firstName" | "lastName" | "phone") => {
    focusedField.current = name;
    revealFocusedInput();
  };
  const {
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
    error,
  } = useEditProfile();

  if (!user) {
    return null;
  }

  return (
    <View
      testID="design-v2-edit-profile"
      className="bg-design-background flex-1"
    >
      <LinearGradient
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      {previewUri ? (
        <View
          pointerEvents="none"
          className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden opacity-5"
        >
          <Image
            source={previewUri}
            accessible={false}
            contentFit="cover"
            cachePolicy="disk"
            enforceEarlyResizing
            blurRadius={30}
            className="absolute inset-0"
          />
        </View>
      ) : null}
      <DynamicKeyboardAvoidingView>
        <View
          style={{
            paddingTop: Math.max(insets.top, 14),
          }}
          className="px-2xs pb-4xs gap-4xs flex-row items-center"
        >
          <View className="w-[44px]" />
          <Text
            accessibilityRole="header"
            className="flex-1"
            color="designPrimary"
            variant="bodyLg/bold"
            centered
          >
            Edit profile
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close edit profile"
            disabled={isSaving}
            onPress={() => {
              goBackOrReplace("/profile");
            }}
            className="bg-design-surface h-[44px] w-[44px] items-center justify-center rounded-[22px] active:opacity-60"
          >
            <FontAwesome6 name="xmark" size={18} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView
          ref={scrollRef}
          onLayout={revealFocusedInput}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="grow items-center px-xs pb-[28px]"
        >
          <View className="gap-2xs w-full max-w-[540px]">
            <View className="gap-4xs pt-2xs pb-3xs items-center">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit profile photo"
                disabled={isSaving}
                className="p-6xs active:opacity-70"
                onPress={openPhotoSheet}
              >
                <View className="bg-design-surface rounded-[68px] p-[6px]">
                  <AccountAvatarImage isLoggedIn img={previewUri} size={112} />
                </View>
                <View className="bottom-5xs bg-design-surface-strong border-design-background absolute right-[3px] h-[34px] w-[34px] items-center justify-center rounded-[17px] border-[3px]">
                  <FontAwesome6 name="pen" size={13} color={colors.text} />
                </View>
              </Pressable>
              <Text color="designAccent" variant="pXs/bold">
                Change photo
              </Text>
              {imageUri ? (
                <Text color="designMuted" variant="labelXXs/regular">
                  Photo ready to save
                </Text>
              ) : null}
            </View>
            <View className="gap-[6px]">
              <Text color="designPrimary" variant="title/bold">
                Personal details
              </Text>
              <Text color="designMuted" variant="pXs/regular">
                Keep your name and contact information up to date.
              </Text>
            </View>
            <View
              testID="profile-details-fields"
              onLayout={(event) => {
                formTop.current = event.nativeEvent.layout.y;
              }}
              className="px-2xs bg-design-surface-strong border-design-border rounded-[26px] border"
            >
              <ProfileField
                control={form.control}
                name="firstName"
                onFocus={() => {
                  handleFieldFocus("firstName");
                }}
                onLayout={(event) => {
                  fieldOffsets.current.firstName = event.nativeEvent.layout.y;
                }}
                label="First name"
                disabled={isSaving}
              />
              <ProfileField
                control={form.control}
                name="lastName"
                onFocus={() => {
                  handleFieldFocus("lastName");
                }}
                onLayout={(event) => {
                  fieldOffsets.current.lastName = event.nativeEvent.layout.y;
                }}
                label="Last name"
                disabled={isSaving}
              />
              <ProfileField
                control={form.control}
                name="phone"
                onFocus={() => {
                  handleFieldFocus("phone");
                }}
                onLayout={(event) => {
                  fieldOffsets.current.phone = event.nativeEvent.layout.y;
                }}
                label="Phone number"
                last
                disabled={isSaving}
              />
            </View>
            {error ? (
              <View
                accessibilityRole="alert"
                className="p-3xs bg-design-surface rounded-[18px]"
              >
                <Text color="designPrimary">{error.message}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
        <View
          style={{
            paddingBottom: Math.max(insets.bottom, 16),
          }}
          className="px-xs bg-design-chrome border-t-design-border items-center border-t pt-[14px]"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save changes"
            accessibilityState={{
              disabled: !isValid || !hasChanges || isSaving,
              busy: isSaving,
            }}
            disabled={!isValid || !hasChanges || isSaving}
            onPress={() => {
              void saveProfile();
            }}
            className={cn(
              "active:opacity-80 w-full max-w-[540px] min-h-[54px] rounded-[28px] items-center justify-center px-xs py-[14px] bg-design-text",
              !isValid || !hasChanges ? "opacity-45" : "opacity-100",
            )}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text color="designBackground" variant="pSm/bold">
                Save changes
              </Text>
            )}
          </Pressable>
        </View>
      </DynamicKeyboardAvoidingView>
      <ProfilePhotoSheet
        visible={photoSheetVisible}
        imageUri={draftImageUri}
        isChoosing={isChoosing}
        onChoosePhoto={pickImage}
        onTakePhoto={takePhoto}
        onClose={closePhotoSheet}
        onConfirm={confirmPhoto}
      />
    </View>
  );
}
