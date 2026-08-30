#!/usr/bin/env bash
set -e

echo "===================================================="
echo "    BẮT ĐẦU THIẾT LẬP 2 THƯ MỤC DỰ ÁN ĐỘC LẬP 100%   "
echo "===================================================="

HOME_DIR="${HOME:-/home/congtrien125}"
BOT1_DIR="${HOME_DIR}/zalo-bot"
BOT2_DIR="${HOME_DIR}/zalo-bot-2"

# 1. Dừng toàn bộ tiến trình PM2 cũ
echo "1. Dọn dẹp tiến trình PM2 cũ..."
pm2 kill || true

# 2. Nhân bản thư mục zalo-bot sang zalo-bot-2 (độc lập hoàn toàn)
echo "2. Nhân bản thư mục độc lập cho Bot 2..."
rm -rf "${BOT2_DIR}"
cp -r "${BOT1_DIR}" "${BOT2_DIR}"

# 3. Chuyển Database và Session của Bot 2 vào thư mục riêng của nó
echo "3. Cấu hình Database & Session cho Bot 2..."
mkdir -p "${BOT2_DIR}/bot/data" "${BOT2_DIR}/bot/session"
if [ -f "${BOT1_DIR}/data/bots/bot-2/bot.db" ]; then
  cp "${BOT1_DIR}/data/bots/bot-2/bot.db" "${BOT2_DIR}/bot/data/bot.db"
fi
if [ -d "${BOT1_DIR}/data/bots/bot-2/session" ]; then
  cp -r "${BOT1_DIR}/data/bots/bot-2/session/"* "${BOT2_DIR}/bot/session/" 2>/dev/null || true
fi
if [ -f "${BOT1_DIR}/data/bots/bot-2/.env" ]; then
  cp "${BOT1_DIR}/data/bots/bot-2/.env" "${BOT2_DIR}/bot/.env"
fi

# Đảm bảo Bot 2 có .env chuẩn xác
cat << 'ENV_EOF' > "${BOT2_DIR}/bot/.env"
PORT=3001
WEB_PORT=3001
BOT_ID=bot-2
BOT_NAME="Mộc Miên"
SQLITE_DB_PATH="data/bot.db"
SESSION_DIR="session"
VIP_LIST_PATH="data/vip-list.json"
NODE_ENV=production
ENV_EOF

# 4. Tạo ecosystem cho Bot 1 (Cổng 3000)
cat << 'ECO1_EOF' > "${BOT1_DIR}/ecosystem.config.cjs"
module.exports = {
  apps: [
    {
      name: "zalo-bot-1",
      script: "dist/index.js",
      args: "start",
      cwd: "/home/congtrien125/zalo-bot/bot",
      autorestart: true,
      time: true
    },
    {
      name: "zalo-web-1",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      cwd: "/home/congtrien125/zalo-bot/web",
      autorestart: true,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "3000"
      }
    }
  ]
};
ECO1_EOF

# 5. Tạo ecosystem cho Bot 2 (Cổng 3001)
cat << 'ECO2_EOF' > "${BOT2_DIR}/ecosystem.config.cjs"
module.exports = {
  apps: [
    {
      name: "zalo-bot-2",
      script: "dist/index.js",
      args: "start",
      cwd: "/home/congtrien125/zalo-bot-2/bot",
      autorestart: true,
      time: true
    },
    {
      name: "zalo-web-2",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3001",
      cwd: "/home/congtrien125/zalo-bot-2/web",
      autorestart: true,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "3001"
      }
    }
  ]
};
ECO2_EOF

# 6. Cấu hình Nginx
echo "4. Cập nhật cấu hình Nginx..."
sudo tee /etc/nginx/sites-available/default > /dev/null << 'NGINX_EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 3001;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX_EOF

sudo nginx -t && sudo systemctl restart nginx

# 7. Khởi động PM2
echo "5. Khởi động 2 bộ dự án độc lập trong PM2..."
pm2 start "${BOT1_DIR}/ecosystem.config.cjs"
pm2 start "${BOT2_DIR}/ecosystem.config.cjs"
pm2 save

echo ""
echo "===================================================="
echo "    ✅ ĐÃ HOÀN TẤT THIẾT LẬP 2 THƯ MỤC ĐỘC LẬP!     "
echo "  - Bot 1: http://34.42.52.96/                     "
echo "  - Bot 2: http://34.42.52.96:3001/                "
echo "===================================================="
