"""Combine matching MP3 streams into one seekable file without encoding again."""
import json
import sys
import argparse
from fractions import Fraction
from pathlib import Path
import av

parser = argparse.ArgumentParser()
parser.add_argument('target')
parser.add_argument('sources', nargs='+')
parser.add_argument('--title')
parser.add_argument('--artist')
args = parser.parse_args()
target = Path(args.target).resolve()
sources = [Path(value).resolve() for value in args.sources]
if len(sources) < 2 or target in sources or target.exists():
    raise ValueError('Use duas partes e um destino novo, preservando os originais.')

def duration(path):
    with av.open(str(path)) as audio:
        return sum(frame.samples / frame.sample_rate for frame in audio.decode(audio=0))

expected = sum(duration(path) for path in sources)
temporary = target.with_suffix('.partial.mp3')
end_time = Fraction(0)
packets = 0
with av.open(str(sources[0])) as template, av.open(str(temporary), 'w', format='mp3') as output:
    base = template.streams.audio[0]
    signature = (base.codec_context.name, base.codec_context.sample_rate, base.codec_context.layout.name)
    if signature[0] not in ('mp3', 'mp3float'):
        raise ValueError('A fonte precisa ser MP3.')
    destination = output.add_stream_from_template(base)
    output.metadata['title'] = args.title or target.stem
    if args.artist:
        output.metadata['artist'] = args.artist
    for path in sources:
        with av.open(str(path)) as incoming:
            source = incoming.streams.audio[0]
            current = (source.codec_context.name, source.codec_context.sample_rate, source.codec_context.layout.name)
            if current != signature:
                raise ValueError('As partes têm formatos diferentes; junção interrompida.')
            shift = None
            for packet in incoming.demux(source):
                if packet.dts is None or not packet.size:
                    continue
                time_base = packet.time_base
                if shift is None:
                    shift = int(end_time / time_base) - packet.dts
                packet.dts += shift
                if packet.pts is not None:
                    packet.pts += shift
                end_time = max(end_time, (packet.dts + packet.duration) * time_base)
                packet.stream = destination
                output.mux(packet)
                packets += 1

actual = duration(temporary)
if abs(actual - expected) > .3:
    raise ValueError(f'Duração divergente: esperado {expected}, obtido {actual}.')
temporary.replace(target)
report = dict(file=str(target), parts=len(sources), seconds=round(actual, 3),
              expectedSeconds=round(expected, 3), packets=packets,
              bytes=target.stat().st_size, reencoded=False)
target.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
