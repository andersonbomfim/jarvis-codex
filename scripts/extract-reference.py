"""Read-only extraction for the Jarvis local reference cache; never edits sources."""
import sys, json, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

source = Path(sys.argv[1])
sections = []
if source.suffix.lower() == '.docx':
    with zipfile.ZipFile(source) as archive:
        info = archive.getinfo('word/document.xml')
        if info.file_size > 50 * 1024 * 1024:
            raise ValueError('Documento acima do limite de extração.')
        tree = ET.fromstring(archive.read(info))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    for number, paragraph in enumerate(tree.findall('.//w:body//w:p', ns), 1):
        text = ''.join(paragraph.itertext()) if not paragraph.findall('.//w:t', ns) else ''.join(node.text or '' for node in paragraph.findall('.//w:t', ns))
        if text.strip():
            sections.append({'locator': 'Parágrafo ' + str(number), 'text': text.strip()})
elif source.suffix.lower() == '.pdf':
    from pypdf import PdfReader
    doc = PdfReader(source)
    for number, page in enumerate(doc.pages, 1):
        text = page.extract_text() or ''
        if text.strip():
            sections.append({'locator': 'Página ' + str(number), 'text': text.strip()})
else:
    raise ValueError('Formato não suportado por este extrator.')
print(json.dumps({'sections': sections}, ensure_ascii=False))
