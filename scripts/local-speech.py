"""Persistent local recognizer. Audio stays in memory and is never written to disk."""
import base64
import io
import json
import os
from pathlib import Path
import sys
import numpy as np
from faster_whisper.audio import decode_audio
from faster_whisper import WhisperModel


def recognize(model, samples):
    rms = float(np.sqrt(np.mean(samples ** 2))) if samples.size else 0.0
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0

    def transcribe(signal, threshold):
        # Start with Portuguese but detect the language from the same encoder
        # output used for decoding. language=None would encode short commands
        # twice in this version of faster-whisper.
        segments, info = model.transcribe(signal, language='pt', multilingual=True,
                                      beam_size=3, best_of=1,
                                      condition_on_previous_text=False, temperature=0,
                                      hotwords='Jarvis',
                                      vad_filter=True,
                                      vad_parameters={'threshold': threshold, 'min_speech_duration_ms': 100, 'min_silence_duration_ms': 300, 'speech_pad_ms': 200},
                                      no_speech_threshold=.6, log_prob_threshold=-1.0,
                                      compression_ratio_threshold=2.4)
        return list(segments), info

    decoded, info = transcribe(samples, .5)
    recovery = False
    gain = 1.0
    # A short webcam utterance can fail the first neural speech gate even when
    # the energy gate captured it. Retry that gate once, never decode raw noise
    # without VAD and never retry an already decoded, low-confidence sentence.
    if not info.duration_after_vad and samples.size >= 2400 and rms >= .0005 and peak >= .003:
        recovery = True
        if peak < .15:
            gain = min(8.0, .25 / peak)
        decoded, info = transcribe(samples * gain, .3)
    no_speech_limit = .45 if recovery else .6
    logprob_limit = -.8 if recovery else -1.0
    accepted = [s for s in decoded if s.no_speech_prob < no_speech_limit
                and s.avg_logprob >= logprob_limit and s.compression_ratio <= 2.4]
    text = ' '.join(s.text.strip() for s in accepted).strip()
    diagnostics = {'durationSeconds': round(samples.size / 16000, 3),
                       'rms': round(rms, 7), 'peak': round(peak, 7),
                       'speechSeconds': round(info.duration_after_vad, 3),
                       'decodedSegments': len(decoded), 'acceptedSegments': len(accepted),
                       'languageMode': 'multilingual',
                       'recovery': recovery, 'gain': round(gain, 3),
                       'result': 'recognized' if text else 'no-speech-detected' if not info.duration_after_vad else 'no-reliable-transcript'}
    return text, diagnostics


def main():
    models = Path(__file__).resolve().parents[1] / '.local' / 'models'
    from parakeet_speech import ParakeetSpeech, available
    if available(models / 'parakeet-tdt-v3'):
        engine = ParakeetSpeech(models / 'parakeet-tdt-v3')
        recognize_audio = engine.recognize
        model_name = engine.name
    else:
        model_path = models / 'whisper-small' if (models / 'whisper-small' / 'model.bin').is_file() else models / 'whisper-base'
        model = WhisperModel(str(model_path),
                             device='cpu', compute_type='int8', cpu_threads=min(4, os.cpu_count() or 2), local_files_only=True)
        recognize_audio = lambda samples: recognize(model, samples)
        model_name = model_path.name
    print(json.dumps({'ready': True, 'model': model_name}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            audio = base64.b64decode(request['audio'], validate=True)
            samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
            text, diagnostics = recognize_audio(samples)
            diagnostics['model'] = model_name
            print(json.dumps({'id': request['id'], 'text': text, 'diagnostics': diagnostics}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({'id': request.get('id'), 'error': str(error)}), flush=True)


if __name__ == '__main__':
    main()
