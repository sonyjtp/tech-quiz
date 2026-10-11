import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Study Quiz",
  description: "Quiz yourself on what you're learning, with AI-generated questions and grading.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Study Quiz</Link>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
