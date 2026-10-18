# Study Quiz

Quiz yourself on what you're learning. Pick a subject and one or more topics, then take a randomized quiz built from your own markdown question files or from questions Claude writes on the spot.

- **Grading:** grade written answers yourself, or have Claude grade them against the answer key. Claude points out mistakes and how to improve.
- **Follow-ups:** ask Claude follow-up questions about any graded answer.
- **Retries:** try any question again.
- **Accounts:** everyone logs in with a username and password, so history and scores are kept per person.
- **History:** every attempt is saved to a database, and each question shows how often you've got it right.
- **Scoreboard:** correct and wrong answers, % completed and last attempt per person and topic, with every question's attempts one click away.

Scores are weighted by difficulty, and every Claude call shows its token usage.

## Requirements

- Node.js 20.9 or later
- Docker, for the database (accounts, history and the scoreboard)
- An Anthropic API key. Optional: without one, manual evaluation with your markdown files still works.

## Setup

```bash
npm install
cp .env.example .env.local   # then paste your Anthropic API key into .env.local
npm run db:up                # starts PostgreSQL in Docker on port 5499
npm run dev                  # http://localhost:4747
```

Open http://localhost:4747, choose **Create account**, and pick a username and password.

### Environment variables (`.env.local`)

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | For AI features | Enables AI-generated questions, AI evaluation and follow-up questions |
| `DATABASE_URL` | Yes | `postgres://quiz:quiz@localhost:5499/study_quiz`, the database from `docker-compose.yml`. Logins, history and the scoreboard all live there |
| `SIGNUP_CODE` | No | If set, creating an account requires this code. Set it before sharing the app with anyone |
| `CLAUDE_MODEL` | No | Default selection in the model picker (default `claude-opus-5-5`) |

`.env.local` is git-ignored, so never commit it.

### Ports

| Service | Port |
|---|---|
| App (`npm run dev` / `npm start`) | **4747** |
| PostgreSQL (localhost only) | **5499** |

Both were chosen so they don't clash with the other projects in `~/IdeaProjects` and `~/PycharmProjects`.

## Using the app

1. **Log in** (or create an account). Your name, **Scoreboard** and **Log out** are in the header.
2. **Home:** pick a subject.
3. **Setup:** choose the options below and click **Start quiz**.
4. **Quiz:** answer each question. Under its tags, each question shows your history with it.
5. **Results:**
   - your total score, with breakdowns by difficulty and by topic;
   - token usage;
   - a review of every question, where you can try questions again or ask follow-ups.

### Quiz options

| Option | Choices |
|---|---|
| Topics | Any combination of the subject's topics (All / None shortcuts) |
| Questions come from | **My markdown files**: questions and answer keys from your files in `content/` (you add these; see [Adding your own questions](#adding-your-own-questions)). **AI-generated**: Claude writes new questions, each with its own answer key. |
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

## Accounts and login

Every page and API route needs a login. Without one, pages redirect to `/login` and API routes return `401`.

- **Create account:** a username (3–32 letters, numbers, dots, dashes or underscores) and a password of at least 8 characters. Usernames ignore case, so `Sony` and `sony` are the same account; the name is shown as you typed it. If `SIGNUP_CODE` is set, the form also asks for it.
- **Passwords** are stored as salted `scrypt` hashes (Node's built-in `crypto`), never in plain text.
- **Sessions** last 30 days. The browser gets a random token in an `httpOnly`, `SameSite=Lax` cookie (`sq_session`, also `Secure` in production); the database stores only its SHA-256 hash. **Log out** deletes the session.
- `proxy.ts` (Next.js 16's name for middleware) turns away requests without the cookie. Every page and route then checks the session against the database (`currentUser()` in `lib/auth.ts`).
- There's no password reset yet. To remove an account and its history: `npm run db:psql`, then `DELETE FROM users WHERE username = 'name';`.

**Attempts from before login.** Attempts saved before accounts existed belonged to nobody. The first time the new version connects to the database, it creates three accounts named `testuser-<adjective>-<animal>` (e.g. `testuser-amber-falcon`) and gives each old attempt to one of them at random. These accounts have no password, so nobody can log in as them, and new usernames can't start with `testuser-`. This runs once, inside a transaction.

## Scoreboard

**Scoreboard** in the header shows one row per person and topic:

| Column | Meaning |
|---|---|
| Name | Who answered (the account's display name) |
| Topic | The topic, with its subject underneath when all subjects are shown |
| Correct | Attempts graded fully correct. "+N partly" underneath counts partly correct ones |
| Wrong | Attempts graded incorrect, plus **Show answer** |
| % completed | Saved questions in the topic's file answered at least once, e.g. "50% · 7 of 14" |
| Last attempted | When that person last answered a question in the topic |

- Click any column header to sort, and click again to reverse.
- Only topics with at least one attempt are listed. Filter by **Name** and **Subject**.
- Click a row to list **every question in the topic**, with how many times that person attempted it and how many times they got it right, plus difficulty and type.
- Correct, Wrong and Last attempted include AI-generated questions in the topic. % completed and the question list only cover the questions in your markdown files. Attempts on AI-generated questions, or on questions you've since edited, are noted under the list.

## Question history (database)

Every graded attempt is saved to **PostgreSQL 18.6** running in Docker:
- compose file: `docker-compose.yml`
- container: `study-quiz-db`
- port: `5499`, reachable only from your machine

History is per person: you only see your own attempts. Under its tags, each question shows:
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
| `users` | One row per account: id, username (lowercase), display name, password hash (empty for `testuser-` accounts), created |
| `sessions` | One row per login: SHA-256 of the session token, user id, created, expires |
| `questions` | One row per question ever attempted: id, subject, topic, source (`file`/`ai`), difficulty, question text, first seen |
| `attempts` | One row per graded attempt: question id, user id, score, verdict, evaluation mode (`manual`/`ai`), timestamp |

Schema changes (like the `user_id` column added with login) are applied automatically and safely when the app starts, even if two server processes start at once.

**Question IDs** are a hash of the subject, topic and question text. History stays with a question when you add, remove or reorder questions in a file. Editing a question's text makes it a new question with fresh history. AI-generated questions are stored too, though they rarely come up again.

If the database isn't running, nobody can log in; the login page and the scoreboard say so. If it goes down during a quiz, the quiz keeps working, but questions show "History unavailable" and attempts aren't saved.

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

## Adding your own questions

> **Note: question files aren't part of the repository.** The `content/` folder is git-ignored, so a fresh clone has no subjects.
> - **If you use "Questions come from: My markdown files",** add your own question files to `content/` in the format below before starting a quiz. The app only asks questions that are in these files, and it grades against the answers you write in them.
> - **If you only use "AI-generated",** you still need a topic file per topic, because the topic list comes from these files. A file with just the frontmatter is enough, and its `focus:` list and notes steer Claude's questions.

### Where files go

A folder is a subject and a markdown file is a topic:

```
content/
  kotlin/
    generics.md
    coroutines.md
  kafka/
    producers.md
    consumers.md
```

New or edited files show up when you reload the page, in `npm run dev` and in production (pages are rendered per request because they check your login).

### File format

Each file starts with YAML frontmatter, followed by questions. Each question begins with a `## Q:` heading. Here's one of each question type:

````markdown
---
subject: Kotlin          # subject display name (use the same value in every file of the folder)
topic: Coroutines        # topic display name
order: 3                 # optional: sorts topics on the setup page
focus:                   # optional: steers AI-generated questions for this topic
  - structured concurrency and scopes
  - dispatchers
---

Optional notes before the first question. Claude uses them as context when generating questions.

## Q: Which builder returns a `Deferred<T>`?
difficulty: easy
- [ ] launch
- [x] async
- [ ] runBlocking
explanation: `async` returns `Deferred<T>`; `launch` returns `Job`.

## Q: Which of these are coroutine dispatchers?
type: multi
difficulty: medium
- [x] Dispatchers.IO
- [x] Dispatchers.Default
- [ ] Dispatchers.Network
explanation: The built-in dispatchers are Default, IO, Main and Unconfined.

## Q: What does this print?
type: short
difficulty: medium
```kotlin
println(listOf(1, 2, 3).map { it * 2 }.sum())
```
answer: 12
explanation: Doubling gives 2, 4, 6, which sum to 12.

## Q: Explain the difference between `launch` and `async`.
type: freetext
difficulty: hard
answer: |
Both start a coroutine. `launch` is fire-and-forget and returns a `Job`;
`async` returns a `Deferred<T>` whose result you get with `await()`...
rubric: Mentions Job vs Deferred, await(), and how exceptions propagate.
explanation: Use `launch` for side effects and `async` when you need a result.
````

### Fields

| Field | Required | Meaning |
|---|---|---|
| `## Q: <text>` | Yes | Starts a question. The heading text plus any lines below it (including fenced code) form the question. |
| `- [ ]` / `- [x]` | For `mcq` and `multi` | Answer options; `[x]` marks the correct ones. |
| `answer:` | For `short` and `freetext` | The answer key. For `short`, the exact expected answer; for `freetext`, a model answer. |
| `type:` | No | `mcq`, `multi`, `short` or `freetext`. If omitted: one `[x]` makes `mcq`, several make `multi`, and no options makes `freetext`. |
| `difficulty:` | No | `easy` (1 pt), `medium` (2 pts, the default) or `hard` (3 pts). |
| `accept:` | No | Other exact answers for `short` questions, separated by `\|`, e.g. `accept: inline \| inline fun`. |
| `explanation:` | Recommended | Shown after the question is graded. |
| `rubric:` | Recommended for `freetext` | Key points a full-credit answer must contain. Claude grades against it, and manual grading shows it as a checklist. |

### Rules

- **Every question must include its answer:** `[x]` on the correct options, or an `answer:` line. Questions without an answer are skipped, with a warning in the server log, because grading always compares against your key.
- Field lines go *after* the question text and code. Field names must start at the beginning of a line, outside code fences.
- `answer: |` (or `explanation: |`, `rubric: |`) starts a multi-line value. It runs until the next field line or option, and can contain code fences.
- `short` answers are compared ignoring case, extra spaces, quotes, backticks and a trailing period. Anything else goes to Claude (AI evaluation) or to you (manual evaluation).
- YAML list items that start with a backtick (`` ` ``) break the frontmatter, so reword them or wrap them in quotes.
- Editing a question's text gives it a new ID, so its history in the database starts over. Reordering or adding questions doesn't.

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
| `content/` | Your subjects (folders) and topics (markdown files); git-ignored |
| `proxy.ts` | Sends requests without a session cookie to `/login` (pages) or answers `401` (API) |
| `app/layout.tsx` | Header with your name, Scoreboard and Log out |
| `app/page.tsx` | Home page: subject list |
| `app/login/page.tsx` | Log in / create account |
| `app/[subject]/page.tsx` | Subject page (renders the quiz) |
| `app/scoreboard/page.tsx` | Scoreboard |
| `components/QuizApp.tsx` | Setup, quiz, results, follow-ups, history and token usage UI |
| `components/AuthForm.tsx` | Login and sign-up form |
| `components/Scoreboard.tsx` | Scoreboard table, filters, sorting and per-question drill-down |
| `components/Md.tsx` | Markdown rendering for questions and answers |
| `lib/content.ts` | Reads and parses `content/` |
| `lib/question-id.ts` | Stable question IDs (content hash) |
| `lib/scoring.ts` | Answer-key grading, self-grading, shuffling, points |
| `lib/claude.ts` | Claude calls: generation, grading, follow-up streaming, token usage |
| `lib/models.ts` | Model list, prices, cost estimates |
| `lib/auth.ts` | Password hashing, sessions and cookies, `currentUser()` / `requireUser()` |
| `lib/db.ts` | PostgreSQL pool, schema and migrations, users, sessions, attempts, stats and scoreboard queries |
| `lib/scoreboard.ts` | Combines database totals with the question files for the scoreboard |
| `lib/api-schemas.ts` | Request validation (zod) for all API routes |
| `app/api/generate` | Generate questions |
| `app/api/grade` | AI-grade an answer |
| `app/api/followup` | Stream a follow-up reply |
| `app/api/stats` | Load history for a set of questions |
| `app/api/attempts` | Record an attempt and return updated history |
| `app/api/auth/login`, `signup`, `logout` | Accounts and sessions |
| `app/api/scoreboard/topic` | Every question in a topic with one person's attempts |
| `docs/sequence-diagram.md` | Sequence diagrams of login, a quiz, and the scoreboard |
| `docker-compose.yml` | PostgreSQL 18.6 with a persistent volume |

Built with Next.js 16, React 19, TypeScript 7, the Anthropic TypeScript SDK, zod 4, node-postgres and gray-matter, all at their latest versions.

## Troubleshooting

- **No subjects on the home page:** `content/` is empty (it isn't in the repository). Add question files as described in [Adding your own questions](#adding-your-own-questions).
- **"History unavailable"** or **"Can't reach the database"** on the login page: the database isn't running. Start it with `npm run db:up`.
- **Sent back to the login page:** your session expired (after 30 days) or you logged out in another tab. Log in again.
- **"Wrong username or password":** usernames ignore case, passwords don't. There's no reset yet; see [Accounts and login](#accounts-and-login).
- **AI options are greyed out:** `ANTHROPIC_API_KEY` is missing from `.env.local`. Add it and restart `npm run dev`.
- **A request fails with a 500 right after editing code:** the dev server was still recompiling. Send it again.
- **"Grading failed":** use **Retry grading** on that question in the results review.

## Before deploying

- Set `ANTHROPIC_API_KEY` and `DATABASE_URL` as environment variables on the host. Use a managed PostgreSQL database in production; the tables are created automatically.
- **Set `SIGNUP_CODE`.** Every page and API route requires a login, but without a sign-up code anyone who finds the URL can create an account and use your Anthropic key.
- Serve it over **HTTPS**. In production the session cookie is marked `Secure`, so logins don't work over plain HTTP.
- Content is read on each request, so edited markdown files show up without a redeploy (if the files are on the server).
- Set a monthly spend limit on the key in the Anthropic Console.
