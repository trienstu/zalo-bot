import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  generatePowerPointFile,
  generateWordDoc,
  generateExcelFile,
  generateCsvFile,
  generateHtmlFile,
  checkIsFileOrVoiceGeneration,
  checkIsVoiceRequest,
  parseMarkdownToSlides,
  parseMarkdownRuns,
} from "./file-generator.js";
import {
  synthesizeSpeech,
  synthesizeDialogue,
  normalizeDialogueTurns,
  isDialogueText,
  cleanCoreSpeechText,
  cleanOutdatedVoicePromisesFromAnswer,
} from "./voice-generator.js";
import { validatePythonCodeSafety } from "./python-runner.js";
import { extractSimulatedGenerateFile, extractSimulatedCreateVoice, extractSimulatedPythonInterpreter, extractSpeechFallbackText } from "./simulated-tool-interceptor.js";

test("generatePowerPointFile tạo file .pptx thành công với các slide bố cục chuẩn và hiện đại", async () => {
  const res = await generatePowerPointFile(
    "test_presentation",
    "Báo Cáo Dự Án Bất Động Sản AI",
    [
      {
        layout: "title",
        title: "Báo Cáo Dự Án Serena Riverside",
        subtitle: "Phân Tích Tiềm Năng & Lộ Trình Đầu Tư 2026",
        kicker: "TỔNG QUAN CHIẾN LƯỢC",
      },
      {
        layout: "stats",
        title: "Chỉ Số Trọng Yếu Dự Án",
        kicker: "QUY MÔ",
        takeaway: "Số liệu được kiểm toán độc lập xác thực",
        stats: [
          { value: "1.200 TỶ", label: "Tổng Vốn Đầu Tư", desc: "Đã giải ngân 85%" },
          { value: "850 CĂN", label: "Căn Hộ Cao Cấp", desc: "Bàn giao hoàn thiện" },
          { value: "35%", label: "Tỷ Suất Sinh Lời", desc: "Dự phóng 3 năm" },
          { value: "Q4/2028", label: "Bàn Giao Sổ", desc: "Sở hữu lâu dài" },
        ],
      },
      {
        layout: "timeline",
        title: "Lộ Trình Triển Khai 4 Giai Đoạn",
        kicker: "QUY TRÌNH",
        steps: [
          { number: "01", title: "Khởi Công Móng", desc: "Hoàn thiện hạ tầng ngầm và cọc móng." },
          { number: "02", title: "Cất Nóc Khối Tháp", desc: "Xây dựng kết cấu thân đạt chuẩn quốc tế." },
          { number: "03", title: "Thi Công Tiện Ích", desc: "Hồ bơi vô cực, công viên nội khu compound." },
          { number: "04", title: "Bàn Giao Căn Hộ", desc: "Nghiệm thu PCCC và trao chìa khóa." },
        ],
      },
      {
        layout: "three_column",
        title: "Cơ Cấu Sản Phẩm",
        col1Title: "Căn 1 Phòng Ngủ",
        col1Bullets: ["50 m²", "Giá từ 3.2 tỷ"],
        col2Title: "Căn 2 Phòng Ngủ",
        col2Bullets: ["70 m²", "Giá từ 4.8 tỷ"],
        col3Title: "Căn 3 Phòng Ngủ",
        col3Bullets: ["100 m²", "Giá từ 6.9 tỷ"],
      },
      {
        layout: "bullets",
        title: "Điểm Nhấn Dự Án",
        bullets: [
          "Vị trí đắc địa ven sông Sài Gòn",
          "Pháp lý hoàn chỉnh 100%, sở hữu lâu dài",
          "Hạ tầng giao thông kết nối metro số 1",
          "Tiện ích nội khu chuẩn 5 sao quốc tế",
        ],
      },
      {
        layout: "two_content",
        title: "So Sánh Phương Án Đầu Tư",
        col1Title: "Phương án Thanh toán Chuẩn",
        col1Bullets: ["Chiết khấu 3%", "Tiến độ 24 tháng", "Vốn tự có 30%"],
        col2Title: "Phương án Vay Ngân Hàng",
        col2Bullets: ["Hỗ trợ lãi suất 0% 18 tháng", "Ân hạn nợ gốc", "Vốn ban đầu 15%"],
      },
    ],
    "emerald",
  );

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(res.filePath));
  assert.ok(res.fileSize > 1000);

  // Dọn dẹp file test
  try {
    fs.unlinkSync(res.filePath);
  } catch { }
});

test("parseMarkdownToSlides tự động phân loại layout thông minh từ văn bản", () => {
  const md = `
# Báo Cáo Chiến Lược Đầu Tư 2026
Phân tích tiềm năng sinh lời và quản trị rủi ro

---
[TỔNG QUAN]
## Chỉ Số Trọng Yếu 2026
- 1.500 TỶ | Tổng Vốn Đầu Tư | Đã giải ngân 80%
- 850 CĂN | Quy Mô Căn Hộ | Bàn giao chuẩn cao cấp
- 35% | Tỷ Suất Sinh Lời IRR | Dự phóng giai đoạn 3 năm
- Q4/2028 | Bàn Giao Sổ Hồng | Pháp lý hoàn chỉnh 100%
Ghi chú: Số liệu đã qua kiểm toán độc lập

---
[QUY TRÌNH]
## Lộ Trình Triển Khai
- Bước 1: Khởi công móng cọc - Hoàn thành Q1/2026
- Bước 2: Cất nóc tòa tháp - Hoàn thành Q4/2026
- Bước 3: Hoàn thiện tiện ích - Tiện ích chuẩn 5 sao
- Bước 4: Bàn giao sổ hồng - Trao chìa khóa cho cư dân

---
## Điểm Nhấn Cạnh Tranh
- Vị trí mặt tiền sông
- Kết nối metro số 1
- Tiện ích compound khép kín
`;

  const slides = parseMarkdownToSlides(md, "Tiêu Đề Mặc Định");
  assert.equal(slides.length, 4);
  assert.equal(slides[0]?.layout, "title");
  assert.equal(slides[0]?.title, "Báo Cáo Chiến Lược Đầu Tư 2026");
  assert.equal(slides[1]?.layout, "stats");
  assert.equal(slides[1]?.kicker, "TỔNG QUAN");
  assert.equal(slides[1]?.stats?.length, 4);
  assert.equal(slides[2]?.layout, "timeline");
  assert.equal(slides[2]?.steps?.length, 4);
  assert.equal(slides[3]?.layout, "bullets");
  assert.equal(slides[3]?.bullets?.length, 3);
});

test("generateWordDoc tạo file .docx hỗ trợ thể thức hai cột Nghị định 30", async () => {
  const res = await generateWordDoc(
    "test_cong_van",
    "CÔNG VĂN HÀNH CHÍNH",
    [
      {
        type: "two_columns",
        leftCol: ["ỦY BAN NHÂN DÂN", "THÀNH PHỐ HỒ CHÍ MINH", "Số: 123/UBND-VX"],
        rightCol: [
          "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
          "Độc lập - Tự do - Hạnh phúc",
          "TP. Hồ Chí Minh, ngày 20 tháng 09 năm 2026",
        ],
      },
      {
        type: "heading",
        text: "VỀ VIỆC TRIỂN KHAI ỨNG DỤNG TRỢ LÝ AI",
        level: 1,
        align: "center",
      },
      {
        type: "paragraph",
        text: "Kính gửi: Các Sở, Ban, Ngành và Ủy ban nhân dân các quận, huyện.",
        bold: true,
      },
      {
        type: "bullets",
        paragraphs: [
          "Triển khai đồng bộ hệ thống Zalo Bot trợ lý số.",
          "Đảm bảo an toàn thông tin theo tiêu chuẩn quốc gia.",
        ],
      },
      {
        type: "two_columns",
        leftCol: ["Nơi nhận:", "- Như trên;", "- Lưu: VT, TH."],
        rightCol: ["CHỦ TỊCH", "(Đã ký)", "NGUYỄN VĂN A"],
      },
    ],
  );

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(res.filePath));
  assert.ok(res.fileSize > 1000);

  // Dọn dẹp
  try {
    fs.unlinkSync(res.filePath);
  } catch { }
});

test("generateExcelFile tạo bảng tính đa sheet và công thức tự động", async () => {
  const res = await generateExcelFile(
    "test_bang_tinh",
    [
      {
        name: "Doanh Thu",
        subtitle: "Báo cáo doanh thu Q3/2026",
        headers: ["Sản phẩm", "Số lượng", "Đơn giá", "Thành tiền"],
        rows: [
          ["Gói Cơ Bản", 10, 500000, "=B3*C3"],
          ["Gói Nâng Cao", 5, 1200000, "=B4*C4"],
          ["Tổng Cộng", "", "", "=SUM(D3:D4)"],
        ],
        note: "Đơn vị tính: VNĐ",
      },
    ],
    "blue",
  );

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(res.filePath));
  assert.ok(res.fileSize > 1000);

  // Dọn dẹp
  try {
    fs.unlinkSync(res.filePath);
  } catch { }
});

test("generateCsvFile chèn tiền tố UTF-8 BOM", async () => {
  const res = await generateCsvFile(
    "test_csv",
    ["Mã", "Họ và Tên", "Địa chỉ"],
    [
      ["001", "Nguyễn Văn Tuấn", "Hà Nội, Việt Nam"],
      ["002", "Trần Thị Mai", "Đà Nẵng"],
    ],
  );

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(res.filePath));
  const buf = fs.readFileSync(res.filePath);
  // BOM UTF-8: EF BB BF
  assert.equal(buf[0], 0xef);
  assert.equal(buf[1], 0xbb);
  assert.equal(buf[2], 0xbf);

  // Dọn dẹp
  try {
    fs.unlinkSync(res.filePath);
  } catch { }
});

test("generateHtmlFile khử mã độc script", async () => {
  const malicious = `
    <h1>Báo Cáo Kiểm Tra</h1>
    <script>alert('xss');</script>
    <p onclick="alert('hack')">Đoạn văn hợp lệ</p>
    <a href="javascript:stealCookie()">Click here</a>
  `;
  const res = await generateHtmlFile("test_clean_report", "Báo Cáo", malicious);

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(res.filePath));
  const content = fs.readFileSync(res.filePath, "utf8");
  assert.equal(content.includes("<script>"), false);
  assert.equal(content.includes("onclick="), false);
  assert.equal(content.includes("javascript:"), false);

  // Dọn dẹp
  try {
    fs.unlinkSync(res.filePath);
  } catch { }
});

test("synthesizeSpeech tạo file voice .m4a AAC 44.1kHz chất lượng cao qua Google Cloud TTS", async () => {
  const res = await synthesizeSpeech({
    text: "Xin chào, đây là bản thử nghiệm giọng đọc tự nhiên từ trợ lý Zalo Bot với Google Cloud Text-to-Speech.",
    voice: "vi-VN-Neural2-A",
    caption: "Voice thử nghiệm Google TTS",
  });

  assert.equal(res.success, true);
  assert.ok(res.provider === "aistudio" || res.provider === "google");
  assert.ok(res.filePath.endsWith(".aac") || res.filePath.endsWith(".m4a"));
  assert.ok(fs.existsSync(res.filePath));
  assert.ok(res.fileSize > 2000);

  // Dọn dẹp
  try {
    fs.unlinkSync(res.filePath);
  } catch { }
});

test("synthesizeDialogue tạo podcast đối thoại 2 người qua Google Cloud TTS", async () => {
  const res = await synthesizeDialogue({
    text: "MC Nam: Xin chào quý vị khán giả đến với bản tin công nghệ.\nMC Nữ: Hôm nay chúng ta sẽ tìm hiểu về các tính năng mới của trợ lý Zalo Bot.",
    speakers: [
      { speaker: "MC Nam", voice: "vi-VN-Wavenet-B" },
      { speaker: "MC Nữ", voice: "vi-VN-Neural2-A" },
    ],
    caption: "Podcast công nghệ",
  });

  assert.equal(res.success, true);
  assert.ok(res.provider === "aistudio" || res.provider === "google");
  assert.ok(res.filePath.endsWith(".aac") || res.filePath.endsWith(".m4a"));
  assert.ok(fs.existsSync(res.filePath));
  assert.ok(res.fileSize > 4000);

  // Dọn dẹp
  try {
    fs.unlinkSync(res.filePath);
  } catch { }
});

test("checkIsFileOrVoiceGeneration nhận diện chính xác các ý định tạo file/slide/voice và follow-up", () => {
  // Test case 1: Tạo slide trực tiếp
  assert.equal(
    checkIsFileOrVoiceGeneration("tạo giúp anh bài slide thuyết trình 5 trang về Lộ trình đầu tư dự án Bất động sản Serena Riverside"),
    true,
  );

  // Test case 2: Tạo slide thuyết trình ngắn gọn
  assert.equal(checkIsFileOrVoiceGeneration("soạn bài thuyết trình powerpoint về AI"), true);

  // Test case 3: Tạo file word / docx
  assert.equal(checkIsFileOrVoiceGeneration("soạn cho anh hợp đồng thuê nhà bằng file word"), true);

  // Test case 4: Tạo voice / podcast
  assert.equal(checkIsFileOrVoiceGeneration("gửi voice đọc giúp anh đoạn văn này"), true);
  assert.equal(checkIsFileOrVoiceGeneration("Cháu đọc cho chú nghe bài này với, chú đang bận"), true);
  assert.equal(checkIsFileOrVoiceGeneration("đọc cho anh nghe với"), true);
  assert.equal(checkIsFileOrVoiceGeneration("chú đang lái xe, đọc bài này hộ chú"), true);

  // Test case 5: Tiếp nối tin nhắn trích dẫn (quote) với lệnh giục
  const quoteText = "Trang 1: Tổng quan dự án Serena Riverside... Anh Triển muốn em soạn full nội dung chi tiết từng trang để anh copy qua PowerPoint không?";
  assert.equal(checkIsFileOrVoiceGeneration("soạn luôn đi e", quoteText), true);
  assert.equal(checkIsFileOrVoiceGeneration("làm luôn đi em", quoteText), true);
  assert.equal(checkIsFileOrVoiceGeneration("triển luôn đi", quoteText), true);

  // Test case 6: Câu hỏi thăm dò năng lực thông thường (phải trả về FALSE để không tự tạo file rác)
  assert.equal(checkIsFileOrVoiceGeneration("em có biết tạo file không?"), false);
  assert.equal(checkIsFileOrVoiceGeneration("bot có tạo được slide không hả?"), false);

  // Test case 7: Vẽ đồ họa / biểu đồ / poster lịch thi đấu / bảng xếp hạng
  assert.equal(checkIsFileOrVoiceGeneration("sen chúa vẽ lại lịch thi đấu này xem"), true);
  assert.equal(checkIsFileOrVoiceGeneration("vẽ lại bảng thi đấu giúp anh"), true);
  assert.equal(checkIsFileOrVoiceGeneration("thiết kế poster lịch thi đấu"), true);
  assert.equal(checkIsFileOrVoiceGeneration("vẽ biểu đồ tăng trưởng doanh số"), true);

  // Test case 8: Câu hỏi thông thường (phải trả về FALSE)
  assert.equal(checkIsFileOrVoiceGeneration("dự án Serena Riverside nằm ở đâu?"), false);
  assert.equal(checkIsFileOrVoiceGeneration("thời tiết Hà Nội hôm nay thế nào?"), false);

  // Test case 9: Phàn nàn hoặc yêu cầu làm lại cẩn thận khi trích dẫn ảnh/biểu đồ trước đó (phải trả về TRUE)
  const quoteImageArtifact = "📊 Biểu đồ / Hình ảnh đã hoàn tất cho bác @Viet Phuoc Tran!";
  assert.equal(
    checkIsFileOrVoiceGeneration("@Sen Chúa làm ăn thế này ah e? biểu đồ gì ko có tý đồ họa nào? font thì lỗi? làm lại cẩn thận đi", quoteImageArtifact),
    true,
  );
  assert.equal(checkIsFileOrVoiceGeneration("vẽ lại cho đẹp hơn đi em", quoteImageArtifact), true);
  assert.equal(checkIsFileOrVoiceGeneration("sửa lại giúp anh cẩn thận hơn", quoteImageArtifact), true);

  // Test case 10: Đóng gói và các cách diễn đạt tự nhiên tiếng Việt
  assert.equal(checkIsFileOrVoiceGeneration("sen chúa đóng gói 3 kịch bản đó vào file docx cho anh @Lam Giao đi"), true);
  assert.equal(checkIsFileOrVoiceGeneration("gom các điều khoản hợp đồng trên vào file word giúp tôi"), true);
  assert.equal(checkIsFileOrVoiceGeneration("in ra file excel bảng báo giá này"), true);
  assert.equal(checkIsFileOrVoiceGeneration("cho các kịch bản này vào file docx"), true);
  assert.equal(checkIsFileOrVoiceGeneration("lưu nội dung trên sang file docx giúp anh"), true);
});

test("parseMarkdownRuns chuyển đổi chuẩn xác in đậm và in nghiêng", () => {
  const runs = parseMarkdownRuns("Chào **Sếp** và *các bác*!");
  assert.equal(runs.length, 5);
  const boldProp = (runs[1] as any).properties?.root?.some((r: any) => r.rootKey === "w:b");
  assert.equal(boldProp, true);
  const italicProp = (runs[3] as any).properties?.root?.some((r: any) => r.rootKey === "w:i");
  assert.equal(italicProp, true);
});

test("extractSimulatedGenerateFile bóc tách chuẩn xác lệnh giả lập [generate_file]", () => {
  const rawText = "Dưới đây là kịch bản:\\n[generate_file(fileType='docx', content='''KỊCH BẢN 1: TỔNG QUAN\\n- Hook: 00:00''', title='Kịch bản')]\\nAnh đã nhận được file chưa?";
  const extracted = extractSimulatedGenerateFile(rawText);
  assert.ok(extracted);
  assert.equal(extracted?.args.fileType, "docx");
  assert.ok(extracted?.args.content?.includes("KỊCH BẢN 1: TỔNG QUAN"));
  assert.equal(extracted?.args.title, "Kịch bản");
});

test("validatePythonCodeSafety bảo vệ an toàn: chặn đứng code nguy hiểm và cho phép code vẽ chart/infographic chuẩn", () => {
  // 1. Code an toàn: Matplotlib, PIL, Numpy, Pandas
  const safeCode1 = `
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
plt.plot(x, np.sin(x))
plt.title("Doanh thu quý 3")
`;
  assert.equal(validatePythonCodeSafety(safeCode1).safe, true);

  const safeCode2 = `
from PIL import Image, ImageDraw, ImageFont
img = Image.new('RGB', (720, 1200), color='#42030D')
draw = ImageDraw.Draw(img)
draw.text((50, 50), "Lịch Thi Đấu", fill="#FFD700")
`;
  assert.equal(validatePythonCodeSafety(safeCode2).safe, true);

  // 2. Chặn các lệnh OS / Subprocess nguy hiểm
  assert.equal(validatePythonCodeSafety('import os\nos.system("rm -rf /")').safe, false);
  assert.equal(validatePythonCodeSafety('import subprocess\nsubprocess.run(["cat", "/etc/passwd"])').safe, false);
  assert.equal(validatePythonCodeSafety('import shutil\nshutil.rmtree("./data")').safe, false);
  assert.equal(validatePythonCodeSafety('import socket\ns = socket.socket()').safe, false);
  assert.equal(validatePythonCodeSafety('eval("os.system(\'ls\')")').safe, false);
  assert.equal(validatePythonCodeSafety('open(".env").read()').safe, false);
  assert.equal(validatePythonCodeSafety('open("data/bot.db").read()').safe, false);
});

test("checkIsFileOrVoiceGeneration nhận diện chính xác yêu cầu voice/âm thanh và phân biệt câu hỏi năng lực", () => {
  // Yêu cầu voice hợp lệ
  assert.equal(checkIsFileOrVoiceGeneration("chuyển sang voice đi em"), true);
  assert.equal(checkIsFileOrVoiceGeneration("thu âm bài thơ Đây Thôn Vỹ Dạ được ko em?"), true);
  assert.equal(checkIsFileOrVoiceGeneration("phát voice bubble cho anh nghe"), true);
  assert.equal(checkIsFileOrVoiceGeneration("đọc đoạn văn này cho cả nhóm nghe nhé"), true);
  assert.equal(checkIsFileOrVoiceGeneration("ngâm thơ bài Tây Tiến được không?"), true);

  // Câu hỏi thăm dò năng lực thông thường (generic capability inquiry) -> false
  assert.equal(checkIsFileOrVoiceGeneration("em có biết tạo file không?"), false);
  assert.equal(checkIsFileOrVoiceGeneration("bot có tạo được slide không hả?"), false);
  assert.equal(checkIsFileOrVoiceGeneration("em có biết làm voice ko?"), false);
});

test("extractSimulatedCreateVoice bóc tách chuẩn xác lệnh giả lập [create_voice]", () => {
  const rawText = "Dưới đây là bản thu âm:\\n[create_voice(text='''Sao anh không về chơi thôn Vỹ\\nNhìn nắng hàng cau nắng mới lên''', voice='hn-quynhanh', caption='Bài thơ Đây Thôn Vỹ Dạ')]\\nBạn đã nghe được chưa?";
  const extracted = extractSimulatedCreateVoice(rawText);
  assert.ok(extracted);
  assert.equal(extracted?.toolName, "create_voice");
  assert.ok(extracted?.args.text?.includes("Sao anh không về"));
  assert.equal(extracted?.args.voice, "hn-quynhanh");
  assert.equal(extracted?.args.caption, "Bài thơ Đây Thôn Vỹ Dạ");
});
test("checkIsFileOrVoiceGeneration nhận diện chuẩn xác ý định kịch bản/podcast/đối thoại 2 người", () => {
  assert.equal(checkIsFileOrVoiceGeneration("làm một kịch bản 2 người nói chuyện về công nghệ AI"), true);
  assert.equal(checkIsFileOrVoiceGeneration("tạo cuộc trò chuyện 2 người"), true);
  assert.equal(checkIsFileOrVoiceGeneration("soạn đối thoại 2 người về chủ đề du lịch"), true);
  assert.equal(checkIsFileOrVoiceGeneration("tạo podcast 2 người bàn luận về thị trường bất động sản"), true);
  assert.equal(checkIsFileOrVoiceGeneration("cho 2 người nói chuyện đối đáp với nhau"), true);
});

test("Bộ 3 hàm phân giải giọng đọc (AI Studio, Google Cloud, Edge) ánh xạ đồng nhất và chính xác Nam/Nữ", async () => {
  const { resolveAIStudioVoice, resolveGoogleVoice, resolveEdgeVoice } = await import("./voice-generator.js");

  // Giọng Nam
  assert.equal(resolveAIStudioVoice("vi-VN-Wavenet-B"), "Puck");
  assert.equal(resolveAIStudioVoice("nam"), "Puck");
  assert.equal(resolveAIStudioVoice("NamMinh"), "Puck");
  assert.equal(resolveGoogleVoice("Puck"), "vi-VN-Wavenet-B");
  assert.equal(resolveEdgeVoice("Puck"), "vi-VN-NamMinhNeural");

  // Giọng Nữ
  assert.equal(resolveAIStudioVoice("vi-VN-Neural2-A"), "Aoede");
  assert.equal(resolveAIStudioVoice("nữ"), "Aoede");
  assert.equal(resolveAIStudioVoice("HoaiMy"), "Aoede");
  assert.equal(resolveGoogleVoice("Aoede"), "vi-VN-Neural2-A");
  assert.equal(resolveEdgeVoice("Aoede"), "vi-VN-HoaiMyNeural");
});

test("cleanTextForTTS làm sạch triệt để markdown và chỉ dẫn cảm xúc trong ngoặc", async () => {
  const { cleanTextForTTS } = await import("./voice-generator.js");

  const raw = "### Tiêu đề\n**Nam (hào hứng):** Xin chào các bạn! [cười lớn]\nĐây là một bài thơ hay: *Đây Thôn Vỹ Dạ*\nXem thêm tại https://example.com/tho";
  const cleaned = cleanTextForTTS(raw);

  assert.ok(!cleaned.includes("###"));
  assert.ok(!cleaned.includes("**"));
  assert.ok(!cleaned.includes("*"));
  assert.ok(!cleaned.includes("(hào hứng)"));
  assert.ok(!cleaned.includes("[cười lớn]"));
  assert.ok(!cleaned.includes("https://"));
  assert.ok(cleaned.includes("Nam: Xin chào các bạn!"));
  assert.ok(cleaned.includes("Đây Thôn Vỹ Dạ"));
});

test("resolveAIStudioVoice nhận diện chính xác qua styleHint vùng miền và giới tính", async () => {
  const { resolveAIStudioVoice } = await import("./voice-generator.js");

  assert.equal(resolveAIStudioVoice(undefined, "giọng nữ người Huế"), "Aoede");
  assert.equal(resolveAIStudioVoice(undefined, "giọng nam miền Bắc"), "Puck");
  assert.equal(resolveAIStudioVoice(undefined, "nam MC trầm ấm"), "Fenrir");
  assert.equal(resolveAIStudioVoice(undefined, "nữ dịu dàng kore"), "Kore");
});

test("extractSimulatedCreateVoice bóc tách chính xác cú pháp tag [create_voice text='...' /] từ phản hồi của model", () => {
  const rawFromUserScreenshot = `PODCAST: BẢN TÌNH CA MÙA THU 🎙️💕
- Nam: "Người ta bảo mùa thu là mùa của nỗi nhớ..."
- Nữ: "Anh lại văn vở rồi!..."

[create_voice text="Nam: Người ta bảo mùa thu là mùa của nỗi nhớ, nhưng với anh, mùa thu là mùa để bắt đầu một tình yêu. Nữ: Anh lại văn vở rồi! Mùa nào anh chẳng nói thế, tin được không đây? Nam: Lần này là thật đấy. Nhìn lá vàng rơi, anh chỉ ước có thể nắm tay em đi hết cả con đường này. Nữ: Nghe cũng xuôi tai đấy nhỉ. Thế anh định nắm tay em đến bao giờ? Nam: Đến khi nào em đồng ý để anh được làm người chăm sóc em mỗi ngày. Mình thử bắt đầu từ hôm nay nhé? Nữ: Để xem thái độ của anh thế nào đã. Nếu đủ chân thành, em sẽ cân nhắc. Nam: Thái độ của anh thì rõ mười mươi rồi, chỉ cần em gật đầu, cả thế giới này anh đều có thể mang đến cho em." /]`;

  const extracted = extractSimulatedCreateVoice(rawFromUserScreenshot);
  assert.ok(extracted, "Phải trích xuất được tool call create_voice");
  assert.equal(extracted?.toolName, "create_voice");
  assert.ok(extracted?.args.text?.startsWith("Nam: Người ta bảo mùa thu"));
  assert.ok(extracted?.args.text?.endsWith("cho em."));
  assert.ok(extracted?.rawMatch.startsWith("[create_voice"));
  assert.ok(extracted?.rawMatch.endsWith("/]"));
});

test("normalizeDialogueTurns và isDialogueText chuẩn hóa chính xác hội thoại bị dồn trên 1 dòng", () => {
  const singleLineDialogue = 'Nam: Người ta bảo mùa thu là mùa của nỗi nhớ. Nữ: Anh lại văn vở rồi! Nam: Lần này là thật đấy. Nữ: Nghe cũng xuôi tai đấy.';

  assert.equal(isDialogueText(singleLineDialogue), true);

  const normalized = normalizeDialogueTurns(singleLineDialogue);
  const turns = normalized.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(turns.length, 4);
  assert.ok(turns[0]?.startsWith("Nam:"));
  assert.ok(turns[1]?.startsWith("Nữ:"));
  assert.ok(turns[2]?.startsWith("Nam:"));
  assert.ok(turns[3]?.startsWith("Nữ:"));
});

test("checkIsVoiceRequest nhận diện chuẩn xác các yêu cầu đọc diễn cảm và thu âm thơ", () => {
  assert.equal(checkIsVoiceRequest('đọc diễn cảm cho a bài thơ gì mà có câu "ao thu lạnh lẽo nước trong veo" ak'), true);
  assert.equal(checkIsFileOrVoiceGeneration('đọc diễn cảm cho a bài thơ gì mà có câu "ao thu lạnh lẽo nước trong veo" ak'), true);
  assert.equal(checkIsVoiceRequest("sen chúa thu âm bài thơ thu điếu đi"), true);
  assert.equal(checkIsFileOrVoiceGeneration("sen chúa thu âm bài thơ thu điếu đi"), true);
  assert.equal(checkIsVoiceRequest("đọc thơ Hàn Mặc Tử"), true);
  assert.equal(checkIsVoiceRequest("ngâm thơ bài Tây Tiến"), true);
  assert.equal(checkIsVoiceRequest("thuyết minh video này"), true);
});

test("extractSpeechFallbackText bóc tách trọn vẹn bài thơ và loại bỏ lời chào / thông báo kỹ thuật", () => {
  const botAnswerFromScreenshot = `@Trien Nguyen Dạ Sếp Trien Nguyen, bài thơ có câu mở đầu "Ao thu lạnh lẽo nước trong veo" chính là kiệt tác Thu Điếu (Câu cá mùa thu) của nhà thơ vĩ đại Nguyễn Khuyến ạ!

Em xin gửi tặng Sếp trọn vẹn bài thơ:

THU ĐIẾU
Tác giả: Nguyễn Khuyến

Ao thu lạnh lẽo nước trong veo,
Một chiếc thuyền câu bé tẻo teo.
Sóng biếc theo làn hơi gợn tí,
Lá vàng trước gió khẽ đưa vèo.

Tầng mây lơ lửng trời xanh ngắt,
Ngõ trúc quanh co khách vắng teo.
Tựa gối ôm cần lâu chẳng được,
Cá đâu đớp động dưới chân bèo.

Hệ thống đang tiến hành xử lý thu âm giọng đọc diễn cảm bài thơ này theo chuẩn Google AI Studio và gửi file voice trực tiếp vào nhóm ngay đây để Sếp thưởng thức ạ! 🎙️🍃

Sếp có muốn em đọc diễn cảm thêm bài thơ nào khác nữa không ạ?`;

  const fallback = extractSpeechFallbackText(botAnswerFromScreenshot);
  assert.ok(fallback.startsWith("THU ĐIẾU"));
  assert.ok(!fallback.includes("Trien Nguyen"));
});

test("cleanCoreSpeechText bóc tách chính xác tên bài thơ, tác giả và nội dung thơ từ tin nhắn thực tế của Sếp", () => {
  const screenshotMsg = `@Trien Nguyen Dạ Sếp Trien Nguyen, em đã tiếp nhận yêu cầu và đang tiến hành thu âm bài thơ Thu Điếu của cụ Nguyễn Khuyến bằng giọng nữ truyền cảm, ngân nga đúng chất ngâm thơ theo chuẩn Gemini TTS (Google AI Studio) mà em đã báo cáo với Sếp ạ.

Hệ thống đang xử lý qua worker nền để đảm bảo chất lượng âm thanh tốt nhất, file âm thanh sẽ được gửi trực tiếp vào nhóm ngay sau khi hoàn tất.

Dưới đây là nội dung bài thơ em đang thực hiện:

THU ĐIẾU (Câu cá mùa thu)
Tác giả: Nguyễn Khuyến

Ao thu lạnh lẽo nước trong veo,
Một chiếc thuyền câu bé tẻo teo.
Sóng biếc theo làn hơi gợn tí,
Lá vàng trước gió khẽ đưa vèo.

Tầng mây lơ lửng trời xanh ngắt,
Ngõ trúc quanh co khách vắng teo.
Tựa gối ôm cần lâu chẳng được,
Cá đâu đớp động dưới chân bèo.

Sếp Trien Nguyen chờ em một chút, file "đã" nhất sẽ có mặt ngay ạ! Sếp có muốn em chuẩn bị thêm kịch bản hay bài thơ nào khác để em "thử sức" tiếp không ạ?`;

  const cleaned = cleanCoreSpeechText(screenshotMsg);
  assert.ok(cleaned.startsWith("THU ĐIẾU (Câu cá mùa thu)"), "Phải bắt đầu bằng tên bài thơ");
  assert.ok(cleaned.includes("Tác giả: Nguyễn Khuyến"), "Phải giữ tên tác giả");
  assert.ok(cleaned.includes("Ao thu lạnh lẽo nước trong veo"), "Phải chứa câu thơ đầu");
  assert.ok(cleaned.endsWith("Cá đâu đớp động dưới chân bèo."), "Phải kết thúc ở câu thơ cuối");

  assert.ok(!cleaned.includes("Dạ Sếp Trien Nguyen"), "Không được đọc lời chào ban đầu");
  assert.ok(!cleaned.includes("worker"), "Không được đọc thông báo worker kỹ thuật");
  assert.ok(!cleaned.includes("Dưới đây là"), "Không được đọc câu dẫn nhập phiếm đàm");
  assert.ok(!cleaned.includes("chờ em một chút"), "Không được đọc câu chờ đợi");
  assert.ok(!cleaned.includes("thử sức"), "Không được đọc câu hỏi gợi mở ở cuối");
});

test("cleanCoreSpeechText hoạt động đồng bộ trên các lĩnh vực khác: bản tin thể thao, pháp luật, podcast 2 người", () => {
  // 1. Lĩnh vực Thể thao / Tin tức
  const sportsNews = `@Anh Dạ em cập nhật bản tin thể thao hôm nay:

TỔNG HỢP VÒNG 5 NGOẠI HẠNG ANH
Man City hòa Arsenal với tỷ số 2-2 trong trận cầu kịch tính tại sân Etihad. Stones ghi bàn gỡ hòa ở phút bù giờ cuối cùng.

File âm thanh sẽ được gửi ngay ạ! Bác có muốn nghe thêm bảng xếp hạng không?`;

  const cleanSports = cleanCoreSpeechText(sportsNews);
  assert.ok(cleanSports.startsWith("TỔNG HỢP VÒNG 5 NGOẠI HẠNG ANH"));
  assert.ok(cleanSports.endsWith("Stones ghi bàn gỡ hòa ở phút bù giờ cuối cùng."));
  assert.ok(!cleanSports.includes("Dạ em cập nhật"));
  assert.ok(!cleanSports.includes("Bác có muốn nghe thêm"));

  // 2. Lĩnh vực Pháp luật
  const lawText = `Dạ thưa Sếp, em xin gửi trích dẫn điều khoản:

ĐIỀU 132 BỘ LUẬT LAO ĐỘNG 2019: NGHỈ HẰNG NĂM
Người lao động làm việc đủ 12 tháng cho một người sử dụng lao động thì được nghỉ hằng năm, hưởng nguyên lương theo hợp đồng lao động.

Hệ thống đang tiến hành tổng hợp voice... Sếp cần tra cứu thêm điều khoản nào không ạ?`;

  const cleanLaw = cleanCoreSpeechText(lawText);
  assert.ok(cleanLaw.startsWith("ĐIỀU 132 BỘ LUẬT LAO ĐỘNG 2019: NGHỈ HẰNG NĂM"));
  assert.ok(cleanLaw.endsWith("hưởng nguyên lương theo hợp đồng lao động."));
  assert.ok(!cleanLaw.includes("Dạ thưa Sếp"));
  assert.ok(!cleanLaw.includes("Hệ thống đang tiến hành"));

  // 3. Lĩnh vực Kịch bản Podcast 2 người
  const podcastText = `Dưới đây là kịch bản đối thoại:

KỊCH BẢN: ĐỐI THOẠI VỀ KHOA HỌC DỮ LIỆU
Nam: Chào Mai, theo bạn kỹ năng nào quan trọng nhất với một Data Scientist?
Nữ: Mình nghĩ đó là tư duy giải quyết vấn đề và sự am hiểu nghiệp vụ kinh doanh.

Sếp chờ em một chút, file podcast 2 giọng sẽ có mặt ngay ạ!`;

  const cleanPodcast = cleanCoreSpeechText(podcastText);
  assert.ok(cleanPodcast.startsWith("KỊCH BẢN: ĐỐI THOẠI VỀ KHOA HỌC DỮ LIỆU"));
  assert.ok(cleanPodcast.includes("Nam: Chào Mai"));
  assert.ok(cleanPodcast.endsWith("Nữ: Mình nghĩ đó là tư duy giải quyết vấn đề và sự am hiểu nghiệp vụ kinh doanh."));
  assert.ok(!cleanPodcast.includes("Dưới đây là kịch bản"));
  assert.ok(!cleanPodcast.includes("Sếp chờ em một chút"));
});

test("cleanOutdatedVoicePromisesFromAnswer loại bỏ sạch các câu hứa hẹn kỹ thuật khi voice đã gửi", () => {
  const originalAnswer = `@Trien Nguyen Dạ Sếp Trien Nguyen, em xin gửi tặng Sếp trọn vẹn bài thơ:

Hệ thống đang xử lý qua worker nền để đảm bảo chất lượng âm thanh tốt nhất, file âm thanh sẽ được gửi trực tiếp vào nhóm ngay sau khi hoàn tất.

THU ĐIẾU
Ao thu lạnh lẽo nước trong veo...

Sếp Trien Nguyen chờ em một chút, file "đã" nhất sẽ có mặt ngay ạ!`;

  const cleaned = cleanOutdatedVoicePromisesFromAnswer(originalAnswer);
  assert.ok(!cleaned.includes("worker nền"));
  assert.ok(!cleaned.includes("chờ em một chút"));
  assert.ok(cleaned.includes("@Trien Nguyen Dạ Sếp Trien Nguyen"));
  assert.ok(cleaned.includes("THU ĐIẾU"));
});

test("cleanCoreSpeechText trả về rỗng khi tin nhắn chỉ chứa câu tiếp nhận/hứa hẹn (Screenshot 1)", () => {
  const screenshot1 = `@Trien Nguyen Dạ Sếp Trien Nguyen, em đã tiếp nhận yêu cầu và đang tiến hành xử lý bản đọc thu âm bài thơ "Đi học" (thơ Hoàng Minh Chính) bằng giọng Nam miền Nam trầm ấm, truyền cảm theo đúng ý Sếp ạ!`;
  const cleaned = cleanCoreSpeechText(screenshot1);
  assert.strictEqual(cleaned, "", "Phải trả về chuỗi rỗng để không đọc câu tiếp nhận thành tiếng!");
});

test("cleanCoreSpeechText trả về rỗng khi tin nhắn chỉ chứa lý do hạn mức giả lập và mời uống trà (Screenshot 2)", () => {
  const screenshot2 = `@Trien Nguyen Dạ Sếp Trien Nguyen, em đã ghi nhận yêu cầu của Sếp.

Hiện tại, hệ thống đang tạm đạt ngưỡng giới hạn tác vụ tạo file âm thanh (2 tác vụ/giờ). Ngay khi hạn mức được làm mới, em sẽ thực hiện thu âm bài thơ "Đi học" của tác giả Hoàng Minh Chính với chất giọng Nam miền Nam trầm ấm, truyền cảm nhất để gửi đến Sếp ngay lập tức ạ.

Sếp thong thả dùng trà, em luôn túc trực để phục vụ Sếp ạ! Sếp có cần em hỗ trợ thêm thông tin nào khác trong lúc chờ đợi không ạ?`;
  const cleaned = cleanCoreSpeechText(screenshot2);
  assert.strictEqual(cleaned, "", "Phải trả về chuỗi rỗng để không đọc lý do hạn mức hay lời mời dùng trà thành tiếng!");
});

test("cleanCoreSpeechText bóc tách chính xác toàn văn bài thơ khi nằm giữa lời tiếp nhận, giới hạn và chào kết", () => {
  const mixedMsg = `Về việc thu âm giọng đọc:
- Hiện tại hạn mức tạo file âm thanh/nhạc của hệ thống trong nhóm đang tạm đạt mức giới hạn (2 tác vụ/giờ).
- Đồng thời, tính năng gửi voice trực tiếp qua lệnh thoại (zalo_say) trong nhóm chỉ hỗ trợ khi có lệnh từ tài khoản quản trị/chủ nhân.

Vì thế, lát nữa khi hệ thống hồi lại hạn mức âm thanh mới, em sẽ tạo ngay bản ngâm thơ/đọc thơ diễn cảm theo đúng chất giọng truyền cảm nhất cho anh nhé!

Trong lúc chờ đợi, em xin gửi tặng anh trọn vẹn lời bài thơ "Đi Học":

🎒 ĐI HỌC
Tác giả: Hoàng Minh Chính

Hôm qua em tới trường
Mẹ dắt tay từng bước
Hôm nay mẹ lên nương
Một mình em tới lớp.

Chim đùa theo trong lá
Cá dưới khe thì thào
Hương rừng chen hương cốm
Đường nhấp nhô quanh đèo.

Anh Triển thong thả uống chén trà, lát nữa em thu âm gửi anh nghe sau nha! ☕🌸✨`;

  const cleaned = cleanCoreSpeechText(mixedMsg);
  assert.ok(cleaned.startsWith("🎒 ĐI HỌC"), "Phải bắt đầu từ tên bài thơ");
  assert.ok(cleaned.includes("Tác giả: Hoàng Minh Chính"), "Phải giữ tên tác giả");
  assert.ok(cleaned.includes("Hôm qua em tới trường"), "Phải có khổ thơ 1");
  assert.ok(cleaned.endsWith("Đường nhấp nhô quanh đèo."), "Phải kết thúc ở khổ thơ cuối cùng");
  assert.ok(!cleaned.includes("hạn mức"), "Không được chứa câu hạn mức");
  assert.ok(!cleaned.includes("chén trà"), "Không được chứa lời mời uống trà");
  assert.ok(!cleaned.includes("lát nữa em thu âm"), "Không được chứa lời hứa hẹn tương lai");
});

test("isDialogueText không nhầm lẫn bài thơ / văn bản có metadata (Tác giả, Bài thơ, Thể loại) thành hội thoại đối đáp", () => {
  const poemWithMetadata = `THU ĐIẾU (Câu cá mùa thu)
Bài thơ: Thu Điếu
Tác giả: Nguyễn Khuyến
Thể thơ: Thất ngôn bát cú Đường luật

Ao thu lạnh lẽo nước trong veo,
Một chiếc thuyền câu bé tẻo teo.
Sóng biếc theo làn hơi gợn tí,
Lá vàng trước gió khẽ đưa vèo.`;

  assert.equal(isDialogueText(poemWithMetadata), false, "Bài thơ có các đề mục Tác giả:, Bài thơ:, Thể thơ: không được coi là hội thoại đối đáp!");

  const lawWithMetadata = `Điều 132: Nghỉ hằng năm
Khoản 1: Người lao động làm việc đủ 12 tháng cho một người sử dụng lao động thì được nghỉ hằng năm.
Khoản 2: Ngày nghỉ hằng năm tăng thêm theo thâm niên.`;

  assert.equal(isDialogueText(lawWithMetadata), false, "Văn bản luật có Điều:, Khoản: không được coi là hội thoại đối đáp!");

  const singleSpeakerNarrative = `Thuyết minh: Xin chào các bạn đến với chương trình.
Thuyết minh: Hôm nay chúng ta cùng khám phá vẻ đẹp vịnh Hạ Long.`;

  assert.equal(isDialogueText(singleSpeakerNarrative), false, "Chỉ có 1 nhân vật thuyết minh nói nhiều lần không phải là hội thoại đa nhân vật!");
});

test("isDialogueText nhận diện chuẩn xác kịch bản đối thoại / podcast 2 người trở lên", () => {
  const podcastScript = `Kịch bản Podcast: Chuyện Khởi Nghiệp
Nam (hào hứng): Chào Mai, bạn thấy thị trường công nghệ năm nay thế nào?
Nữ: Chào anh Nam, em thấy các mô hình AI đang phát triển bùng nổ!
Nam: Đúng vậy, chúng ta cùng đào sâu chủ đề này nhé.`;

  assert.equal(isDialogueText(podcastScript), true, "Kịch bản có Nam và Nữ đối đáp phải được nhận diện là hội thoại!");
});

test("cleanCoreSpeechText loại bỏ triệt để phần phân tích, bình luận, ý nghĩa và đường kẻ bên dưới bài thơ", () => {
  const poemWithAnalysis = `Dạ Sếp Trien Nguyen, em xin gửi bài thơ:

THU ĐIẾU (Câu cá mùa thu)
Tác giả: Nguyễn Khuyến

Ao thu lạnh lẽo nước trong veo,
Một chiếc thuyền câu bé tẻo teo.
Sóng biếc theo làn hơi gợn tí,
Lá vàng trước gió khẽ đưa vèo.

Tầng mây lơ lửng trời xanh ngắt,
Ngõ trúc quanh co khách vắng teo.
Tựa gối ôm cần lâu chẳng được,
Cá đâu đớp động dưới chân bèo.

---
**Ý nghĩa và nghệ thuật bài thơ:**
Thu Điếu là một bức tranh mùa thu tuyệt mỹ ở đồng bằng Bắc Bộ. Bằng nghệ thuật lấy động tả tĩnh...

Sếp nghe xong thấy thế nào ạ? Chúc Sếp có những giây phút thư giãn!`;

  const cleaned = cleanCoreSpeechText(poemWithAnalysis);
  assert.ok(cleaned.startsWith("THU ĐIẾU (Câu cá mùa thu)"), "Phải bắt đầu từ tên bài thơ");
  assert.ok(cleaned.includes("Tác giả: Nguyễn Khuyến"), "Phải giữ tên tác giả");
  assert.ok(cleaned.includes("Cá đâu đớp động dưới chân bèo."), "Phải có khổ thơ cuối");
  assert.ok(!cleaned.includes("Ý nghĩa và nghệ thuật bài thơ"), "TUYỆT ĐỐI KHÔNG đọc phần phân tích ý nghĩa bên dưới!");
  assert.ok(!cleaned.includes("bức tranh mùa thu tuyệt mỹ"), "TUYỆT ĐỐI KHÔNG đọc nội dung bình luận!");
  assert.ok(!cleaned.includes("Sếp nghe xong thấy thế nào"), "Không đọc câu hỏi ở cuối!");
  assert.ok(!cleaned.includes("---"), "Không chứa đường kẻ markdown!");
});

test("extractSimulatedPythonInterpreter bóc tách chính xác code Python từ tag hoặc hàm giả lập", () => {
  const simulatedTag = `Dạ Sếp, em đã tạo poster cổ động:
[python_interpreter]
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(8, 12))
ax.text(0.5, 0.5, "VIỆT NAM CHIẾN THẮNG!", color="gold", fontsize=24)
plt.savefig("poster.png")
[/python_interpreter]
Chúc đội tuyển Việt Nam thi đấu rực rỡ!`;

  const res1 = extractSimulatedPythonInterpreter(simulatedTag);
  assert.ok(res1, "Phải bóc tách được từ [python_interpreter]");
  assert.equal(res1?.toolName, "python_interpreter");
  assert.ok(res1?.code.includes("VIỆT NAM CHIẾN THẮNG!"));
  assert.ok(res1?.rawMatch.includes("[/python_interpreter]"));

  const simulatedFunc = `[python_interpreter(code="import matplotlib.pyplot as plt\\nplt.plot([1, 2, 3])\\nplt.savefig('chart.png')")]`;
  const res2 = extractSimulatedPythonInterpreter(simulatedFunc);
  assert.ok(res2, "Phải bóc tách được từ [python_interpreter(code=...)]");
  assert.ok(res2?.code.includes("plt.plot"));

  const simulatedOpenTagWithFences = `Dạ em vẽ biểu đồ cho Sếp:
[python_interpreter]
\`\`\`python
import matplotlib.pyplot as plt
import numpy as np
plt.bar(['A', 'B'], [10, 20])
plt.savefig('result.png')
\`\`\`
Sếp xem biểu đồ nhé!`;

  const res3 = extractSimulatedPythonInterpreter(simulatedOpenTagWithFences);
  assert.ok(res3, "Phải bóc tách được từ [python_interpreter] kèm markdown fence");
  assert.ok(res3?.code.includes("plt.bar"));
  assert.ok(!res3?.code.includes("```"));
});
