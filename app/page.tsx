import Link from "next/link";
import { listSubjects } from "@/lib/content";
import { aiEnabled } from "@/lib/claude";

export default function Home() {
  const subjects = listSubjects();
  return (
    <>
      <h1>What are you studying?</h1>
      <p className="muted">Pick a subject, then choose topics, difficulty and how many questions.</p>

      {!aiEnabled() && (
        <div className="notice">
          AI question generation and AI evaluation are off (manual evaluation still works). Add <code>ANTHROPIC_API_KEY</code> to{" "}
          <code>.env.local</code> and restart to enable them.
        </div>
      )}

      <div className="grid">
        {subjects.map((s) => {
          const count = s.topics.reduce((n, t) => n + t.questions.length, 0);
          return (
            <Link key={s.slug} href={`/${s.slug}`} className="card subject-card">
              <h2>{s.name}</h2>
              <p className="muted small">
                {s.topics.length} topic{s.topics.length === 1 ? "" : "s"} · {count} saved question{count === 1 ? "" : "s"}
              </p>
              <div className="chips">
                {s.topics.map((t) => (
                  <span key={t.slug} className="chip">{t.name}</span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>

      {subjects.length === 0 && (
        <p className="muted">No subjects yet. Add a markdown file at <code>content/&lt;subject&gt;/&lt;topic&gt;.md</code>.</p>
      )}
    </>
  );
}
