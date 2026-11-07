"""Reject a stale checked-in ARM64 classifier when calibration data changes."""
import pathlib
import re
import struct

root = pathlib.Path(__file__).resolve().parents[1]
source = (root / 'popup-templates.h').read_text(encoding='utf-8')
binary = (root / 'bin/popup-probe').read_bytes()
assert binary[:6] == b'\x7fELF\x02\x01', 'expected little-endian ELF64'
assert struct.unpack_from('<H', binary, 18)[0] == 183, 'expected ARM64 phone artifact'
groups = re.findall(r'PopupSample (p\d+_\w+)\[\]=\{(.*?)\};', source)
assert groups
for name, body in groups:
    samples = re.findall(r'\{(\d+),(\d+),(\d+),(\d+),(\d+)\}', body)
    assert samples, name
    packed = b''.join(struct.pack('<5i', *map(int, point)) for point in samples)
    assert packed in binary, f'packaged classifier missing current calibration: {name}'
print(f'packaged ARM64 classifier: {len(groups)} calibration groups match source')
