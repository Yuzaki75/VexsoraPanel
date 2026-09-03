import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { PublicUser } from "@strixmc/shared";
import * as api from "../lib/api";

interface AuthContextType {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    try {
      const response = await api.get<{ user: PublicUser }>("/auth/me");
      setUser(response.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string, totpCode?: string) {
    const response = await api.post<{ user: PublicUser }>("/auth/login", {
      email,
      password,
      totpCode,
    });
    setUser(response.user);
  }

  async function register(email: string, username: string, password: string) {
    const response = await api.post<{ user: PublicUser }>("/auth/register", {
      email,
      username,
      password,
    });
    setUser(response.user);
  }

  async function logout() {
    await api.post("/auth/logout", {});
    setUser(null);
  }

  async function refreshUser() {
    await loadUser();
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
