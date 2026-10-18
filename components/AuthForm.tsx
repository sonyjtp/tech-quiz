"use client";

import React, {useState} from "react";
import {errorText, postJson} from "@/lib/client-api";

type Mode = "login" | "signup";

export function AuthForm({
                             next,
                             codeRequired,
                             usernameRule,
                             passwordMin,
                         }: {
    next: string;
    codeRequired: boolean;
    usernameRule: string;
    passwordMin: number;
}) {
    const [mode, setMode] = useState<Mode>("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [code, setCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const switchTo = (m: Mode) => {
        setMode(m);
        setError(null);
    };

    async function submit(e: React.SubmitEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);
        if (mode === "signup" && password !== confirm) return setError("The passwords don't match.");
        setBusy(true);
        try {
            // A 401 here means a wrong password, so don't redirect to the login page we're already on.
            await postJson(`/api/auth/${mode}`, mode === "signup" ? {username, password, code} : {username, password}, {
                redirectOn401: false,
            });
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
            return;
        }
        // Full navigation so the header and every server component see the new session.
        window.location.assign(next);
    }

    return (
        <form className="card auth-card" onSubmit={submit}>
            <div className="seg auth-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={mode === "login"}
                        className={mode === "login" ? "on" : ""} onClick={() => switchTo("login")}>
                    Log in
                </button>
                <button type="button" role="tab" aria-selected={mode === "signup"}
                        className={mode === "signup" ? "on" : ""} onClick={() => switchTo("signup")}>
                    Create account
                </button>
            </div>

            <label className="field">
                <div className="field-label">Username</div>
                <input value={username}
                       onChange={(e) =>
                           setUsername(e.target.value)} autoComplete="username" autoFocus
                       required/>
                {mode === "signup" && <div className="muted small">{usernameRule}</div>}
            </label>

            <label className="field">
                <div className="field-label">Password</div>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    minLength={mode === "signup" ? passwordMin : undefined}
                    required
                />
                {mode === "signup" && <div className="muted small">At least {passwordMin} characters.</div>}
            </label>

            {mode === "signup" && (
                <label className="field">
                    <div className="field-label">Confirm password</div>
                    <input type="password" value={confirm}
                           onChange={(e) => setConfirm(e.target.value)}
                           autoComplete="new-password" required/>
                </label>
            )}

            {mode === "signup" && codeRequired && (
                <label className="field">
                    <div className="field-label">Sign-up code</div>
                    <input value={code}
                           onChange={(e) => setCode(e.target.value)}
                           autoComplete="off" required/>
                    <div className="muted small">Ask whoever runs this app for the code.</div>
                </label>
            )}

            {error && <div className="error" role="alert">{error}</div>}

            <button type="submit" className="primary big" disabled={busy}>
                {busy ? "One moment…" : mode === "login" ? "Log in" : "Create account"}
            </button>
        </form>
    );
}
