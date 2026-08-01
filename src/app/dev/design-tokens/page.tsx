// Design token smoke test — moved from src/app/page.tsx (Step 2 artifact).
// Kept as a dev reference page at /dev/design-tokens.
// Not linked from any nav; not gated by auth.

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default function DesignTokensPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-background text-foreground gap-8">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-4xl font-bold tracking-tight">MBOS Design System</h1>
        <p className="text-muted-foreground">Checking typography and core tokens.</p>
        <div className="font-mono bg-muted px-2 py-1 rounded text-sm mt-2">
          SKU-00234-A
        </div>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Smoke Test Card</CardTitle>
          <CardDescription>Verify the card background, borders, and text.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Email Address
            </label>
            <Input id="email" placeholder="name@example.com" />
            <p className="text-sm text-muted-foreground">
              This helper text verifies the <code className="font-mono text-xs">muted-foreground</code> contrast.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex gap-4 flex-wrap">
          <Button variant="default">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
        </CardFooter>
      </Card>
    </main>
  )
}
