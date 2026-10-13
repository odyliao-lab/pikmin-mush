"""Validate exact operator-supplied 155 ARM64 ELF and consumed dump layouts."""
import hashlib
import re
import struct
import sys
from pathlib import Path

source = (Path(__file__).parents[1] / 'cpp/il2cpp_dump.cpp').read_text(encoding='utf-8')
binary = Path(sys.argv[1]).read_bytes()
dump = Path(sys.argv[2]).read_text(encoding='utf-8')
assert len(binary) == 255862512
assert hashlib.sha256(binary).hexdigest() == '3e841abebcd6502fdf2599cba458dcc1a86cb189262a0f46d8d660337802813a'
phoff = struct.unpack_from('<Q', binary, 32)[0]
segments = [struct.unpack_from('<IIQQQQQQ', binary, phoff+i*56) for i in range(struct.unpack_from('<H', binary, 56)[0])]
for name, signature in (
    ('MapObjectManager_RegisterMapObject', 'SIG153_MapObjectManager_RegisterMapObject'),
    ('LocationController_Update', 'SIG_LocationController_Update'),
    ('SetOverride', 'SIG_SetOverride'),
):
    address = int(re.search(r'#define RVA155_'+name+r' (0x[0-9A-Fa-f]+)', source)[1], 16)
    sig = re.search(r'static const uint8_t '+signature+r'\[\] = \{(.*?)\};', source, re.S)[1]
    expected = bytes(int(x,16) for x in re.findall(r'0x([0-9A-Fa-f]{2})', sig))
    offset = next(s[2]+address-s[3] for s in segments if s[0]==1 and s[3]<=address<s[3]+s[5])
    assert binary[offset:offset+len(expected)] == expected, name
    assert binary[address:address+len(expected)] != expected

def fields(klass, members):
    body = re.search(r'public (?:sealed )?class '+klass+r' :[^\n]*\n\{(.*?)\n\}', dump, re.S)[1]
    for name, offset in members.items():
        assert re.search(r'\b'+name+r'; // '+offset+r'\b', body), (klass,name)

fields('ProtoBasedMapObject', {'initialMapObjectProto':'0x68'})
fields('MapObjectProto', {'id_':'0x18','point_':'0x20','object_':'0x30','objectCase_':'0x38'})
fields('PointProto', {'latDegrees_':'0x18','lngDegrees_':'0x20'})
fields('PoiMushroomProto', {'poiChallenge_':'0x18','overrideCooldownSeconds_':'0x28'})
fields('PoiChallengeInfoProto', {'mushroomClusterId_':'0x30','challengeStartTimeMs_':'0x38','challengeFinishTimeMs_':'0x40','type_':'0x48','level_':'0x4C','challengerCapacity_':'0x6C','totalChallengerCount_':'0x70','totalChallengerPikminPower_':'0x90'})
assert 'if (!is152 && !is153 && !is154 && !is155)' in source
assert 'TARGET_PIKMIN_155_VERSION_CODE 1791279164' in source
print('155 exact ELF, mapped signatures, field layouts and fail-closed guard passed')
