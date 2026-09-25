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
  parseMarkdownToSlides,
  parseMarkdownRuns,
} from "./file-generator.js";
import { synthesizeSpeech, synthesizeDialogue } from "./voice-generator.js";
import { validatePythonCodeSafety } from "./python-runner.js";
import { extractSimulatedGenerateFile, extractSimulatedCreateVoice } from "./simulated-tool-interceptor.js";

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
  assert.ok(res.filePath.endsWith(".m4a"));
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
  assert.ok(res.filePath.endsWith(".m4a"));
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
