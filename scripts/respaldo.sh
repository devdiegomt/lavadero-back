#!/usr/bin/env bash
# Respaldo cifrado de la base de producción.
#
#   DATABASE_URL=...  RESPALDO_CLAVE=...  scripts/respaldo.sh <carpeta-de-salida>
#
# Deja en la carpeta:
#   qlarity-AAAA-MM-DD.dump.gpg   el respaldo (formato custom de pg_dump), cifrado
#   qlarity-AAAA-MM-DD.filas      cuántas filas tenía cada tabla al respaldar
#
# ## Por qué cifrado
#
# El respaldo tiene nombres, teléfonos y placas de los clientes de cada
# lavadero. Guardado como artefacto de GitHub lo puede descargar cualquiera con
# acceso al repositorio; cifrado con una clave que vive sólo en los secretos del
# repositorio, sin esa clave no sirve de nada (Ley 1581).
#
# ## Por qué no es un `pg_dump` a secas
#
# Las tablas tienen `FORCE ROW LEVEL SECURITY` (docs/05-seguridad.md §3), que se
# aplica también al dueño. Un usuario sin el atributo BYPASSRLS ve cero filas, y
# `pg_dump` por defecto se niega con «query would be affected by row-level
# security policy». Si el usuario no puede saltarse RLS, el respaldo se hace
# aplicando las políticas pero con `app.bypass_rls = on` en la sesión: la misma
# puerta que usan las migraciones y los crons. Igual se comprueba al final que
# las tablas no hayan salido vacías.
set -euo pipefail

salida="${1:?Uso: scripts/respaldo.sh <carpeta-de-salida>}"
: "${DATABASE_URL:?Falta DATABASE_URL}"
: "${RESPALDO_CLAVE:?Falta RESPALDO_CLAVE}"
mkdir -p "$salida"
fecha="$(date -u +%F)"
base="$salida/qlarity-$fecha"

# pg_dump tiene que ser de la misma versión mayor que el servidor, o mayor. Si
# la instalada es más vieja, se usa la imagen oficial de esa versión.
mayor="$(psql "$DATABASE_URL" -tAc "SHOW server_version_num" | cut -c1-2)"
local_mayor="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
if [ "$local_mayor" -ge "$mayor" ]; then
  pg_dump_cmd=(pg_dump)
else
  echo "pg_dump local es $local_mayor y el servidor $mayor: se usa postgres:$mayor"
  pg_dump_cmd=(docker run --rm -i -e PGOPTIONS --network host "postgres:$mayor-alpine" pg_dump)
fi

opciones=(--format=custom --no-owner --no-acl)
salta_rls="$(psql "$DATABASE_URL" -tAc "SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user")"
if [ "$salta_rls" != "t" ]; then
  echo "El usuario no salta RLS: respaldo con app.bypass_rls = on"
  export PGOPTIONS="-c app.bypass_rls=on"
  opciones+=(--enable-row-security)
fi

# Las filas de cada tabla al momento del respaldo. Sirve para comprobar que
# el respaldo se puede restaurar entero (scripts/verificar-respaldo.sh), y no
# tiene datos personales: sólo nombres de tablas y números.
psql "$DATABASE_URL" -tA -F' ' -c "
  SELECT c.relname, (xpath('/row/n/text()',
           query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname" > "$base.filas"

"${pg_dump_cmd[@]}" "${opciones[@]}" "$DATABASE_URL" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$RESPALDO_CLAVE" -o "$base.dump.gpg"

tablas="$(wc -l < "$base.filas")"
filas="$(awk '{s += $2} END {print s+0}' "$base.filas")"
if [ "$filas" -eq 0 ]; then
  echo "❌ Las $tablas tablas suman 0 filas: o la base está vacía, o RLS ocultó todo." >&2
  exit 1
fi
echo "✅ Respaldo: $tablas tablas, $filas filas, $(du -h "$base.dump.gpg" | cut -f1) cifrado"
