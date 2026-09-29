import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isFacebookUrl,
  cleanFacebookUrl,
  commentHasLink,
  isCommentFromAuthor,
  formatFacebookEnrichedPost,
  exportFacebookCommentsToExcel,
  type FacebookPostData,
  type FacebookCommentData,
  type FacebookEnrichedPost,
} from "./facebook-scraper.js";

test("isFacebookUrl - nhận diện chính xác các định dạng URL Facebook", () => {
  assert.equal(isFacebookUrl("https://www.facebook.com/humansofnewyork/posts/1650977309926585"), true);
  assert.equal(isFacebookUrl("https://facebook.com/reel/123456"), true);
  assert.equal(isFacebookUrl("https://m.facebook.com/story.php?story_fbid=123&id=456"), true);
  assert.equal(isFacebookUrl("https://fb.watch/xyz123/"), true);
  assert.equal(isFacebookUrl("https://fb.com/groups/bahubvn/"), true);
  assert.equal(isFacebookUrl("facebook.com/some-page"), true);

  // Không phải Facebook
  assert.equal(isFacebookUrl("https://google.com/search?q=facebook"), false);
  assert.equal(isFacebookUrl("https://twitter.com/facebook"), false);
  assert.equal(isFacebookUrl(""), false);
  assert.equal(isFacebookUrl(undefined as any), false);
});

test("cleanFacebookUrl - loại bỏ các tham số tracking rác", () => {
  const dirty = "https://www.facebook.com/humansofnewyork/posts/1650977309926585?fbclid=IwAR123&ref=share&__tn__=R";
  const cleaned = cleanFacebookUrl(dirty);
  assert.equal(cleaned.includes("fbclid"), false);
  assert.equal(cleaned.includes("ref="), false);
  assert.equal(cleaned.startsWith("https://www.facebook.com/humansofnewyork/posts/1650977309926585"), true);
});

test("commentHasLink - nhận diện chính xác liên kết trong bình luận", () => {
  assert.equal(commentHasLink("Mời các bạn xem link tài liệu: https://bit.ly/tailieu-ai"), true);
  assert.equal(commentHasLink("Tham khảo http://example.com/demo tại đây"), true);
  assert.equal(commentHasLink("Bài viết rất hay, cảm ơn tác giả nhiều!"), false);
  assert.equal(commentHasLink(""), false);
});

test("isCommentFromAuthor - xác định chính xác bình luận của chính tác giả", () => {
  const post: FacebookPostData = {
    url: "https://facebook.com/post/1",
    authorId: "user_1001",
    authorName: "Nguyễn Trung",
    text: "Nội dung bài viết",
  };

  const commentAuthorSameId: FacebookCommentData = {
    authorId: "user_1001",
    authorName: "Trung Nguyen",
    text: "Link tài liệu mình để ở đây nhé",
  };

  const commentAuthorSameName: FacebookCommentData = {
    authorId: "user_diff",
    authorName: "nguyễn trung",
    text: "Mình giải thích thêm phần 2...",
  };

  const commentOtherUser: FacebookCommentData = {
    authorId: "user_9999",
    authorName: "Khách Vãng Lai",
    text: "Cho mình xin tài liệu với ạ",
  };

  assert.equal(isCommentFromAuthor(commentAuthorSameId, post), true);
  assert.equal(isCommentFromAuthor(commentAuthorSameName, post), true);
  assert.equal(isCommentFromAuthor(commentOtherUser, post), false);
});

test("formatFacebookEnrichedPost - xuất định dạng Markdown tối ưu cho LLM", () => {
  const enriched: FacebookEnrichedPost = {
    post: {
      url: "https://facebook.com/post/1",
      authorName: "Chuyên Gia AI",
      authorId: "author_01",
      publishedAt: "2026-09-29T10:00:00Z",
      text: "Đây là bài phân tích về kiến trúc AI Agent năm 2026. Link chi tiết dưới cmt nhé.",
      likes: 1250,
      commentsCount: 88,
      shares: 45,
      mediaUrls: ["https://example.com/img1.jpg"],
    },
    authorComments: [
      {
        authorName: "Chuyên Gia AI",
        authorId: "author_01",
        text: "Link tải trọn bộ Slide và Source Code: https://github.com/ai-agents/2026",
        likesCount: 150,
        isAuthor: true,
        hasLink: true,
      },
    ],
    linkComments: [
      {
        authorName: "Thành Viên A",
        authorId: "user_a",
        text: "Mọi người có thể đọc thêm bài này rất hay: https://medium.com/agent-guide",
        likesCount: 12,
        hasLink: true,
      },
    ],
    topComments: [
      {
        authorName: "Chuyên Gia AI",
        text: "Link tải trọn bộ Slide và Source Code: https://github.com/ai-agents/2026",
        likesCount: 150,
        isAuthor: true,
      },
      {
        authorName: "Thành Viên B",
        text: "Bài viết quá chất lượng, hóng phần tiếp theo của ad!",
        likesCount: 35,
      },
    ],
    allComments: [],
  };

  const markdown = formatFacebookEnrichedPost(enriched);

  assert.equal(markdown.includes("# 📘 NỘI DUNG BÀI VIẾT FACEBOOK"), true);
  assert.equal(markdown.includes("Chuyên Gia AI"), true);
  assert.equal(markdown.includes("👍 1,250 lượt thích"), true);
  assert.equal(markdown.includes("## 📌 BÌNH LUẬN CỦA CHÍNH TÁC GIẢ"), true);
  assert.equal(markdown.includes("https://github.com/ai-agents/2026"), true);
  assert.equal(markdown.includes("## 🔗 CÁC BÌNH LUẬN CÓ CHỨA ĐƯỜNG LINK"), true);
  assert.equal(markdown.includes("## 💬 TOP BÌNH LUẬN NỔI BẬT"), true);
});

test("exportFacebookCommentsToExcel - xuất file Excel thành công", async () => {
  const sampleComments: FacebookCommentData[] = [
    {
      id: "c1",
      authorName: "Tác Giả Post",
      authorId: "author_1",
      text: "Link đăng ký workshop: https://bahub.vn/workshop",
      likesCount: 50,
      date: "2026-09-29T08:00:00Z",
      commentUrl: "https://facebook.com/post/1?comment_id=c1",
      isAuthor: true,
      hasLink: true,
    },
    {
      id: "c2",
      authorName: "Học Viên 1",
      authorId: "user_2",
      text: "Cho em hỏi workshop này có cấp chứng chỉ không ạ?",
      likesCount: 5,
      date: "2026-09-29T08:30:00Z",
      commentUrl: "https://facebook.com/post/1?comment_id=c2",
      isAuthor: false,
      hasLink: false,
    },
  ];

  const result = await exportFacebookCommentsToExcel(sampleComments, {
    postTitle: "Workshop AI Agent Thực Chiến",
    postAuthor: "Tác Giả Post",
    postUrl: "https://facebook.com/post/1",
    fileName: "test_export_fb_comments",
  });

  assert.equal(result.success, true);
  assert.equal(result.totalComments, 2);
  assert.equal(fs.existsSync(result.filePath), true);

  const stats = fs.statSync(result.filePath);
  assert.ok(stats.size > 1000, "File Excel phải có kích thước hợp lệ");

  // Dọn dẹp file test
  try {
    fs.unlinkSync(result.filePath);
  } catch {}
});
