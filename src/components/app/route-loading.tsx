import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoading({ title }: { title: string }) {
  return <section role="status" aria-label={`Loading ${title}`} className="mx-auto max-w-2xl space-y-6">
    <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
    <span className="sr-only">Loading…</span>
    <div aria-hidden="true" className="space-y-4">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  </section>;
}
