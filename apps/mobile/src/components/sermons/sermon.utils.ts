import { getIdFromUrl } from "@/utils/getIdFromUrl";

export type SermonNavigationData = {
  title?: string | null;
  youtubeLink?: string | null;
  thumbnail?: string | null;
  speakerFullName?: string | null;
  speakerImage?: string | null;
};

export function getSermonRoute(sermon: SermonNavigationData) {
  return {
    pathname: "/youtube-modal" as const,
    params: {
      kind: "sermon",
      link: getIdFromUrl(sermon.youtubeLink ?? "") ?? "",
      title: sermon.title?.trim() ? sermon.title.trim() : "Sermon",
      speaker: sermon.speakerFullName?.trim() ?? "",
      speakerImage: sermon.speakerImage ?? "",
      image: sermon.thumbnail ?? "",
    },
  };
}
