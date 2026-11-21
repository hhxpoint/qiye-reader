"""Original layout-only test PDF. All plotted values are explicitly synthetic."""
from pathlib import Path
import fitz

root = Path(__file__).resolve().parent
out = root / 'chart-fixture.pdf'
doc = fitz.open()
sage = (0.31, 0.43, 0.32)
ink = (0.22, 0.26, 0.22)

def heading(page, title, subtitle):
    page.insert_text((42, 44), title, fontsize=19, color=sage)
    page.insert_text((42, 70), subtitle, fontsize=10, color=ink)
    page.insert_text((42, page.rect.height - 25), 'QIYE acceptance fixture | Synthetic data, not research findings', fontsize=9, color=sage)

p = doc.new_page(width=595, height=842)
heading(p, 'Chart and table preservation fixture', 'Original test document. All values are synthetic and only test layout preservation.')
p.insert_textbox(fitz.Rect(42, 95, 553, 152), 'The figures and table below must remain complete in the exported appendix. The reading copy must not crop the axes, omit the caption, or reinterpret these synthetic values.', fontsize=11, color=ink)
p.insert_text((55, 188), 'Figure 1. Synthetic category values', fontsize=13, color=sage)
p.draw_line((80, 385), (500, 385), color=ink)
p.draw_line((80, 230), (80, 385), color=ink)
for i, v in enumerate([30, 60, 45, 90]):
    x = 116 + i * 95
    p.draw_rect(fitz.Rect(x, 385-v*1.5, x+50, 385), color=sage, fill=(.65, .74, .57))
    p.insert_text((x+17, 378-v*1.5), str(v), fontsize=11)
    p.insert_text((x+15, 407), chr(65+i), fontsize=11)
p.insert_text((55, 437), 'Caption: These bars illustrate export fidelity, not model accuracy.', fontsize=10)
p.insert_text((55, 491), 'Table 1. Synthetic values and units', fontsize=13, color=sage)
rows = [('Category', 'Value', 'Unit'), ('A', '30', 'synthetic'), ('B', '60', 'synthetic'), ('C', '45', 'synthetic'), ('D', '90', 'synthetic')]
for i, row in enumerate(rows):
    y = 510 + i*34
    p.draw_rect(fitz.Rect(55,y,530,y+34), color=(.82,.85,.78), fill=(.94,.96,.91) if i==0 else None)
    for j, text in enumerate(row): p.insert_text((67+j*155, y+22), text, fontsize=11)
p.insert_textbox(fitz.Rect(55,700,530,780), 'Important: The data in this fixture are invented for software testing and cannot support any scientific conclusion. Use the source page numbers to check the exported copy.', fontsize=11, color=ink)

p = doc.new_page(width=842, height=595)
heading(p, 'Landscape figure with a complete legend', 'Figure 2. Both axes, all points, and the full caption must remain visible.')
p.draw_line((80,450),(757,450),color=ink)
p.draw_line((80,135),(80,450),color=ink)
points = [fitz.Point(100+i*120, 420-v*2.3) for i,v in enumerate([10,40,20,65,55,90])]
p.draw_polyline(points,color=sage,width=2)
for point in points: p.draw_circle(point, 4, color=sage, fill=sage)
for i in range(6): p.insert_text((94+i*120,473),f'T{i+1}',fontsize=12)
p.insert_text((535,120),'Legend: synthetic series',fontsize=11,color=sage)
p.insert_text((80,506),'Caption: A landscape page preserves its original aspect ratio. This is not an experiment.',fontsize=11)

p = doc.new_page(width=595, height=842)
heading(p, 'Methods and limitations', 'A long textual section is included to test paragraphs, selection and source references.')
text = '\n\n'.join([f'Paragraph {i+1}. Exported research notes should distinguish source text, machine translation and personal interpretation. A source figure must remain attached to its original page and caption. These statements describe a software test, not scientific results.' for i in range(7)])
p.insert_textbox(fitz.Rect(48,110,545,790), text, fontsize=11, lineheight=1.4, color=ink)
doc.set_metadata({'title':'Chart and table preservation fixture','author':'QIYE original acceptance test'})
doc.save(out)
print({'file':str(out),'pages':len(doc),'bytes':out.stat().st_size})

# Exercise real bitmap decoding, including PDF.js's historically silent null-image path.
from PIL import Image
import io
image = Image.new('RGB', (240, 160))
for y in range(160):
    for x in range(240):
        image.putpixel((x, y), ((x * 13 + y * 5) % 256, (x * 3 + y * 7) % 256, (x + y * 9) % 256))
encoded = io.BytesIO()
image.save(encoded, format='PNG')
(root / 'artifacts/raster-pattern.png').write_bytes(encoded.getvalue())
raster = fitz.open()
page = raster.new_page()
page.insert_text((40, 45), 'Bitmap export fixture - synthetic colour pattern', fontsize=14)
xref = page.insert_image(fitz.Rect(60, 120, 540, 440), stream=encoded.getvalue())
raster.save(root / 'raster-fixture.pdf')
raster.update_stream(xref, b'not a valid JPEG image', compress=False)
raster.xref_set_key(xref, 'Filter', '/DCTDecode')
raster.save(root / 'bad-image-fixture.pdf')
print('Saved valid bitmap and malformed-image fixtures')
