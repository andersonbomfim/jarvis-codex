from pathlib import Path
from faster_whisper.utils import download_model
target = Path(__file__).resolve().parents[1] / '.local' / 'models' / 'whisper-base'
download_model('base', output_dir=str(target))
print('Modelo de reconhecimento pronto. Nenhuma geração de áudio foi realizada.')
