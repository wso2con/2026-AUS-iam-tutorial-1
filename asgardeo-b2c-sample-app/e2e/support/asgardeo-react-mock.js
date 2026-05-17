import { createContext, createElement, useContext, useMemo, useState } from "react";

const AuthContext = createContext(null);
const SIGNED_IN_STORAGE_KEY = "wayfinder:e2e:isSignedIn";

const defaultUser = {
  sub: "user-e2e-001",
  id: "user-e2e-001",
  username: "mira.stone@example.com",
  userName: "mira.stone@example.com",
  email: "mira.stone@example.com",
  name: {
    givenName: "Mira",
    familyName: "Stone"
  },
  created_at: "2026-01-15T00:00:00.000Z"
};

function readInitialSignedInState() {
  if (typeof window === "undefined") {
    return true;
  }

  return window.localStorage.getItem(SIGNED_IN_STORAGE_KEY) !== "false";
}

export function AsgardeoProvider({ children }) {
  const [isSignedIn, setIsSignedIn] = useState(readInitialSignedInState);

  const value = useMemo(() => ({
    getAccessToken: async () => "e2e-access-token",
    isLoading: false,
    isSignedIn,
    signIn: async () => {
      window.localStorage.setItem(SIGNED_IN_STORAGE_KEY, "true");
      setIsSignedIn(true);
    },
    signOut: async () => {
      window.localStorage.setItem(SIGNED_IN_STORAGE_KEY, "false");
      setIsSignedIn(false);
    },
    user: isSignedIn ? defaultUser : null
  }), [isSignedIn]);

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAsgardeo() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAsgardeo must be used within AsgardeoProvider");
  }

  return context;
}
