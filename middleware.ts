import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Deliberately pass-through.
//
// Dashboard protection is NOT done here, and that is a design decision, not a
// gap: the app's auth model is a memory-only access token plus an httpOnly
// refresh cookie, so a server-side middleware on this origin cannot see whether
// a browser request is authenticated — the credential lives with the API
// origin. The client-side SessionGate (src/components/shared/SessionGate.tsx)
// holds every dashboard page until the session resolves and redirects to /login
// otherwise; the API itself re-validates the bearer token on every request, so
// nothing is actually protected by this file.
//
// A middleware-level check would only become meaningful if a rewrite proxy
// (fronting the API) were introduced — see the header comment in
// src/lib/api/client.ts for why that is a bigger change than it sounds.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  // Match all request paths except for the ones starting with:
  // - api (API routes)
  // - _next/static (static files)
  // - _next/image (image optimization files)
  // - favicon.ico (favicon file)
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
