export type Product = {
  id: string;
  name: string;
  description: string;
  amount: number; // in cents — never trust browser for this
  currency: string;
};

export const PRODUCTS: Record<string, Product> = {
  "nextjs-ebook": {
    id: "nextjs-ebook",
    name: "Learn Next.js E-book",
    description: "A practical guide to building full-stack apps with Next.js and the App Router.",
    amount: 2000, // $20.00
    currency: "usd",
  },
  "stripe-course": {
    id: "stripe-course",
    name: "Stripe Basics Course",
    description: "Learn how to integrate payments, webhooks, and refunds with Stripe.",
    amount: 4900, // $49.00
    currency: "usd",
  },
};

export function getProduct(id: string): Product | null {
  return PRODUCTS[id] ?? null;
}
