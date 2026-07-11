import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const EASEBUZZ_URLS = {
  test: { base: "https://testpay.easebuzz.in", api: "https://testdashboard.easebuzz.in" },
  prod: { base: "https://pay.easebuzz.in", api: "https://dashboard.easebuzz.in" },
};

export function getEasebuzzFromShop(shop) {
  const settings = shop?.paymentSettings?.easebuzz;
  if (shop?.paymentConfigured && settings?.merchantKey && settings?.salt) {
    const env = settings.env === "prod" ? "prod" : "test";
    return { merchantKey: settings.merchantKey, salt: settings.salt, baseUrl: EASEBUZZ_URLS[env].api };
  }
  return {
    merchantKey: process.env.EASEBUZZ_MERCHANT_KEY || "",
    salt: process.env.EASEBUZZ_SALT || "",
    baseUrl: EASEBUZZ_URLS.test.api,
  };
}

export function initiatePayment(params, baseUrl) {
  const formBody = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return fetch(`${baseUrl}/payment/initiateLink`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
  }).then((r) => r.json());
}

export function easebuzzPayUrl(baseUrl, accessKey) {
  return `${baseUrl}/pay/${accessKey}`;
}

export function buildPaymentHash({ merchantKey, salt, txnid, amount, productinfo, firstname, email }) {
  const hashStr = `${merchantKey}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||||${salt}`;
  return crypto.createHash("sha512").update(hashStr).digest("hex").toLowerCase();
}

function reverseString(str) {
  return str.split("").reverse().join("");
}

export function verifyResponseHash({ merchantKey, salt, payload }) {
  const hashStr = `${salt}|${payload.status}|||||||||||${payload.email}|${payload.firstname}|${payload.productinfo}|${payload.amount}|${payload.txnid}|${merchantKey}`;
  const expected = crypto.createHash("sha512").update(hashStr).digest("hex").toLowerCase();
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(String(payload.hash || "").toLowerCase(), "utf8"));
}
