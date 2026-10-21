from pathlib import Path
import argparse
from huggingface_hub import snapshot_download
from faster_whisper.utils import download_model

parser = argparse.ArgumentParser(description='Instala somente reconhecimento local; nao gera voz.')
parser.add_argument('--whisper', action='store_true', help='Instalar o modelo alternativo Whisper Base.')
options = parser.parse_args()
models = Path(__file__).resolve().parents[1] / '.local' / 'models'

if options.whisper:
    download_model('base', output_dir=str(models / 'whisper-base'))
else:
    snapshot_download(
        'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
        revision='2bda32ec70b097a55adaa07d9a7173915b43cc78',
        local_dir=str(models / 'parakeet-tdt-v3'),
        allow_patterns=['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
        max_workers=2,
    )
print('Reconhecimento local em portugues e ingles pronto. Nenhuma geracao de voz foi realizada.')
