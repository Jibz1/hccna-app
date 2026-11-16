import { loadAppConfigSync } from "@/effect/AppConfig";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const secondaryApp = initializeApp(
	{
		projectId: "app-hccnj-17d4f",
	},
	"secondary",
);

const app = initializeApp({
	projectId: "app-hccnj",
});

const secondaryDb = getFirestore(secondaryApp);

const db = getFirestore(app);
const dbFieldValue = FieldValue;
const fieldPath = FieldPath;
const auth = getAuth(app);
const storage = getStorage(app);
const resolveStorageBucket = (value: string | undefined): string => {
	const normalized = value?.trim();
	return normalized && normalized.length > 0 ? normalized : "app-hccnj";
};
const DEFAULT_STORAGE_BUCKET = resolveStorageBucket(
	loadAppConfigSync().integrations.gcsExportBucket,
);

export const getStorageBucket = (bucketName = DEFAULT_STORAGE_BUCKET) =>
	storage.bucket(resolveStorageBucket(bucketName));

export { app, auth, db, dbFieldValue, fieldPath, secondaryDb, secondaryApp };

export enum FBPaths {
	// Document Paths
	departments = "departments",
	// wordActivationSub = 'wordActivationSub',
	// wordActivationScriptures = 'wordActivationScriptures',
	customVerse = "dailyVerse",
	todaysVerse = "todaysVerse",
	verseOfTheDay = "verseOfTheDay",
	smallGroups = "smallGroups",
	smallGroupPages = "smallGroupPages",
	departmentsPages = "departmentsPages",
}

export enum AppCollections {
	users = "app-users",
	config = "app-config",
	liveStreamDoc = "live-stream",
	liveStreamStateDoc = "live-stream-state",
	userConfigDoc = "newuser-config",
	castrStreams = "castr-streams",
	wordActivationSub = "wordActivationSub",
	wordActivationScriptures = "wordActivationScriptures",
	dailyVerse = "dailyVerse",
	signInCode = "sign-in-codes",
	deleteAccountCode = "delete-sign-in-codes",
	pushTokens = "pushTokens",
}
