import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Expense tracker",
  description: "Upload receipts and track expenses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
