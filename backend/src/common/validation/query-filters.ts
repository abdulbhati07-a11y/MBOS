import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Query-string filters shared by the Section 6.4-6.11 list endpoints.
 *
 * Extracted rather than repeated per DTO: `?isActive=` appears on users,
 * customers, suppliers and products, and `?search=` on three of those. The
 * `isActive` transform below is exactly the kind of subtlety that would hold in
 * three copies and be wrong in the fourth.
 */

/**
 * `?isActive=true|false`.
 *
 * The transform is explicit because `Boolean('false')` is `true` — under implicit
 * conversion `?isActive=false` would silently mean "active", the worst class of
 * filter bug because the response still looks like a plausible answer. Any value
 * other than the two literals is passed through untouched so `@IsBoolean`
 * rejects it, which the global pipe renders as 400 for a query parameter
 * (Section 6.1), not 422.
 */
export function IsOptionalBooleanQuery(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Transform(({ value }) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }),
    IsBoolean(),
  );
}

/**
 * Longer than any real name or email, short enough that the term cannot be used
 * to hand Postgres a pathological `ILIKE` pattern.
 */
export const MAX_SEARCH_LENGTH = 200;

/**
 * `?search=` — a free-text term the service matches against specific columns.
 *
 * Always used with Prisma's `contains`, which parameterises the value, so the
 * term is data and never SQL. `%` and `_` inside it are matched literally by
 * `contains`, so a user typing "50%" searches for that text rather than
 * accidentally writing a wildcard.
 */
export function IsOptionalSearchQuery(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsString(),
    MaxLength(MAX_SEARCH_LENGTH),
  );
}

/**
 * Builds the `OR` of case-insensitive `contains` clauses that implements
 * `?search=`, leaving each endpoint to decide only *which* columns it matches.
 *
 * Generic over the model's `WhereInput` so the column list is checked at compile
 * time: `searchAny<Prisma.CustomerWhereInput>(term, ['name', 'emial'])` fails to
 * build rather than producing a filter that silently matches nothing. That is the
 * whole reason this is a shared function instead of an inline object literal.
 *
 * Returns `undefined` for an absent or whitespace-only term so callers can spread
 * it unconditionally. `?search=` with an empty value therefore means "no filter"
 * rather than "contains the empty string", which would match every row and read
 * as a filter that had quietly stopped working.
 */
export function searchAny<W>(
  term: string | undefined,
  fields: readonly (keyof W & string)[],
): W | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;

  // `mode: 'insensitive'` is Postgres ILIKE. The term is passed as a bound
  // parameter by `contains`, so it is data, never SQL — and `%`/`_` inside it
  // match literally rather than acting as wildcards.
  const clauses = fields.map((field) => ({
    [field]: { contains: trimmed, mode: 'insensitive' as const },
  }));

  // The one cast: a `{ OR: [...] }` literal cannot be expressed as a generic `W`
  // without it. Confined here so every call site stays fully typed.
  return { OR: clauses } as W;
}

/** Matches a date with no time part, e.g. `2026-08-24`. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `?dateFrom=` / `?dateTo=` — an ISO 8601 date or timestamp.
 *
 * `strict` rejects impossible calendar dates that the lenient parse would accept
 * and silently roll over: `2026-02-30` becomes March 2nd under `new Date()`, so a
 * report filtered to February would quietly include a March order.
 */
export function IsOptionalDateQuery(): PropertyDecorator {
  return applyDecorators(IsOptional(), IsISO8601({ strict: true }));
}

/**
 * Builds the `{ gte, lte }` a date-range filter needs, or `undefined` when
 * neither bound was given, so callers can spread it unconditionally.
 *
 * The subtlety is `dateTo`, and it is the reason this is shared rather than
 * inlined per endpoint. `?dateTo=2026-08-24` means "through the 24th", but
 * `new Date('2026-08-24')` is midnight UTC, so a plain `lte` would exclude every
 * order placed *during* the 24th — a report that silently loses its most recent
 * day. A date-only upper bound is therefore widened to the end of that day. A
 * full timestamp is honoured exactly as sent, because a caller who wrote the time
 * meant it.
 *
 * Both bounds are validated as ISO 8601 by `IsOptionalDateQuery` before reaching
 * here, so the `Date`s cannot be Invalid.
 */
export function dateRange(
  from?: string,
  to?: string,
): { gte?: Date; lte?: Date } | undefined {
  if (from === undefined && to === undefined) return undefined;

  const range: { gte?: Date; lte?: Date } = {};
  if (from !== undefined) range.gte = new Date(from);
  if (to !== undefined) {
    range.lte = DATE_ONLY.test(to)
      ? new Date(`${to}T23:59:59.999Z`)
      : new Date(to);
  }
  return range;
}
