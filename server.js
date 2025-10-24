// Ergänzung in deiner server.js
import nodemailer from "nodemailer";

// GMX SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,           // mail.gmx.net
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE !== "false", // true
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
// 1) Konfig: pro Site optionale Steuerung (Labels, Reihenfolge, Pflichtfelder)
const SITES = JSON.parse(process.env.SITES_JSON || "{}");

// 2) Kleine Helfer
const isEmail = x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x||"").trim());
const esc = s => String(s||"").replace(/[&<>\"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
const isEmpty = v => (v == null) || (typeof v === "string" && v.trim() === "");

// 3) Im POST /v1/contact: dynamisch prüfen & rendern
app.post("/v1/contact", async (req, res) => {
  try {
    const body = req.body || {};
    const { siteId } = body;
    if (!siteId || !SITES[siteId]) return res.status(400).json({ error: "unknown siteId" });
    const site = SITES[siteId];

    // Origin-Check (wie gehabt)
    const origin = req.headers.origin || "";
    if (origin && Array.isArray(site.allowedOrigins) && !site.allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: "origin not allowed" });
    }

    // --- Pflichtfelder minimal prüfen ---
    const reqFields = site.requiredFields || ["email","message"];
    for (const f of reqFields) {
      if (isEmpty(body[f])) return res.status(400).json({ error: `missing required field: ${f}` });
    }
    if (!isEmail(body.email)) return res.status(400).json({ error: "invalid email" });

    // --- E-Mail-HTML generisch bauen ---
    const IGNORE = new Set(["siteId","consent","hp","captchaToken","meta"]); // interne Felder auslassen
    const labels = site.fieldLabels || {};
    const order = site.fieldOrder || []; // wenn leer, nehmen wir die Eingabe-Reihenfolge

    // Welche Keys zeigen? (alles, was nicht leer & nicht ignoriert)
    const contentKeys = Object.keys(body).filter(k => !IGNORE.has(k) && !isEmpty(body[k]));

    // Optional sortieren
    const orderedKeys = order.length
      ? [...contentKeys].sort((a,b) => (order.indexOf(a) === -1 ? 9999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 9999 : order.indexOf(b)))
      : contentKeys;

    // HTML Liste
    const rows = orderedKeys.map(k => {
      const label = labels[k] || k;
      return `<p><strong>${esc(label)}:</strong> ${esc(String(body[k]))}</p>`;
    });

    const subject = `${site.subjectPrefix || "Kontakt"} Anfrage`.slice(0,160);
    const html = `
      <h2>${esc(subject)}</h2>
      ${rows.join("\n")}
    `;

    // --- Versand (Nodemailer/GMX) ---
    await transporter.sendMail({
      from: site.from,
      to: site.to,
      replyTo: body.email,  // Antworten an Absender
      subject,
      html
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e.message || "bad request" });
  }
});
