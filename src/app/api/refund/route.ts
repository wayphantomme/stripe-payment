import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getOrder } from "@/lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { orderId?: string };
  const { orderId } = body;

  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const order = await getOrder(orderId);

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status !== "paid") {
    return NextResponse.json(
      { error: `Cannot refund an order with status "${order.status}"` },
      { status: 400 }
    );
  }

  if (!order.stripePaymentIntent) {
    return NextResponse.json(
      { error: "No payment intent found for this order" },
      { status: 400 }
    );
  }

  // Create the refund in Stripe — order status is updated via the webhook,
  // not here, so we stay consistent with webhook-as-source-of-truth.
  await stripe.refunds.create({
    payment_intent: order.stripePaymentIntent,
  });

  return NextResponse.json({ success: true });
}
