import { parseMarkdownToWordBlocks, generateWordDoc, GeneratedFileResult } from "./file-generator.js";

export interface ExamOption {
  text: string;
  isCorrect?: boolean;
}

export interface QuestionPartI {
  number: number;
  question: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
  };
  correctKey?: "A" | "B" | "C" | "D";
}

export interface StatementPartII {
  key: "a" | "b" | "c" | "d";
  text: string;
  isTrue?: boolean; // true = Đúng, false = Sai
}

export interface QuestionPartII {
  number: number;
  context: string;
  statements: StatementPartII[];
}

export interface QuestionPartIII {
  number: number;
  question: string;
  answer?: string;
}

export interface ParsedExam {
  title: string;
  subject: string;
  partI: QuestionPartI[];
  partII: QuestionPartII[];
  partIII: QuestionPartIII[];
}

export interface ShuffledVariant {
  code: string;
  partI: QuestionPartI[];
  partII: QuestionPartII[];
  partIII: QuestionPartIII[];
}

export interface AnswerKeyMatrix {
  partIKeys: Record<string, Record<number, string>>; // code -> questionNum -> 'A'|'B'|'C'|'D'
  partIIKeys: Record<string, Record<number, Record<string, string>>>; // code -> questionNum -> 'a'|'b'|'c'|'d' -> 'Đ'|'S'
  partIIIKeys: Record<string, Record<number, string>>; // code -> questionNum -> answer
}

// Hàm PRNG để xáo trộn có thể tái lập (hoặc random theo seed)
function pseudoRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function shuffleArray<T>(array: T[], rand: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i]!, [result[j]!]] = [result[j]!, [result[i]!]];
  }
  return result;
}

/**
 * Phân tích toàn văn đề thi thành các cấu trúc câu hỏi 3 phần
 */
export function parseExamText(rawText: string, defaultTitle = "ĐỀ KIỂM TRA ĐỊNH KỲ"): ParsedExam {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");

  const partI: QuestionPartI[] = [];
  const partII: QuestionPartII[] = [];
  const partIII: QuestionPartIII[] = [];

  let currentPart: 1 | 2 | 3 = 1;
  let title = defaultTitle;

  // Thu thập các câu hỏi
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line) {
      i++;
      continue;
    }

    // Nhận diện chuyển phần
    if (/phần\s+i\b|phần\s+1\b|trắc\s*nghiệm\s*nhiều\s*phương\s*án/i.test(line)) {
      currentPart = 1;
      i++;
      continue;
    }
    if (/phần\s+ii\b|phần\s+2\b|đúng\s*[\/\-]?\s*sai/i.test(line)) {
      currentPart = 2;
      i++;
      continue;
    }
    if (/phần\s+iii\b|phần\s+3\b|trả\s*lời\s*ngắn/i.test(line)) {
      currentPart = 3;
      i++;
      continue;
    }

    // Tiêu đề đề thi
    if (/^(?:đề\s+(?:kiểm\s+tra|thi|ôn\s+tập)|bài\s+kiểm\s+tra)/i.test(line) && title === defaultTitle) {
      title = line.replace(/[*#]/g, "").trim();
      i++;
      continue;
    }

    // Nhận diện câu hỏi
    const qMatch = line.match(/^(?:#{1,3}\s*)?(?:\*\*)?(?:Câu|Bài)\s+(\d+)[\.:]([\s\S]*)$/i);
    if (qMatch) {
      const qNum = parseInt(qMatch[1]!, 10);
      const initialText = qMatch[2]!.trim();

      if (currentPart === 1) {
        // PHẦN I: Trắc nghiệm 4 lựa chọn
        let qBody = initialText;
        let optA = "";
        let optB = "";
        let optC = "";
        let optD = "";
        let correctKey: "A" | "B" | "C" | "D" | undefined;

        // Kiểm tra xem phương án có dính cùng dòng không
        // Kiểm tra xem phương án có dính cùng dòng không
        const inlineOpts = line.match(
          /(?:[\s,;]+|^)(?:\*\*)?(A[\.:]\s*[\s\S]+?)(?:[\s,;]+)(?:\*\*)?(B[\.:]\s*[\s\S]+?)(?:[\s,;]+)(?:\*\*)?(C[\.:]\s*[\s\S]+?)(?:[\s,;]+)(?:\*\*)?(D[\.:]\s*[\s\S]+)$/i,
        );
        if (inlineOpts) {
          qBody = line.substring(0, inlineOpts.index).replace(/^(?:#{1,3}\s*)?(?:\*\*)?(?:Câu|Bài)\s+\d+[\.:]/i, "").trim();
          optA = inlineOpts[1]!.replace(/^A[\.:]\s*/i, "").trim();
          optB = inlineOpts[2]!.replace(/^B[\.:]\s*/i, "").trim();
          optC = inlineOpts[3]!.replace(/^C[\.:]\s*/i, "").trim();
          optD = inlineOpts[4]!.replace(/^D[\.:]\s*/i, "").trim();

          if (inlineOpts[1]!.includes("**") || inlineOpts[1]!.startsWith("*")) correctKey = "A";
          else if (inlineOpts[2]!.includes("**") || inlineOpts[2]!.startsWith("*")) correctKey = "B";
          else if (inlineOpts[3]!.includes("**") || inlineOpts[3]!.startsWith("*")) correctKey = "C";
          else if (inlineOpts[4]!.includes("**") || inlineOpts[4]!.startsWith("*")) correctKey = "D";

          i++;
        } else {
          // Phương án nằm ở các dòng tiếp theo
          i++;
          while (i < lines.length) {
            const nextL = lines[i]!.trim();
            if (!nextL) {
              i++;
              continue;
            }
            if (/^(?:#{1,3}\s*)?(?:\*\*)?(?:Câu|Bài)\s+\d+[\.:]/i.test(nextL) || /phần\s+(?:i|ii|iii)\b/i.test(nextL)) {
              break;
            }
            const optMatch = nextL.match(/^(?:#{1,3}\s*)?(?:\*\*)?([A-D])[\.:]\s*([\s\S]*)$/i);
            if (optMatch) {
              const k = optMatch[1]!.toUpperCase() as "A" | "B" | "C" | "D";
              const rawVal = optMatch[2]!.trim();
              if (k === "A") optA = rawVal;
              else if (k === "B") optB = rawVal;
              else if (k === "C") optC = rawVal;
              else if (k === "D") optD = rawVal;

              if (nextL.includes("**") || nextL.startsWith("*")) {
                correctKey = k;
              }
            } else if (!optA) {
              qBody += (qBody ? " " : "") + nextL;
            }
            i++;
          }
        }

        partI.push({
          number: qNum || partI.length + 1,
          question: qBody.replace(/\*\*/g, "").trim(),
          options: {
            A: optA.replace(/\*\*/g, "").trim(),
            B: optB.replace(/\*\*/g, "").trim(),
            C: optC.replace(/\*\*/g, "").trim(),
            D: optD.replace(/\*\*/g, "").trim(),
          },
          correctKey,
        });
        continue;
      } else if (currentPart === 2) {
        // PHẦN II: Đúng / Sai
        let contextText = initialText;
        const statements: StatementPartII[] = [];

        i++;
        while (i < lines.length) {
          const nextL = lines[i]!.trim();
          if (!nextL) {
            i++;
            continue;
          }
          if (/^(?:#{1,3}\s*)?(?:\*\*)?(?:Câu|Bài)\s+\d+[\.:]/i.test(nextL) || /phần\s+(?:i|ii|iii)\b/i.test(nextL)) {
            break;
          }

          const stMatch = nextL.match(/^([a-d])\)\s*([\s\S]+)$/i);
          if (stMatch) {
            const stKey = stMatch[1]!.toLowerCase() as "a" | "b" | "c" | "d";
            const stText = stMatch[2]!.trim();
            const isTrue = /[\(\[]?(?:đúng|đ)[\)\]]?$/i.test(stText)
              ? true
              : /[\(\[]?(?:sai|s)[\)\]]?$/i.test(stText)
                ? false
                : undefined;
            statements.push({
              key: stKey,
              text: stText.replace(/\s*[\(\[]?(?:đúng|sai|đ|s)[\)\]]?$/i, "").trim(),
              isTrue,
            });
          } else {
            if (statements.length === 0) {
              contextText += (contextText ? " " : "") + nextL;
            }
          }
          i++;
        }

        partII.push({
          number: qNum || partII.length + 1,
          context: contextText.replace(/\*\*/g, "").trim(),
          statements,
        });
        continue;
      } else {
        // PHẦN III: Trả lời ngắn
        let qBody = initialText;
        let ans: string | undefined;

        i++;
        while (i < lines.length) {
          const nextL = lines[i]!.trim();
          if (!nextL) {
            i++;
            continue;
          }
          if (/^(?:#{1,3}\s*)?(?:\*\*)?(?:Câu|Bài)\s+\d+[\.:]/i.test(nextL) || /phần\s+(?:i|ii|iii)\b/i.test(nextL)) {
            break;
          }
          if (/^(?:đáp\s*án|đáp\s*số|kết\s*quả)[\.:]\s*(.+)$/i.test(nextL)) {
            ans = nextL.replace(/^(?:đáp\s*án|đáp\s*số|kết\s*quả)[\.:]\s*/i, "").trim();
          } else {
            qBody += (qBody ? " " : "") + nextL;
          }
          i++;
        }

        partIII.push({
          number: qNum || partIII.length + 1,
          question: qBody.replace(/\*\*/g, "").trim(),
          answer: ans,
        });
        continue;
      }
    }

    i++;
  }

  return {
    title,
    subject: "Vật lí",
    partI,
    partII,
    partIII,
  };
}

/**
 * Trộn đề gốc thành danh sách các mã đề kèm ma trận đáp án
 */
export function shuffleExam(
  exam: ParsedExam,
  codes = ["101", "102", "103", "104"],
  baseSeed = 2026,
): { variants: ShuffledVariant[]; matrix: AnswerKeyMatrix } {
  const variants: ShuffledVariant[] = [];
  const matrix: AnswerKeyMatrix = {
    partIKeys: {},
    partIIKeys: {},
    partIIIKeys: {},
  };

  codes.forEach((code, index) => {
    const rand = pseudoRandom(baseSeed + index * 997);

    // 1. Phần I: Hoán vị thứ tự câu hỏi & Hoán vị 4 phương án
    const shuffledPartIQuestions = shuffleArray(exam.partI, rand);
    const newPartI: QuestionPartI[] = [];
    matrix.partIKeys[code] = {};

    shuffledPartIQuestions.forEach((q, qIdx) => {
      const newQNum = qIdx + 1;
      const originalOptions: Array<{ key: "A" | "B" | "C" | "D"; text: string; isCorrect: boolean }> = [
        { key: "A", text: q.options.A, isCorrect: q.correctKey === "A" },
        { key: "B", text: q.options.B, isCorrect: q.correctKey === "B" },
        { key: "C", text: q.options.C, isCorrect: q.correctKey === "C" },
        { key: "D", text: q.options.D, isCorrect: q.correctKey === "D" },
      ];

      // Hoán vị 4 phương án
      const shuffledOpts = shuffleArray(originalOptions, rand);
      const newKeys: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
      let newCorrectKey: "A" | "B" | "C" | "D" | undefined;

      const newOptionsMap: any = {};
      shuffledOpts.forEach((opt, optIdx) => {
        const assignedKey = newKeys[optIdx]!;
        newOptionsMap[assignedKey] = opt.text;
        if (opt.isCorrect) {
          newCorrectKey = assignedKey;
        }
      });

      if (newCorrectKey) {
        matrix.partIKeys[code]![newQNum] = newCorrectKey;
      }

      newPartI.push({
        number: newQNum,
        question: q.question,
        options: newOptionsMap,
        correctKey: newCorrectKey,
      });
    });

    // 2. Phần II: Hoán vị thứ tự câu hỏi
    const shuffledPartII = shuffleArray(exam.partII, rand).map((q, qIdx) => {
      const newQNum = qIdx + 1;
      matrix.partIIKeys[code] = matrix.partIIKeys[code] || {};
      matrix.partIIKeys[code]![newQNum] = {};

      q.statements.forEach((st) => {
        if (st.isTrue !== undefined) {
          matrix.partIIKeys[code]![newQNum]![st.key] = st.isTrue ? "Đ" : "S";
        }
      });

      return {
        number: newQNum,
        context: q.context,
        statements: q.statements,
      };
    });

    // 3. Phần III: Hoán vị thứ tự câu hỏi
    const shuffledPartIII = shuffleArray(exam.partIII, rand).map((q, qIdx) => {
      const newQNum = qIdx + 1;
      matrix.partIIIKeys[code] = matrix.partIIIKeys[code] || {};
      if (q.answer) {
        matrix.partIIIKeys[code]![newQNum] = q.answer;
      }

      return {
        number: newQNum,
        question: q.question,
        answer: q.answer,
      };
    });

    variants.push({
      code,
      partI: newPartI,
      partII: shuffledPartII,
      partIII: shuffledPartIII,
    });
  });

  return { variants, matrix };
}

/**
 * Xuất bản toàn bộ các mã đề và bảng ma trận đáp án thành file Word .docx
 */
export async function exportShuffledExamToDocx(
  exam: ParsedExam,
  codes = ["101", "102", "103", "104"],
  fileName = "de_thi_tron_4_ma",
): Promise<GeneratedFileResult> {
  const { variants, matrix } = shuffleExam(exam, codes);

  let mdContent = "";

  // Tạo nội dung từng mã đề
  variants.forEach((v, vIdx) => {
    mdContent += `\n# SỞ GD&ĐT .................... - TRƯỜNG THPT ....................\n`;
    mdContent += `## ${exam.title.toUpperCase()}\n`;
    mdContent += `### **MÃ ĐỀ THI: ${v.code}** (Thời gian làm bài: 50 phút)\n\n`;

    // Phần I
    if (v.partI.length > 0) {
      mdContent += `**PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn** *(Thí sinh trả lời từ câu 1 đến câu ${v.partI.length}. Mỗi câu chọn một đáp án đúng)*.\n\n`;
      v.partI.forEach((q) => {
        mdContent += `**Câu ${q.number}.** ${q.question}\n`;
        mdContent += `A. ${q.options.A}\n`;
        mdContent += `B. ${q.options.B}\n`;
        mdContent += `C. ${q.options.C}\n`;
        mdContent += `D. ${q.options.D}\n\n`;
      });
    }

    // Phần II
    if (v.partII.length > 0) {
      mdContent += `**PHẦN II. Câu trắc nghiệm đúng sai** *(Thí sinh trả lời từ câu 1 đến câu ${v.partII.length}. Trong mỗi ý a), b), c), d) chọn Đúng hoặc Sai)*.\n\n`;
      v.partII.forEach((q) => {
        mdContent += `**Câu ${q.number}.** ${q.context}\n`;
        q.statements.forEach((st) => {
          mdContent += `${st.key}) ${st.text}\n`;
        });
        mdContent += `\n`;
      });
    }

    // Phần III
    if (v.partIII.length > 0) {
      mdContent += `**PHẦN III. Câu trắc nghiệm trả lời ngắn** *(Thí sinh trả lời từ câu 1 đến câu ${v.partIII.length})*.\n\n`;
      v.partIII.forEach((q) => {
        mdContent += `**Câu ${q.number}.** ${q.question}\n\n`;
      });
    }

    if (vIdx < variants.length - 1) {
      mdContent += `\n---\n\n`;
    }
  });

  // Tạo Bảng Đáp Án Đối Chiếu ở cuối tài liệu
  mdContent += `\n---\n\n# BẢNG ĐÁP ÁN ĐỐI CHIẾU CÁC MÃ ĐỀ\n\n`;

  // Bảng Phần I
  mdContent += `### Bảng Đáp Án Phần I (Trắc nghiệm nhiều lựa chọn)\n\n`;
  mdContent += `| Câu | ${codes.map((c) => `Mã ${c}`).join(" | ")} |\n`;
  mdContent += `| :---: | ${codes.map(() => ":---:").join(" | ")} |\n`;

  const totalPartIQ = variants[0]?.partI.length || 0;
  for (let q = 1; q <= totalPartIQ; q++) {
    const rowKeys = codes.map((c) => matrix.partIKeys[c]?.[q] || "-").join(" | ");
    mdContent += `| **${q}** | ${rowKeys} |\n`;
  }
  mdContent += `\n`;

  // Bảng Phần II
  const totalPartIIQ = variants[0]?.partII.length || 0;
  if (totalPartIIQ > 0) {
    mdContent += `### Bảng Đáp Án Phần II (Đúng / Sai)\n\n`;
    mdContent += `| Câu | Ý | ${codes.map((c) => `Mã ${c}`).join(" | ")} |\n`;
    mdContent += `| :---: | :---: | ${codes.map(() => ":---:").join(" | ")} |\n`;
    for (let q = 1; q <= totalPartIIQ; q++) {
      ["a", "b", "c", "d"].forEach((st) => {
        const rowKeys = codes.map((c) => matrix.partIIKeys[c]?.[q]?.[st] || "-").join(" | ");
        mdContent += `| **${q}** | ${st} | ${rowKeys} |\n`;
      });
    }
    mdContent += `\n`;
  }

  const blocks = parseMarkdownToWordBlocks(mdContent, exam.title);
  return await generateWordDoc(fileName, exam.title, blocks);
}
