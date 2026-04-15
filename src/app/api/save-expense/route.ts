import { NextRequest, NextResponse } from "next/server";
import {
  ERROR_MISSING_OAUTH_CONFIG,
  ERROR_MISSING_REFRESH_TOKEN,
  extractYearFromDate,
  saveExpenseToYearSheet,
} from "@/lib/google-sheets-expense";

/** Default spreadsheet when GOOGLE_SHEETS_SPREADSHEET_ID is unset */
const DEFAULT_SPREADSHEET_ID =
  "18mYAX0wScH9AVgn_EC_k_0YVGqiC-Z2CJwqXq8ifwR0";

const FIELDS = [
  "date",
  "vendor",
  "category",
  "amount",
  "description",
  "payment_method",
] as const;

type Body = Record<(typeof FIELDS)[number], unknown>;

function normalizeAmount(amount: unknown): string {
  if (typeof amount === "number" && Number.isFinite(amount)) {
    return String(Math.round(amount * 100) / 100);
  }
  const parsed = parseFloat(String(amount ?? "").replace(/,/g, "").trim());
  if (Number.isFinite(parsed)) {
    return String(Math.round(parsed * 100) / 100);
  }
  return "";
}

function cleanText(value: unknown, max = 120): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const REFRESH_TOKEN_HELP =
  "Create OAuth 2.0 credentials (Web application) in Google Cloud Console, set the redirect URI to match GOOGLE_REDIRECT_URI, then open the OAuth Playground (https://developers.google.com/oauthplayground), use your own OAuth credentials (gear icon), select scope https://www.googleapis.com/auth/spreadsheets, authorize, and exchange the authorization code for tokens. Copy the refresh_token into GOOGLE_REFRESH_TOKEN in .env.local.";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }

  const b = body as Body;
  for (const key of FIELDS) {
    if (!(key in b)) {
      return NextResponse.json({ error: `Missing field: ${key}` }, { status: 400 });
    }
  }

  const date = String(b.date ?? "").trim();
  const vendor = cleanText(b.vendor, 80);
  const category = cleanText(b.category, 40);
  const description = cleanText(b.description, 80);
  const payment_method = cleanText(b.payment_method, 40);

  const year = extractYearFromDate(date);
  if (!year) {
    return NextResponse.json(
      { error: "Could not extract a year from date; use a format like 2026-03-16" },
      { status: 400 }
    );
  }

  const spreadsheetId =
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;

  const row: [
    string,
    string,
    string,
    string,
    string,
    string,
  ] = [
    date,
    vendor,
    category,
    normalizeAmount(b.amount),
    description,
    payment_method,
  ];

  try {
    const { createdSheet } = await saveExpenseToYearSheet({
      spreadsheetId,
      year,
      row,
    });

    return NextResponse.json({
      success: true,
      sheet: year,
      createdSheet,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";

    if (msg === ERROR_MISSING_OAUTH_CONFIG) {
      return NextResponse.json(
        {
          error:
            "OAuth2 is not fully configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env.local (see .env.example).",
        },
        { status: 500 }
      );
    }

    if (msg === ERROR_MISSING_REFRESH_TOKEN) {
      return NextResponse.json(
        {
          error: "GOOGLE_REFRESH_TOKEN is missing.",
          details: REFRESH_TOKEN_HELP,
        },
        { status: 500 }
      );
    }

    console.error("save-expense:", e);
    return NextResponse.json(
      {
        error: "Failed to save to Google Sheets",
        details: msg,
      },
      { status: 500 }
    );
  }
}
