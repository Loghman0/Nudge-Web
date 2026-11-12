import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Keeps navigation visibly responsive while the server loads private data.
 */
export default function Loading() {
  return <div role="status" aria-label="Loading page"><span className="sr-only">Loading page…</span><PageSkeleton /></div>;
}
