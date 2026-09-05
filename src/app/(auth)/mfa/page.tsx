"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

import { mfaChallengeSchema } from "@/lib/validation/auth"
import { verifyMfa } from "@/lib/api/auth/mutations"
import { getPendingMfa, clearPendingMfa } from "@/lib/api/auth/mfa-handoff"
import { isApiError } from "@/lib/api/client"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

type MfaFormValues = z.infer<typeof mfaChallengeSchema>

function verifyErrorMessage(err: unknown): string {
  if (!isApiError(err)) {
    return "Could not reach the server. Check your connection and try again."
  }
  // 401 covers both a wrong code and an expired challenge token; the API does not
  // distinguish them, and neither should the message.
  if (err.status === 401) return "That code is not valid. Try the current one."
  if (err.status === 429) {
    const wait = err.retryAfter
    return wait
      ? `Too many attempts. Try again in ${String(wait)} seconds.`
      : "Too many attempts. Try again shortly."
  }
  return err.message
}

export default function MfaPage() {
  const router = useRouter()
  const [formError, setFormError] = React.useState<string | null>(null)

  // Read once into state. The handoff is module-scoped, so a hard reload of this
  // page has nothing to read — that is the intended outcome, and it must send the
  // user back rather than render a form that cannot possibly submit.
  const [pending] = React.useState(() => getPendingMfa())

  React.useEffect(() => {
    if (pending === null) router.replace("/login")
  }, [pending, router])

  const form = useForm<MfaFormValues>({
    resolver: zodResolver(mfaChallengeSchema),
    defaultValues: {
      code: "",
    },
  })

  async function onSubmit({ code }: MfaFormValues) {
    if (pending === null) return
    setFormError(null)
    try {
      await verifyMfa({ mfaSessionToken: pending.mfaSessionToken, code })
      clearPendingMfa()
      router.replace("/dashboard")
    } catch (err) {
      setFormError(verifyErrorMessage(err))
      form.reset({ code: "" })
    }
  }

  if (pending === null) return null

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold tracking-tight text-center">
          Two-factor Authentication
        </CardTitle>
        <CardDescription className="text-center">
          Enter the 6-digit code from your authenticator app to finish signing in
          as {pending.email}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem className="flex flex-col items-center justify-center">
                  <FormLabel className="sr-only">Authentication Code</FormLabel>
                  <FormControl>
                    <InputOTP maxLength={6} autoComplete="one-time-code" {...field}>
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </FormControl>
                  <FormMessage className="text-center" />
                </FormItem>
              )}
            />

            {formError !== null && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "Verifying…" : "Verify Code"}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="flex flex-col items-center justify-center space-y-2">
        <Button
          variant="link"
          className="text-muted-foreground hover:text-muted-foreground/80 cursor-not-allowed"
          disabled
        >
          Didn&apos;t get a code? (Resend not available)
        </Button>
        <Link
          href="/login"
          className="text-sm font-medium text-primary hover:underline"
        >
          Back to log in
        </Link>
      </CardFooter>
    </Card>
  )
}
