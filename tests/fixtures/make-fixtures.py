#!/usr/bin/env python3
"""Generates the small image fixtures the upload tests use. They carry personal metadata ON PURPOSE: the tests check it is removed.
   python3 tests/fixtures/make-fixtures.py        (needs Pillow)"""
from PIL import Image, ImageDraw, PngImagePlugin
import io, struct

def picture(w=64, h=48):
    im = Image.new('RGB', (w, h)); d = ImageDraw.Draw(im)
    for x in range(w):
        for y in range(h): im.putpixel((x, y), (int(255 * x / w), int(255 * y / h), 160))
    d.rectangle((4, 4, w - 5, h - 5), outline=(20, 20, 20)); d.text((8, 16), 'TOP', fill=(255, 255, 255))
    return im

exif = Image.Exif()
exif[0x0112] = 6                                            # Orientation: "rotate 90 degrees to display"
exif[0x010F] = 'SecretCameraMaker'; exif[0x0110] = 'SecretCameraModel'; exif[0xA431] = 'SERIAL-1234567890'; exif[0x0131] = 'SecretEditingSoftware'
exif[0x9003] = '2024:06:01 10:20:30'
gps = exif.get_ifd(0x8825)
gps[1] = 'N'; gps[2] = (12.0, 58.0, 18.0); gps[3] = 'E'; gps[4] = (77.0, 35.0, 40.0)   # 12 58 18 N, 77 35 40 E (a real place)
exif[0x8825] = gps
picture().save('tests/fixtures/photo-gps.jpg', 'JPEG', quality=85, exif=exif, comment=b'SECRET-COMMENT-IN-JPEG', xmp=b'<x:xmpmeta xmlns:x="adobe:ns:meta/">SECRET-XMP</x:xmpmeta>')

# no orientation, only GPS: after stripping there must be no EXIF block at all
exif2 = Image.Exif(); gps2 = exif2.get_ifd(0x8825); gps2[1] = 'S'; gps2[2] = (33.0, 51.0, 54.0); gps2[3] = 'E'; gps2[4] = (151.0, 12.0, 34.0); exif2[0x8825] = gps2
picture().save('tests/fixtures/photo-gps-noorient.jpg', 'JPEG', quality=85, exif=exif2)

info = PngImagePlugin.PngInfo()
info.add_text('Author', 'SECRET-PERSON-NAME'); info.add_text('Comment', 'SECRET-COMMENT-IN-PNG'); info.add_itxt('Description', 'SECRET-ITXT', lang='en')
picture(40, 40).save('tests/fixtures/photo-meta.png', 'PNG', pnginfo=info, exif=exif)

picture(48, 48).save('tests/fixtures/photo-meta.webp', 'WEBP', lossless=True, exif=exif, xmp=b'<x:xmpmeta xmlns:x="adobe:ns:meta/">SECRET-XMP-WEBP</x:xmpmeta>')
picture(48, 48).save('tests/fixtures/plain.webp', 'WEBP', lossless=True)
picture(32, 32).save('tests/fixtures/plain.png', 'PNG')
print('done')
