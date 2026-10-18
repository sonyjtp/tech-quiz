import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { buildScoreboard, type Scoreboard as Data } from "@/lib/scoreboard";
import { DB_DOWN } from "@/lib/api-errors";
import { Scoreboard } from "@/components/Scoreboard";

export const metadata = { title: "Scoreboard · Study Quiz" };

export default async function ScoreboardPage() {
  const user = await requireUser("/scoreboard");
  let data: Data | null = null;
  try {
    data = await buildScoreboard();
  } catch (err) {
    console.error(err);
  }
  return (
    <>
      <p className="crumbs"><Link href="/">Subjects</Link> / Scoreboard</p>
      <h1>Scoreboard</h1>
      {data ? <Scoreboard data={data} me={user.id} /> : <div className="error">{DB_DOWN}</div>}
    </>
  );
}
