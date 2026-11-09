"""Validate the exact installed 156.1 ARM64 ELF, metadata and consumed ABI.

Usage: python profile1561-test.py libil2cpp.so dump.cs global-metadata.dat
Inputs are operator-owned, untracked APK extracts; never download a substitute.
"""
import hashlib
import re
import struct
import sys
from pathlib import Path

source = (Path(__file__).parents[1] / 'cpp/il2cpp_dump.cpp').read_text(encoding='utf-8')
binary = Path(sys.argv[1]).read_bytes()
dump = Path(sys.argv[2]).read_text(encoding='utf-8-sig')
metadata = Path(sys.argv[3]).read_bytes()
assert len(binary) == 256384336
assert hashlib.sha256(binary).hexdigest() == '97ef6650f73d99ca8c7ebbbdf2d059d0d41ea68c036fde05634003f6a052aefb'
assert len(metadata) == 32142292
assert hashlib.sha256(metadata).hexdigest() == 'b3e4d8ec9a9e8794f68132b01c49a7b05f1be57497654efd1d785892e5810eff'
assert struct.unpack_from('<II', metadata) == (0xFAB11BAF, 31)
assert binary[:6] == b'\x7fELF\x02\x01'
assert struct.unpack_from('<H', binary, 18)[0] == 183  # AArch64
phoff = struct.unpack_from('<Q', binary, 32)[0]
segments = [struct.unpack_from('<IIQQQQQQ', binary, phoff + i * 56)
            for i in range(struct.unpack_from('<H', binary, 56)[0])]


def signature(name):
    body = re.search(r'static const uint8_t ' + name + r'\[\] = \{(.*?)\};', source, re.S)[1]
    return bytes(int(x, 16) for x in re.findall(r'0x([0-9A-Fa-f]{2})', body))


def mapped_bytes(address, size):
    segment = next(s for s in segments if s[0] == 1 and s[1] & 1
                   and s[3] <= address and address + size <= s[3] + s[5])
    offset = segment[2] + address - segment[3]
    return offset, binary[offset:offset + size]


def klass(name, namespace):
    pattern = r'^public (?:sealed )?(?:abstract )?class ' + re.escape(name) + r' :[^\n]*\n\{(.*?)^\}'
    matches = []
    for match in re.finditer(pattern, dump, re.M | re.S):
        start = dump.rfind('// Namespace:', 0, match.start())
        actual_namespace = dump[start:dump.index('\n', start)].removeprefix('// Namespace:').strip()
        if actual_namespace == namespace:
            matches.append(match[1])
    assert len(matches) == 1, (name, namespace, len(matches))
    return matches[0]


for name, address, namespace, cname, declaration, sig in (
    ('MapObjectManager_RegisterMapObject', 0x5B42820, 'Niantic.Ichigo.Game.MapObjects', 'MapObjectManager',
     'public void RegisterMapObject(MapObjectBase mapObject, MapObjectTag mapObjectTag)', 'SIG1561_Register'),
    ('LocationController_Update', 0x72CEF78, 'Niantic.Ichigo.Location', 'LocationController',
     'private void Update()', 'SIG1561_Update'),
    ('SetOverride', 0x72CFAD8, 'Niantic.Ichigo.Location', 'LocationController',
     'public void SetDeviceLocationOverrideForDebug(Nullable<LatLngAlt> location)', 'SIG1561_Override'),
):
    assert int(re.search(r'#define RVA1561_' + name + r' (0x[0-9A-Fa-f]+)', source)[1], 16) == address
    expected = signature(sig)
    offset, actual = mapped_bytes(address, len(expected))
    assert address - offset == 0x4000 and actual == expected, name
    assert binary[address:address + len(expected)] != expected, 'file offset confused with mapped RVA'
    body = klass(cname, namespace)
    assert re.search(r'// RVA: 0x' + format(address, 'X') + r'\b[^\n]*\n\s*' + re.escape(declaration), body)
    print(name, hex(address), 'mapped signature and managed arguments verified')

# The delayed, metadata-resolved materialization callback retains one argument.
body = klass('MapManager', 'Niantic.TokyoStudio.Map')
assert 'public void RegisterMapObject(MapObjectBase obj)' in body

for cname, namespace, members in (
    ('ProtoBasedMapObject', 'Niantic.Ichigo.Game.MapObjects', {'initialMapObjectProto': '0x68'}),
    ('MapObjectProto', 'Ichigo.Proto', {'id_': '0x18', 'point_': '0x20', 'object_': '0x30', 'objectCase_': '0x38'}),
    ('PointProto', 'Ichigo.Proto', {'latDegrees_': '0x18', 'lngDegrees_': '0x20'}),
    ('PoiMushroomProto', 'Ichigo.Proto', {'poiChallenge_': '0x18', 'overrideCooldownSeconds_': '0x28', 'mushroomClusterId_': '0x30'}),
    ('PoiChallengeInfoProto', 'Ichigo.Proto', {'mushroomClusterId_': '0x30', 'challengeStartTimeMs_': '0x38', 'challengeFinishTimeMs_': '0x40', 'type_': '0x48', 'level_': '0x4C', 'challengerCapacity_': '0x6C', 'totalChallengerCount_': '0x70', 'totalChallengerPikminPower_': '0x90'}),
):
    body = klass(cname, namespace)
    for name, offset in members.items():
        assert re.search(r'\b' + name + r'; // ' + offset + r'\b', body), (cname, name)
enum = re.search(r'public enum MapObjectProto\.ObjectOneofCase[^\n]*\n\{(.*?)\n\}', dump, re.S)[1]
assert re.search(r'\bPoiMushroom = 22;', enum)

# Old address sets must not classify this ELF as an older supported version.
for version in ('152', '153', '154', '155', '156'):
    prefix = 'RVA_' if version == '152' else 'RVA' + version + '_'
    names = ['RegisterMapObject' if version == '152' else 'MapObjectManager_RegisterMapObject', 'LocationController_Update', 'SetOverride']
    sigs = ['SIG_RegisterMapObject' if version == '152' else 'SIG153_MapObjectManager_RegisterMapObject', 'SIG_LocationController_Update', 'SIG_SetOverride']
    matches = []
    for name, sig in zip(names, sigs):
        address = int(re.search(r'#define ' + prefix + name + r' (0x[0-9A-Fa-f]+)', source)[1], 16)
        expected = signature(sig)
        matches.append(mapped_bytes(address, len(expected))[1] == expected)
    assert not all(matches), '156.1 misidentified as ' + version
for name, sig in zip(names, ('SIG157_Register', 'SIG157_Update', 'SIG157_Override')):
    address = int(re.search(r'#define RVA157_' + name + r' (0x[0-9A-Fa-f]+)', source)[1], 16)
    expected = signature(sig)
    assert mapped_bytes(address, len(expected))[1] != expected, '157 entrypoint falsely matches 156.1'
assert 'if (!is152 && !is153 && !is154 && !is155 && !is156 && !is1561 && !is157)' in source
assert 'TARGET_PIKMIN_1561_VERSION_CODE 1793076318' in source
assert 'if (is155 || is156 || is1561 || is157)' in source  # Cancer render cap remains opt-in.
print('156.1 exact inputs, consumed layouts, legacy exclusion and fail-closed guard passed')
