import * as React from "react"
import * as fcl from "@onflow/fcl"
import "../flow/config"

interface AuthUser {
  userAddress: string; // Flow address
  evmAddress: string;
  displayName?: string;
  sessionToken: string;
}

interface AuthContextType {
  user: AuthUser | null;
  login: () => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = React.createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null)

  React.useEffect(() => {
    const unsubscribe = fcl.currentUser.subscribe(async (currentUser: any) => {
      if (currentUser?.loggedIn) {
        const flowAddress = currentUser?.addr ?? "";
        if (!flowAddress) {
          setUser(null);
          return;
        }

        try {
          const response = await fetch("/api/auth/flow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              method: "passkey",
              userAddress: flowAddress,
            }),
          });
          if (!response.ok) {
            throw new Error(`Flow auth failed with status ${response.status}`);
          }
          const auth = await response.json();

          setUser({
            userAddress: auth.userAddress,
            evmAddress: auth.userEvmAddress,
            displayName: auth.displayName ?? auth.userAddress,
            sessionToken: auth.sessionToken,
          });
        } catch {
          setUser(null);
        }
      } else {
        setUser(null)
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [])

  const login = () => {
    fcl.authenticate()
  }

  const logout = () => {
    fcl.unauthenticate()
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
