// server.js — Central Contact Backend (Render, Brevo SMTP, no DB)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

// ----- app & middleware -----
const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: true, // Origin wird zurückgespiegelt, zusätzliche Prüfung machen wir in der Route
    methods: ["POST", "GET", "OPTIONS"],
  })
);

app.use(express.json({ limit: "200kb" }));

// ----- SMTP (Brevo) -----
const transporter = nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST, // z.B. smtp-relay.brevo.com
  port: Number(process.env.BREVO_SMTP_PORT) || 587,
  secure: false, // Port 587 = STARTTLS
  auth: {
    user: process.env.BREVO_SMTP_USER, // z.B. xxx@smtp-brevo.com
    pass: process.env.BREVO_SMTP_PASS,
  },
});

// Optional: Test-Log beim Start
transporter.verify((err, success) => {
  if (err) {
    console.error("❌ SMTP verify failed:", err.message);
  } else {
    console.log("✅ SMTP ready to send");
  }
});

// ----- per-site config from ENV -----
const SITES = JSON.parse(process.env.SITES_JSON || "{}");

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

    // build generic HTML from provided fields
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

    // ✅ Hier wird jetzt die Mail verschickt
    await transporter.sendMail({
      from: site.from, // z.B. "Limani Kontakt <kontakt@limani-fliesenleger.de>"
      to: recipients,
      replyTo: body.email, // Antworten direkt an den User
      subject,
      html,
      text,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("contact error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// start
app.listen(PORT, () => {
  console.log(`✅ Email service listening on :${PORT}`);
});
