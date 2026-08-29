"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Eye, EyeOff } from "lucide-react"

import { loginSchema } from "@/lib/validation/auth"
import { login, isMfaRequired } from "@/lib/api/auth/mutations"
import { setPendingMfa } from "@/lib/api/auth/mfa-handoff"
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
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

type LoginFormValues = z.infer<typeof loginSchema>

/**
 * Turns a failed login into something worth reading.
 *
 * 401 is deliberately vague about *which* half was wrong — saying "no such
 * email" would turn the login form into an account-enumeration oracle. 429 is
 * surfaced with its wait, because the strict rate limit on this endpoint means a
 * user retrying a typo can genuinely hit it.
 */
function loginErrorMessage(err: unknown): string {
  if (!isApiError(err)) {
    return "Could not reach the server. Check your connection and try again."
  }
  if (err.status === 401) return "Incorrect email or password."
  if (err.status === 429) {
    const wait = err.retryAfter
    return wait
      ? `Too many attempts. Try again in ${String(wait)} seconds.`
      : "Too many attempts. Try again shortly."
  }
  return err.message
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const router = useRouter()
  // Set by the reset-password page on success, so the return trip from the
  // reset flow opens with a confirmation instead of a bare form.
  const searchParams = useSearchParams()
  const passwordReset = searchParams.get("reset") === "success"

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  })

  // `rememberMe` is intentionally dropped rather than forwarded. LoginDto accepts
  // only `email` and `password`, and the API's validation pipe runs with
  // `forbidNonWhitelisted: true` — sending an extra field is a 422, not an
  // ignored key. The control is left in place because session lifetime is a real
  // requirement, but it has no backend yet, so honouring it would be a lie.
  async function onSubmit({ email, password }: LoginFormValues) {
    setFormError(null)
    try {
      const result = await login({ email, password })

      if (isMfaRequired(result)) {
        setPendingMfa({ mfaSessionToken: result.mfaSessionToken, email })
        router.push("/mfa")
        return
      }

      // `replace`, not `push`: the back button should not return to a login form
      // the user has already cleared.
      router.replace("/dashboard")
    } catch (err) {
      setFormError(loginErrorMessage(err))
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold tracking-tight text-center">
          Log in
        </CardTitle>
        <CardDescription className="text-center">
          Enter your email and password to access your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {passwordReset && !formError && (
          <div
            role="status"
            className="mb-4 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400"
          >
            Password updated. Sign in with your new password.
          </div>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="name@example.com" 
                      type="email" 
                      autoComplete="email"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        {...field}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="sr-only">
                          {showPassword ? "Hide password" : "Show password"}
                        </span>
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 py-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="font-normal cursor-pointer">
                      Remember me
                    </FormLabel>
                  </div>
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
              {form.formState.isSubmitting ? "Logging in…" : "Log in"}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="flex flex-col items-center justify-center space-y-2">
        <div className="text-sm text-muted-foreground">
          Don&rsquo;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary hover:underline"
          >
            Sign up
          </Link>
        </div>
      </CardFooter>
    </Card>
  )
}
