#!/usr/bin/env python3
"""Ресурсы Windows для установщика без внешних утилит: иконка (PNG внутри ICO) и сведения о версии.
Пишет rsrc_windows_amd64.syso (COFF-объект с секцией .rsrc — Go подключает его при сборке) и prometey.ico."""
import struct, sys, io, os
from PIL import Image, ImageDraw, ImageFont

version = sys.argv[1] if len(sys.argv) > 1 else '1.0.0'
out_dir = sys.argv[2] if len(sys.argv) > 2 else '.'
nums = [int(x) for x in (version.split('-')[0].split('.') + ['0', '0', '0'])[:4]]

# ---------- иконка: оранжевый квадрат со скруглением и белой «P», как в CRM ----------
def icon(size):
    s = 4  # рисуем крупнее и уменьшаем — сглаженные края
    W = size * s
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    grad = Image.new('RGBA', (W, W))
    px = grad.load()
    a, b = (234, 91, 12), (255, 175, 82)
    for y in range(W):
        for x in range(W):
            t = (x + y) / (2 * W)
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
    mask = Image.new('L', (W, W), 0)
    pad = int(W * 0.04)
    ImageDraw.Draw(mask).rounded_rectangle((pad, pad, W - pad, W - pad), radius=int(W * 0.24), fill=255)
    img.paste(grad, (0, 0), mask)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', int(W * 0.66))
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), 'P', font=font)
    d.text(((W - (box[2] - box[0])) / 2 - box[0], (W - (box[3] - box[1])) / 2 - box[1]), 'P', font=font, fill=(255, 255, 255, 255))
    img = img.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO(); img.save(buf, 'PNG', optimize=True); return buf.getvalue()

sizes = [256, 128, 64, 48, 32, 24, 16]
pngs = [icon(sz) for sz in sizes]

# .ico для ярлыков и документации
ico = struct.pack('<HHH', 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
for sz, data in zip(sizes, pngs):
    ico += struct.pack('<BBBBHHII', sz % 256, sz % 256, 0, 0, 1, 32, len(data), offset); offset += len(data)
ico += b''.join(pngs)
open(os.path.join(out_dir, 'prometey.ico'), 'wb').write(ico)

# ---------- VERSIONINFO ----------
def u16z(s): return (s + '\0').encode('utf-16-le')
def pad4(b): return b + b'\0' * ((4 - len(b) % 4) % 4)
def block(key, value=b'', vtype=1, children=b'', value_len=None):
    head_wo_len = struct.pack('<HH', value_len if value_len is not None else 0, vtype) + u16z(key)
    body = pad4(struct.pack('<H', 0) + head_wo_len)[2:]  # выравнивание считается от начала блока
    body = pad4(b'\0\0' + body)[2:]
    data = body + pad4(value) if value else body
    data = pad4(b'\0\0' + data)[2:] + children
    return struct.pack('<H', 2 + len(data)) + data
def string(key, val):
    v = u16z(val)
    return block(key, v, 1, value_len=len(val) + 1)
ms = lambda a, b: (a << 16) | b
fixed = struct.pack('<13I', 0xFEEF04BD, 0x00010000, ms(nums[0], nums[1]), ms(nums[2], nums[3]), ms(nums[0], nums[1]), ms(nums[2], nums[3]), 0x3F, 0, 0x40004, 1, 0, 0, 0)
strings = [('CompanyName', 'ПРОМЕТЕЙ'), ('FileDescription', 'ПРОМЕТЕЙ CRM — установка и управление'), ('FileVersion', version), ('InternalName', 'PrometeyCRM-Setup'),
           ('LegalCopyright', '© 2026 ПРОМЕТЕЙ'), ('OriginalFilename', 'PrometeyCRM-Setup.exe'), ('ProductName', 'ПРОМЕТЕЙ CRM'), ('ProductVersion', version)]
table = block('041904B0', children=b''.join(pad4(string(k, v)) for k, v in strings))
sfi = block('StringFileInfo', children=pad4(table))
var = block('Translation', struct.pack('<HH', 0x0419, 0x04B0), 0, value_len=4)
vfi = block('VarFileInfo', children=pad4(var))
verinfo = block('VS_VERSION_INFO', fixed, 0, children=pad4(sfi) + vfi, value_len=len(fixed))

# ---------- дерево ресурсов ----------
LANG = 0x0419
res = {3: [(i + 1, d) for i, d in enumerate(pngs)]}
grp = struct.pack('<HHH', 0, 1, len(sizes)) + b''.join(struct.pack('<BBBBHHIH', sz % 256, sz % 256, 0, 0, 1, 32, len(d), i + 1) for i, (sz, d) in enumerate(zip(sizes, pngs)))
res[14] = [(1, grp)]
res[16] = [(1, verinfo)]
types = sorted(res)
def dir_hdr(n): return struct.pack('<IIHHHH', 0, 0, 0, 0, 0, n)
# раскладка: каталог типов, каталоги имён, каталоги языков, записи данных, затем сами данные
lvl1 = 16 + 8 * len(types)
lvl2_off, cur = {}, lvl1
for t in types: lvl2_off[t] = cur; cur += 16 + 8 * len(res[t])
lvl3_off = {}
for t in types:
    for rid, _ in res[t]: lvl3_off[(t, rid)] = cur; cur += 16 + 8
entry_off = {}
for t in types:
    for rid, _ in res[t]: entry_off[(t, rid)] = cur; cur += 16
data_off = {}
cur = (cur + 7) & ~7
for t in types:
    for rid, d in res[t]: data_off[(t, rid)] = cur; cur = (cur + len(d) + 7) & ~7
sec = bytearray(cur)
struct.pack_into('<16s', sec, 0, dir_hdr(len(types)))
for i, t in enumerate(types): struct.pack_into('<II', sec, 16 + 8 * i, t, 0x80000000 | lvl2_off[t])
relocs = []
for t in types:
    o = lvl2_off[t]; sec[o:o + 16] = dir_hdr(len(res[t]))
    for i, (rid, d) in enumerate(res[t]):
        struct.pack_into('<II', sec, o + 16 + 8 * i, rid, 0x80000000 | lvl3_off[(t, rid)])
        l3 = lvl3_off[(t, rid)]; sec[l3:l3 + 16] = dir_hdr(1)
        struct.pack_into('<II', sec, l3 + 16, LANG, entry_off[(t, rid)])
        e = entry_off[(t, rid)]
        struct.pack_into('<IIII', sec, e, data_off[(t, rid)], len(d), 0, 0)
        relocs.append(e)  # поле OffsetToData — относительный адрес, его поправит компоновщик
        sec[data_off[(t, rid)]:data_off[(t, rid)] + len(d)] = d

# ---------- COFF-объект ----------
hdr_size, sh_size = 20, 40
raw_ptr = hdr_size + sh_size
rel_ptr = raw_ptr + len(sec)
sym_ptr = rel_ptr + 10 * len(relocs)
coff = struct.pack('<HHIIIHH', 0x8664, 1, 0, sym_ptr, 2, 0, 0)
coff += struct.pack('<8sIIIIIIHHI', b'.rsrc', 0, 0, len(sec), raw_ptr, rel_ptr, 0, len(relocs), 0, 0x40000040)
coff += bytes(sec)
for r in relocs: coff += struct.pack('<IIH', r, 0, 3)  # IMAGE_REL_AMD64_ADDR32NB к символу секции
coff += struct.pack('<8sIhHBB', b'.rsrc', 0, 1, 0, 3, 1)            # символ секции, IMAGE_SYM_CLASS_STATIC
coff += struct.pack('<IHHIHB3s', len(sec), len(relocs), 0, 0, 0, 0, b'')  # дополнительная запись: описание секции
coff += struct.pack('<I', 4)  # пустая таблица строк
open(os.path.join(out_dir, 'rsrc_windows_amd64.syso'), 'wb').write(coff)
print('ресурсы:', len(sec), 'байт, иконок', len(sizes), ', версия', version)
