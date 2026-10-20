"""Persistent local recognizer. Audio stays in memory and is never written to disk."""
import base64
import io
import json
import os
from pathlib import Path
import sys
from faster_whisper import WhisperModel

model = WhisperModel(str(Path(__file__).resolve().parents[1] / '.local' / 'models' / 'whisper-base'),
                     device='cpu', compute_type='int8', cpu_threads=min(4, os.cpu_count() or 2), local_files_only=True)
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        audio = base64.b64decode(request['audio'], validate=True)
        segments, _ = model.transcribe(io.BytesIO(audio), language='pt', beam_size=3,
                                      condition_on_previous_text=False, temperature=0,
                                      initial_prompt='Português do Brasil. Vocabulário: Jarvis, Usuário, briefing, briefing matinal, agenda, QuintoAndar, OpenSpeaker, e-mails, projetos.')
        text = ' '.join(s.text.strip() for s in segments if s.no_speech_prob < .75).strip()
        print(json.dumps({'id': request['id'], 'text': text}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({'id': request.get('id'), 'error': str(error)}), flush=True)
