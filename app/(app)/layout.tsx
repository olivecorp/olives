"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SWRConfig } from "swr";
import { Navbar } from "@/components/Navbar";
import { LocalSyncEngine } from "@/components/LocalSyncEngine";
import { SectionWarmer } from "@/components/SectionWarmer";
import { useDashboard } from "@/lib/use-dashboard";
import { rememberPage } from "@/lib/prefs";

/**
 * Triggers the initial /api/dashboard fetch once per document load. Combined
 * with revalidateOnMount:false / revalidateIfStale:false below, tabs never
 * refetch on their own — they read the cache. (Daily also calls mutate() to
 * resync when it's opened.) The fetch is deferred until the browser is idle:
 * it's a large payload, and firing it alongside the navbar's route
 * prefetches right after load is what made the first tab tap feel slow.
 * Returns nothing.
 */
function DataLoader() {
  const { mutate } = useDashboard();
  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => void mutate(), { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(() => void mutate(), 1500);
    return () => clearTimeout(t);
  }, [mutate]);
  return null;
}

/** Records the current app route so the root page can land returning visits
 *  where they left off. Navigation is the user action; an effect on pathname
 *  catches hard loads and soft navs alike (Link prefetching never mounts
 *  pages, so only real visits are recorded). Whitelist-guarded in
 *  rememberPage, so future routes here are simply not remembered yet. */
function LastPageTracker() {
  const pathname = usePathname();
  useEffect(() => {
    rememberPage(pathname);
  }, [pathname]);
  return null;
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateOnMount: false,
        revalidateIfStale: false,
        keepPreviousData: true,
        shouldRetryOnError: true,
        errorRetryCount: 4,
      }}
    >
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
      <DataLoader />
      <LastPageTracker />
      <SectionWarmer />
      <LocalSyncEngine />
    </SWRConfig>
  );
}
