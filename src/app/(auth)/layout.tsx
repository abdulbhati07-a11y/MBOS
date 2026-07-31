import * as React from "react"
import Link from "next/link"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/40 p-4 md:p-8">
      <div className="w-full max-w-md flex flex-col gap-8">
        {/* Branding Placeholder */}
        <div className="flex justify-center">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-xl transition-transform group-hover:scale-105">
              M
            </div>
            <span className="font-bold text-2xl tracking-tight text-foreground">
              MBOS
            </span>
          </Link>
        </div>

        {/* Auth Forms Container */}
        {children}
      </div>
    </div>
  )
}
