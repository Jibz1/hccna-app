import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useRouter } from "expo-router";
import { Alert, Pressable } from "react-native";

import { Text } from "@/ui/Text";
import { toSavedVerseKindInput, type SavedVerse } from "@/utils/savedVerses";

import { useSavedVerseActions } from "./useSavedVerseActions";
import { useSavedVerses } from "./useSavedVerses";

export interface SaveableVerse {
  readonly verseId?: string | null;
  readonly book?: string | null;
  readonly text?: string | null;
  readonly image?: string | null;
}

/** Saves the displayed verse to the signed-in user's account, or asks a guest to sign in. */
export function SaveVerseButton({
  verse,
  kind,
  onFeedback,
}: {
  verse: SaveableVerse;
  kind: SavedVerse["kind"];
  onFeedback: (message: string | null) => void;
}) {
  const router = useRouter();
  const { isSignedIn, verses } = useSavedVerses();
  const { save, remove, isPending } = useSavedVerseActions();
  const verseId = verse.verseId;
  if (!verseId) {
    return null;
  }
  const isSaved = verses.some((saved) => saved.verseId === verseId);

  const toggle = () => {
    if (!isSignedIn) {
      router.push("/account-modal-stack");
      return;
    }
    if (isPending) {
      return;
    }
    const change = isSaved
      ? remove(verseId)
      : save({
          verseId,
          kind: toSavedVerseKindInput(kind),
          book: verse.book ?? "",
          text: verse.text ?? "",
          image: verse.image ?? null,
        });
    onFeedback(isSaved ? "Removed from saved verses" : "Saved to your account");
    change.catch((error: Error) => {
      onFeedback(null);
      Alert.alert(
        isSaved ? "Unable to remove verse" : "Unable to save verse",
        error.message,
      );
    });
  };

  const label = !isSignedIn ? "Sign in to save" : isSaved ? "Saved" : "Save";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        !isSignedIn
          ? "Sign in to save this verse"
          : isSaved
            ? "Remove saved verse"
            : "Save verse to your account"
      }
      accessibilityState={{ selected: isSaved }}
      onPress={toggle}
      className="min-h-[54px] flex-1 flex-row items-center justify-center gap-[10px] active:opacity-60"
    >
      <FontAwesome6 name="bookmark" solid={isSaved} size={18} color="#FFF8E9" />
      <Text color="verseAction" variant="body/regular">
        {label}
      </Text>
    </Pressable>
  );
}
