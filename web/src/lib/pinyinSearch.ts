import TraditionalDict from "@pinyin-pro/data/traditional";
import { addTraditionalDict, pinyin } from "pinyin-pro";

import { createPodcastSearch } from "./podcastSearch";

// Apply phrase-aware readings to traditional titles as well as simplified ones.
addTraditionalDict(TraditionalDict);

export const searchPodcasts = createPodcastSearch((title) =>
  pinyin(title, {
    toneType: "none",
    nonZh: "consecutive",
    separator: "",
    traditional: true,
  }),
);
