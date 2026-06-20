"use strict";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const STORAGE_KEY = "tempo-v2";
const PLATFORM_QUERY = '{from:mindbodyonline.com from:momence.com from:vagaro.com from:punchpass.com from:wellnessliving.com from:arketa.co}';
const SUBJECT_QUERY = '{subject:booked subject:confirmed subject:reservation subject:reminder subject:canceled subject:cancelled subject:receipt subject:payment subject:"Hip Hop" subject:"Jazz Funk" subject:"Street Jazz" subject:"K-pop" subject:choreography subject:heels subject:house subject:waacking subject:popping subject:locking subject:litefeet subject:contemporary subject:女团 subject:编舞 subject:韩舞}';
const CANDIDATE_QUERY = `${PLATFORM_QUERY} OR ${SUBJECT_QUERY}`;
const PLATFORM_SEARCH_QUERIES = ["from:mindbodyonline.com", "from:momence.com", "from:vagaro.com", "from:punchpass.com", "from:wellnessliving.com", "from:arketa.co"];
const SUBJECT_SEARCH_QUERIES = ["subject:booked", "subject:confirmed", "subject:reservation", "subject:reminder", "subject:canceled", "subject:cancelled", "subject:receipt", "subject:payment", 'subject:"Hip Hop"', 'subject:"Jazz Funk"', 'subject:"Street Jazz"', 'subject:"K-pop"', "subject:choreography", "subject:heels", "subject:house", "subject:waacking", "subject:popping", "subject:locking", "subject:litefeet", "subject:contemporary", "subject:女团", "subject:编舞", "subject:韩舞"];
const TARGETED_SUBJECT_SEARCH_QUERIES = ['subject:"Hip Hop"', 'subject:"Jazz Funk"', 'subject:"Street Jazz"', 'subject:"K-pop"', "subject:choreography", "subject:heels", "subject:house", "subject:waacking", "subject:popping", "subject:locking", "subject:litefeet", "subject:contemporary", "subject:女团", "subject:编舞", "subject:韩舞"];
const BOOKING_SEARCH_QUERIES = ['subject:"Payment methods to complete your booking"', 'subject:"complete your booking"', "subject:jazz subject:funk", "from:Business5750466@mindbodyonline.com", "from:pjmdancenyc@gmail.com", "from:versd.co", 'subject:"You are confirmed"', 'subject:"Booking Summary"'];
const DEFAULT_QUERY = CANDIDATE_QUERY;
const SYNC_VERSION = 17;
const PARSER_VERSION = 13;
const DAY_MS = 24 * 60 * 60 * 1000;

const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const normalize = (value = "") => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const READ_ONLY_MODE = new URLSearchParams(window.location.search).get("readonly") === "1";

class LocalStorageRepository {
  constructor(key) {
    this.key = key;
    this.data = this.load();
  }
  load() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.key)) || this.empty();
      stored.settings = { ...this.empty().settings, ...(stored.settings || {}) };
      stored.syncState = { ...this.empty().syncState, ...(stored.syncState || {}) };
      const syntheticPattern = /^(demo-|real-format-|style-candidate-|pjm-|pmt-|xspace-|financial-)/i;
      const syntheticEvents = (stored.events || []).filter(event => syntheticPattern.test(event.gmailMessageId || ""));
      const syntheticEventIds = new Set(syntheticEvents.map(event => event.id));
      stored.events = (stored.events || []).filter(event => !syntheticPattern.test(event.gmailMessageId || "")).map(event => {
        if (
          ["receipt", "payment_receipt"].includes(event.eventType) &&
          !event.hasClassIdentity &&
          event.reviewStatus === "pending"
        ) {
          return { ...event, reviewStatus: "history" };
        }
        if (
          event.reviewStatus === "pending" &&
          (
            (event.platform === "Generic" && (!event.classDate || !event.classTime)) ||
            /\b(amazon|fragrancenet|walmart|target|ebay|etsy|shopify)\b/i.test(`${event.studio} ${event.rawSubject}`)
          )
        ) {
          return { ...event, reviewStatus: "history", ignoredReason: "not_dance_email" };
        }
        const style = event.styleConfidence == null
          ? extractStyle(event.className || "", stored.settings.styleDictionary || {}, stored.settings.disabledStyles || [])
          : null;
        const enriched = {
          ...event,
          statusEffect: event.statusEffect ?? (event.eventType === "booked" ? 1 : event.eventType === "canceled" ? -1 : 0),
          styleSource: event.styleSource || style?.source || "unknown",
          styleConfidence: event.styleConfidence ?? style?.confidence ?? 0,
          possibleStyle: event.possibleStyle ?? style?.candidate ?? "",
          hasClassIdentity: event.hasClassIdentity ?? Boolean(event.className && event.classDate && event.classTime),
          classInstanceKey: event.classInstanceKey || classInstanceKey({
            studio: event.studio,
            className: event.className,
            teacher: event.teacher,
            classDate: event.classDate,
            classTime: event.classTime
          })
        };
        return enriched;
      });
      stored.processedMessageIds = (stored.processedMessageIds || []).filter(id => !syntheticPattern.test(id));
      stored.classes = (stored.classes || []).flatMap(record => {
        if (syntheticEventIds.has(record.bookingEventId)) return [];
        const supportingEventIds = (record.supportingEventIds || []).filter(id => !syntheticEventIds.has(id));
        if (syntheticEventIds.has(record.cancellationEventId)) {
          return [normalizeStoredClassRecord({ ...record, cancellationEventId: null, supportingEventIds, status: "active", finalStatus: "booked", netCount: 1 })];
        }
        return [normalizeStoredClassRecord({ ...record, supportingEventIds })];
      });
      if (syntheticEvents.length && stored.events.length === 0) {
        stored.syncState = { ...this.empty().syncState };
      }
      return stored;
    } catch {
      return this.empty();
    }
  }
  empty() {
    return {
      events: [], classes: [], processedMessageIds: [],
      settings: { clientId: "", query: DEFAULT_QUERY, styleDictionary: {}, disabledStyles: [], historyWindow: "24m" },
      syncState: { lastSyncTimestamp: null, lastProcessedGmailMessageId: null, syncVersion: SYNC_VERSION, parserVersion: PARSER_VERSION, historyImportCompleted: false, historyImportedAt: null, emailsScanned: 0, danceEventsFound: 0, duplicatesMerged: 0, lastError: "" }
    };
  }
  save() { localStorage.setItem(this.key, JSON.stringify(this.data)); }
  hasMessage(messageId) { return this.data.processedMessageIds.includes(messageId) || this.data.events.some(e => e.gmailMessageId === messageId); }
  hasCurrentMessage(messageId) {
    const event = this.data.events.find(item => item.gmailMessageId === messageId);
    return Boolean(event && event.parserVersion === PARSER_VERSION);
  }
  removeMessageProjection(messageId) {
    const eventIds = this.data.events.filter(item => item.gmailMessageId === messageId).map(item => item.id);
    this.data.events = this.data.events.filter(item => item.gmailMessageId !== messageId);
    this.data.processedMessageIds = this.data.processedMessageIds.filter(id => id !== messageId);
    this.data.classes = this.data.classes.flatMap(record => {
      if (eventIds.includes(record.bookingEventId)) return [];
      const supportingEventIds = (record.supportingEventIds || []).filter(id => !eventIds.includes(id));
      if (eventIds.includes(record.cancellationEventId)) {
        return [{
          ...record,
          cancellationEventId: null,
          supportingEventIds,
          status: "active",
          finalStatus: "booked",
          netCount: 1
        }];
      }
      return [{ ...record, supportingEventIds }];
    });
    this.save();
  }
  addEvent(event) { if (!this.hasMessage(event.gmailMessageId)) this.data.events.push(event); this.save(); }
  updateEvent(id, patch) { this.data.events = this.data.events.map(e => e.id === id ? { ...e, ...patch } : e); this.save(); }
  addProcessed(messageId) { if (!this.data.processedMessageIds.includes(messageId)) this.data.processedMessageIds.push(messageId); this.save(); }
  getPendingEvents() { return this.data.events.filter(e => e.reviewStatus === "pending"); }
  getClasses() { return this.data.classes; }
  upsertClass(record) {
    const index = this.data.classes.findIndex(c => c.id === record.id);
    if (index >= 0) this.data.classes[index] = record; else this.data.classes.push(record);
    this.save();
  }
  resetImportedData() {
    this.data.events = [];
    this.data.classes = [];
    this.data.processedMessageIds = [];
    this.data.syncState = { ...this.empty().syncState };
    this.save();
  }
}

class GmailReadonlyClient {
  constructor(clientId) { this.clientId = clientId; this.accessToken = null; }
  async authorize() {
    if (!window.google?.accounts?.oauth2) throw new Error("Google sign-in is still loading.");
    return new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: GMAIL_READONLY_SCOPE,
        callback: response => {
          if (response.error) reject(new Error(response.error_description || response.error));
          else { this.accessToken = response.access_token; resolve(); }
        }
      });
      tokenClient.requestAccessToken({ prompt: "consent" });
    });
  }
  async request(path) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
    if (!response.ok) throw new Error((await response.json()).error?.message || "Gmail read failed.");
    return response.json();
  }
  async searchMessages(query) {
    const messages = [];
    let pageToken = "";
    do {
      const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
      const result = await this.request(`messages?q=${encodeURIComponent(query)}&maxResults=500${tokenParam}`);
      messages.push(...(result.messages || []));
      pageToken = result.nextPageToken || "";
    } while (pageToken);
    return messages;
  }
  async readMessage(messageId) { return this.request(`messages/${messageId}?format=full`); }
}

function decodeBase64Url(value = "") {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function mimeBody(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts || []) { const result = mimeBody(part); if (result) return result; }
  if (payload.body?.data) return decodeBase64Url(payload.body.data).replace(/<[^>]+>/g, " ");
  return "";
}
function header(headers, name) { return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ""; }
function sourceEmail(message) {
  return {
    gmailMessageId: message.id,
    threadId: message.threadId || "",
    subject: header(message.payload?.headers, "Subject"),
    from: header(message.payload?.headers, "From"),
    receivedAt: new Date(Number(message.internalDate || Date.now())).toISOString(),
    body: mimeBody(message.payload),
    snippet: message.snippet || ""
  };
}

function first(text, patterns) {
  for (const pattern of patterns) { const match = text.match(pattern); if (match?.[1]) return match[1].trim().replace(/\s{2,}/g, " "); }
  return "";
}
function primaryBookingText(subject = "", body = "") {
  const marker = body.search(/\n\s*(?:VERSD Logo|Booking Summary|Where can you find your tickets\?|Want to start hosting events or classes\?|-{2,}\s*Forwarded message\s*-{2,})/i);
  const primaryBody = marker > 80 ? body.slice(0, marker) : body;
  return `${subject}\n${primaryBody}`;
}
function parseDate(text) {
  const value = first(text, [
    /\bDate\s+((?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4})\s+from\b/i,
    /\bwith\s+[A-Z][A-Za-z .'-]+?\s+at\s+on\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4})\b/i,
    /\breservation for [^\n]+?\bon\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4})\b/i,
    /\bconfirms? your reservation for [^\n]+?\bon\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4})\b/i,
    /\bwith\s+[A-Z][A-Za-z .'-]+?\s+on\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4})\b/i,
    /\bon\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4})\s+at\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i,
    /\bon\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\s+at\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i,
    /(?:date|when)\s*[:\-]\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i,
    /(?:date|when)\s*[:\-]\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4})/i,
    /\b((?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4})\b/,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i,
    /\b(\d{4}-\d{2}-\d{2})\b/
  ]);
  if (!value) return "";
  const date = new Date(value.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+/i, ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
function parseTime(text) {
  const ticketRange = text.match(/\bfrom\s+(\d{1,2})(?::(\d{2}))?\s+to\s+\d{1,2}(?::\d{2})?\s*(AM|PM)\b/i);
  if (ticketRange) {
    let hour = Number(ticketRange[1]); const minutes = ticketRange[2] || "00"; const meridiem = ticketRange[3].toUpperCase();
    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${minutes}`;
  }
  const range = text.match(/(?:time|时间)\s*[:：\-]?\s*(\d{1,2})(?::(\d{2}))?\s*[–—-]\s*\d{1,2}(?::\d{2})?\s*(AM|PM)/i);
  const value = range ? `${range[1]}:${range[2] || "00"} ${range[3]}` : first(text, [/(?:time|at|时间)\s*[:：\-]?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i, /\b(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\b/i]);
  const match = value.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return "";
  let hour = Number(match[1]); const minutes = match[2] || "00"; const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minutes}`;
}
function classify(subject, body) {
  const cancellationSubject = /\b(has been cancelled|has been canceled|booking canceled|booking cancelled|cancellation confirmation)\b/i.test(subject);
  if (cancellationSubject) return "canceled";
  const bookingSubject = /\b(payment methods to complete your booking|complete your booking for|reservation confirmation|class confirmation|reservation for|booking confirmed|you.re booked)\b/i.test(subject);
  const bookingOpening = /\b(thank you for booking|successfully booked|confirms? your reservation|booking is confirmed|reservation complete|you.re all set|you are confirmed|booking summary|complete your booking for)\b/i.test(body.slice(0, 700));
  if (bookingSubject || bookingOpening) return "booked";
  if (/\b(rescheduled|schedule change|booking changed|moved from|changed to)\b/i.test(subject)) return "changed";
  if (/\b(waitlist|wait-listed)\b/i.test(subject)) return "waitlisted";
  if (/\breminder\b/i.test(subject)) return "reminder";
  if (/\b(sales receipt|payment received|transaction receipt|purchase confirmation|order confirmation|paid|payment)\b/i.test(subject)) return "payment_receipt";
  if (/\breceipt\b/i.test(subject)) return "receipt";
  if (/\b(class details|reservation details|what to expect|class information)\b/i.test(subject)) return "detail";
  const opening = body.slice(0, 700);
  if (/\b(sales receipt|payment received|transaction receipt|purchase confirmation|order confirmation|payment complete|paid in full)\b/i.test(opening)) return "payment_receipt";
  if (/\breceipt\b/i.test(opening)) return "receipt";
  if (/\b(confirms? that .* reservation .* (?:cancelled|canceled)|reservation .* has been (?:cancelled|canceled))\b/i.test(opening)) return "canceled";
  if (/\b(waitlist|wait-listed)\b/i.test(opening)) return "waitlisted";
  return "unknown";
}
function normalizedClassName(value = "") {
  return normalize(value
    .replace(/\b(reminder|confirmation|reservation|booking|class details?)\b/gi, " ")
    .replace(/\b(part\s*\d+)\b/gi, "$1")
    .replace(/\s+/g, " "));
}
function classInstanceKey(fields) {
  return [
    normalize(fields.studio),
    normalizedClassName(fields.className),
    normalize(fields.teacher),
    `${fields.classDate || ""}T${fields.classTime || ""}`
  ].join("|");
}
function cleanStudioName(value = "", senderName = "") {
  let cleaned = value
    .replace(/^(?:re:\s*)?/i, "")
    .replace(/^\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s+at\s+/i, "")
    .replace(/\s+THIS IS A NON-REFUNDABLE PURCHASE.*$/i, "")
    .replace(/\s+Reservation for .+$/i, "")
    .replace(/\s+Has Been (?:Cancelled|Canceled).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (/^\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i.test(cleaned)) cleaned = "";
  if (/^(this confirms your reservation|dear |thank you\b|web:|phone:)/i.test(cleaned)) cleaned = "";
  return cleaned || senderName || "Unknown studio";
}
function normalizeStoredClassRecord(record) {
  const wasCanceled = record.status === "canceled" || record.finalStatus === "canceled" || Boolean(record.cancellationEventId);
  const cleaned = {
    ...record,
    studio: cleanStudioName(record.studio || "", record.studio || ""),
    supportingEventIds: record.supportingEventIds || []
  };
  if (wasCanceled) {
    return { ...cleaned, status: "canceled", finalStatus: "canceled", netCount: 0 };
  }
  if (cleaned.status === "active" && cleaned.finalStatus === "booked") {
    return { ...cleaned, netCount: 1 };
  }
  return cleaned;
}
function buildSyncQueries(mode, syncState) {
  const canIncrement = mode === "incremental"
    && syncState.historyImportCompleted
    && syncState.lastSyncTimestamp;
  if (canIncrement) {
    const overlapStart = new Date(new Date(syncState.lastSyncTimestamp).getTime() - 5 * 60 * 1000);
    const window = `after:${Math.floor(overlapStart.getTime() / 1000)}`;
    return [...PLATFORM_SEARCH_QUERIES, ...TARGETED_SUBJECT_SEARCH_QUERIES, ...BOOKING_SEARCH_QUERIES].map(query => `${query} ${window}`);
  }
  return [...PLATFORM_SEARCH_QUERIES, ...TARGETED_SUBJECT_SEARCH_QUERIES, ...BOOKING_SEARCH_QUERIES].map(query => `${query} newer_than:24m`);
}
function hasCompleteClassIdentity(event) {
  return Boolean(
    event.hasClassIdentity &&
    event.studio && event.studio !== "Unknown studio" &&
    event.className && event.classDate && event.classTime
  );
}
const KNOWN_STYLES = [
  ["Street Jazz", /\bstreet jazz\b/i], ["Jazz Funk", /\bjazz funk\b/i],
  ["Hip Hop", /\bhip[\s-]?hop\b/i], ["K-Pop", /\bk[\s-]?pop\b/i],
  ["Waacking", /\bwaacking\b/i], ["Popping", /\bpopping\b/i],
  ["Locking", /\blocking\b/i], ["Contemporary", /\bcontemporary\b/i],
  ["Choreography", /\bchoreography\b/i], ["Open Style", /\bopen style\b/i],
  ["Heels", /\bheels\b/i], ["House", /\bhouse\b/i], ["Ballet", /\bballet\b/i],
  ["Reggaeton", /\breggaeton\b/i],
  ["Litefeet", /\blitefeet\b/i], ["Girl Group", /\bgirl group\b|女团/i],
  ["Choreography", /\bchoreography\b|编舞/i], ["K-Pop", /\bk[\s-]?pop\b|韩舞/i],
  ["Jazz", /\bjazz\b/i], ["Salsa", /\bsalsa\b/i], ["Tap", /\btap\b/i], ["Pole", /\bpole\b/i]
];
const STUDIO_STYLE_MAPPINGS = [["K-Pop Girl Group", /中阶女团|初阶女团|高阶女团|女团/]];
function extractStyle(value, userDictionary = {}, disabledStyles = []) {
  const disabled = new Set((disabledStyles || []).map(name => name.toLowerCase()));
  const userMatch = Object.entries(userDictionary).find(([alias]) => {
    const safeAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${safeAlias}\\b`, "i").test(value);
  });
  if (userMatch) return { value: userMatch[1], source: "user_dictionary", confidence: .98, candidate: "" };
  const known = KNOWN_STYLES.find(([name, pattern]) => !disabled.has(name.toLowerCase()) && pattern.test(value));
  if (known) return { value: known[0], source: "explicit_keyword", confidence: .95, candidate: "" };
  const mapped = STUDIO_STYLE_MAPPINGS.find(([, pattern]) => pattern.test(value));
  if (mapped) return { value: mapped[0], source: "studio_mapping", confidence: .95, candidate: "" };
  const fuzzy = first(value, [
    /(?:beginner|intermediate|advanced|intro|beg|int|adv)\s+([A-Z][A-Za-z-]+)(?=\s+(?:with|class|workshop|level|dance)\b|$)/i,
    /(?:class|style|workshop|level|dance)\s*[:\-]\s*([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)?)/i
  ]);
  if (fuzzy && !/^(beginner|intermediate|advanced|class|dance|priority|reminder|confirmation|reservation|booking|payment|receipt|sale|offer|code|discount)$/i.test(fuzzy)) {
    return { value: "Other", source: "fuzzy_candidate", confidence: .55, candidate: fuzzy };
  }
  const songArtist = /(?:^|:\s*)([^|\n]{2,80})\s*\|\s*([^|\n()]{2,60})(?:\s*\([^)]*\))?/m;
  const artistSong = /\b([A-Z][A-Za-z0-9 .'&-]{2,40})\s+-\s+["“]?([A-Z][A-Za-z0-9 .'&-]{2,60})/;
  if (songArtist.test(value) || artistSong.test(value)) {
    return { value: "K-Pop", source: "song_only_fallback", confidence: .7, candidate: "" };
  }
  return { value: "Other", source: "unknown", confidence: .3, candidate: "" };
}
const EXCLUDED_EMAIL_PATTERNS = [
  ["pilates", /\bpilates\b/i], ["yoga", /\byoga\b/i], ["barre", /\bbarre\b/i],
  ["lagree", /\blagree\b|megaformer/i], ["general_fitness", /\b(bootcamp|crossfit|strength training|personal training|gym membership)\b/i],
  ["hotel", /\b(hotel|check-in|room reservation|lodging)\b/i], ["flight", /\b(flight|boarding pass|airline|airport)\b/i],
  ["restaurant", /\b(restaurant|dinner reservation|table for|opentable|resy)\b/i],
  ["shopping", /\b(order shipped|tracking number|your package|shopping receipt|retail order)\b/i],
  ["promotion", /\b(sale ends|promo code|discount code|newsletter|special offer|limited time offer|up to \d+% off|coupon|fragrance|clearance)\b/i],
  ["financial", /\b(trade confirmation|security|prospectus|brokerage|credit union share certificate|account ending)\b/i]
];
const EXCLUDED_SENDER_PATTERNS = [
  /\bamazon(?:\.com)?\b/i, /\bfragrancenet\b/i, /\bwalmart\b/i,
  /\btarget\b/i, /\bebay\b/i, /\betsy\b/i, /\bshopify\b/i
];
function classifyDanceEmail(email, userDictionary = {}) {
  const text = `${email.subject}\n${email.body}`;
  if (EXCLUDED_SENDER_PATTERNS.some(pattern => pattern.test(email.from))) {
    return { allowed: false, category: null, confidenceScore: .99, reason: "commerce_sender" };
  }
  const hasUserStyle = Object.keys(userDictionary).some(alias => text.toLowerCase().includes(alias.toLowerCase()));
  const disabledStyles = new Set(((typeof repo !== "undefined" ? repo.data?.settings?.disabledStyles : []) || []).map(name => name.toLowerCase()));
  const hasExplicitStyle = KNOWN_STYLES.some(([name, pattern]) => !disabledStyles.has(name.toLowerCase()) && pattern.test(text)) || STUDIO_STYLE_MAPPINGS.some(([, pattern]) => pattern.test(text));
  const subject = email.subject.replace(/^(re:|fwd:)\s*/i, "");
  const hasSongPattern = /[^|\n]{2,80}\s*\|\s*[^|\n]{2,60}/.test(subject)
    || /^[A-Z][A-Za-z0-9 .'&]{2,40}\s+-\s+["“]?[A-Z][A-Za-z0-9 .'&]{2,60}(?:["”])?$/.test(subject);
  const danceSender = /\b(dance|dancing|choreography|mindbody|momence|vagaro|punchpass|wellnessliving|arketa)\b/i.test(email.from);
  const strongBookingSignal = danceSender && /\b(payment methods to complete your booking|complete your booking for|reservation for|confirms? your reservation|thank you for booking|you are confirmed|booking summary)\b/i.test(`${email.subject}\n${email.body.slice(0, 900)}`);
  const hasSchedule = Boolean(parseDate(text) && parseTime(text));
  const danceSignal = danceSender || ((hasExplicitStyle || hasUserStyle || hasSongPattern) && hasSchedule);
  const exclusion = EXCLUDED_EMAIL_PATTERNS.find(([, pattern]) => pattern.test(text));
  if (exclusion && !strongBookingSignal && !(danceSignal && hasExplicitStyle && hasSchedule)) {
    return { allowed: false, category: null, confidenceScore: .98, reason: exclusion[0] };
  }
  if (!danceSignal) return { allowed: false, category: null, confidenceScore: .8, reason: "no_dance_signal" };
  const eventType = classify(email.subject, email.body);
  const category = eventType === "canceled" ? "dance_cancellation"
    : eventType === "reminder" ? "dance_reminder"
    : ["receipt", "payment_receipt"].includes(eventType) ? "dance_receipt"
    : ["booked", "detail", "changed", "waitlisted"].includes(eventType) ? "dance_booking"
    : null;
  if (!category) return { allowed: false, category: null, confidenceScore: .55, reason: "unknown_email_type" };
  return { allowed: true, category, confidenceScore: hasExplicitStyle || hasUserStyle ? .95 : .75, reason: hasUserStyle ? "user_style_alias" : hasExplicitStyle ? "explicit_style" : hasSongPattern ? "song_pattern" : "dance_sender" };
}

class TemplateParser {
  constructor(id, platform, senderPattern) { this.id = id; this.platform = platform; this.senderPattern = senderPattern; }
  canParse(email) { return this.senderPattern.test(`${email.from} ${email.subject}`); }
  parse(email) {
    const text = primaryBookingText(email.subject, email.body);
    const eventType = classify(email.subject, email.body);
    const extractedClassName = first(text, [
      /reminder for your reservation for (.+?) with [A-Z]/i,
      /^Reminder(?:\s*[:\-])?\s+(?:for\s+)?(.+?)\s+with\s+[A-Z]/i,
      /^Reminder(?:\s*[:\-])?\s+(?:for\s+)?(.+?)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)|\n|$)/i,
      /payment methods to complete your booking for (.+?) on \d/i,
      /complete your booking for (.+?) with [A-Z]/i,
      /\bListing\s+([^\n]+)/i,
      /reservation for (.+?) on \d/i,
      /confirms? that (.+?) reservation on \d/i,
      /successfully booked (.+?)\.\s*(?:\n|$)/i,
      /(?:class|session|reservation)\s*[:\-]\s*([^\n]+)/i,
      /(?:booked|confirmed|canceled|cancelled|waitlisted)\s*[:\-]\s*([^\n]+)/i
    ]);
    const className = extractedClassName || email.subject;
    const senderName = email.from.split("<")[0].replace(/["']/g, "").trim();
    const studioFromSubject = first(email.subject, [
      /^(.+?) Reservation for .+? on \d/im,
      /\bat\s+(.+?)\s+Has Been (?:Cancelled|Canceled)/i
    ]);
    const studioFromBody = first(text, [
      /Organizer\s+([^\n|]+)/i,
      /(?:studio|venue)\s*[:\-]\s*([^\n|]+)/i,
      /(?:^|\n|\.)\s*at\s+([A-Z][A-Za-z0-9 '&.-]+(?:Studio|Dance|Loft|Room|House|Collective|Center))/i
    ]);
    const senderIsPlatform = /^(Mindbody|Momence|Vagaro|Punchpass|WellnessLiving)$/i.test(senderName);
    const studio = cleanStudioName(studioFromSubject || studioFromBody || (!senderIsPlatform ? senderName : ""), !senderIsPlatform ? senderName : "");
    const teacher = (first(text, [
      /^Reminder(?:\s*[:\-])?\s+(?:for\s+)?.+?\s+with\s+([A-Z][A-Za-z .'-]+?)(?:\s+[([]|$)/i,
      /reservation for .+? with ([A-Z][A-Za-z .'-]+?)(?:\s+with\s+\1)?\s+at\b/i,
      /(?:teacher|instructor)\s*[:\-]\s*([^\n|]+)/i,
      /\bwith\s+([A-Z][A-Za-z .'-]+?)(?=\s+(?:at|on)\b|$)/i,
      /\n([A-Z][A-Za-z .'-]{2,40})\n\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i
    ]) || first(className, [/-\s*([A-Z][A-Za-z .'-]+)$/])).replace(/\s+\.$/, "").trim();
    const date = parseDate(text); const time = parseTime(text);
    const styleDictionary = repo?.data?.settings?.styleDictionary || {};
    const disabledStyles = repo?.data?.settings?.disabledStyles || [];
    let style = extractStyle(className, styleDictionary, disabledStyles);
    if (style.source === "unknown") style = extractStyle(text, styleDictionary, disabledStyles);
    const found = [className, studio, date, time].filter(Boolean).length;
    return {
      id: uid(), gmailMessageId: email.gmailMessageId, source: "gmail", parserId: this.id, platform: this.platform,
      parserVersion: PARSER_VERSION,
      eventType, statusEffect: eventType === "booked" ? 1 : eventType === "canceled" ? -1 : 0,
      occurredAt: email.receivedAt, classDate: date, classTime: time, studio: studio || "Unknown studio",
      teacher, className, danceStyle: style.value, styleSource: style.source, styleConfidence: style.confidence,
      possibleStyle: style.candidate, confidenceScore: Math.min(.98, .44 + found * .1 + (eventType !== "unknown" ? .1 : 0)),
      reviewStatus: "pending", rawSubject: email.subject, match: null,
      classInstanceKey: classInstanceKey({ studio, className, teacher, classDate: date, classTime: time }),
      hasClassIdentity: Boolean(extractedClassName && date && time)
    };
  }
}
class GenericAiParser extends TemplateParser {
  constructor() { super("generic-ai", "Generic", /[\s\S]*/); }
}
class ChineseEmailTranslator {
  translate(email) {
    const text = `${email.subject}\n${email.body}`;
    const senderName = email.from.split("<")[0].replace(/["']/g, "").trim();
    const monthDay = text.match(/(\d{1,2})月(\d{1,2})日/);
    const subjectDate = email.subject.match(/([A-Z][a-z]{2}),?\s*(\d{1,2})(?:st|nd|rd|th)?,?.*?(\d{4})/);
    const receivedYear = new Date(email.receivedAt).getFullYear();
    const year = Number(subjectDate?.[3] || receivedYear);
    const date = monthDay
      ? `${year}-${String(monthDay[1]).padStart(2, "0")}-${String(monthDay[2]).padStart(2, "0")}`
      : parseDate(text);
    const originalClassName = first(text, [
      /感谢报名我们的([^！!\n]+)/,
      /【课程确认】\s*([^-–—\n]+)/
    ]) || email.subject;
    const teacher = first(text, [/教师\s*[:：]\s*([^\n]+)/]);
    const studio = first(text, [/地点\s*[:：]\s*([^\n]+)/]) || senderName || "Unknown studio";
    const rawTimeText = first(text, [/时间\s*[:：]\s*([^\n]+)/]).replace(/[（(][^）)]*[）)]/g, "").trim();
    const timeRange = rawTimeText.match(/(\d{1,2}(?::\d{2})?)\s*[–—-]\s*(\d{1,2}(?::\d{2})?)\s*(AM|PM)/i);
    const timeText = timeRange ? `${timeRange[1]} ${timeRange[3]} - ${timeRange[2]} ${timeRange[3]}` : rawTimeText;
    const song = first(text, [/曲目\s*[:：]\s*([^\n]+)/]);
    const className = originalClassName
      .replace(/中阶女团/g, "Intermediate K-Pop Girl Group")
      .replace(/初阶女团/g, "Beginner K-Pop Girl Group")
      .replace(/高阶女团/g, "Advanced K-Pop Girl Group")
      .replace(/女团/g, "K-Pop Girl Group");
    const canceled = /取消|已取消/.test(`${email.subject} ${email.body.slice(0, 500)}`);
    return {
      ...email,
      subject: `${canceled ? "Cancellation" : "Class confirmation"}: ${className}`,
      body: [
        canceled ? "Class canceled." : "Booking confirmed.",
        `Class: ${className}`,
        `Date: ${date}`,
        `Time: ${timeText}`,
        `Teacher: ${teacher}`,
        `Studio: ${studio}`,
        song ? `Song: ${song}` : ""
      ].filter(Boolean).join("\n"),
      translation: {
        sourceLanguage: "zh",
        originalSubject: email.subject
      }
    };
  }
}
class ChineseTranslatedParser extends TemplateParser {
  constructor(translator) {
    super("chinese-translated-v1", "Direct", /[\u3400-\u9fff]/);
    this.translator = translator;
  }
  parse(email) {
    const translated = this.translator.translate(email);
    const event = super.parse(translated);
    return {
      ...event,
      parserId: this.id,
      platform: this.platform,
      rawSubject: email.subject,
      sourceLanguage: "zh",
      translatedSubject: translated.subject
    };
  }
}
class ParserRegistry {
  constructor(parsers) { this.parsers = parsers; }
  parse(email) {
    const parser = this.parsers.find(candidate => candidate.canParse(email)) || this.parsers[this.parsers.length - 1];
    return parser.parse(email);
  }
}
const parserRegistry = new ParserRegistry([
  new TemplateParser("mindbody-v1", "Mindbody", /mindbody/i),
  new TemplateParser("momence-v1", "Momence", /momence/i),
  new TemplateParser("vagaro-v1", "Vagaro", /vagaro/i),
  new TemplateParser("punchpass-v1", "Punchpass", /punchpass/i),
  new TemplateParser("wellnessliving-v1", "WellnessLiving", /wellnessliving/i),
  new TemplateParser("arketa-v1", "Arketa", /arketa/i),
  new TemplateParser("versd-v1", "VERSD", /versd/i),
  new ChineseTranslatedParser(new ChineseEmailTranslator()),
  new GenericAiParser()
]);

class CancellationMatcher {
  match(cancellation, classes) {
    const keyed = classes.find(record =>
      record.status === "active" &&
      (record.bookingEventId || ["reminder_inferred_booking", "receipt_inferred_booking"].includes(record.evidenceSource)) &&
      record.classInstanceKey === cancellation.classInstanceKey
    );
    if (keyed) return { classId: keyed.id, score: 1 };
    const exactSchedule = classes.find(record =>
      record.status === "active" &&
      (record.bookingEventId || ["reminder_inferred_booking", "receipt_inferred_booking"].includes(record.evidenceSource)) &&
      normalize(record.className) === normalize(cancellation.className) &&
      record.date === cancellation.classDate &&
      record.time === cancellation.classTime
    );
    if (exactSchedule) return { classId: exactSchedule.id, score: .95 };
    const candidates = classes.filter(c =>
      c.status === "active" &&
      (c.bookingEventId || ["reminder_inferred_booking", "receipt_inferred_booking"].includes(c.evidenceSource)) &&
      normalize(c.studio) === normalize(cancellation.studio)
    );
    const ranked = candidates.map(record => {
      let score = .35;
      if (normalize(record.className) === normalize(cancellation.className)) score += .3;
      if (record.date === cancellation.classDate) score += .25;
      if (record.time === cancellation.classTime) score += .1;
      return { classId: record.id, score };
    }).sort((a, b) => b.score - a.score);
    return ranked[0]?.score >= .65 ? ranked[0] : null;
  }
}

class EventProcessor {
  constructor(repository, matcher) { this.repository = repository; this.matcher = matcher; }
  ingest(email) {
    if (this.repository.hasMessage(email.gmailMessageId)) return "duplicate";
    const eligibility = classifyDanceEmail(email, this.repository.data.settings.styleDictionary || {});
    if (!eligibility.allowed) {
      const text = `${email.subject}\n${email.body}`;
      const senderName = email.from.split("<")[0].replace(/["']/g, "").trim() || "Unknown sender";
      this.repository.addEvent({
        id: uid(), gmailMessageId: email.gmailMessageId, source: "gmail", parserId: "classifier",
        platform: "Ignored", parserVersion: PARSER_VERSION, eventType: "ignored", statusEffect: 0,
        occurredAt: email.receivedAt, classDate: parseDate(text), classTime: parseTime(text),
        studio: senderName, teacher: "", className: email.subject, danceStyle: "Ignored",
        styleSource: "ignored", styleConfidence: 0, possibleStyle: "", confidenceScore: eligibility.confidenceScore,
        reviewStatus: "history", rawSubject: email.subject, emailCategory: "ignored",
        ignoredReason: eligibility.reason, match: null, classInstanceKey: "", hasClassIdentity: false
      });
      this.repository.addProcessed(email.gmailMessageId);
      return "ignored";
    }
    const event = parserRegistry.parse(email);
    event.emailCategory = eligibility.category;
    event.mergesExistingClass = this.repository.getClasses().some(item => item.classInstanceKey === event.classInstanceKey)
      || this.repository.data.events.some(item => item.classInstanceKey === event.classInstanceKey);
    if (["receipt", "payment_receipt"].includes(event.eventType) && !event.hasClassIdentity) {
      event.reviewStatus = "history";
      this.repository.addEvent(event);
      this.repository.addProcessed(event.gmailMessageId);
      return "history";
    }
    if (event.eventType === "canceled") event.match = this.matcher.match(event, this.repository.getClasses());
    this.repository.addEvent(event);
    if (isAutoApprovable(event, this.repository.getClasses())) {
      this.approve(event.id);
    }
    return "added";
  }
  approve(eventId) {
    const event = this.repository.data.events.find(item => item.id === eventId);
    if (!event) return { ok: false, reason: "Event not found." };
    const existing = this.repository.getClasses().find(item => item.classInstanceKey === event.classInstanceKey);
    if (event.eventType === "booked") {
      if (existing) {
        this.repository.upsertClass({
          ...existing,
          bookingEventId: existing.bookingEventId || event.id,
          supportingEventIds: [...new Set([...(existing.supportingEventIds || []), event.id])],
          evidenceSource: "booking_confirmation",
          confidenceScore: Math.max(existing.confidenceScore || 0, event.confidenceScore),
          finalStatus: existing.status === "canceled" ? "canceled" : "booked",
          netCount: existing.status === "canceled" ? 0 : 1
        });
      } else {
        this.repository.upsertClass({
          id: uid(), classInstanceKey: event.classInstanceKey, bookingEventId: event.id,
          cancellationEventId: null, supportingEventIds: [], date: event.classDate, time: event.classTime,
          studio: event.studio, platform: event.platform, teacher: event.teacher, className: event.className,
          danceStyle: event.danceStyle, styleSource: event.styleSource, status: "active",
          finalStatus: "booked", netCount: 1, evidenceSource: "booking_confirmation",
          confidenceScore: event.confidenceScore
        });
      }
    } else if (event.eventType === "reminder") {
      if (existing) {
        this.repository.upsertClass({
          ...existing,
          supportingEventIds: [...new Set([...(existing.supportingEventIds || []), event.id])]
        });
      } else {
        this.repository.upsertClass({
          id: uid(), classInstanceKey: event.classInstanceKey, bookingEventId: "",
          cancellationEventId: null, supportingEventIds: [event.id], date: event.classDate, time: event.classTime,
          studio: event.studio, platform: event.platform, teacher: event.teacher, className: event.className,
          danceStyle: event.danceStyle, styleSource: event.styleSource, status: "active",
          finalStatus: "booked", netCount: 1, evidenceSource: "reminder_inferred_booking",
          confidenceScore: Math.min(.75, event.confidenceScore)
        });
      }
    } else if (event.eventType === "detail") {
      if (existing) {
        this.repository.upsertClass({
          ...existing,
          supportingEventIds: [...new Set([...(existing.supportingEventIds || []), event.id])]
        });
      }
    } else if (event.eventType === "receipt" || event.eventType === "payment_receipt") {
      if (existing) {
        this.repository.upsertClass({
          ...existing,
          supportingEventIds: [...new Set([...(existing.supportingEventIds || []), event.id])]
        });
      } else {
        if (hasCompleteClassIdentity(event)) {
          this.repository.upsertClass({
            id: uid(), classInstanceKey: event.classInstanceKey, bookingEventId: "",
            cancellationEventId: null, supportingEventIds: [event.id], date: event.classDate, time: event.classTime,
            studio: event.studio, platform: event.platform, teacher: event.teacher, className: event.className,
            danceStyle: event.danceStyle, styleSource: event.styleSource, status: "active",
            finalStatus: "booked", netCount: 1, evidenceSource: "receipt_inferred_booking",
            confidenceScore: Math.min(.7, event.confidenceScore)
          });
        }
      }
    } else if (event.eventType === "canceled") {
      const match = event.match || this.matcher.match(event, this.repository.getClasses());
      if (!match) return { ok: false, reason: "This cancellation has no matching booked class yet." };
      const record = this.repository.getClasses().find(item => item.id === match.classId);
      if (record) this.repository.upsertClass({
        ...record, status: "canceled", finalStatus: "canceled", netCount: 0,
        cancellationEventId: event.id,
        supportingEventIds: [...new Set([...(record.supportingEventIds || []), event.id])]
      });
    } else if (event.eventType === "waitlisted") {
      this.repository.upsertClass({
        id: uid(), classInstanceKey: event.classInstanceKey, bookingEventId: event.id, cancellationEventId: null,
        supportingEventIds: [], date: event.classDate, time: event.classTime,
        studio: event.studio, platform: event.platform, teacher: event.teacher, className: event.className,
        danceStyle: event.danceStyle, styleSource: event.styleSource, status: "waitlisted",
        finalStatus: "waitlisted", netCount: 0, evidenceSource: "waitlist",
        confidenceScore: event.confidenceScore
      });
    } else if (event.eventType === "changed") {
      this.repository.upsertClass({
        id: uid(), classInstanceKey: event.classInstanceKey, bookingEventId: event.id, cancellationEventId: null,
        supportingEventIds: [], date: event.classDate, time: event.classTime,
        studio: event.studio, platform: event.platform, teacher: event.teacher, className: event.className,
        danceStyle: event.danceStyle, styleSource: event.styleSource, status: "active",
        finalStatus: "booked", netCount: 1, evidenceSource: "changed_event",
        confidenceScore: event.confidenceScore
      });
    }
    this.repository.updateEvent(event.id, { reviewStatus: "approved" });
    this.repository.addProcessed(event.gmailMessageId);
    return { ok: true };
  }
  reject(eventId) {
    const event = this.repository.data.events.find(item => item.id === eventId);
    if (!event) return;
    this.repository.updateEvent(event.id, { reviewStatus: "rejected" });
    this.repository.addProcessed(event.gmailMessageId);
  }
}

class StatisticsService {
  build(classes) {
    const booked = classes.filter(c => c.finalStatus === "booked" || c.finalStatus === "canceled").length;
    const canceled = classes.filter(c => c.status === "canceled").length;
    const active = classes.filter(c => c.netCount === 1 && c.status === "active" && c.finalStatus === "booked" && !c.cancellationEventId);
    return { booked, canceled, net: active.length, byStyle: this.group(active, "danceStyle"), byTeacher: this.group(active.filter(c => c.teacher), "teacher"), byStudio: this.group(active, "studio"), byMonth: this.group(active, c => c.date?.slice(0, 7) || "Unknown") };
  }
  group(records, field) {
    const getter = typeof field === "function" ? field : record => record[field] || "Other";
    return Object.entries(records.reduce((acc, record) => { const key = getter(record); acc[key] = (acc[key] || 0) + 1; return acc; }, {})).sort((a,b) => b[1]-a[1]);
  }
}

const repo = new LocalStorageRepository(STORAGE_KEY);
repo.save();
const processor = new EventProcessor(repo, new CancellationMatcher());
const statistics = new StatisticsService();
let reviewFilter = "all";
let classSearch = "";
let historySearch = "";
let editingClassId = "";

function createManualClass(fields) {
  const date = fields.date;
  const time = fields.time;
  const studio = cleanStudioName(fields.studio, fields.studio);
  const teacher = fields.teacher.trim();
  const className = fields.className.trim();
  const danceStyle = fields.danceStyle.trim();
  const eventType = fields.status === "canceled" ? "canceled" : "booked";
  const status = eventType === "canceled" ? "canceled" : "active";
  const finalStatus = eventType === "canceled" ? "canceled" : "booked";
  const netCount = eventType === "canceled" ? 0 : 1;
  const key = classInstanceKey({ studio, className, teacher, classDate: date, classTime: time });
  const eventId = uid();
  const messageId = `manual-${eventId}`;
  const event = {
    id: eventId, gmailMessageId: messageId, source: "manual", parserId: "manual-entry",
    platform: "Manual", parserVersion: PARSER_VERSION, eventType, statusEffect: netCount,
    occurredAt: new Date().toISOString(), classDate: date, classTime: time, studio, teacher,
    className, danceStyle, styleSource: "manual_entry", styleConfidence: 1, possibleStyle: "",
    confidenceScore: 1, reviewStatus: "approved", rawSubject: `Manual entry: ${className}`,
    emailCategory: "manual_entry", ignoredReason: "", match: null, classInstanceKey: key,
    hasClassIdentity: true
  };
  repo.data.events.push(event);
  repo.addProcessed(messageId);
  const existing = repo.getClasses().find(record => record.classInstanceKey === key);
  if (existing) {
    repo.upsertClass({
      ...existing,
      bookingEventId: existing.bookingEventId || eventId,
      supportingEventIds: [...new Set([...(existing.supportingEventIds || []), eventId])],
      studio, teacher, className, danceStyle, styleSource: "manual_entry",
      platform: existing.platform === "Manual" ? "Manual" : existing.platform,
      status, finalStatus, netCount,
      evidenceSource: "manual_entry",
      confidenceScore: 1
    });
  } else {
    repo.upsertClass({
      id: uid(), classInstanceKey: key, bookingEventId: eventId, cancellationEventId: eventType === "canceled" ? eventId : null,
      supportingEventIds: [], date, time, studio, platform: "Manual", teacher, className,
      danceStyle, styleSource: "manual_entry", status, finalStatus, netCount,
      evidenceSource: "manual_entry", confidenceScore: 1
    });
  }
  repo.save();
}
function updateClassRecord(classId, fields) {
  const record = repo.getClasses().find(item => item.id === classId);
  if (!record) return false;
  const date = fields.date;
  const time = fields.time;
  const studio = cleanStudioName(fields.studio, fields.studio);
  const teacher = fields.teacher.trim();
  const className = fields.className.trim();
  const danceStyle = fields.danceStyle.trim();
  const status = fields.status === "canceled" ? "canceled" : "active";
  const finalStatus = fields.status === "canceled" ? "canceled" : "booked";
  const netCount = fields.status === "canceled" ? 0 : 1;
  const key = classInstanceKey({ studio, className, teacher, classDate: date, classTime: time });
  const patch = {
    date, time, studio, teacher, className, danceStyle,
    styleSource: "manual_override", status, finalStatus, netCount,
    classInstanceKey: key, evidenceSource: record.evidenceSource === "manual_entry" ? "manual_entry" : "manual_override",
    confidenceScore: 1
  };
  repo.upsertClass({ ...record, ...patch });
  const relatedIds = new Set([record.bookingEventId, record.cancellationEventId, ...(record.supportingEventIds || [])].filter(Boolean));
  repo.data.events = repo.data.events.map(event => relatedIds.has(event.id) ? {
    ...event,
    classDate: date, classTime: time, studio, teacher, className, danceStyle,
    styleSource: "manual_override", styleConfidence: 1, confidenceScore: Math.max(event.confidenceScore || 0, 1),
    classInstanceKey: key, hasClassIdentity: true
  } : event);
  repo.save();
  return true;
}
function styleAliasMatches(value = "", alias = "") {
  const normalizedValue = normalize(value);
  const normalizedAlias = normalize(alias);
  return Boolean(normalizedAlias && normalizedValue.includes(normalizedAlias));
}
function applyStyleVocabulary(alias, styleName) {
  const canonical = styleName.trim();
  const lookup = alias.trim() || canonical;
  if (!canonical || !lookup) return 0;
  repo.data.settings.styleDictionary[lookup] = canonical;
  repo.data.settings.disabledStyles = (repo.data.settings.disabledStyles || []).filter(name => name.toLowerCase() !== canonical.toLowerCase());
  let updated = 0;
  repo.data.classes = repo.data.classes.map(record => {
    if (
      record.netCount === 1 &&
      (record.danceStyle === "Other" || record.styleSource === "unknown" || record.styleSource === "fuzzy_candidate") &&
      styleAliasMatches(`${record.className} ${record.danceStyle}`, lookup)
    ) {
      updated++;
      return { ...record, danceStyle: canonical, styleSource: "user_dictionary", confidenceScore: Math.max(record.confidenceScore || 0, .98) };
    }
    return record;
  });
  repo.data.events = repo.data.events.map(event => {
    if (
      (event.danceStyle === "Other" || event.styleSource === "unknown" || event.styleSource === "fuzzy_candidate") &&
      styleAliasMatches(`${event.className} ${event.rawSubject || ""}`, lookup)
    ) {
      return { ...event, danceStyle: canonical, styleSource: "user_dictionary", styleConfidence: .98, possibleStyle: "" };
    }
    return event;
  });
  repo.save();
  return updated;
}
function refreshStyleVocabulary() {
  return Object.entries(repo.data.settings.styleDictionary || {}).reduce((sum, [alias, style]) => sum + applyStyleVocabulary(alias, style), 0);
}
function styleVocabularyAliases(value) {
  return value
    .split(/\s*(?:,|\/|\bor\b)\s*/i)
    .map(item => item.trim())
    .filter(Boolean);
}
function builtInStyleNames() {
  const disabled = new Set((repo.data.settings.disabledStyles || []).map(name => name.toLowerCase()));
  return [...new Set(KNOWN_STYLES.map(([name]) => name))]
    .filter(name => !disabled.has(name.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}
function renderStyleVocabulary() {
  const dictionary = repo.data.settings.styleDictionary || {};
  const customRows = Object.entries(dictionary).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const builtIns = builtInStyleNames();
  const customNames = new Set(customRows.map(([, style]) => style.toLowerCase()));
  const builtInRows = builtIns.filter(name => !customNames.has(name.toLowerCase()));
  document.querySelector("#style-vocab-list").innerHTML = `
    <div class="vocab-section"><strong>Saved custom styles</strong>${
      customRows.length
        ? customRows.map(([alias, style]) => `<div class="vocab-row"><input data-style-edit="${escapeHtml(alias)}" value="${escapeHtml(style)}"><span class="vocab-kind">Custom</span><button class="small" data-save-style-alias="${escapeHtml(alias)}">Save</button><button class="small" data-remove-style-alias="${escapeHtml(alias)}">Remove</button></div>`).join("")
        : '<p class="subtitle">No custom styles yet. Add Reggaeton or any new style you take.</p>'
    }</div>
    <div class="vocab-section"><strong>Built-in recognized styles</strong><div class="vocab-grid">${builtInRows.map(name => `<div class="vocab-row builtin"><input data-built-in-edit="${escapeHtml(name)}" value="${escapeHtml(name)}"><span class="vocab-kind">Built-in</span><button class="small" data-save-built-in="${escapeHtml(name)}">Save</button><button class="small" data-remove-built-in="${escapeHtml(name)}">Remove</button></div>`).join("")}</div></div>
  `;
}
function addStyleVocabulary(event) {
  event.preventDefault();
  const style = document.querySelector("#style-vocab-name").value.trim();
  if (!style) {
    toast("Enter a style name first.");
    return;
  }
  const updated = applyStyleVocabulary(style, style);
  document.querySelector("#style-vocab-name").value = "";
  document.querySelector("#style-vocab-status").textContent = `${style} saved.`;
  renderStyleVocabulary();
  renderAll();
  toast(updated ? `${style} saved and ${updated} class${updated === 1 ? "" : "es"} refreshed` : `${style} saved`);
}
function removeStyleVocabulary(alias) {
  delete repo.data.settings.styleDictionary[alias];
  repo.save();
  renderStyleVocabulary();
  document.querySelector("#style-vocab-status").textContent = "Alias removed.";
  toast("Style alias removed");
}
function removeBuiltInStyle(name) {
  repo.data.settings.disabledStyles = [...new Set([...(repo.data.settings.disabledStyles || []), name])];
  repo.save();
  renderStyleVocabulary();
  document.querySelector("#style-vocab-status").textContent = `${name} removed from recognized styles.`;
  toast(`${name} removed`);
}
function renameBuiltInStyle(name, newStyle) {
  const style = newStyle.trim();
  if (!style) return;
  repo.data.settings.disabledStyles = [...new Set([...(repo.data.settings.disabledStyles || []), name])];
  const updated = applyStyleVocabulary(name, style);
  renderStyleVocabulary();
  renderAll();
  document.querySelector("#style-vocab-status").textContent = `${name} now maps to ${style}.`;
  toast(updated ? `${style} saved and ${updated} class${updated === 1 ? "" : "es"} refreshed` : `${name} now maps to ${style}`);
}
function renameStyleVocabulary(alias, newStyle) {
  const style = newStyle.trim();
  if (!style) return;
  delete repo.data.settings.styleDictionary[alias];
  const updated = applyStyleVocabulary(style, style);
  renderStyleVocabulary();
  renderAll();
  document.querySelector("#style-vocab-status").textContent = `${style} saved.`;
  toast(updated ? `${style} saved and ${updated} class${updated === 1 ? "" : "es"} refreshed` : `${style} saved`);
}

function isAutoApprovable(event, classes = repo.getClasses()) {
  if (event.reviewStatus !== "pending") return false;
  if (event.eventType === "unknown" || event.eventType === "changed") return false;
  if (event.possibleStyle || event.confidenceScore < .8 || (event.styleConfidence || 0) < .7) return false;
  if (["booked", "reminder", "waitlisted", "receipt", "payment_receipt"].includes(event.eventType) && !event.hasClassIdentity) return false;
  if (event.eventType === "detail" && !classes.some(item => item.classInstanceKey === event.classInstanceKey)) return false;
  if (event.eventType === "canceled" && !event.match) return false;
  return true;
}
function isReady(event) { return isAutoApprovable(event); }
function autoApproveExistingPending() {
  let changed = true;
  while (changed) {
    changed = false;
    for (const event of repo.getPendingEvents()) {
      if (event.eventType === "canceled" && !event.match) {
        const match = processor.matcher.match(event, repo.getClasses());
        if (match) {
          event.match = match;
          repo.updateEvent(event.id, { match });
        }
      }
      if (isAutoApprovable(event)) {
        processor.approve(event.id);
        changed = true;
      }
    }
  }
}
function formatDate(value) { if (!value) return "Not found"; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date) ? value : date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }
function formatTime(value) { if (!value) return "Not found"; const [h,m] = value.split(":"); return new Date(2000,0,1,Number(h),Number(m)).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}); }

function renderReview() {
  const all = repo.getPendingEvents();
  all.filter(event => event.eventType === "canceled" && !event.match).forEach(event => {
    const match = processor.matcher.match(event, repo.getClasses());
    if (match) {
      event.match = match;
      repo.updateEvent(event.id, { match });
    }
  });
  const filtered = all.filter(e => reviewFilter === "all" || (reviewFilter === "ready" ? isReady(e) : !isReady(e)));
  document.querySelector("#review-list").innerHTML = filtered.map(event => `
    <article class="event-card">
      <div class="event-icon ${event.eventType}">${event.eventType === "booked" ? "+" : event.eventType === "canceled" ? "−" : event.eventType === "changed" ? "↝" : "…"}</div>
      <div>
        <div class="event-title"><h3>${escapeHtml(event.className)}</h3><span class="pill">${event.eventType}</span><span class="pill ${isReady(event) ? "ready" : "warning"}">${Math.round(event.confidenceScore*100)}% confidence</span></div>
        <div class="event-data"><span><strong>Date</strong> ${formatDate(event.classDate)}</span><span><strong>Time</strong> ${formatTime(event.classTime)}</span><span><strong>Studio</strong> ${escapeHtml(event.studio)}</span><span><strong>Teacher</strong> ${escapeHtml(event.teacher || "Not found")}</span><span><strong>Effect</strong> ${event.statusEffect > 0 ? "+" : ""}${event.statusEffect}</span><span><strong>Style</strong> ${escapeHtml(event.danceStyle)} (${Math.round((event.styleConfidence || 0)*100)}%)</span><span><strong>Style source</strong> ${escapeHtml(event.styleSource || "unknown")}</span><span><strong>Parser</strong> ${escapeHtml(event.parserId)}</span></div>
        ${event.possibleStyle ? `<div class="style-review"><strong>New possible style detected: ${escapeHtml(event.possibleStyle)}</strong><input data-style-name="${event.id}" value="${escapeHtml(event.possibleStyle)}" aria-label="Style name"><select data-style-map="${event.id}" aria-label="Map style">${KNOWN_STYLES.map(([name])=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}</select><button class="small" data-style-action="accept" data-event-id="${event.id}">Accept</button><button class="small" data-style-action="rename" data-event-id="${event.id}">Rename</button><button class="small" data-style-action="map" data-event-id="${event.id}">Map</button><button class="small" data-style-action="ignore" data-event-id="${event.id}">Ignore</button></div>` : `<div class="style-override"><label>Manual style override <input data-style-name="${event.id}" value="${escapeHtml(event.danceStyle)}"></label><button class="small" data-style-action="override" data-event-id="${event.id}">Update style</button></div>`}
        ${!isReady(event) ? `<p class="event-note">${event.eventType === "canceled" && !event.match ? "No matching active booking was found. Keep this event in review until the source booking is approved." : "One or more fields need a quick human check before this event becomes a class."}</p>` : ""}
      </div>
      <div class="event-actions"><button class="small" data-reject="${event.id}">Skip</button><button class="small approve" data-approve="${event.id}">Approve</button></div>
    </article>`).join("");
  document.querySelector("#review-empty").style.display = filtered.length ? "none" : "grid";
  document.querySelector("#review-count").textContent = all.length;
  document.querySelector("#all-count").textContent = all.length;
  document.querySelector("#ready-count").textContent = all.filter(isReady).length;
  document.querySelector("#uncertain-count").textContent = all.filter(e => !isReady(e)).length;
}
function resolveStyle(eventId, action) {
  const event = repo.data.events.find(item => item.id === eventId);
  if (!event) return;
  const alias = event.possibleStyle || event.danceStyle;
  const input = document.querySelector(`[data-style-name="${eventId}"]`);
  const map = document.querySelector(`[data-style-map="${eventId}"]`);
  let value = event.danceStyle;
  if (action === "accept") value = event.possibleStyle;
  if (action === "rename" || action === "override") value = input?.value.trim();
  if (action === "map") value = map?.value;
  if (action === "ignore") value = "Other";
  if (!value) return;
  if (event.possibleStyle && action !== "ignore") repo.data.settings.styleDictionary[alias] = value;
  repo.updateEvent(eventId, { danceStyle: value, styleSource: "manual_override", styleConfidence: 1, possibleStyle: "" });
  repo.save();
  renderAll();
  toast(action === "ignore" ? "Style candidate ignored" : `Style saved as ${value}`);
}
function renderClasses() {
  const classTimestamp = record => {
    const timestamp = Date.parse(`${record.date || "0000-01-01"}T${record.time || "00:00"}:00`);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  };
  const term = classSearch.trim().toLowerCase();
  const classes = repo.getClasses()
    .filter(record => record.finalStatus !== "canceled" && record.status !== "canceled" && record.netCount !== 0)
    .filter(record => !term || [record.date, record.time, record.className, record.studio, record.teacher, record.danceStyle, record.evidenceSource].join(" ").toLowerCase().includes(term))
    .sort((a,b) => classTimestamp(b) - classTimestamp(a));
  document.querySelector("#class-table").innerHTML = classes.map(record => `<tr><td>${formatDate(record.date)}<br><span class="class-style">${formatTime(record.time)}</span></td><td><span class="class-name">${escapeHtml(record.className)}</span><span class="class-style">${escapeHtml(record.danceStyle)} · ${escapeHtml(record.evidenceSource || "booking_confirmation")} · ${(record.supportingEventIds || []).length} supporting</span></td><td>${escapeHtml(record.studio)}</td><td>${escapeHtml(record.teacher || "—")}</td><td>${escapeHtml(record.platform)}</td><td><span class="status ${record.status}">${record.finalStatus || record.status} · ${record.netCount ?? (record.status === "active" ? 1 : 0)}</span>${READ_ONLY_MODE ? "" : `<button class="table-action" data-edit-class="${record.id}">Edit</button>`}</td></tr>`).join("");
  document.querySelector("#class-empty").style.display = classes.length ? "none" : "grid";
  document.querySelector("#class-count").textContent = classes.length;
}
function renderHistory() {
  const term = historySearch.trim().toLowerCase();
  const events = [...repo.data.events]
    .filter(event => !term || [
      event.occurredAt, event.rawSubject, event.studio, event.teacher, event.className,
      event.danceStyle, event.emailCategory, event.eventType, event.reviewStatus, event.ignoredReason,
      event.classDate, event.classTime
    ].join(" ").toLowerCase().includes(term))
    .sort((a,b) => b.occurredAt.localeCompare(a.occurredAt));
  document.querySelector("#history-table").innerHTML = events.map(event => `
    <tr>
      <td>${new Date(event.occurredAt).toLocaleDateString()}</td>
      <td><span class="class-name">${escapeHtml(event.rawSubject)}</span><span class="class-style">${escapeHtml(event.studio || "Unknown studio")} ${event.classDate ? `· ${formatDate(event.classDate)} ${formatTime(event.classTime)}` : ""}</span></td>
      <td>${escapeHtml(event.emailCategory || event.eventType)}</td>
      <td>${escapeHtml(event.platform)}</td>
      <td>${event.statusEffect > 0 ? "+" : ""}${event.statusEffect}</td>
      <td><span class="pill ${event.reviewStatus === "approved" ? "ready" : ""}">${event.ignoredReason ? `ignored: ${escapeHtml(event.ignoredReason)}` : event.reviewStatus === "history" ? "supporting only" : event.reviewStatus}</span></td>
    </tr>
  `).join("");
  document.querySelector("#history-empty").style.display=events.length?"none":"grid";
}
function renderAnalytics() {
  const data = statistics.build(repo.getClasses());
  document.querySelector("#booked-stat").textContent = data.booked;
  document.querySelector("#canceled-stat").textContent = data.canceled;
  document.querySelector("#net-stat").textContent = data.net;
  const months = []; const now = new Date();
  for (let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push([d.toISOString().slice(0,7),d.toLocaleDateString(undefined,{month:"short"})]);}
  const monthMap = Object.fromEntries(data.byMonth); const max = Math.max(1,...months.map(([key])=>monthMap[key]||0));
  document.querySelector("#month-chart").innerHTML = months.map(([key,label])=>`<div class="bar-col"><i style="height:${Math.max(2,((monthMap[key]||0)/max)*125)}px"></i><span>${label}</span></div>`).join("");
  renderRanks("#style-list", data.byStyle);
  renderRanks("#teacher-list", data.byTeacher);
  document.querySelector("#studio-list").innerHTML = data.byStudio.length ? data.byStudio.map(([name,count])=>`<div class="studio"><strong>${escapeHtml(name)}</strong><small>${count} active class${count===1?"":"es"}</small></div>`).join("") : '<p class="subtitle">No studio data yet.</p>';
}
function renderRanks(selector, rows) {
  const max = rows[0]?.[1] || 1;
  const isStyleList = selector === "#style-list";
  document.querySelector(selector).innerHTML = rows.length ? rows.slice(0,6).map(([name,count])=>`<button class="rank ${isStyleList ? "rank-clickable" : ""}" ${isStyleList ? `data-style-filter="${escapeHtml(name)}"` : ""}><span>${escapeHtml(name)}</span><b>${count}</b><div class="track"><i style="width:${count/max*100}%"></i></div></button>`).join("") : '<p class="subtitle">No data yet.</p>';
}
function renderAll(){
  renderReview();renderClasses();renderAnalytics();renderHistory();
  const sync = repo.data.syncState;
  document.querySelector("#source-state").textContent=repo.data.settings.clientId?(sync.lastSyncTimestamp?`Synced ${new Date(sync.lastSyncTimestamp).toLocaleDateString()}`:"Ready to connect"):"Not connected";
  const historyDue=!sync.historyImportCompleted||sync.syncVersion!==SYNC_VERSION||sync.parserVersion!==PARSER_VERSION;
  const syncDue=!sync.lastSyncTimestamp||Date.now()-new Date(sync.lastSyncTimestamp).getTime()>=DAY_MS;
  document.querySelector("#sync-button").textContent=repo.data.settings.clientId
    ? (syncDue ? "Sync Now · Due" : "Sync Now")
    : "Connect Gmail";
  document.querySelector("#rebuild-button").textContent=historyDue ? "Rebuild History · Updates" : "Rebuild History";
  document.querySelector("#metric-last-sync").textContent=sync.lastSyncTimestamp?new Date(sync.lastSyncTimestamp).toLocaleString():"Never";
  document.querySelector("#metric-scanned").textContent=sync.emailsScanned;
  document.querySelector("#metric-found").textContent=sync.danceEventsFound;
  document.querySelector("#metric-review").textContent=repo.getPendingEvents().length;
  document.querySelector("#metric-duplicates").textContent=sync.duplicatesMerged;
  document.querySelector("#sync-error").textContent=sync.lastError||"";
  document.querySelector("#sync-error").style.display=sync.lastError?"block":"none";
}

function navigate(view) {
  if (READ_ONLY_MODE && ["review", "history"].includes(view)) view = "analytics";
  document.querySelectorAll(".view").forEach(el=>el.classList.remove("active")); document.querySelectorAll(".nav").forEach(el=>el.classList.remove("active"));
  document.querySelector(`#${view}-view`).classList.add("active"); document.querySelector(`[data-view="${view}"]`).classList.add("active");
  const copy={
    analytics:["Your dance practice","Summary","Unique classes kept, grouped by style and studio."],
    classes:["Normalized ledger","Classes","Approved events, resolved into class records."],
    review:["Event review","Review Inbox","Only uncertain class events require your attention."],
    history:["Gmail processing log","Email History","Supporting emails and receipts retained without inflating class counts."]
  }[view];
  document.querySelector("#eyebrow").textContent=copy[0];document.querySelector("#title").textContent=copy[1];document.querySelector("#subtitle").textContent=copy[2];
}
function shareReadOnlyView() {
  const url = new URL("share.html", window.location.href);
  url.search = "";
  url.hash = `data=${encodeSharePayload(buildShareSnapshot())}`;
  const link = url.toString();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link).then(() => toast("Public read-only share link copied")).catch(() => {
      window.location.href = link;
    });
  } else {
    window.location.href = link;
  }
}
function buildShareSnapshot() {
  const data = statistics.build(repo.getClasses());
  return {
    schemaVersion: 1,
    appName: "DanceHub",
    generatedAt: new Date().toISOString(),
    stats: {
      booked: data.booked,
      canceled: data.canceled,
      net: data.net,
      byStyle: data.byStyle,
      byTeacher: data.byTeacher,
      byStudio: data.byStudio,
      byMonth: data.byMonth
    },
    classes: activeClassesForExport().map(record => ({
      date: record.date || "",
      time: record.time || "",
      className: record.className || "",
      danceStyle: record.danceStyle || "Other",
      studio: record.studio || "",
      teacher: record.teacher || "",
      platform: record.platform || ""
    }))
  };
}
function encodeSharePayload(snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function activeClassesForExport() {
  return repo.getClasses()
    .filter(c => c.netCount === 1 && c.status === "active" && c.finalStatus === "booked" && !c.cancellationEventId)
    .sort((a, b) => {
      const at = Date.parse(`${a.date || "0000-01-01"}T${a.time || "00:00"}:00`) || 0;
      const bt = Date.parse(`${b.date || "0000-01-01"}T${b.time || "00:00"}:00`) || 0;
      return bt - at;
    });
}
function exportReadOnlyDashboard() {
  const classes = activeClassesForExport();
  const data = statistics.build(repo.getClasses());
  const generatedAt = new Date().toLocaleString();
  const rank = (title, rows) => `
    <section class="card"><h2>${escapeHtml(title)}</h2>${rows.length ? rows.map(([name, count]) => `<div class="rank"><span>${escapeHtml(name)}</span><b>${count}</b></div>`).join("") : "<p>No data</p>"}</section>`;
  const classRows = classes.map(record => `<tr><td>${formatDate(record.date)}<br><small>${formatTime(record.time)}</small></td><td><strong>${escapeHtml(record.className)}</strong><br><small>${escapeHtml(record.danceStyle)}</small></td><td>${escapeHtml(record.studio)}</td><td>${escapeHtml(record.teacher || "")}</td></tr>`).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DanceHub Read-only Dashboard</title>
<style>
body{margin:0;background:#151210;color:#f5eee6;font-family:Inter,Arial,sans-serif}main{max-width:1180px;margin:0 auto;padding:42px 24px}header{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:26px}.brand{display:flex;align-items:center;gap:14px}.mark{display:grid;place-items:center;width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,#8f7bff,#79c7d3);color:#111;font-weight:900}h1{font-family:Georgia,serif;font-size:56px;margin:0}p,small{color:#b9aca2}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.stat,.card{background:rgba(34,29,26,.92);border:1px solid rgba(143,123,255,.18);border-radius:18px;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.28)}.stat strong{display:block;font-family:Georgia,serif;font-size:48px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:14px}.rank{display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);padding:9px 0}.table{margin-top:14px;overflow:auto}.table table{width:100%;border-collapse:collapse;background:rgba(34,29,26,.92);border-radius:18px;overflow:hidden}.table th,.table td{padding:13px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left}.table th{font-size:11px;text-transform:uppercase;color:#b9aca2}@media(max-width:800px){.stats,.grid{grid-template-columns:1fr}h1{font-size:42px}}
</style></head><body><main>
<header><div class="brand"><div class="mark">DH</div><div><h1>DanceHub</h1><p>Read-only dance practice dashboard</p></div></div><small>Exported ${escapeHtml(generatedAt)}</small></header>
<section class="stats"><div class="stat"><small>Classes kept</small><strong>${data.net}</strong></div><div class="stat"><small>Total booked</small><strong>${data.booked}</strong></div><div class="stat"><small>Total canceled</small><strong>${data.canceled}</strong></div></section>
<section class="grid">${rank("Classes by style", data.byStyle)}${rank("Classes by studio", data.byStudio)}${rank("Classes by teacher", data.byTeacher)}${rank("Classes by month", data.byMonth)}</section>
<section class="table"><table><thead><tr><th>Date</th><th>Class</th><th>Studio</th><th>Teacher</th></tr></thead><tbody>${classRows || '<tr><td colspan="4">No classes exported.</td></tr>'}</tbody></table></section>
</main></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dancehub-dashboard-${new Date().toISOString().slice(0,10)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Read-only dashboard exported");
}
function applyReadOnlyMode() {
  if (!READ_ONLY_MODE) return;
  document.body.classList.add("readonly-mode");
  document.querySelector("#subtitle").textContent = "Read-only DanceHub dashboard.";
  document.querySelectorAll('[data-view="review"], [data-view="history"]').forEach(el => el.style.display = "none");
  if (["review-view", "history-view"].some(id => document.querySelector(`#${id}`)?.classList.contains("active"))) navigate("analytics");
}
function showSettings(){document.querySelector("#client-id").value=repo.data.settings.clientId;document.querySelector("#style-vocab-status").textContent="";renderStyleVocabulary();document.querySelector("#settings-dialog").showModal();}
function showManualClassDialog(){
  editingClassId = "";
  const dialog = document.querySelector("#manual-class-dialog");
  document.querySelector("#manual-dialog-eyebrow").textContent = "Local entry";
  document.querySelector("#manual-dialog-title").textContent = "Add class manually";
  document.querySelector("#save-manual-class").textContent = "Add class";
  document.querySelector("#manual-date").value = new Date().toISOString().slice(0, 10);
  document.querySelector("#manual-time").value = "";
  document.querySelector("#manual-studio").value = "";
  document.querySelector("#manual-teacher").value = "";
  document.querySelector("#manual-class-name").value = "";
  document.querySelector("#manual-style").value = "";
  document.querySelector("#manual-status").value = "booked";
  dialog.showModal();
}
function showEditClassDialog(classId){
  const record = repo.getClasses().find(item => item.id === classId);
  if (!record) return;
  editingClassId = classId;
  document.querySelector("#manual-dialog-eyebrow").textContent = "Local override";
  document.querySelector("#manual-dialog-title").textContent = "Edit class";
  document.querySelector("#save-manual-class").textContent = "Save changes";
  document.querySelector("#manual-date").value = record.date || "";
  document.querySelector("#manual-time").value = record.time || "";
  document.querySelector("#manual-studio").value = record.studio || "";
  document.querySelector("#manual-teacher").value = record.teacher || "";
  document.querySelector("#manual-class-name").value = record.className || "";
  document.querySelector("#manual-style").value = record.danceStyle || "";
  document.querySelector("#manual-status").value = record.finalStatus === "canceled" || record.status === "canceled" ? "canceled" : "booked";
  document.querySelector("#manual-class-dialog").showModal();
}
function saveManualClass(event){
  event.preventDefault();
  const fields = {
    date: document.querySelector("#manual-date").value,
    time: document.querySelector("#manual-time").value,
    studio: document.querySelector("#manual-studio").value.trim(),
    teacher: document.querySelector("#manual-teacher").value.trim(),
    className: document.querySelector("#manual-class-name").value.trim(),
    danceStyle: document.querySelector("#manual-style").value.trim(),
    status: document.querySelector("#manual-status").value
  };
  if (!fields.date || !fields.time || !fields.studio || !fields.className || !fields.danceStyle) {
    toast("Date, time, studio, class name, and style are required.");
    return;
  }
  if (editingClassId) {
    updateClassRecord(editingClassId, fields);
  } else {
    createManualClass(fields);
  }
  document.querySelector("#manual-class-dialog").close();
  navigate("classes");
  renderAll();
  toast(editingClassId ? "Class updated" : fields.status === "canceled" ? "Manual canceled class saved" : "Manual class added");
  editingClassId = "";
}
async function connectGmail(mode="incremental"){
  if(!repo.data.settings.clientId){showSettings();return}
  if(/Codex|Electron/i.test(navigator.userAgent)){
    toast("Open http://localhost:4173 in Chrome or Edge to connect Gmail.");
    return false;
  }
  const button=document.querySelector("#sync-button");button.disabled=true;button.textContent="Reading Gmail…";
  try{
    const gmail=new GmailReadonlyClient(repo.data.settings.clientId);await gmail.authorize();
    const wasHistoryImport = mode === "rebuild" || !repo.data.syncState.historyImportCompleted;
    const queries=buildSyncQueries(mode,repo.data.syncState);
    const searchResults=[];
    const queryErrors=[];
    for(let queryIndex=0;queryIndex<queries.length;queryIndex++){
      const query=queries[queryIndex];
      button.textContent=`Searching Gmail ${queryIndex+1}/${queries.length}`;
      await new Promise(resolve=>setTimeout(resolve,0));
      try{
        searchResults.push(...await gmail.searchMessages(query));
      }catch(error){
        queryErrors.push(`${query}: ${error.message}`);
      }
    }
    const ids=[...new Map(searchResults.map(item=>[item.id,item])).values()];
    if(!ids.length && queryErrors.length) throw new Error(`All Gmail searches failed. ${queryErrors[0]}`);
    let added=0,duplicates=0;
    const newIds=ids.filter(item=>{
      if(wasHistoryImport && repo.hasMessage(item.id)){
        repo.removeMessageProjection(item.id);
        return true;
      }
      const isCurrent = repo.hasCurrentMessage(item.id);
      if(isCurrent){duplicates++;return false}
      if(repo.hasMessage(item.id)){
        duplicates++;
        return false;
      }
      return true;
    });
    let lastMessageId=repo.data.syncState.lastProcessedGmailMessageId;
    for(let i=0;i<newIds.length;i+=10){
      button.textContent=`Reading emails ${Math.min(i+10,newIds.length)}/${newIds.length}`;
      await new Promise(resolve=>setTimeout(resolve,0));
      const batch=newIds.slice(i,i+10);
      const messages=await Promise.all(batch.map(item=>gmail.readMessage(item.id)));
      messages.forEach(message=>{
        const outcome=processor.ingest(sourceEmail(message));
        if(outcome==="added"){
          added++;
          const imported=repo.data.events.find(item=>item.gmailMessageId===message.id);
          if(imported?.mergesExistingClass)duplicates++;
        }
        if(outcome==="duplicate")duplicates++;
        lastMessageId=message.id;
      });
    }
    autoApproveExistingPending();
    repo.data.syncState={
      lastSyncTimestamp:new Date().toISOString(),
      lastProcessedGmailMessageId:lastMessageId,
      syncVersion:SYNC_VERSION,
      parserVersion:PARSER_VERSION,
      historyImportCompleted:true,
      historyImportedAt:wasHistoryImport ? new Date().toISOString() : repo.data.syncState.historyImportedAt,
      emailsScanned:ids.length,
      danceEventsFound:added,
      duplicatesMerged:duplicates
      ,lastError:queryErrors.length?`Some Gmail searches failed: ${queryErrors.slice(0,3).join(" | ")}`:""
    };
    repo.save();renderAll();toast(`${added} new dance event${added===1?"":"s"} found`);
    return true;
  }catch(error){repo.data.syncState={...repo.data.syncState,lastError:error.message};repo.save();toast(error.message);return false}finally{button.disabled=false;renderAll()}
}
async function rebuildHistory(){
  if(!repo.data.settings.clientId){showSettings();return}
  if(!window.confirm("Rebuild the last 24 months? Existing imported events, classes, and review items will be recomputed."))return;
  const backup=JSON.stringify(repo.data);
  repo.resetImportedData();
  renderAll();
  const succeeded=await connectGmail("rebuild");
  if(!succeeded){
    const rebuildError=repo.data.syncState.lastError || "Rebuild failed.";
    repo.data=JSON.parse(backup);
    repo.data.syncState={...repo.data.syncState,lastError:rebuildError};
    repo.save();
    renderAll();
    toast("Rebuild failed. See Review Inbox error details.");
  }
}
async function runDiagnosticSearch(){
  const output = document.querySelector("#diagnostic-output");
  const query = document.querySelector("#diagnostic-query").value.trim();
  if(!repo.data.settings.clientId){showSettings();return}
  if(!query){output.textContent="Enter a Gmail search query first.";return}
  output.textContent="Searching Gmail...";
  try{
    const gmail=new GmailReadonlyClient(repo.data.settings.clientId);await gmail.authorize();
    const ids=await gmail.searchMessages(query);
    const messages=await Promise.all(ids.slice(0,10).map(item=>gmail.readMessage(item.id)));
    const rows=messages.map(message=>{
      const email=sourceEmail(message);
      const eligibility=classifyDanceEmail(email,repo.data.settings.styleDictionary||{});
      const event=eligibility.allowed ? parserRegistry.parse(email) : null;
      return {
        gmailMessageId: email.gmailMessageId,
        receivedAt: email.receivedAt,
        subject: email.subject,
        from: email.from,
        allowed: eligibility.allowed,
        reason: eligibility.reason,
        category: eligibility.category,
        parsed: event ? {
          eventType: event.eventType,
          className: event.className,
          studio: event.studio,
          teacher: event.teacher,
          date: event.classDate,
          time: event.classTime,
          danceStyle: event.danceStyle,
          confidenceScore: event.confidenceScore,
          hasClassIdentity: event.hasClassIdentity,
          classInstanceKey: event.classInstanceKey
        } : null
      };
    });
    output.textContent=JSON.stringify({query,totalMatches:ids.length,shown:rows.length,rows},null,2);
  }catch(error){
    output.textContent=error.message;
  }
}
function demoMessage(id,subject,body,from,receivedAt=Date.now()){const encoded=btoa(unescape(encodeURIComponent(body))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");return{id,threadId:id,internalDate:String(receivedAt),payload:{mimeType:"text/plain",headers:[{name:"Subject",value:subject},{name:"From",value:from}],body:{data:encoded}}}}
function loadDemo(){
  const messages=[
    demoMessage("real-format-mb-1","Payment methods to complete your booking for Beg House - Huu Rock on 6/3/2026 at 6:30 PM","Dear Dancer,\n\nThank you for booking a class at PJM! You must complete your booking for Beg House - Huu Rock with Huu Rock at on Wednesday, 6/3/2026, at 6:30 PM.\n\nCancellation: Cancellation can be done anytime in your Mindbody account.","PJM DANCE NYC <Business@example.mindbodyonline.com>"),
    demoMessage("real-format-mb-2","Peridance Center Reservation for Beg House on 6/6/2026 at 12:00 PM!","Dear Dancer,\n\nThis confirms your reservation for Beg House with Huu Rock on Saturday, 6/6/2026 at 12:00 PM.\n\nStudents can cancel their reservation by logging into Mindbody.","Peridance Center <Business@example.mindbodyonline.com>"),
    demoMessage("real-format-mb-3","reservation for 6/6/2026 at 12:00 PM at Peridance Center Has Been Cancelled","Dear Dancer,\n\nThis confirms that Beg House reservation on 6/6/2026 at 12:00 PM has been cancelled.","Peridance Center <Business@example.mindbodyonline.com>"),
    demoMessage("real-format-ar-1","Reservation Confirmation - Class with Edson Maldonado","You're all set!\nYou have successfully booked The E'fect: Beginner/Adv-Beginner Choreography Intensive.\n\nThe E'fect: Beginner/Adv-Beginner Choreography Intensive\nEdson Maldonado\n\nSun, Mar 29, 2026, 03:30 PM - 06:30 PM EDT\n\nLocation: 11-05 44th Ave, Queens, NY 11101, USA","Modega <no-reply@notifications.arketa.co>"),
    demoMessage("real-format-zh-3","Re: 【课程确认】中阶女团 - Up - Nov, 22nd, Sat - 4 PM - @Gibney 280 Broadway","终于等到你！感谢报名我们的中阶女团！以下是课程详情：\n\n时间： 11月22日（周六）4 – 5:30PM\n曲目： Karina(aespa) - “Up”\n教师： Tiffany\n地点： Gibney 280 Broadway (studio G)","Afterschool Dance <classes@example.com>",Date.parse("2025-11-22T10:08:00-05:00")),
    demoMessage("real-format-ild-booked","Booking confirmed: In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1)","Class: In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1)\nDate: March 7, 2026\nTime: 6:30 PM\nTeacher: Maylin Ramos","I Love Dance <Business-booked@example.mindbodyonline.com>",Date.parse("2026-03-01T08:04:00-05:00")),
    demoMessage("real-format-ild-3","I Love Dance Reminder: In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1) at 6:30pm on 3/7/2026","Dear Dancer,\nThis is a reminder for your reservation for In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1) with Maylin Ramos on Saturday, 3/7/2026. Class will start at 6:30pm.","I Love Dance <Business@example.mindbodyonline.com>",Date.parse("2026-03-05T08:04:00-05:00")),
    demoMessage("real-format-ild-detail","Class details: In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1)","Class: In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1)\nDate: March 7, 2026\nTime: 6:30 PM\nTeacher: Maylin Ramos","I Love Dance <Business-details@example.mindbodyonline.com>",Date.parse("2026-03-06T08:04:00-05:00")),
    demoMessage("real-format-ild-receipt","Sales receipt: In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1)","Payment received.\nClass: In-StudioM: Big Girls Don't Cry | ENHYPEN (Part 1)\nDate: March 7, 2026\nTime: 6:30 PM\nTeacher: Maylin Ramos","I Love Dance <Business-receipt@example.mindbodyonline.com>",Date.parse("2026-03-02T08:04:00-05:00")),
    demoMessage("pjm-generic-receipt","PJM DANCE NYC Sales Receipt","Thank you for your purchase. Below is your purchase receipt.\nSale Date: 6/3/2026 - 11:57 AM\n1 Class Credit\nPayment Method: Venmo/Zelle\nTotal: $50.00","PJM DANCE NYC <Business-receipt@example.mindbodyonline.com>",Date.parse("2026-06-03T11:57:00-04:00")),
    demoMessage("pjm-jazz-booking","Payment methods to complete your booking for Adv Beg Jazz Funk - Peter Chow on 6/3/2026 at 8:00 PM","Thank you for booking a class at PJM! Complete your booking for Adv Beg Jazz Funk - Peter Chow with Peter Chow on Wednesday, 6/3/2026, at 8:00 PM.","PJM DANCE NYC <Business-jazz@example.mindbodyonline.com>",Date.parse("2026-06-02T18:01:00-04:00")),
    demoMessage("pmt-generic-receipt","PMT House of Dance Sales Receipt","Thank you for shopping in our online store. Purchase receipt.\nSale Date: 5/27/2026 - 8:43 AM\n1 E Solo Masterclass credit\nTotal: $25.00","PMT House of Dance <Business-receipt@example.mindbodyonline.com>",Date.parse("2026-05-27T08:43:00-04:00")),
    demoMessage("pmt-litefeet-booking","PMT House of Dance Reservation for Master Class - Litefeet with E Solo on 6/14/2026 at 3:00 PM","This confirms your reservation for Master Class - Litefeet with E Solo with E Solo at PMT House of Dance on Sunday, 6/14/2026. Class will start at 3:00 PM.","PMT House of Dance <Business-booking@example.mindbodyonline.com>",Date.parse("2026-05-27T08:43:00-04:00")),
    demoMessage("xspace-generic-receipt","Receipt for Your X-SPACE DANCE Purchase","Thank you for shopping in our online store. Purchase receipt.\nSale Date: 5/27/2026 - 10:56 PM\n1 Single Class credit\nTotal: $26.00","X-SPACE DANCE <Business-receipt@example.mindbodyonline.com>",Date.parse("2026-05-27T22:56:00-04:00")),
    demoMessage("xspace-house-booking","X-SPACE DANCE Reservation for ADV. BEG. House - Huu Rock on 5/29/2026 at 6:00 PM","This confirms your reservation for ADV. BEG. House - Huu Rock with HuuRock . at X-SPACE DANCE on Friday, 5/29/2026. Class will start at 6:00 PM.","X-SPACE DANCE <Business-booking@example.mindbodyonline.com>",Date.parse("2026-05-27T22:56:00-04:00")),
    demoMessage("financial-trade-confirmation","Your trade confirmation is available online","Account: XXXXX9572\nAction Security Price\nBOUGHT BANK CD 100.0000\nView your prospectus and trade confirmations.","Financial Institution <documents@example.com>",Date.parse("2026-05-27T12:00:00-04:00")),
    demoMessage("style-candidate-1","Class confirmation: Beginner Flexn with Alex","Your Beginner Flexn class with Alex is confirmed.\nDate: March 12, 2026\nTime: 7:00 PM\nStudio: Example Dance","Example Dance <classes@example.com>")
  ];
  let added=0,duplicates=0;messages.forEach(message=>{const outcome=processor.ingest(sourceEmail(message));if(outcome==="added"){added++;const imported=repo.data.events.find(item=>item.gmailMessageId===message.id);if(imported?.mergesExistingClass)duplicates++}if(outcome==="duplicate")duplicates++});
  autoApproveExistingPending();
  repo.data.syncState={...repo.data.syncState,lastSyncTimestamp:new Date().toISOString(),emailsScanned:messages.length,danceEventsFound:added,duplicatesMerged:duplicates};
  repo.save();renderAll();toast(`${added} demo event${added===1?"":"s"} added`);
}
let toastTimer;function toast(message){const el=document.querySelector("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2600)}

document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>navigate(button.dataset.view)));
document.querySelectorAll("[data-review-filter]").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll("[data-review-filter]").forEach(b=>b.classList.remove("active"));button.classList.add("active");reviewFilter=button.dataset.reviewFilter;renderReview()}));
document.querySelector("#review-list").addEventListener("click",event=>{const approve=event.target.closest("[data-approve]");const reject=event.target.closest("[data-reject]");if(approve){const result=processor.approve(approve.dataset.approve);if(!result?.ok)toast(result?.reason||"This item still needs more information.");renderAll()}if(reject){processor.reject(reject.dataset.reject);renderAll()}});
document.querySelector("#review-list").addEventListener("click",event=>{const styleAction=event.target.closest("[data-style-action]");if(styleAction)resolveStyle(styleAction.dataset.eventId,styleAction.dataset.styleAction)});
document.querySelector("#approve-ready").addEventListener("click",()=>{repo.getPendingEvents().filter(isReady).forEach(event=>processor.approve(event.id));renderAll()});
document.querySelector("#settings-button").addEventListener("click",()=>{if(!READ_ONLY_MODE)showSettings()});
document.querySelector("#share-button").addEventListener("click",shareReadOnlyView);
document.querySelector("#export-button").addEventListener("click",exportReadOnlyDashboard);
document.querySelector("#sync-button").addEventListener("click",()=>{if(!READ_ONLY_MODE)connectGmail("incremental")});
document.querySelector("#rebuild-button").addEventListener("click",()=>{if(!READ_ONLY_MODE)rebuildHistory()});
document.querySelector("#manual-class-button").addEventListener("click",()=>{if(!READ_ONLY_MODE)showManualClassDialog()});
document.querySelector("#manual-class-form").addEventListener("submit",saveManualClass);
document.querySelector("#class-table").addEventListener("click",event=>{const button=event.target.closest("[data-edit-class]");if(button&&!READ_ONLY_MODE)showEditClassDialog(button.dataset.editClass)});
document.querySelector("#style-list").addEventListener("click",event=>{const button=event.target.closest("[data-style-filter]");if(!button)return;classSearch=button.dataset.styleFilter;document.querySelector("#class-search").value=classSearch;navigate("classes");renderClasses()});
document.querySelector("#class-search").addEventListener("input",event=>{classSearch=event.target.value;renderClasses()});
document.querySelector("#history-search").addEventListener("input",event=>{historySearch=event.target.value;renderHistory()});
document.querySelector("#diagnostic-button").addEventListener("click",runDiagnosticSearch);
document.querySelector("#open-style-manager").addEventListener("click",event=>{event.preventDefault();document.querySelector("#style-vocab-status").textContent="";renderStyleVocabulary();document.querySelector("#style-manager-dialog").showModal()});
document.querySelector("#add-style-vocab").addEventListener("click",addStyleVocabulary);
document.querySelector("#refresh-style-vocab").addEventListener("click",event=>{event.preventDefault();const updated=refreshStyleVocabulary();renderStyleVocabulary();renderAll();toast(updated ? `${updated} class${updated===1?"":"es"} refreshed from vocabulary` : "Vocabulary refreshed")});
document.querySelector("#style-vocab-list").addEventListener("click",event=>{const remove=event.target.closest("[data-remove-style-alias]");const save=event.target.closest("[data-save-style-alias]");const removeBuiltIn=event.target.closest("[data-remove-built-in]");const saveBuiltIn=event.target.closest("[data-save-built-in]");if(remove)removeStyleVocabulary(remove.dataset.removeStyleAlias);if(save){const input=document.querySelector(`[data-style-edit="${CSS.escape(save.dataset.saveStyleAlias)}"]`);renameStyleVocabulary(save.dataset.saveStyleAlias,input?.value||"")}if(removeBuiltIn)removeBuiltInStyle(removeBuiltIn.dataset.removeBuiltIn);if(saveBuiltIn){const input=document.querySelector(`[data-built-in-edit="${CSS.escape(saveBuiltIn.dataset.saveBuiltIn)}"]`);renameBuiltInStyle(saveBuiltIn.dataset.saveBuiltIn,input?.value||"")}});
document.querySelector("#save-connect").addEventListener("click",event=>{event.preventDefault();repo.data.settings={...repo.data.settings,clientId:document.querySelector("#client-id").value.trim(),query:CANDIDATE_QUERY};repo.save();document.querySelector("#settings-dialog").close();connectGmail()});
autoApproveExistingPending();
renderAll();
applyReadOnlyMode();
