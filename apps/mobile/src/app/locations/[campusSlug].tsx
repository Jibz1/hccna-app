import { Redirect, useLocalSearchParams } from "expo-router";

export default function CampusLocationRoute() {
  const { campusSlug } = useLocalSearchParams<{
    campusSlug?: string | string[];
  }>();
  const slug = Array.isArray(campusSlug) ? campusSlug[0] : campusSlug;

  return (
    <Redirect
      href={slug ? { pathname: "/campus-modal", params: { slug } } : "/"}
    />
  );
}
