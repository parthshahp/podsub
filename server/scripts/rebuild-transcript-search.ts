import { db, transcriptSearch } from "../src/db/index.js";

try {
  transcriptSearch.rebuild();
  console.log("Transcript search rebuilt from saved transcripts.");
} finally {
  db.close();
}
