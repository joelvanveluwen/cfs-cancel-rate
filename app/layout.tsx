import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coffs Harbour Flight Cancellations",
  description:
    "How often flights between Coffs Harbour and Sydney are cancelled, using official BITRE on-time performance data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="mx-auto max-w-[1180px] px-5 py-6 sm:px-8 sm:py-10">{children}</main>
      </body>
    </html>
  );
}
