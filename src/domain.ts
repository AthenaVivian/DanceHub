export type Platform =
  | "Mindbody"
  | "Momence"
  | "Vagaro"
  | "Punchpass"
  | "WellnessLiving"
  | "Arketa"
  | "Direct"
  | "Generic";

export type EventType =
  | "booked"
  | "reminder"
  | "detail"
  | "receipt"
  | "payment_receipt"
  | "canceled"
  | "waitlisted"
  | "changed"
  | "unknown";
export type ReviewStatus = "pending" | "approved" | "rejected" | "history";
export type ClassStatus = "active" | "canceled" | "waitlisted";
export type EvidenceSource =
  | "booking_confirmation"
  | "reminder_inferred_booking"
  | "receipt_inferred_booking"
  | "waitlist"
  | "changed_event";
export type StyleSource =
  | "explicit_keyword"
  | "studio_mapping"
  | "user_dictionary"
  | "fuzzy_candidate"
  | "song_only_fallback"
  | "unknown"
  | "manual_override";
export type DanceEmailCategory =
  | "dance_booking"
  | "dance_reminder"
  | "dance_cancellation"
  | "dance_receipt";

export interface GmailSourceEmail {
  gmailMessageId: string;
  threadId: string;
  subject: string;
  from: string;
  receivedAt: string;
  body: string;
  snippet: string;
}

export interface DanceEmailEligibility {
  allowed: boolean;
  category: DanceEmailCategory | null;
  confidenceScore: number;
  reason: string;
}

export interface CancellationMatch {
  classId: string;
  score: number;
}

export interface DanceEvent {
  id: string;
  gmailMessageId: string;
  source: "gmail";
  parserId: string;
  parserVersion?: number;
  platform: Platform;
  eventType: EventType;
  emailCategory?: DanceEmailCategory;
  statusEffect: -1 | 0 | 1;
  occurredAt: string;
  classDate: string;
  classTime: string;
  studio: string;
  teacher: string;
  className: string;
  danceStyle: string;
  styleSource: StyleSource;
  styleConfidence: number;
  possibleStyle?: string;
  confidenceScore: number;
  reviewStatus: ReviewStatus;
  rawSubject: string;
  sourceLanguage?: string;
  translatedSubject?: string;
  match: CancellationMatch | null;
  classInstanceKey: string;
  hasClassIdentity: boolean;
  mergesExistingClass?: boolean;
  ignoredReason?: string;
}

export interface DanceClass {
  id: string;
  classInstanceKey: string;
  bookingEventId: string;
  cancellationEventId: string | null;
  supportingEventIds: string[];
  date: string;
  time: string;
  studio: string;
  platform: Platform;
  teacher: string;
  className: string;
  danceStyle: string;
  styleSource: StyleSource;
  status: ClassStatus;
  finalStatus: "booked" | "canceled" | "waitlisted";
  netCount: 0 | 1;
  evidenceSource: EvidenceSource;
  confidenceScore: number;
}

export interface DanceStatistics {
  booked: number;
  canceled: number;
  net: number;
  byStyle: Array<[string, number]>;
  byStudio: Array<[string, number]>;
  byTeacher: Array<[string, number]>;
  byMonth: Array<[string, number]>;
}

export interface ParserPlugin {
  readonly id: string;
  readonly platform: Platform;
  canParse(email: GmailSourceEmail): boolean;
  parse(email: GmailSourceEmail): DanceEvent;
}
