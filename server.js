// server.js — Central Contact Backend (Render, Brevo HTTP API, no DB)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { TransactionalEmailsApi, SendSmtpEmail } from "@getbrevo/brevo";

dotenv.config();

// ----- app & middleware -----
const app = express();
// Render erkennt den Port über die ENV-Variable PORT
const PORT = process.env.PORT || 10000;

app.use(
  cors({
    origin: true, // wir spiegeln Origin zurück, prüfen aber zusätzlich pro Site
    methods: ["POST", "GET", "OPTIONS"],
  })
);

app.use(express.json({ limit: "200kb" }));

// ----- Brevo API-Client -----
const emailApi = new TransactionalEmailsApi();
emailApi.authentications.apiKey.apiKey = process.env.BREVO_API_KEY;

// Kleiner Helper, um "Name <mail@domain>" zu splitten
function parseFrom(fromStr) {
  if (!fromStr) return { name: "Kontakt", email: "no-reply@example.com" };
  const m = fromStr.match(/^(.*)<(.+@.+)>$/);
  if (!m) return { name: fromStr, email: fromStr };
  return {
    name: m[1].trim().replace(/(^"|"$)/g, ""),
    email: m[2].trim(),
  };
}

// ----- per-site config from ENV -----
let SITES = {};
try {
  SITES = JSON.parse(process.env.SITES_JSON || "{}");
} catch (e) {
  console.error("❌ Failed to parse SITES_JSON:", e.message);
  SITES = {};
}

// ----- helpers -----
const isEmail = (x) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || "").trim());

const isEmpty = (v) =>
  v == null || (typeof v === "string" && v.trim() === "");

const esc = (s = "") =>
  String(s).replace(/[&<>\"']/g, (m) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m];
  });

// ----- routes -----

// POST /v1/contact  (JSON)  Body: { siteId, ...fields }
app.post("/v1/contact", async (req, res) => {
  try {
    const body = req.body || {};
    const { siteId } = body;

    if (!siteId || !SITES[siteId]) {
      return res.status(400).json({ error: "unknown siteId" });
    }

    const site = SITES[siteId];

    // CORS allowlist by site
    const origin = req.headers.origin || "";
    if (
      origin &&
      Array.isArray(site.allowedOrigins) &&
      !site.allowedOrigins.includes(origin)
    ) {
      return res.status(403).json({ error: "origin not allowed" });
    }

    // minimal required fields (default: email)
    const required = site.requiredFields || ["email"];
    for (const f of required) {
      if (isEmpty(body[f])) {
        return res
          .status(400)
          .json({ error: `missing required field: ${f}` });
      }
    }

    if (!isEmail(body.email)) {
      return res.status(400).json({ error: "invalid email" });
    }

    // build generic HTML/TEXT from provided fields
    const IGNORE = new Set(["siteId", "consent", "hp", "captchaToken", "meta"]);
    const labels = site.fieldLabels || {};
    const order = site.fieldOrder || [];

    const keys = Object.keys(body).filter(
      (k) => !IGNORE.has(k) && !isEmpty(body[k])
    );

    const ordered =
      order.length > 0
        ? [...keys].sort(
            (a, b) =>
              (order.indexOf(a) === -1 ? 9999 : order.indexOf(a)) -
              (order.indexOf(b) === -1 ? 9999 : order.indexOf(b))
          )
        : keys;

    const rows = ordered.map(
      (k) =>
        `<p><strong>${esc(labels[k] || k)}:</strong> ${esc(
          String(body[k])
        )}</p>`
    );

    const subject = (
      site.subject || `${site.subjectPrefix || "Kontakt"} Anfrage`
    ).slice(0, 160);

    const html = `
      <h2>${esc(subject)}</h2>
      ${rows.join("\n")}
    `;

    const text = ordered
      .map((k) => `${labels[k] || k}: ${String(body[k])}`)
      .join("\n");

    const recipients = Array.isArray(site.to) ? site.to : [site.to];
    const sender = parseFrom(site.from);

    const sendSmtpEmail = new SendSmtpEmail();
    sendSmtpEmail.sender = sender;
    sendSmtpEmail.to = recipients.map((email) => ({ email }));
    sendSmtpEmail.replyTo = body.email ? { email: body.email } : undefined;
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;
    sendSmtpEmail.textContent = text;
    
    await emailApi.sendTransacEmail(sendSmtpEmail);    

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(
      "contact error:",
      err.response?.body || err.message || err
    );
    return res.status(500).json({ error: "Internal error" });
  }
});

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// start
app.listen(PORT, () => {
  console.log(`✅ Email service listening on :${PORT}`);
});
