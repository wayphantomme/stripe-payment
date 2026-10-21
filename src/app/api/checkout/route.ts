import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { stripe } from "@/lib/stripe";
import { getProduct } from "@/lib/products";
import { createOrder, attachSession } from "@/lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { productId?: string };
  const { productId } = body;

  const product = productId ? getProduct(productId) : null;
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    return NextResponse.json(
      { error: "Server misconfiguration: NEXT_PUBLIC_BASE_URL not set" },
      { status: 500 }
    );
  }

  const orderId = randomUUID();

  // 1. Record the order first with status 'pending' — before calling Stripe
  await createOrder({
    id: orderId,
    productId: product.id,
    amount: product.amount,
    currency: product.currency,
  });

  // 2. Create the Checkout Session — price comes from server catalog, never from the browser
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: product.currency,
            unit_amount: product.amount,
            product_data: {
              name: product.name,
              description: product.description,
            },
          },
        },
      ],
      // orderId in both places so it's traceable in Stripe Dashboard
      client_reference_id: orderId,
      metadata: { orderId },
      payment_intent_data: { metadata: { orderId } },
      success_url: `${baseUrl}/success?order=${orderId}`,
      cancel_url: `${baseUrl}/cancel?order=${orderId}`,
    },
    // Idempotency key: same orderId never creates two sessions
    { idempotencyKey: `checkout-${orderId}` }
  );

  // 3. Link the Stripe session ID back to the order
  await attachSession(orderId, session.id);

  return NextResponse.json({ url: session.url });
}
