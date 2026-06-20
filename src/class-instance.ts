import type { DanceClass, DanceEvent } from "./domain";

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function createClassInstanceKey(
  fields: Pick<DanceEvent, "studio" | "className" | "teacher" | "classDate" | "classTime">,
) {
  return [
    normalize(fields.studio),
    normalize(fields.className),
    normalize(fields.teacher),
    `${fields.classDate}T${fields.classTime}`,
  ].join("|");
}

export type ProjectionEvent = "booked" | "reminder" | "receipt" | "canceled";

export interface ProjectionState {
  finalStatus: "booked" | "canceled" | "needs_review";
  netCount: 0 | 1;
  evidenceSource:
    | "booking_confirmation"
    | "reminder_inferred_booking"
    | "receipt_inferred_booking"
    | "cancellation_only";
  confidenceScore: number;
  evidence: ProjectionEvent[];
}

export function projectSequence(events: ProjectionEvent[]): ProjectionState {
  const hasBooking = events.includes("booked");
  const hasReminder = events.includes("reminder");
  const hasReceipt = events.includes("receipt");
  const hasCancellation = events.includes("canceled");
  const hasBookedEvidence = hasBooking || hasReminder || hasReceipt;

  if (hasCancellation && !hasBookedEvidence) {
    return {
      finalStatus: "needs_review",
      netCount: 0,
      evidenceSource: "cancellation_only",
      confidenceScore: 0,
      evidence: events,
    };
  }
  if (hasCancellation) {
    return {
      finalStatus: "canceled",
      netCount: 0,
      evidenceSource: hasBooking
        ? "booking_confirmation"
        : hasReminder ? "reminder_inferred_booking" : "receipt_inferred_booking",
      confidenceScore: hasBooking ? 0.95 : hasReminder ? 0.75 : 0.7,
      evidence: events,
    };
  }
  return {
    finalStatus: "booked",
    netCount: 1,
    evidenceSource: hasBooking
      ? "booking_confirmation"
      : hasReminder ? "reminder_inferred_booking" : "receipt_inferred_booking",
    confidenceScore: hasBooking ? 0.95 : hasReminder ? 0.75 : 0.7,
    evidence: events,
  };
}
