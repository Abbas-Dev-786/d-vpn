import * as React from "react"
import { useListNodes, useRegisterNode, useWithdrawNodeEarnings, getListNodesQueryKey } from "@/api"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/hooks/use-auth"
import { FheBadge } from "@/components/fhe-badge"
import { Server, MapPin, Plus, DollarSign, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default function Nodes() {
  const { data, isLoading } = useListNodes()
  const { toast } = useToast()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [isRegistering, setIsRegistering] = React.useState(false)
  const [formData, setFormData] = React.useState({ name: "", evmAddress: "", flowAddress: "", location: "" })

  const registerMutation = useRegisterNode({
    mutation: {
      onSuccess: () => {
        toast({ title: "Node Registered", description: "Your node is now part of the Confidential-X4PN network.", variant: "success" })
        setIsRegistering(false)
        setFormData({ name: "", evmAddress: "", flowAddress: "", location: "" })
        queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() })
      },
      onError: (err) => toast({ title: "Registration Failed", description: err.message, variant: "destructive" })
    }
  })

  const withdrawMutation = useWithdrawNodeEarnings({
    mutation: {
      onSuccess: (res) => {
        toast({
          title: "Withdrawal Initiated",
          description: `Decrypted ${res.amount} FLOW. Tx: ${res.txHash.substring(0, 10)}...`,
          variant: "success"
        })
        queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() })
      },
      onError: (err) => toast({ title: "Withdrawal Failed", description: err.message, variant: "destructive" })
    }
  })

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.evmAddress || !formData.flowAddress || !formData.location) {
      toast({ title: "Validation Error", description: "Name, EVM address, Flow address, and location are required", variant: "destructive" })
      return
    }
    registerMutation.mutate({
      data: {
        name: formData.name,
        location: formData.location,
        evmAddress: formData.evmAddress,
        flowAddress: formData.flowAddress,
      },
    })
  }

  return (
    <div className="space-y-8 pb-12">

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-sans tracking-tight mb-2">Node Registry</h1>
          <p className="text-muted-foreground max-w-2xl">
            Decentralized VPN providers. Earnings are computed on FHE encrypted session data, ensuring node providers never see user metadata.
          </p>
        </div>
        <Button
          onClick={() => setIsRegistering(!isRegistering)}
          className="shrink-0"
          variant={isRegistering ? "outline" : "default"}
        >
          {isRegistering ? "Cancel Registration" : <><Plus className="w-4 h-4 mr-2" /> Register Node</>}
        </Button>
      </div>

      {isRegistering && (
        <Card className="border-primary/40 shadow-[0_0_30px_rgba(0,255,65,0.1)]">
          <CardHeader>
            <CardTitle>Register New Node</CardTitle>
            <CardDescription>Join the network and earn FLOW tokens blindly.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="grid md:grid-cols-5 gap-4 items-end">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Node Name</label>
                <Input
                  placeholder="e.g. Titan-Alpha"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider EVM Address</label>
                <Input
                  placeholder="0x..."
                  value={formData.evmAddress}
                  onChange={(e) => setFormData({ ...formData, evmAddress: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</label>
                <Input
                  placeholder="e.g. Frankfurt, DE"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Flow EVM Address</label>
                <Input
                  placeholder="0x..."
                  value={formData.flowAddress}
                  onChange={(e) => setFormData({ ...formData, flowAddress: e.target.value })}
                />
              </div>
              <Button type="submit" disabled={registerMutation.isPending} className="w-full">
                {registerMutation.isPending ? "Registering..." : "Submit"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-3 text-center py-12 text-muted-foreground animate-pulse">Loading nodes...</div>
        ) : data?.nodes?.length === 0 ? (
          <div className="col-span-3 text-center py-12 border border-dashed border-border rounded-xl text-muted-foreground">
            No nodes registered on the network yet.
          </div>
        ) : (
          data?.nodes?.map((node) => (
            <Card key={node.nodeId} className="group hover:border-primary/40 transition-all duration-300">
              <CardHeader className="pb-4 border-b border-border/30">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Server className="w-4 h-4 text-primary" />
                      {node.name}
                    </CardTitle>
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3" />
                      {node.location}
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded text-[10px] uppercase font-bold tracking-wider ${node.isActive ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-muted text-muted-foreground border border-border'
                    }`}>
                    {node.isActive ? "Active" : "Offline"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider flex items-center gap-1"><Activity className="w-3 h-3" /> Uptime</p>
                    <p className="font-mono text-foreground font-semibold">{node.uptimePercent}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Sessions</p>
                    <p className="font-mono text-foreground font-semibold">{node.sessionCount}</p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-background/50 border border-border flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider flex justify-between items-center">
                    Earnings (Unrealized)
                  </p>
                  <FheBadge value={node.encryptedEarnings} label="FHE Node Balance" className="w-full" />
                </div>

                <Button
                  variant="outline"
                  className="w-full text-xs h-9"
                  onClick={() => withdrawMutation.mutate({
                    nodeId: node.nodeId,
                    data: {
                      callerEvmAddress: user?.evmAddress ?? node.address,
                      idempotencyKey: crypto.randomUUID(),
                    },
                  })}
                  disabled={withdrawMutation.isPending || withdrawMutation.variables?.nodeId === node.nodeId}
                >
                  <DollarSign className="w-3 h-3 mr-1" />
                  {withdrawMutation.variables?.nodeId === node.nodeId && withdrawMutation.isPending
                    ? "Decrypting & Withdrawing..."
                    : "Withdraw Earnings"}
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>

    </div>
  )
}
