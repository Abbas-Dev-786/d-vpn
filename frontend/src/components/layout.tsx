import * as React from "react"
import { Link, useLocation } from "wouter"
import { Shield, Activity, Menu, X, LogOut, Wallet } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "./ui/button"
import { cn } from "@/lib/utils"

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const [location] = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)

  const navLinks = [
    { href: "/dashboard", label: "Dashboard", icon: Shield },
    { href: "/nodes", label: "Node Registry", icon: Activity },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/30">
      {/* Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-primary flex items-center justify-center shadow-[0_0_15px_rgba(0,255,65,0.4)]">
                <Shield className="w-5 h-5 text-background" />
              </div>
              <span className="font-bold text-xl tracking-wider text-foreground">
                X4PN<span className="text-primary text-xs ml-1 align-top block uppercase">Confidential</span>
              </span>
            </div>

            {/* Desktop Nav */}
            {user && (
              <nav className="hidden md:flex items-center gap-8">
                {navLinks.map((link) => (
                  <Link 
                    key={link.href} 
                    href={link.href}
                    className={cn(
                      "flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary",
                      location === link.href ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    <link.icon className="w-4 h-4" />
                    {link.label}
                  </Link>
                ))}
              </nav>
            )}

            {/* User State & Mobile Toggle */}
            <div className="flex items-center gap-4">
              {user ? (
                <div className="hidden md:flex items-center gap-4">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent text-xs font-mono border border-primary/20">
                    <Wallet className="w-3 h-3 text-primary" />
                    <span className="text-primary/90">{user.userAddress.substring(0,6)}...{user.userAddress.substring(user.userAddress.length-4)}</span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => logout()} title="Disconnect Account">
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="hidden md:block text-sm text-muted-foreground">Not connected</div>
              )}

              <Button 
                variant="ghost" 
                size="icon" 
                className="md:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      {mobileMenuOpen && user && (
        <div className="md:hidden border-b border-border/50 bg-card p-4 space-y-4">
          <div className="flex flex-col gap-2">
            {navLinks.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg text-sm font-medium",
                  location === link.href ? "bg-primary/10 text-primary" : "text-muted-foreground"
                )}
                onClick={() => setMobileMenuOpen(false)}
              >
                <link.icon className="w-5 h-5" />
                {link.label}
              </Link>
            ))}
          </div>
          <div className="pt-4 border-t border-border flex items-center justify-between">
             <div className="flex items-center gap-2 text-xs font-mono text-primary/80">
              <Wallet className="w-4 h-4" />
              {user.userAddress}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { logout(); setMobileMenuOpen(false); }}>
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-6 text-center text-sm text-muted-foreground bg-background/50">
        <p>Built with <span className="text-primary font-bold">Zama fhEVM</span> & <span className="text-secondary font-bold">Flow Blockchain</span></p>
      </footer>
    </div>
  )
}
