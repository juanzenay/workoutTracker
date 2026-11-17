import Link from "next/link";
import { getRequestStrings } from "@/server/strings";

export default async function NotFound() {
  const s = await getRequestStrings();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold">{s.errors.notFoundTitle}</h1>
      <p className="text-muted">{s.errors.notFoundBody}</p>
      <Link href="/" className="text-muted underline">
        {s.errors.home}
      </Link>
    </main>
  );
}
