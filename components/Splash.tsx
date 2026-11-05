"use client";

import { useEffect, useState } from "react";

/**
 * First-load splash: covers the white gap between HTML parse and hydration
 * with an olive dropping into a martini glass. The markup and animation are
 * pure HTML/SVG/CSS, so it paints from the initial document + stylesheet —
 * no JS needed — and React dismisses it (fade, then unmount) right after
 * hydration. Rendered once from the root layout: every full page load shows
 * it exactly once, and client-side navigations never do. The short minimum
 * dwell keeps warm reloads from flashing it for a frame.
 */
export function Splash() {
  const [phase, setPhase] = useState<"dwell" | "fade" | "gone">("dwell");

  useEffect(() => {
    const t = setTimeout(() => setPhase("fade"), 450);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (phase !== "fade") return;
    const t = setTimeout(() => setPhase("gone"), 300);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden="true"
      className={
        "splash fixed inset-0 z-[999] flex flex-col items-center justify-center bg-[var(--background)]" +
        (phase === "fade" ? " splash-fade" : "")
      }
    >
      <svg viewBox="0 0 200 200" className="h-32 w-32">
        {/* Martini glass: V bowl, liquid line, stem, base. */}
        <g
          stroke="var(--foreground)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.85}
        >
          <path d="M40 96 L100 150 L160 96" />
          <path d="M60 112 L140 112" strokeWidth={3} opacity={0.4} />
          <path d="M100 150 V168" />
          <path d="M78 172 L122 172" />
        </g>
        {/* Ripple that rings out when the olive lands. */}
        <ellipse
          className="splash-ripple"
          cx={100}
          cy={112}
          rx={26}
          ry={4}
          fill="none"
          stroke="var(--color-check)"
          strokeWidth={2.5}
        />
        {/* The falling olive — same geometry as components/Logo.tsx, nested
            so the drop animation transforms this element without touching
            the parent's coordinates. */}
        <svg
          className="splash-olive"
          x={70}
          y={93}
          width={60}
          height={60}
          viewBox="0 0 500 500"
          fill="none"
          stroke="var(--color-check)"
        >
          <g strokeWidth={40} strokeLinecap="round" strokeLinejoin="round">
            <path d="M225 100C235 150 230 195 205 225" />
            <path d="M228 145C150 120 135 180 220 180" />
            <path d="M233 130C310 95 330 155 238 162" />
            <path
              d="M250 190
                 C315 190, 345 240, 345 315
                 C345 390, 315 420, 250 420
                 C185 420, 155 390, 155 315
                 C155 240, 185 190, 250 190Z"
            />
            <path d="M225 315C235 340, 265 340, 275 315" strokeWidth={34} />
          </g>
          <circle cx={220} cy={275} r={30} fill="var(--color-check)" stroke="none" />
          <circle cx={280} cy={275} r={30} fill="var(--color-check)" stroke="none" />
        </svg>
      </svg>
      <p className="mt-5 text-sm font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">
        Olives
      </p>
    </div>
  );
}
