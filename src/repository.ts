import type { DanceClass, DanceEvent } from "./domain";

export interface TrackerSettings {
  clientId: string;
  query: string;
  styleDictionary: Record<string, string>;
  historyWindow: "24m";
}

export interface SyncState {
  lastSyncTimestamp: string | null;
  lastProcessedGmailMessageId: string | null;
  syncVersion: number;
  parserVersion: number;
  historyImportCompleted: boolean;
  historyImportedAt: string | null;
  emailsScanned: number;
  danceEventsFound: number;
  duplicatesMerged: number;
}

export interface DanceTrackerRepository {
  hasGmailMessage(messageId: string): Promise<boolean>;
  listEvents(reviewStatus?: "pending" | "approved" | "rejected"): Promise<DanceEvent[]>;
  saveEvent(event: DanceEvent): Promise<void>;
  updateEvent(id: string, patch: Partial<DanceEvent>): Promise<void>;
  listClasses(): Promise<DanceClass[]>;
  upsertClass(record: DanceClass): Promise<void>;
  getSettings(): Promise<TrackerSettings>;
  saveSettings(settings: TrackerSettings): Promise<void>;
}

// LocalStorageRepository is the first adapter. A Supabase repository can implement
// this contract without changing parser, matching, review, or statistics services.
