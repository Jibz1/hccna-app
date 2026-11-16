import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { NotFoundScreen } from "@/components/navigation/NotFoundScreen";

export default function NotFoundRoute() {
  const router = useRouter();
  const { incomingLink } = useLocalSearchParams<{ incomingLink?: string }>();

  if (incomingLink) {
    return <Redirect href="/" />;
  }

  return (
    <NotFoundScreen
      onGoBack={() => {
        if (router.canGoBack()) {
          router.back();
          return;
        }
        router.replace("/");
      }}
    />
  );
}
