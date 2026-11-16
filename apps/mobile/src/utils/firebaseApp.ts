import {
  getApps,
  initializeApp,
  type ReactNativeFirebase,
} from "@react-native-firebase/app";

// Firebase web configuration is public client metadata. This app ID matches
// the registered `hccna-app-site` Firebase app used by the existing analytics
// measurement ID.
const FIREBASE_WEB_OPTIONS: ReactNativeFirebase.FirebaseAppOptions = {
  apiKey: "AIzaSyAY1Kp59903-irjyFY8_NgulZ8OQrrGB8Q",
  appId: "1:321301228846:web:93795b4e719aba835f9ebf",
  authDomain: "app-hccnj.firebaseapp.com",
  databaseURL: "https://app-hccnj.firebaseio.com",
  measurementId: "G-5RWG6N0R0W",
  messagingSenderId: "321301228846",
  projectId: "app-hccnj",
  storageBucket: "app-hccnj.appspot.com",
};

const DEFAULT_FIREBASE_APP_NAME = "[DEFAULT]";

export async function initializeFirebaseAppForWeb(): Promise<void> {
  if (getApps().some((app) => app.name === DEFAULT_FIREBASE_APP_NAME)) {
    return;
  }

  await initializeApp(FIREBASE_WEB_OPTIONS);
}
