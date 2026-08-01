// Root route — redirects to /dashboard.
//
// TODO: when real auth/session exists, this should become:
//   unauthenticated → redirect("/login")
//   authenticated   → redirect("/dashboard")
// For now there is no auth check; all traffic goes straight to /dashboard.

import { redirect } from "next/navigation"

export default function RootPage() {
  redirect("/dashboard")
}
