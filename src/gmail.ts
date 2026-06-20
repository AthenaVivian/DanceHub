import type { GmailSourceEmail } from "./domain";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly" as const;

export interface GmailReadonlyGateway {
  authorize(): Promise<void>;
  searchClassEmails(query: string): Promise<string[]>;
  readMessage(messageId: string): Promise<GmailSourceEmail>;
}

// The concrete browser adapter may only call:
// GET /gmail/v1/users/me/messages
// GET /gmail/v1/users/me/messages/{id}
//
// No mutation methods or additional OAuth scopes belong in this boundary.
