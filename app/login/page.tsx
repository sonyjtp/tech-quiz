import { redirect } from "next/navigation";
import { currentUser, safeNext, signupCode, PASSWORD_MIN, USERNAME_RULE } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";
import { AuthForm } from "@/components/AuthForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);

  return (
    <div className="auth">
      <h1>Study Quiz</h1>
      <p className="muted">Log in to track your scores. Your history and the scoreboard are saved per person.</p>
      {!dbConfigured() && (
        <div className="error">
          <code>DATABASE_URL</code> isn&apos;t set, so nobody can log in. Add it to <code>.env.local</code>, run{" "}
          <code>npm run db:up</code> and restart.
        </div>
      )}
      <AuthForm next={next} codeRequired={Boolean(signupCode())} usernameRule={USERNAME_RULE} passwordMin={PASSWORD_MIN} />
    </div>
  );
}
