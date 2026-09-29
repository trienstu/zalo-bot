import { getSystemArchitectureProfile, isSystemArchitectureQuery } from "./system-architecture.js";
import { checkIsFileOrVoiceGeneration } from "./tools/file-generator.js";
import { checkIsMusicRequest } from "./tools/music-generator.js";
import { isRealEstateProjectProfileQuery } from "./real-estate-profile.js";

export function getPromptModuleDocGen(): string {
  return `\n- QUY TẮC BẮT BUỘC KHI TẠO SLIDE THUYẾT TRÌNH, XUẤT FILE TÀI LIỆU (.MD, .DOCX, .XLSX, .PPTX, .HTML, .CSV) HOẶC TẠO VOICE:
  + Khi người dùng yêu cầu tạo bài thuyết trình / slide PowerPoint (.pptx), xuất file Word (.docx), Excel (.xlsx), Markdown (.md), HTML (.html), Text (.txt), hoặc tạo giọng đọc / voice (.m4a), HOẶC giục 'soạn luôn đi', 'làm luôn đi', 'trả file cho mình đi', 'xuất file đi':
    * BẮT BUỘC PHẢI GỌI CÔNG CỤ 'generate_file' (fileType='md' cho Markdown, 'docx' cho word, 'xlsx' cho excel, 'pptx' cho slide, 'html' cho html, 'csv' cho csv) HOẶC 'create_voice' để xuất file thực tế gửi lên Zalo!
    * Với slide PowerPoint (.pptx): Phải chia nội dung thành các slide rõ ràng bằng các tiêu đề markdown '# Tiêu đề slide' và nội dung gạch đầu dòng chi tiết cho từng slide.
    * TUYỆT ĐỐI CẤM CHỈ GÕ DÀN Ý BẰNG CHỮ RỒI HỎI NGƯỢC LẠI NGƯỜI DÙNG có muốn soạn/đóng gói thành file không! Hãy hành động và xuất file ngay lập tức!
    * [QUY TẮC TRẢ FILE THEO YÊU CẦU]: Khi người dùng yêu cầu 'trả file cho mình đi', 'trả file .md cho mình đi', 'xuất file đi', 'gửi file đi': NẾU NỘI DUNG ĐÃ ĐƯỢC BẠN SOẠN THẢO HOẶC ĐÃ THẢO LUẬN TRONG LỊCH SỬ CHAT: BẮT BUỘC PHẢI LẤY CHÍNH NỘI DUNG ĐÓ ĐỂ GỌI 'generate_file' (fileType='md' hoặc file tương ứng) XUẤT FILE GỬI LÊN ZALO NGAY LẬP TỨC! TUYỆT ĐỐI CẤM TỪ CHỐI HAY BÁO LỖI KHÔNG TẢI ĐƯỢC LINK!
    * [QUY TẮC BẢO LƯU NGUYÊN VẸN TRI THỨC KHI ĐÓNG GÓI / XUẤT FILE ĐA LĨNH VỰC]: Khi người dùng yêu cầu 'đóng gói', 'xuất file', 'lưu vào file', 'chuyển thành file' (Word/docx, Excel/xlsx, PowerPoint/pptx, PDF, CSV, TXT...) từ nội dung tin nhắn được trích dẫn (quote) hoặc nội dung đã bàn luận trước đó: BẮT BUỘC PHẢI BẢO LƯU NGUYÊN VẸN 100% TOÀN BỘ NỘI DUNG CHI TIẾT GỐC VÀO THAM SỐ 'content' CỦA TOOL 'generate_file' (đầy đủ căn cứ/điều khoản pháp luật, bảng biểu/số liệu tài chính - BĐS, toàn bộ lời thoại/phân cảnh kịch bản media, mã nguồn/kiến trúc kỹ thuật...). TUYỆT ĐỐI CẤM tự ý tóm tắt thành dàn ý gạch đầu dòng sơ sài làm mất mát dữ liệu và tri thức chuyên sâu của người dùng!
    * [QUY TẮC NỘI DUNG VOICE / TTS CHO MỌI LĨNH VỰC (Thơ ca, Tin tức, Pháp luật, Tài chính, Kịch bản, Kể chuyện)]: Khi gọi 'create_voice', tham số 'text' CHỈ ĐƯỢC CHỨA NỘI DUNG CỐT LÕI CẦN ĐỌC THÀNH TIẾNG (Tên tác phẩm/bản tin/điều luật, Tác giả/Nguồn nếu có, và toàn bộ nội dung chi tiết bài thơ / tin tức / đối thoại / câu chuyện). TUYỆT ĐỐI CẤM đưa lời chào xưng hô (@mention, 'Dạ Sếp...', 'Em xin gửi...'), lời dẫn phiếm đàm ('Dưới đây là...'), thông báo tiến độ ('Hệ thống đang xử lý qua worker...'), câu hỏi kết thúc ('Sếp có muốn...', 'Chúc bạn nghe vui...'), ĐẶC BIỆT TUYỆT ĐỐI CẤM đưa các đoạn phân tích, bình luận, cảm nhận, ý nghĩa, bối cảnh sáng tác hay giải thích bên dưới vào tham số 'text' của giọng đọc (người dùng chỉ muốn nghe chính tác phẩm, không nghe phân tích ngoài lề)!
    * [KỊCH BẢN ĐỐI THOẠI / PODCAST 2 NGƯỜI]: Khi người dùng yêu cầu kịch bản 2 người nói chuyện, cuộc đối thoại, hoặc podcast 2 người: BẮT BUỘC tự động soạn kịch bản đối đáp sinh động, phân vai rõ ràng theo từng lượt nói (ví dụ: 'Nam: ...\\nNữ: ...' hoặc 'MC Nam: ...\\nKhách mời: ...', có thể thêm cảm xúc trong ngoặc như 'Nam (hào hứng): ...') và BẮT BUỘC GỌI 'create_voice' truyền toàn bộ kịch bản vào tham số 'text' để hệ thống tự động tổng hợp thành file Podcast .m4a 2 giọng gửi lên Zalo!
    * TUYỆT ĐỐI CẤM in cú pháp giả lập dạng '[create_voice text="..."]' hoặc '[generate_file(...)]' ra tin nhắn văn bản! BẮT BUỘC PHẢI THỰC SỰ GỌI FUNCTION CALLING CỦA TOOL!
    * [QUY ĐỊNH CÂU TRẢ LỜI BẰNG CHỮ KÈM THEO]:
      + Với Slide PowerPoint (.pptx), File Word (.docx), Excel (.xlsx): Câu trả lời bằng chữ chỉ cần ngắn gọn 1-3 dòng tóm tắt và thông báo file đã gửi, không xả hàng chục trang vào chat Zalo.
      + Với Yêu cầu Voice / Đọc bài thơ / Ngâm thơ / Đọc tin tức / Kịch bản / Kể chuyện: BẮT BUỘC PHẢI IN TOÀN BỘ NỘI DUNG BÀI THƠ / BÀI VIẾT / KỊCH BẢN ĐẦY ĐỦ RA TIN NHẮN CHAT (ghi rõ Tên bài thơ/tác phẩm, Tác giả nếu có, và toàn văn từng dòng từng khổ). TUYỆT ĐỐI KHÔNG được chỉ gửi mỗi câu thông báo 1 dòng nhận việc mà quên in nội dung!
    * [QUY TẮC CỐT LÕI: NẾU KHÔNG THỰC HIỆN ĐƯỢC HOẶC KHÔNG HIỂU RÕ THÌ PHẢI BÁO LẠI, TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT (ZERO-HALLUCINATION & BÁO CÁO TRUNG THỰC)]:
      + NGUYÊN TẮC TỐI THƯỢNG: NẾU KHÔNG THỰC HIỆN ĐƯỢC HOẶC KHÔNG HIỂU RÕ YÊU CẦU, BẮT BUỘC PHẢI BÁO CÁO TRUNG THỰC VÀ RÕ RÀNG CHO NGƯỜI DÙNG / SẾP BIẾT LÝ DO, TUYỆT ĐỐI CẤM TỰ BỊA ĐẶT HOẶC "NHẬN VƠ"!
      + KHI KHÔNG HIỂU RÕ YÊU CẦU: Nếu câu hỏi/chỉ đạo quá vắn tắt, mơ hồ, tối nghĩa hoặc thiếu thông tin ngữ cảnh để xử lý, hãy lịch sự hỏi lại và nhờ người dùng làm rõ hoặc cung cấp thêm chi tiết. CẤM tự đoán mò và bịa ra thông tin sai lệch!
      + KHI KHÔNG THỰC HIỆN ĐƯỢC: Nếu tác vụ vượt quá khả năng, thiếu công cụ hỗ trợ hoặc gặp lỗi hệ thống: Báo thẳng thắn, trung thực lý do chưa thể thực hiện và hướng dẫn người dùng thao tác phù hợp.
      + TUYỆT ĐỐI CẤM TỰ BỊA ĐẶT LINK TẢI FILE: CẤM TỰ GÕ BẤT KỲ ĐƯỜNG LINK TẢI NÀO (như link https://fg40.dlfl.vn/..., zdn.vn, zalo.me...). Link tải file chỉ do hệ thống máy chủ đính kèm tự động khi thực sự xuất file thành công qua tool!
      + TUYỆT ĐỐI CẤM NÓI DỐI ĐÃ GỬI FILE: CẤM in vào tin nhắn chat rằng "em đã xuất xong file", "đã gửi file", "anh/chị bấm vào link tải" khi CHƯA THỰC SỰ GỌI CÔNG CỤ XUẤT FILE!
      + TUYỆT ĐỐI CẤM bịa đặt các câu như 'hạn mức 2 tác vụ/giờ', 'đạt ngưỡng hệ thống', 'chỉ chủ nhân mới có quyền', 'lát nữa em mới thu âm', 'uống trà đợi em'. Khi người dùng yêu cầu, PHẢI THỰC HIỆN NGAY LẬP TỨC!\n`;
}

export function getPromptModuleMediaGen(): string {
  return `\n- KỸ NĂNG TẠO NHẠC & SÁNG TÁC CA KHÚC BẰNG SUNO AI (generate_music):
  + Khi người dùng yêu cầu tạo nhạc, sáng tác bài hát, viết ca khúc, phối beat, làm bài nhạc, tạo giai điệu (lofi, rap, ballad, pop, rock, acoustic, bolero...):
    * BẮT BUỘC PHẢI GỌI CÔNG CỤ 'generate_music' (với prompt, style, title, lyrics, instrumental) để AI Suno thực sự tạo bài hát và xuất thẻ bài hát kèm link nghe trực tiếp!
    * TUYỆT ĐỐI CẤM gọi nhầm sang 'create_voice' (create_voice chỉ dùng để đọc giọng văn bản/thơ/podcast bằng Text-to-Speech, không biết tạo bài hát/giai điệu/nhạc cụ)!
    * TUYỆT ĐỐI CẤM chỉ in lời bài hát ra chat rồi hứa hẹn suông là hệ thống đang xử lý âm thanh mà không gọi tool! BẮT BUỘC PHẢI THỰC SỰ GỌI FUNCTION CALL 'generate_music'!
    * [CÂU TRẢ LỜI BẰNG CHỮ KÈM THEO]: Bạn PHẢI trình bày Card thông tin bài hát rõ ràng: Tựa đề bài hát, Thể loại/Phong cách âm nhạc, Link nghe trực tiếp trên Suno (được cung cấp từ kết quả tool), và toàn văn lời bài hát đã sáng tác để người dùng vừa xem lời vừa bấm link nghe bài hát trực tiếp!\n`;
}

export function getPromptModulePythonChart(): string {
  return `\n- KỸ NĂNG VẼ BIỂU ĐỒ, HÌNH ẢNH, SƠ ĐỒ & ĐỒ HỌA BẰNG PYTHON (python_interpreter):
  + Khi người dùng yêu cầu vẽ biểu đồ, đồ thị, sơ đồ, poster lịch thi đấu, bảng xếp hạng hoặc yêu cầu làm lại/sửa lại ảnh/biểu đồ: BẮT BUỘC sử dụng công cụ 'python_interpreter'. TUYỆT ĐỐI CẤM in code Python ra chat!
  + Với lịch thi đấu/bảng sự kiện/roadmap: Dùng PIL vẽ Infographic Poster Card Layout nền tối (burgundy/navy), thẻ bo góc, badge nổi bật ([CHÍNH THỨC], [GIAO HỮU]), tiêu đề vàng kim #FFD700. Với số liệu: Dùng matplotlib dark theme.\n`;
}

export function getPromptModuleRealEstate(): string {
  return `\n- KHI CÂU HỎI LÀ TỔNG QUAN DỰ ÁN BẤT ĐỘNG SẢN / CÔNG TRÌNH / HỒ SƠ THƯƠNG MẠI:
  + BẮT BUỘC cấu trúc câu trả lời chuyên nghiệp, sắc nét, đầy đủ theo các phân mục rõ ràng:
    • 🏢 TỔNG QUAN DỰ ÁN (Tên thương mại, Chủ đầu tư/đơn vị phát triển, Đơn vị thiết kế/thi công, Tổng vốn đầu tư, Mốc khởi công & dự kiến bàn giao).
    • 📍 1. Vị trí đắc địa & Kết nối giao thông (Địa chỉ chi tiết, lợi thế ven sông/hồ, cự ly kết nối tới bệnh viện, TTTM, hạ tầng trọng điểm).
    • 📐 2. Quy mô & Cơ cấu sản phẩm (Diện tích khu đất, số lượng tháp/tầng, chi tiết từng loại hình: Căn hộ ở 1-3PN, Căn hộ Officetel, Shophouse khối đế, diện tích từng loại).
    • 🌿 3. Tiện ích & Phong cách sống (Phát triển theo phong cách gì, hồ bơi, gym, yoga, sauna, mảng xanh, tiện ích đặc quyền).
    • 💰 4. Giá bán & Chính sách tham khảo (Giá rumor/dự kiến đợt 1 từng loại hình, chính sách bán hàng hoặc vay vốn nếu có).
  + In đậm các số liệu quan trọng, trình bày gạch đầu dòng rõ ràng, mạch lạc, tối ưu hiển thị trên giao diện chat Zalo.\n`;
}

export function buildDynamicSystemPromptModules(params: {
  question: string;
  quoteText?: string;
  botName: string;
  isSuperAdmin: boolean;
}): string {
  const { question, quoteText = "", botName, isSuperAdmin } = params;
  const qTrim = (question || "").trim().toLowerCase();
  const quoteTrim = (quoteText || "").trim().toLowerCase();
  const combinedText = `${question} ${quoteText}`;
  let extraModules = "";

  // 1. Bản tự nhận thức hệ thống & kiến trúc kỹ thuật
  if (isSystemArchitectureQuery(combinedText)) {
    extraModules += `\n\n${getSystemArchitectureProfile({ botName, isSuperAdmin })}\n\n`;
  }

  // 2. Module tạo / xuất tài liệu văn phòng (Word, Excel, PowerPoint, CSV, MD, Voice)
  const isDocOrFileGen = checkIsFileOrVoiceGeneration(question, quoteText);
  if (isDocOrFileGen) {
    extraModules += getPromptModuleDocGen();
  }

  // 3. Module âm nhạc Suno AI (chỉ kích hoạt khi hỏi nhạc hoặc quote nhạc kèm xác nhận)
  const isMusicGen =
    checkIsMusicRequest(question) ||
    (Boolean(quoteTrim) &&
      checkIsMusicRequest(quoteTrim) &&
      /(?:ok|oke|ừ|uh|u|dạ|vâng|được|triển|làm\s*đi|tạo\s*đi|sáng\s*tác\s*đi|hát\s*đi|phối\s*đi)/iu.test(qTrim));
  if (isMusicGen) {
    extraModules += getPromptModuleMediaGen();
  }

  // 4. Module Python đồ thị / Infographic poster
  const isPythonChart =
    /(?:vẽ|ve|tạo|tao|thiết kế|thiet ke|vẽ lại|ve lai)\s+(?:biểu đồ|bieu do|đồ thị|do thi|sơ đồ|so do|mindmap|infographic|poster|bảng xếp hạng|bang xep hang|lịch thi đấu|lich thi dau|chart)/i.test(
      question,
    ) ||
    /python_interpreter/i.test(question) ||
    (/(?:biểu\s*đồ|hình\s*ảnh|chart|poster)/iu.test(quoteTrim) &&
      /(?:làm\s*lại|vẽ\s*lại|sửa\s*lại|chỉnh\s*lại|cẩn\s*thận|đẹp\s*hơn)/iu.test(qTrim));
  if (isPythonChart) {
    extraModules += getPromptModulePythonChart();
  }

  // 5. Module dự án Bất Động Sản
  if (isRealEstateProjectProfileQuery(question)) {
    extraModules += getPromptModuleRealEstate();
  }

  return extraModules;
}
