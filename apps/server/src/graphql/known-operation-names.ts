// git grep -o 'query [a-zA-Z0-9_]\+(' | cut -d: -f2 | cut -d' ' -f2 | tr -d '(' | sort -u | pbcopy
export const KNOWN_OPERATION_NAMES_LIST = [
	"CampusesSignalQuery",
	"CastrChannelEditorQuery",
	"CCBFormsQuery",
	"CCBFormsV2Query",
	"CoreDataQuery",
	"EventCheckInQuery",
	"EventDetailQuery",
	"EventListImplQuery",
	"ensureUserProfileMutation",
	"FeaturedEventsQuery",
	"HomeQuery",
	"ProfileQuery",
	"LatestEventsQuery",
	"LatestSermonsQuery",
	"SermonsContainerQuery",
	"ShortsFeedQuery",
	"ThoughtOfGodQuery",
	"ThoughtOfGodImplQuery",
	"UpdateEventAttendanceInput",
	"useCodeSigninMutation",
	"useCodeVerificationMutation",
	"useDeleteAccountConfirmationMutation",
	"useRequestDeleteAccountMutation",
	"useSendBroadcastMutation",
	"UpdateCastrStreamInput",
	"VerseOfTheDayQuery",
	"verseOfTheDayV2",
	"useGetMyGivingQuery",
	"useGetMyGivingHistoryQuery",
	"EventAttendancesQuery",
	"PingCastrStreamQuery",
	"useExportYearGivingQuery",
	"GivingSignalQuery",
	"UserDataProfileQuery",
	"ProfileMutation",
	"PushTokensRegisterPushTokenMutation",
	"PushTokensUnregisterPushTokenMutation",
	"SetPreferredCampusMutation",
	"SavedVersesQuery",
	"SaveVerseMutation",
	"RemoveSavedVerseMutation",
	"ImportSavedVersesMutation",
	"ReconcileCampusSubscriptionsMutation",
	"PushTokensSendBroadcastMutation",
	"SermonsItemsRefetchQuery",
	"StreamEditorQuery",
	"useAttendanceMutation",
	"UserDataGivingQuery",
	"UserDataUpdateProfileMutation",
	"UserDataWoaQuery",
	"useUpdateCastrStreamMutation",
	"upComingEvents",
	"CampusesQuery",
	"ExportEventAttendanceModalQuery",
	"ExportEventAttendanceQuery",
	"MinistryToolsAccessQuery",
	"UserGivingQuery",
	"UserProfileQuery",
	"UserUpdateProfileMutation",
	"UserWoaQuery",
	"useExportEventAttendanceMutation",
	// Website (HCCNJ/site)
	"WebsiteCcbForms",
	"WebsiteLiveStreamStatus",
	"WebsiteVerseOfTheDay",
	// Cloud Scheduler jobs
	"SetVerseOfTheDay",
	"VodPushNotification",
	// Strapi 5 change notices (docs/cms-change-notices.md)
	"Strapi5ChangeNoticeMutation",
] as const;

const KNOWN_OPERATION_NAMES: ReadonlySet<string> = new Set(KNOWN_OPERATION_NAMES_LIST);

/**
 * Formats an operation name for metrics/logging.
 * - Known operations are returned as-is
 * - Unknown operations get an `-untagged` suffix
 * - Null/undefined becomes 'anonymous'
 */
export function formatOperationName(operationName: string | null | undefined): string {
	if (!operationName) {
		return "anonymous";
	}
	if (KNOWN_OPERATION_NAMES.has(operationName)) {
		return operationName;
	}
	return `${operationName}-untagged`;
}
