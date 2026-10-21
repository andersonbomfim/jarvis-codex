"""Run with .venv/Scripts/python.exe scripts/check-local-speech.py."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
import numpy as np
from parakeet_speech import reliable_text

spec = importlib.util.spec_from_file_location('local_speech', Path(__file__).with_name('local-speech.py'))
speech = importlib.util.module_from_spec(spec)
spec.loader.exec_module(speech)


def segment(prob=.1, confidence=-.2):
    return SimpleNamespace(text='Jarvis', no_speech_prob=prob, avg_logprob=confidence, compression_ratio=1.)


class Model:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def transcribe(self, samples, **options):
        self.calls.append((samples, options))
        segments, seconds = next(self.responses)
        return iter(segments), SimpleNamespace(duration_after_vad=seconds)


class RecognitionTests(unittest.TestCase):
    def test_short_speech_rejected_by_first_gate_can_be_recovered(self):
        model = Model([([], 0), ([segment()], .4)])
        text, data = speech.recognize(model, np.full(8000, .01, dtype=np.float32))
        self.assertEqual(text, 'Jarvis')
        self.assertTrue(data['recovery'])
        self.assertEqual([call[1]['vad_parameters']['threshold'] for call in model.calls], [.5, .3])
        self.assertLessEqual(data['gain'], 8)
        self.assertTrue(all(call[1]['vad_filter'] for call in model.calls))
        self.assertTrue(all(call[1]['hotwords'] == 'Jarvis' for call in model.calls))
        self.assertTrue(all(call[1]['multilingual'] for call in model.calls))

    def test_silence_does_not_retry(self):
        model = Model([([], 0)])
        text, data = speech.recognize(model, np.zeros(16000, dtype=np.float32))
        self.assertEqual(text, '')
        self.assertFalse(data['recovery'])

    def test_uncertain_decoded_speech_is_not_retried_into_a_command(self):
        model = Model([([segment(confidence=-1.2)], .5)])
        text, data = speech.recognize(model, np.full(8000, .05, dtype=np.float32))
        self.assertEqual(text, '')
        self.assertFalse(data['recovery'])
        self.assertEqual(len(model.calls), 1)

    def test_recovery_demands_higher_confidence(self):
        model = Model([([], 0), ([segment(prob=.5)], .5)])
        text, _ = speech.recognize(model, np.full(8000, .05, dtype=np.float32))
        self.assertEqual(text, '')

    def test_recovery_does_not_amplify_an_already_loud_signal(self):
        samples = np.full(8000, .3, dtype=np.float32)
        model = Model([([], 0), ([], 0)])
        _, data = speech.recognize(model, samples)
        self.assertEqual(data['gain'], 1.)
        np.testing.assert_array_equal(model.calls[1][0], samples)

    def test_transducer_rejects_punctuation_and_missing_confidence(self):
        for result in [{'text': '...', 'ys_log_probs': [-.01]}, {'text': 'Jarvis'}]:
            self.assertEqual(reliable_text(result)[0], '')

    def test_transducer_preserves_english_and_portuguese_without_translation(self):
        for text in ['Bom dia, Jarvis.', 'Good morning, Jarvis.']:
            self.assertEqual(reliable_text({'text': text, 'ys_log_probs': [-.1, -.2]})[0], text)

    def test_transducer_rejects_unreliable_or_nonfinite_scores(self):
        for scores in [[-2.], [float('nan')], [float('inf')]]:
            self.assertEqual(reliable_text({'text': 'Bom dia.', 'ys_log_probs': scores})[0], '')

    def test_transducer_recovery_does_not_relax_confidence(self):
        result = {'text': 'Bom dia.', 'ys_log_probs': [-.9]}
        self.assertEqual(reliable_text(result)[0], 'Bom dia.')
        self.assertEqual(reliable_text(result, recovery=True)[0], '')

    def test_transducer_does_not_accept_endlessly_repeated_words(self):
        result = {'text': 'obrigado ' * 50, 'ys_log_probs': [-.1] * 50}
        self.assertEqual(reliable_text(result)[0], '')


if __name__ == '__main__':
    unittest.main()
