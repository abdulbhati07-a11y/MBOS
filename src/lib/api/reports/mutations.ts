// ---------------------------------------------------------------------------
// src/lib/api/reports/mutations.ts
//
// Reports are read-only: every route in Section 6.11 is a `GET` gated on
// `reports.read`, and a report changes nothing in the database — it is a
// derived view. So there are no mutations to define here.
//
// The file exists anyway to match the `queries.ts` / `mutations.ts` pairing
// every other API module follows, so a reader looking for "where are the
// reports mutations" finds this note rather than an absent file and wonders
// whether it was forgotten. The bare `export {}` makes it a module rather than
// a global script, which `isolatedModules` in the frontend tsconfig requires.
// ---------------------------------------------------------------------------

export {}
