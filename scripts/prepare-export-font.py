"""Create the locally served static export font from the verified OFL source."""
from pathlib import Path
import hashlib
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parent.parent
source = root / 'model-assets/NotoSansSC-variable.ttf'
data = source.read_bytes()
assert len(data) == 17772300, 'Font download is incomplete'
assert hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == 'fb0637bafbcd804fe32152370a1225990745b4bc', 'Font differs from fixed upstream revision'
font = TTFont(source)
font = instantiateVariableFont(font, {'wght': 400}, inplace=True)
# This static instance has a distinct family name; retain copyright and OFL records.
names = {1: 'Qiye Sans', 2: 'Regular', 3: 'Qiye Sans Regular 1.0', 4: 'Qiye Sans Regular', 6: 'QiyeSans-Regular', 16: 'Qiye Sans', 17: 'Regular'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
output = root / 'public/fonts/QiyeSans-Regular.ttf'
font.save(output)
check = TTFont(output)
assert 'fvar' not in check
assert check.getBestCmap().keys() == font.getBestCmap().keys()
print({'path': str(output), 'bytes': output.stat().st_size, 'unicode_characters': len(check.getBestCmap()), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
