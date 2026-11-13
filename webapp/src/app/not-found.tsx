import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div>
        <h2 className="text-lg font-semibold">Page not found</h2>
        <Link href="/" className="mt-2 inline-block text-accent-2 hover:underline">Back to Overview</Link>
      </div>
    </div>
  );
}
