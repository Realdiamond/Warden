import { createContext, useContext, useState, type ReactNode } from "react";
import { api, setToken, getToken } from "./api.ts";

interface AuthValue {
  authed: boolean;
  signIn: (email: string, password: string, signup: boolean) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => !!getToken());

  async function signIn(email: string, password: string, signup: boolean) {
    const result = signup ? await api.signup(email, password) : await api.login(email, password);
    setToken(result.token);
    setAuthed(true);
  }

  function signOut() {
    setToken(null);
    setAuthed(false);
  }

  return <Ctx.Provider value={{ authed, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
