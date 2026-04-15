"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtractedExpense, SavedExpense } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

const STORAGE_KEY = "expense-tracker-saved";
function defaultForm(): Record<keyof ExtractedExpense, string> {
  return {
    date: "",
    vendor: "",
    category: "Other",
    amount: "",
    description: "",
    payment_method: "",
  };
}

function applyExtracted(
  prev: ReturnType<typeof defaultForm>,
  e: ExtractedExpense & { extraction_note?: string }
): ReturnType<typeof defaultForm> {
  return {
    ...prev,
    date: e.date ?? "",
    vendor: e.vendor ?? "",
    category: e.category ?? "Other",
    amount: e.amount != null ? String(e.amount) : "",
    description: e.description ?? "",
    payment_method: e.payment_method ?? "",
  };
}

export function ExpenseTracker() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedExpense[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSaved(JSON.parse(raw) as SavedExpense[]);
    } catch {
      /* ignore */
    }
  }, []);

  const revokePreview = useCallback(() => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const resetUpload = useCallback(() => {
    revokePreview();
    setFile(null);
    setPreviewUrl(null);
    setIsLightboxOpen(false);
    setForm(defaultForm());
    if (inputRef.current) inputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, [revokePreview]);

  const onPickFile = async (f: File | null) => {
    if (!f) return;
    revokePreview();
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    setStatus(null);
  };

  const runExtract = async () => {
    if (!file) {
      setStatus("Choose a receipt image first.");
      return;
    }
    setExtracting(true);
    setStatus(null);
    try {
      const body = new FormData();
      body.set("image", file);
      const res = await fetch("/api/extract", { method: "POST", body });
      const data = (await res.json()) as ExtractedExpense & {
        raw_text?: string;
        extraction_note?: string;
        error?: string;
      };
      if (!res.ok && data.error) {
        setStatus(data.error);
        return;
      }
      setForm((prev) => applyExtracted(prev, data));
      if (data.extraction_note) setStatus(data.extraction_note);
      else setStatus("Review the fields below, edit if needed, then save.");
    } catch {
      setStatus("Network error. Try again.");
    } finally {
      setExtracting(false);
    }
  };

  const saveExpense = async () => {
    const amountNum = parseFloat(form.amount.replace(/,/g, ""));
    if (!Number.isFinite(amountNum)) {
      setStatus("Enter a valid amount.");
      return;
    }

    const dateStr = form.date.trim() || new Date().toISOString().slice(0, 10);

    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/save-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: dateStr,
          vendor: form.vendor.trim(),
          category: form.category,
          amount: amountNum,
          description: form.description.trim(),
          payment_method: form.payment_method.trim(),
        }),
      });

      let data: { success?: boolean; error?: string; details?: string } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setStatus("Invalid response from server.");
        return;
      }

      if (!res.ok || !data.success) {
        const base = data.error ?? `Save failed (${res.status})`;
        const msg = data.details ? `${base}: ${data.details}` : base;
        setStatus(msg);
        return;
      }

      const record: SavedExpense = {
        id: crypto.randomUUID(),
        date: dateStr,
        vendor: form.vendor.trim(),
        category: form.category,
        amount: amountNum,
        description: form.description.trim(),
        payment_method: form.payment_method.trim(),
        savedAt: new Date().toISOString(),
      };
      const next = [record, ...saved];
      setSaved(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStatus("Saved to Google Sheets");
      resetUpload();
    } catch {
      setStatus("Network error. Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => () => revokePreview(), [revokePreview]);
  useEffect(() => {
    if (!isLightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsLightboxOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLightboxOpen]);

  const fieldClass =
    "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] dark:bg-neutral-950";

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Upload one receipt, review extracted details, then save.
        </p>
      </header>

      <section className="mb-8 rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm dark:bg-neutral-950">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
        />

        {!file ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border)] py-8 text-sm text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <span className="font-medium text-[var(--foreground)]">
                Upload receipt
              </span>
              <span className="mt-1">PNG, JPG, or WebP</span>
            </button>
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-medium"
            >
              Take photo with camera
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-neutral-100 dark:bg-neutral-900">
                {previewUrl ? (
                  <button
                    type="button"
                    className="h-full w-full cursor-zoom-in"
                    onClick={() => setIsLightboxOpen(true)}
                    aria-label="Open receipt preview"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Receipt preview"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col justify-center gap-2">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={runExtract}
                    disabled={extracting}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {extracting ? "Extracting…" : "Extract from image"}
                  </button>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                  >
                    Replace image
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                  >
                    Retake with camera
                  </button>
                  <button
                    type="button"
                    onClick={resetUpload}
                    className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {status ? (
          <p
            className="mt-4 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
            role="status"
          >
            {status}
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm dark:bg-neutral-950">
        <h2 className="text-sm font-medium text-[var(--muted)]">Details</h2>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--muted)]">Date</span>
          <input
            type="date"
            className={fieldClass}
            value={form.date}
            onChange={(e) =>
              setForm((f) => ({ ...f, date: e.target.value }))
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--muted)]">Vendor</span>
          <input
            type="text"
            className={fieldClass}
            placeholder="Store or merchant name"
            value={form.vendor}
            onChange={(e) =>
              setForm((f) => ({ ...f, vendor: e.target.value }))
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--muted)]">
            Category
          </span>
          <select
            className={fieldClass}
            value={form.category}
            onChange={(e) =>
              setForm((f) => ({ ...f, category: e.target.value }))
            }
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--muted)]">Amount</span>
          <input
            type="text"
            inputMode="decimal"
            className={fieldClass}
            placeholder="0.00"
            value={form.amount}
            onChange={(e) =>
              setForm((f) => ({ ...f, amount: e.target.value }))
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--muted)]">
            Description
          </span>
          <textarea
            className={`${fieldClass} min-h-[80px] resize-y`}
            placeholder="Line items or notes"
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--muted)]">
            Payment method
          </span>
          <input
            type="text"
            className={fieldClass}
            placeholder="Card, cash, mobile pay…"
            value={form.payment_method}
            onChange={(e) =>
              setForm((f) => ({ ...f, payment_method: e.target.value }))
            }
          />
        </label>

        <button
          type="button"
          onClick={() => void saveExpense()}
          disabled={saving}
          className="mt-2 w-full rounded-lg bg-[var(--foreground)] py-2.5 text-sm font-medium text-[var(--background)] disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {saving ? "Saving…" : "Save expense"}
        </button>
      </section>

      {saved.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">
            Saved ({saved.length})
          </h2>
          <ul className="space-y-3">
            {saved.slice(0, 8).map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-[var(--border)] bg-white p-3 text-sm dark:bg-neutral-950"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.vendor || "Expense"} ·{" "}
                    <span className="tabular-nums">{s.amount}</span>
                  </p>
                  <p className="truncate text-[var(--muted)]">
                    {s.date} · {s.category}
                    {s.payment_method ? ` · ${s.payment_method}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isLightboxOpen && previewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={() => setIsLightboxOpen(false)}
          role="presentation"
        >
          <div
            className="relative max-h-full w-full max-w-3xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Receipt image preview"
          >
            <button
              type="button"
              className="absolute right-2 top-2 z-10 rounded-full bg-black/65 px-3 py-1 text-sm text-white"
              onClick={() => setIsLightboxOpen(false)}
            >
              Close
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Receipt full preview"
              className="max-h-[85vh] w-full rounded-xl bg-white object-contain"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
