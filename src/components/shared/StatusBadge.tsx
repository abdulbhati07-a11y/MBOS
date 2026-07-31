import * as React from "react"
import { Badge } from "@/components/ui/badge"

export type StatusVariant = "success" | "warning" | "destructive" | "default" | "secondary" | "outline" | "ghost"

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: string
  variantMap: Record<string, StatusVariant>
}

export function StatusBadge({ status, variantMap, className, ...props }: StatusBadgeProps) {
  const variant = variantMap[status] || "default"

  return (
    <Badge variant={variant} className={className} {...props}>
      {status}
    </Badge>
  )
}
