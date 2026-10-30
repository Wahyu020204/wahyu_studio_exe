# Wahyu Studio OCR Fix - catatan build

Sumber ZIP asli (Gradle) TIDAK diterima; hanya Wahyu_Studio_v2_0.apk. Aplikasi ini = WebView + aset HTML/JS (assets/invoice, assets/proposal) dengan classes.dex bawaan.
Karena itu ZIP ini berisi aset yang diperbaiki + alat repack, BUKAN proyek Gradle.

## Rebuild
    pip install cryptography
    python3 tools/build_apk.py Wahyu_Studio_v2_0.apk assets keystore/wahyu_ocrfix_test.p12 'oUd8XVZjh19TQvGp' Wahyu_Studio_OCR_Fixed.apk
## Tes
    npm i jsdom && node tests/run_tests.js $(pwd)/assets/invoice

## Keystore UJI (bukan keystore asli)
File: keystore/wahyu_ocrfix_test.p12 | alias: wahyuocrfix | password: oUd8XVZjh19TQvGp
Simpan baik-baik: dibutuhkan untuk memperbarui aplikasi uji ini di kemudian hari.
Package ID: com.wahyumebel.proposal.ocrfix (terpisah dari com.wahyumebel.proposal).

## File yang diubah (vs APK lama)
assets/invoice/parser.js, app.js, extract.js. Lainnya (index.html, proposal/, vendor/, classes.dex, resources.arsc, ikon) tidak diubah.

## Perubahan putaran 2 (berdasar screenshot proposal nyata Ibu Ros)
Teks OCR ternyata hampir sempurna; kesalahan ada di parser (satuan "ml" tak dikenali, angka dimensi terambil sebagai volume).
- parser.js: pembacaan per kolom (angka hanya dari sel volume/harga/jumlah di kanan), satuan "ml", klasifikasi ok/pembulatan/tidak cocok.
- app.js: jumlah proposal (fixedAmount) bila selisih akibat pembulatan volume + tombol "Pakai jumlah proposal" (satuan & massal).
- tests/fixtures/ocr_proposal_ibu_ros.txt = keluaran OCR nyata; tests/real_check.js membandingkan dengan 23 baris kebenaran.

## Putaran 3
- Uji perbesaran gambar 1800-4320 px + sharpen: akurasi teks dimensi tetap ±10/19 (tidak membantu) -> tidak diubah. Salah baca konsisten (0↔O, 5↔S, 1↔i) dan kadang ada karakter sisipan, jadi TIDAK dikoreksi otomatis.
- Item dengan dimensi mencurigakan diberi catatan non-blokir; tombol konfirmasi item pembulatan menyebut angka yang dipakai; pratinjau memberi peringatan bila ada item belum dikonfirmasi.
