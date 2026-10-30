#!/usr/bin/env python3
"""Alat repack APK Wahyu Studio (tanpa Android SDK).
- patch_manifest(): ubah package / nama activity / label / versionName di AndroidManifest.xml biner (AXML, string pool UTF-16).
- write_aligned_zip(): tulis ZIP (resources.arsc disimpan tanpa kompresi & rata 4 byte).
- sign_v2(): tanda tangan APK Signature Scheme v2 (RSA-PKCS1v1.5 + SHA-256).
- verify_v2(): verifikasi independen (hitung ulang digest dari berkas jadi + cek tanda tangan).
Catatan: ini BUKAN pengganti apksigner resmi; verifikasi akhir tetap sebaiknya memakai `apksigner verify` bila tersedia."""
import struct, zlib, hashlib, sys, zipfile
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography import x509

# ---------------- AXML ----------------
def patch_manifest(data, replacements):
    t, hs, size = struct.unpack_from('<HHI', data, 0); assert t == 3
    off = 8
    pt, phs, psize, scount, stcount, flags, sstart, ststart = struct.unpack_from('<HHIIIIII', data, off)
    assert pt == 1 and stcount == 0 and not (flags & 0x100), 'hanya string pool UTF-16 tanpa style yang didukung'
    offs = struct.unpack_from('<%dI' % scount, data, off + phs)
    strs = []
    for o in offs:
        p = off + sstart + o; n = struct.unpack_from('<H', data, p)[0]; p += 2
        if n & 0x8000: n = ((n & 0x7FFF) << 16) | struct.unpack_from('<H', data, p)[0]; p += 2
        strs.append(data[p:p + n * 2].decode('utf-16-le'))
    new = []
    used = set()
    for s in strs:
        if s in replacements: new.append(replacements[s]); used.add(s)
        else: new.append(s)
    assert used == set(replacements), 'string tidak ditemukan: %s' % (set(replacements) - used)
    blob = b''; noffs = []
    for s in new:
        noffs.append(len(blob)); b = s.encode('utf-16-le'); assert len(s) < 0x7FFF
        blob += struct.pack('<H', len(s)) + b + b'\x00\x00'
    while len(blob) % 4: blob += b'\x00'
    nsstart = phs + 4 * scount
    npsize = nsstart + len(blob)
    pool = struct.pack('<HHIIIIII', 1, phs, npsize, scount, 0, flags, nsstart, 0) + struct.pack('<%dI' % scount, *noffs) + blob
    rest = data[off + psize:]
    out = struct.pack('<HHI', 3, 8, 8 + len(pool) + len(rest)) + pool + rest
    return out, strs

# ---------------- ZIP ----------------
def write_aligned_zip(path, entries):
    """entries: list of (name, bytes, compress: bool). Menyimpan resources.arsc/ stored dengan alignment 4 byte."""
    out = bytearray(); cd = bytearray(); n = 0
    for name, data, comp in entries:
        nb = name.encode('utf-8'); crc = zlib.crc32(data) & 0xFFFFFFFF
        if comp:
            c = zlib.compressobj(9, zlib.DEFLATED, -15); body = c.compress(data) + c.flush(); method = 8
        else: body = data; method = 0
        extra = b''
        if method == 0:
            pad = (-(len(out) + 30 + len(nb))) % 4; extra = b'\x00' * pad
        lho = len(out)
        out += struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, 0x0800, method, 0, 0x21, crc, len(body), len(data), len(nb), len(extra)) + nb + extra + body
        cd += struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 0x0314, 20, 0x0800, method, 0, 0x21, crc, len(body), len(data), len(nb), 0, 0, 0, 0, 0, lho) + nb
        n += 1
    cdo = len(out)
    out += cd + struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, n, n, len(cd), cdo, 0)
    open(path, 'wb').write(out)

# ---------------- APK Signature Scheme v2 ----------------
def _lp(b): return struct.pack('<I', len(b)) + b
def _seq(items): return b''.join(_lp(i) for i in items)
def _chunks_digest(parts):
    ds = []; 
    for part in parts:
        for i in range(0, len(part), 1 << 20):
            ch = part[i:i + (1 << 20)]; ds.append(hashlib.sha256(b'\xa5' + struct.pack('<I', len(ch)) + ch).digest())
    return hashlib.sha256(b'\x5a' + struct.pack('<I', len(ds)) + b''.join(ds)).digest()
def _split(apk):
    eocd = apk.rfind(b'PK\x05\x06'); cdsize, cdoff = struct.unpack_from('<II', apk, eocd + 12)
    return apk[:cdoff], apk[cdoff:cdoff + cdsize], bytearray(apk[eocd:]), cdoff, eocd

def sign_v2(unsigned_path, out_path, key_pem, cert_der):
    apk = open(unsigned_path, 'rb').read()
    sec1, sec2, eocd, cdoff, _ = _split(apk)
    struct.pack_into('<I', eocd, 16, cdoff)
    digest = _chunks_digest([sec1, sec2, bytes(eocd)])
    key = serialization.load_pem_private_key(key_pem, None)
    signed_data = _lp(_seq([struct.pack('<I', 0x0103) + _lp(digest)])) + _lp(_seq([cert_der])) + _lp(b'')
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    pub = x509.load_der_x509_certificate(cert_der).public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signer = _lp(signed_data) + _lp(_seq([struct.pack('<I', 0x0103) + _lp(sig)])) + _lp(pub)
    v2 = _lp(_seq([signer]))
    pair = struct.pack('<QI', len(v2) + 4, 0x7109871a) + v2
    block = struct.pack('<Q', len(pair) + 8 + 16) + pair + struct.pack('<Q', len(pair) + 8 + 16) + b'APK Sig Block 42'
    eocd2 = bytearray(eocd); struct.pack_into('<I', eocd2, 16, cdoff + len(block))
    open(out_path, 'wb').write(sec1 + block + sec2 + bytes(eocd2))

def verify_v2(path):
    apk = open(path, 'rb').read()
    eocd = apk.rfind(b'PK\x05\x06'); cdsize, cdoff = struct.unpack_from('<II', apk, eocd + 12)
    assert apk[cdoff - 16:cdoff] == b'APK Sig Block 42', 'blok tanda tangan tidak ada'
    bsize = struct.unpack_from('<Q', apk, cdoff - 24)[0]; bstart = cdoff - bsize - 8
    assert struct.unpack_from('<Q', apk, bstart)[0] == bsize, 'ukuran blok tidak konsisten'
    p = bstart + 8; end = cdoff - 24; v2 = None
    while p < end:
        ln, ident = struct.unpack_from('<QI', apk, p)
        if ident == 0x7109871a: v2 = apk[p + 12:p + 8 + ln]
        p += 8 + ln
    assert v2, 'tidak ada blok v2'
    def rd(b, o): n = struct.unpack_from('<I', b, o)[0]; return b[o + 4:o + 4 + n], o + 4 + n
    signers, _ = rd(v2, 0); signer, _ = rd(signers, 0)
    sd, o = rd(signer, 0); sigs, o = rd(signer, o); pub, o = rd(signer, o)
    dig_seq, o2 = rd(sd, 0); certs, o2 = rd(sd, o2)
    d1, _ = rd(dig_seq, 0); algo = struct.unpack_from('<I', d1, 0)[0]; want, _ = rd(d1, 4)
    assert algo == 0x0103
    s1, _ = rd(sigs, 0); salgo = struct.unpack_from('<I', s1, 0)[0]; sig, _ = rd(s1, 4); assert salgo == 0x0103
    cert_der, _ = rd(certs, 0); cert = x509.load_der_x509_certificate(cert_der)
    cert.public_key().verify(sig, sd, padding.PKCS1v15(), hashes.SHA256())  # raise bila salah
    assert pub == cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    sec1 = apk[:bstart]; sec2 = apk[cdoff:cdoff + cdsize]; e = bytearray(apk[eocd:]); struct.pack_into('<I', e, 16, bstart)
    got = _chunks_digest([sec1, sec2, bytes(e)])
    assert got == want, 'DIGEST TIDAK COCOK - berkas berubah setelah ditandatangani'
    return hashlib.sha256(cert_der).hexdigest()
