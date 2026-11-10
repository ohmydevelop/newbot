"""Synthetic development PDFs; never packaged with the product."""
from pathlib import Path
from io import BytesIO
import random
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject
from PIL import Image

out = Path('.data/pdf-fixtures')
out.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))

def heading(c, title, page, subtitle='Minimal Agent - PDF development fixture'):
    w, h = c._pagesize
    c.setFillColor(HexColor('#202020'))
    c.setFont('Helvetica-Bold', 24)
    c.drawString(48, h-64, title)
    c.setFont('Helvetica', 11)
    c.setFillColor(HexColor('#666666'))
    c.drawString(48, h-88, subtitle)
    c.setStrokeColor(HexColor('#dddddd'))
    c.line(48, h-108, w-48, h-108)
    c.setFont('Helvetica', 10)
    c.drawString(48, 32, 'Synthetic test data - not a production document')
    c.drawRightString(w-48, 32, str(page))
    c.setFillColor(HexColor('#202020'))

buf=BytesIO()
c=canvas.Canvas(buf, pagesize=A4, invariant=1)
heading(c, 'PDF preview sample', 1)
c.setFont('STSong-Light', 18)
c.drawString(48, 694, '中文预览：分页、缩放与原始下载')
c.setFont('Helvetica', 13)
for y, text in [(654,'This document exercises read-only rendering.'), (628,'Page 1: text, Chinese glyphs and static form appearance.'), (602,'Page 2: a small data table.'), (576,'Page 3: a landscape chart.')]:
    c.drawString(48,y,text)
c.setFont('Helvetica',12)
c.drawString(48,520,'External link (read-only in this preview)')
c.linkURL('http://127.0.0.1:9/pdf-link-probe',(48,516,360,536),relative=0,thickness=0)
c.acroForm.textfield(name='readonly_value',value='Read-only fixture',x=48,y=450,width=300,height=28,fontName='Helvetica',fontSize=12,borderWidth=1)
c.showPage()
heading(c,'Page two - Data table',2)
rows=[('Service','CPU','Memory'),('web','23%','210 MB'),('worker','41%','380 MB'),('data','12%','160 MB')]
for r,row in enumerate(rows):
    y=680-r*42
    if r==0:
        c.setFillColor(HexColor('#f0f0f0'));c.rect(48,y-10,450,34,fill=1,stroke=0)
    c.setFillColor(HexColor('#202020'));c.setFont('Helvetica-Bold' if r==0 else 'Helvetica',13)
    for x,text in zip((60,240,370),row):c.drawString(x,y,text)
c.showPage()
c.setPageSize(landscape(A4))
heading(c,'Page three - Landscape chart',3)
for i,(name,value) in enumerate([('web',23),('worker',41),('data',12)]):
    y=390-i*70
    c.setFillColor(HexColor('#202020'));c.setFont('Helvetica',14);c.drawString(48,y,name)
    c.setFillColor(HexColor('#678a9b'));c.rect(160,y-6,value*10,24,fill=1,stroke=0)
    c.setFillColor(HexColor('#202020'));c.drawString(600,y,f'{value}%')
c.save()
writer=PdfWriter();writer.clone_document_from_reader(PdfReader(BytesIO(buf.getvalue())))
writer.add_js("app.launchURL('http://127.0.0.1:9/pdf-script-probe',true);")
with (out/'preview.pdf').open('wb') as f:writer.write(f)

c=canvas.Canvas(str(out/'second-version.pdf'),pagesize=A4,invariant=1)
heading(c,'PDF VERSION TWO',1)
c.setFont('Helvetica',14);c.drawString(48,680,'A different immutable version of the same workspace file.');c.save()

rng=random.Random(42)
image=Image.frombytes('RGB',(700,700),rng.randbytes(700*700*3))
c=canvas.Canvas(str(out/'range.pdf'),pagesize=A4,invariant=1,pageCompression=1)
heading(c,'Range transport sample',1)
c.setFont('Helvetica',12);c.drawString(48,680,'A raster payload makes this fixture larger than one network chunk.')
c.drawImage(ImageReader(image),48,140,width=450,height=450,preserveAspectRatio=True)
c.save()

# Exercise the packaged OpenJPEG WASM decoder as well as range transport.
jp2=BytesIO();image.save(jp2,format='JPEG2000',irreversible=False)
writer=PdfWriter();writer.clone_document_from_reader(PdfReader(str(out/'range.pdf')))
for ref in writer.pages[0]['/Resources']['/XObject'].values():
    obj=ref.get_object()
    if obj.get('/Subtype')=='/Image':
        obj._data=jp2.getvalue()
        obj[NameObject('/Filter')]=NameObject('/JPXDecode')
        obj.pop('/DecodeParms',None)
data=BytesIO();writer.write(data);(out/'range.pdf').write_bytes(data.getvalue())

writer=PdfWriter();writer.append(PdfReader(str(out/'second-version.pdf')));writer.encrypt('fixture-password')
with (out/'password.pdf').open('wb') as f:writer.write(f)
(out/'broken.pdf').write_bytes(b'%PDF-1.7\nThis is an invalid document.\n%%EOF')
writer=PdfWriter()
for _ in range(501):writer.add_blank_page(width=595,height=842)
with (out/'many-pages.pdf').open('wb') as f:writer.write(f)
base=(out/'preview.pdf').read_bytes()
(out/'oversized.pdf').write_bytes(base+b'\0'*(8*1024*1024+1-len(base)))
reader=PdfReader(str(out/'preview.pdf'))
assert len(reader.pages)==3
assert reader.get_fields()['readonly_value']['/V']=='Read-only fixture'
assert any(a.get_object().get('/AP',{}).get('/N') is not None for a in reader.pages[0]['/Annots'])
assert len(PdfReader(str(out/'many-pages.pdf')).pages)==501
assert PdfReader(str(out/'password.pdf')).is_encrypted
assert (out/'range.pdf').stat().st_size>128*1024
print('Created 7 synthetic PDF fixtures in .data/pdf-fixtures')
