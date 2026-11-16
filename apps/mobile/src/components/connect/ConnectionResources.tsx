import { Suspense } from "react";
import { View } from "react-native";

import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { MoreRow, MoreSection } from "@/components/more/MoreSection";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";
import {
  useConnectivityAwareFetchPolicy,
  type ConnectivityAwareFetchPolicy,
} from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { useCoreData, useHasCachedCoreData } from "@/hooks/relay/useCoreData";
import type { CoreDataView, CoreLinkView } from "@/relay/coreData";

const defaultLinks: readonly CoreLinkView[] = [
  {
    group: "Get Connected",
    title: "I'm new here",
    subTitle: "Get to know HCC NJ",
    iconName: "handshake",
    link: "https://hccnj.ccbchurch.com/goto/forms/88/responses/new",
  },
  {
    group: "Get Connected",
    title: "Serve",
    subTitle: "Find a place to make a difference",
    iconName: "hand-holding-hand",
    link: "https://hccnj.org/ministries/",
  },
  {
    group: "Get Connected",
    title: "Join a small group",
    subTitle: "Grow in faith, together",
    iconName: "people-group",
    link: "https://hccnj.ccbchurch.com/goto/forms/3/responses/new",
  },
  {
    group: "Get Connected",
    title: "Share your testimony",
    subTitle: "We'd love to celebrate with you",
    iconName: "comment-dots",
    link: "https://hccnj.ccbchurch.com/goto/forms/32/responses/new",
  },
];

function ConnectionResourcesContent({
  coreData,
}: {
  coreData: CoreDataView | null;
}) {
  const links = coreData?.more.links.length
    ? coreData.more.links
    : defaultLinks;
  const groups = new Map<string, CoreLinkView[]>();
  for (const link of links) {
    if (
      !link.title.trim() ||
      !link.link.trim() ||
      link.title.trim().toLowerCase() === "privacy policy"
    ) {
      continue;
    }
    const sourceGroup = link.group.trim();
    const group =
      link.title.trim().toLowerCase() === "share your testimony" ||
      sourceGroup.toLowerCase() === "get connected"
        ? "Get Connected"
        : ["", "other", "resources", "app"].includes(sourceGroup.toLowerCase())
          ? "Resources"
          : sourceGroup;
    const items = groups.get(group) ?? [];
    items.push(link);
    groups.set(group, items);
  }

  return (
    <View className="gap-7">
      {Array.from(groups, ([group, items]) => (
        <MoreSection key={group} title={group}>
          {items.map((item, index) => (
            <MoreRow
              key={`${item.link}-${index}`}
              title={item.title}
              subtitle={item.subTitle}
              icon={item.iconName}
              href={item.link}
              last={index === items.length - 1}
            />
          ))}
        </MoreSection>
      ))}
    </View>
  );
}

function ConnectionResourcesImpl({
  fetchPolicy,
}: {
  fetchPolicy: ConnectivityAwareFetchPolicy;
}) {
  const fetchKey = useRetryKey(fetchPolicy);
  const coreData = useCoreData({ fetchKey, fetchPolicy });
  return <ConnectionResourcesContent coreData={coreData} />;
}

export function ConnectionResources() {
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedCoreData = useHasCachedCoreData();
  if (fetchPolicy === "store-only" && !hasCachedCoreData) {
    return <ConnectionResourcesContent coreData={null} />;
  }

  return (
    <ErrorBoundaryWithRetry
      title="Unable to load resources"
      subtitle="Please try again later"
    >
      <Suspense fallback=<FullLoadingState />>
        <ConnectionResourcesImpl fetchPolicy={fetchPolicy} />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}
