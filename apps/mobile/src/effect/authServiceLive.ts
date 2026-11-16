import { Layer } from "effect";

import type { UserDocType } from "@/types/userdoc";
import { ensureUserProfile } from "@/utils/ensureUserProfile";
import { randomNonce, sha256 } from "@/utils/randomNonce";

import {
  AuthService,
  AuthServiceDependencies,
  makeAuthService,
} from "./authService";

function makeLiveAuthDependencies(): AuthServiceDependencies {
  const FirebaseAuth =
    require("@react-native-firebase/auth") as typeof import("@react-native-firebase/auth");
  const FirebaseFirestore =
    require("@react-native-firebase/firestore") as typeof import("@react-native-firebase/firestore");
  const GoogleSignIn =
    require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin");
  const AppleAuthentication =
    require("expo-apple-authentication") as typeof import("expo-apple-authentication");
  const ReactNative = require("react-native") as typeof import("react-native");

  return {
    platformOS: ReactNative.Platform.OS,
    makeRawNonce: randomNonce,
    hashNonce: sha256,
    signInWithApple: (nonce) =>
      AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce,
      }),
    hasGooglePlayServices: () =>
      GoogleSignIn.GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      }).then(() => undefined),
    signInSilentlyWithGoogle: () => GoogleSignIn.GoogleSignin.signInSilently(),
    signInWithGoogle: () => GoogleSignIn.GoogleSignin.signIn(),
    getGoogleTokens: () => GoogleSignIn.GoogleSignin.getTokens(),
    signOutWithGoogle: () =>
      GoogleSignIn.GoogleSignin.signOut().then(() => undefined),
    makeAppleCredential: (identityToken, rawNonce, fullName) =>
      new FirebaseAuth.OAuthProvider("apple.com").credential({
        idToken: identityToken,
        rawNonce,
        fullName,
      }),
    makeGoogleCredential: (identityToken, accessToken) =>
      FirebaseAuth.GoogleAuthProvider.credential(identityToken, accessToken),
    getAuth: FirebaseAuth.getAuth,
    signInWithCredential: (auth, credential) =>
      FirebaseAuth.signInWithCredential(
        auth as ReturnType<typeof FirebaseAuth.getAuth>,
        credential,
      ),
    reauthenticateWithCredential: (user, credential) =>
      FirebaseAuth.reauthenticateWithCredential(
        user as Parameters<typeof FirebaseAuth.reauthenticateWithCredential>[0],
        credential,
      ).then(() => undefined),
    deleteUser: (user) =>
      FirebaseAuth.deleteUser(
        user as Parameters<typeof FirebaseAuth.deleteUser>[0],
      ),
    subscribeUserDocument: (uid, onDocument, onError) => {
      const userDocRef = FirebaseFirestore.doc(
        FirebaseFirestore.getFirestore(),
        "app-users",
        uid,
      );

      return FirebaseFirestore.onSnapshot(
        userDocRef,
        (docSnapshot) => {
          if (docSnapshot.exists()) {
            onDocument(docSnapshot.data() as UserDocType);
          }
        },
        onError,
      );
    },
    ensureUserProfile,
    userDocumentTimeoutMs: 60_000,
  };
}

export const AuthServiceLive = Layer.succeed(
  AuthService,
  makeAuthService(makeLiveAuthDependencies()),
);
