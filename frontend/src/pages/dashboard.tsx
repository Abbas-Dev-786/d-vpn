import * as React from "react"
import { motion } from "framer-motion"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import {
  useStartSession,
  useEndSession,
  useGetSessionHistory,
  useListNodes,
  useSchedulePayment,
  useListPaymentSchedules,
  getGetSessionHistoryQueryKey,
  getListPaymentSchedulesQueryKey
} from "@/api"
import { useQueryClient } from "@tanstack/react-query"
import { FheBadge } from "@/components/fhe-badge"
import { encryptSessionTime } from "@/lib/fhe"
import { format } from "date-fns"
import { Power, Activity, ShieldAlert, Lock, Clock, Calendar, Zap, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default function Dashboard() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Track active session purely in local UI state for the demo
  // In a real app this would sync with a backend socket or polling
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null)
  const [sessionStartTime, setSessionStartTime] = React.useState<number | null>(null)
  const [elapsedTime, setElapsedTime] = React.useState<string>("00:00:00")

  const [budgetAmount, setBudgetAmount] = React.useState("5.00")
  const [frequency, setFrequency] = React.useState<"monthly" | "weekly">("monthly")

  // API Hooks
  const { data: nodesData } = useListNodes()
  const historyParams = { userAddress: user?.userAddress || "" }
  const { data: historyData } = useGetSessionHistory(
    historyParams,
    { query: { enabled: !!user, queryKey: getGetSessionHistoryQueryKey(historyParams) } }
  )
  const schedulesParams = { userAddress: user?.userAddress || "" }
  const { data: schedulesData } = useListPaymentSchedules(
    schedulesParams,
    { query: { enabled: !!user, queryKey: getListPaymentSchedulesQueryKey(schedulesParams) } }
  )

  const startMutation = useStartSession({
    mutation: {
      onSuccess: (data) => {
        setActiveSessionId(data.sessionId)
        setSessionStartTime(Date.now())
        toast({ title: "VPN Connected", description: "Traffic secured. Metadata encrypted via FHE.", variant: "success" })
        queryClient.invalidateQueries({ queryKey: getGetSessionHistoryQueryKey({ userAddress: user!.userAddress }) })
      },
      onError: (err) => toast({ title: "Connection Failed", description: err.message, variant: "destructive" })
    }
  })

  const endMutation = useEndSession({
    mutation: {
      onSuccess: () => {
        setActiveSessionId(null)
        setSessionStartTime(null)
        setElapsedTime("00:00:00")
        toast({ title: "VPN Disconnected", description: "Session ended. Payment settled confidentially.", variant: "default" })
        queryClient.invalidateQueries({ queryKey: getGetSessionHistoryQueryKey({ userAddress: user!.userAddress }) })
      },
      onError: (err) => toast({ title: "Disconnection Error", description: err.message, variant: "destructive" })
    }
  })

  const scheduleMutation = useSchedulePayment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Autopilot Activated", description: "Flow will now automatically handle your VPN budget.", variant: "success" })
        queryClient.invalidateQueries({ queryKey: getListPaymentSchedulesQueryKey({ userAddress: user!.userAddress }) })
      }
    }
  })

  // Timer Effect
  React.useEffect(() => {
    if (!sessionStartTime) return
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - sessionStartTime) / 1000)
      const h = Math.floor(diff / 3600).toString().padStart(2, "0")
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, "0")
      const s = (diff % 60).toString().padStart(2, "0")
      setElapsedTime(`${h}:${m}:${s}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [sessionStartTime])

  const handleToggleVpn = async () => {
    if (!user) return

    // In a real app, this should be the deployed DVPN.sol address and fetched natively
    const CONTRACT_ADDRESS = "0x00000000000000000000000000000000DVPNMOCK"

    if (activeSessionId) {
      try {
        const { handle, inputProof } = await encryptSessionTime(CONTRACT_ADDRESS, user.userAddress, Date.now())
        endMutation.mutate({
          data: {
            sessionId: activeSessionId,
            // For now, we will just send the handle if backend schema takes 1 string, or stringified payload
            // Ideally backend schema will be updated to accept handle + proof
            encryptedEndTime: JSON.stringify({ handle, inputProof })
          }
        })
      } catch (err) {
        toast({ title: "Encryption Failed", description: "Could not safely encrypt session end time", variant: "destructive" })
      }
    } else {
      const firstNode = nodesData?.nodes?.[0]
      if (!firstNode) {
        toast({ title: "No Nodes Available", description: "Please wait or register a node first.", variant: "destructive" })
        return
      }
      try {
        const { handle, inputProof } = await encryptSessionTime(CONTRACT_ADDRESS, user.userAddress, Date.now())
        startMutation.mutate({
          data: {
            userAddress: user.userAddress,
            nodeId: firstNode.nodeId,
            encryptedStartTime: JSON.stringify({ handle, inputProof })
          }
        })
      } catch (err) {
        toast({ title: "Encryption Failed", description: "Could not safely encrypt session start time", variant: "destructive" })
      }
    }
  }

  const handleSchedulePayment = () => {
    if (!user) return
    scheduleMutation.mutate({
      data: {
        userAddress: user.userAddress,
        budgetAmount: parseFloat(budgetAmount) || 5,
        frequency
      }
    })
  }

  const isConnected = !!activeSessionId;
  const activeNode = isConnected ? (nodesData?.nodes?.[0] ?? null) : null; // Mock finding the active node

  if (!user) return null

  return (
    <div className="space-y-8 pb-12">
      {/* VPN Connection Hero */}
      <Card className="overflow-hidden border-0 bg-transparent shadow-none">
        <div className="grid md:grid-cols-2 gap-8 items-center">

          <div className="flex flex-col items-center justify-center p-12 rounded-3xl border border-border/50 bg-card/40 backdrop-blur-md shadow-2xl relative overflow-hidden">
            {/* Pulsing background ring if connected */}
            {isConnected && (
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.1, 0.3] }}
                transition={{ duration: 4, repeat: Infinity }}
                className="absolute inset-0 bg-primary/20 rounded-full blur-[100px] -z-10"
              />
            )}

            <Button
              onClick={handleToggleVpn}
              disabled={startMutation.isPending || endMutation.isPending}
              className={`w-48 h-48 rounded-full shadow-2xl flex flex-col items-center justify-center gap-4 transition-all duration-500
                ${isConnected
                  ? 'bg-primary hover:bg-primary/90 text-background shadow-[0_0_60px_rgba(0,255,65,0.6)]'
                  : 'bg-card hover:bg-card/80 text-foreground border-4 border-muted hover:border-primary/50 shadow-inner'}`}
            >
              <Power className={`w-16 h-16 ${isConnected ? 'text-background' : 'text-muted-foreground'}`} />
              <span className="font-bold text-xl tracking-widest">
                {isConnected ? 'DISCONNECT' : 'CONNECT'}
              </span>
            </Button>

            <div className="mt-8 text-center h-20">
              {isConnected ? (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="text-4xl font-mono font-bold text-primary tracking-wider cyber-glitch">
                    {elapsedTime}
                  </div>
                  <div className="text-primary/80 flex items-center justify-center gap-2 mt-2 text-sm">
                    <Activity className="w-4 h-4 animate-pulse" />
                    Routing via {activeNode?.location || "Secure Gateway"}
                  </div>
                </motion.div>
              ) : (
                <div className="text-muted-foreground font-mono">
                  SYSTEM STANDBY<br />Ready to encrypt traffic
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <h2 className="text-3xl font-bold font-sans">
              Total Privacy. <span className="text-primary">Zero Trust.</span>
            </h2>
            <p className="text-muted-foreground text-lg">
              Unlike standard dVPNs, Confidential-X4PN never exposes your connection times, duration, or payment amounts on a public ledger.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-background/40">
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="uppercase tracking-wider text-xs">Sessions This Month</CardDescription>
                  <CardTitle className="text-2xl font-mono">{historyData?.total || 0}</CardTitle>
                </CardHeader>
              </Card>
              <Card className="bg-background/40">
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="uppercase tracking-wider text-xs flex items-center gap-1"><Lock className="w-3 h-3" /> Estimated Spend</CardDescription>
                  <CardTitle className="text-2xl font-mono text-secondary">~2.40 USD</CardTitle>
                </CardHeader>
              </Card>
            </div>
          </div>

        </div>
      </Card>

      {/* Main Grid: History & Autopilot */}
      <div className="grid lg:grid-cols-3 gap-8">

        {/* Session History */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Recent Sessions
            </CardTitle>
            <CardDescription>Your metadata is stored on the Zama fhEVM as encrypted ciphertexts.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border/50">
                  <tr>
                    <th className="px-4 py-3 font-medium">Session ID</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Cost</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData?.sessions?.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground italic">No sessions recorded yet.</td></tr>
                  )}
                  {historyData?.sessions?.map((s) => (
                    <tr key={s.sessionId} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {s.sessionId.substring(0, 8)}...
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-[10px] uppercase font-bold tracking-wider ${s.status === 'active' ? 'bg-primary/20 text-primary border border-primary/30' :
                          s.status === 'settled' ? 'bg-secondary/20 text-secondary border border-secondary/30' :
                            'bg-muted text-muted-foreground border border-border'
                          }`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {s.status === 'active' ? (
                          <span className="text-primary animate-pulse">Recording...</span>
                        ) : (
                          <FheBadge value={s.encryptedDuration} label="FHE Duration" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {s.status === 'active' ? '-' : (
                          <FheBadge value={s.encryptedAmount} label="FHE Payment Amount" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {format(new Date(s.createdAt), "MMM d, HH:mm")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Autopilot Setup */}
        <Card className="border-secondary/20 bg-gradient-to-b from-card to-background">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-secondary">
              <Calendar className="w-5 h-5" />
              Protect Me Autopilot
            </CardTitle>
            <CardDescription>
              Set a budget. Flow schedules the transactions. Zama processes them blindly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            {schedulesData?.schedules && schedulesData.schedules.length > 0 ? (
              <div className="p-4 rounded-xl border border-secondary/30 bg-secondary/5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Active Budget</span>
                  <span className="px-2 py-0.5 rounded bg-secondary/20 text-secondary text-xs uppercase font-bold">Active</span>
                </div>
                <div className="text-3xl font-mono font-bold text-foreground">
                  ${schedulesData.schedules[0].budgetAmount} <span className="text-base text-muted-foreground">/ {schedulesData.schedules[0].frequency}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Next execution: {format(new Date(schedulesData.schedules[0].nextDueAt), "PPP")}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Monthly Budget (USD)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      className="pl-8 font-mono text-lg"
                      value={budgetAmount}
                      onChange={(e) => setBudgetAmount(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Frequency</label>
                  <select
                    className="flex h-11 w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:border-secondary transition-all"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as "monthly" | "weekly")}
                  >
                    <option value="monthly" className="bg-card text-foreground">Monthly Replenish</option>
                    <option value="weekly" className="bg-card text-foreground">Weekly Replenish</option>
                  </select>
                </div>

                <Button
                  className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-[0_0_15px_rgba(0,255,255,0.3)] hover:shadow-[0_0_25px_rgba(0,255,255,0.5)] border-none"
                  onClick={handleSchedulePayment}
                  disabled={scheduleMutation.isPending}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Activate Autopilot
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Node Network Stats */}
      {nodesData && nodesData.nodes.length > 0 && (
        <div>
          <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-secondary" />
            Network Nodes
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {nodesData.nodes.slice(0, 5).map((node) => (
              <Card key={node.nodeId} className={`text-sm transition-all ${isConnected && activeNode?.nodeId === node.nodeId ? 'border-primary/60 shadow-[0_0_10px_rgba(0,255,65,0.2)]' : 'border-border/40'}`}>
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold truncate text-xs">{node.name}</span>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${node.isActive ? 'bg-primary' : 'bg-muted-foreground'}`} />
                  </div>
                  <div className="text-muted-foreground text-xs flex items-center gap-1">
                    <MapPin className="w-3 h-3 shrink-0" />{node.location}
                  </div>
                  <div className="text-xs text-secondary font-mono">{node.uptimePercent}% uptime</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="pt-8">
        <h3 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-primary" />
          The Technology
        </h3>
        <div className="grid md:grid-cols-3 gap-6">
          <Card className="bg-card/40 border-border/50 hover:border-primary/50 transition-colors">
            <CardHeader>
              <CardTitle className="text-lg">1. The Standard Problem</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              Most dVPNs store session metadata (start, end, bandwidth) on public blockchains. Even without IP addresses, this metadata graph reveals your exact usage patterns to anyone watching.
            </CardContent>
          </Card>
          <Card className="bg-card/40 border-border/50 hover:border-primary/50 transition-colors relative overflow-hidden">
            <div className="absolute top-0 right-0 p-2 opacity-10">
              <Lock className="w-24 h-24" />
            </div>
            <CardHeader>
              <CardTitle className="text-lg text-primary">2. FHE Confidentiality</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              X4PN encrypts all session metadata using Fully Homomorphic Encryption before it leaves your device. The smart contract calculates your payment blindly — it deducts your balance without ever decrypting the numbers.
            </CardContent>
          </Card>
          <Card className="bg-card/40 border-border/50 hover:border-secondary/50 transition-colors">
            <CardHeader>
              <CardTitle className="text-lg text-secondary">3. Flow Usability</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              Privacy usually means terrible UX. We use Flow's Account Abstraction so you log in with FaceID. Flow Autopilots automatically trigger the Zama FHE settlement layer when your budget needs replenishing.
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  )
}
