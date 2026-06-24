const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOrderIdFromEmail(emailText) {
  const text = String(emailText || "");

  const patterns = [
    /Megrendel[eé]s k[oó]dja[:\s]+(GC\d+)/i,
    /Megrendel[eé]s[:\s]+(GC\d+)/i,
    /\b(GC\d{3,})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }

  return `UNKNOWN-${Date.now()}`;
}

function countAirFreshenersFromEmail(emailText) {
  if (!emailText || typeof emailText !== "string") return 0;

  const text = emailText
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ");

  const lines = text
    .split("\n")
    .map(line => normalizeText(line))
    .filter(Boolean);

  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i].toLowerCase();

    const isAirFreshener =
      currentLine.includes("autóillatosító") ||
      currentLine.includes("autoillatosito") ||
      currentLine.includes("autó illatosító") ||
      currentLine.includes("auto illatosito");

    if (!isAirFreshener) continue;

    const nearbyText = [
      lines[i - 3] || "",
      lines[i - 2] || "",
      lines[i - 1] || "",
      lines[i] || "",
      lines[i + 1] || "",
      lines[i + 2] || "",
      lines[i + 3] || "",
      lines[i + 4] || ""
    ].join(" ");

    const qtyMatch =
      nearbyText.match(/(\d+)\s*db/i) ||
      nearbyText.match(/db[:\s]+(\d+)/i) ||
      nearbyText.match(/mennyis[eé]g[:\s]+(\d+)/i) ||
      nearbyText.match(/darab[:\s]+(\d+)/i) ||
      nearbyText.match(/quantity[:\s]+(\d+)/i);

    if (qtyMatch) {
      total += Number(qtyMatch[1]);
    } else {
      total += 1;
    }
  }

  return total;
}

app.get("/", (req, res) => {
  res.send("GipsyCar counter server is running.");
});

app.post("/webhook", async (req, res) => {
  try {
    const emailText = req.body.emailText || "";

    console.log("Új adat érkezett.");
    console.log("emailText hossza:", emailText.length);

    const orderId = extractOrderIdFromEmail(emailText);
    const quantity = countAirFreshenersFromEmail(emailText);

    console.log("Rendelés azonosító:", orderId);
    console.log("Talált autóillatosító darabszám:", quantity);

    if (quantity <= 0) {
      return res.status(200).json({
        success: true,
        message: "Nem találtam autóillatosítót ebben az e-mailben.",
        orderId,
        quantity: 0
      });
    }

    const { data: existingOrder, error: existingError } = await supabase
      .from("campaign_events")
      .select("id, order_id")
      .eq("order_id", orderId)
      .maybeSingle();

    if (existingError) {
      console.error("Supabase ellenőrzési hiba:", existingError);
      return res.status(500).json({
        success: false,
        error: existingError.message
      });
    }

    if (existingOrder) {
      console.log("Ez a rendelés már feldolgozva:", orderId);

      return res.status(200).json({
        success: true,
        duplicate: true,
        message: "Ez a rendelés már feldolgozva, nem számolom újra.",
        orderId,
        quantity: 0
      });
    }

    const { data, error } = await supabase
      .from("campaign_events")
      .insert([
        {
          order_id: orderId,
          customer: "Vásárló",
          qty: quantity,
          donation: quantity * 500
        }
      ])
      .select();

    if (error) {
      console.error("Supabase hiba:", error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    res.status(200).json({
      success: true,
      duplicate: false,
      message: "Kampány esemény mentve.",
      orderId,
      quantity,
      data
    });

  } catch (err) {
    console.error("Webhook hiba:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get("/stats", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("campaign_events")
      .select("qty");

    if (error) {
      console.error("Stats Supabase hiba:", error);
      return res.status(500).json({ total: 0 });
    }

    const total = data.reduce((sum, row) => {
      return sum + Number(row.qty || 0);
    }, 0);

    res.json({
      total
    });

  } catch (err) {
    console.error("Stats hiba:", err);
    res.status(500).json({ total: 0 });
  }
});

app.listen(PORT, () => {
  console.log(`GipsyCar counter server running on port ${PORT}`);
});