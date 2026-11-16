import { format, parseISO } from "date-fns";
import { format as formatTZ } from "date-fns-tz";
import { Predicate } from "effect";
import { useRouter } from "expo-router";
import { PressableScale } from "pressto";
import { View } from "react-native";

import { StyledImage as Image } from "@/cssInterop";
import SvgCaretRight from "@/icons/CaretRight";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

export interface EventLinkProps {
  name: string;
  startDate: Date | string;
  slug: string;
  description?: string;
  speakerImages?: readonly string[];
  eventTime?: string;
}

export function EventLink({
  name,
  startDate,
  slug,
  description,
  speakerImages,
}: EventLinkProps) {
  const parsedStartDate = Predicate.isString(startDate)
    ? parseISO(startDate)
    : startDate;
  const dayOfWeek = format(parsedStartDate, "eee").toUpperCase();
  const dayAndMonth = format(parsedStartDate, "MMM dd").toUpperCase();
  const time = formatTZ(parsedStartDate, "h:mm aa zzz");
  const visibleSpeakerImages = speakerImages?.slice(0, 3) ?? [];
  const remainingSpeakerCount =
    (speakerImages?.length ?? 0) - visibleSpeakerImages.length;
  const { navigate } = useRouter();
  const { colors } = useAppTheme();

  const handlePress = () => {
    navigate({
      pathname: "/event-modal",
      params: {
        slug,
        title: name,
      },
    });
  };

  return (
    <PressableScale
      accessibilityLabel={`${name}, ${dayAndMonth}, ${time}`}
      accessibilityRole="button"
      accessibilityHint="Opens event details"
      onPress={handlePress}
    >
      <View className="rounded-m gap-5xs px-4xs py-4xs min-h-3xl w-full flex-row items-center">
        <View className="h-xl rounded-sk bg-design-selected w-xl shrink-0 flex-col items-center justify-center gap-px">
          <View className="items-start">
            <Text variant="labelXXxs/medium" color="designMuted">
              {dayOfWeek}
            </Text>
            <Text variant="labelXXs/medium" color="designAccent">
              {dayAndMonth}
            </Text>
          </View>
        </View>
        <View className="min-w-0 flex-1 flex-col items-start justify-center gap-px">
          <Text
            variant="labelSm/medium"
            color="designPrimary"
            numberOfLines={1}
            className="w-full"
          >
            {name}
          </Text>
          {description ? (
            <Text
              variant="labelXXs/medium"
              color="designMuted"
              numberOfLines={1}
              className="w-full"
            >
              {description}
            </Text>
          ) : null}
          <Text variant="labelXXs/medium" color="designAccent">
            {time}
          </Text>
        </View>
        {visibleSpeakerImages.length > 0 ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="shrink-0 flex-row items-center"
          >
            {visibleSpeakerImages.map((speakerImage, index) => (
              <Image
                key={`${speakerImage}-${index}`}
                source={speakerImage}
                accessible={false}
                contentFit="cover"
                contentPosition="top"
                cachePolicy="disk"
                enforceEarlyResizing
                recyclingKey={speakerImage}
                className={cn(
                  "border-design-surface-strong bg-design-selected h-8 w-8 shrink-0 rounded-full border-2",
                  index > 0 && "-ml-3",
                )}
              />
            ))}
            {remainingSpeakerCount > 0 ? (
              <View className="border-design-surface-strong bg-design-selected -ml-3 h-8 min-w-8 items-center justify-center rounded-full border-2 px-1">
                <Text variant="captionSm/medium" color="designAccent">
                  +{remainingSpeakerCount}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View className="pl-5xs shrink-0 items-center justify-center">
          <SvgCaretRight width={18} height={18} color={colors.textMuted} />
        </View>
      </View>
    </PressableScale>
  );
}
