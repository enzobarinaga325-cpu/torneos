// Cloudflare Pages Function: intercepta /torneo/:slug antes de servir el index.html estático
// y le mete meta tags Open Graph / Twitter Card con el nombre y el logo DE ESE torneo puntual
// — así, cuando alguien comparte el link por WhatsApp o Instagram, la vista previa muestra el
// nombre y el logo del torneo en vez del texto genérico del sitio. WhatsApp/Instagram no
// ejecutan el JavaScript de la SPA, así que esto tiene que pasar en el HTML de la respuesta.
export async function onRequestGet(context) {
  const { slug } = context.params;
  const res = await context.next();
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return res;

  const html = await res.text();

  const SUPABASE_URL = context.env.VITE_SUPABASE_URL || "https://bfglmsqbxgwrcwodqjbp.supabase.co";
  const ANON_KEY = context.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmZ2xtc3FieGd3cmN3b2RxamJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTU3MDUsImV4cCI6MjA5ODc5MTcwNX0.Nv2FhkYE5BZ3ijjL0j0umibR7B25odJWFIY-PtxTamM";

  let title = "Torneos";
  let description = "Organizá torneos de pádel: zonas, partidos y fixture.";
  let image = null;

  try {
    const apiRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tournaments?slug=eq.${encodeURIComponent(String(slug))}&published=eq.true&select=name,logo_url`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
    );
    if (apiRes.ok) {
      const rows = await apiRes.json();
      const t = rows[0];
      if (t) {
        title = t.name;
        description = `Seguí "${t.name}": tabla de posiciones y partidos, semana a semana.`;
        image = t.logo_url || null;
      }
    }
  } catch {
    // Si Supabase no responde, se sirve igual el HTML con los meta tags genéricos de siempre
    // — nunca por eso se cae la página.
  }

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let updated = html
    .replace(/<title>.*?<\/title>/s, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(description)}" />`)
    // Saca los og:*/twitter:* genéricos del index.html estático para no dejarlos duplicados
    // (y en conflicto) junto a los del torneo que se agregan más abajo.
    .replace(/\s*<meta (property="og:|name="twitter:)[^>]*>\n?/g, "");

  const ogTags = [
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${esc(context.request.url)}" />`,
    image ? `<meta property="og:image" content="${esc(image)}" />` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    image ? `<meta name="twitter:image" content="${esc(image)}" />` : "",
  ].filter(Boolean).join("\n    ");

  updated = updated.replace("</head>", `    ${ogTags}\n  </head>`);

  // El Content-Length original ya no vale (el HTML cambió de tamaño) — se lo saca para que
  // lo recalcule solo en vez de mandar un tamaño viejo que corte la respuesta.
  const headers = new Headers(res.headers);
  headers.delete("content-length");

  // Siempre 200: esto es la SPA sirviendo su propio index.html (aunque `context.next()`
  // haya caído al 404.html de respaldo por no matchear un archivo estático literal) — un
  // 404 real haría que WhatsApp/Instagram no muestren ninguna vista previa del link.
  return new Response(updated, { status: 200, headers });
}
