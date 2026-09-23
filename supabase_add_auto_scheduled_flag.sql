-- Distingue un horario puesto por el auto-agendado de uno que el admin movió a mano, para
-- que el auto-agendado de liga pueda replanificar TODO lo que todavía no se jugó (y así
-- repartir bien las categorías a lo largo de la semana) sin tocar nunca lo que el admin ya
-- ajustó manualmente. No toca ni borra nada existente.
alter table matches add column if not exists auto_scheduled boolean not null default true;

-- Los partidos de liga que ya tenían horario ANTES de esta migración se tratan como
-- "movidos a mano" por las dudas (no sabemos cómo llegaron a tener ese horario), para no
-- reordenar de sorpresa nada que ya esté agendado hoy.
update matches set auto_scheduled = false where stage = 'liga' and scheduled_at is not null;
