# Source this to load server/.env.local safely:
#     . scripts/dev/load-env-local.sh server/.env.local
#
# Do NOT use `set -a; . ./.env.local; set +a`. DB_PASSWORD_SERVER and
# REDIS_PASSWORD both contain an unquoted `&`, which bash parses as the
# background operator, so that idiom silently exports them as EMPTY STRINGS and
# every subsequent connection authenticates with no password. Three separate
# rounds of this card misdiagnosed failures that way.
#
# Verify after sourcing:  echo ${#DB_PASSWORD_SERVER}   # must be > 0
while IFS= read -r line; do
  case "$line" in ''|\#*) continue;; esac
  case "$line" in *=*) k=${line%%=*}; v=${line#*=};; *) continue;; esac
  k=$(printf '%s' "$k" | tr -d ' ')
  v=${v#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}
  export "$k=$v"
done < "${1:-server/.env.local}"
