// The original 29-brand list, kept as a small, fixed index for unit tests. The app uses the full Kaggle index
// on the server (lib/drugdb-server.ts).
import data from "@/data/drugs.json";
import { buildIndex, lookupWith, type DrugEntry } from "./drugdb";

export const SEED_INDEX = buildIndex(data.drugs as DrugEntry[]);
export const SEED_LOOKUP = lookupWith(SEED_INDEX);
