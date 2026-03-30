import * as React from "react"
import { useLocation } from "wouter"
import { motion } from "framer-motion"
import { Fingerprint, MonitorSmartphone, Mail, ShieldCheck } from "lucide-react"
import { useFlowAuth } from "@/api"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function Login() {
  const [, setLocation] = useLocation()
  const { login, isAuthenticated } = useAuth()
  const { toast } = useToast()

  const authMutation = useFlowAuth({
    mutation: {
      onSuccess: (data) => {
        login({
          userAddress: data.userAddress,
          displayName: data.displayName,
          sessionToken: data.sessionToken
        })
        toast({
          title: "Connected via Flow",
          description: "Walletless onboarding successful.",
          variant: "success"
        })
        setLocation("/dashboard")
      },
      onError: () => {
        toast({
          title: "Authentication Failed",
          description: "Could not connect to Flow network.",
          variant: "destructive"
        })
      }
    }
  })

  React.useEffect(() => {
    if (isAuthenticated) {
      setLocation("/dashboard")
    }
  }, [isAuthenticated, setLocation])

  const handleLogin = (method: "passkey" | "google" | "apple" | "email") => {
    authMutation.mutate({ data: { method } })
  }

  return (
    <div className="relative min-h-[80vh] flex items-center justify-center">
      {/* Background Graphic */}
      <div className="absolute inset-0 z-0 flex items-center justify-center opacity-30 pointer-events-none">
        <img
          src={`${import.meta.env.BASE_URL}images/cyberpunk-bg.png`}
          alt="Cyberpunk Grid"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm"></div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10"
      >
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 items-center justify-center mb-4 shadow-[0_0_30px_rgba(0,255,65,0.2)]">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl font-bold text-foreground font-sans tracking-tight mb-2">
            X4PN <span className="text-primary">dVPN</span>
          </h1>
          <p className="text-muted-foreground text-lg">Confidential. Fast. Walletless.</p>
        </div>

        <Card className="border-primary/20 bg-black/60">
          <CardHeader className="text-center pb-4">
            <CardTitle>Sign In</CardTitle>
            <CardDescription>Powered by Flow Account Abstraction</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="w-full h-12 text-md flex items-center gap-3"
              onClick={() => handleLogin("passkey")}
              disabled={authMutation.isPending}
            >
              <Fingerprint className="w-5 h-5" />
              {authMutation.isPending ? "Connecting..." : "Use Passkey / Biometrics"}
            </Button>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border"></span>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleLogin("google")}
                disabled={authMutation.isPending}
              >
                <MonitorSmartphone className="w-4 h-4 mr-2 text-secondary" />
                Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleLogin("email")}
                disabled={authMutation.isPending}
              >
                <Mail className="w-4 h-4 mr-2 text-secondary" />
                Email
              </Button>
            </div>

            <div className="mt-6 pt-4 border-t border-border/50 text-center text-xs text-muted-foreground">
              <p>No seed phrases. No gas fees.</p>
              <p className="mt-1 text-primary/60 font-mono">Sponsored by Flow Autopilot.</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
