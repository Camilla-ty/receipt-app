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
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
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

/** Prefer US (m,d) when a>12 or b>12; else try both and keep both candidates. */
function interpretMdY(a: number, b: number, y: number): string[] {
  const out: string[] = [];
  const us = validYmd(y, a, b);
  const eu = validYmd(y, b, a);
  if (a > 12 && eu) out.push(eu);
  else if (b > 12 && us) out.push(us);
  else {
    if (us) out.push(us);
    if (eu && eu !== us) out.push(eu);
  }
  return out;
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

    // DD/MM/YYYY or MM/DD/YYYY (2-digit year also)
    const reDmy = /\b(\d{1,2})[\s./-](\d{1,2})[\s./-](\d{4}|\d{2})\b/g;
    while ((m = reDmy.exec(line)) !== null) {
      let y = parseInt(m[3], 10);
      if (y < 100) y += y >= 70 ? 1900 : 2000;
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const candidates = interpretMdY(a, b, y);
      addHits(hits, candidates, lineScore + 20);
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

  if (!hits.length) return "";

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
  return merged[0].iso;
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
    const n = parseInt(im[1], 10);
    if (n >= 100 && n < 1e9) push(n);
  }

  return amounts;
}

type LineKind = "strong_total" | "weak_total" | "subtotal" | "tax_only" | "other";

function classifyAmountLine(line: string): LineKind {
  const l = line.toLowerCase().replace(/\s+/g, " ");

  if (
    /\bgrand\s*total\b|\btotal\s*due\b|\bamount\s*due\b|\bbalance\s*due\b|\btotal\s*payable\b|\bfinal\s*total\b|\btotal\s*amount\b|\bpayment\s*total\b|\btotal\s*paid\b|\bpaid\s*total\b|\bnet\s*total\b|\bamount\s*payable\b|\bnett?\s*amount\b|\btotal\s*\(?\s*incl(?:uding|usive)?\.?\s*gst\b|\bgst\s*inclusive\s*total\b/i.test(
      line
    )
  ) {
    return "strong_total";
  }

  if (
    /합계|총\s*계|총금액|결제\s*금액|받을\s*금액|청구\s*금액|판매\s*합계|거래\s*금액/.test(
      line
    )
  ) {
    return "strong_total";
  }

  if (/\bsub\s*total\b|\bsubtotal\b|\bnet\s*subtotal\b|\bitem\s*total\b|\bitems\s*total\b|\b소계\b|\b중간\s*합계\b/i.test(line)) {
    return "subtotal";
  }

  if (
    /^\s*(tax|vat|gst|hst|pst|부가세|세금)\b/i.test(l) &&
    !/\btotal\b/i.test(l)
  ) {
    return "tax_only";
  }

  if (
    /\btip\b|\bgratuity\b|\bdiscount\b|\breward\b|\bchange\b|\bcash\s*back\b/i.test(
      line
    ) &&
    !/\btotal\b/i.test(l)
  ) {
    return "tax_only";
  }

  if (
    /\btotal\b/i.test(line) &&
    !/\bsub\s*total\b|\bsubtotal\b/i.test(line)
  ) {
    return "weak_total";
  }

  if (/^total\s*[:=]/i.test(line.trim())) return "weak_total";

  return "other";
}

function extractAmount(text: string): number | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const kinds = lines.map((line) => classifyAmountLine(line));

  type Scored = { value: number; score: number; lineIndex: number };
  const scored: Scored[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const amounts = extractMoneySequenceFromLine(line);
    if (!amounts.length) continue;

    const kind = kinds[i];
    const posWeight = (i / Math.max(lines.length - 1, 1)) * 25;

    let lineScore = posWeight;
    let pick: number;

    switch (kind) {
      case "strong_total":
        lineScore += 120;
        pick = amounts[amounts.length - 1];
        break;
      case "weak_total":
        lineScore += 75;
        pick = amounts[amounts.length - 1];
        break;
      case "subtotal":
        lineScore += 15;
        pick = amounts[amounts.length - 1];
        break;
      case "tax_only":
        lineScore -= 30;
        pick = amounts[amounts.length - 1];
        break;
      default:
        lineScore += 0;
        pick = amounts[amounts.length - 1];
    }

    scored.push({ value: pick, score: lineScore, lineIndex: i });
  }

  const strong = scored.filter(
    (s) =>
      kinds[s.lineIndex] === "strong_total" ||
      kinds[s.lineIndex] === "weak_total"
  );

  if (strong.length) {
    strong.sort((a, b) => b.score - a.score || b.lineIndex - a.lineIndex);
    const best = strong[0].value;
    return Math.round(best * 100) / 100;
  }

  const nonSub = scored.filter((s) => {
    const k = kinds[s.lineIndex];
    return k !== "subtotal" && k !== "tax_only";
  });

  if (nonSub.length) {
    nonSub.sort((a, b) => b.score - a.score || b.lineIndex - a.lineIndex);
    const best = nonSub[0].value;
    return Math.round(best * 100) / 100;
  }

  if (scored.length) {
    const subOnly = scored.every((s) => kinds[s.lineIndex] === "subtotal");
    if (subOnly) {
      scored.sort((a, b) => b.lineIndex - a.lineIndex);
      return Math.round(scored[0].value * 100) / 100;
    }
    scored.sort((a, b) => b.lineIndex - a.lineIndex);
    const tail = scored.slice(0, 5);
    const maxTail = Math.max(...tail.map((t) => t.value));
    return Math.round(maxTail * 100) / 100;
  }

  const allLines = lines.join("\n");
  const all = extractMoneySequenceFromLine(allLines.replace(/\n/g, " "));
  if (!all.length) return null;
  const max = Math.max(...all);
  return Math.round(max * 100) / 100;
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

function extractDescription(text: string, vendor: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== vendor);
  const mid = lines.slice(1, Math.min(6, lines.length)).join(" · ");
  if (mid.length > 240) return `${mid.slice(0, 237)}…`;
  return mid;
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
  const description = extractDescription(text, vendor);
  return {
    date,
    vendor,
    category,
    amount,
    description,
    payment_method,
  };
}
