import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { Suspense, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CampusesUnavailable } from "@/components/campuses/CampusesUnavailable";
import { FullLoadingState } from "@/components/layout/FullLoadingState";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";
import {
  StyledImage as Image,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import { useSavePreferredCampus } from "@/hooks/profile/useSavePreferredCampus";
import { useCampuses, useHasCachedCampuses } from "@/hooks/relay/useCampuses";
import {
  useConnectivityAwareFetchPolicy,
  type ConnectivityAwareFetchPolicy,
} from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import {
  PRIMARY_CAMPUS_SLUG,
  sortCampusesPrimaryFirst,
} from "@/relay/campuses";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import { goBackOrReplace } from "@/utils/navigation";
import { cn } from "@/utils/styling";

function campusText(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, " ").trim();
  return text?.length ? text : undefined;
}

type CampusSelection = { slug: string; campusName: string };

function CampusPreferencesLayout({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  const { colors, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View className="bg-design-background flex-1">
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <View
        style={{ paddingLeft: insets.left, paddingRight: insets.right }}
        className="w-full max-w-[540px] flex-1 self-center"
      >
        <View
          style={{
            paddingTop: Platform.OS === "ios" ? 12 : insets.top + 12,
          }}
          className="flex-row items-center gap-3 px-5 pb-3"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to settings"
            onPress={() => {
              goBackOrReplace("/profile");
            }}
            className="border-design-border bg-design-surface active:bg-design-selected h-11 w-11 items-center justify-center rounded-full border"
          >
            <FontAwesome6 name="chevron-left" size={16} color={colors.text} />
          </Pressable>
          <Text
            accessibilityRole="header"
            className="flex-1"
            color="designPrimary"
            variant="bodyLg/medium"
            centered
          >
            Campus
          </Text>
          {action ?? <View className="w-11" />}
        </View>
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          contentContainerClassName="gap-5 px-5 pt-2"
        >
          <View className="gap-2">
            <Text
              accessibilityRole="header"
              variant="headingSm/bold"
              color="designPrimary"
              className="tracking-[-0.8px]"
            >
              Choose your campus
            </Text>
            <Text
              variant="caption/regular"
              color="designMuted"
              className="leading-[21px]"
            >
              Your events, livestreams, notifications, and giving, all in one
              place.
            </Text>
          </View>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

function PreferencesModalImpl({
  fetchPolicy,
  selectedCampusId,
  onCampusSelect,
  disabled,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
  selectedCampusId: string;
  onCampusSelect: (campus: CampusSelection) => void;
  disabled: boolean;
}) {
  const { colors } = useAppTheme();
  const fetchKey = useRetryKey(fetchPolicy);
  const campuses = useCampuses({ fetchKey, fetchPolicy });
  const sortedCampuses = sortCampusesPrimaryFirst(campuses);
  const campusOptions = sortedCampuses.length
    ? sortedCampuses
    : [
        {
          id: PRIMARY_CAMPUS_SLUG,
          slug: PRIMARY_CAMPUS_SLUG,
          campusName: "House of Stars",
          description: "",
          image: null,
          location: null,
          cityState: "",
        },
      ];

  return (
    <View className="gap-4">
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Default campus"
        className="gap-2.5"
      >
        {campusOptions.map((campus) => {
          const checked = selectedCampusId === campus.slug;
          const campusName = campusText(campus.campusName) ?? campus.slug;
          const location = campusText(campus.cityState) ?? campus.location;
          const image = campus.image?.trim();
          return (
            <Pressable
              key={campus.slug}
              onPress={() => {
                onCampusSelect({ slug: campus.slug, campusName });
              }}
              accessibilityRole="radio"
              accessibilityLabel={campusName}
              accessibilityHint={
                checked
                  ? "Your selected campus"
                  : `Select this campus for events, livestreams, and giving${location ? `. ${location}` : ""}`
              }
              disabled={disabled}
              accessibilityState={{
                checked,
                disabled,
              }}
              aria-checked={checked}
              className={cn(
                "border-continuous min-h-[84px] flex-row items-center gap-3 rounded-[18px] border p-3 active:opacity-70",
                checked
                  ? "border-design-accent/60 bg-design-selected"
                  : "border-transparent bg-design-surface",
              )}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="bg-design-surface-strong h-15 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[10px]"
              >
                {image ? (
                  <Image
                    source={image}
                    contentFit="cover"
                    contentPosition="center"
                    cachePolicy="disk"
                    enforceEarlyResizing
                    recyclingKey={image}
                    accessible={false}
                    className="h-full w-full"
                  />
                ) : (
                  <FontAwesome6
                    name="church"
                    size={22}
                    color={checked ? colors.accent : colors.textMuted}
                  />
                )}
              </View>
              <View className="min-w-0 flex-1 gap-1.5">
                <Text
                  variant="bodyLg/medium"
                  color="designPrimary"
                  className="leading-[23px]"
                >
                  {campusName}
                </Text>
                {location ? (
                  <Text
                    variant="caption/regular"
                    color="designMuted"
                    className="leading-[19px]"
                  >
                    {location}
                  </Text>
                ) : null}
              </View>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className={cn(
                  "h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                  checked
                    ? "border-design-accent bg-design-accent"
                    : "border-design-text-muted/40",
                )}
              >
                {checked ? (
                  <FontAwesome6
                    name="check"
                    size={12}
                    color={colors.background}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function PreferencesModal() {
  const router = useRouter();
  const preferredCampus = usePreferredCampus();
  const [draftCampus, setDraftCampus] = useState<CampusSelection>();
  const submitted = useRef(false);
  const { save, isSaving } = useSavePreferredCampus();
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedCampuses = useHasCachedCampuses();
  const selectedCampusId = draftCampus?.slug ?? preferredCampus.slug;
  const selectionDisabled = isSaving || !preferredCampus.isLoaded;
  const saveDisabled =
    selectionDisabled ||
    (preferredCampus.hasSavedCampus &&
      selectedCampusId === preferredCampus.slug);

  const handleSave = () => {
    if (!preferredCampus.isAuthenticated || saveDisabled || submitted.current) {
      return;
    }
    submitted.current = true;
    void save(selectedCampusId, preferredCampus.version).then(
      () => {
        toast.success({
          title: "Campus saved",
          message: `${draftCampus?.campusName ?? preferredCampus.campusName} is now your active campus.`,
        });
      },
      (cause: unknown) => {
        toast.error({
          title: "Couldn't save your campus",
          message: cause instanceof Error ? cause.message : "Please try again.",
        });
      },
    );
    goBackOrReplace("/profile");
  };

  if (!preferredCampus.isAuthenticated) {
    return (
      <CampusPreferencesLayout>
        <View className="border-continuous border-design-border bg-design-surface gap-4 rounded-[24px] border p-5">
          <Text variant="titleLg/medium" color="designPrimary">
            House of Stars
          </Text>
          <Text variant="body/regular" color="designMuted">
            You're currently seeing House of Stars. Sign in to choose your
            campus.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in to choose your campus"
            className="bg-design-text min-h-12 items-center justify-center rounded-2xl px-4 py-3 active:opacity-70"
            onPress={() => {
              router.push("/account-modal-stack");
            }}
          >
            <Text variant="body/medium" color="designBackground">
              Sign in
            </Text>
          </Pressable>
        </View>
      </CampusPreferencesLayout>
    );
  }

  if (fetchPolicy === "store-only" && !hasCachedCampuses) {
    return (
      <CampusPreferencesLayout>
        <View className="p-3xs">
          <CampusesUnavailable />
        </View>
      </CampusPreferencesLayout>
    );
  }

  return (
    <CampusPreferencesLayout
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save campus"
          accessibilityState={{ disabled: saveDisabled }}
          disabled={saveDisabled}
          onPress={handleSave}
          className={cn(
            "min-h-11 min-w-11 items-center justify-center px-1 active:opacity-70",
            saveDisabled && "opacity-40",
          )}
        >
          <Text variant="body/medium" color="designPrimary">
            Save
          </Text>
        </Pressable>
      }
    >
      <ErrorBoundaryWithRetry
        title="Unable to load campus preferences"
        subtitle="Please try again later"
      >
        <Suspense fallback=<FullLoadingState />>
          <PreferencesModalImpl
            fetchPolicy={fetchPolicy}
            selectedCampusId={selectedCampusId}
            onCampusSelect={setDraftCampus}
            disabled={selectionDisabled}
          />
        </Suspense>
      </ErrorBoundaryWithRetry>
    </CampusPreferencesLayout>
  );
}
