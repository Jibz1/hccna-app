import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { addMinutes } from "date-fns";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import {
  DeleteAccountLayout,
  KeepAccountAction,
} from "@/components/auth/DeleteAccountLayout";
import { CountDownTimer } from "@/components/events/CountDownTimer";
import { useVerifyDeleteAccountCodeMutation } from "@/hooks/auth/useDeleteAccountConfirmation";
import { useRequestDeleteAccount } from "@/hooks/auth/useRequestDeleteAccount";
import { useUserProfile } from "@/hooks/relay/useUserData";
import { useAppTheme } from "@/theme/useAppTheme";
import { OtpInput } from "@/ui/OtpInput";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast/Toast";
import { DevicePrefs } from "@/utils/devicePrefs";
import { goBackOrReplace } from "@/utils/navigation";
import { cn } from "@/utils/styling";

export default function DeleteAccountConfirmationScreen() {
  const user = useUserProfile();
  const { colors } = useAppTheme();
  const { mutateAsync: verifyDeleteAccountCode } =
    useVerifyDeleteAccountCodeMutation();
  const { requestDeleteAccount } = useRequestDeleteAccount();
  const { deleteAccountRequest } = useSyncExternalStore(
    DevicePrefs.subscribe,
    DevicePrefs.getSnapshot,
    DevicePrefs.getSnapshot,
  );
  const email = user?.email;
  const expiresTimestampMs =
    deleteAccountRequest?.email === email
      ? deleteAccountRequest?.expiresTimestampMs
      : null;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codeRejected, setCodeRejected] = useState(false);
  const [action, setAction] = useState<"delete" | "resend" | null>(null);
  const inFlight = useRef(false);
  const [expiredTimestamp, setExpiredTimestamp] = useState<number | null>(() =>
    expiresTimestampMs && expiresTimestampMs <= Date.now()
      ? expiresTimestampMs
      : null,
  );

  useEffect(() => {
    if (!expiresTimestampMs) {
      return;
    }
    const timeout = setTimeout(
      () => {
        setExpiredTimestamp(expiresTimestampMs);
      },
      Math.max(0, expiresTimestampMs - Date.now()) + 1,
    );
    return () => {
      clearTimeout(timeout);
    };
  }, [expiresTimestampMs]);

  const isBusy = action !== null;
  const canDelete = Boolean(
    email &&
    expiresTimestampMs &&
    expiresTimestampMs !== expiredTimestamp &&
    /^\d{6}$/.test(code) &&
    !isBusy,
  );

  const resendCode = async () => {
    if (!email || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setAction("resend");
    setError(null);
    try {
      await requestDeleteAccount({});
      DevicePrefs.update({
        deleteAccountRequest: {
          email,
          expiresTimestampMs: addMinutes(Date.now(), 10).getTime(),
        },
      });
      setCode("");
      setCodeRejected(false);
      toast.success({ title: "New confirmation code sent" });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to resend the code. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setAction(null);
    }
  };

  const deleteAccount = async () => {
    if (!canDelete || inFlight.current) {
      return;
    }
    if (!expiresTimestampMs || expiresTimestampMs <= Date.now()) {
      setError("This code has expired. Request a new code to continue.");
      return;
    }
    inFlight.current = true;
    setAction("delete");
    setError(null);
    setCodeRejected(false);
    try {
      await verifyDeleteAccountCode({ code });
      DevicePrefs.update({ deleteAccountRequest: null });
      toast.success({ title: "Account deleted" });
      goBackOrReplace("/profile");
    } catch (error) {
      setCodeRejected(true);
      setError(
        error instanceof Error
          ? error.message
          : "Unable to delete your account. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setAction(null);
    }
  };

  return (
    <DeleteAccountLayout step={2} busy={isBusy}>
      <View className="gap-3xs items-center">
        <View className="bg-design-surface h-[76px] w-[76px] items-center justify-center rounded-full">
          <FontAwesome6
            name="envelope-open-text"
            size={28}
            color={colors.accent}
          />
        </View>
        <Text
          accessibilityRole="header"
          color="designPrimary"
          variant="headingSm/bold"
          centered
        >
          Check your email
        </Text>
        <View className="gap-5xs items-center">
          <Text color="designMuted" variant="body/regular" centered>
            {email
              ? "Enter the 6-digit confirmation code sent to"
              : "Sign in to confirm account deletion."}
          </Text>
          {email ? (
            <Text
              selectable
              color="designPrimary"
              variant="body/medium"
              centered
            >
              {email}
            </Text>
          ) : null}
        </View>
      </View>
      <View className="gap-3xs">
        <Text color="designPrimary" variant="pXs/medium" centered>
          Confirmation code
        </Text>
        <OtpInput
          appearance="design"
          value={code}
          disabled={isBusy || !email}
          status={codeRejected ? "error" : "idle"}
          onChange={(nextCode) => {
            setCode(nextCode);
            setCodeRejected(false);
            setError(null);
          }}
        />
        {expiresTimestampMs ? (
          <View className="items-center">
            <CountDownTimer
              timestamp={expiresTimestampMs}
              label="Code expires in"
              endLabel="Code expired. Request a new code."
              color="designMuted"
              variant="caption/regular"
            />
          </View>
        ) : (
          <Text color="designMuted" variant="caption/regular" centered>
            Request a new code to continue.
          </Text>
        )}
        {error ? (
          <Text
            accessibilityRole="alert"
            color="designNegative"
            variant="pXs/regular"
            centered
          >
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resend confirmation code"
          accessibilityState={{
            disabled: isBusy || !email,
            busy: action === "resend",
          }}
          disabled={isBusy || !email}
          onPress={() => {
            void resendCode();
          }}
          className="gap-5xs px-3xs py-4xs min-h-[48px] flex-row items-center justify-center active:opacity-60"
        >
          {action === "resend" ? (
            <ActivityIndicator color={colors.accent} />
          ) : null}
          <Text color="designAccent" variant="pXs/bold">
            {action === "resend" ? "Sending code…" : "Resend code"}
          </Text>
        </Pressable>
      </View>
      <View className="border-continuous bg-design-negative/10 gap-5xs p-2xs rounded-[24px]">
        <Text color="designNegative" variant="body/medium">
          This is the final step
        </Text>
        <Text
          color="designMuted"
          variant="pXs/regular"
          className="leading-[21px]"
        >
          Selecting “Delete my account” permanently removes your account and
          signs you out. This can&apos;t be undone.
        </Text>
      </View>
      <View className="gap-4xs pt-4xs mt-auto">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete my account"
          accessibilityState={{
            disabled: !canDelete,
            busy: action === "delete",
          }}
          disabled={!canDelete}
          onPress={() => {
            void deleteAccount();
          }}
          className={cn(
            "border-continuous bg-design-negative gap-4xs min-h-[54px] flex-row items-center justify-center rounded-full px-2xs py-[14px] active:opacity-70",
            !canDelete && action !== "delete" && "opacity-45",
          )}
        >
          {action === "delete" ? (
            <ActivityIndicator color={colors.background} />
          ) : null}
          <Text color="designBackground" variant="pSm/bold" centered>
            {action === "delete" ? "Deleting account…" : "Delete my account"}
          </Text>
        </Pressable>
        <KeepAccountAction disabled={isBusy} />
      </View>
    </DeleteAccountLayout>
  );
}
