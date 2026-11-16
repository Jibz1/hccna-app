import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

import { MoreRow, MoreSection } from "@/components/more/MoreSection";
import { useUserProfile } from "@/hooks/relay/useUserData";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

import { AccountAvatarImage } from "./AccountAvatar";

export function Profile({ className }: { className?: string }) {
  const { navigate } = useRouter();
  const { colors } = useAppTheme();
  const user = useUserProfile();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        user
          ? [name || "Your profile", user.email, user.phone]
              .filter(Boolean)
              .join(", ")
          : "Sign in or create an account"
      }
      accessibilityHint={user ? "Opens your profile settings" : undefined}
      onPress={() => {
        navigate(user ? "/profile" : "/account-modal-stack");
      }}
      className={cn(
        "border-continuous border-design-border bg-design-surface overflow-hidden rounded-[28px] border p-[22px] active:opacity-70",
        className,
      )}
    >
      <View className="flex-row items-center gap-4">
        {user ? (
          <AccountAvatarImage isLoggedIn img={user.img} size={56} />
        ) : (
          <View className="bg-design-selected h-14 w-14 items-center justify-center rounded-full">
            <FontAwesome6 name="user" size={23} color={colors.accent} />
          </View>
        )}
        <View className="flex-1 gap-1.5">
          <Text variant="title/medium" color="designPrimary">
            {user ? name || "Your profile" : "Make yourself at home"}
          </Text>
          <Text variant="caption/regular" color="designMuted">
            {user ? user.email : "Sign in to stay connected with your church."}
          </Text>
          {user?.phone ? (
            <Text variant="caption/regular" color="designMuted">
              {user.phone}
            </Text>
          ) : null}
        </View>
        {user ? (
          <FontAwesome6
            name="chevron-right"
            size={13}
            color={colors.textMuted}
          />
        ) : null}
      </View>
      {!user ? (
        <View className="bg-design-selected mt-5 min-h-12 flex-row items-center justify-between gap-3 rounded-full px-5 py-3">
          <Text variant="body/medium" color="designAccent" className="flex-1">
            Sign in or create an account
          </Text>
          <FontAwesome6 name="arrow-right" size={15} color={colors.accent} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function ProfileDepartments() {
  const user = useUserProfile();
  const departments = user?.departments;
  if (!departments?.length) {
    return null;
  }

  return (
    <MoreSection
      title={departments.length === 1 ? "My department" : "My departments"}
    >
      {departments.map((department, index) =>
        department.link ? (
          <MoreRow
            key={`${department.link}-${index}`}
            title={department.fullName ?? department.name ?? "Department"}
            subtitle={department.description ?? undefined}
            icon="people-group"
            href={department.link}
            last={index === departments.length - 1}
          />
        ) : (
          <View key={`department-${index}`} className="gap-1 px-5 py-4">
            <Text variant="body/medium" color="designPrimary">
              {department.fullName ?? department.name ?? "Department"}
            </Text>
            {department.description ? (
              <Text variant="caption/regular" color="designMuted">
                {department.description}
              </Text>
            ) : null}
          </View>
        ),
      )}
    </MoreSection>
  );
}
