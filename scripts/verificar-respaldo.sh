#!/usr/bin/env bash
# Restaura un respaldo en una base vacía y comprueba que no falte nada.
#
#   DESTINO_URL=...  RESPALDO_CLAVE=...  scripts/verificar-respaldo.sh <archivo.dump.gpg>
#
# Un respaldo que nunca se restauró es una suposición. Esto lo restaura en
# `DESTINO_URL` —que tiene que ser una base vacía y desechable: el CI usa una
# de prueba— y compara tabla por tabla las filas restauradas con las que
# había al respaldar (el archivo `.filas` que deja scripts/respaldo.sh).
#
# Para restaurar en producción de verdad se usa el mismo comando de abajo,
# `pg_restore`, contra la base nueva; después hay que correr
# `npm run db:migrate-rls` para recrear el rol `carwash_app` y sus permisos,
# que el respaldo no lleva (`--no-owner --no-acl`). Ver el README, «Respaldos».
set -euo pipefail

archivo="${1:?Uso: scripts/verificar-respaldo.sh <archivo.dump.gpg>}"
: "${DESTINO_URL:?Falta DESTINO_URL}"
: "${RESPALDO_CLAVE:?Falta RESPALDO_CLAVE}"
filas_esperadas="${archivo%.dump.gpg}.filas"

gpg --batch --quiet --decrypt --passphrase "$RESPALDO_CLAVE" "$archivo" \
  | pg_restore --no-owner --no-acl --exit-on-error -d "$DESTINO_URL"

# El destino es una base de prueba sin políticas activas para este usuario
# (superusuario en el CI), así que cuenta todo.
diferencias=0
while read -r tabla esperadas; do
  restauradas="$(psql "$DESTINO_URL" -tAc "SELECT count(*) FROM public.\"$tabla\"")"
  if [ "$restauradas" != "$esperadas" ]; then
    echo "❌ $tabla: se respaldaron $esperadas filas y se restauraron $restauradas"
    diferencias=$((diferencias + 1))
  fi
done < "$filas_esperadas"

if [ "$diferencias" -gt 0 ]; then
  echo "❌ $diferencias tablas no coinciden: este respaldo no sirve." >&2
  exit 1
fi
echo "✅ Restaurado y verificado: $(wc -l < "$filas_esperadas") tablas, todas con las mismas filas."
