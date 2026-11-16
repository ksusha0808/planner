// Мой планер: календарь-подписка (.ics) для виджета календаря на телефоне.
// Supabase → Edge Functions → Deploy a new function → Via Editor,
// имя функции: calendar. Вставь этот код целиком и нажми Deploy.
// Затем в настройках функции выключи "Verify JWT" (Enforce JWT verification).
import { createClient } from "jsr:@supabase/supabase-js@2";

const esc = (s: string) =>
  String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// строки .ics не длиннее 75 байт
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const ymd = (s: string) => s.replace(/-/g, "");
const nextDay = (s: string) => {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token");
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return new Response("Нужна ссылка из приложения", { status: 400 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: feed } = await sb.from("feeds").select("user_id").eq("token", token).maybeSingle();
  if (!feed) return new Response("Ссылка не найдена", { status: 404 });

  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const { data: rows, error } = await sb.from("items")
    .select("id,data")
    .eq("user_id", feed.user_id).eq("kind", "task").eq("deleted", false)
    .gte("data->>date", since)
    .limit(3000);
  if (error) return new Response("Ошибка: " + error.message, { status: 500 });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Moi planer//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Мой планер", "X-WR-TIMEZONE:Europe/Moscow",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
  ];
  for (const r of rows ?? []) {
    const t = r.data as Record<string, string | number | boolean>;
    const date = String(t.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const title = (t.done ? "✓ " : "") + (t.prio ? "❗ " : "") + String(t.title || "Задача");
    lines.push("BEGIN:VEVENT", "UID:" + r.id + "@planner", "DTSTAMP:" + stamp);
    const time = String(t.time || "");
    if (/^\d{2}:\d{2}$/.test(time)) {
      const [h, m] = time.split(":").map(Number);
      const endH = Math.min(23, h + 1);
      lines.push(
        "DTSTART;TZID=Europe/Moscow:" + ymd(date) + "T" + time.replace(":", "") + "00",
        "DTEND;TZID=Europe/Moscow:" + ymd(date) + "T" + String(endH).padStart(2, "0") + String(endH === h ? 59 : m).padStart(2, "0") + "00",
      );
    } else {
      lines.push("DTSTART;VALUE=DATE:" + ymd(date), "DTEND;VALUE=DATE:" + ymd(nextDay(date)));
    }
    lines.push("SUMMARY:" + esc(title));
    if (t.list) lines.push("CATEGORIES:" + esc(String(t.list)));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="planner.ics"',
      "Cache-Control": "no-cache",
    },
  });
});
