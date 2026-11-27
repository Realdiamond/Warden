import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../auth.tsx";
import { ApiError } from "../api.ts";
import { Logo } from "../components/Logo.tsx";

function friendly(code: string): string {
  switch (code) {
    case "invalid_credentials":
      return "Wrong email or password.";
    case "email_taken":
      return "That email already has an account. Try signing in.";
    case "invalid_body":
      return "Enter a valid email and a password of at least 8 characters.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password, mode === "signup");
      nav("/devices");
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err.code) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const signup = mode === "signup";

  return (
    <div className="auth">
      <div className="auth-aside">
        <span className="brand">
          <Logo size={32} />
          Monitor
        </span>
        <div>
          <h1>See how the family's phones are doing.</h1>
          <p>
            Everyone who is monitored agrees first, and the phone shows a notice the whole time.
          </p>
        </div>
      </div>
      <div className="auth-main">
        <div className="auth-card">
          <h2>{signup ? "Create your account" : "Welcome back"}</h2>
          <form onSubmit={submit} noValidate>
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={signup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() =>
                  setFieldError(
                    signup && password.length > 0 && password.length < 8
                      ? "Use at least 8 characters."
                      : null,
                  )
                }
                required
                minLength={8}
                aria-describedby={fieldError ? "pw-hint" : undefined}
              />
            </label>
            {fieldError && (
              <p className="error" id="pw-hint" role="alert">
                {fieldError}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy}>
              {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
              {!busy && <ArrowRight size={16} />}
            </button>
          </form>
          <button className="link" onClick={() => setMode(signup ? "login" : "signup")}>
            {signup ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </div>
      </div>
    </div>
  );
}
