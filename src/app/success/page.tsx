import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { getOrder } from "@/lib/db";
import type { OrderStatus } from "@/lib/schema";

// Opt out of static prerendering — this page reads live order data per request
export const instant = false;

const statusConfig: Record<
  OrderStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  pending: {
    label: "Waiting for payment confirmation...",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
  },
  paid: {
    label: "Payment confirmed. Thank you!",
    bg: "bg-green-50",
    text: "text-green-800",
    border: "border-green-200",
  },
  failed: {
    label: "Payment failed. Please try again.",
    bg: "bg-red-50",
    text: "text-red-800",
    border: "border-red-200",
  },
  expired: {
    label: "Payment session expired.",
    bg: "bg-gray-50",
    text: "text-gray-700",
    border: "border-gray-200",
  },
  refunded: {
    label: "This order has been refunded.",
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
  },
};

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderId } = await searchParams;
  const order = orderId ? await getOrder(orderId) : undefined;

  if (!order) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-gray-500">Order not found.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          Back to shop
        </Link>
      </main>
    );
  }

  const status = order.status as OrderStatus;
  const config = statusConfig[status] ?? statusConfig.pending;
  const isPending = status === "pending";

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Order status</h1>

        {/* Status banner */}
        <div
          className={`mt-4 rounded-lg border px-4 py-3 text-sm font-medium ${config.bg} ${config.text} ${config.border}`}
        >
          {config.label}
        </div>

        {/* Pending hint */}
        {isPending && (
          <p className="mt-2 text-xs text-gray-400">
            This page refreshes automatically. Make sure{" "}
            <code className="font-mono">stripe listen</code> is running in your
            terminal.
          </p>
        )}

        {/* Order details */}
        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Order ID</dt>
            <dd className="font-mono text-xs text-gray-700 break-all text-right max-w-[60%]">
              {order.id}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Amount</dt>
            <dd className="font-semibold text-gray-900">
              {(order.amount / 100).toLocaleString("en-US", {
                style: "currency",
                currency: order.currency.toUpperCase(),
              })}
            </dd>
          </div>
          {order.paidAt && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Paid at</dt>
              <dd className="text-gray-700">
                {new Date(order.paidAt).toLocaleString()}
              </dd>
            </div>
          )}
        </dl>

        <div className="mt-8">
          <Link
            href="/"
            className="text-sm text-indigo-600 hover:underline"
          >
            Back to shop
          </Link>
        </div>
      </div>

      {/* Auto-refresh only while pending */}
      <AutoRefresh active={isPending} />
    </main>
  );
}
