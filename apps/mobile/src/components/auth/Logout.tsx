import { ProfileSettingsRow } from "@/components/profile/ProfileSettingsRow";
import { useLogoutMutation } from "@/hooks/auth/useLogoutMutation";
import { useAuthenticatedUid } from "@/hooks/relay/useUserData";
import { toast } from "@/ui/toast/Toast";

export function Logout() {
  const user = useAuthenticatedUid();
  const { mutate: logout, isPending } = useLogoutMutation();
  if (!user) {
    return null;
  }

  const handleLogout = () => {
    logout(undefined, {
      onSuccess: () => {
        toast.success({ title: "Logged out successfully!" });
      },
      onError: (error) => {
        toast.error({ title: error.message });
      },
    });
  };

  return (
    <ProfileSettingsRow
      title="Log out"
      icon="arrow-right-from-bracket"
      busy={isPending}
      onPress={handleLogout}
    />
  );
}
