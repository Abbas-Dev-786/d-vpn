import { Lock } from "lucide-react"
import { truncateFhe } from "@/lib/fhe"
import { cn } from "@/lib/utils"

interface FheBadgeProps {
  value?: string | null;
  label?: string;
  className?: string;
}

export function FheBadge({ value, label = "FHE Encrypted", className }: FheBadgeProps) {
  if (!value) return <span className="text-muted-foreground">-</span>;

  return (
    <div className={cn("group relative inline-flex items-center gap-1.5", className)}>
      <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-primary/20 bg-primary/5 text-primary text-xs font-mono select-all cursor-help">
        <Lock className="w-3 h-3 opacity-70" />
        <span>{truncateFhe(value)}</span>
      </div>
      
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-xs opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
        <div className="bg-popover border border-popover-border shadow-xl rounded-lg p-3 text-xs leading-relaxed">
          <p className="font-semibold text-foreground mb-1 flex items-center gap-1">
            <Lock className="w-3 h-3 text-primary" />
            {label}
          </p>
          <p className="text-muted-foreground font-mono break-all text-[10px]">
            {value}
          </p>
          <div className="mt-2 text-[10px] text-secondary">
            Encrypted via Zama fhEVM. Computations occur blindly on-chain.
          </div>
        </div>
        {/* Triangle */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-popover-border"></div>
      </div>
    </div>
  )
}
