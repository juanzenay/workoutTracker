import { LoadingRegion, Skeleton, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Analytics: heatmap with its window picker, weekly load charts, and the exercise chart list. */
export default function Loading() {
  return (
    <LoadingRegion className="gap-8">
      <SkeletonTitle />

      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-1/4" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="min-h-touch w-14" />
          ))}
        </div>
        <SkeletonCard className="h-80" />
      </section>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-1/4" />
        <Skeleton className="h-4 w-3/4" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="aspect-[4/1] w-full" />
          </div>
        ))}
        <Skeleton className="min-h-touch w-1/3" />
      </section>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-1/3" />
        <SkeletonCard className="h-48" />
      </section>
    </LoadingRegion>
  );
}
