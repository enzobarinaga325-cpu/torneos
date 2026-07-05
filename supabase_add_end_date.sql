-- Permite torneos de varios días: la fecha de cada partido ya era independiente
-- (siempre se pudo agendar partidos en distintos días), esto agrega la fecha de fin
-- del torneo para mostrar el rango completo ("9 al 12 de julio") en vez de un solo día.
-- Pegar y ejecutar en el SQL Editor de Supabase.

alter table tournaments add column if not exists end_date date;
