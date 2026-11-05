import { SummarySidebar } from "@/components/summary/SummarySidebar";

/**
 * Shared shell for the daily-tracker pages (Daily/Week/Month/Year): the
 * period-view rail sits beside the content on md+ and above it on phones.
 * Route group keeps the URLs unchanged (`/daily`, `/week`, `/month`, `/year`).
 */
export default function SummaryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <SummarySidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
