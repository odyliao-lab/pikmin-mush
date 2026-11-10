"""Control-only synthetic adversarial fixtures; no private screenshots in Git."""
import os
import atexit
import pathlib
import re
import struct
import subprocess
import sys
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
source = (root / 'popup-templates.h').read_text(encoding='utf-8')
groups = {}
for name, body in re.findall(r'PopupSample (p\d+_\w+)\[\]=\{(.*?)\};', source):
    groups[name] = [tuple(map(int, p)) for p in re.findall(r'\{(\d+),(\d+),(\d+),(\d+),(\d+)\}', body)]
templates = re.findall(r'\{"(\w+)",(\d+),(\d+),(\d+),(\d+),(p\d+)_frame,', source)
# Keep the two observed 156.1 phone glyph variants independently calibrated.
# They must not be replaced with a generic confirmation-button template.
assert ('restricted', '1080', '2400', '540', '1287', 'p20') in templates
assert ('danger', '1440', '3120', '720', '1730', 'p21') in templates
assert ('dashboard', '1080', '2160', '540', '1925', 'p25') in templates
assert groups['p25_frame'] == groups['p8_frame']
assert groups['p25_text'] == groups['p8_text']
assert len(groups['p25_button']) == 64
assert all((x-540)**2+(y-1925)**2 <= 25**2 for x,y,*_ in groups['p25_button'])
assert sum(all(v >= 245 for v in rgb) for x,y,*rgb in groups['p25_button']) == 32
assert sum(rgb[1]-rgb[0] >= 40 for x,y,*rgb in groups['p25_button']) == 32
assert ('dashboard', '1080', '2400', '540', '2165', 'p27') in templates
assert ('dashboard', '1440', '3120', '720', '2890', 'p28') in templates
assert groups['p27_frame'] == groups['p9_frame']
assert groups['p27_text'] == groups['p9_text']
for prefix, x, y in [('p27', 540, 2165), ('p28', 720, 2890)]:
    assert len(groups[prefix+'_frame']) >= 64
    assert len(groups[prefix+'_text']) >= 96
    assert len(groups[prefix+'_button']) == 64
    assert all((px-x)**2+(py-y)**2 <= 25**2
               for px,py,*_ in groups[prefix+'_button'])
    assert sum(all(v >= 245 for v in rgb)
               for px,py,*rgb in groups[prefix+'_button']) == 32
    assert sum(rgb[1]-rgb[0] >= 40
               for px,py,*rgb in groups[prefix+'_button']) == 32
# Libra's public header text replaces scenery-dependent bottom-menu samples.
assert all(165 <= y < 248 for x,y,*_ in groups['p28_text'])
# Both the inner map edge and the highlighted calendar date change at runtime.
# Anchor strictly within the two outer white gutters, never those interiors.
assert all((x < 100 or x > 1340) and 400 <= y < 1330
           for x,y,*_ in groups['p28_frame'])
assert ('announcement', '1080', '2160', '105', '1923', 'p24') in templates
assert len(groups['p24_frame']) >= 48 and len(groups['p24_text']) >= 192
assert len(groups['p24_button']) >= 64
# This is the separate X, well away from the announcement's details link.
assert all(40 <= x <= 170 and 1850 <= y <= 1990
           for x,y,*_ in groups['p24_button'])
for prefix in ('p20', 'p21'):
    assert len(groups[prefix+'_frame']) >= 48
    assert len(groups[prefix+'_text']) >= 160
    assert len(groups[prefix+'_button']) >= 96
recovery = (root / 'popup-recovery.sh').read_text(encoding='utf-8')
allowed = re.search(r'case "\$1" in ([a-z|]+)\) ;; \*\) return 1', recovery)
assert allowed, 'popup action contract not found'
allowed_kinds = set(allowed[1].split('|'))
assert all(t[0] in allowed_kinds for t in templates), 'classifier role is not actionable'
remote = len(sys.argv) == 3
adb = [os.environ.get('ADB', 'adb'), '-s', sys.argv[2]] if remote else []
tmp = tempfile.TemporaryDirectory()
atexit.register(tmp.cleanup)
fixture = pathlib.Path(tmp.name) / 'popup-fixture.raw'
remote_fixture = '/data/local/tmp/popup-probe-fixture.raw'
command = adb + ['shell', sys.argv[1], remote_fixture] if remote else [sys.argv[1], '-']
count = 0

def check(data, expected):
    global count
    if remote:
        fixture.write_bytes(data)
        subprocess.run(adb + ['push', '-z', 'any', str(fixture), remote_fixture], capture_output=True, timeout=25, check=True)
    result = subprocess.run(command, input=None if remote else data, capture_output=True, timeout=25, check=True)
    actual = result.stdout.decode().strip()
    assert actual == expected, (count, expected, actual)
    count += 1

def blank(w, h, fmt=1):
    return bytearray(struct.pack('<IIII', w, h, fmt, 0) + bytes(w*h*4))

def paint(data, w, pts, dy=0):
    for x,y,r,g,b in pts:
        k = 16 + ((y+dy)*w+x)*4
        data[k:k+4] = bytes((r,g,b,255))

def paint_rect(data, w, rect, color):
    x0,y0,x1,y1 = rect
    row = bytes((*color,255)) * (x1-x0)
    for y in range(y0,y1):
        k = 16 + (y*w+x0)*4
        data[k:k+len(row)] = row

check(b'', 'unknown')
check(struct.pack('<IIII', 0xffffffff, 0xffffffff, 1, 0), 'unknown')
check(struct.pack('<IIII', 1080, 2400, 2, 0), 'unknown')
for kind, sw, sh, sx, sy, prefix in templates:
    w,h,x,y = map(int, (sw,sh,sx,sy))
    data = blank(w,h)
    for group in ('frame','text','button'):
        paint(data,w,groups[prefix+'_'+group])
    check(data, f'{kind} {x} {y}')
    check(data[:-1], 'unknown')
    missing_frame = blank(w,h)
    for group in ('text','button'):
        paint(missing_frame,w,groups[prefix+'_'+group])
    check(missing_frame, 'unknown')
    # A familiar button/frame alone cannot authorize a click on other text.
    missing_text = blank(w,h)
    for group in ('frame','button'):
        paint(missing_text,w,groups[prefix+'_'+group])
    check(missing_text, 'unknown')
    missing_button = blank(w,h)
    for group in ('frame','text'):
        paint(missing_button,w,groups[prefix+'_'+group])
    check(missing_button, 'unknown')
    if kind == 'dashboard':
        if prefix == 'p28':
            # Includes water/road colors and any day's calendar highlight.
            # Changing either whole interior cannot disable map navigation.
            for color in ((30,150,240), (255,0,255), (0,0,0)):
                changed_interiors = bytearray(data)
                paint_rect(changed_interiors,w,(100,330,1340,1060),color)
                paint_rect(changed_interiors,w,(150,1100,1290,1460),color)
                check(changed_interiors, f'{kind} {x} {y}')
        # A white circular control or a green blob is not the compass glyph.
        # Keep foreground and negative-space checks when backgrounds animate.
        for color in ((255,255,255), (33,120,75)):
            other_control = bytearray(data)
            paint(other_control,w,[(x,y,*color) for x,y,*_ in groups[prefix+'_button']])
            check(other_control, 'unknown')
        if prefix in ('p8', 'p15', 'p25', 'p27', 'p28'):
            # Cancer/Gemini translucent edges change with the flower scene.
            # Its opaque glyph/interior must still gate the action independently.
            for color in ((0,0,0), (220,80,160)):
                scenery = bytearray(data)
                inner = 25 if prefix in ('p25', 'p27', 'p28') else 36
                ring = [(px,py,*color) for px in range(x-65,x+66)
                        for py in range(y-65,y+66)
                        if inner**2 < (px-x)**2+(py-y)**2 <= 65**2]
                paint(scenery,w,ring)
                check(scenery, f'{kind} {x} {y}')
        if prefix == 'p8':
            # Cancer's old x580/y1967 scenery sample blocked the complete
            # dashboard despite all frame/text samples agreeing. The compass
            # glyph and green negative space must remain inside radius31.
            assert all((px-x)**2+(py-y)**2 <= 31**2
                       for px,py,*_ in groups[prefix+'_button'])
            for color in ((33,162,82), (255,0,255), (0,0,0)):
                edge = bytearray(data)
                paint(edge,w,[(580,1967,*color)])
                check(edge, f'{kind} {x} {y}')
    if kind in ('recap', 'recapmood', 'announcement'):
        # Full-screen daily controls have independent top/bottom anchors.
        # Do not translate them as if they were centered warning dialogs.
        for dy in (16, 80):
            shifted = blank(w,h)
            for group in ('frame','text','button'):
                paint(shifted,w,groups[prefix+'_'+group],dy)
            check(shifted, 'unknown')
        for color in ((255,255,255), (0,0,0), (30,160,100)):
            bad_text = bytearray(data)
            paint(bad_text,w,[(px,py,*color) for px,py,*_ in groups[prefix+'_text']])
            check(bad_text, 'unknown')
        if kind == 'announcement':
            wrong_resolution = blank(w,2400)
            for group in ('frame','text','button'):
                paint(wrong_resolution,w,groups[prefix+'_'+group])
            check(wrong_resolution, 'unknown')
            details_control = bytearray(data)
            paint(details_control,w,[(px,py,255,255,255)
                                    for px,py,*_ in groups[prefix+'_button']])
            check(details_control, 'unknown')
    if kind not in ('dashboard', 'recap', 'recapmood', 'announcement'):
        shifted = blank(w,h)
        for group in ('frame','text','button'):
            paint(shifted,w,groups[prefix+'_'+group],16)
        check(shifted, f'{kind} {x} {y+16}')
        far = blank(w,h)
        for group in ('frame','text','button'):
            paint(far,w,groups[prefix+'_'+group],80)
        check(far,'unknown')
check(blank(1080,2160), 'unknown')
check(blank(1080,1920), 'unknown')
check(struct.pack('<IIII',1080,1920,1,0)+b'\xff'*(1080*1920*4),'unknown')
check(struct.pack('<IIII',1080,2160,1,0)+b'\xff'*(1080*2160*4),'unknown')
check(blank(1080,2160)+b'x','unknown')
print(f'popup probe: {count} positive/negative/translated fixtures passed')
if remote:
    subprocess.run(adb+['shell','rm','-f',remote_fixture],check=True)
