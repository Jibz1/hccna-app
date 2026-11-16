import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StyledBlurView as BlurView, StyledImage as Image } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

export type ProfilePhotoSheetProps = {
  visible: boolean;
  imageUri?: string | null;
  isChoosing?: boolean;
  onClose: () => void;
  onChoosePhoto: () => Promise<void> | void;
  onTakePhoto: () => Promise<void> | void;
  onConfirm: () => void;
};

function PhotoPreview({
  imageUri,
  size: previewSize,
  reduceMotion,
}: {
  imageUri?: string | null;
  size: number;
  reduceMotion: boolean;
}) {
  const { colors } = useAppTheme();
  const hasPhoto = Boolean(imageUri?.trim());
  return (
    <View className="gap-2xs items-center py-[6px]">
      <View className="p-5xs bg-design-selected rounded-full">
        <View
          style={{
            width: previewSize,
            height: previewSize,
          }}
          className="bg-design-surface border-design-surface-strong overflow-hidden rounded-full border-4"
        >
          {hasPhoto ? (
            <Image
              source={imageUri}
              accessibilityLabel="Profile photo preview"
              contentFit="cover"
              cachePolicy="disk"
              enforceEarlyResizing
              transition={reduceMotion ? 0 : 180}
              className="absolute inset-0"
            />
          ) : (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel="No profile photo selected"
              className="flex-1 items-center justify-center"
            >
              <FontAwesome6
                name="user"
                solid
                size={previewSize * 0.33}
                color={colors.accent}
              />
            </View>
          )}
        </View>
      </View>
      <Text variant="labelXs/regular" centered color="designMuted">
        Take a photo or choose one from your library.
      </Text>
    </View>
  );
}

function PhotoActions({
  hasPhoto,
  isChoosing,
  stacked: stackActions,
  onChoosePhoto,
  onTakePhoto,
  onConfirm,
}: { hasPhoto: boolean; isChoosing: boolean; stacked: boolean } & Pick<
  ProfilePhotoSheetProps,
  "onChoosePhoto" | "onTakePhoto" | "onConfirm"
>) {
  const { colors, isDark } = useAppTheme();
  const confirmDisabled = !hasPhoto || isChoosing;
  const confirmColor = isDark ? colors.background : colors.onImage;
  return (
    <View className="gap-4xs">
      <View
        className={cn(
          "flex-row items-stretch gap-4xs mt-6xs",
          stackActions && "flex-col",
        )}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take a profile photo"
          accessibilityState={{
            disabled: isChoosing,
          }}
          disabled={isChoosing}
          onPress={onTakePhoto}
          className={cn(
            "active:opacity-60 min-h-xl rounded-[30px] py-3xs px-3xs flex-row items-center justify-center gap-5xs",
            stackActions ? "w-full" : "flex-1",
            "bg-design-selected",
            isChoosing ? "opacity-65" : "opacity-100",
          )}
        >
          <FontAwesome6 name="camera" size={16} color={colors.accent} />
          <Text
            variant="labelXs/medium"
            centered
            className="shrink"
            color="designAccent"
          >
            Take photo
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            hasPhoto ? "Choose another profile photo" : "Choose a profile photo"
          }
          accessibilityState={{
            disabled: isChoosing,
            busy: isChoosing,
          }}
          disabled={isChoosing}
          onPress={onChoosePhoto}
          className={cn(
            "active:opacity-60 min-h-xl rounded-[30px] py-3xs px-3xs flex-row items-center justify-center gap-5xs",
            stackActions ? "w-full" : "flex-1",
            "bg-design-selected",
            isChoosing ? "opacity-65" : "opacity-100",
          )}
        >
          {isChoosing ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <FontAwesome6 name="images" size={16} color={colors.accent} />
          )}
          <Text
            variant="labelXs/medium"
            centered
            className="shrink"
            color="designAccent"
          >
            {isChoosing ? "Opening…" : "Photo library"}
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use this profile photo"
        accessibilityState={{
          disabled: confirmDisabled,
        }}
        disabled={confirmDisabled}
        onPress={onConfirm}
        className={cn(
          "active:opacity-60 min-h-xl rounded-[30px] py-3xs px-3xs flex-row items-center justify-center gap-5xs w-full bg-design-accent",
          confirmDisabled ? "opacity-45" : "opacity-100",
        )}
      >
        <Text
          variant="labelXs/medium"
          centered
          className="shrink"
          color={isDark ? "designBackground" : "onImage"}
        >
          Use photo
        </Text>
        <FontAwesome6 name="check" size={15} color={confirmColor} />
      </Pressable>
    </View>
  );
}

/** Previews a local profile draft; the parent owns picking and persistence. */
export function ProfilePhotoSheet({
  visible,
  imageUri,
  isChoosing = false,
  onClose,
  onChoosePhoto,
  onTakePhoto,
  onConfirm,
}: ProfilePhotoSheetProps) {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { width, height, fontScale } = useWindowDimensions();
  const hasPhoto = Boolean(imageUri?.trim());
  const previewSize = Math.min(224, width * 0.54, height * 0.34);
  const stackActions = fontScale > 1.3 || width < 360;
  const close = () => {
    if (!isChoosing) {
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "slide"}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={close}
      onShow={() => {
        Keyboard.dismiss();
      }}
    >
      <View
        style={{
          paddingLeft: insets.left + 8,
          paddingRight: insets.right + 8,
        }}
        className="flex-1 items-center justify-end"
      >
        {Platform.OS === "ios" ? (
          <BlurView
            pointerEvents="none"
            intensity={18}
            tint={isDark ? "dark" : "light"}
            className="absolute inset-0"
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo editor"
          accessibilityState={{
            disabled: isChoosing,
          }}
          disabled={isChoosing}
          onPress={close}
          className="bg-design-photo-overlay absolute inset-0"
        />
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          style={{
            maxHeight: height - insets.top - 20,
          }}
          className="shadow-photo-sheet bg-design-surface-strong border-design-border w-full max-w-[560px] overflow-hidden rounded-tl-[36px] rounded-tr-[36px] border border-b-0"
        >
          <ScrollView
            bounces={false}
            contentInsetAdjustmentBehavior="never"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingBottom: Math.max(insets.bottom, 16) + 12,
            }}
            contentContainerClassName="px-xs pt-xs gap-xs"
          >
            <View className="min-h-s justify-center px-[44px]">
              <Text
                accessibilityRole="header"
                variant="titleLg/medium"
                centered
                color="designPrimary"
              >
                {hasPhoto ? "Edit avatar" : "Add photo"}
              </Text>
            </View>
            <PhotoPreview
              imageUri={imageUri}
              size={previewSize}
              reduceMotion={reduceMotion}
            />
            <PhotoActions
              hasPhoto={hasPhoto}
              isChoosing={isChoosing}
              stacked={stackActions}
              onChoosePhoto={onChoosePhoto}
              onTakePhoto={onTakePhoto}
              onConfirm={onConfirm}
            />
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo editor"
            accessibilityState={{
              disabled: isChoosing,
            }}
            disabled={isChoosing}
            onPress={close}
            className={cn(
              "active:opacity-60 absolute top-[18px] right-3xs w-m h-m rounded-[20px] items-center justify-center bg-design-selected",
              isChoosing ? "opacity-50" : "opacity-100",
            )}
          >
            <FontAwesome6 name="xmark" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
