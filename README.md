# Study Quiz

Quiz yourself on what you're learning. Pick a subject and one or more topics, then take a randomized quiz built from your own markdown question files or from questions Claude writes on the spot.

- **Grading:** grade written answers yourself, or have Claude grade them against the answer key. Claude points out mistakes and how to improve.
- **Follow-ups:** ask Claude follow-up questions about any graded answer.
- **Retries:** try any question again.
- **History:** every attempt is saved to a database, and each question shows how often you've got it right.

Scores are weighted by difficulty, and every Claude call shows its token usage.

## Requirements

- Node.js 20.9 or later
- Docker, for the question-history database
- An Anthropic API key. Optional: without one, manual evaluation with your markdown files still works.

## Setup

```bash
npm install
cp .env.example .env.local   # then paste your Anthropic API key into .env.local
npm run db:up                # starts PostgreSQL in Docker on port 5499
npm run dev                  # http://localhost:4747
```

### Environment variables (`.env.local`)

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | For AI features | Enables AI-generated questions, AI evaluation and follow-up questions |
| `DATABASE_URL` | For history | `postgres://quiz:quiz@localhost:5499/study_quiz`, the database from `docker-compose.yml` |
| `CLAUDE_MODEL` | No | Default selection in the model picker (default `claude-opus-5-5`) |

`.env.local` is git-ignored, so never commit it.

### Ports

| Service | Port |
|---|---|
| App (`npm run dev` / `npm start`) | **4747** |
| PostgreSQL (localhost only) | **5499** |

Both were chosen so they don't clash with the other projects in `~/IdeaProjects` and `~/PycharmProjects`.

## Using the app

1. **Home:** pick a subject.
2. **Setup:** choose the options below and click **Start quiz**.
3. **Quiz:** answer each question. Under its tags, each question shows your history with it.
4. **Results:**
   - your total score, with breakdowns by difficulty and by topic;
   - token usage;
   - a review of every question, where you can try questions again or ask follow-ups.

### Quiz options

| Option | Choices |
|---|---|
| Topics | Any combination of the subject's topics (All / None shortcuts) |
| Questions come from | **My markdown files**: questions and answer keys from `content/`. **AI-generated**: Claude writes new questions, each with its own answer key. |
| Evaluation | **Manual**: you compare written answers with the answer key and grade yourself. **AI**: Claude grades written answers against the answer key. |
| Claude model | Opus 5.5 (default), Sonnet 5.5, Haiku 5.5 or Fable 5.1, used for generating, grading and follow-ups. Disabled when nothing in the quiz uses AI. |
| Number of questions | 5, 10, 15, 20, or any number from 1 to 30 |
| Difficulty | Mixed, Easy, Medium or Hard |
| Question types | Multiple choice, Select all, Short answer, Explain / write code |
| Show answers | After each question, or at the end |

Your choices are remembered per subject in the browser.

### Question types and grading

| Type | Manual evaluation | AI evaluation | Uses tokens? |
|---|---|---|---|
| `mcq`: multiple choice | Checked against the key automatically | Same | No |
| `multi`: select all that apply | Checked against the key automatically; partial credit = (correct picks − wrong picks) ÷ correct options | Same | No |
| `short`: one exact answer | An exact match (ignoring case, spaces, quotes, backticks) is correct automatically; otherwise you grade yourself | An exact match is correct automatically; otherwise Claude grades it | Only when it isn't an exact match and evaluation is AI |
| `freetext`: explain or write code | You grade yourself: **right** (1), **partly right** (0.5) or **wrong** (0) | Claude grades it: 0, 0.25, 0.5, 0.75 or 1 | Yes, with AI evaluation |

Manual evaluation never calls Claude. Unanswered questions and **Show answer** never call Claude.

### Scoring

Each question is worth points by difficulty: **easy = 1, medium = 2, hard = 3**. Its score (0–1) is multiplied by those points. With "Show answers after each question", the header shows a running score.

### AI evaluation

Claude grades **against your answer key**, which is the source of truth: the `answer:` and `rubric:` from your markdown file, or the key Claude wrote for an AI-generated question.
- It gives credit only for key points in the reference answer and rubric.
- It doesn't add requirements of its own, and doesn't penalize you for leaving out things the key doesn't mention.
- It judges meaning, not wording. For code, it checks whether your code does what the reference does.
- Strictness scales with difficulty: the core idea is enough for easy questions, while hard ones need the reasoning the key names.

You get:
- a score;
- **feedback**;
- **mistakes**: statements that contradict the key, and missing key points;
- **how to improve**.

If Claude is confident the answer key itself is wrong, it still grades against the key and adds a **note on the answer key**.

### Manual evaluation

After you answer a written question, the app shows:
- the answer key;
- the rubric's **key points to check**;
- the explanation.

Then you choose **I got it right**, **Partly right** or **I got it wrong**. With "Show answers at the end", you grade these on the results page, and the score updates as you go.

### Follow-up questions (AI evaluation only)

Under every graded answer there's **💬 Ask Claude … a follow-up question**. You can start from a suggestion ("Why was my answer graded this way?", "Explain this with a small example", "Give me a similar question to practice") or type your own. Press Enter to send and Shift+Enter for a new line.

- Claude sees the question, the answer key, your answer and the grade.
- If you dispute the grade and you're right according to the key, it says so. It can't change the score, but it will point you to Try again.
- Replies stream in as they're written.
- Each question keeps its own conversation, which carries over to the results page.

Every message is one Claude call.

### Show answer, Try again, Retry missed

- **Show answer (0 pts):** reveals the answer without scoring it. It's recorded in history as an attempt that wasn't correct.
- **↻ Try again:** discards a question's grade and lets you answer again, with your previous answer still filled in. It's available on the quiz page once feedback is showing, and on every question in the results review. The latest attempt counts toward the score, and the card shows "Attempt 2", "Attempt 3" and so on.
- **Retry N missed:** on the results page, starts a fresh quiz with only the questions you didn't fully get right.

### AI-generated questions

Claude receives:
- the selected topics, with each topic's `focus:` list;
- any notes written above the first question in the topic's file;
- the difficulty and allowed question types;
- your saved questions, so it doesn't repeat them.

Its output must follow a JSON schema, so every question comes with an answer key, explanation and, for written answers, a rubric. A typical 10-question generation takes 20–60 seconds depending on the model.

## Question history (database)

Every graded attempt is saved to **PostgreSQL 18.6** running in Docker:
- compose file: `docker-compose.yml`
- container: `study-quiz-db`
- port: `5499`, reachable only from your machine

Under its tags, each question shows:
- **New** if you've never answered it;
- otherwise your **correct rate**, how many times you've answered it, how many of those were correct or partly correct, and your last result and when it was. For example: **20%** "Answered 5 times · 1 correct · last correct, 2 days ago".

The line updates right after each graded answer, and appears in the results review too.

**What counts as an attempt:**
- every time an answer is checked, including each Try again;
- a manually graded answer, once you've graded it;
- Show answer, counted as not correct.

Skipped, unanswered questions aren't recorded.

**It outlives restarts.** The data lives in the named Docker volume `study-quiz-pgdata`.
- It survives app restarts, `docker compose down`, Docker restarts and reboots.
- The container restarts automatically with Docker (`restart: unless-stopped`).
- Only `docker compose down -v` or `docker volume rm study-quiz-pgdata` deletes it.

**Tables**, created automatically on first use:

| Table | Contents |
|---|---|
| `questions` | One row per question ever attempted: id, subject, topic, source (`file`/`ai`), difficulty, question text, first seen |
| `attempts` | One row per graded attempt: question id, score, verdict, evaluation mode (`manual`/`ai`), timestamp |

**Question IDs** are a hash of the subject, topic and question text. History stays with a question when you add, remove or reorder questions in a file. Editing a question's text makes it a new question with fresh history. AI-generated questions are stored too, though they rarely come up again.

If the database isn't running, quizzes still work. Questions show "History unavailable" and attempts aren't saved.

## Token usage

Only these call Claude and use tokens:
- **AI-generated questions:** one call per quiz;
- **AI evaluation:** one call per graded written answer, including after each Try again;
- **follow-up questions:** one call per message.

Each call's usage is shown:
- **under each AI-graded answer and each follow-up reply:** input and output tokens, plus an estimated cost;
- **in the quiz header:** a running total for the current quiz;
- **on the results page:** a **Token usage** table with calls, input tokens, output tokens and estimated cost for question generation, AI grading and follow-ups, plus a total.

Nothing appears in a quiz that never calls Claude, such as files with manual evaluation, or AI evaluation with only multiple-choice questions.

Output tokens include Claude's thinking. Costs are estimates from the list prices in `lib/models.ts`; the Anthropic Console shows what you're actually billed. Totals reset with each new quiz.

## Models

| Model | Price (input / output per million tokens) | Notes |
|---|---|---|
| Claude Opus 5.5 | $4 / $20 | Default; recommended |
| Claude Sonnet 5.5 | $2 / $10 | Fast, about half the cost |
| Claude Haiku 5.5 | $0.10 / $0.50 | Fastest and cheapest |
| Claude Fable 5.1 | $10 / $50 | Most capable, slowest |

The list and prices live in `lib/models.ts`, and the API rejects models that aren't on it. Generation and follow-ups run at `medium` effort, grading at `low` (set in `lib/claude.ts`). On Opus 5.5, Sonnet 5.5 and Fable 5.1, a request Claude declines is automatically retried on a fallback model.

## Adding subjects, topics and questions

A folder is a subject and a markdown file is a topic: `content/<subject>/<topic>.md`.

````markdown
---
subject: Kotlin
topic: Coroutines
order: 3
focus:
  - structured concurrency and scopes
  - dispatchers
---

Optional notes here are given to Claude as context when it generates questions.

## Q: Which builder returns a `Deferred<T>`?
difficulty: easy
- [ ] launch
- [x] async
- [ ] runBlocking
explanation: `async` returns `Deferred<T>`; `launch` returns `Job`.

## Q: What does this print?
type: short
difficulty: medium
```kotlin
println(listOf(1, 2, 3).map { it * 2 }.sum())
```
answer: 12

## Q: Explain the difference between `launch` and `async`.
type: freetext
difficulty: medium
answer: |
Both start a coroutine. `launch` is fire-and-forget and returns a `Job`...
rubric: Mentions Job vs Deferred, await(), and exception propagation differences.
````

**Frontmatter:**
- `subject`: display name for the subject.
- `topic`: display name for the topic.
- `order`: optional, sorts topics.
- `focus`: optional list that steers AI generation.

**Question fields:**
- **Every saved question needs its answer:** `[x]` on the correct options, or an `answer:` line. Questions without one are skipped, with a warning in the server log.
- `type` is optional: options with one `[x]` make an `mcq`, more than one make a `multi`, and no options make a `freetext`.
- `difficulty` defaults to `medium`.
- `accept: a | b` lists alternative exact answers for `short` questions.
- `explanation:` is shown after answering.
- `rubric:` lists the key points for grading written answers, used by both Claude and manual grading.
- `field: |` starts a multi-line value that runs until the next field.

**Other rules:**
- Code fences in the question body are kept as part of the question.
- A topic file with only frontmatter (no questions) works for AI-generated quizzes.
- YAML list items that begin with a backtick must be quoted or reworded.

Included: **Kotlin › Generics** (20 questions) and **Kotlin › Null Safety** (4 questions).

## npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:4747 |
| `npm run build` / `npm start` | Production build / serve it on port 4747 |
| `npm run typecheck` | TypeScript check |
| `npm run db:up` | Start the database and wait until it's ready |
| `npm run db:down` | Stop and remove the database container (data is kept) |
| `npm run db:psql` | Open a SQL shell on the database |

## Project structure

| Path | Purpose |
|---|---|
| `content/` | Your subjects (folders) and topics (markdown files) |
| `app/page.tsx` | Home page: subject list |
| `app/[subject]/page.tsx` | Subject page (renders the quiz) |
| `components/QuizApp.tsx` | Setup, quiz, results, follow-ups, history and token usage UI |
| `components/Md.tsx` | Markdown rendering for questions and answers |
| `lib/content.ts` | Reads and parses `content/` |
| `lib/question-id.ts` | Stable question IDs (content hash) |
| `lib/scoring.ts` | Answer-key grading, self-grading, shuffling, points |
| `lib/claude.ts` | Claude calls: generation, grading, follow-up streaming, token usage |
| `lib/models.ts` | Model list, prices, cost estimates |
| `lib/db.ts` | PostgreSQL pool, schema, attempts and stats queries |
| `lib/api-schemas.ts` | Request validation (zod) for all API routes |
| `app/api/generate` | Generate questions |
| `app/api/grade` | AI-grade an answer |
| `app/api/followup` | Stream a follow-up reply |
| `app/api/stats` | Load history for a set of questions |
| `app/api/attempts` | Record an attempt and return updated history |
| `docker-compose.yml` | PostgreSQL 18.6 with a persistent volume |

Built with Next.js 16, React 19, TypeScript 7, the Anthropic TypeScript SDK, zod 4, node-postgres and gray-matter, all at their latest versions.

## Troubleshooting

- **"History unavailable":** the database isn't running. Start it with `npm run db:up`.
- **AI options are greyed out:** `ANTHROPIC_API_KEY` is missing from `.env.local`. Add it and restart `npm run dev`.
- **A request fails with a 500 right after editing code:** the dev server was still recompiling. Send it again.
- **"Grading failed":** use **Retry grading** on that question in the results review.

## Before deploying

- Set `ANTHROPIC_API_KEY` and `DATABASE_URL` as environment variables on the host. Use a managed PostgreSQL database in production; the tables are created automatically.
- **Protect the API routes.** Once deployed, anyone who finds the URL can call `/api/generate`, `/api/grade` and `/api/followup` on your key, and write to your history through `/api/attempts`. Add authentication or an access code before sharing the URL.
- Content is read at build time, so redeploy after editing markdown files.
- Set a monthly spend limit on the key in the Anthropic Console.
