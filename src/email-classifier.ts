import type {
  DanceEmailEligibility,
  GmailSourceEmail,
} from "./domain";

export interface DanceEmailClassifier {
  classify(
    email: GmailSourceEmail,
    userStyleAliases: Record<string, string>,
  ): DanceEmailEligibility;
}

// Classification runs before translation and parsing. Explicit non-dance
// exclusions win over positive style/song/platform signals. Only allowed
// categories may become DanceEvent records or participate in statistics.
