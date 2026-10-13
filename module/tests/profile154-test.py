"""Check 154 mapped RVAs against the operator-supplied, untracked ARM64 ELF."""
import re
import struct
import sys
from pathlib import Path

source = (Path(__file__).parents[1] / 'cpp/il2cpp_dump.cpp').read_text(encoding='utf-8')
binary = Path(sys.argv[1]).read_bytes()
phoff = struct.unpack_from('<Q', binary, 32)[0]
count = struct.unpack_from('<H', binary, 56)[0]
segments = []
for i in range(count):
    fields = struct.unpack_from('<IIQQQQQQ', binary, phoff + i * 56)
    if fields[0] == 1:
        segments.append((fields[2], fields[3], fields[5]))
for name, signature in (
    ('MapObjectManager_RegisterMapObject', 'SIG153_MapObjectManager_RegisterMapObject'),
    ('LocationController_Update', 'SIG_LocationController_Update'),
    ('SetOverride', 'SIG_SetOverride'),
):
    address = int(re.search(r'#define RVA154_' + name + r' (0x[0-9A-Fa-f]+)', source)[1], 16)
    sig = re.search(r'static const uint8_t ' + signature + r'\[\] = \{(.*?)\};', source, re.S)[1]
    expected = bytes(int(x, 16) for x in re.findall(r'0x([0-9A-Fa-f]{2})', sig))
    offset = next(off + address - va for off, va, size in segments if va <= address < va + size)
    assert binary[offset:offset + len(expected)] == expected, name
    assert binary[address:address + len(expected)] != expected, 'file offset confused with RVA'
    print(name, hex(address), 'signature verified')
assert 'if (!is152 && !is153 && !is154 && !is155)' in source
assert 'TARGET_PIKMIN_154_VERSION_CODE 1789606828' in source
print('154 profile and fail-closed guard passed')
