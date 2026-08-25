#!/usr/bin/env bash
# Seed N random-pattern Redis keys to test the key view at scale.
# Keys look like: user:3f7a2:session / order:a1b2c3:item:41 / cache:9f8e:blob:7
# Default 30000. Usage: ./scripts/seed_redis.sh [count] [-p port] [-h host]
set -euo pipefail

COUNT="${1:-30000}"
PORT=6379
HOST=127.0.0.1
DB=0

# minimal arg parsing after the positional count
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p) PORT="$2"; shift 2 ;;
    -h) HOST="$2"; shift 2 ;;
    -n) DB="$2"; shift 2 ;;
    *) shift ;;
  esac
done

ALPHANUM="abcdef0123456789"
words=(user order cache session item blob cart profile log metric)
SECTIONS=($(seq 1 3 | sort -R))
CHARSETS=("abcdef0123456789" "abcdef0123456789" "abcdef0123456789")

gen() {
  local n="$1" w i r
  for ((i = 0; i < n; i++)); do
    w=${words[$((RANDOM % ${#words[@]}))]}
    r=""
    local j
    for ((j = 0; j < 6; j++)); do
      r+="${ALPHANUM:$((RANDOM % ${#ALPHANUM})):1}"
    done
    echo "SET ${w}:${r}:id:${i} v${i}"
  done
}

# Build RESP inline commands and bulk-load via --pipe (fast, one round trip)
gen "$COUNT" | awk '{ printf "*3\r\n$3\r\nSET\r\n$%d\r\n%s\r\n$%d\r\n%s\r\n", length($2), $2, length($3), $3 }' \
  | redis-cli -h "$HOST" -p "$PORT" -n "$DB" --pipe

echo "Seeded $COUNT keys into db$DB at $HOST:$PORT"
redis-cli -h "$HOST" -p "$PORT" -n "$DB" dbsize
