import { Redirect, useLocalSearchParams } from "expo-router";

export default function EventPageRoute() {
  const { eventSlug } = useLocalSearchParams<{
    eventSlug?: string | string[];
  }>();
  const slug = (Array.isArray(eventSlug) ? eventSlug[0] : eventSlug)?.trim();

  return (
    <Redirect
      href={slug ? { pathname: "/event-modal", params: { slug } } : "/"}
    />
  );
}
