import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const PHONEPE_URLS = {
  UAT: { auth: "https://api-preprod.phonepe.com/apis/hermes", pay: "https://api-preprod.phonepe.com/apis/hermes", status: "https://api-preprod.phonepe.com/apis/hermes", refund: "https://api-preprod.phonepe.com/apis/hermes" },
  PROD: { auth: "https://api.phonepe.com/apis/hermes", pay: "https://api.phonepe.com/apis/hermes", status: "https://api.phonepe.com/apis/hermes", refund: "https://api.phonepe.com/apis/hermes" },
};

export function getPhonepeFromShop(shop) {
  const settings = shop?.paymentSettings?.phonepe;
  if (shop?.paymentConfigured && settings?.clientId && settings?.clientSecret) {
    const env = settings.env === "PROD" ? "PROD" : "UAT";
    return { clientId: settings.clientId, clientSecret: settings.clientSecret, clientVersion: settings.clientVersion || "v1", env };
  }
  return { clientId: process.env.PHONEPE_CLIENT_ID || "", clientSecret: process.env.PHONEPE_CLIENT_SECRET || "", clientVersion: process.env.PHONEPE_CLIENT_VERSION || "v1", env: "UAT" };
}

export async function getAuthToken({ clientId, clientSecret, clientVersion, env }) {
  const baseUrl = PHONEPE_URLS[env || "UAT"].auth;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${baseUrl}/v1/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials&client_version=${encodeURIComponent(clientVersion || "v1")}`,
  });
  return res.json();
}

export async function createPayment({ accessToken, merchantTransactionId, amount, redirectUrl, env }) {
  const baseUrl = PHONEPE_URLS[env || "UAT"].pay;
  const payload = JSON.stringify({
    merchantOrderId: merchantTransactionId,
    amount: Math.round(amount * 100),
    mobileNumber: "9999999999",
    redirectUrl,
    callbackUrl: redirectUrl,
    paymentInstrument: { type: "PAY_PAGE" },
  });
  const res = await fetch(`${baseUrl}/pg/v1/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "O-Bearer": accessToken },
    body: JSON.stringify({ request: Buffer.from(payload).toString("base64") }),
  });
  return res.json();
}

export async function getOrderStatus({ merchantOrderId, accessToken, env }) {
  const baseUrl = PHONEPE_URLS[env || "UAT"].status;
  const res = await fetch(`${baseUrl}/pg/v1/status/${merchantOrderId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", "O-Bearer": accessToken },
  });
  return res.json();
}

export async function refundPayment({ accessToken, merchantOrderId, transactionId, amount, merchantRefundId, env }) {
  const baseUrl = PHONEPE_URLS[env || "UAT"].refund;
  const payload = JSON.stringify({
    merchantOrderId,
    transactionId,
    amount: Math.round(amount * 100),
    merchantRefundId,
  });
  const res = await fetch(`${baseUrl}/pg/v1/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "O-Bearer": accessToken },
    body: JSON.stringify({ request: Buffer.from(payload).toString("base64") }),
  });
  return res.json();
}
