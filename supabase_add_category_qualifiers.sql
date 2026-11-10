-- Cuántas parejas pasan de cada zona en una categoría (por ejemplo, 4 por zona). La tabla
-- de posiciones marca en verde a las que están en puestos de clasificación. Vacío = no se
-- marca nada. No toca ni borra nada existente.
alter table categories add column if not exists qualifiers_per_zone integer
  check (qualifiers_per_zone is null or qualifiers_per_zone >= 1);
