"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRight, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/shared/PageHeader"
import { useBreadcrumb } from "@/contexts/breadcrumb-context"

/**
 * The page a navigable-but-unbuilt module renders.
 *
 * Every entry in navConfig is reachable, so a module without a page.tsx produced
 * a hard 404 — the framework's "this route does not exist", which is wrong twice
 * over: the route is planned, and the user was sent there by our own sidebar.
 * This states what the module is, what it will do, and why it is not here yet.
 *
 * Deliberately not a mock UI. Building a fake roles table or billing screen on
 * mock data would have to be thrown away when the real API is wired, and in the
 * meantime it would read as working software.
 */

export type BuildStatus =
  /** API implemented and tested; this screen is waiting on the frontend API client. */
  | "api-ready"
  /** Neither the API nor the screen exists yet. */
  | "planned"

export interface ModulePlaceholderProps {
  icon: LucideIcon
  title: string
  description: string
  /** What the module will do once built — concrete, not aspirational filler. */
  planned: readonly string[]
  status: BuildStatus
  /** Why it is not built yet, and anything a reader should know meanwhile. */
  footnote: React.ReactNode
}

const STATUS_COPY: Record<BuildStatus, { label: string; className: string }> = {
  "api-ready": {
    label: "API ready · UI pending",
    className:
      "bg-success/10 text-success ring-1 ring-inset ring-success/20",
  },
  planned: {
    label: "Planned",
    className:
      "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  },
}

export function ModulePlaceholder({
  icon: Icon,
  title,
  description,
  planned,
  status,
  footnote,
}: ModulePlaceholderProps) {
  // A module-level constant would be cleaner, but the label varies per page and
  // useBreadcrumb already tolerates an unstable array (it serializes internally).
  useBreadcrumb(title, [{ label: title }])

  const statusCopy = STATUS_COPY[status]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />

      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icon className="size-5 text-muted-foreground" />
            </span>
            <div className="flex flex-col gap-1">
              <CardTitle>Not available yet</CardTitle>
              <CardDescription>
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusCopy.className}`}
                >
                  {statusCopy.label}
                </span>
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">What this module will do</p>
            <ul className="flex flex-col gap-1.5">
              {planned.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="border-t pt-4 text-sm text-muted-foreground">
            {footnote}
          </p>

          <div>
            <Button
              variant="outline"
              size="sm"
              // Link renders an <a>, so Base UI must not assert a native button.
              nativeButton={false}
              render={<Link href="/dashboard" />}
            >
              Back to dashboard
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
