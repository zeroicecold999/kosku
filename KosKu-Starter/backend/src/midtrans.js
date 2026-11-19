const crypto = require("crypto");

function isConfigured() {
  return Boolean(process.env.MIDTRANS_SERVER_KEY);
}

function getSnapEndpoint() {
  return process.env.MIDTRANS_IS_PRODUCTION === "true"
    ? "https://app.midtrans.com/snap/v1/transactions"
    : "https://app.sandbox.midtrans.com/snap/v1/transactions";
}

async function createSnapTransaction(payment) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi.");
  const orderId = `kosku-${payment.id}`;
  const response = await fetch(getSnapEndpoint(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: orderId,
        gross_amount: payment.amount
      },
      item_details: [{
        id: payment.id,
        price: payment.amount,
        quantity: 1,
        name: `Sewa kos - ${payment.application.room?.name || "kamar"}`
      }],
      customer_details: { first_name: payment.application.fullName },
      callbacks: {
        finish: process.env.FRONTEND_URL?.split(",")[0] || "http://localhost:5173"
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.token || !result.redirect_url)
    throw new Error(`Midtrans menolak pembuatan transaksi (${response.status}): ${JSON.stringify(result).slice(0, 300)}`);
  return { orderId, token: result.token, paymentUrl: result.redirect_url };
}

function verifyNotificationSignature(notification) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey || typeof notification.signature_key !== "string" ||
      typeof notification.order_id !== "string" || typeof notification.status_code !== "string" ||
      typeof notification.gross_amount !== "string") return false;
  const expected = crypto.createHash("sha512")
    .update(`${notification.order_id}${notification.status_code}${notification.gross_amount}${serverKey}`)
    .digest();
  let actual;
  try { actual = Buffer.from(notification.signature_key, "hex"); }
  catch { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function mapTransactionStatus(notification) {
  if (notification.transaction_status === "settlement") return "PAID";
  if (notification.transaction_status === "capture" && notification.fraud_status === "accept") return "PAID";
  if (notification.transaction_status === "pending") return "PENDING";
  if (["deny", "cancel", "expire"].includes(notification.transaction_status)) return "REJECTED";
  return null;
}

module.exports = { createSnapTransaction, isConfigured, mapTransactionStatus, verifyNotificationSignature };
