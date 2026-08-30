const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const home = process.env.HOME || '/home/congtrien125';

const dbPath1 = path.resolve(home, 'zalo-bot/bot/data/bot.db');
const dbPath2 = path.resolve(home, 'zalo-bot/data/bots/bot-2/bot.db');

console.log('====================================================');
console.log('       BÀI TEST TOÀN DIỆN HỆ THỐNG 2 BOT            ');
console.log('====================================================\n');

try {
  const db1 = new Database(dbPath1);
  const groups1 = db1.prepare('SELECT count(*) as c FROM bot_groups').get().c;
  const msgs1 = db1.prepare('SELECT count(*) as c FROM group_messages').get().c;
  console.log('--- 1. DATABASE BOT 1 (Sen Chúa) ---');
  console.log(`  File: ${dbPath1}`);
  console.log(`  Tổng nhóm: ${groups1} nhóm | Tổng tin nhắn: ${msgs1} tin nhắn\n`);
} catch (e) {
  console.log('Lỗi đọc DB Bot 1:', e.message);
}

try {
  const db2 = new Database(dbPath2);
  const groups2 = db2.prepare('SELECT count(*) as c FROM bot_groups').get().c;
  const msgs2 = db2.prepare('SELECT count(*) as c FROM group_messages').get().c;
  const g2Mode = db2.prepare('SELECT group_id, name, mode FROM bot_groups WHERE group_id = ?').get('1913869945242410752');
  console.log('--- 2. DATABASE BOT 2 (Mộc Miên) ---');
  console.log(`  File: ${dbPath2}`);
  console.log(`  Tổng nhóm: ${groups2} nhóm | Tổng tin nhắn: ${msgs2} tin nhắn`);
  console.log(`  Nhóm GROUP TRAO ĐỔI:`, g2Mode, '\n');
} catch (e) {
  console.log('Lỗi đọc DB Bot 2:', e.message);
}

function getHttp(port, pathStr) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: pathStr }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', err => resolve({ status: 0, error: err.message }));
  });
}

function postHttp(port, pathStr, bodyObj) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(bodyObj);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathStr,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', err => resolve({ status: 0, error: err.message }));
    req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('--- 3. TEST KẾT QUẢ HTTP WEB DASHBOARD ---');

  // Test Web 1 (Port 3000)
  const res1 = await getHttp(3000, '/api/groups');
  try {
    const json1 = JSON.parse(res1.data);
    console.log(`Web 1 (Port 3000): /api/groups trả về ${json1.groups?.length || 0} nhóm`);
  } catch {
    console.log(`Web 1 (Port 3000) Status: ${res1.status}`);
  }

  // Test Web 2 (Port 3002)
  const res2 = await getHttp(3002, '/api/groups');
  try {
    const json2 = JSON.parse(res2.data);
    console.log(`Web 2 (Port 3002): /api/groups trả về ${json2.groups?.length || 0} nhóm`);
    const g = json2.groups?.find(x => x.id === '1913869945242410752');
    console.log(`  -> Nhóm TRAO ĐỔI trên Web 2: mode = "${g?.mode}", icon = "${g?.icon}"`);
  } catch {
    console.log(`Web 2 (Port 3002) Status: ${res2.status}`);
  }

  // Test Messages on Web 2
  console.log('\n--- 4. TEST TRANG TIN NHẮN WEB 2 (/messages) ---');
  const msgRes = await getHttp(3002, '/messages');
  const matchDòng = msgRes.data.match(/hiển thị [0-9]+ dòng[^<]*/);
  const matchSelf = msgRes.data.match(/Self trong trang[^\"]*\"children\":\"([^\"]+)/);
  const matchImg = msgRes.data.match(/Ảnh đã gửi[^\"]*\"children\":\"([^\"]+)/);
  console.log(`  Render text: ${matchDòng ? matchDòng[0] : 'N/A'}`);
  console.log(`  Tin bot gửi : ${matchSelf ? matchSelf[1] : 'N/A'}`);
  console.log(`  Ảnh đã gửi  : ${matchImg ? matchImg[1] : 'N/A'}`);

  // Test POST set_mode to interactive
  console.log('\n--- 5. TEST THAY ĐỔI CHẾ ĐỘ SANG 🟢 TƯƠNG TÁC QUA HTTP POST ---');
  const postRes = await postHttp(3002, '/api/groups', {
    action: 'set_mode',
    groupId: '1913869945242410752',
    mode: 'interactive'
  });
  console.log('  Kết quả POST:', postRes.data);

  // Check lại ngay lập tức
  const checkRes = await getHttp(3002, '/api/groups');
  try {
    const checkJson = JSON.parse(checkRes.data);
    const updatedG = checkJson.groups?.find(x => x.id === '1913869945242410752');
    console.log(`  Sau khi POST -> Mode nhóm TRAO ĐỔI là: "${updatedG?.mode}" (icon: ${updatedG?.icon})`);
  } catch {}

  console.log('\n====================================================');
}

run();
