import { useLocalSearchParams } from "expo-router";

import { SermonDetailScreen } from "@/components/sermons/SermonDetailScreen";

type Params = {
  link?: string;
  title?: string;
  body?: string;
  image?: string;
  kind?: string;
  speaker?: string;
  speakerImage?: string;
};

export default function YoutubeModal() {
  const params = useLocalSearchParams<Params>();
  return <SermonDetailScreen key={params.link} {...params} />;
}
