# DanceHub: Gmail Dance Class Tracker

DanceHub is a review-first, browser-based tracker that turns read-only Gmail messages into normalized dance class records and statistics.

## Data flow

`Gmail message -> Event -> Review Inbox -> Class -> Statistics`

- Gmail messages are immutable source data.
- Parser plugins create normalized event drafts.
- Users approve or reject drafts in the Review Inbox.
- Approved booking, cancellation, waitlist, and change events update the class ledger.
- Analytics is derived only from normalized classes.

## Gmail permissions

The application requests exactly one scope:

```text
https://www.googleapis.com/auth/gmail.readonly
```

Its Gmail adapter implements only `GET` requests for `users.messages.list` and `users.messages.get`. There are no send, delete, modify, label, archive, or settings operations.

## Run locally

Serve this directory over HTTP:

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`, configure a Google OAuth Web client ID, and add that origin to the client's Authorized JavaScript origins.

## Sharing

`Copy Public Share Link` creates a sanitized read-only dashboard snapshot for
`share.html`. The shared snapshot includes aggregate stats and normalized class
records only. It does not include Gmail OAuth tokens, raw email bodies, Gmail
message IDs, email history, settings, or review actions.

For friends outside your Wi-Fi, host the static `outputs` folder with a service
such as GitHub Pages, Netlify, or Vercel. Then copy the public share link from
that hosted dashboard. Localhost links only work on your own computer.

## Architecture

Typed contracts live in `src/domain.ts`. Persistence is behind the `DanceTrackerRepository` interface, with `LocalStorageRepository` as the current adapter. A future Supabase adapter can implement the same interface without changing event processing, cancellation matching, review, or statistics logic.

Parser plugins:

- Mindbody
- Momence
- Vagaro
- Punchpass
- WellnessLiving
- Arketa
- Chinese emails: language detection -> English translation -> event parser
- Generic AI parser fallback

## Adaptive style extraction

Style extraction returns a value, source, and confidence. It checks explicit
known styles first, then studio-specific mappings, the user's confirmed alias
dictionary, fuzzy new-style candidates, and finally song/artist title patterns.
A title such as `Big Girls Don't Cry | ENHYPEN` falls back to `K-Pop` with
`style_source: song_only_fallback` and confidence `0.7`.

New candidates such as `Litefeet` stay in Review Inbox until accepted, renamed,
mapped, or ignored. Confirmed mappings are saved to the local style dictionary
and applied to future imports. Every review card also supports manual override.

Chinese source text is translated into an English, field-labeled representation
before classification and extraction. The original subject is retained on the
event for review. The current local translator covers common booking fields and
phrases; the `EmailTranslationService` boundary is ready for a full translation
provider without changing parser or business logic.

## Dance-only eligibility

Every Gmail message passes through an eligibility classifier before parsing.
Only dance bookings, reminders, cancellations, and receipts proceed. Explicit
fitness exclusions such as Pilates, Yoga, Barre, Lagree, and general fitness
take priority, along with travel, restaurant, shopping, promotion, and personal
mail exclusions. Detection does not require the word "dance": known styles,
user aliases, Chinese style markers, song/artist titles, and trusted booking
platform signals can establish eligibility.

## Incremental sync

The first successful Gmail connection imports candidate emails from the
previous 24 months. Later syncs query only messages after the last successful
sync cursor and append new events or update matching class instances. Existing
history is never removed as it ages, so the database grows cumulatively.

`Rebuild History` is the only operation that clears imported data and
recomputes from the current 24-month window. A failed rebuild restores the
previous database.

The built-in demo uses privacy-scrubbed fixtures based on real Mindbody and
Arketa email formats. Personal addresses, access codes, payment details, and
other unrelated content are not retained in the fixtures.
