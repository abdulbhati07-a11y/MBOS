"use client"

// ---------------------------------------------------------------------------
// src/components/users/UserDialog.tsx
//
// Create/edit form for a user (Section 6.5), submitting to `POST /users` or
// `PATCH /users/:id`.
//
// Two shapes, one form. Create takes a password (invite-by-email is not built —
// DEBT-015) validated against the Section 3.3.1 policy; edit takes none, because
// a password reset is a separate flow. The `mode`-appropriate schema is chosen at
// mount and the password field is rendered only when creating.
//
// Self-protection is the server's rule, surfaced here as prevention plus a
// backstop. When `isSelf` is set — you are editing your own account — the role
// and active controls are disabled, because the server answers 403 to a user who
// tries to change their own role or deactivate themselves (it stops the last
// Owner locking the tenant out). If one slips through anyway — a race, a second
// admin — the 403's message is shown verbatim rather than a generic failure.
// ---------------------------------------------------------------------------

import * as React from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  createUserSchema,
  editUserSchema,
} from "@/lib/validation/users"
import type { User } from "@/lib/api/users/queries"
import type { RoleSummary } from "@/lib/api/roles/queries"
import { isApiError } from "@/lib/api/client"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * One form type across both modes. `password` is always present in the type but
 * only read on create (the resolver strips it on edit, and the field is not
 * rendered there), so the edit path never sends it.
 */
export type UserFormValues = {
  email: string
  password: string
  roleId: string
  isActive: boolean
}

/** The keys the server may attach a 422 to — used to filter its field errors. */
const FORM_FIELDS: readonly (keyof UserFormValues)[] = [
  "email",
  "password",
  "roleId",
  "isActive",
]

interface UserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `undefined` = create mode. */
  user?: User
  /** This tenant's roles plus the built-ins, for the assignment select. */
  roles: RoleSummary[]
  /** Disables the select while the roles list is still loading. */
  rolesLoading?: boolean
  /** True when the row being edited is the signed-in user — locks role/active. */
  isSelf?: boolean
  /**
   * Resolves when the write has landed, rejects with the ApiError if it has not.
   * The dialog stays open on rejection so the user does not lose what they typed.
   */
  onSave: (values: UserFormValues, id?: string) => Promise<unknown>
}

function toFormValues(user: User | undefined): UserFormValues {
  if (user === undefined) {
    return { email: "", password: "", roleId: "", isActive: true }
  }
  return {
    email: user.email,
    password: "",
    roleId: user.roleId,
    isActive: user.isActive,
  }
}

/**
 * The form body, mounted only while the dialog is open — so it seeds fresh from
 * `defaultValues` on every open rather than resetting a render late, matching
 * `SupplierDrawer`.
 */
function UserForm({
  user,
  roles,
  rolesLoading,
  isSelf,
  onSave,
  onDone,
}: {
  user?: User
  roles: RoleSummary[]
  rolesLoading: boolean
  isSelf: boolean
  onSave: (values: UserFormValues, id?: string) => Promise<unknown>
  onDone: () => void
}) {
  const isEdit = user !== undefined
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<UserFormValues>({
    // Asserted, not assigned: the schema's input type differs from its output
    // (Zod v4 default/optional fields), and the schema itself differs by mode, so
    // RHF cannot take either resolver directly. `Resolver<UserFormValues>` narrows
    // the assertion to one shape, unlike `any`.
    resolver: (isEdit
      ? zodResolver(editUserSchema)
      : zodResolver(createUserSchema)) as unknown as Resolver<UserFormValues>,
    defaultValues: toFormValues(user),
  })

  const onSubmit = async (data: UserFormValues) => {
    setFormError(null)
    try {
      await onSave(data, user?.id)
      onDone()
    } catch (err) {
      if (!isApiError(err)) {
        setFormError("Could not reach the server. Nothing was saved.")
        return
      }
      if (err.isConflict) {
        form.setError("email", {
          type: "server",
          message: "A user with this email already exists.",
        })
        return
      }
      if (err.isValidation) {
        // Attach whatever the server named to the matching field. An
        // unassignable role (another tenant's, or deleted) is a 422 that may or
        // may not carry a field — if nothing mapped, fall through to the banner.
        let mapped = false
        for (const [field, message] of Object.entries(err.fieldErrors())) {
          if ((FORM_FIELDS as readonly string[]).includes(field)) {
            form.setError(field as keyof UserFormValues, {
              type: "server",
              message,
            })
            mapped = true
          }
        }
        if (!mapped) setFormError(err.message)
        return
      }
      if (err.isForbidden) {
        // The self-protection 403s carry a message written to be shown as-is
        // ("You cannot change your own role", etc.).
        setFormError(err.message || "You do not have permission to do that.")
        return
      }
      setFormError(err.message)
    }
  }

  const saving = form.formState.isSubmitting

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit User" : "Add User"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update this user's email, role, and access."
            : "Create a user and assign them a role. They can sign in immediately."}
        </DialogDescription>
      </DialogHeader>

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
                    type="email"
                    autoComplete="off"
                    placeholder="e.g. jane@acme.example.com"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Password — create only. On edit it is neither shown nor sent. */}
          {!isEdit && (
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Needs an uppercase and lowercase letter, a number, and a
                    special character.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="roleId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Role</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v ?? "")}
                  disabled={isSelf || rolesLoading}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          rolesLoading ? "Loading roles…" : "Select a role…"
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                        {role.isBuiltIn ? "" : " (custom)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isSelf && (
                  <p className="text-xs text-muted-foreground">
                    You can&apos;t change your own role — another Owner must.
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <FormLabel className="text-sm font-medium">Active</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    {isSelf
                      ? "You can't deactivate your own account."
                      : "Inactive users cannot sign in."}
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isSelf}
                  />
                </FormControl>
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

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={saving}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add User"}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}

export function UserDialog({
  open,
  onOpenChange,
  user,
  roles,
  rolesLoading = false,
  isSelf = false,
  onSave,
}: UserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <UserForm
          user={user}
          roles={roles}
          rolesLoading={rolesLoading}
          isSelf={isSelf}
          onSave={onSave}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
