/**
 * CSV serialisation for the Section 6.11 report exports.
 *
 * Small enough to write by hand, and deliberately not a dependency: the two
 * things that make CSV generation go wrong are both decisions rather than
 * algorithms, and both are made here explicitly.
 */

/**
 * A cell. `number` is separate from `string` on purpose — see `escapeText`.
 * `null` renders as an empty cell, not the text "null".
 */
export type CsvValue = string | number | null | undefined;

/**
 * RFC 4180 says CRLF, and Excel on Windows agrees. Bare LF is read as one long
 * row by some spreadsheet versions.
 */
const CRLF = '\r\n';

/**
 * UTF-8 byte-order mark.
 *
 * Built from its code point rather than written as a literal character, which
 * would be invisible in the source and is exactly the kind of thing an editor or
 * a formatter strips as stray whitespace — silently breaking every export for the
 * one reader who needed it.
 */
const BOM = String.fromCharCode(0xfeff);

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than text.
 *
 * This is the one genuine security concern in an export. A product or customer
 * name is free text typed by a user, it lands in a file another user opens in
 * Excel, LibreOffice or Sheets, and a cell beginning with any of these is
 * *evaluated* there. `=HYPERLINK(...)`, `=cmd|...`, `+WEBSERVICE(...)` — the
 * payload runs with the reader's privileges, on a machine that never touched the
 * tenant that stored the string. Quoting does not help: the quotes are consumed
 * by the CSV parse, and the formula is what remains.
 *
 * `\t` and `\r` are included because leading whitespace is stripped before the
 * first significant character is examined, so `"\t=1+1"` is still a formula.
 */
const FORMULA_LEADERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Characters that force a field to be quoted. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Escapes a **text** cell: neutralises formulas, then quotes.
 *
 * The formula guard prefixes an apostrophe, which every major spreadsheet reads
 * as "the rest of this cell is literal text" and does not display. It is applied
 * only to text, never to numbers, and that split is the reason `CsvValue`
 * distinguishes them: `-500` as a number is a legitimate negative margin and must
 * stay a number the spreadsheet can sum, while `-500` typed into a product name
 * is a string that has to be neutralised. A single escape function over
 * `string | number` would have to choose, and either choice is wrong half the
 * time.
 */
function escapeText(value: string): string {
  const guarded =
    value.length > 0 && FORMULA_LEADERS.has(value[0]) ? `'${value}` : value;

  return NEEDS_QUOTING.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    // Not `String(value)` for a non-finite number: `NaN` or `Infinity` in a money
    // column is a bug upstream, and writing the word into a financial export
    // hides it inside a file someone will sum. An empty cell is visibly missing.
    return Number.isFinite(value) ? String(value) : '';
  }
  return escapeText(value);
}

/**
 * Builds a complete CSV document from a header row and data rows.
 *
 * The leading U+FEFF is a UTF-8 byte-order mark. It is there for exactly one
 * reason: Excel on Windows decodes a BOM-less file using the system ANSI
 * codepage, so a Pakistani customer name in Urdu — or any name with an accent —
 * arrives as mojibake. Every other consumer tolerates the BOM; Excel is the one
 * that needs it.
 *
 * A trailing CRLF closes the final record, which is what tools that count records
 * by line terminator expect.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): string {
  const lines = [
    header.map(cell).join(','),
    ...rows.map((row) => row.map(cell).join(',')),
  ];
  return `${BOM}${lines.join(CRLF)}${CRLF}`;
}

/**
 * Formats integer minor units as a decimal string with exactly two places —
 * `299900` becomes `"2999.00"`.
 *
 * A spreadsheet column of paisa is not what anyone opening the file wants to read
 * or sum, so the export speaks rupees. The conversion is done on the digits with
 * integer division and never `value / 100`, because a float divide reintroduces
 * in the export precisely the imprecision that storing integers removed from the
 * database — and an export is the artefact most likely to be summed and quoted as
 * authoritative.
 *
 * Returns a `string` rather than a `number` so the trailing zeros survive —
 * `2999.00`, not `2999`. Callers writing a CSV cell should use `csvMoney` instead,
 * for the reason given there; this function is the digit conversion on its own, so
 * it is also usable anywhere a fixed-point text amount is wanted.
 */
export function formatMinorUnits(minor: number): string {
  if (!Number.isFinite(minor)) return '';
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const digits = `${whole}.${String(fraction).padStart(2, '0')}`;
  return negative ? `-${digits}` : digits;
}

/**
 * A money cell for a CSV row.
 *
 * `formatMinorUnits` can return a leading `-`, which `escapeText` would prefix
 * with an apostrophe and thereby turn a negative margin into text the spreadsheet
 * cannot sum. Wrapping the digits in `Number` hands `cell()` a number, which
 * skips the formula guard — safe because the value came from an integer column
 * and this function, not from user input.
 *
 * The `Number` round-trip is exact: the string has at most two decimal places and
 * a magnitude under 2^31/100, well inside the range where a double represents
 * hundredths without loss.
 */
export function csvMoney(minor: number): CsvValue {
  const text = formatMinorUnits(minor);
  return text === '' ? null : Number(text);
}

/** An ISO timestamp trimmed to the date, or an empty cell. Spreadsheets parse it. */
export function csvDate(value: Date | string | null): CsvValue {
  if (value === null) return null;
  const iso = typeof value === 'string' ? value : value.toISOString();
  return iso.slice(0, 10);
}

/**
 * A `Content-Disposition` value that names the download.
 *
 * The filename is built from a fixed report slug and a date, never from user
 * input, so there is nothing here to escape — which is the point of building it
 * in one place instead of at each call site.
 */
export function csvAttachment(slug: string, isoDate: string): string {
  return `attachment; filename="${slug}-${isoDate.slice(0, 10)}.csv"`;
}
