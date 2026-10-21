import Link from "next/link";

export default function CancelPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Payment cancelled</h1>
        <p className="mt-2 text-sm text-gray-500">
          You have not been charged. Your order was not placed.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Back to shop
        </Link>
      </div>
    </main>
  );
}
