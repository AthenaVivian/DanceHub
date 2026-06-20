export type HistoryWindow = "24m";

export interface SyncQueryInput {
  candidateQuery: string;
  lastSyncTimestamp: string | null;
  historyImportCompleted?: boolean;
  syncVersion?: number;
  parserVersion?: number;
  historyWindow: HistoryWindow;
  mode: "incremental" | "rebuild";
}

export function buildSyncQuery(input: SyncQueryInput): string {
  if (
    input.mode === "incremental" &&
    input.historyImportCompleted &&
    input.lastSyncTimestamp
  ) {
    const unixSeconds = Math.floor(
      new Date(input.lastSyncTimestamp).getTime() / 1000,
    );
    return `${input.candidateQuery} after:${unixSeconds}`;
  }
  return `${input.candidateQuery} newer_than:24m`;
}

// Incremental sync is append/update-only. Existing events and class instances
// are never pruned because they fall outside the current 24-month window. That
// window is used only for initial import and explicit history rebuild.
