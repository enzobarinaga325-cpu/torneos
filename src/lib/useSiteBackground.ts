import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "./supabase";

/** Fondo global del sitio público (Home y páginas de torneo), configurado desde el admin. */
export function useSiteBackground(): CSSProperties | undefined {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("site_settings")
      .select("background_url")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => setUrl(data?.background_url ?? null));
  }, []);

  if (!url) return undefined;
  return {
    backgroundImage: `linear-gradient(rgba(244,244,245,0.35), rgba(244,244,245,0.35)), url(${url})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
  };
}
