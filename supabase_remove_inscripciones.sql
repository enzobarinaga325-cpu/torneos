-- Se saca la pestaña de Inscripciones (pagó/no pagó): con la lista de participantes para
-- imprimir alcanza. Pegar y ejecutar en el SQL Editor de Supabase.
alter table teams drop column if exists paid;
