-- Inscripciones: marca si cada pareja ya pagó, y con qué método. Pegar y ejecutar en el
-- SQL Editor de Supabase.

alter table teams
  add column if not exists payment_method text check (payment_method in ('efectivo', 'transferencia'));
