"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, addYears, format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import { cn, toISODate } from "@/lib/utils";
import type { WindowMode } from "@/lib/dates";
import { writeSummaryModeDefault } from "@/lib/prefs";
import {
  buildCompletionIndex,
  scoreUserDate,
  type CompletionIndex,
  type Score,
} from "@/lib/scoring";
import { percentColor } from "@/lib/colors";
import type { Task, TaskCompletion, User } from "@/lib/types";
import { DateStepper } from "./DateStepper";
import { RollingToggle } from "./RollingToggle";

interface Props {
  users: User[];
  tasks: Task[];
  completions: TaskCompletion[];
  days: string[];
  anchorISO: string;
  mode: WindowMode;
}

const SIZE = 560;
const INNER_R0 = 64;
const RING_GAP = 1.5;
const OUTER_PAD = 26;
const QUAD_SIZE = 320; // quadrant-mode canvas — smaller than the full circle
const QUAD_CORNER = 22; // quadrant pie-corner inset from the canvas edges
// Geometry per mode. Full circle: centered, 360°. Quadrant: a 90° wedge with
// the pie corner at the bottom-left of its own compact canvas and the arc
// opening to the top-right — literally ¼ of a circle.
const FULL = { size: SIZE, cx: SIZE / 2, cy: SIZE / 2, sweep: Math.PI * 2, rot: -Math.PI / 2 };
const QUAD = {
  size: QUAD_SIZE,
  cx: QUAD_CORNER,
  cy: QUAD_SIZE - QUAD_CORNER,
  sweep: Math.PI / 2,
  rot: -Math.PI / 2,
};

function polar(g: typeof FULL, r: number, a: number): [number, number] {
  return [g.cx + r * Math.cos(a), g.cy + r * Math.sin(a)];
}

/** The subset of `days` that fall in the calendar quarter containing anchorISO. */
function daysInQuarter(days: string[], anchorISO: string): string[] {
  const a = parseISO(anchorISO);
  const q = Math.floor(a.getMonth() / 3);
  const y = a.getFullYear();
  const startISO = toISODate(new Date(y, q * 3, 1));
  const endISO = toISODate(new Date(y, q * 3 + 3, 0)); // last day of the quarter's last month
  return days.filter((d) => d >= startISO && d <= endISO);
}

export function YearHeatmap(props: Props) {
  const router = useRouter();
  const { users, tasks, days, anchorISO, mode } = props;

  const index = useMemo(
    () => buildCompletionIndex(props.completions),
    [props.completions],
  );

  const userTasks = useMemo(
    () =>
      users.map((u) => ({
        user: u,
        tasks: tasks.filter((t) => t.user_id === u.id),
      })),
    [users, tasks],
  );

  const [hover, setHover] = useState<{ iso: string; userId: string } | null>(
    null,
  );
  // Stable callback so the memoized <Segments> doesn't re-render on hover.
  const handleHover = useCallback(
    (iso: string, userId: string) => setHover({ iso, userId }),
    [],
  );
  const clearHover = useCallback(() => setHover(null), []);

  const N = Math.max(1, users.length);
  // Q toggle: render the anchor date's current quarter (~91 days) as a 90°
  // quadrant — a quarter-circle wedge — instead of the full-year circle.
  // Defaults to ON when the page is entered.
  const [quarter, setQuarter] = useState(true);
  const viewDays = useMemo(
    () => (quarter ? daysInQuarter(days, anchorISO) : days),
    [days, anchorISO, quarter],
  );
  const geo = quarter ? QUAD : FULL;
  // Largest radius that fits. Full circle: half-canvas minus padding. Quadrant:
  // the wedge spans up and right from the corner point, so its extreme points
  // are (cx, cy−r) and (cx+r, cy) — the bound is the canvas edge, NOT the
  // diagonal (the diagonal overflows the viewBox, which is how this view used
  // to spill past the screen).
  const outerMax =
    geo === FULL
      ? SIZE / 2 - OUTER_PAD
      : QUAD_SIZE - QUAD_CORNER - OUTER_PAD;
  const ringWidth = (outerMax - INNER_R0) / N;
  const total = Math.max(1, viewDays.length);
  const angleHalf = geo.sweep / total / 2;
  const startOffset = geo.rot;

  // Defer the (many-paths) SVG render one frame so a spinner paints first
  // instead of freezing the tab when it mounts / the window changes.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [viewDays, users]);

  const sectorPath = (dayIndex: number, ringIndex: number) => {
    const a0 = (dayIndex / total) * geo.sweep + startOffset + angleHalf * 0.4;
    const a1 =
      ((dayIndex + 1) / total) * geo.sweep + startOffset - angleHalf * 0.4;
    const r0 = INNER_R0 + ringIndex * ringWidth;
    const r1 = r0 + ringWidth - RING_GAP;
    const [x1, y1] = polar(geo, r1, a0);
    const [x2, y2] = polar(geo, r1, a1);
    const [x3, y3] = polar(geo, r0, a1);
    const [x4, y4] = polar(geo, r0, a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r1.toFixed(2)},${r1.toFixed(
      2,
    )} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(
      2,
    )},${y3.toFixed(2)} A${r0.toFixed(2)},${r0.toFixed(2)} 0 ${large} 0 ${x4.toFixed(
      2,
    )},${y4.toFixed(2)} Z`;
  };

  const monthMarks: { i: number; label: string; angle: number }[] = [];
  for (let i = 0; i < viewDays.length; i++) {
    const dt = parseISO(viewDays[i]);
    if (dt.getDate() === 1) {
      monthMarks.push({
        i,
        label: format(dt, "MMM"),
        angle: ((i + 0.5) / total) * geo.sweep + startOffset,
      });
    }
  }

  function go(anchor: string, m: WindowMode) {
    const p = new URLSearchParams({ date: anchor, mode: m });
    router.push(`/year?${p.toString()}`);
  }
  const shift = (n: number) => {
    const base = parseISO(anchorISO);
    const next = mode === "calendar" ? addYears(base, n) : addDays(base, n * 365);
    go(toISODate(next), mode);
  };

  return (
    <div className="space-y-4">
      {/* One-line header */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <h1 className="shrink-0 text-lg font-semibold tracking-tight">Year</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <RollingToggle
            on={mode === "rolling"}
            onChange={(on) => {
              // The toggle sets this device's sticky mode default; date steps
              // just carry the current mode in the URL.
              const m: WindowMode = on ? "rolling" : "calendar";
              writeSummaryModeDefault(m);
              go(anchorISO, m);
            }}
          />
          <button
            type="button"
            onClick={() => setQuarter((q) => !q)}
            aria-pressed={quarter}
            title={
              quarter
                ? "Showing current quarter as a quadrant (click for full-year circle)"
                : "Zoom to current quarter (quadrant)"
            }
            className={cn(
              "h-9 w-9 shrink-0 rounded-lg border text-sm font-semibold transition-colors",
              quarter
                ? "border-transparent bg-[var(--color-check)] text-white"
                : "border-[var(--border)] text-[var(--muted)] hover:bg-black/5 hover:text-[var(--foreground)]",
            )}
          >
            Q
          </button>
          <DateStepper
            value={anchorISO}
            onChange={(iso) => go(iso, mode)}
            onPrev={() => shift(-1)}
            onNext={() => shift(1)}
          />
        </div>
      </div>

      {users.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-[var(--muted)]">
          No users yet — accounts are configured by the administrator; each
          person appears after their first login.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
            {ready ? (
            <svg
              viewBox={`0 0 ${geo.size} ${geo.size}`}
              role="img"
              aria-label="Yearly completion heatmap, one ring per user"
              className="mx-auto block h-auto w-full"
              style={{ maxWidth: geo.size }}
              onMouseLeave={clearHover}
            >
              <circle
                cx={geo.cx}
                cy={geo.cy}
                r={INNER_R0 - 6}
                fill="var(--card)"
                stroke="var(--border)"
              />
              {/* Quadrant: close the wedge with straight edges along the two
                  radii so it reads as a solid quarter circle. */}
              {quarter && (
                <path
                  d={`M${geo.cx},${geo.cy} L${polar(geo, outerMax, geo.rot)[0].toFixed(2)},${polar(
                    geo,
                    outerMax,
                    geo.rot,
                  )[1].toFixed(2)} A${outerMax.toFixed(2)},${outerMax.toFixed(2)} 0 0 1 ${polar(
                    geo,
                    outerMax,
                    geo.rot + geo.sweep,
                  )[0].toFixed(2)},${polar(geo, outerMax, geo.rot + geo.sweep)[1].toFixed(2)} Z`}
                  fill="none"
                  stroke="var(--border)"
                />
              )}

              {monthMarks.map((m, idx) => {
                const [x, y] = polar(geo, outerMax + 12, m.angle);
                return (
                  <text
                    key={`m-${idx}`}
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-[var(--muted)]"
                    style={{ fontSize: quarter ? 10 : 11 }}
                  >
                    {m.label}
                  </text>
                );
              })}

              <Segments
                days={viewDays}
                userTasks={userTasks}
                index={index}
                sectorPath={sectorPath}
                onHover={handleHover}
              />
            </svg>
            ) : (
              <div
                className="flex items-center justify-center text-[var(--muted)]"
                style={{ height: geo.size, maxHeight: "70vh" }}
              >
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
              <h3 className="mb-1 text-sm font-semibold">Rings (inner → outer)</h3>
              <ol className="space-y-0.5 text-sm">
                {userTasks.map(({ user }, i) => (
                  <li key={user.id} className="flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--background)] text-[10px] font-semibold text-[var(--muted)]">
                      {i + 1}
                    </span>
                    {user.name}
                  </li>
                ))}
              </ol>
            </div>

            <HoverDetail hover={hover} userTasks={userTasks} index={index} />

            <ColorScale />
          </aside>
        </div>
      )}
    </div>
  );
}

/** Memoized so hovering a segment only re-renders the side panel, not the SVG. */
const Segments = memo(function Segments({
  days,
  userTasks,
  index,
  sectorPath,
  onHover,
}: {
  days: string[];
  userTasks: { user: User; tasks: Task[] }[];
  index: CompletionIndex;
  sectorPath: (dayIndex: number, ringIndex: number) => string;
  onHover: (iso: string, userId: string) => void;
}) {
  return (
    <>
      {days.map((iso, di) =>
        userTasks.map(({ user, tasks: ut }, ri) => {
          const score = scoreUserDate(ut, index, iso);
          return (
            <path
              key={`${iso}-${user.id}`}
              d={sectorPath(di, ri)}
              fill={percentColor(score.percent)}
              className="year-seg"
              onMouseEnter={() => onHover(iso, user.id)}
            >
              <title>
                {format(parseISO(iso), "EEE, MMM d, yyyy")} · {user.name}:{" "}
                {score.percent == null
                  ? "no data"
                  : `${Math.round(score.percent * 100)}%`}{" "}
                ({score.check}/{score.denominator})
              </title>
            </path>
          );
        }),
      )}
    </>
  );
});

function HoverDetail({
  hover,
  userTasks,
  index,
}: {
  hover: { iso: string; userId: string } | null;
  userTasks: { user: User; tasks: Task[] }[];
  index: CompletionIndex;
}) {
  if (!hover) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] p-3 text-sm text-[var(--muted)]">
        Hover any segment to see that day’s breakdown for everyone.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="mb-2 text-sm font-semibold">
        {format(parseISO(hover.iso), "EEE, MMM d, yyyy")}
      </div>
      <ul className="space-y-1 text-sm">
        {userTasks.map(({ user, tasks }) => {
          const s: Score = scoreUserDate(tasks, index, hover.iso);
          const pct = s.percent == null ? null : Math.round(s.percent * 100);
          const active = hover.userId === user.id;
          return (
            <li
              key={user.id}
              className={
                "flex items-center justify-between rounded px-1.5 py-0.5 " +
                (active ? "bg-black/[0.04]" : "")
              }
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: percentColor(s.percent) }}
                />
                <span className={active ? "font-semibold" : ""}>{user.name}</span>
              </span>
              <span className="text-[var(--muted)]">
                {pct == null ? "—" : `${pct}%`}{" "}
                <span className="text-xs">
                  ({s.check}/{s.denominator})
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ColorScale() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <h3 className="mb-1 text-sm font-semibold">Completion</h3>
      <div className="flex items-center gap-1">
        {Array.from({ length: 11 }).map((_, i) => (
          <span
            key={i}
            className="h-3 flex-1 rounded-sm"
            style={{ backgroundColor: percentColor(i / 10) }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Gray = no data. Exempt tasks are excluded from the score.
      </p>
    </div>
  );
}
