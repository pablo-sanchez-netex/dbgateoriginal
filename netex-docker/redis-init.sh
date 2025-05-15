#!/bin/bash
set -e

echo "Inicializando datos en Redis..."
redis-cli -a $REDIS_PASSWORD <<EOF
  SET server:name "servidor_produccion"
  HSET user:1000 username "jdoe" email "jdoe@example.com"
  LPUSH recent_users "jdoe" "msmith" "awilson"
  SETEX temporary:data 300 "Estos datos expirarán en 5 minutos"
  SADD tags "redis" "database" "cache"
EOF
echo "Datos inicializados correctamente"
