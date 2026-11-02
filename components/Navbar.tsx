"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  ClipboardCheck,
  ListChecks,
  LogOut,
  NotebookText,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { SyncStatus } from "@/components/SyncStatus";
import { resetCoordinator } from "@/lib/swr-mutations";
import { resetLocalData } from "@/lib/local/reset";

// Icon tabs (names travel via title/aria-label). Calendar is the app's home
// (/ redirects there); Daily — the daily tracker — sits behind a divider
// after the main three (it's a different mode of the app, and Week/Month/
// Year live in its sidebar, see components/summary/SummarySidebar).
const LINKS: {
  href: string;
  aria: string;
  Icon: React.ComponentType<{ className?: string }>;
  sepBefore?: boolean;
}[] = [
  { href: "/calendar", aria: "Calendar", Icon: Calendar },
  { href: "/todos", aria: "Todos", Icon: ListChecks },
  { href: "/notes", aria: "Notes", Icon: NotebookText },
  { href: "/daily", aria: "Daily", Icon: ClipboardCheck, sepBefore: true },
  { href: "/settings", aria: "Settings", Icon: Settings },
];

/** The olive logo, linked home. Also the Suspense fallback for NavbarBrand
 *  (what renders during prerender, before search params exist). */
function BrandLogo() {
  return (
    <Link
      href="/calendar"
      className="mr-2 flex items-center gap-2 font-semibold tracking-tight"
    >
      <Logo className="h-8 w-8" />
      <span className="hidden sm:inline">Olives</span>
    </Link>
  );
}

/** Brand slot: normally the logo, but while a single note is open (the notes
 *  page mirrors it into ?id=) the back arrow takes its place in the same
 *  32px footprint — swapping in the logo's slot, not inserting beside it, so
 *  the section tabs never shift when a note opens or closes. Suspense-
 *  wrapped because useSearchParams can't run during static prerender. */
function NavbarBrand() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (pathname === "/notes" && searchParams.get("id")) {
    return (
      <Link
        href="/notes"
        title="Back to notes"
        aria-label="Back to notes"
        className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-black/5 hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
    );
  }
  return <BrandLogo />;
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    // Drop any queued debounced writes first so they can't fire after logout.
    resetCoordinator();
    // Flush + wipe the local-first DB (bounded 2s) so the next account starts
    // from a clean pull.
    await resetLocalData();
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--card)]/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4">
        <Suspense fallback={<BrandLogo />}>
          <NavbarBrand />
        </Suspense>

        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <span key={l.href} className="flex items-center">
                {l.sepBefore && (
                  <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden />
                )}
                <Link
                href={l.href}
                title={l.aria}
                aria-label={l.aria}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md text-sm font-semibold transition-colors",
                  active
                    ? "bg-[var(--color-check-soft)] text-[var(--color-check)]"
                    : "text-[var(--muted)] hover:bg-black/5 hover:text-[var(--foreground)]",
                )}
              >
                <l.Icon className="h-4.5 w-4.5" />
                </Link>
              </span>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <SyncStatus />
          <button
            onClick={handleLogout}
            title="Log Out"
            aria-label="Log Out"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] transition-colors hover:bg-black/5"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
