"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Md } from "./Md";
import type { QuestionRow, Scoreboard as Data, ScoreRow } from "@/lib/scoreboard";
import { TYPE_LABELS } from "@/lib/types";

type SortKey = "name" | "topic" | "correct" | "wrong" | "completed" | "last";
const COLUMNS: { key: SortKey; label: string; num?: boolean; title?: string }[] = [
  { key: "name", label: "Name" },
  { key: "topic", label: "Topic" },
  { key: "correct", label: "Correct", num: true, title: "Attempts graded fully correct" },
  { key: "wrong", label: "Wrong", num: true, title: "Attempts graded incorrect, plus Show answer" },
  { key: "completed", label: "% completed", num: true, title: "Saved questions in the topic answered at least once" },
  { key: "last", label: "Last attempted", num: true },
];

const pct = (r: ScoreRow) => (r.total ? r.answered / r.total : 0);
const rowKey = (r: ScoreRow) => `${r.userId}|${r.subject}/${r.topic}`;

const COMPARE: Record<SortKey, (a: ScoreRow, b: ScoreRow) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  topic: (a, b) => a.subjectName.localeCompare(b.subjectName) || a.topicName.localeCompare(b.topicName),
  correct: (a, b) => a.correct - b.correct,
  wrong: (a, b) => a.wrong - b.wrong,
  completed: (a, b) => pct(a) - pct(b),
  last: (a, b) => (a.lastAttemptedAt ?? "").localeCompare(b.lastAttemptedAt ?? ""),
};

export function Scoreboard({ data, me }: { data: Data; me: number }) {
  const [person, setPerson] = useState<string>("all");
  const [subject, setSubject] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "last", desc: true });
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = data.rows.filter(
      (r) =>
        r.attempts > 0 &&
        (person === "all" || String(r.userId) === person) &&
        (subject === "all" || r.subject === subject),
    );
    const cmp = COMPARE[sort.key];
    // Tie-break so the order is stable: newest first, then name and topic.
    return list.sort(
      (a, b) => (sort.desc ? -cmp(a, b) : cmp(a, b)) || COMPARE.last(b, a) || COMPARE.name(a, b) || COMPARE.topic(a, b),
    );
  }, [data.rows, person, subject, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" && key !== "topic" }));

  if (!data.users.length) {
    return (
      <div className="card">
        <p className="muted">Nobody has answered a question yet. Finish a quiz and your scores show up here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="filters">
        <label>
          <span className="field-label">Name</span>
          <select value={person} onChange={(e) => { setPerson(e.target.value); setOpen(null); }}>
            <option value="all">Everyone</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}{u.id === me ? " (you)" : ""}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Subject</span>
          <select value={subject} onChange={(e) => { setSubject(e.target.value); setOpen(null); }}>
            <option value="all">All subjects</option>
            {data.subjects.map((s) => (
              <option key={s.slug} value={s.slug}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">
        Only topics with at least one attempt are listed. Click a row to see every question in the topic.
      </p>

      <div className="card table-card">
        <table className="scoreboard">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={c.num ? "num" : undefined}
                  title={c.title}
                  aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}
                >
                  <button type="button" className="sort" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    <span className="sort-mark" aria-hidden>{sort.key === c.key ? (sort.desc ? "▼" : "▲") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="muted">Nothing here yet for these filters.</td></tr>
            )}
            {rows.map((r) => {
              const key = rowKey(r);
              const expanded = open === key;
              return (
                <Fragment key={key}>
                  <tr
                    className={`score-row${expanded ? " open" : ""}`}
                    onClick={() => setOpen(expanded ? null : key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(expanded ? null : key); }
                    }}
                    tabIndex={0}
                    aria-expanded={expanded}
                  >
                    <td>
                      <span className="caret" aria-hidden>{expanded ? "▾" : "▸"}</span> {r.name}
                      {r.userId === me && <span className="muted small"> (you)</span>}
                    </td>
                    <td>
                      {r.topicName}
                      {subject === "all" && <div className="muted small">{r.subjectName}</div>}
                    </td>
                    <td className="num">
                      {r.correct}
                      {r.partial > 0 && <div className="muted small" title="Partly correct attempts">+{r.partial} partly</div>}
                    </td>
                    <td className="num">{r.wrong}</td>
                    <td className="num">
                      {r.total ? <>{Math.round(pct(r) * 100)}%<div className="muted small">{r.answered} of {r.total}</div></> : "—"}
                    </td>
                    <td className="num" suppressHydrationWarning title={r.lastAttemptedAt ? new Date(r.lastAttemptedAt).toLocaleString() : undefined}>
                      {r.lastAttemptedAt ? timeAgo(r.lastAttemptedAt) : <span className="muted">Never</span>}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="drill">
                      <td colSpan={COLUMNS.length}>
                        <TopicQuestions row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

type TopicData = { questions: QuestionRow[]; aiAttempts: number; removedAttempts: number };

function TopicQuestions({ row }: { row: ScoreRow }) {
  const [data, setData] = useState<TopicData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const qs = new URLSearchParams({ userId: String(row.userId), subject: row.subject, topic: row.topic });
    fetch(`/api/scoreboard/topic?${qs}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (res.status === 401) window.location.assign("/login?next=/scoreboard");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        setData(body as TopicData);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [row.userId, row.subject, row.topic]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted small">Loading questions…</p>;
  if (!data.questions.length) return <p className="muted small">This topic&apos;s file has no saved questions.</p>;

  return (
    <div className="drill-body">
      <table className="question-stats">
        <thead>
          <tr>
            <th>#</th>
            <th>Question</th>
            <th className="num" title="Times this person answered it">Attempted</th>
            <th className="num" title="Times graded fully correct">Got it right</th>
            <th className="num">Last</th>
          </tr>
        </thead>
        <tbody>
          {data.questions.map((q, i) => (
            <tr key={q.id} className={q.attempts === 0 ? "untouched" : undefined}>
              <td className="muted">{i + 1}</td>
              <td>
                <div className="md-inline"><Md>{q.preview}</Md></div>
                <span className={`chip diff-${q.difficulty}`}>{q.difficulty}</span>{" "}
                <span className="chip">{TYPE_LABELS[q.type]}</span>
              </td>
              <td className="num">{q.attempts}</td>
              <td className="num">
                {q.correct}
                {q.partial > 0 && <div className="muted small">+{q.partial} partly</div>}
              </td>
              <td className="num muted small">{q.lastAttemptedAt ? timeAgo(q.lastAttemptedAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(data.aiAttempts > 0 || data.removedAttempts > 0) && (
        <p className="muted small">
          Not listed:{" "}
          {[
            data.aiAttempts > 0 && `${data.aiAttempts} attempt${data.aiAttempts === 1 ? "" : "s"} on AI-generated questions`,
            data.removedAttempts > 0 && `${data.removedAttempts} on questions since edited or removed from the file`,
          ].filter(Boolean).join("; ")}
          . They still count toward Correct and Wrong above.
        </p>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const units: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [604800, "week"], [2629800, "month"], [31557600, "year"]];
  let [size, name] = units[0];
  for (const u of units) if (secs >= u[0]) [size, name] = u;
  const n = Math.floor(secs / size);
  return `${n} ${name}${n === 1 ? "" : "s"} ago`;
}
