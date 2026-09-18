#!/usr/bin/env bash
set -euo pipefail

BOT_DIRS=("${HOME}/zalo-bot" "${HOME}/zalo-bot-2")

API_FOOTBALL_KEY="${API_FOOTBALL_KEY:-}"
if [[ -z "${API_FOOTBALL_KEY}" && -f "${HOME}/zalo-bot/bot/.env" ]]; then
  API_FOOTBALL_KEY="$(LC_ALL=C awk -F= 'index($0, "API_FOOTBALL_KEY=") == 1 { sub(/^[^=]*=/, ""); value=$0 } END { print value }' "${HOME}/zalo-bot/bot/.env")"
fi
if [[ -z "${API_FOOTBALL_KEY}" ]]; then
  read -r -s -p "Dán API_FOOTBALL_KEY rồi nhấn Enter: " API_FOOTBALL_KEY
  printf '\n'
else
  echo "Đã tìm thấy API_FOOTBALL_KEY hiện có; không cần nhập lại."
fi

if [[ -z "${API_FOOTBALL_KEY}" ]]; then
  echo "API_FOOTBALL_KEY không được để trống." >&2
  exit 1
fi

upsert_env() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local temp_file
  temp_file="$(mktemp)"

  if [[ -f "${env_file}" ]]; then
    LC_ALL=C awk -v key="${key}" -v value="${value}" '
      BEGIN { replaced = 0 }
      index($0, key "=") == 1 {
        if (!replaced) print key "=" value
        replaced = 1
        next
      }
      { print }
      END { if (!replaced) print key "=" value }
    ' "${env_file}" > "${temp_file}"
  else
    printf '%s=%s\n' "${key}" "${value}" > "${temp_file}"
  fi

  install -m 600 "${temp_file}" "${env_file}"
  rm -f "${temp_file}"
}

for bot_dir in "${BOT_DIRS[@]}"; do
  if [[ ! -d "${bot_dir}/bot" ]]; then
    echo "Không tìm thấy ${bot_dir}/bot; hãy git pull đúng thư mục trước." >&2
    exit 1
  fi
  upsert_env "${bot_dir}/bot/.env" "API_FOOTBALL_KEY" "${API_FOOTBALL_KEY}"
  upsert_env "${bot_dir}/bot/.env" "SEARCH_GROUNDING_ENABLED" "false"
  echo "Đã cấu hình ${bot_dir}/bot/.env"
done

# Bot 2 nạp cấu hình riêng theo BOT_ID trước cấu hình gốc. Ghi thêm vào đúng
# vị trí runtime để API dùng được dù tiến trình được khởi động với BOT_ID=bot-2.
for bot2_env in \
  "${HOME}/zalo-bot/data/bots/bot-2/.env" \
  "${HOME}/zalo-bot-2/bot/data/bots/bot-2/.env"; do
  if [[ -f "${bot2_env}" ]]; then
    upsert_env "${bot2_env}" "API_FOOTBALL_KEY" "${API_FOOTBALL_KEY}"
    upsert_env "${bot2_env}" "SEARCH_GROUNDING_ENABLED" "false"
    echo "Đã cấu hình ${bot2_env}"
  fi
done

unset API_FOOTBALL_KEY
pm2 restart all --update-env
echo "Hoàn tất: API-Football đã bật và Search Grounding đã tắt trên cả hai bot."
