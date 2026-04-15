/** Parsed fields: empty string when unknown; amount is numeric-only when set. */

export const RECEIPT_CATEGORIES = [
  "Food",
  "Transport",
  "Shopping",
  "Software",
  "Business",
  "Utilities",
  "Other",
] as const;

export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

export type ParsedReceiptFields = {
  date: string;
  vendor: string;
  category: ReceiptCategory;
  amount: number | null;
  description: string;
  payment_method: string;
};

const CATEGORY_RULES: { cat: ReceiptCategory; words: string[] }[] = [
  {
    cat: "Food",
    words: [
      "restaurant",
      "cafe",
      "coffee",
      "grocery",
      "pizza",
      "burger",
      "bakery",
      "starbucks",
      "mcdonald",
      "subway",
      "food",
      "dining",
      "kitchen",
    ],
  },
  {
    cat: "Transport",
    words: [
      "uber",
      "lyft",
      "taxi",
      "cab",
      "parking",
      "metro",
      "transit",
      "fuel",
      "gas",
      "shell",
      "chevron",
      "exxon",
      "highway",
      "toll",
    ],
  },
  {
    cat: "Shopping",
    words: [
      "amazon",
      "target",
      "walmart",
      "costco",
      "mall",
      "retail",
      "boutique",
      "market",
    ],
  },
  {
    cat: "Software",
    words: [
      "adobe",
      "github",
      "subscription",
      "saas",
      "software",
      "license",
      "cloud",
      "hosting",
      "cursor",
      "openai",
    ],
  },
  {
    cat: "Business",
    words: [
      "office",
      "staples",
      "fedex",
      "ups",
      "dhl",
      "shipping",
      "printing",
      "supplies",
      "cowork",
    ],
  },
  {
    cat: "Utilities",
    words: [
      "electric",
      "utility",
      "water",
      "internet",
      "broadband",
      "comcast",
      "verizon",
      "at&t",
      "power",
      "sewer",
    ],
  },
];

function normalizeCategoryFromText(text: string): ReceiptCategory {
  const lower = text.toLowerCase();
  for (const { cat, words } of CATEGORY_RULES) {
    if (words.some((w) => lower.includes(w))) return cat;
  }
  return "Other";
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const DEFAULT_RECEIPT_YEAR = 2026;

function enforceReceiptYearPolicy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return `${DEFAULT_RECEIPT_YEAR}-01-01`;
  let y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);

  if (y < DEFAULT_RECEIPT_YEAR) y = DEFAULT_RECEIPT_YEAR;

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(today.getDate()).padStart(2, "0")}`;
  const candidate = validYmd(y, mo, d);
  if (!candidate) return `${DEFAULT_RECEIPT_YEAR}-01-01`;

  // If the parsed date is in the future, force the year to 2027.
  if (candidate > todayIso) {
    const future = validYmd(2027, mo, d);
    if (future) return future;
    return "2027-01-01";
  }

  return candidate;
}

/** Singapore format: day first for numeric dates. */
function interpretSingaporeDmy(day: number, month: number, year: number): string[] {
  const iso = validYmd(year, month, day);
  return iso ? [iso] : [];
}

type DateHit = { iso: string; score: number };

function scoreDateLine(line: string): number {
  const l = line.toLowerCase();
  let s = 0;
  if (
    /receipt|transaction|purchase|order\s*date|sale\s*date|date\s*[:/]|printed|발행|거래|승인|결제|매출|영수증/.test(
      l
    )
  )
    s += 45;
  if (/^\s*date\s*[:/]/i.test(line)) s += 35;
  if (/expir|유효기간|birth|dob|member\s*since/.test(l)) s -= 40;
  return s;
}

function addHits(hits: DateHit[], isos: string[], score: number) {
  for (const iso of isos) hits.push({ iso, score });
}

function extractDate(text: string): string {
  const lines = text.split(/\r?\n/);
  const hits: DateHit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineScore = scoreDateLine(line) + Math.min(i, 20) * 0.5;

    // YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD (common on receipts)
    let m: RegExpExecArray | null;
    const reYmd = /\b(20\d{2}|19\d{2})[\s./-](\d{1,2})[\s./-](\d{1,2})\b/g;
    while ((m = reYmd.exec(line)) !== null) {
      const y = parseInt(m[1], 10);
      const a = parseInt(m[2], 10);
      const b = parseInt(m[3], 10);
      const iso = validYmd(y, a, b);
      if (iso) addHits(hits, [iso], lineScore + 25);
    }

    // Numeric dates interpreted as Singapore format (DD/MM/YYYY or DD-MM-YY).
    const reDmy = /\b(\d{1,2})[\s./-](\d{1,2})[\s./-](\d{4}|\d{2})\b/g;
    while ((m = reDmy.exec(line)) !== null) {
      let y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const candidates = interpretSingaporeDmy(day, month, y);
      addHits(hits, candidates, lineScore + 20);
    }

    // Missing year (DD/MM or DD-MM): default to 2026.
    const reDmyNoYear = /\b(\d{1,2})[\s./-](\d{1,2})\b/g;
    while ((m = reDmyNoYear.exec(line)) !== null) {
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const candidates = interpretSingaporeDmy(day, month, DEFAULT_RECEIPT_YEAR);
      addHits(hits, candidates, lineScore + 8);
    }

    // Korean: 2024년 3월 15일 / 24. 3. 15
    const reKr = /(\d{4}|\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
    while ((m = reKr.exec(line)) !== null) {
      let y = parseInt(m[1], 10);
      if (y < 100) y += y >= 70 ? 1900 : 2000;
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      const iso = validYmd(y, mo, d);
      if (iso) addHits(hits, [iso], lineScore + 30);
    }

    // 15-MAR-2024, Mar 15, 2024, March 15 2024
    const reMonFirst =
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d{2}|19\d{2}|\d{2})\b/gi;
    while ((m = reMonFirst.exec(line)) !== null) {
      const mon = MONTH_MAP[m[1].toLowerCase().slice(0, 3)];
      if (!mon) continue;
      const d = parseInt(m[2], 10);
      let y = parseInt(m[3], 10);
      if (y < 100) y += y >= 70 ? 1900 : 2000;
      const iso = validYmd(y, mon, d);
      if (iso) addHits(hits, [iso], lineScore + 22);
    }

    const reDayMon =
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?\s*(20\d{2}|19\d{2}|\d{2})\b/gi;
    while ((m = reDayMon.exec(line)) !== null) {
      const d = parseInt(m[1], 10);
      const mon = MONTH_MAP[m[2].toLowerCase().slice(0, 3)];
      if (!mon) continue;
      let y = parseInt(m[3], 10);
      if (y < 100) y += y >= 70 ? 1900 : 2000;
      const iso = validYmd(y, mon, d);
      if (iso) addHits(hits, [iso], lineScore + 22);
    }

    // Compact YYYYMMDD
    const reCompact = /\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g;
    while ((m = reCompact.exec(line)) !== null) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      const iso = validYmd(y, mo, d);
      if (iso) addHits(hits, [iso], lineScore + 15);
    }
  }

  // Whole-text pass (OCR sometimes merges lines)
  const flat = text.replace(/\s+/g, " ");
  const reYmdGlobal =
    /\b(20\d{2}|19\d{2})[\s./-](\d{1,2})[\s./-](\d{1,2})\b/g;
  let gm: RegExpExecArray | null;
  while ((gm = reYmdGlobal.exec(flat)) !== null) {
    const y = parseInt(gm[1], 10);
    const a = parseInt(gm[2], 10);
    const b = parseInt(gm[3], 10);
    const iso = validYmd(y, a, b);
    if (iso) addHits(hits, [iso], 5);
  }

  if (!hits.length) return `${DEFAULT_RECEIPT_YEAR}-01-01`;

  const bestByIso = new Map<string, number>();
  for (const h of hits) {
    const prev = bestByIso.get(h.iso);
    if (prev == null || h.score > prev) bestByIso.set(h.iso, h.score);
  }
  const merged = [...bestByIso.entries()].map(([iso, score]) => ({
    iso,
    score,
  }));
  merged.sort((a, b) => b.score - a.score);
  return enforceReceiptYearPolicy(merged[0].iso);
}

function extractPaymentMethod(text: string): string {
  const m = text.match(
    /\b(visa|mastercard|master card|amex|american express|discover|diners|debit|credit card|credit|cash|apple pay|google pay|paypal|venmo|zelle|nets|paynow|grabpay)\b/i
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

/** Remove common date fragments so years are not parsed as currency. */
function maskDatesForMoneyParse(line: string): string {
  return line
    .replace(/\b(20\d{2}|19\d{2})[./-]\d{1,2}[./-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-](20\d{2}|19\d{2}|\d{2})\b/g, " ")
    .replace(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g, " ");
}

/** Money on a line: S$/SGD (Singapore), $/USD, €, £, ₩/원, etc. */
function extractMoneySequenceFromLine(line: string): number[] {
  const amounts: number[] = [];
  const seen = new Set<number>();

  const push = (n: number) => {
    if (!Number.isFinite(n) || n <= 0 || n >= 1e10) return;
    const r = Math.round(n * 100) / 100;
    if (!seen.has(r)) {
      seen.add(r);
      amounts.push(r);
    }
  };

  const safeLine = maskDatesForMoneyParse(line);

  const wonRe = /([\d]{1,3}(?:,\d{3})+|\d+)\s*원/gi;
  let wm: RegExpExecArray | null;
  while ((wm = wonRe.exec(safeLine)) !== null) {
    push(parseFloat(wm[1].replace(/,/g, "")));
  }

  const suffixSgd =
    /\b([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})\s*(?:SGD|S\$)\b/gi;
  let sm: RegExpExecArray | null;
  while ((sm = suffixSgd.exec(safeLine)) !== null) {
    push(parseFloat(sm[1].replace(/,/g, "")));
  }

  const westernRe =
    /(?:S\$|SGD|SG\$|₩|KRW|\$|USD|US\$|EUR|£|GBP)?\s*([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})\b/gi;
  let vm: RegExpExecArray | null;
  while ((vm = westernRe.exec(safeLine)) !== null) {
    const raw = vm[1].replace(/,/g, "");
    const n = parseFloat(raw);
    const near = safeLine.slice(Math.max(0, vm.index - 1), vm.index + raw.length + 1);
    const hasCurrency =
      /S\$|SGD|SG\$|[$₩£€]|USD|US\$|KRW|EUR|GBP/i.test(near);
    if (!hasCurrency && !raw.includes(".") && n > 0 && n < 10) continue;
    if (!hasCurrency && !raw.includes(".") && n >= 1900 && n <= 2100) continue;
    push(n);
  }

  const plainInt = /\b(\d{3,})\b/g;
  let im: RegExpExecArray | null;
  while ((im = plainInt.exec(safeLine)) !== null) {
    const raw = im[1];
    // Singapore postal code pattern (6 digits) should never be treated as money.
    if (/^\d{6}$/.test(raw)) continue;
    const n = parseInt(raw, 10);
    if (n >= 100 && n < 1e9) push(n);
  }

  return amounts;
}

type LineKind =
  | "strong_total"
  | "medium_total"
  | "weak_amount"
  | "exclude"
  | "other";

function classifyAmountLine(line: string): LineKind {
  const l = line.toLowerCase().replace(/\s+/g, " ");

  // 1) Hard excludes: unwanted / intermediate values.
  if (
    /\bsub\s*total\b|\bsubtotal\b|\bnet\s*subtotal\b|\bitem\s*total\b|\bitems\s*total\b|\b소계\b|\b중간\s*합계\b|\bdiscount\b|\bpromo\b|\bvoucher\b|\bcoupon\b|\boff\b|\brounding\b|\bround\s*off\b|\btip\b|\bgratuity\b|\bchange\b|\bcash\s*back\b|\bdeposit\b|\bpre[\s-]*auth\b|\bauth(orization)?\b|\bapproval\b|\bpoints?\b|\breward\b/i.test(
      l
    )
  ) {
    return "exclude";
  }

  if (/\b(tax|vat|gst|hst|pst|service\s*charge|svc|부가세|세금)\b/i.test(l))
    return "exclude";

  // 2) Strong keywords (highest confidence).
  if (
    /\b(total|grand\s*total|total\s*due|amount\s*due|balance\s*due|amount\s*payable|net\s*amount|final\s*total|total\s*payable|total\s*to\s*pay)\b/i.test(
      l
    )
  ) {
    return "strong_total";
  }

  // 3) Medium keywords.
  if (/\b(total\s*amount|to\s*pay|payable)\b/i.test(l)) return "medium_total";

  // 4) Weak candidates.
  if (/\b(amount|amount\s*paid)\b/i.test(l)) return "weak_amount";

  return "other";
}

function isAddressLikeLine(line: string): boolean {
  const l = line.toLowerCase().replace(/\s+/g, " ").trim();
  if (!l) return false;
  if (
    /\b(road|rd|street|st|avenue|ave|drive|dr|lane|ln|boulevard|blvd|building|tower|unit|blk|block|level|#\d|singapore)\b/i.test(
      l
    )
  ) {
    return true;
  }
  if (/\b\d{6}\b/.test(l) && /\bsingapore\b/i.test(l)) return true;
  if (/^\d{1,4}\s+[a-z]/i.test(l) && /\b(road|street|avenue|drive|lane)\b/i.test(l))
    return true;
  return false;
}

function hasPaymentContext(line: string): boolean {
  const l = line.toLowerCase();
  return /\b(total|amount|payable|to\s*pay|due|balance|paid|payment|net)\b/i.test(
    l
  );
}

function hasRealisticPriceSignal(line: string): boolean {
  return /\d+\.\d{2}\b/.test(line) || /S\$|SGD|SG\$|[$₩£€]|USD|US\$|KRW|EUR|GBP/i.test(line);
}

function isReasonableFinalAmount(n: number): boolean {
  // Reject very tiny values (typical tax/service fragments).
  if (!Number.isFinite(n) || n < 0.5) return false;
  // Reject unrealistically large OCR noise.
  if (n > 1_000_000) return false;
  return true;
}

function extractAmount(text: string): number | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  type Candidate = {
    value: number;
    kind: LineKind;
    index: number;
    line: string;
  };
  const candidates: Candidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isAddressLikeLine(line)) continue;
    const values = extractMoneySequenceFromLine(line);
    if (!values.length) continue;

    // Prefer the right-most amount on the line (usually the payable figure).
    const rightMost = values[values.length - 1];
    const kind = classifyAmountLine(line);
    if (kind === "exclude") continue;
    if (!isReasonableFinalAmount(rightMost)) continue;
    if (!hasPaymentContext(line) && !hasRealisticPriceSignal(line)) continue;

    candidates.push({
      value: rightMost,
      kind,
      index: i,
      line,
    });
  }

  const lineCount = lines.length;
  const bottomWeight = (index: number) =>
    (index / Math.max(lineCount - 1, 1)) * 30;
  const byBottomThenLast = (a: Candidate, b: Candidate) =>
    bottomWeight(b.index) - bottomWeight(a.index) || b.index - a.index;

  // 7.a) Strong keyword match (TOTAL-related).
  const strong = candidates
    .filter((c) => c.kind === "strong_total")
    .sort(byBottomThenLast);
  if (strong.length) {
    // 5) If multiple TOTAL entries exist, choose the last occurrence near bottom.
    return Math.round(strong[0].value * 100) / 100;
  }

  // 7.b) Last occurrence of TOTAL in document (label-safe fallback).
  const totalish = candidates
    .filter((c) => /\btotal\b/i.test(c.line))
    .sort((a, b) => b.index - a.index);
  if (totalish.length) {
    return Math.round(totalish[0].value * 100) / 100;
  }

  // Medium then weak, with bottom preference.
  const medium = candidates
    .filter((c) => c.kind === "medium_total")
    .sort(byBottomThenLast);
  if (medium.length) return Math.round(medium[0].value * 100) / 100;

  const weak = candidates
    .filter((c) => c.kind === "weak_amount")
    .sort(byBottomThenLast);
  if (weak.length) return Math.round(weak[0].value * 100) / 100;

  // 7.c) Largest reasonable numeric value.
  const reasonable = candidates
    .filter((c) => c.kind === "other")
    .map((c) => c.value)
    .filter(isReasonableFinalAmount);
  if (reasonable.length) {
    return Math.round(Math.max(...reasonable) * 100) / 100;
  }

  // 7.d) OCR fallback if nothing matches.
  const all = lines
    .flatMap((line) => extractMoneySequenceFromLine(line))
    .filter(isReasonableFinalAmount);
  if (!all.length) return null;
  return Math.round(Math.max(...all) * 100) / 100;
}

function extractVendor(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const skip =
    /^(tel|phone|fax|www\.|http|receipt|invoice|date|time|thank)/i;
  for (const line of lines.slice(0, 8)) {
    if (line.length < 2 || line.length > 80) continue;
    if (skip.test(line)) continue;
    if (/^\d+[\d\s\-().]+$/.test(line)) continue;
    return line.slice(0, 120);
  }
  return "";
}

function shortName(input: string): string {
  const cleaned = input
    .replace(/\b(pte|ltd|inc|llc|co|company|store|branch)\b/gi, "")
    .replace(/[^\p{L}\p{N}\s&/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.slice(0, 36).trim();
}

function extractItemName(text: string, vendor: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const skip =
    /\b(total|subtotal|tax|gst|service|amount|paid|receipt|invoice|date|time|thank|change|cash|visa|master|payment)\b/i;
  for (const line of lines.slice(1, 16)) {
    if (line === vendor) continue;
    if (line.length < 2 || line.length > 48) continue;
    if (skip.test(line)) continue;
    if (/\d{2,}/.test(line) && !/[a-z]/i.test(line)) continue;
    const item = shortName(line);
    if (item) return item;
  }
  return "";
}

function extractDescription(
  text: string,
  vendor: string,
  category: ReceiptCategory
): string {
  const place = shortName(vendor) || "Receipt";
  if (category === "Food") {
    return `${place} Meeting`;
  }

  const item = extractItemName(text, vendor);
  if (item) return `${item} for class`;
  return `${place} for class`;
}

export function parseReceiptFromText(rawText: string): ParsedReceiptFields {
  const text = rawText.trim();
  if (!text) {
    return {
      date: "",
      vendor: "",
      category: "Other",
      amount: null,
      description: "",
      payment_method: "",
    };
  }
  const vendor = extractVendor(text);
  const date = extractDate(text);
  const payment_method = extractPaymentMethod(text);
  const amount = extractAmount(text);
  const category = normalizeCategoryFromText(text);
  const description = extractDescription(text, vendor, category);
  return {
    date,
    vendor,
    category,
    amount,
    description,
    payment_method,
  };
}
