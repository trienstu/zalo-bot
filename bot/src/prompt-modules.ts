import { getSystemArchitectureProfile, isSystemArchitectureQuery } from "./system-architecture.js";
import { checkIsFileOrVoiceGeneration } from "./tools/file-generator.js";
import { checkIsMusicRequest } from "./tools/music-generator.js";
import { isRealEstateProjectProfileQuery } from "./real-estate-profile.js";
import { isYouTubeUrl } from "./tools/vertical-tools.js";
import { isFacebookUrl } from "./tools/facebook-scraper.js";
import { hasSupportedMediaUrl } from "./tools/video-downloader.js";

export function getPromptModuleDocGen(): string {
  return `\n- QUY TẮC BẮT BUỘC KHI TẠO SLIDE THUYẾT TRÌNH, XUẤT FILE TÀI LIỆU (.MD, .DOCX, .XLSX, .PPTX, .HTML, .CSV) HOẶC TẠO VOICE:
  + Khi người dùng yêu cầu tạo bài thuyết trình / slide PowerPoint (.pptx), xuất file Word (.docx), Excel (.xlsx), Markdown (.md), HTML (.html), Text (.txt), hoặc tạo giọng đọc / voice (.m4a), HOẶC giục 'soạn luôn đi', 'làm luôn đi', 'trả file cho mình đi', 'xuất file đi':
    * BẮT BUỘC PHẢI GỌI CÔNG CỤ 'generate_file' (fileType='md' cho Markdown, 'docx' cho word, 'xlsx' cho excel, 'pptx' cho slide, 'html' cho html, 'csv' cho csv) HOẶC 'create_voice' để xuất file thực tế gửi lên Zalo!
    * Với slide PowerPoint (.pptx): Phải chia nội dung thành các slide rõ ràng bằng các tiêu đề markdown '# Tiêu đề slide' và nội dung gạch đầu dòng chi tiết cho từng slide.
    * TUYỆT ĐỐI CẤM CHỈ GÕ DÀN Ý BẰNG CHỮ RỒI HỎI NGƯỢC LẠI NGƯỜI DÙNG có muốn soạn/đóng gói thành file không! Hãy hành động và xuất file ngay lập tức!
    * [QUY TẮC TRẢ FILE THEO YÊU CẦU]: Khi người dùng yêu cầu 'trả file cho mình đi', 'trả file .md cho mình đi', 'xuất file đi', 'gửi file đi': NẾU NỘI DUNG ĐÃ ĐƯỢC BẠN SOẠN THẢO HOẶC ĐÃ THẢO LUẬN TRONG LỊCH SỬ CHAT: BẮT BUỘC PHẢI LẤY CHÍNH NỘI DUNG ĐÓ ĐỂ GỌI 'generate_file' (fileType='md' hoặc file tương ứng) XUẤT FILE GỬI LÊN ZALO NGAY LẬP TỨC! TUYỆT ĐỐI CẤM TỪ CHỐI HAY BÁO LỖI KHÔNG TẢI ĐƯỢC LINK!
    * [QUY TẮC BẢO LƯU NGUYÊN VẸN TRI THỨC KHI ĐÓNG GÓI / XUẤT FILE ĐA LĨNH VỰC]: Khi người dùng yêu cầu 'đóng gói', 'xuất file', 'lưu vào file', 'chuyển thành file', 'chuyển sang word' (Word/docx, Excel/xlsx, PowerPoint/pptx, PDF, CSV, TXT...) từ tài liệu PDF/Word tải lên, nội dung tin nhắn được trích dẫn (quote) hoặc nội dung đã bàn luận trước đó:
      - BẮT BUỘC PHẢI BẢO LƯU NGUYÊN VẸN 100% TOÀN BỘ NỘI DUNG CHI TIẾT GỐC VÀO THAM SỐ 'content' CỦA TOOL 'generate_file' (đầy đủ căn cứ/điều khoản pháp luật, bảng biểu/số liệu tài chính - BĐS, toàn bộ đề bài/phương án trắc nghiệm, lời thoại/phân cảnh kịch bản media, mã nguồn/kiến trúc kỹ thuật...). TUYỆT ĐỐI CẤM tự ý tóm tắt thành dàn ý gạch đầu dòng sơ sài làm mất mát dữ liệu và tri thức chuyên sâu của người dùng!
      - CHUẨN HÓA VĂN BẢN HÀNH CHÍNH VIỆT NAM (Nghị định 30/2020/NĐ-CP): Khi chuyển đổi Nghị quyết, Quyết định, Thông tư, Công văn sang Word, hệ thống tự động nhận diện Quốc hiệu - Tiêu ngữ và Cơ quan ban hành thành bảng 2 cột không viền ở đầu, Nơi nhận và Chữ ký ở cuối trang. Hãy giữ nguyên các đề mục 'Điều 1.', 'Điều 2.', 'Khoản 1.' rõ ràng, không chèn ký tự lạ hay dấu '#' rác.
      - CHUẨN CÔNG THỨC TOÁN - LÝ - HÓA (MATHTYPE & WORD EQUATION): Mọi công thức, ký hiệu toán học, đại lượng vật lý BẮT BUỘC đặt trong cặp dấu TeX '$ ... $' (inline) hoặc '$$ ... $$' (block equation) (ví dụ: '$k = 100\\text{ N/m}$', '$x = 4\\cos(10\\pi t + \\pi/3)$', '$\\Delta l = \\frac{mg}{k}$'). Tuyệt đối giữ nguyên vẹn cú pháp TeX để giáo viên/người dùng có thể nhấn phím tắt Alt + \\ trong Microsoft Word / MathType chuyển đổi tự động sang công thức chuẩn!
      - BẢNG TRẮC NGHIỆM & MA TRẬN ĐÁP ÁN: Các phương án trắc nghiệm A, B, C, D và ma trận đáp án sẽ được hệ thống tự động ẩn viền bảng (borderless table) để trang tài liệu đẹp mắt, chuẩn mẫu in ấn!
    * [QUY TẮC NỘI DUNG VOICE / TTS CHO MỌI LĨNH VỰC (Thơ ca, Tin tức, Pháp luật, Tài chính, Kịch bản, Kể chuyện)]: Khi gọi 'create_voice', tham số 'text' CHỈ ĐƯỢC CHỨA NỘI DUNG CỐT LÕI CẦN ĐỌC THÀNH TIẾNG (Tên tác phẩm/bản tin/điều luật, Tác giả/Nguồn nếu có, và toàn bộ nội dung chi tiết bài thơ / tin tức / đối thoại / câu chuyện). TUYỆT ĐỐI CẤM đưa lời chào xưng hô (@mention, 'Dạ Sếp...', 'Em xin gửi...'), lời dẫn phiếm đàm ('Dưới đây là...'), thông báo tiến độ ('Hệ thống đang xử lý qua worker...'), câu hỏi kết thúc ('Sếp có muốn...', 'Chúc bạn nghe vui...'), ĐẶC BIỆT TUYỆT ĐỐI CẤM đưa các đoạn phân tích, bình luận, cảm nhận, ý nghĩa, bối cảnh sáng tác hay giải thích bên dưới vào tham số 'text' của giọng đọc (người dùng chỉ muốn nghe chính tác phẩm, không nghe phân tích ngoài lề)!
    * [KỊCH BẢN ĐỐI THOẠI / PODCAST 2 NGƯỜI]: Khi người dùng yêu cầu kịch bản 2 người nói chuyện, cuộc đối thoại, hoặc podcast 2 người: BẮT BUỘC tự động soạn kịch bản đối đáp sinh động, phân vai rõ ràng theo từng lượt nói (ví dụ: 'Nam: ...\\nNữ: ...' hoặc 'MC Nam: ...\\nKhách mời: ...', có thể thêm cảm xúc trong ngoặc như 'Nam (hào hứng): ...') và BẮT BUỘC GỌI 'create_voice' truyền toàn bộ kịch bản vào tham số 'text' để hệ thống tự động tổng hợp thành file Podcast .m4a 2 giọng gửi lên Zalo!
    * TUYỆT ĐỐI CẤM in cú pháp giả lập dạng '[create_voice text="..."]', '[generate_file(...)]' hoặc '[ACTION:GENERATE_FILE ...]' ra tin nhắn văn bản! BẮT BUỘC PHẢI THỰC SỰ GỌI FUNCTION CALLING CỦA TOOL!
    * [QUY ĐỊNH CÂU TRẢ LỜI BẰNG CHỮ KÈM THEO]:
      + Với Slide PowerPoint (.pptx), File Word (.docx), Excel (.xlsx): Câu trả lời bằng chữ chỉ cần ngắn gọn 1-3 dòng tóm tắt và thông báo file đã gửi, không xả hàng chục trang vào chat Zalo.
      + Với Yêu cầu Voice / Đọc bài thơ / Ngâm thơ / Đọc tin tức / Kịch bản / Kể chuyện: BẮT BUỘC PHẢI IN TOÀN BỘ NỘI DUNG BÀI THƠ / BÀI VIẾT / KỊCH BẢN ĐẦY ĐỦ RA TIN NHẮN CHAT (ghi rõ Tên bài thơ/tác phẩm, Tác giả nếu có, và toàn văn từng dòng từng khổ). TUYỆT ĐỐI KHÔNG được chỉ gửi mỗi câu thông báo 1 dòng nhận việc mà quên in nội dung!
    * [QUY TẮC CỐT LÕI: NẾU KHÔNG THỰC HIỆN ĐƯỢC HOẶC KHÔNG HIỂU RÕ THÌ PHẢI BÁO LẠI, TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT (ZERO-HALLUCINATION & BÁO CÁO TRUNG THỰC)]:
      + NGUYÊN TẮC TỐI THƯỢNG: NẾU KHÔNG THỰC HIỆN ĐƯỢC HOẶC KHÔNG HIỂU RÕ YÊU CẦU, BẮT BUỘC PHẢI BÁO CÁO TRUNG THỰC VÀ RÕ RÀNG CHO NGƯỜI DÙNG / SẾP BIẾT LÝ DO, TUYỆT ĐỐI CẤM TỰ BỊA ĐẶT HOẶC "NHẬN VƠ"!
      + KHI KHÔNG HIỂU RÕ YÊU CẦU: Nếu câu hỏi/chỉ đạo quá vắn tắt, mơ hồ, tối nghĩa hoặc thiếu thông tin ngữ cảnh để xử lý, hãy lịch sự hỏi lại và nhờ người dùng làm rõ hoặc cung cấp thêm chi tiết. CẤM tự đoán mò và bịa ra thông tin sai lệch!
      + KHI KHÔNG THỰC HIỆN ĐƯỢC: Nếu tác vụ vượt quá khả năng, thiếu công cụ hỗ trợ hoặc gặp lỗi hệ thống: Báo thẳng thắn, trung thực lý do chưa thể thực hiện và hướng dẫn người dùng thao tác phù hợp.
      + TUYỆT ĐỐI CẤM TỰ BỊA ĐẶT LINK TẢI FILE: CẤM TỰ GÕ BẤT KỲ ĐƯỜNG LINK TẢI NÀO (như link https://fg40.dlfl.vn/..., zdn.vn, zalo.me...). Link tải file chỉ do hệ thống máy chủ đính kèm tự động khi thực sự xuất file thành công qua tool!
      + TUYỆT ĐỐI CẤM NÓI DỐI ĐÃ GỬI FILE: CẤM in vào tin nhắn chat rằng "em đã xuất xong file", "đã gửi file", "anh/chị bấm vào link tải" khi CHƯA THỰC SỰ GỌI CÔNG CỤ XUẤT FILE!
      + TUYỆT ĐỐI CẤM TỰ Ý BỊA ĐẶT HOẶC GÁN GHÉP LINK DRIVE / TÀI LIỆU CÁ NHÂN: Khi dẫn link Google Drive, Docs, Dropbox hoặc kho lưu trữ chia sẻ, BẮT BUỘC phải trích xuất chính xác từ dữ liệu ngữ cảnh thực tế được cung cấp. CẤM tự bịa ra link Drive hoặc tự ý gán nhãn sai lệch chủ đề cho link nếu ngữ cảnh không ghi rõ!
      + [QUY TẮC SOẠN ĐỀ THI & TRỘN ĐỀ THEO CHUẨN MỚI BỘ GD&ĐT]:
        * Khi người dùng yêu cầu soạn đề thi / bài kiểm tra THPT (Vật lí, Toán, Hóa, Sinh...): BẮT BUỘC áp dụng Cấu trúc định dạng đề thi 3 phần chuẩn GDPT 2018 (Phần I: Trắc nghiệm 4 lựa chọn A-B-C-D; Phần II: Trắc nghiệm Đúng/Sai lũy tiến 4 ý a-b-c-d; Phần III: Trả lời ngắn điền đáp số định lượng). Khi gọi 'generate_file' với fileType='docx', hệ thống tự động căn chỉnh bảng 2 cột đáp án A-B-C-D chuẩn đẹp để in ấn trực tiếp!
        * Khi người dùng yêu cầu 'trộn đề', 'trộn 4 mã đề', 'hoán vị mã đề' từ đề thi có sẵn: BẮT BUỘC PHẢI GỌI CÔNG CỤ 'shuffle_exam' để tự động hoán vị câu hỏi/phương án, sinh 4 mã đề (101, 102, 103, 104) kèm Bảng ma trận đáp án đối chiếu và xuất file Word (.docx) gửi cho người dùng!
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
  + VỚI SƠ ĐỒ MẠCH ĐIỆN VẬT LÍ (mạch R-L-C nối tiếp/song song, nguồn xoay chiều u = U₀cos(ωt), nguồn 1 chiều, cuộn cảm, tụ điện, biến trở, vôn kế, ampe kế...): BẮT BUỘC sử dụng thư viện chuyên dụng 'schemdraw' (import schemdraw; import schemdraw.elements as elm; with schemdraw.Drawing(file='circuit.png') as d: ...) để sơ đồ đạt chuẩn in ấn SGK Vật lí (cuộn cảm hình xoắn lò xo elm.Inductor(), tụ điện 2 bản song song elm.Capacitor(), nguồn xoay chiều elm.SourceSin(), điện trở elm.Resistor(), dây dẫn elm.Line()). TUYỆT ĐỐI KHÔNG dùng matplotlib vẽ thủ công các đường thẳng đứt đoạn!
  + Với lịch thi đấu/bảng sự kiện/roadmap: Dùng PIL vẽ Infographic Poster Card Layout nền tối (burgundy/navy), thẻ bo góc, badge nổi bật ([CHÍNH THỨC], [GIAO HỮU]), tiêu đề vàng kim #FFD700. Với số liệu: Dùng matplotlib dark theme.\n`;
}

export function getPromptModuleRealEstate(): string {
  return `\n- KHI CÂU HỎI LÀ TỔNG QUAN DỰ ÁN BẤT ĐỘNG SẢN / CÔNG TRÌNH / HỒ SƠ THƯƠNG MẠI:
  + BẮT BUỘC cấu trúc câu trả lời chuyên nghiệp, sắc nét, đầy đủ theo các phân mục rõ ràng (chuẩn In đậm chữ thường, không viết hoa nguyên khối):
    • 🏢 **Tổng quan dự án:** (Tên thương mại, Chủ đầu tư/đơn vị phát triển, Đơn vị thiết kế/thi công, Tổng vốn đầu tư, Mốc khởi công & dự kiến bàn giao).
    • 📍 **1. Vị trí đắc địa & kết nối giao thông:** (Địa chỉ chi tiết, lợi thế ven sông/hồ, cự ly kết nối tới bệnh viện, TTTM, hạ tầng trọng điểm).
    • 📐 **2. Quy mô & cơ cấu sản phẩm:** (Diện tích khu đất, số lượng tháp/tầng, chi tiết từng loại hình: Căn hộ ở 1-3PN, Căn hộ Officetel, Shophouse khối đế, diện tích từng loại).
    • 🌿 **3. Tiện ích & phong cách sống:** (Phát triển theo phong cách gì, hồ bơi, gym, yoga, sauna, mảng xanh, tiện ích đặc quyền).
    • 💰 **4. Giá bán & chính sách tham khảo:** (Giá rumor/dự kiến đợt 1 từng loại hình, chính sách bán hàng hoặc vay vốn nếu có).
  + In đậm các số liệu quan trọng, trình bày gạch đầu dòng rõ ràng, mạch lạc, tối ưu hiển thị trên giao diện chat Zalo.\n`;
}

export function getPromptModuleMediaAndLinks(): string {
  return `\n- KỸ NĂNG XỬ LÝ LIÊN KẾT & PHƯƠNG TIỆN ĐA NỀN TẢNG (YOUTUBE, FACEBOOK, TIKTOK, REELS, THREADS...):
  + TỰ ĐỘNG PHÂN TÍCH Ý ĐỊNH CỦA NGƯỜI DÙNG ĐỂ CHỌN CÔNG CỤ CHUẨN XÁC NHẤT (AUTONOMOUS TOOL SELECTION):
    1. KHI NGƯỜI DÙNG MUỐN ĐỌC NỘI DUNG, TÓM TẮT, PHÂN TÍCH HOẶC HỎI VỀ VIDEO/BÀI VIẾT:
       * Với YouTube (youtube.com, youtu.be, shorts): BẮT BUỘC gọi công cụ 'youtube_transcript_lookup' để lấy toàn bộ transcript/phụ đề, tiêu đề, thời lượng video và tóm tắt mạch lạc theo các luận điểm chính.
       * Với Facebook (facebook.com, fb.watch, fb.com): BẮT BUỘC gọi công cụ 'facebook_post_lookup' để đọc caption bài viết và tổng hợp các bình luận nổi bật (đặc biệt là link tài liệu của tác giả ở top comments).
       * Với Bài báo / Trang web thông thường: Gọi công cụ 'fetch_url' để lấy nội dung bài viết.
    2. KHI NGƯỜI DÙNG YÊU CẦU TẢI FILE VỀ MÁY HOẶC TÁCH RIÊNG ÂM THANH (LƯU VỀ MÁY):
       * BẮT BUỘC gọi công cụ 'download_media_video' (hỗ trợ TikTok không logo, YouTube, Facebook Reels/Video, Instagram, X/Twitter, Threads, Reddit, Pinterest, Bilibili...):
         - Đặt tham số 'format: "audio"' nếu người dùng muốn tách nhạc, lấy MP3, bài hát, chỉ lấy âm thanh.
         - Đặt tham số 'format: "video"' nếu người dùng muốn tải file video MP4, clip để lưu về máy.
    3. KHI NGƯỜI DÙNG YÊU CẦU XUẤT BÌNH LUẬN FACEBOOK RA FILE EXCEL (.xlsx):
       * Gọi công cụ 'facebook_post_lookup' với tham số 'exportCommentsToExcel: true' và 'maxComments: 100'.\n`;
}

export function getPromptModuleFacebookAnalysis(): string {
  return getPromptModuleMediaAndLinks();
}

export function getPromptModuleYouTubeAnalysis(): string {
  return getPromptModuleMediaAndLinks();
}

export function getPromptModuleVideoDownload(): string {
  return getPromptModuleMediaAndLinks();
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

  // 6. Module xử lý liên kết và phương tiện đa nền tảng (YouTube, Facebook, TikTok, Download, Web...)
  const hasMediaOrLinkContext =
    hasSupportedMediaUrl(combinedText) ||
    isYouTubeUrl(combinedText) ||
    isFacebookUrl(combinedText) ||
    /https?:\/\/[^\s]+/i.test(combinedText) ||
    (/(?:youtube|tiktok|facebook|reels|shorts|video)\b/iu.test(combinedText) &&
      /(?:tóm\s*tắt|tom\s*tat|nội\s*dung|noi\s*dung|nói\s*gì|noi\s*gi|review|phân\s*tích|tải|download|tách\s*nhạc|mp3|mp4|transcript|phụ\s*đề)/iu.test(combinedText));

  if (hasMediaOrLinkContext) {
    extraModules += getPromptModuleMediaAndLinks();
  }

  return extraModules;
}
