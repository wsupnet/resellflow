/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, and
 * commas/newlines inside quotes. Returns an array of rows (array of strings). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += c;
      i++;
    }
  }
  // last field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Spreadsheet apps (Excel, Sheets, Numbers) run any cell starting with one of these
// as a formula — e.g. an item title like =HYPERLINK(...) that came from an import
// or a barcode lookup. Exports prefix such text with ' so it shows as plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

/** Text safe to put in an exported CSV cell (numbers pass through untouched). */
export function neutralizeFormula(v: string): string {
  return FORMULA_START.test(v) ? `'${v}` : v;
}

/** Undo neutralizeFormula, so a ResellFlow export re-imports with its original text. */
function restoreFormulaText(v: string): string {
  return v.startsWith("'") && FORMULA_START.test(v.slice(1)) ? v.slice(1) : v;
}

/** Parse with the first row as headers → array of {header: value} objects. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = restoreFormulaText((r[idx] ?? "").trim())));
    return obj;
  });
}
