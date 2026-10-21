import BuyButton from "@/components/BuyButton";
import { PRODUCTS } from "@/lib/products";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      {/* Header */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Stripe Shop
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Sandbox mode — no real money moves
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-xs text-amber-700 ring-1 ring-amber-200">
          <span>🧪</span>
          <span>
            Test card:{" "}
            <code className="font-mono font-semibold">
              4242 4242 4242 4242
            </code>{" "}
            · any future date · any CVC
          </span>
        </div>
      </div>

      {/* Product list */}
      <div className="flex flex-col gap-6">
        {Object.values(PRODUCTS).map((product) => (
          <div
            key={product.id}
            className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {product.name}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {product.description}
                </p>
              </div>
              <span className="shrink-0 text-xl font-bold text-indigo-600">
                {(product.amount / 100).toLocaleString("en-US", {
                  style: "currency",
                  currency: product.currency.toUpperCase(),
                })}
              </span>
            </div>
            <BuyButton productId={product.id} />
          </div>
        ))}
      </div>
    </main>
  );
}
