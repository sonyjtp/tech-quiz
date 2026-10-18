"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Md } from "./Md";
import {
  SELF_GRADES,
  awaitingSelfGrade,
  gradeLocally,
  isAnswered,
  pointsFor,
  revealed,
  selfGraded,
  shuffle,
  shuffleOptions,
} from "@/lib/scoring";
import { MODELS, MODEL_IDS, estimateCost } from "@/lib/models";
import { ApiError, errorText, post, postJson } from "@/lib/client-api";
import {
  DIFFICULTIES,
  POINTS,
  QUESTION_TYPES,
  TYPE_LABELS,
  type Answer,
  type ChatMessage,
  type Difficulty,
  type Evaluation,
  type GradeResult,
  type Question,
  type QuestionStats,
  type QuestionType,
  type Source,
  type TokenUsage,
  type Topic,
} from "@/lib/types";

/**
 * Read a streamed follow-up reply: reply text, then optionally \u0001 + usage JSON;
 * \u0000 + message if the server failed mid-stream. Calls `onText` as text arrives and
 * throws `ApiError` if the stream reports an error or the reply is empty.
 */
async function readFollowUp(res: Response, onText: (text: string) => void): Promise<{ reply: string; usage?: TokenUsage }> {
  if (!res.body) throw new ApiError("The server sent an empty response.", res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    const err = raw.indexOf("\u0000");
    if (err >= 0) throw new ApiError(raw.slice(err + 1));
    onText(raw.split("\u0001")[0]);
  }
  const [reply, usageJson] = raw.split("\u0001");
  if (!reply.trim()) throw new ApiError("Claude returned an empty reply.");
  return { reply, usage: parseUsage(usageJson) };
}

/** Usage JSON sent after a streamed reply; missing or malformed usage is ignored. */
function parseUsage(json: string | undefined): TokenUsage | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as TokenUsage;
  } catch {
    return undefined;
  }
}

type UsageKind = "generation" | "grading" | "follow-up";
interface UsageEntry {
  kind: UsageKind;
  usage: TokenUsage;
}

type FeedbackMode = "immediate" | "end";

interface Settings {
  topics: string[];
  count: number;
  difficulty: Difficulty | "mixed";
  source: Source;
  evaluation: Evaluation;
  model: string;
  types: QuestionType[];
  feedback: FeedbackMode;
}

type Phase = "setup" | "loading" | "quiz" | "grading" | "results";

export function QuizApp({
  subject,
  topics,
  aiEnabled,
  defaultModel,
}: {
  subject: { slug: string; name: string };
  topics: Topic[];
  aiEnabled: boolean;
  defaultModel: string;
}) {
  const storageKey = `quiz-settings:${subject.slug}`;
  const [settings, setSettings] = useState<Settings>(() => ({
    topics: topics.map((t) => t.slug),
    count: 10,
    difficulty: "mixed",
    source: "file",
    evaluation: aiEnabled ? "ai" : "manual",
    model: defaultModel,
    types: [...QUESTION_TYPES],
    feedback: "immediate",
  }));

  // Remember settings per subject (per-browser convenience only). Validate everything,
  // since saved values may come from an older version of the app. Saving waits until
  // loading is done, or the defaults would overwrite what was stored.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const s = JSON.parse(saved) as Partial<Settings>;
      const known = new Set(topics.map((t) => t.slug));
      setSettings((cur) => {
        const savedTopics = (s.topics ?? []).filter((t) => known.has(t));
        const savedTypes = (s.types ?? []).filter((t) => QUESTION_TYPES.includes(t));
        return {
          topics: savedTopics.length ? savedTopics : cur.topics,
          count: typeof s.count === "number" && s.count >= 1 && s.count <= 30 ? s.count : cur.count,
          difficulty: s.difficulty && ["mixed", ...DIFFICULTIES].includes(s.difficulty) ? s.difficulty : cur.difficulty,
          source: s.source === "ai" && aiEnabled ? "ai" : "file",
          evaluation: s.evaluation === "manual" || !aiEnabled ? "manual" : s.evaluation === "ai" ? "ai" : cur.evaluation,
          model: s.model && MODEL_IDS.includes(s.model) ? s.model : cur.model,
          types: savedTypes.length ? savedTypes : cur.types,
          feedback: s.feedback === "end" ? "end" : "immediate",
        };
      });
    } catch {
    } finally {
      setLoaded(true);
    }
  }, [storageKey, topics, aiEnabled]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {}
  }, [storageKey, settings, loaded]);

  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [results, setResults] = useState<Record<string, GradeResult>>({});
  const [grading, setGrading] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [asking, setAsking] = useState<Set<string>>(new Set());
  const [usageLog, setUsageLog] = useState<UsageEntry[]>([]);
  const [stats, setStats] = useState<Record<string, QuestionStats>>({});
  const [historyError, setHistoryError] = useState<string | null>(null);
  const logUsage = (kind: UsageKind, usage: TokenUsage | undefined) => {
    if (usage) setUsageLog((log) => [...log, { kind, usage }]);
  };
  // Frozen when the quiz starts, so changing settings mid-quiz has no effect.
  const [run, setRun] = useState<Pick<Settings, "feedback" | "evaluation" | "model">>({
    feedback: "immediate",
    evaluation: "manual",
    model: defaultModel,
  });

  const topicName = useMemo(() => Object.fromEntries(topics.map((t) => [t.slug, t.name])), [topics]);
  const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

  const filePool = useMemo(
    () =>
      topics
        .filter((t) => settings.topics.includes(t.slug))
        .flatMap((t) => t.questions)
        .filter((q) => settings.difficulty === "mixed" || q.difficulty === settings.difficulty)
        .filter((q) => settings.types.includes(q.type)),
    [topics, settings.topics, settings.difficulty, settings.types],
  );

  function begin(qs: Question[], initialUsage: UsageEntry[] = []) {
    setQuestions(qs);
    setAnswers({});
    setResults({});
    setGrading(new Set());
    setAttempts({});
    setThreads({});
    setUsageLog(initialUsage);
    loadStats(qs.map((q) => q.id));
    setIndex(0);
    setRun({ feedback: settings.feedback, evaluation: settings.evaluation, model: settings.model });
    setPhase("quiz");
  }

  async function start() {
    setError(null);
    setNotice(null);

    if (settings.source === "file") {
      const picked = shuffle(filePool).slice(0, settings.count);
      if (picked.length === 0) return setError("No saved questions match these topics, difficulty and types.");
      if (picked.length < settings.count) {
        setNotice(`Only ${picked.length} saved questions match your filters, so the quiz is shorter.`);
      }
      return begin(picked.map(shuffleOptions));
    }

    setPhase("loading");
    const failed = (reason: string) => {
      setPhase("setup");
      setError(`Couldn't generate questions: ${reason}`);
    };
    let data: { questions: Question[]; usage?: TokenUsage };
    try {
      data = await postJson("/api/generate", {
        model: settings.model,
        subjectSlug: subject.slug,
        subjectName: subject.name,
        topics: topics
          .filter((t) => settings.topics.includes(t.slug))
          .map(({ slug, name, focus, notes }) => ({ slug, name, focus, notes })),
        count: settings.count,
        difficulty: settings.difficulty,
        types: settings.types,
        avoid: filePool.map((q) => q.prompt.split("\n")[0]).slice(0, 200),
      });
    } catch (e) {
      return failed(errorText(e));
    }
    if (!data.questions?.length) return failed("Claude returned no usable questions. Try again.");
    begin(
      shuffle(data.questions).map(shuffleOptions),
      data.usage ? [{ kind: "generation", usage: data.usage }] : [],
    );
  }

  async function gradeOne(q: Question): Promise<GradeResult> {
    const a = answers[q.id];
    const byKey = gradeLocally(q, a);
    if (byKey) return byKey;
    if (run.evaluation === "manual" || !aiEnabled) return awaitingSelfGrade();
    try {
      const data = await postJson<{ result: GradeResult }>("/api/grade", { model: run.model, question: q, answer: a });
      return data.result;
    } catch (e) {
      return {
        score: 0,
        verdict: "incorrect",
        feedback: `Grading failed: ${errorText(e)}`,
        mistakes: [],
        improvements: [],
        gradedBy: "ai",
        failed: true,
      };
    }
  }

  async function check(q: Question) {
    setGrading((g) => new Set(g).add(q.id));
    const r = await gradeOne(q);
    logUsage("grading", r.usage);
    setResults((cur) => ({ ...cur, [q.id]: r }));
    if (!r.failed && isAnswered(q, answers[q.id])) saveAttempt(q, r);
    setGrading((g) => {
      const n = new Set(g);
      n.delete(q.id);
      return n;
    });
  }

  const selfGrade = (q: Question, score: number) => {
    const r = selfGraded(score);
    setResults((cur) => ({ ...cur, [q.id]: r }));
    saveAttempt(q, r);
  };
  const revealAnswer = (q: Question) => {
    const r = revealed(q);
    setResults((cur) => ({ ...cur, [q.id]: r }));
    saveAttempt(q, r);
  };

  // ------------------------------------------------------------ history (database)

  async function loadStats(ids: string[]) {
    try {
      const data = await postJson<{ stats: Record<string, QuestionStats> }>("/api/stats", { ids });
      setStats(data.stats);
      setHistoryError(null);
    } catch (e) {
      setHistoryError(errorText(e));
    }
  }

  /** Record a final grade. Pending self-grades are recorded once the learner grades them. */
  async function saveAttempt(q: Question, r: GradeResult) {
    if (r.verdict === "pending") return;
    try {
      const data = await postJson<{ stats: QuestionStats }>("/api/attempts", {
        question: { id: q.id, subject: q.subject, topic: q.topic, source: q.source, difficulty: q.difficulty, prompt: q.prompt },
        score: r.score,
        verdict: r.verdict,
        evaluation: run.evaluation,
      });
      setStats((cur) => ({ ...cur, [q.id]: data.stats }));
      setHistoryError(null);
    } catch (e) {
      setHistoryError(`Not saved to history: ${errorText(e)}`);
    }
  }
  const setAnswerFor = (q: Question, a: Answer) => setAnswers((cur) => ({ ...cur, [q.id]: a }));

  /** Ask Claude a follow-up about a graded question; the reply streams into the thread. */
  async function askFollowUp(q: Question, text: string) {
    const prior = threads[q.id] ?? [];
    // Leave out failed exchanges so the conversation sent to Claude stays well-formed.
    const history = prior.filter((m, i) => !m.error && !prior[i + 1]?.error);
    const userMsg: ChatMessage = { role: "user", content: text };
    const update = (reply: ChatMessage) => setThreads((t) => ({ ...t, [q.id]: [...prior, userMsg, reply] }));
    update({ role: "assistant", content: "" });
    setAsking((s) => new Set(s).add(q.id));
    try {
      const res = await post("/api/followup", {
        model: run.model,
        topicName: topicName[q.topic] ?? q.topic,
        question: q,
        answer: answers[q.id] ?? null,
        result: results[q.id],
        messages: [...history, userMsg].map(({ role, content }) => ({ role, content })),
      });
      const { reply, usage } = await readFollowUp(res, (text) => update({ role: "assistant", content: text }));
      update({ role: "assistant", content: reply, usage });
      logUsage("follow-up", usage);
    } catch (e) {
      update({ role: "assistant", content: errorText(e), error: true });
    } finally {
      setAsking((s) => {
        const n = new Set(s);
        n.delete(q.id);
        return n;
      });
    }
  }

  const canFollowUp = (r: GradeResult | undefined) =>
    run.evaluation === "ai" && aiEnabled && Boolean(r) && r!.verdict !== "pending" && !r!.failed;

  /** Discard a question's grade so it can be answered again. The previous answer stays filled in. */
  function tryAgain(q: Question) {
    setResults((cur) => {
      const { [q.id]: _discarded, ...rest } = cur;
      return rest;
    });
    setAttempts((cur) => ({ ...cur, [q.id]: (cur[q.id] ?? 1) + 1 }));
  }

  async function finish() {
    const pending = questions.filter((q) => !results[q.id] || results[q.id].failed);
    if (pending.length) {
      const unanswered = pending.filter((q) => !isAnswered(q, answers[q.id])).length;
      if (unanswered && !confirm(`${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered. Finish anyway?`)) return;
    }
    setPhase("grading");
    // Grade with limited concurrency so a big quiz doesn't hit rate limits.
    const queue = [...pending];
    const workers = Array.from({ length: 4 }, async () => {
      for (let q = queue.shift(); q; q = queue.shift()) await check(q);
    });
    await Promise.all(workers);
    setPhase("results");
    window.scrollTo({ top: 0 });
  }

  function retryMissed() {
    const missed = questions.filter((q) => (results[q.id]?.score ?? 0) < 1);
    begin(shuffle(missed).map(shuffleOptions));
  }

  // ------------------------------------------------------------------ render

  if (phase === "setup" || phase === "loading") {
    const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));
    const toggleTopic = (slug: string) =>
      set("topics", settings.topics.includes(slug) ? settings.topics.filter((t) => t !== slug) : [...settings.topics, slug]);
    const toggleType = (t: QuestionType) =>
      set("types", settings.types.includes(t) ? settings.types.filter((x) => x !== t) : [...settings.types, t]);
    const usesAi = settings.source === "ai" || settings.evaluation === "ai";
    const canStart = settings.topics.length > 0 && settings.types.length > 0 && settings.count > 0 && phase === "setup";

    return (
      <div className="setup">
        <h1>{subject.name} quiz</h1>

        <section className="card">
          <div className="row-between">
            <h2>Topics</h2>
            <div className="links">
              <button className="link" onClick={() => set("topics", topics.map((t) => t.slug))}>All</button>
              <button className="link" onClick={() => set("topics", [])}>None</button>
            </div>
          </div>
          <div className="topic-list">
            {topics.map((t) => (
              <label key={t.slug} className={`option ${settings.topics.includes(t.slug) ? "on" : ""}`}>
                <input type="checkbox" checked={settings.topics.includes(t.slug)} onChange={() => toggleTopic(t.slug)} />
                <span className="grow">{t.name}</span>
                <span className="muted small">{t.questions.length} saved</span>
              </label>
            ))}
          </div>
        </section>

        <section className="card settings">
          <Field
            label="Questions come from"
            hint={
              settings.source === "file"
                ? `${filePool.length} saved question${filePool.length === 1 ? "" : "s"} match your filters. Answers come from your markdown files.`
                : "Claude writes new questions, each with its own answer key."
            }
          >
            <div className="seg">
              <button className={settings.source === "file" ? "on" : ""} onClick={() => set("source", "file")}>My markdown files</button>
              <button className={settings.source === "ai" ? "on" : ""} disabled={!aiEnabled} onClick={() => set("source", "ai")}>AI-generated</button>
            </div>
          </Field>

          <Field
            label="Evaluation"
            hint={
              settings.evaluation === "ai"
                ? "Claude grades written answers against the answer key, then points out mistakes and how to improve."
                : "You compare written answers with the answer key and grade yourself."
            }
          >
            <div className="seg">
              <button className={settings.evaluation === "manual" ? "on" : ""} onClick={() => set("evaluation", "manual")}>Manual</button>
              <button className={settings.evaluation === "ai" ? "on" : ""} disabled={!aiEnabled} onClick={() => set("evaluation", "ai")}>AI</button>
            </div>
            <div className="muted small">Multiple-choice and exact short answers are always checked against the key automatically.</div>
          </Field>

          <Field label="Claude model" hint={usesAi ? MODELS.find((m) => m.id === settings.model)?.note : "Not used: files + manual evaluation needs no AI."}>
            <select value={settings.model} disabled={!usesAi || !aiEnabled} onChange={(e) => set("model", e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Number of questions">
            <div className="seg">
              {[5, 10, 15, 20].map((n) => (
                <button key={n} className={settings.count === n ? "on" : ""} onClick={() => set("count", n)}>{n}</button>
              ))}
              <input
                type="number"
                min={1}
                max={30}
                value={settings.count}
                onChange={(e) => set("count", Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                aria-label="Custom number of questions"
              />
            </div>
          </Field>

          <Field label="Difficulty" hint="Easy = 1 pt, medium = 2 pts, hard = 3 pts">
            <div className="seg">
              {(["mixed", ...DIFFICULTIES] as const).map((d) => (
                <button key={d} className={settings.difficulty === d ? "on" : ""} onClick={() => set("difficulty", d)}>{cap(d)}</button>
              ))}
            </div>
          </Field>

          <Field label="Question types">
            <div className="checks">
              {QUESTION_TYPES.map((t) => (
                <label key={t}>
                  <input type="checkbox" checked={settings.types.includes(t)} onChange={() => toggleType(t)} />
                  {TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Show answers">
            <div className="seg">
              <button className={settings.feedback === "immediate" ? "on" : ""} onClick={() => set("feedback", "immediate")}>After each question</button>
              <button className={settings.feedback === "end" ? "on" : ""} onClick={() => set("feedback", "end")}>At the end</button>
            </div>
          </Field>
        </section>

        {!aiEnabled && (
          <p className="notice">AI generation and AI evaluation need <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code>.</p>
        )}
        {error && <p className="error">{error}</p>}

        <button className="primary big" disabled={!canStart} onClick={start}>
          {phase === "loading" ? `${modelLabel(settings.model)} is writing your questions…` : "Start quiz"}
        </button>
        {phase === "loading" && <p className="muted small center">This usually takes 20–60 seconds.</p>}
      </div>
    );
  }

  const evalLabel = run.evaluation === "ai" ? `AI evaluation · ${modelLabel(run.model)}` : "Manual evaluation";

  if (phase === "results") {
    return (
      <Results
        questions={questions}
        answers={answers}
        results={results}
        topicName={topicName}
        grading={grading}
        attempts={attempts}
        evalLabel={evalLabel}
        modelName={modelLabel(run.model)}
        usageLog={usageLog}
        stats={stats}
        historyError={historyError}
        canFollowUp={canFollowUp}
        threads={threads}
        asking={asking}
        onAsk={askFollowUp}
        onAnswer={setAnswerFor}
        onCheck={check}
        onTryAgain={tryAgain}
        onRegrade={check}
        onSelfGrade={selfGrade}
        onRetryMissed={retryMissed}
        onNew={() => setPhase("setup")}
      />
    );
  }

  // quiz / grading
  const q = questions[index];
  const answer = answers[q.id];
  const result = results[q.id];
  const locked = Boolean(result) || phase === "grading";
  const showResult = Boolean(result) && (run.feedback === "immediate" || result.verdict === "revealed");
  const isGrading = grading.has(q.id);
  const last = index === questions.length - 1;
  const graded = questions.filter((x) => results[x.id] && results[x.id].verdict !== "pending");
  const earned = graded.reduce((n, x) => n + pointsFor(x, results[x.id]), 0);
  const gradedPossible = graded.reduce((n, x) => n + POINTS[x.difficulty], 0);
  const setAnswer = (a: Answer) => setAnswerFor(q, a);

  return (
    <div className="quiz">
      {notice && <p className="notice">{notice}</p>}
      <div className="row-between">
        <span className="muted">Question {index + 1} of {questions.length} · {evalLabel}</span>
        <span className="muted">
          {run.feedback === "immediate" && gradedPossible > 0 && <>Score: {fmt(earned)} / {gradedPossible} pts</>}
          {run.feedback === "immediate" && gradedPossible > 0 && usageLog.length > 0 && " · "}
          {usageLog.length > 0 && <UsageText usage={sumUsage(usageLog.map((e) => e.usage))} title="Tokens used in this quiz so far" />}
        </span>
      </div>
      <div className="progress"><div style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>

      <nav className="dots" aria-label="Questions">
        {questions.map((x, i) => (
          <button
            key={x.id}
            className={`dot ${i === index ? "current" : ""} ${dotClass(x, answers[x.id], results[x.id], run.feedback)}`}
            onClick={() => setIndex(i)}
            aria-label={`Question ${i + 1}`}
          >{i + 1}</button>
        ))}
      </nav>

      <article className="card question">
        <QuestionChips q={q} topicName={topicName} attempt={attempts[q.id]} />
        <History stats={stats[q.id]} error={historyError} />
        <Md>{q.prompt}</Md>

        <AnswerInput q={q} answer={answer} locked={locked} showCorrect={showResult} onChange={setAnswer} onSubmit={() => run.feedback === "immediate" && !locked && check(q)} />

        {isGrading && <p className="muted">{run.evaluation === "ai" ? `${modelLabel(run.model)} is grading…` : "Checking…"}</p>}
        {showResult && <Feedback q={q} r={result} onSelfGrade={(s) => selfGrade(q, s)} />}
        {showResult && canFollowUp(result) && (
          <FollowUp
            key={q.id}
            modelName={modelLabel(run.model)}
            thread={threads[q.id] ?? []}
            busy={asking.has(q.id)}
            onSend={(text) => askFollowUp(q, text)}
          />
        )}
        {result && !showResult && <p className="muted small">Answer locked. You'll see feedback at the end.</p>}
      </article>

      <div className="actions">
        <button disabled={index === 0} onClick={() => setIndex(index - 1)}>← Back</button>
        <div className="grow" />
        {!result && !isGrading && phase === "quiz" && (
          <button className="ghost" onClick={() => revealAnswer(q)}>
            Show answer (0 pts)
          </button>
        )}
        {showResult && phase === "quiz" && (
          <button onClick={() => tryAgain(q)}>↻ Try again</button>
        )}
        {run.feedback === "immediate" && !result && phase === "quiz" && (
          <button className="primary" disabled={!isAnswered(q, answer) || isGrading} onClick={() => check(q)}>Check answer</button>
        )}
        {!last && (run.feedback === "end" || result) && (
          <button className="primary" onClick={() => setIndex(index + 1)}>Next →</button>
        )}
        {last && (
          <button className="primary" disabled={phase === "grading"} onClick={finish}>
            {phase === "grading" ? "Grading…" : "Finish & see results"}
          </button>
        )}
      </div>
      {!last && (
        <p className="center"><button className="link" disabled={phase === "grading"} onClick={finish}>{phase === "grading" ? "Grading…" : "Finish early"}</button></p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

function QuestionChips({
  q,
  topicName,
  number,
  attempt,
}: {
  q: Question;
  topicName: Record<string, string>;
  number?: number;
  attempt?: number;
}) {
  return (
    <div className="chips">
      {number !== undefined && <span className="chip">Q{number}</span>}
      <span className="chip">{topicName[q.topic] ?? q.topic}</span>
      <span className={`chip diff-${q.difficulty}`}>{cap(q.difficulty)} · {POINTS[q.difficulty]} pt{POINTS[q.difficulty] > 1 ? "s" : ""}</span>
      <span className="chip">{TYPE_LABELS[q.type]}</span>
      {q.source === "ai" && <span className="chip ai">AI-generated</span>}
      {attempt !== undefined && attempt > 1 && <span className="chip">Attempt {attempt}</span>}
    </div>
  );
}

function AnswerInput({
  q,
  answer,
  locked,
  showCorrect,
  onChange,
  onSubmit,
}: {
  q: Question;
  answer: Answer | undefined;
  locked: boolean;
  showCorrect: boolean;
  onChange: (a: Answer) => void;
  onSubmit: () => void;
}) {
  if (q.type === "mcq" || q.type === "multi") {
    const selected = answer?.kind === "options" ? answer.selected : [];
    return (
      <div className="choices">
        {q.options.map((opt, i) => {
          const picked = selected.includes(i);
          const correct = q.correct.includes(i);
          const mark = showCorrect ? (correct ? "correct" : picked ? "wrong" : "") : "";
          return (
            <label key={i} className={`option ${picked ? "on" : ""} ${mark}`}>
              <input
                type={q.type === "mcq" ? "radio" : "checkbox"}
                name={q.id}
                checked={picked}
                disabled={locked}
                onChange={() =>
                  onChange({
                    kind: "options",
                    selected: q.type === "mcq" ? [i] : picked ? selected.filter((s) => s !== i) : [...selected, i].sort(),
                  })
                }
              />
              <span className="grow"><Md>{opt}</Md></span>
              {mark === "correct" && <span className="mark">✓</span>}
              {mark === "wrong" && <span className="mark">✗</span>}
            </label>
          );
        })}
      </div>
    );
  }

  const text = answer?.kind === "text" ? answer.text : "";
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || q.type === "short")) {
      e.preventDefault();
      if (text.trim()) onSubmit();
    }
  };
  return q.type === "short" ? (
    <input
      className="text-answer"
      value={text}
      disabled={locked}
      placeholder="Your answer"
      onChange={(e) => onChange({ kind: "text", text: e.target.value })}
      onKeyDown={onKeyDown}
      autoFocus
    />
  ) : (
    <>
      <textarea
        className="text-answer"
        rows={8}
        value={text}
        disabled={locked}
        placeholder="Explain in your own words, or write code…"
        onChange={(e) => onChange({ kind: "text", text: e.target.value })}
        onKeyDown={onKeyDown}
        autoFocus
      />
      {!locked && <div className="muted small">⌘/Ctrl + Enter to submit</div>}
    </>
  );
}

const VERDICT_LABEL: Record<GradeResult["verdict"], string> = {
  correct: "Correct",
  partial: "Partly correct",
  incorrect: "Incorrect",
  revealed: "Answer revealed",
  pending: "Grade yourself",
};

const GRADED_BY: Record<GradeResult["gradedBy"], string> = {
  key: "checked against the answer key",
  ai: "graded by Claude against the answer key",
  self: "self-graded",
};

function Feedback({ q, r, onSelfGrade }: { q: Question; r: GradeResult; onSelfGrade: (score: number) => void }) {
  const isChoice = q.type === "mcq" || q.type === "multi";
  const pending = r.verdict === "pending";
  return (
    <div className={`feedback v-${r.verdict}`}>
      <div className="row-between">
        <strong>{VERDICT_LABEL[r.verdict]}</strong>
        {!pending && (
          <span className="small">{fmt(pointsFor(q, r))} / {POINTS[q.difficulty]} pts · {GRADED_BY[r.gradedBy]}</span>
        )}
      </div>

      {r.feedback && r.feedback !== q.explanation && <Md>{r.feedback}</Md>}
      <List title="Mistakes" items={r.mistakes} />
      <List title="How to improve" items={r.improvements} />
      {r.usage && (
        <div className="usage-line"><UsageText usage={r.usage} title="Tokens used to grade this answer" /></div>
      )}
      {r.referenceNote && (
        <p className="ref-note"><strong>Note on the answer key:</strong> {r.referenceNote}</p>
      )}

      {!isChoice && (
        <div className="reference">
          <div className="field-label">
            {q.type === "short" ? "Expected answer" : "Answer key"}
            {q.source === "ai" && <span className="muted small"> (written by Claude)</span>}
          </div>
          <Md>{q.answer}</Md>
          {q.accept.length > 0 && <div className="muted small">Also accepted: {q.accept.join(", ")}</div>}
        </div>
      )}
      {pending && q.rubric && (
        <div className="reference">
          <div className="field-label">Key points to check</div>
          <Md>{q.rubric}</Md>
        </div>
      )}
      {q.explanation && (
        <div className="reference">
          <div className="field-label">Explanation</div>
          <Md>{q.explanation}</Md>
        </div>
      )}

      {pending && (
        <div className="self-grade">
          <div className="field-label">How did your answer compare with the key?</div>
          <div className="seg">
            {SELF_GRADES.map((g) => (
              <button key={g.score} onClick={() => onSelfGrade(g.score)}>{g.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="reference">
      <div className="field-label">{title}</div>
      <ul className="mistakes">{items.map((m, i) => <li key={i}><Md>{m}</Md></li>)}</ul>
    </div>
  );
}

const SUGGESTIONS = [
  "Why was my answer graded this way?",
  "Explain this with a small example",
  "Give me a similar question to practice",
];

function FollowUp({
  modelName,
  thread,
  busy,
  onSend,
}: {
  modelName: string;
  thread: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [open, setOpen] = useState(thread.length > 0);
  const [draft, setDraft] = useState("");
  const send = (text: string) => {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setDraft("");
  };

  if (!open && thread.length === 0) {
    return (
      <div className="follow-up">
        <button className="link" onClick={() => setOpen(true)}>💬 Ask {modelName} a follow-up question</button>
      </div>
    );
  }

  return (
    <div className="follow-up">
      <div className="field-label">Follow-up questions</div>
      {thread.length > 0 && (
        <div className="thread">
          {thread.map((m, i) => (
            <div key={i} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
              {m.role === "user" ? (
                <p>{m.content}</p>
              ) : m.content ? (
                m.error ? (
                  <p>Couldn't get a reply: {m.content}</p>
                ) : (
                  <>
                    <Md>{m.content}</Md>
                    {m.usage && <div className="usage-line"><UsageText usage={m.usage} title="Tokens used for this reply" /></div>}
                  </>
                )
              ) : (
                <p className="muted">Thinking…</p>
              )}
            </div>
          ))}
        </div>
      )}
      {thread.length === 0 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip-button" disabled={busy} onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}
      <div className="ask-row">
        <textarea
          rows={2}
          value={draft}
          placeholder="Ask anything about this question…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <button className="primary" disabled={busy || !draft.trim()} onClick={() => send(draft)}>
          {busy ? "…" : "Ask"}
        </button>
      </div>
      <div className="muted small">Enter to send · Shift + Enter for a new line</div>
    </div>
  );
}

function Results({
  questions,
  answers,
  results,
  topicName,
  grading,
  attempts,
  evalLabel,
  modelName,
  usageLog,
  stats,
  historyError,
  canFollowUp,
  threads,
  asking,
  onAsk,
  onAnswer,
  onCheck,
  onTryAgain,
  onRegrade,
  onSelfGrade,
  onRetryMissed,
  onNew,
}: {
  questions: Question[];
  answers: Record<string, Answer>;
  results: Record<string, GradeResult>;
  topicName: Record<string, string>;
  grading: Set<string>;
  attempts: Record<string, number>;
  evalLabel: string;
  modelName: string;
  usageLog: UsageEntry[];
  stats: Record<string, QuestionStats>;
  historyError: string | null;
  canFollowUp: (r: GradeResult | undefined) => boolean;
  threads: Record<string, ChatMessage[]>;
  asking: Set<string>;
  onAsk: (q: Question, text: string) => void;
  onAnswer: (q: Question, a: Answer) => void;
  onCheck: (q: Question) => void;
  onTryAgain: (q: Question) => void;
  onRegrade: (q: Question) => void;
  onSelfGrade: (q: Question, score: number) => void;
  onRetryMissed: () => void;
  onNew: () => void;
}) {
  const earned = questions.reduce((n, q) => n + pointsFor(q, results[q.id]), 0);
  const possible = questions.reduce((n, q) => n + POINTS[q.difficulty], 0);
  const pct = possible ? Math.round((earned / possible) * 100) : 0;
  const counts = { correct: 0, partial: 0, incorrect: 0, revealed: 0, pending: 0 };
  let retrying = 0;
  for (const q of questions) {
    const v = results[q.id]?.verdict;
    if (v) counts[v]++;
    else retrying++;
  }
  const retried = questions.filter((q) => (attempts[q.id] ?? 1) > 1).length;

  const breakdown = (key: (q: Question) => string) => {
    const rows = new Map<string, { earned: number; possible: number; n: number }>();
    for (const q of questions) {
      const k = key(q);
      const row = rows.get(k) ?? { earned: 0, possible: 0, n: 0 };
      row.earned += pointsFor(q, results[q.id]);
      row.possible += POINTS[q.difficulty];
      row.n++;
      rows.set(k, row);
    }
    return [...rows.entries()];
  };
  const missed = questions.filter((q) => results[q.id]?.verdict !== "pending" && (results[q.id]?.score ?? 0) < 1).length;

  return (
    <div className="results">
      <section className="card score-card">
        <div className="score">{pct}%</div>
        <div>
          <div className="big-text">{fmt(earned)} / {possible} points</div>
          <div className="muted">
            {counts.correct} correct · {counts.partial} partial · {counts.incorrect} incorrect
            {counts.revealed ? ` · ${counts.revealed} revealed` : ""}
            {retrying ? ` · ${retrying} being retried` : ""}
          </div>
          <div className="muted small">
            {evalLabel}
            {retried ? ` · ${retried} question${retried === 1 ? "" : "s"} retried (latest attempt counts)` : ""}
          </div>
        </div>
      </section>

      {counts.pending > 0 && (
        <p className="notice">
          {counts.pending} answer{counts.pending === 1 ? " needs" : "s need"} your grading. Compare each with the answer key below; the score updates as you go.
        </p>
      )}

      {usageLog.length > 0 && <UsageSummary log={usageLog} />}

      <div className="grid two">
        <BreakdownTable title="By difficulty" rows={breakdown((q) => cap(q.difficulty)).sort((a, b) => order(a[0]) - order(b[0]))} />
        <BreakdownTable title="By topic" rows={breakdown((q) => topicName[q.topic] ?? q.topic)} />
      </div>

      <div className="actions">
        {missed > 0 && <button className="primary" onClick={onRetryMissed}>Retry {missed} missed</button>}
        <button onClick={onNew}>New quiz</button>
        <Link href="/" className="button">Change subject</Link>
      </div>

      <h2>Review</h2>
      {questions.map((q, i) => {
        const r = results[q.id];
        const a = answers[q.id];
        if (!r) {
          // Being retried: answer again right here.
          return (
            <article key={q.id} className="card question retrying">
              <QuestionChips q={q} topicName={topicName} number={i + 1} attempt={attempts[q.id]} />
              <History stats={stats[q.id]} error={historyError} />
              <Md>{q.prompt}</Md>
              <AnswerInput q={q} answer={a} locked={grading.has(q.id)} showCorrect={false} onChange={(x) => onAnswer(q, x)} onSubmit={() => onCheck(q)} />
              <div className="actions">
                <button className="primary" disabled={!isAnswered(q, a) || grading.has(q.id)} onClick={() => onCheck(q)}>
                  {grading.has(q.id) ? "Grading…" : "Check answer"}
                </button>
              </div>
            </article>
          );
        }
        return (
          <article key={q.id} className="card question">
            <QuestionChips q={q} topicName={topicName} number={i + 1} attempt={attempts[q.id]} />
              <History stats={stats[q.id]} error={historyError} />
            <Md>{q.prompt}</Md>
            {q.type === "mcq" || q.type === "multi" ? (
              <AnswerInput q={q} answer={a} locked showCorrect onChange={() => {}} onSubmit={() => {}} />
            ) : (
              <div className="your-answer">
                <div className="field-label">Your answer</div>
                {a?.kind === "text" && a.text.trim() ? <pre>{a.text}</pre> : <p className="muted">(no answer)</p>}
              </div>
            )}
            <Feedback q={q} r={r} onSelfGrade={(s) => onSelfGrade(q, s)} />
            {canFollowUp(r) && (
              <FollowUp
                modelName={modelName}
                thread={threads[q.id] ?? []}
                busy={asking.has(q.id)}
                onSend={(text) => onAsk(q, text)}
              />
            )}
            <div className="actions">
              {r.failed && (
                <button disabled={grading.has(q.id)} onClick={() => onRegrade(q)}>
                  {grading.has(q.id) ? "Grading…" : "Retry grading"}
                </button>
              )}
              {r.verdict !== "pending" && <button onClick={() => onTryAgain(q)}>↻ Try again</button>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: [string, { earned: number; possible: number; n: number }][] }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="muted small">{v.n} q</td>
              <td className="num">{fmt(v.earned)} / {v.possible}</td>
              <td className="bar-cell"><div className="bar"><div style={{ width: `${v.possible ? (v.earned / v.possible) * 100 : 0}%` }} /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function dotClass(q: Question, a: Answer | undefined, r: GradeResult | undefined, mode: FeedbackMode) {
  if (r && (mode === "immediate" || r.verdict === "revealed")) return `v-${r.verdict}`;
  if (r || isAnswered(q, a)) return "answered";
  return "";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const order = (d: string) => ["Easy", "Medium", "Hard"].indexOf(d);

// ------------------------------------------------------------------- usage

function sumUsage(list: TokenUsage[]): TokenUsage & { cost: number | null } {
  let cost: number | null = 0;
  const total = { model: list[0]?.model ?? "", input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const u of list) {
    total.input += u.input;
    total.output += u.output;
    total.cacheRead += u.cacheRead;
    total.cacheWrite += u.cacheWrite;
    const c = estimateCost(u);
    cost = cost === null || c === null ? null : cost + c;
  }
  return { ...total, cost };
}

const fmtTokens = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString());
const fmtCost = (c: number | null) => (c === null ? "" : c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`);

function UsageText({ usage, title }: { usage: TokenUsage & { cost?: number | null }; title?: string }) {
  const cost = usage.cost !== undefined ? usage.cost : estimateCost(usage);
  const cached = usage.cacheRead + usage.cacheWrite;
  return (
    <span className="usage" title={title}>
      {fmtTokens(usage.input)} in · {fmtTokens(usage.output)} out
      {cached > 0 && <> · {fmtTokens(cached)} cached</>} tokens
      {cost !== null && <> · ≈{fmtCost(cost)}</>}
    </span>
  );
}

const USAGE_LABELS: Record<UsageKind, string> = {
  generation: "Question generation",
  grading: "AI grading",
  "follow-up": "Follow-up questions",
};

function UsageSummary({ log }: { log: UsageEntry[] }) {
  const kinds = (Object.keys(USAGE_LABELS) as UsageKind[]).filter((k) => log.some((e) => e.kind === k));
  const total = sumUsage(log.map((e) => e.usage));
  return (
    <section className="card">
      <h3>Token usage</h3>
      <table className="usage-table">
        <thead>
          <tr><th></th><th>Calls</th><th>Input</th><th>Output</th><th>Est. cost</th></tr>
        </thead>
        <tbody>
          {kinds.map((k) => {
            const entries = log.filter((e) => e.kind === k);
            const u = sumUsage(entries.map((e) => e.usage));
            return (
              <tr key={k}>
                <td>{USAGE_LABELS[k]}</td>
                <td className="num">{entries.length}</td>
                <td className="num">{u.input.toLocaleString()}</td>
                <td className="num">{u.output.toLocaleString()}</td>
                <td className="num">{fmtCost(u.cost)}</td>
              </tr>
            );
          })}
          <tr className="total">
            <td>Total</td>
            <td className="num">{log.length}</td>
            <td className="num">{total.input.toLocaleString()}</td>
            <td className="num">{total.output.toLocaleString()}</td>
            <td className="num">{fmtCost(total.cost)}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">
        Output includes Claude&apos;s thinking tokens. Costs are estimates from list prices; your Anthropic Console shows actual billing.
      </p>
    </section>
  );
}

// ----------------------------------------------------------------- history

function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const units: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [604800, "week"], [2629800, "month"], [31557600, "year"]];
  let [size, name] = units[0];
  for (const u of units) if (secs >= u[0]) [size, name] = u;
  const n = Math.floor(secs / size);
  return `${n} ${name}${n === 1 ? "" : "s"} ago`;
}

const LAST_LABEL: Record<string, string> = {
  correct: "correct",
  partial: "partly correct",
  incorrect: "incorrect",
  revealed: "answer revealed",
};

function History({ stats, error }: { stats: QuestionStats | undefined; error: string | null }) {
  if (error && !stats) return <div className="history muted small" title={error}>History unavailable: {error}</div>;
  if (!stats) return <div className="history small"><span className="history-new">New</span> You haven&apos;t answered this question before.</div>;
  const rate = Math.round((stats.correct / stats.attempts) * 100);
  return (
    <div className="history small">
      <span className="history-rate" title="Correct answers out of all attempts">{rate}%</span>
      Answered {stats.attempts} time{stats.attempts === 1 ? "" : "s"} · {stats.correct} correct
      {stats.partial > 0 && <> · {stats.partial} partly correct</>}
      <span className="muted"> · last {LAST_LABEL[stats.lastVerdict] ?? stats.lastVerdict}, {timeAgo(stats.lastAttemptedAt)}</span>
    </div>
  );
}
