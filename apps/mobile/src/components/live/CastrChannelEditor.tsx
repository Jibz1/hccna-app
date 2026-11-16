import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Schema } from "effect";
import { useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import {
  ActivityIndicator,
  Pressable,
  Switch,
  TextInput,
  View,
} from "react-native";
import { graphql, useLazyLoadQuery } from "react-relay";

import { Form } from "@/components/forms/Form";
import { DetailModalSection } from "@/components/layout/DetailModalLayout";
import { Castr } from "@/components/live/Castr";
import { useRetryKey } from "@/components/providers/ErrorBoundaryWithRetry";
import { useUpdateCastrStreamMutation } from "@/hooks/live/useUpdateCastrStreamMutation";
import { useZodForm } from "@/hooks/utils/useZodForm";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import { goBackOrReplace } from "@/utils/navigation";
import { cn } from "@/utils/styling";

import { CastrChannelEditorQuery } from "./__generated__/CastrChannelEditorQuery.graphql";
import { CastrDestinationStatus } from "./CastrDestinationStatus";

function StreamField({
  name,
  label,
  accessibilityLabel = label,
  maxLength,
  multiline = false,
  disabled,
  streamKey = false,
}: {
  name: string;
  label: string;
  accessibilityLabel?: string;
  maxLength?: number;
  multiline?: boolean;
  disabled: boolean;
  streamKey?: boolean;
}) {
  const { control } = useFormContext();
  const { colors } = useAppTheme();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View className="gap-5xs">
          <View className="gap-4xs flex-row items-center justify-between">
            <Text
              color="designMuted"
              variant="caption/regular"
              className="flex-1"
            >
              {label}
            </Text>
            {maxLength ? (
              <Text color="designMuted" variant="labelXXs/regular">
                {String(field.value ?? "").length}/{maxLength}
              </Text>
            ) : null}
          </View>
          <TextInput
            ref={field.ref}
            accessibilityLabel={accessibilityLabel}
            value={String(field.value ?? "")}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            editable={!disabled}
            multiline={multiline}
            scrollEnabled={multiline}
            maxLength={maxLength}
            autoCapitalize={streamKey ? "none" : "sentences"}
            autoCorrect={!streamKey}
            secureTextEntry={streamKey}
            placeholder={streamKey ? "Paste stream key" : label}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            textAlignVertical="top"
            className={cn(
              "text-design-text py-5xs px-0",
              multiline
                ? "text-p-xs min-h-[96px] max-h-[160px] leading-[20px]"
                : "text-p-sm min-h-[44px]",
            )}
          />
          {fieldState.error ? (
            <Text
              accessibilityRole="alert"
              color="designNegative"
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

function broadcastStatusLabel(status?: string | null) {
  if (status === "online") {
    return "Live";
  }
  if (status === "offline") {
    return "Not live";
  }
  return "Status unknown";
}

function DestinationIcon({
  normalizedTemplate,
}: {
  normalizedTemplate: string;
}) {
  const { colors } = useAppTheme();
  const brand = normalizedTemplate.includes("youtube")
    ? "youtube"
    : normalizedTemplate.includes("facebook")
      ? "facebook"
      : normalizedTemplate.includes("instagram")
        ? "instagram"
        : undefined;

  return (
    <View className="bg-design-selected h-[42px] w-[42px] items-center justify-center rounded-[14px]">
      {brand ? (
        <FontAwesome6
          name={brand}
          iconStyle="brands"
          size={19}
          color={colors.accent}
        />
      ) : (
        <FontAwesome6 name="tower-broadcast" size={17} color={colors.accent} />
      )}
    </View>
  );
}

const CastrChannel = graphql`
  query CastrChannelEditorQuery($campusSlug: String!) {
    castrStream(campusSlug: $campusSlug) {
      name
      title
      description
      enabled
      broadcasting_status
      id
      platforms {
        template
        id
        broadcasting_status
        channel_name
        enabled
        name
        stream_key
        requiresNewStreamKey
        template
        title
        description
      }
      castrPlayerUrl
    }
  }
`;

export function CastrChannelEditor({
  campusSlug,
  showPreview = false,
}: {
  campusSlug: string;
  showPreview?: boolean;
}) {
  const { colors } = useAppTheme();
  const fetchKey = useRetryKey();
  const [collapsedMetadata, setCollapsedMetadata] = useState<
    ReadonlySet<number>
  >(() => new Set());
  const { castrStream } = useLazyLoadQuery<CastrChannelEditorQuery>(
    CastrChannel,
    { campusSlug },
    {
      fetchPolicy: "network-only",
      fetchKey,
    },
  );
  function toggleEnabled() {
    const currentPlatforms = getValues("platforms");
    const updatedPlatforms = currentPlatforms.map((platform) => ({
      ...platform,
      enabled: !getValues("enabledAll"),
    }));
    form.setValue("platforms", updatedPlatforms, {
      shouldDirty: true,
      shouldValidate: true,
    });

    form.setValue("enabledAll", !getValues("enabledAll"));
  }

  function togglePlatformEnabled(platformId?: string | null) {
    if (!platformId) {
      return;
    }
    const currentPlatforms = getValues("platforms");
    const updatedPlatforms = currentPlatforms.map((platform) =>
      platform.id === platformId
        ? { ...platform, enabled: !platform.enabled }
        : platform,
    );
    form.setValue("platforms", updatedPlatforms, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(
      "enabledAll",
      updatedPlatforms.every((platform) => platform.enabled),
    );
  }

  function setCustomMetadata(index: number, customMetadata: boolean) {
    const platform = getValues(`platforms.${index}`);
    // Customize starts from the current shared details so only the
    // differences need typing; Use stream details discards the draft.
    form.setValue(
      `platforms.${index}`,
      {
        ...platform,
        customMetadata,
        title: customMetadata ? getValues("title") : "",
        description: customMetadata ? getValues("description") : "",
      },
      { shouldDirty: true, shouldValidate: true },
    );
  }

  const enabledAll =
    castrStream?.platforms?.every((platform) => platform.enabled) ?? false;

  const { updateCastrStream, isInFlight } = useUpdateCastrStreamMutation();

  const form = useZodForm({
    mode: "onChange",
    reValidateMode: "onChange",
    schema: Schema.Struct({
      title: Schema.String.check(
        Schema.isMinLength(1, { message: "Required" }),
        Schema.isMaxLength(100, {
          message: "Must be 100 characters or fewer",
        }),
      ),
      description: Schema.String.check(
        Schema.isMinLength(1, { message: "Required" }),
        Schema.isMaxLength(5000, {
          message: "Must be 5000 characters or fewer",
        }),
      ),
      enabled: Schema.Boolean,
      enabledAll: Schema.Boolean,
      platforms: Schema.Array(
        Schema.Struct({
          id: Schema.NullOr(Schema.String),
          enabled: Schema.Boolean,
          streamKey: Schema.NullOr(Schema.String),
          customMetadata: Schema.Boolean,
          title: Schema.String,
          description: Schema.String,
        }).check(
          Schema.makeFilter((platform) =>
            platform.customMetadata
              ? (["title", "description"] as const).flatMap((field) =>
                  platform[field].trim()
                    ? []
                    : [{ path: [field], issue: "Required" }],
                )
              : undefined,
          ),
        ),
      ),
    }),
    defaultValues: {
      enabled: castrStream?.enabled ?? false,
      title: castrStream?.title ?? "",
      description: castrStream?.description ?? "",
      enabledAll,
      platforms:
        castrStream?.platforms?.map((platform) => ({
          id: platform.id,
          enabled: platform.enabled ?? false,
          streamKey: platform.stream_key ?? null,
          // The server stores a destination's title and description together.
          customMetadata: platform.title != null,
          title: platform.title ?? "",
          description: platform.description ?? "",
        })) ?? [],
    },
  });

  const {
    getValues,
    watch,
    handleSubmit,
    formState: { isValid, isSubmitting, errors },
  } = form;

  const platforms = watch("platforms");
  const selectedCount = platforms.filter((platform) => platform.enabled).length;
  const isSaving = isSubmitting || isInFlight;

  if (!castrStream) {
    return (
      <DetailModalSection>
        <View className="gap-3xs p-2xs bg-design-surface-strong border-design-border rounded-[26px] border">
          <Text color="designPrimary" variant="bodyLg/bold">
            Stream unavailable
          </Text>
          <Text color="designMuted" variant="pXs/regular">
            There is no stream available to manage for this campus.
          </Text>
        </View>
      </DetailModalSection>
    );
  }

  const destinations = castrStream.platforms ?? [];

  return (
    <>
      <DetailModalSection>
        <View className="gap-3xs">
          <View className="gap-3xs flex-row items-center justify-between">
            <View className="gap-6xs min-w-0 flex-1">
              <Text color="designAccent" variant="labelXXs/medium">
                STREAM SETTINGS
              </Text>
              <Text
                accessibilityRole="header"
                color="designPrimary"
                variant="title/bold"
              >
                {castrStream.name?.trim()
                  ? castrStream.name.trim()
                  : "Manage stream"}
              </Text>
            </View>
            <CastrDestinationStatus destinations={destinations} />
          </View>
          <Text color="designMuted" variant="pXs/regular">
            Update your stream details and choose where to broadcast.
          </Text>
          <Text color="designMuted" variant="labelXXs/regular">
            Incoming stream:{" "}
            {broadcastStatusLabel(castrStream.broadcasting_status)}
          </Text>
        </View>
      </DetailModalSection>
      {showPreview && castrStream.castrPlayerUrl ? (
        <Castr
          presentation="fullWidth"
          image="https://storage.googleapis.com/app-hccnj/Image/Welcome_Mens_Night_ebdc9cfe9d/Welcome_Mens_Night_ebdc9cfe9d.jpg"
          streamLink={castrStream.castrPlayerUrl}
        />
      ) : null}
      <Form form={form}>
        <DetailModalSection>
          <View className="gap-3xs">
            <Text
              accessibilityRole="header"
              color="designPrimary"
              variant="bodyLg/bold"
            >
              Stream details
            </Text>
            <View className="px-2xs bg-design-surface-strong border-design-border rounded-[26px] border">
              <View className="py-3xs border-b-design-border border-b">
                <StreamField
                  name="title"
                  label="Stream title"
                  maxLength={100}
                  disabled={isSaving}
                />
              </View>
              <View className="py-3xs">
                <StreamField
                  name="description"
                  label="Description"
                  maxLength={5000}
                  multiline
                  disabled={isSaving}
                />
              </View>
            </View>
          </View>

          <View className="gap-3xs">
            <View className="gap-5xs">
              <Text
                accessibilityRole="header"
                color="designPrimary"
                variant="bodyLg/bold"
              >
                Destinations
              </Text>
              <Text color="designMuted" variant="pXs/regular">
                Choose where to send this stream. Changes apply when you save.
              </Text>
            </View>
            {platforms.length > 0 ? (
              <View className="px-2xs bg-design-surface-strong border-design-border rounded-[26px] border">
                <View className="gap-3xs py-3xs border-b-design-border flex-row items-center border-b">
                  <View className="gap-6xs flex-1">
                    <Text color="designPrimary" variant="pSm/medium">
                      All destinations
                    </Text>
                    <Text color="designMuted" variant="labelXXs/regular">
                      {selectedCount} of {platforms.length} selected
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel="All destinations"
                    value={watch("enabledAll")}
                    onValueChange={toggleEnabled}
                    disabled={isSaving}
                    trackColor={{ false: colors.selected, true: colors.accent }}
                    thumbColor={colors.onImage}
                    ios_backgroundColor={colors.selected}
                  />
                </View>
                {destinations.map((item, index) => {
                  const platform = platforms[index];
                  const enabled = platform?.enabled ?? false;
                  const customMetadata = platform?.customMetadata ?? false;
                  const metadataExpanded = !collapsedMetadata.has(index);
                  const metadataErrors = errors.platforms?.[index];
                  const hasMetadataErrors = Boolean(
                    metadataErrors?.title ?? metadataErrors?.description,
                  );
                  const normalizedTemplate =
                    item.template?.trim().toLowerCase() ?? "";
                  // The server marks destinations whose start needs a newly
                  // pasted key; it skips them when saved with the old one.
                  const needsNewKey =
                    item.requiresNewStreamKey === true &&
                    enabled &&
                    (!platform?.streamKey ||
                      platform.streamKey === item.stream_key);
                  const platformName =
                    [item.name, item.channel_name, item.template]
                      .find((value) => value?.trim())
                      ?.trim() ?? "Destination";
                  return (
                    <View
                      key={item.id ?? item.channel_name ?? item.name ?? index}
                      className={cn(
                        "gap-3xs py-3xs border-b-design-border",
                        index < platforms.length - 1
                          ? "border-b"
                          : "border-b-0",
                      )}
                    >
                      <View className="gap-3xs flex-row items-center">
                        <DestinationIcon
                          normalizedTemplate={normalizedTemplate}
                        />
                        <View className="gap-6xs min-w-0 flex-1">
                          <Text color="designPrimary" variant="pSm/medium">
                            {platformName}
                          </Text>
                          <Text
                            color="designMuted"
                            variant="labelXXs/regular"
                            transform="capitalize"
                          >
                            {item.template ?? "Custom stream"}
                          </Text>
                          <Text
                            accessibilityLabel={`${platformName}: ${broadcastStatusLabel(item.broadcasting_status)}`}
                            color={
                              item.broadcasting_status === "online"
                                ? "positive"
                                : "designMuted"
                            }
                            variant="labelXXs/medium"
                          >
                            {broadcastStatusLabel(item.broadcasting_status)}
                          </Text>
                        </View>
                        <Switch
                          accessibilityLabel={`Broadcast to ${platformName}`}
                          value={enabled}
                          onValueChange={() => {
                            togglePlatformEnabled(item.id);
                          }}
                          disabled={isSaving || !item.id}
                          trackColor={{
                            false: colors.selected,
                            true: colors.accent,
                          }}
                          thumbColor={colors.onImage}
                          ios_backgroundColor={colors.selected}
                        />
                      </View>
                      {normalizedTemplate.includes("instagram") && enabled ? (
                        <View className="p-3xs bg-design-surface border-design-border rounded-[18px] border">
                          <StreamField
                            name={`platforms.${index}.streamKey`}
                            label={`${platformName} stream key`}
                            disabled={isSaving}
                            streamKey
                          />
                          {needsNewKey ? (
                            <Text
                              accessibilityRole="alert"
                              color="designNegative"
                              variant="labelXXs/regular"
                            >
                              New stream key required. Instagram gives a new key
                              each time you go live; without one, Instagram is
                              skipped.
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                      {customMetadata ? (
                        <View className="px-3xs bg-design-surface border-design-border rounded-[18px] border">
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Custom details for ${platformName}`}
                            accessibilityHint="Show or hide the editor. Custom details stay active."
                            accessibilityState={{ expanded: metadataExpanded }}
                            onPress={() => {
                              setCollapsedMetadata((current) => {
                                const next = new Set(current);
                                if (next.has(index)) {
                                  next.delete(index);
                                } else {
                                  next.add(index);
                                }
                                return next;
                              });
                            }}
                            className={cn(
                              "gap-3xs py-3xs min-h-[44px] flex-row items-center active:opacity-70",
                              metadataExpanded
                                ? "border-b-design-border border-b"
                                : "",
                            )}
                          >
                            <View className="gap-6xs min-w-0 flex-1">
                              <Text color="designPrimary" variant="pXs/medium">
                                Custom details
                              </Text>
                              <Text
                                color="designMuted"
                                variant="labelXXs/regular"
                                numberOfLines={metadataExpanded ? undefined : 1}
                              >
                                {metadataExpanded
                                  ? "Title and description for this destination only."
                                  : platform.title}
                              </Text>
                            </View>
                            <FontAwesome6
                              name={
                                metadataExpanded ? "chevron-up" : "chevron-down"
                              }
                              size={12}
                              color={colors.textMuted}
                            />
                          </Pressable>
                          {!metadataExpanded && hasMetadataErrors ? (
                            <Text
                              accessibilityRole="alert"
                              color="designNegative"
                              variant="labelXXs/regular"
                              className="pb-3xs"
                            >
                              Open custom details to complete the required
                              fields.
                            </Text>
                          ) : null}
                          {metadataExpanded ? (
                            <>
                              <View className="py-3xs border-b-design-border border-b">
                                <StreamField
                                  name={`platforms.${index}.title`}
                                  label="Title"
                                  accessibilityLabel={`${platformName} title`}
                                  maxLength={100}
                                  disabled={isSaving}
                                />
                              </View>
                              <View className="py-3xs border-b-design-border border-b">
                                <StreamField
                                  name={`platforms.${index}.description`}
                                  label="Description"
                                  accessibilityLabel={`${platformName} description`}
                                  maxLength={5000}
                                  multiline
                                  disabled={isSaving}
                                />
                              </View>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Use stream details for ${platformName}`}
                                accessibilityHint="Uses the shared stream title and description when you save."
                                accessibilityState={{
                                  disabled: isSaving || !item.id,
                                }}
                                disabled={isSaving || !item.id}
                                onPress={() => {
                                  setCustomMetadata(index, false);
                                }}
                                className={cn(
                                  "gap-4xs py-4xs min-h-[44px] flex-row items-center active:opacity-70",
                                  isSaving || !item.id
                                    ? "opacity-45"
                                    : "opacity-100",
                                )}
                              >
                                <FontAwesome6
                                  name="arrow-rotate-left"
                                  size={12}
                                  color={colors.accent}
                                />
                                <Text
                                  color="designAccent"
                                  variant="caption/medium"
                                >
                                  Use stream details
                                </Text>
                              </Pressable>
                            </>
                          ) : null}
                        </View>
                      ) : (
                        <View className="gap-4xs pl-3xs pr-5xs py-5xs bg-design-surface flex-row flex-wrap items-center justify-between rounded-[18px]">
                          <Text color="designMuted" variant="caption/regular">
                            Using stream details
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Customize title and description for ${platformName}`}
                            accessibilityHint="Edit the title and description for this destination."
                            accessibilityState={{
                              disabled: isSaving || !item.id,
                            }}
                            disabled={isSaving || !item.id}
                            onPress={() => {
                              setCustomMetadata(index, true);
                            }}
                            className={cn(
                              "gap-5xs px-4xs min-h-[44px] flex-row items-center rounded-[12px] active:bg-design-selected",
                              isSaving || !item.id
                                ? "opacity-45"
                                : "opacity-100",
                            )}
                          >
                            <FontAwesome6
                              name="pen"
                              size={11}
                              color={colors.accent}
                            />
                            <Text color="designAccent" variant="caption/medium">
                              Customize
                            </Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            ) : (
              <View className="p-2xs bg-design-surface-strong border-design-border rounded-[26px] border">
                <Text color="designMuted" variant="pXs/regular">
                  No destinations are connected to this stream.
                </Text>
              </View>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save stream changes"
            accessibilityState={{
              disabled: !isValid || isSaving,
              busy: isSaving,
            }}
            disabled={!isValid || isSaving}
            className={cn(
              "bg-design-text px-xs py-3xs min-h-[54px] w-full items-center justify-center rounded-[28px] active:opacity-80",
              !isValid || isSaving ? "opacity-45" : "opacity-100",
            )}
            onPress={() => {
              void handleSubmit(async (data) => {
                await updateCastrStream({
                  campusSlug,
                  description: data.description,
                  platforms: data.platforms
                    .filter((platform) => platform.id)
                    .map((platform) => ({
                      id: platform.id!,
                      key: platform.streamKey,
                      broadcasting_status: platform.enabled
                        ? "online"
                        : "offline",
                      // null returns the destination to the shared details.
                      title: platform.customMetadata ? platform.title : null,
                      description: platform.customMetadata
                        ? platform.description
                        : null,
                    })),
                  streamId: castrStream.id ?? "",
                  title: data.title,
                })
                  .then((response) => {
                    const skipped =
                      response.updateCastrStream?.skippedPlatformIds ?? [];
                    toast.success(
                      skipped.length > 0
                        ? {
                            title: "Stream Updated",
                            message:
                              "Instagram skipped: paste a new stream key to go live there.",
                          }
                        : { title: "Stream Updated Successfully" },
                    );
                    goBackOrReplace();
                  })
                  .catch((error) => {
                    toast.error({
                      title: "Error Updating Stream",
                      message: error.message,
                    });
                  });
              })();
            }}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text color="designBackground" variant="pSm/bold">
                Save changes
              </Text>
            )}
          </Pressable>
        </DetailModalSection>
      </Form>
    </>
  );
}
