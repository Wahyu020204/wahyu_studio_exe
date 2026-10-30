#!/usr/bin/env python3
"""Pemakaian: build_apk.py <APK_dasar.apk> <folder_assets> <keystore.p12> <password> <out.apk>
Mengambil classes.dex/resources/ikon dari APK dasar (tidak dikompilasi ulang), mengganti assets/ dengan versi yang sudah diperbaiki,
mengganti package ID agar terpasang SEBAGAI APLIKASI TERPISAH, lalu menandatangani."""
import sys, os, zipfile, tempfile
from cryptography.hazmat.primitives.serialization import pkcs12, Encoding, PrivateFormat, NoEncryption
import apk_tools as T
base, assets, ks, pw, out = sys.argv[1:6]
NEW_PKG = 'com.wahyumebel.proposal.ocrfix'
z = zipfile.ZipFile(base); entries = []
for i in z.infolist():
    n = i.filename
    if n.startswith('META-INF/') or n.startswith('assets/invoice/') and os.path.exists(os.path.join(assets, n[len('assets/'):])): continue
    data = z.read(n)
    if n == 'AndroidManifest.xml':
        data, _ = T.patch_manifest(data, {'com.wahyumebel.proposal': NEW_PKG, '.MainActivity': 'com.wahyumebel.proposal.MainActivity', 'Wahyu Studio': 'Wahyu Studio (Uji OCR)', '2.0': '2.0-ocrfix'})
    entries.append((n, data, n != 'resources.arsc' and i.compress_type != 0))
for root, _, files in os.walk(assets):
    for f in sorted(files):
        full = os.path.join(root, f); rel = 'assets/' + os.path.relpath(full, assets).replace(os.sep, '/')
        if any(e[0] == rel for e in entries): continue
        keep_stored = f.endswith('.traineddata')
        entries.append((rel, open(full, 'rb').read(), not keep_stored))
entries.sort(key=lambda e: (e[0] != 'AndroidManifest.xml', e[0]))
tmp = tempfile.mktemp(suffix='.apk'); T.write_aligned_zip(tmp, entries)
key, cert, _ = pkcs12.load_key_and_certificates(open(ks, 'rb').read(), pw.encode())
T.sign_v2(tmp, out, key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()), cert.public_bytes(Encoding.DER))
print('OK', out, os.path.getsize(out), 'bytes; sha256 cert =', T.verify_v2(out))
