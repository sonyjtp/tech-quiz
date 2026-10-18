import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Study Quiz",
  description: "Quiz yourself on what you're learning, with AI-generated questions and grading.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Study Quiz</Link>
          {user && (
            <nav className="topnav">
              <Link href="/scoreboard">Scoreboard</Link>
              <span className="muted small" title={`Logged in as ${user.username}`}>{user.displayName}</span>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="link">Log out</button>
              </form>
            </nav>
          )}
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
