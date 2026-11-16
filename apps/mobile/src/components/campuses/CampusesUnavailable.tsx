import { FeedbackCard } from "@/components/design-v2/FeedbackCard";
import { connectivity } from "@/effect/connectivity";
import SvgWifiOff from "@/icons/WifiOff";
import { useAppTheme } from "@/theme/useAppTheme";

export function CampusesUnavailable({ className }: { className?: string }) {
  const { colors } = useAppTheme();
  return (
    <FeedbackCard
      title="Campus information unavailable offline"
      message="Connect to the internet, then try again."
      icon=<SvgWifiOff width={24} height={24} color={colors.accent} />
      onAction={() => {
        void connectivity.refresh().catch(() => undefined);
      }}
      className={className}
    />
  );
}
