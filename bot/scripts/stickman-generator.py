#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stickman Video Animation Generator
Tự động sinh video người que hoạt hình độ phân giải cao 1280x720,
đồng bộ chuẩn xác với file audio thuyết minh (Google AI Studio TTS).
"""

import os
import sys

# Tự động chuyển sang venv của Hermes nếu system python thiếu PIL
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    hermes_py = '/home/ubuntu/.hermes/hermes-agent/venv/bin/python'
    if os.path.exists(hermes_py) and sys.executable != hermes_py:
        os.execv(hermes_py, [hermes_py] + sys.argv)
    raise

import math
import json
import shutil
import argparse
import subprocess

W, H, FPS = 1280, 720, 30
GROUND_Y = 560

FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf'
]

def get_font(size):
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except Exception:
                pass
    return ImageFont.load_default()

def get_audio_duration(audio_path):
    if not audio_path or not os.path.exists(audio_path):
        return None
    try:
        cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audio_path]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(res.stdout.strip())
    except Exception:
        return None

def draw_stickman(d, x, y, scale=1.0, action='stand', t=0.0, color=(240, 240, 240), label=''):
    r = int(24 * scale)
    head_cx = int(x)
    head_cy = int(y - 120 * scale)
    neck_y = int(head_cy + r)
    hip_y = int(neck_y + 60 * scale)

    # Đầu
    d.ellipse([(head_cx - r, head_cy - r), (head_cx + r, head_cy + r)], outline=color, width=3)
    # Mắt miệng
    d.ellipse([(head_cx + 4, head_cy - 4), (head_cx + 8, head_cy)], fill=color)
    d.arc([(head_cx - 8, head_cy + 2), (head_cx + 8, head_cy + 12)], start=0, end=180, fill=color, width=2)

    # Thân
    d.line([(head_cx, neck_y), (head_cx, hip_y)], fill=color, width=4)

    # Chân
    leg_len = 50 * scale
    if action in ('walk', 'run'):
        speed = 8.0 if action == 'run' else 4.0
        angle = math.sin(t * speed) * (0.8 if action == 'run' else 0.5)
        lx = head_cx + math.sin(angle) * leg_len
        ly = hip_y + math.cos(angle) * leg_len
        rx = head_cx - math.sin(angle) * leg_len
        ry = hip_y + math.cos(angle) * leg_len
        d.line([(head_cx, hip_y), (lx, ly)], fill=color, width=4)
        d.line([(head_cx, hip_y), (rx, ry)], fill=color, width=4)
    elif action == 'sleep':
        # Nằm ngang
        d.line([(head_cx, hip_y), (head_cx + 30 * scale, hip_y + 10 * scale)], fill=color, width=4)
        d.line([(head_cx, hip_y), (head_cx + 40 * scale, hip_y + 20 * scale)], fill=color, width=4)
    else:
        d.line([(head_cx, hip_y), (head_cx - 16 * scale, hip_y + leg_len)], fill=color, width=4)
        d.line([(head_cx, hip_y), (head_cx + 16 * scale, hip_y + leg_len)], fill=color, width=4)

    # Tay
    shoulder_y = neck_y + int(15 * scale)
    arm_len = 45 * scale
    if action == 'celebrate':
        # Giơ tay chữ V mừng chiến thắng
        d.line([(head_cx, shoulder_y), (head_cx - 30 * scale, shoulder_y - 40 * scale)], fill=color, width=3)
        d.line([(head_cx, shoulder_y), (head_cx + 30 * scale, shoulder_y - 40 * scale)], fill=color, width=3)
    elif action in ('walk', 'run'):
        speed = 8.0 if action == 'run' else 4.0
        angle = math.sin(t * speed + math.pi) * (0.7 if action == 'run' else 0.4)
        ax = head_cx + math.sin(angle) * arm_len
        ay = shoulder_y + math.cos(angle) * arm_len
        bx = head_cx - math.sin(angle) * arm_len
        by = shoulder_y + math.cos(angle) * arm_len
        d.line([(head_cx, shoulder_y), (ax, ay)], fill=color, width=3)
        d.line([(head_cx, shoulder_y), (bx, by)], fill=color, width=3)
    elif action == 'talk':
        wave = math.sin(t * 6.0) * 10
        d.line([(head_cx, shoulder_y), (head_cx + 35 * scale, shoulder_y - 15 * scale + wave)], fill=color, width=3)
        d.line([(head_cx, shoulder_y), (head_cx - 20 * scale, shoulder_y + 35 * scale)], fill=color, width=3)
    else:
        d.line([(head_cx, shoulder_y), (head_cx - 25 * scale, shoulder_y + 35 * scale)], fill=color, width=3)
        d.line([(head_cx, shoulder_y), (head_cx + 25 * scale, shoulder_y + 35 * scale)], fill=color, width=3)

    # Nhãn tên nhân vật
    if label:
        font_lbl = get_font(18)
        d.text((head_cx, head_cy - r - 22), label, fill=(255, 215, 0), font=font_lbl, anchor='ms')

def render_scene_frame(scene, t_rel, t_global, total_dur):
    img = Image.new('RGB', (W, H), (22, 27, 34))
    d = ImageDraw.Draw(img)

    # Nền & Mặt đất
    d.rectangle([(0, GROUND_Y), (W, H)], fill=(33, 38, 45))
    d.line([(0, GROUND_Y), (W, GROUND_Y)], fill=(88, 166, 255), width=3)

    # Cỏ & Chi tiết mặt đất
    for gx in range(0, W, 60):
        d.line([(gx, GROUND_Y), (gx - 15, GROUND_Y + 12)], fill=(48, 54, 61), width=2)

    # Thanh tiến trình trên đỉnh
    prog_w = int((t_global / total_dur) * W) if total_dur > 0 else 0
    d.rectangle([(0, 0), (W, 6)], fill=(33, 38, 45))
    d.rectangle([(0, 0), (prog_w, 6)], fill=(46, 160, 67))

    # Tiêu đề cảnh
    scene_title = scene.get('title', '')
    if scene_title:
        f_title = get_font(26)
        d.text((40, 36), scene_title, fill=(255, 215, 0), font=f_title)

    # Nhân vật 1 (Trái)
    action1 = scene.get('action', 'walk')
    c1_name = scene.get('character_left', 'Nhân vật')
    x1 = 260 + math.sin(t_rel * 1.5) * 40
    if action1 == 'run':
        x1 = 150 + ((t_rel * 120) % (W - 300))
    draw_stickman(d, x1, GROUND_Y, scale=1.1, action=action1, t=t_rel, color=(255, 255, 255), label=c1_name)

    # Nhân vật 2 (Phải - nếu có)
    c2_name = scene.get('character_right')
    if c2_name:
        action2 = scene.get('action_right', 'stand')
        x2 = 980
        draw_stickman(d, x2, GROUND_Y, scale=1.1, action=action2, t=t_rel, color=(165, 214, 255), label=c2_name)

    # Hộp phụ đề / Lời thoại bên dưới
    subtitle = scene.get('text', '')
    if subtitle:
        f_sub = get_font(24)
        box_y1 = GROUND_Y + 30
        box_y2 = H - 25
        d.rounded_rectangle([(80, box_y1), (W - 80, box_y2)], radius=12, fill=(13, 17, 23, 220), outline=(56, 139, 253), width=2)
        d.text((W // 2, (box_y1 + box_y2) // 2), subtitle, fill=(240, 246, 252), font=f_sub, anchor='mm')

    return img

def build_video(storyboard, audio_path, output_path):
    scenes = storyboard.get('scenes', [])
    if not scenes and isinstance(storyboard, list):
        scenes = storyboard
    if not scenes:
        raise ValueError("Storyboard không có scenes")

    audio_dur = get_audio_duration(audio_path)
    total_dur = audio_dur if audio_dur and audio_dur > 0 else sum(s.get('duration', 5) for s in scenes)
    num_scenes = len(scenes)
    per_scene_dur = total_dur / num_scenes

    total_frames = int(total_dur * FPS)
    print(f'[stickman] 🎬 Render video: {total_dur:.1f}s, {total_frames} frames, {num_scenes} scenes...')

    tmp_dir = f'/tmp/stickman_{os.getpid()}'
    os.makedirs(tmp_dir, exist_ok=True)

    try:
        frame_idx = 0
        for s_idx, scene in enumerate(scenes):
            s_frames = int(per_scene_dur * FPS)
            for f in range(s_frames):
                t_rel = f / FPS
                t_global = frame_idx / FPS
                frame_img = render_scene_frame(scene, t_rel, t_global, total_dur)
                frame_file = os.path.join(tmp_dir, f'f_{frame_idx:06d}.png')
                frame_img.save(frame_file)
                frame_idx += 1
                if frame_idx >= total_frames:
                    break

        raw_video = os.path.join(tmp_dir, 'raw.mp4')
        cmd_enc = [
            'ffmpeg', '-y', '-framerate', str(FPS),
            '-i', os.path.join(tmp_dir, 'f_%06d.png'),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22',
            raw_video
        ]
        subprocess.run(cmd_enc, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        if audio_path and os.path.exists(audio_path):
            cmd_mux = [
                'ffmpeg', '-y', '-i', raw_video, '-i', audio_path,
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
                '-shortest', output_path
            ]
            subprocess.run(cmd_mux, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            shutil.copyfile(raw_video, output_path)

        print(f'[stickman] ✅ Xuất video thành công: {output_path} ({os.path.getsize(output_path)} bytes)')
        print(f'[FILE: {output_path}]')
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

def main():
    parser = argparse.ArgumentParser(description='Stickman Video Animation Generator')
    parser.add_argument('--storyboard', type=str, required=True, help='File JSON chứa phân cảnh storyboard')
    parser.add_argument('--audio', type=str, help='Đường dẫn file .mp3 thuyết minh')
    parser.add_argument('--output', type=str, required=True, help='Đường dẫn file .mp4 đầu ra')
    args = parser.parse_args()

    if not os.path.exists(args.storyboard):
        print(f"Error: Không tìm thấy file storyboard {args.storyboard}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(args.storyboard, 'r', encoding='utf-8') as f:
            sb = json.load(f)
        build_video(sb, args.audio, args.output)
        sys.exit(0)
    except Exception as e:
        print(f"Error: Lỗi khi sinh video: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
