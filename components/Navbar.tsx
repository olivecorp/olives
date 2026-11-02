"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, LogOut, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { SyncStatus } from "@/components/SyncStatus";
import { resetCoordinator } from "@/lib/swr-mutations";
import { resetLocalData } from "@/lib/local/reset";

// Single-letter labels keep the bar compact on phones; the full name shows
// on hover/long-press via title, and screen readers use aria-label. Calendar
// is the app's home (/ redirects there); Daily is the daily-tracker section.
// Week/Month/Year live in the tracker sidebar (see
// components/summary/SummarySidebar) — this bar switches sections only.
const LINKS: { href: string; label: string; aria: string; sepBefore?: boolean }[] = [
  { href: "/daily", label: "D", aria: "Daily" },
  { href: "/todos", label: "T", aria: "Todos", sepBefore: true },
  { href: "/calendar", label: "C", aria: "Calendar" },
  { href: "/notes", label: "N", aria: "Notes" },
  { href: "/settings", label: "⚙", aria: "Settings" },
];

/** Back arrow shown while a single note is open — the notes page mirrors the
 *  open note into ?id=, and this sits with the section letters as the note
 *  editor's back button (the in-editor one was removed). Suspense-wrapped
 *  because useSearchParams can't run during static prerender. */
function NotesBackLink() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (pathname !== "/notes" || !searchParams.get("id")) return null;
  return (
    <Link
      href="/notes"
      title="Back to notes"
      aria-label="Back to notes"
      className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted)] transition-colors hover:bg-black/5 hover:text-[var(--foreground)]"
    >
      <ArrowLeft className="h-4 w-4" />
    </Link>
  );
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
        <Link
          href="/calendar"
          className="mr-2 flex items-center gap-2 font-semibold tracking-tight"
        >
          <Logo className="h-8 w-8" />
          <span className="hidden sm:inline">Olives</span>
        </Link>

        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          <Suspense fallback={null}>
            <NotesBackLink />
          </Suspense>
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
                {l.href === "/settings" ? (
                  <Settings className="h-4.5 w-4.5" />
                ) : (
                  l.label
                )}
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
