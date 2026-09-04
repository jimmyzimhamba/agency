"""voice.py — ElevenLabs speech in and out. Server-side only.

The API key lives here and never reaches the browser. The page posts text to
/api/speak (we return mp3 bytes) and audio to /api/listen (we return a
transcript). Speech-in uses ElevenLabs Scribe, not the browser Web Speech API
(which only works in Chrome, ships audio to Google, and fails silently in Brave).

Degrade loudly: if the key is missing or the API errors, raise with a clear
message so the UI can show it on screen — never fail silently.
"""
import json
import os
import ssl
import urllib.request
import urllib.error

TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}"
STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"

# Use certifi's CA bundle if present — avoids macOS "certificate verify failed".
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    SSL_CTX = ssl.create_default_context()


def _key():
    k = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not k:
        raise RuntimeError("ELEVENLABS_API_KEY is not set — voice is off")
    return k


def speak(text: str) -> bytes:
    """Text -> mp3 bytes via ElevenLabs TTS."""
    key = _key()
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    model = os.environ.get("ELEVENLABS_TTS_MODEL", "eleven_turbo_v2_5")
    body = json.dumps({
        "text": text,
        "model_id": model,
        "voice_settings": {"stability": 0.4, "similarity_boost": 0.75, "style": 0.15},
    }).encode()
    req = urllib.request.Request(
        TTS_URL.format(voice=voice), data=body,
        headers={"xi-api-key": key, "content-type": "application/json",
                 "accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:200]
        raise RuntimeError(f"ElevenLabs TTS {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"ElevenLabs TTS unreachable: {e.reason}")


def listen(audio: bytes, content_type: str) -> str:
    """Audio bytes -> transcript via ElevenLabs Scribe (scribe_v1)."""
    key = _key()
    model = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v1")
    if not audio:
        raise RuntimeError("empty audio")
    # multipart/form-data by hand (stdlib only)
    boundary = "----phoenix" + os.urandom(8).hex()
    ext = "webm"
    if "ogg" in content_type: ext = "ogg"
    elif "mp4" in content_type or "m4a" in content_type: ext = "mp4"
    elif "wav" in content_type: ext = "wav"

    def field(name, value):
        return (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'
                f'{value}\r\n').encode()

    parts = bytearray()
    parts += field("model_id", model)
    parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
              f'filename="audio.{ext}"\r\nContent-Type: {content_type}\r\n\r\n').encode()
    parts += audio
    parts += f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        STT_URL, data=bytes(parts),
        headers={"xi-api-key": key,
                 "content-type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=45, context=SSL_CTX) as r:
            data = json.loads(r.read())
        return data.get("text", "").strip()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:200]
        raise RuntimeError(f"ElevenLabs STT {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"ElevenLabs STT unreachable: {e.reason}")
