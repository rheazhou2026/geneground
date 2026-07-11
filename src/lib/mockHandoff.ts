import handoffProjectRaw from "@/data/mock-handoff/project.json";
import { HandoffProjectSchema } from "./schemas";

/**
 * Stand-in for a Claude Science project handoff (zip/folder of precomputed
 * artifacts). Real zip ingest and artifact parsing come in a later layer.
 */
export const MOCK_HANDOFF_PROJECT = HandoffProjectSchema.parse(handoffProjectRaw);
