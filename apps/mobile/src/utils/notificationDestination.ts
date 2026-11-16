import { Option, Schema } from "effect";
import type {
  NotificationRequest,
  PushNotificationTrigger,
} from "expo-notifications";
import type { Href } from "expo-router";

const StreamPayload = Schema.Struct({
  type: Schema.Literal("campus-stream"),
  campusSlug: Schema.String.check(
    Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  ),
  streamId: Schema.String.check(Schema.isNonEmpty()),
});
const VodPayload = Schema.Struct({ type: Schema.Literal("vod") });
const WoaPayload = Schema.Struct({ type: Schema.Literal("woa") });
const decodePayload = Schema.decodeUnknownOption(
  Schema.Union([StreamPayload, VodPayload, WoaPayload]),
);

function destinationForPayload(
  data: PushNotificationTrigger["payload"] | null,
): Href | undefined {
  const payload = decodePayload(data);
  if (Option.isNone(payload)) {
    return;
  }
  switch (payload.value.type) {
    case "vod":
      return "/vod-detail-modal";
    case "woa":
      return {
        pathname: "/vod-detail-modal",
        params: { slug: "word-of-activation" },
      };
    case "campus-stream":
      return {
        pathname: "/campus-modal",
        params: { slug: payload.value.campusSlug },
      };
  }
}

export function notificationDestination({
  content,
  trigger,
}: NotificationRequest): Href | undefined {
  const destination = destinationForPayload(content.data);
  if (
    destination ||
    !trigger ||
    !("type" in trigger) ||
    trigger.type !== "push"
  ) {
    return destination;
  }
  // Expo iOS maps only APNs' nested body to content.data. Direct FCM custom
  // fields remain in trigger.payload; Android also exposes remoteMessage.data.
  return (
    destinationForPayload(trigger.payload) ??
    destinationForPayload(trigger.remoteMessage?.data)
  );
}
