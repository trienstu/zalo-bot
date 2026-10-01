#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Google AI Studio Text-to-Speech CLI
Sinh giọng đọc tiếng Việt chất lượng cao bằng Gemini TTS (với fallback Edge-TTS)
"""

import os
import sys
import json
import base64
import argparse
import subprocess
import urllib.request
import urllib.error

ENV_PATHS = [
    '/home/ubuntu/zalo-bot-2/bot/.env',
    '/home/ubuntu/zalo-bot/bot/.env',
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'),
    os.path.expanduser('~/.env')
]

MODELS = [
    'gemini-2.5-flash-preview-tts',
    'gemini-3.8-flash-lite-tts',
    'gemini-3.1-flash-tts-preview',
    'gemini-3.8-flash-tts'
]

def load_gemini_keys():
    for p in ENV_PATHS:
        if os.path.exists(p):
            try:
                for line in open(p, 'r', encoding='utf-8'):
                    if line.strip().startswith('GEMINI_API_KEY='):
                        raw = line.strip().split('=', 1)[1].strip()
                        keys = [k.strip() for k in raw.split(',') if k.strip()]
                        if keys:
                            return keys
            except Exception:
                pass
    env_k = os.environ.get('GEMINI_API_KEY', '')
    if env_k:
        return [k.strip() for k in env_k.split(',') if k.strip()]
    return []

def synthesize_aistudio(text, voice_name, output_path, keys):
    if not keys:
        return False
    
    clean_text = text.strip()
    if not clean_text:
        return False

    payload = {
        'contents': [{'role': 'user', 'parts': [{'text': clean_text}]}],
        'generationConfig': {
            'responseModalities': ['AUDIO'],
            'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice_name}}}
        }
    }
    data_bytes = json.dumps(payload).encode('utf-8')

    for key in keys:
        for model in MODELS:
            url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
            req = urllib.request.Request(
                url, data=data_bytes,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=20) as res:
                    res_data = json.loads(res.read().decode('utf-8'))
                    part = res_data['candidates'][0]['content']['parts'][0]
                    raw_audio = base64.b64decode(part['inlineData']['data'])
                    
                    tmp_raw = f'{output_path}.raw_{os.getpid()}'
                    with open(tmp_raw, 'wb') as rf:
                        rf.write(raw_audio)
                    
                    # Convert raw PCM/WAV to clean MP3
                    cmd = ['ffmpeg', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', tmp_raw, '-c:a', 'libmp3lame', '-q:a', '2', output_path]
                    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    try:
                        os.unlink(tmp_raw)
                    except Exception:
                        pass
                    
                    if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                        print(f'[tts_aistudio] ✅ Sinh thành công qua Google AI Studio ({model}, voice={voice_name}, {os.path.getsize(output_path)} bytes)')
                        return True
            except urllib.error.HTTPError as he:
                if he.code == 429:
                    break
                continue
            except Exception:
                continue
    return False

def fallback_edge_tts(text, output_path, voice='vi-VN-HoaiMyNeural'):
    print('[tts_aistudio] ⚠️ Chuyển sang fallback Edge-TTS...')
    hermes_py = '/home/ubuntu/.hermes/hermes-agent/venv/bin/python'
    py_exec = hermes_py if os.path.exists(hermes_py) else sys.executable
    cmd = [
        py_exec, '-c',
        f'''
import asyncio, edge_tts
async def main():
    communicate = edge_tts.Communicate({json.dumps(text)}, "{voice}")
    await communicate.save("{output_path}")
asyncio.run(main())
'''
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print(f'[tts_aistudio] ✅ Sinh thành công qua Edge-TTS ({voice}, {os.path.getsize(output_path)} bytes)')
            return True
    except Exception as e:
        print(f'[tts_aistudio] Edge-TTS lỗi: {e}', file=sys.stderr)
    return False

def main():
    parser = argparse.ArgumentParser(description='Google AI Studio Text-to-Speech CLI')
    parser.add_argument('--text', type=str, help='Nội dung văn bản cần đọc')
    parser.add_argument('--file', type=str, help='Đường dẫn file văn bản cần đọc')
    parser.add_argument('--output', type=str, default='/tmp/tts_voice.mp3', help='Đường dẫn file .mp3 xuất ra')
    parser.add_argument('--voice', type=str, default='Puck', help='Tên voice AI Studio (Puck, Aoede, Kore, Fenrir, Charon)')
    args = parser.parse_args()

    content = ''
    if args.file and os.path.exists(args.file):
        content = open(args.file, 'r', encoding='utf-8').read().strip()
    elif args.text:
        content = args.text.strip()
    
    if not content:
        print('Error: Cần cung cấp --text hoặc --file nội dung', file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    keys = load_gemini_keys()

    ok = synthesize_aistudio(content, args.voice, args.output, keys)
    if not ok:
        ok = fallback_edge_tts(content, args.output)

    if ok and os.path.exists(args.output):
        print(f'[FILE: {args.output}]')
        sys.exit(0)
    else:
        print('Error: Không thể sinh audio thuyết minh', file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
