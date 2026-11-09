"""Exact 157.0/1793360009 ARM64 inputs, consumed ABI and fail-closed tests.

Usage: python profile157-test.py libil2cpp.so dump.cs global-metadata.dat
Operator-owned APK extracts remain untracked. This is NOT device acceptance.
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
assert len(binary) == 257043464
assert hashlib.sha256(binary).hexdigest() == '6c36ef78a6d1f45cf5b36c73761ed526226a081d981001b71608984afde246a5'
assert len(metadata) == 32230812
assert hashlib.sha256(metadata).hexdigest() == '3f6c34de9955a27c0b273ad72d9ea52baa3d7a54aefb060eb75a065a4bca5eb2'
assert struct.unpack_from('<II', metadata) == (0xFAB11BAF, 31)
assert binary[:6] == b'\x7fELF\x02\x01'
assert struct.unpack_from('<H', binary, 18)[0] == 183
phoff = struct.unpack_from('<Q', binary, 32)[0]
segments = [struct.unpack_from('<IIQQQQQQ', binary, phoff + i*56)
            for i in range(struct.unpack_from('<H', binary, 56)[0])]


def signature(name):
    body = re.search(r'static const uint8_t '+name+r'\[\] = \{(.*?)\};', source, re.S)[1]
    return bytes(int(x, 16) for x in re.findall(r'0x([0-9A-Fa-f]{2})', body))


def mapped_bytes(address, size):
    segment = next(s for s in segments if s[0] == 1 and s[1] & 1
                   and s[3] <= address and address+size <= s[3]+s[5])
    offset = segment[2]+address-segment[3]
    return offset, binary[offset:offset+size]


def klass(name, namespace):
    pattern = r'^(?:public|internal) (?:sealed )?(?:abstract )?class '+re.escape(name)+r' :[^\n]*\n\{(.*?)^\}'
    matches = []
    for m in re.finditer(pattern, dump, re.M | re.S):
        start = dump.rfind('// Namespace:', 0, m.start())
        actual = dump[start:dump.index('\n', start)].removeprefix('// Namespace:').strip()
        if actual == namespace:
            matches.append(m[1])
    assert len(matches) == 1, (name, namespace, len(matches))
    return matches[0]


for name, address, cname, namespace, declaration, sig in (
    ('MapObjectManager_RegisterMapObject', 0x5B87ED0, 'MapObjectManager', 'Niantic.Ichigo.Game.MapObjects',
     'public void RegisterMapObject(MapObjectBase mapObject, MapObjectTag mapObjectTag)', 'SIG157_Register'),
    ('LocationController_Update', 0x732957C, 'LocationController', 'Niantic.Ichigo.Location',
     'private void Update()', 'SIG157_Update'),
    ('SetOverride', 0x732A0DC, 'LocationController', 'Niantic.Ichigo.Location',
     'public void SetDeviceLocationOverrideForDebug(Nullable<LatLngAlt> location)', 'SIG157_Override'),
):
    assert int(re.search(r'#define RVA157_'+name+r' (0x[0-9A-Fa-f]+)', source)[1], 16) == address
    expected = signature(sig)
    offset, actual = mapped_bytes(address, len(expected))
    assert len(expected) == 32 and address-offset == 0x4000 and actual == expected, name
    assert binary[address:address+len(expected)] != expected, 'RVA/file-offset confusion'
    assert re.search(r'// RVA: 0x'+format(address, 'X')+r'\b[^\n]*\n\s*'+re.escape(declaration), klass(cname, namespace))
    # Each byte participates in the equality guard; every one-byte corruption rejects.
    for index in range(len(expected)):
        altered = bytearray(actual)
        altered[index] ^= 1
        assert altered != expected
    print(name, hex(address), 'mapped signature / managed ABI verified')

body = klass('MapManager', 'Niantic.TokyoStudio.Map')
assert 'public void RegisterMapObject(MapObjectBase obj)' in body
assert 'internal void InternalRequestRecalculateViewportGroups(bool recalculateImmediately = False, bool forceRepositionMapObjects = False)' in body
for cname, namespace, members in (
    ('ProtoBasedMapObject', 'Niantic.Ichigo.Game.MapObjects', {'initialMapObjectProto': '0x68'}),
    ('MapObjectProto', 'Ichigo.Proto', {'id_': '0x18', 'point_': '0x20', 'object_': '0x30', 'objectCase_': '0x38'}),
    ('PointProto', 'Ichigo.Proto', {'latDegrees_': '0x18', 'lngDegrees_': '0x20'}),
    ('PoiMushroomProto', 'Ichigo.Proto', {'poiChallenge_': '0x18', 'overrideCooldownSeconds_': '0x28', 'mushroomClusterId_': '0x30'}),
    ('PoiChallengeInfoProto', 'Ichigo.Proto', {'mushroomClusterId_': '0x30', 'challengeStartTimeMs_': '0x38', 'challengeFinishTimeMs_': '0x40', 'type_': '0x48', 'level_': '0x4C', 'challengerCapacity_': '0x6C', 'totalChallengerCount_': '0x70', 'totalChallengerPikminPower_': '0x90'}),
):
    body = klass(cname, namespace)
    for name, offset in members.items():
        assert re.search(r'\b'+name+r'; // '+offset+r'\b', body), (cname, name)
enum = re.search(r'public enum MapObjectProto\.ObjectOneofCase[^\n]*\n\{(.*?)\n\}', dump, re.S)[1]
assert re.search(r'\bPoiMushroom = 22;', enum)
for version in ('152', '153', '154', '155', '156', '1561'):
    prefix = 'RVA_' if version == '152' else 'RVA'+version+'_'
    names = ['RegisterMapObject' if version == '152' else 'MapObjectManager_RegisterMapObject', 'LocationController_Update', 'SetOverride']
    sigs = (['SIG1561_Register', 'SIG1561_Update', 'SIG1561_Override'] if version == '1561' else
            ['SIG_RegisterMapObject' if version == '152' else 'SIG153_MapObjectManager_RegisterMapObject', 'SIG_LocationController_Update', 'SIG_SetOverride'])
    matches = []
    for name, sig in zip(names, sigs):
        address = int(re.search(r'#define '+prefix+name+r' (0x[0-9A-Fa-f]+)', source)[1], 16)
        expected = signature(sig)
        matches.append(mapped_bytes(address, len(expected))[1] == expected)
    assert not all(matches), '157 misidentified as '+version
assert 'if (!is152 && !is153 && !is154 && !is155 && !is156 && !is1561 && !is157)' in source
assert 'const bool is157 = !is152 && !is153 && !is154 && !is155 && !is156 && !is1561 &&' in source
assert 'TARGET_PIKMIN_157_VERSION_CODE 1793360009' in source
assert 'if (is155 || is156 || is1561 || is157)' in source
print('157 exact inputs / consumed layouts / old-profile exclusion / fail-closed passed')
