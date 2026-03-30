import * as React from "react"
import * as fcl from "@onflow/fcl"
import "../flow/config"

interface AuthUser {
  userAddress: string;
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
    fcl.currentUser.subscribe((currentUser: any) => {
      if (currentUser?.loggedIn) {
        setUser({
          userAddress: currentUser.addr,
          displayName: currentUser.addr,
          sessionToken: "flow_session" // placeholder logic
        })
      } else {
        setUser(null)
      }
    })
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
