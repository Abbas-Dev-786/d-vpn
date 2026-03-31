import * as React from "react"
import * as fcl from "@onflow/fcl"
import "../flow/config"
import { setAuthTokenGetter } from "../api/custom-fetch"

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

  // Use a ref to store the token for the auth getter, avoiding closure staleness
  const sessionTokenRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    // Register the token getter with the API client
    setAuthTokenGetter(() => sessionTokenRef.current);
  }, []);

  React.useEffect(() => {
    const unsubscribe = fcl.currentUser.subscribe(async (currentUser: any) => {
      if (currentUser?.loggedIn) {
        const flowAddress = currentUser?.addr ?? "";
        if (!flowAddress) {
          setUser(null);
          sessionTokenRef.current = null;
          return;
        }

        try {
          // 1. Sign a message to prove ownership (Hardening requirement)
          const msg = `flow-auth:${flowAddress}`;
          const msgHex = Buffer.from(msg).toString("hex");
          const signResponse = await fcl.currentUser.signUserMessage(msgHex);
          
          if (!signResponse || signResponse.length === 0) {
            throw new Error("User canceled signature or signature failed");
          }
          
          // FCL signUserMessage returns an array of signatures (for multi-sig support)
          // We take the first one; backend ether.verifyMessage expects a standard signature string.
          const credential = signResponse[0].signature;

          // 2. Call backend with the credential
          const response = await fetch("/api/auth/flow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              method: "passkey",
              userAddress: flowAddress,
              credential,
            }),
          });
          
          if (!response.ok) {
            throw new Error(`Flow auth failed with status ${response.status}`);
          }
          const auth = await response.json();

          const newUser = {
            userAddress: auth.userAddress,
            evmAddress: auth.userEvmAddress,
            displayName: auth.displayName ?? auth.userAddress,
            sessionToken: auth.sessionToken,
          };
          
          sessionTokenRef.current = auth.sessionToken;
          setUser(newUser);
        } catch (err) {
          console.error("Auth error:", err);
          setUser(null);
          sessionTokenRef.current = null;
        }
      } else {
        setUser(null);
        sessionTokenRef.current = null;
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
