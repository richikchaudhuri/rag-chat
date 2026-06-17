import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Geist (sans) for UI text, Geist Mono for scores / page tags / chunk metadata —
// the monospace gives the glass-box panel its precise "instrument readout" feel.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DocLens — chat with your documents, audit every answer",
  description:
    "Upload PDFs or text and ask questions in plain English. Every answer is grounded in your documents, cited to the exact page, and backed by an inspectable view of the passages it was built from.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
