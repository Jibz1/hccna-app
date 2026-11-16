import { Schema } from "effect";

export const PushTokenPlatform = Schema.Literals(["android", "ios", "web"]);
export type PushTokenPlatform = typeof PushTokenPlatform.Type;
