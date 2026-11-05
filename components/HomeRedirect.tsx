"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { readLastPage } from "@/lib/prefs";

/**
 * Client-side gate for "/" — the server can't read localStorage, so the root
 * is a static shell that hops to this device's remembered page (or the
 * calendar). replace (not push): device Back skips the hop instead of
 * getting trapped on "/".
 */
export function HomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(readLastPage() ?? "/calendar");
  }, [router]);
  return null;
}
