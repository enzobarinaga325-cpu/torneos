import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Faltan las variables de entorno de Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
