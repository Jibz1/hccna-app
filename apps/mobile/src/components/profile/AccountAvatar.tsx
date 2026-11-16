import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Predicate } from "effect";
import { useRouter } from "expo-router";
import { PressableScale } from "pressto";
import { View } from "react-native";

import { StyledImage as Image } from "@/cssInterop";
import { useAuthenticatedUid, useUserProfile } from "@/hooks/relay/useUserData";
import { cn } from "@/utils/styling";

type AccountAvatarSize = "s" | "m" | "l" | "xl" | "xxl" | "full" | number;

const DEFAULT_AVATAR =
  "https://storage.googleapis.com/app-hccnj/Image/jubilee_place4_c82404999c/jubilee_place4_c82404999c.jpg";
const DB_DEFAULT_AVATAR =
  "https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fhcclogov2base.png?alt=media&token=40fc509b-0d90-431c-9f32-437d566edf6c";

export function AccountAvatarImage({
  isLoggedIn,
  img,
  size = "s",
}: {
  isLoggedIn: boolean;
  img?: string | null;
  size?: AccountAvatarSize;
}) {
  const dimensions = Predicate.isNumber(size)
    ? { width: size, height: size }
    : undefined;
  if (!isLoggedIn || !img || img === DB_DEFAULT_AVATAR) {
    return (
      <View
        style={dimensions}
        className={cn(
          "rounded-full bg-[#5d47a8]/70 relative items-center justify-center overflow-hidden",
          {
            "size-[29px]": size === "s",
            "size-m": size === "m",
            "size-l": size === "l",
            "size-xl": size === "xl",
            "size-2xl": size === "xxl",
            "size-full": size === "full",
          },
        )}
      >
        {!isLoggedIn ? (
          <FontAwesome6 name="user" solid size={14} color="white" />
        ) : (
          <FontAwesome6 name="user-secret" solid size={14} color="white" />
        )}
      </View>
    );
  }

  return (
    <View
      style={dimensions}
      className={cn(
        "rounded-full bg-background-persistentWhite relative items-center justify-center overflow-hidden",
        {
          "size-[30px]": size === "s",
          "size-m": size === "m",
          "size-l": size === "l",
          "size-xl": size === "xl",
          "size-2xl": size === "xxl",
          "size-full": size === "full",
        },
      )}
    >
      <Image
        source={{ uri: img || DEFAULT_AVATAR }}
        contentFit="cover"
        className={cn("aspect-square size-full")}
      />
    </View>
  );
}

export function AccountAvatar({ size = "s" }: { size?: AccountAvatarSize }) {
  const router = useRouter();
  const authenticatedUid = useAuthenticatedUid();
  const user = useUserProfile();
  const isLoggedIn = authenticatedUid !== undefined;

  // const data = useFragment(
  // 	graphql`
  // 		fragment AccountAvatar_profile on Profile {
  // 			id
  // 			name
  // 			...AccountAvatarImage_img
  // 		}
  // 	`,
  // 	provider,
  // );

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Open profile"
      onPress={() => {
        router.navigate("/profile");
      }}
    >
      <AccountAvatarImage isLoggedIn={isLoggedIn} img={user?.img} size={size} />
    </PressableScale>
  );
}
