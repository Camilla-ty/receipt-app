import { RECEIPT_CATEGORIES } from "@/lib/parse-receipt-ocr";

export type ExtractedExpense = {
  date: string | null;
  vendor: string | null;
  category: string | null;
  amount: number | null;
  description: string | null;
  payment_method: string | null;
};

export type SavedExpense = ExtractedExpense & {
  id: string;
  savedAt: string;
};

export const CATEGORIES = RECEIPT_CATEGORIES;
