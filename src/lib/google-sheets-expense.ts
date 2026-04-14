import { google } from "googleapis";

const HEADER_ROW = [
  "Date",
  "Vendor",
  "Category",
  "Amount",
  "Description",
  "Payment Method",
  "Receipt Link",
] as const;

/** Thrown when GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI is missing. */
export const ERROR_MISSING_OAUTH_CONFIG = "MISSING_OAUTH_CONFIG";

/** Thrown when GOOGLE_REFRESH_TOKEN is missing (or empty). */
export const ERROR_MISSING_REFRESH_TOKEN = "MISSING_REFRESH_TOKEN";

/** Sheet titles can include single quotes; ranges must escape them as ''. */
export function sheetRangeA1(title: string, range: string): string {
  const safe = title.replace(/'/g, "''");
  return `'${safe}'!${range}`;
}

/**
 * Expects ISO dates (YYYY-MM-DD) or strings parseable by Date.
 */
export function extractYearFromDate(dateStr: string): string | null {
  const t = dateStr.trim();
  if (!t) return null;
  const iso = t.match(/^(\d{4})-\d{2}-\d{2}/);
  if (iso) return iso[1];
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
  return null;
}

/**
 * OAuth2 client + Sheets API. Uses a long-lived refresh token (no service account).
 * Access tokens are obtained automatically on each request.
 */
function getSheetsClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(ERROR_MISSING_OAUTH_CONFIG);
  }

  if (!refreshToken) {
    throw new Error(ERROR_MISSING_REFRESH_TOKEN);
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.sheets({ version: "v4", auth: oauth2Client });
}

export type SaveExpenseRowInput = {
  spreadsheetId: string;
  year: string;
  row: [string, string, string, string, string, string, string];
};

/**
 * Ensures a tab named `year` exists (creates it if not), adds headers only when the tab is new, then appends one data row.
 */
export async function saveExpenseToYearSheet(
  input: SaveExpenseRowInput
): Promise<{ createdSheet: boolean }> {
  const sheets = getSheetsClient();

  const { spreadsheetId, year, row } = input;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles =
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) ?? [];
  const exists = titles.includes(year);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: year } } }],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRangeA1(year, "A1:G1"),
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [HEADER_ROW.slice() as string[]],
      },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetRangeA1(year, "A:G"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row],
    },
  });

  return { createdSheet: !exists };
}
