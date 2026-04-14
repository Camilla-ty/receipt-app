import { NextRequest, NextResponse } from "next/server";
import type { ExtractedExpense } from "@/lib/types";
import { parseReceiptFromText } from "@/lib/parse-receipt-ocr";

const MAX_BYTES = 4 * 1024 * 1024;

const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";

type VisionAnnotateResponse = {
  responses?: {
    textAnnotations?: { description?: string }[];
    error?: { message?: string };
  }[];
};

function toExtractedExpense(parsed: {
  date: string;
  vendor: string;
  category: string;
  amount: number | null;
  description: string;
  payment_method: string;
}): ExtractedExpense {
  return {
    date: parsed.date || null,
    vendor: parsed.vendor || null,
    category: parsed.category || null,
    amount: parsed.amount,
    description: parsed.description || null,
    payment_method: parsed.payment_method || null,
  };
}

/** raw_text first; then form fields from ExtractedExpense; then explicit parsed JSON (strings / numeric amount). */
function extractResponse(
  rawText: string,
  parsed: ReturnType<typeof parseReceiptFromText>,
  extraction_note: string
) {
  const ex = toExtractedExpense(parsed);
  return {
    raw_text: rawText,
    extraction_note,
    ...ex,
    date: parsed.date,
    vendor: parsed.vendor,
    category: parsed.category,
    amount: parsed.amount,
    description: parsed.description,
    payment_method: parsed.payment_method,
  };
}

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Image file required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image must be 4MB or smaller" },
      { status: 400 }
    );
  }

  const emptyParsed = (): ReturnType<typeof parseReceiptFromText> => ({
    date: "",
    vendor: "",
    category: "Other",
    amount: null,
    description: "",
    payment_method: "",
  });

  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json(
      extractResponse(
        "",
        emptyParsed(),
        "Add GOOGLE_CLOUD_VISION_API_KEY to .env.local to enable OCR, or fill the form manually."
      )
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  let rawText = "";
  try {
    const res = await fetch(`${VISION_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
          },
        ],
      }),
    });

    const data = (await res.json()) as VisionAnnotateResponse;
    if (!res.ok) {
      console.error("Vision API HTTP error:", res.status, data);
      return NextResponse.json(
        extractResponse(
          "",
          emptyParsed(),
          "Vision API request failed. Check the API key and billing, then try again."
        )
      );
    }

    const err = data.responses?.[0]?.error;
    if (err?.message) {
      console.error("Vision API error:", err.message);
      return NextResponse.json(
        extractResponse("", emptyParsed(), `Vision API: ${err.message}`)
      );
    }

    rawText = data.responses?.[0]?.textAnnotations?.[0]?.description?.trim() ?? "";
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      extractResponse(
        "",
        emptyParsed(),
        "Could not reach Google Vision. Try again."
      )
    );
  }

  const parsed = parseReceiptFromText(rawText);
  const note = rawText
    ? "OCR complete — review parsed fields below."
    : "No text detected on this image. Try a clearer photo or enter details manually.";

  return NextResponse.json(extractResponse(rawText, parsed, note));
}
