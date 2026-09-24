-- Inscripciones deja de distinguir efectivo/transferencia: ahora es un simple pagó/no
-- pagó. Migra los datos existentes (cualquier medio ya cargado pasa a "pagó") y borra la
-- columna vieja. Pegar y ejecutar en el SQL Editor de Supabase.

alter table teams add column if not exists paid boolean not null default false;
update teams set paid = true where payment_method is not null;
alter table teams drop column if exists payment_method;
