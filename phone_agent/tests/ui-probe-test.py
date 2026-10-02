"""Synthetic control-only fixtures; no private screenshots in the repository."""
import os, pathlib, re, struct, subprocess, sys, tempfile
root = pathlib.Path(__file__).resolve().parents[1]
header = (root / 'ui-templates.h').read_text()
probe = sys.argv[1]
with tempfile.TemporaryDirectory() as tmp:
    file = pathlib.Path(tmp) / 'screen.raw'
    def check(data, expected):
        file.write_bytes(data)
        if len(sys.argv) == 3:
            adb = [os.environ.get('ADB', 'adb'), '-s', sys.argv[2]]
            remote = '/data/local/tmp/ui-probe-fixture.raw'
            subprocess.run(adb+['push', str(file), remote], check=True, stdout=subprocess.DEVNULL)
            command = adb+['shell', probe, remote]
        else:
            command = [probe, str(file)]
        actual = subprocess.check_output(command, text=True).strip()
        assert actual == expected, (actual, expected)
    check(b'', 'unknown')
    check(struct.pack('<IIII', 1080, 2160, 1, 0), 'unknown')
    blank = struct.pack('<IIII', 1440, 3120, 1, 0) + bytes(1440*3120*4)
    check(blank, 'unknown')
    check(blank[:-1], 'unknown')
    check(blank+b'x', 'unknown')
    expected = ['warning 720 1730', 'warning 720 1690', 'activity 140 2895', 'dashboard 0 0']
    for i, want in enumerate(expected):
        data = bytearray(blank)
        body = re.search(r's%d\[\]=\{(.*?)\};' % i, header).group(1)
        for m in re.finditer(r'\{(\d+),(\d+),(\d+),(\d+),(\d+)\}', body):
            x,y,r,g,b = map(int,m.groups()); k=16+(y*1440+x)*4
            data[k:k+4] = bytes((r,g,b,255))
        check(data, want)
print('ui probe fixtures passed')
header = (root / 'ui-templates-scorpio.h').read_text()
with tempfile.TemporaryDirectory() as tmp:
    file = pathlib.Path(tmp) / 'screen.raw'
    blank = struct.pack('<IIII', 1220, 2712, 1, 0) + bytes(1220*2712*4)
    check(blank, 'unknown')
    check(blank[:-1], 'unknown')
    check(blank+b'x', 'unknown')
    for name, want in [('scorpio_dashboard','dashboard 0 0'), ('scorpio_activity','activity 120 2450'), ('scorpio_menu','menu 120 2450')]:
        data=bytearray(blank)
        body=re.search(name+r'\[\]=\{(.*?)\};',header).group(1)
        for m in re.finditer(r'\{(\d+),(\d+),(\d+),(\d+),(\d+)\}',body):
            x,y,r,g,b=map(int,m.groups()); k=16+(y*1220+x)*4
            data[k:k+4]=bytes((r,g,b,255))
        check(data,want)
print('Scorpio ui probe fixtures passed')
header = (root / 'ui-warning-scorpio.h').read_text()
with tempfile.TemporaryDirectory() as tmp:
    file = pathlib.Path(tmp) / 'screen.raw'
    data = bytearray(blank)
    samples = list(re.finditer(r'\{(\d+),(\d+),(\d+),(\d+),(\d+)\}', header))
    for m in samples:
        x,y,r,g,b = map(int,m.groups()); k=16+(y*1220+x)*4
        data[k:k+4] = bytes((r,g,b,255))
    check(data, 'warning 610 1448')
    # Generic white modal, changed button/text and shifted dialog must not tap.
    check(struct.pack('<IIII',1220,2712,1,0)+bytes([255])*(1220*2712*4), 'unknown')
    for m in samples[:10]:
        x,y,*_ = map(int,m.groups()); k=16+(y*1220+x)*4
        data[k:k+4] = bytes((0,0,0,255))
    check(data, 'unknown')
print('Scorpio restricted notice fixtures passed')
