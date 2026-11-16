import { builder } from "./builder";
// Import side effects register types and fields on the shared builder.
import "./schema/scriptures/vod";
import "./schema/scriptures/wordActivationMonthly";
import "./schema/cms/sermon";
import "./schema/cms/shorts";
import "./schema/user";
import "./schema/user/saved-verses";
import "./schema/cms/home";
import "./schema/cms/campuses";
import "./schema/cms/events";
import "./schema/event/attendance";
import "./schema/cms/core";
import "./schema/user/update-user";
import "./schema/user/register-push-token";
import "./schema/user/campus-preference";
import "./schema/user/reconcile-campus-subscriptions";
import "./schema/user/send-broadcast";
import "./schema/cms/thoughtOfGod";
import "./schema/castr/stream";
import "./schema/castr/liveStreamStatus";
import "./schema/user/ensure-user-profile";
import "./schema/user/profile";
import "./schema/user/donationsV2";
import "./schema/cms/webhookUpdate";

// Build the schema after all feature modules have registered their fields.
export const schema = builder.toSchema();
