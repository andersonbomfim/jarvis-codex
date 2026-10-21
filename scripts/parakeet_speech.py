"""Local CPU recognition; all microphone samples remain in memory."""
import json
import zlib
from pathlib import Path

import numpy as np
from faster_whisper.vad import collect_chunks, get_speech_timestamps


MODEL_FILES = ('encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt')


def available(directory):
    return all((Path(directory) / name).is_file() for name in MODEL_FILES)


def reliable_text(result, recovery=False):
    text = str(result.get('text', '')).strip()
    if not any(character.isalpha() for character in text):
        return '', None
    scores = result.get('ys_log_probs', [])
    if not scores or not np.all(np.isfinite(scores)):
        return '', None
    confidence = float(np.mean(scores))
    # These are emitted-token probabilities, not Whisper's no-speech score.
    # A relaxed VAD pass must still produce a confident, non-repetitive result.
    encoded = text.encode('utf-8')
    compression = len(encoded) / max(1, len(zlib.compress(encoded)))
    if confidence < (-.8 if recovery else -1.) or compression > 2.4:
        return '', confidence
    return text, confidence


class ParakeetSpeech:
    name = 'parakeet-tdt-v3-int8'

    def __init__(self, directory):
        import sherpa_onnx
        directory = Path(directory)
        self.recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(directory / MODEL_FILES[0]),
            decoder=str(directory / MODEL_FILES[1]),
            joiner=str(directory / MODEL_FILES[2]),
            tokens=str(directory / MODEL_FILES[3]),
            num_threads=2, model_type='nemo_transducer', provider='cpu',
        )

    def recognize(self, samples):
        rms = float(np.sqrt(np.mean(samples ** 2))) if samples.size else 0.
        peak = float(np.max(np.abs(samples))) if samples.size else 0.
        recovery = False
        gain = 1.
        options = dict(threshold=.5, min_speech_duration_ms=100,
                       min_silence_duration_ms=300, speech_pad_ms=200)
        chunks = get_speech_timestamps(samples, **options) if samples.size else []
        signal = samples
        if not chunks and samples.size >= 2400 and rms >= .0005 and peak >= .003:
            recovery = True
            gain = min(8., .25 / peak) if peak < .15 else 1.
            signal = samples * gain
            chunks = get_speech_timestamps(signal, **{**options, 'threshold': .3})

        speech_seconds = sum(chunk['end'] - chunk['start'] for chunk in chunks) / 16000
        text = ''
        confidence = None
        if chunks:
            audio_chunks, _ = collect_chunks(signal, chunks)
            stream = self.recognizer.create_stream()
            stream.accept_waveform(16000, np.concatenate(audio_chunks))
            self.recognizer.decode_stream(stream)
            result = json.loads(str(stream.result))
            text, confidence = reliable_text(result, recovery)

        diagnostics = {
            'durationSeconds': round(samples.size / 16000, 3),
            'rms': round(rms, 7), 'peak': round(peak, 7),
            'speechSeconds': round(speech_seconds, 3),
            'languageMode': 'multilingual', 'recovery': recovery,
            'gain': round(gain, 3), 'model': self.name,
            'tokenLogProbability': round(confidence, 4) if confidence is not None else None,
            'result': 'recognized' if text else 'no-speech-detected' if not chunks else 'no-reliable-transcript',
        }
        return text, diagnostics
