"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock, KeyRound, Eye, EyeOff, ShieldCheck, ArrowRight } from "lucide-react";
import Link from "next/link";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isAlreadyAuth, setIsAlreadyAuth] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth");
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated === true || localStorage.getItem("admin_auth") === "true") {
            setIsAlreadyAuth(true);
          }
        }
      } catch {}
    }
    checkAuth();
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError("Vui lòng nhập mật khẩu quản trị");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });

      const data = await res.json();
      if (data.ok) {
        localStorage.setItem("admin_auth", "true");
        router.push("/");
      } else {
        setError(data.error || "Mật khẩu Admin không chính xác");
      }
    } catch {
      setError("Lỗi kết nối máy chủ");
    } finally {
      setLoading(false);
    }
  }

  if (isAlreadyAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-cyan-500/30 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-xl text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-white">Bạn đã đăng nhập Admin</h2>
          <p className="text-xs text-slate-400">
            Phiên làm việc quản trị của bạn đang hoạt động.
          </p>
          <Link
            href="/"
            className="flex items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-400 transition-colors"
          >
            <span>Vào Bảng Điều Khiển Quản Trị</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-cyan-500/20 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-xl">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Lock className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Cổng Quản Trị Hệ Thống</h2>
          <p className="text-xs text-slate-400">
            Nhập mật khẩu quản trị viên để mở khóa toàn quyền hệ thống.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Mật khẩu Admin</label>
            <div className="relative flex items-center">
              <KeyRound className="absolute left-3.5 h-4 w-4 text-slate-500" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu..."
                autoFocus
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-10 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 text-slate-400 hover:text-white"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-2.5 text-xs text-rose-400 text-center font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-cyan-500 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:opacity-50"
          >
            {loading ? "Đang xác thực..." : "Mở Khóa Quản Trị"}
          </button>
        </form>

        <div className="border-t border-slate-800 pt-4 text-center">
          <Link href="/hub" className="text-xs text-slate-400 hover:text-cyan-400 transition-colors">
            ← Quay về Kho Kiến Thức
          </Link>
        </div>
      </div>
    </div>
  );
}
