const {JSDOM, VirtualConsole} = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
let pass = 0, fail = 0; const log = [];
function ok(c, name, extra) { if (c) { pass++; log.push('PASS  ' + name); } else { fail++; log.push('FAIL  ' + name + (extra ? '  -> ' + extra : '')); } }

// ---------- A. parser murni ----------
const P = require(path.join(dir, 'parser.js'));
function row(s) { return P.parseLines([s]).items[0]; }
let r = row('Lemari 2,31 m² Rp 2.500.000 Rp 5.775.000');
ok(r.vol === 2.31 && r.price === 2500000 && r.jumlah === 5775000 && !r.needsConfirm, 'A1 desimal koma 2,31 terbaca benar, lolos validasi', JSON.stringify(r));
r = row('Lemari 1.250,50 m² Rp 1.000 Rp 1.250.500');
ok(r.vol === 1250.5 && r.price === 1000 && !r.needsConfirm, 'A2 1.250,50 (titik ribuan + koma desimal) terbaca benar', JSON.stringify(r));
r = row('Lemari 1 unit Rp 1.250.000 Rp 1.250.000');
ok(r.price === 1250000 && r.jumlah === 1250000 && r.vol === 1 && !r.needsConfirm, 'A3 1.250.000 terbaca sebagai uang');
r = row('Lemari 231 m² Rp 2.500.000 Rp 5.775.000');
ok(r.vol === 231 && r.needsConfirm && r.suggest && r.suggest.vol === 2.31, 'A4 OCR menghilangkan koma (231): TIDAK diubah otomatis, ditandai + saran 2,31', JSON.stringify(r));
r = row('Lemari 7 m² Rp 2.500.000 Rp 5.775.000');
ok(r.vol === 7 && r.needsConfirm && r.suggest && r.suggest.vol === 2.31, 'A5 OCR salah baca 7: tidak diubah otomatis, ditandai + saran dari jumlah÷harga', JSON.stringify(r));
r = row('Lemari 2,13 m² Rp 2.500.000 Rp 5.775.000');
ok(r.vol === 2.13 && r.needsConfirm, 'A6 digit tertukar 2,13 terdeteksi sebagai tidak cocok');
r = row('Lemari 1,250 m² Rp 1.000.000 Rp 1.250.000');
ok(r.vol === 1.25 && r.needsConfirm && r.flags.some(f => /ambigu/.test(f)), 'A7 "1,250 m²" dibaca desimal 1,25 dan ditandai ambigu', JSON.stringify(r));
r = row('Lemari 2,31 m² Rp 2.500.000');
ok(r.needsConfirm, 'A8 jumlah tidak terbaca -> tidak bisa diverifikasi -> perlu konfirmasi', JSON.stringify(r));
ok(P.mismatch(2.31, 2500000, 5775000) === false && P.mismatch(231, 2500000, 5775000) === true, 'A9 validasi vol × harga = jumlah');

// ---------- B. aplikasi nyata (jsdom) ----------
function boot() {
  return new Promise((res) => {
    const vc = new VirtualConsole(); const errs = []; vc.on('jsdomError', e => errs.push(String(e.message).slice(0, 120)));
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'file://' + dir + '/index.html', pretendToBeVisual: true, virtualConsole: vc, beforeParse(win) { Object.defineProperty(win, 'localStorage', { value: { getItem: k => STORE.has(k) ? STORE.get(k) : null, setItem: (k, v) => STORE.set(k, String(v)), removeItem: k => STORE.delete(k) } }); } });
    dom.window.confirm = () => true; dom.window.alert = () => {};
    dom.window.URL.createObjectURL = () => 'blob:x'; dom.window.URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function () { dom.window.__downloaded = this.download; };
    dom.window.addEventListener('load', () => setTimeout(() => res({ dom, w: dom.window, d: dom.window.document, errs }), 400));
  });
}
const STORE = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
function setVal(w, el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('focusout', { bubbles: true })); }

(async () => { try {
  let { w, d, errs } = await boot();
  ok(!!d.querySelector('#items') && d.querySelectorAll('[data-k]').length > 5, 'B0 formulir invoice termuat (field data-k ada)');
  // B1 input manual desimal Indonesia -> jumlah baris
  const line = () => d.querySelector('.line[data-j="0"]');
  const vol = () => line().querySelector('[data-f="vol"]'), price = () => line().querySelector('[data-f="price"]'), amt = () => d.querySelector('#amt-0-0').textContent;
  setVal(w, vol(), '2,31'); setVal(w, price(), '2.500.000');
  ok(amt() === 'Rp5.775.000', 'B1 2,31 × 2.500.000 = Rp5.775.000', amt());
  setVal(w, vol(), '1.250,50'); setVal(w, price(), '1.000');
  ok(amt() === 'Rp1.250.500', 'B2 1.250,50 × 1.000 = Rp1.250.500', amt());
  setVal(w, vol(), '1'); setVal(w, price(), '1.250.000');
  ok(amt() === 'Rp1.250.000', 'B3 harga 1.250.000 terbaca benar', amt());

  // B4 alur baca proposal dengan OCR yang menghilangkan koma (hasil OCR disimulasikan)
  w.ProposalReader = { read: async () => ({ lines: ['LEMARI LOCKER', 'Dimensi: P 154 x T 150 x L 55 cm', '231 m² Rp 2.500.000 Rp 5.775.000', 'KITCHEN SET', '3 m² Rp 1.000.000 Rp 3.000.000', 'Total Rp 8.775.000'], method: 'simulasi OCR' }) };
  const fi = d.querySelector('#fProposal');
  Object.defineProperty(fi, 'files', { value: [{ name: 'proposal.png', type: 'image/png' }], configurable: true });
  fi.dispatchEvent(new w.Event('change')); await sleep(200);
  setVal(w, d.querySelector('[data-k="client"]'), 'Bu Test'); setVal(w, d.querySelector('[data-k="bank"]'), 'BCA'); setVal(w, d.querySelector('[data-k="account"]'), '123'); setVal(w, d.querySelector('[data-k="holder"]'), 'Wahyu');
  let rv = d.querySelector('#review').innerHTML;
  ok(/Wajib diperiksa/.test(rv) && /data-rs="0"/.test(rv) && /data-rc="0"/.test(rv), 'B4 item dengan vol 231 menampilkan peringatan + tombol saran/konfirmasi');
  ok(!/data-rc="1"/.test(rv), 'B5 item yang cocok (3 × 1.000.000) tidak diganggu');
  const v0 = d.querySelector('.item[data-i="0"] [data-f="vol"]').value;
  ok(v0 === '231', 'B6 volume TIDAK diubah otomatis (tetap 231 sampai pengguna memutuskan)', v0);
  // B7 PDF diblokir sebelum konfirmasi
  d.querySelector('#bPdf').click(); await sleep(100);
  ok(/belum dikonfirmasi/.test(d.querySelector('#toast').textContent) && !w.__downloaded, 'B7 PDF invoice diblokir sebelum angka dikonfirmasi', d.querySelector('#toast').textContent);
  // B8 koreksi manual: 2,31 -> peringatan hilang otomatis karena cocok dengan proposal
  setVal(w, d.querySelector('.item[data-i="0"] [data-f="vol"]'), '2,31');
  rv = d.querySelector('#review').innerHTML;
  ok(!/data-rc="0"/.test(rv) && !/belum dikonfirmasi/.test(d.querySelector('#verify').innerHTML), 'B8 koreksi manual 2,31 cocok dengan proposal -> peringatan selesai');
  ok(/Rp8\.775\.000/.test(d.querySelector('#verify').innerHTML) || /8\.775\.000/.test(d.body.textContent), 'B9 total invoice memakai angka terkoreksi (8.775.000)');
  // B10 tombol saran
  setVal(w, d.querySelector('.item[data-i="0"] [data-f="vol"]'), '7');
  rv = d.querySelector('#review').innerHTML; ok(/data-rs="0"/.test(rv), 'B10 volume 7 -> saran muncul lagi');
  d.querySelector('[data-rs="0"]').click();
  ok(d.querySelector('.item[data-i="0"] [data-f="vol"]').value === '2,31' && !/data-rc="0"/.test(d.querySelector('#review').innerHTML), 'B11 tombol "Pakai volume 2,31" menerapkan saran atas pilihan pengguna');
  // B12 mismatch tetap, pengguna konfirmasi manual
  setVal(w, d.querySelector('.item[data-i="0"] [data-f="vol"]'), '2,5');
  d.querySelector('[data-rc="0"]').click();
  ok(/dikonfirmasi pengguna/.test(d.querySelector('#review').innerHTML) && pending() === 0, 'B12 "Angka sudah benar" mengonfirmasi item yang tetap berbeda');
  function pending() { return (d.querySelector('#verify').innerHTML.match(/belum dikonfirmasi/g) || []).length; }
  // B13 simpan & muat ulang: nilai terkonfirmasi tersimpan
  d.querySelector('#bSave').click(); await sleep(100);
  const saved = JSON.parse(STORE.get('invoiceOffline.saved.v1') || '[]');
  ok(saved.length === 1 && saved[0].data.items[0].lines[0].vol === '2,5' && saved[0].data.items[0].confirmed === true, 'B13 invoice tersimpan dengan angka terkonfirmasi', JSON.stringify(saved[0] && saved[0].data.items[0].lines[0]));
  // muat ulang dari daftar tersimpan
  setVal(w, d.querySelector('.item[data-i="0"] [data-f="vol"]'), '9');
  d.querySelector('#saved [data-sa="load"]').click();
  ok(d.querySelector('.item[data-i="0"] [data-f="vol"]').value === '2,5', 'B14 membuka invoice tersimpan memulihkan angka');
  // B15 PDF berjalan setelah semua dikonfirmasi
  w.__downloaded = null; d.querySelector('#bPdf').click(); await sleep(600);
  ok(!/belum dikonfirmasi|Isi |Lengkapi/.test(d.querySelector('#toast').textContent), 'B15 validasi PDF lolos setelah konfirmasi', d.querySelector('#toast').textContent);
  ok(/PDF diunduh: Invoice_Bu_Test_.*\.pdf/.test(d.querySelector('#toast').textContent), 'B16 PDF invoice dihasilkan (drawPDF + jsPDF berjalan)', String(w.__downloaded) + ' | ' + d.querySelector('#toast').textContent);
  // B17 tutup & buka ulang aplikasi: draft (termasuk status konfirmasi) pulih dari penyimpanan
  const b2 = await boot();
  ok(b2.d.querySelector('.item[data-i="0"] [data-f="vol"]').value === '2,5' && b2.d.querySelector('[data-k="client"]').value === 'Bu Test', 'B17 buka ulang aplikasi: draft pulih (volume 2,5, klien Bu Test)');
  // B18 draft versi lama (tanpa field baru) tetap bisa dimuat
  STORE.set('invoiceOffline.draft.v1', JSON.stringify({ client: 'Lama', items: [{ title: 'X', lines: [{ vol: '2', unit: 'm²', price: '1.000.000', desc: '' }], flags: [], ref: 0 }] }));
  const b3 = await boot();
  ok(b3.d.querySelector('[data-k="client"]').value === 'Lama' && b3.d.querySelector('#amt-0-0').textContent === 'Rp2.000.000', 'B18 draft format lama dimuat, hitungan benar (Rp2.000.000)');
  // B19 draft lama tidak diblokir (tidak ada peringatan OCR)
  ok(!/belum dikonfirmasi/.test(b3.d.querySelector('#verify').innerHTML), 'B19 draft lama tidak terkena gerbang konfirmasi');

  // ---------- C. data nyata: OCR screenshot proposal (23 item) ----------
  STORE.clear();
  const c = await boot(); const cw = c.w, cd = c.d;
  cw.ProposalReader = { read: async () => ({ lines: fs.readFileSync(path.join(__dirname, 'fixtures/ocr_proposal_ibu_ros.txt'), 'utf8').split('\n').filter(l => l.trim()), method: 'OCR nyata (hasil tesseract pada screenshot)' }) };
  const cf = cd.querySelector('#fProposal'); Object.defineProperty(cf, 'files', { value: [{ name: 'proposal.jpg', type: 'image/jpeg' }], configurable: true });
  cf.dispatchEvent(new cw.Event('change')); await sleep(300);
  setVal(cw, cd.querySelector('[data-k="client"]'), 'Ibu Ros'); setVal(cw, cd.querySelector('[data-k="bank"]'), 'BCA'); setVal(cw, cd.querySelector('[data-k="account"]'), '1'); setVal(cw, cd.querySelector('[data-k="holder"]'), 'W');
  ok(cd.querySelectorAll('.item').length === 23, 'C1 23 item terbaca dari proposal nyata', cd.querySelectorAll('.item').length);
  const vols = [...cd.querySelectorAll('.item')].map(e => e.querySelector('[data-f="vol"]').value);
  ok(vols[14] === '2,96' && vols[15] === '1,75' && vols[0] === '10,96', 'C2 volume baris 15 dan 16 benar (2,96 dan 1,75; sebelumnya 5 dan 75)', vols[14] + ' / ' + vols[15]);
  const prices = [...cd.querySelectorAll('.item')].map(e => e.querySelector('[data-f="price"]').value);
  ok(prices[14] === '1.500.000' && prices[15] === '1.800.000', 'C3 harga satuan baris 15 dan 16 benar');
  ok(/belum dikonfirmasi/.test(cd.querySelector('#verify').innerHTML) && /bRoundAll/.test(cd.querySelector('#verify').innerHTML), 'C4 3 item selisih pembulatan butuh konfirmasi, tombol massal tersedia');
  cd.querySelector('#bPdf').click(); await sleep(100);
  ok(/belum dikonfirmasi/.test(cd.querySelector('#toast').textContent), 'C5 PDF diblokir sebelum konfirmasi');
  cd.querySelector('#bRoundAll').click();
  ok(!/belum dikonfirmasi/.test(cd.querySelector('#verify').innerHTML) && /cocok dengan total di proposal/.test(cd.querySelector('#verify').innerHTML), 'C6 setelah konfirmasi: total cocok dengan proposal', cd.querySelector('#verify').textContent.slice(0, 160));
  ok(/75\.625\.000/.test(cd.querySelector('#sisa').textContent), 'C7 sisa pembayaran = Rp75.625.000 (proposal) - sebelumnya Rp210.531.000', cd.querySelector('#sisa').textContent);
  // simpan lalu buka ulang: jumlah proposal tetap terjaga
  cd.querySelector('#bSave').click(); await sleep(100);
  const c2 = await boot(); c2.d.querySelector('#saved [data-sa="load"]').click();
  ok(/75\.625\.000/.test(c2.d.querySelector('#sisa').textContent) && c2.d.querySelectorAll('.item').length === 23, 'C8 invoice tersimpan dibuka ulang: tetap Rp75.625.000, 23 item');
  // koreksi manual sesudah konfirmasi: mengubah volume menghapus jumlah tetap & meminta periksa lagi
  setVal(c2.w, c2.d.querySelector('.item[data-i="0"] [data-f="vol"]'), '10,69');
  ok(/belum dikonfirmasi/.test(c2.d.querySelector('#verify').innerHTML), 'C9 volume diubah manual 10,96 -> 10,69: kembali minta konfirmasi');
  // ---------- D. putaran 3 ----------
  ok(c2.d.querySelector('#review').innerHTML.includes('Periksa teks dimensi'), 'D1 item dengan dimensi salah-baca (P8O, LScm, dst.) diberi catatan non-blokir');
  const dn = c2.d.querySelectorAll('#review .rv').length; ok(dn === 23, 'D2 review tetap 23 item');
  // muat ulang proposal nyata, jangan konfirmasi; label tombol jelas + pesan selisih
  STORE.clear(); const e = await boot(); const ew = e.w, ed = e.d;
  ew.ProposalReader = { read: async () => ({ lines: fs.readFileSync(path.join(__dirname, 'fixtures/ocr_proposal_ibu_ros.txt'), 'utf8').split('\n').filter(l => l.trim()), method: 'x' }) };
  const ef = ed.querySelector('#fProposal'); Object.defineProperty(ef, 'files', { value: [{ name: 'p.jpg', type: 'image/jpeg' }], configurable: true });
  ef.dispatchEvent(new ew.Event('change')); await sleep(300);
  ok(/Tetap pakai hitungan Rp24\.660\.000/.test(ed.querySelector('#review').innerHTML), 'D3 tombol konfirmasi item pembulatan menyebut angka yang dipakai (Rp24.660.000)');
  ed.querySelectorAll('[data-rc]').forEach(b => b.click());
  ok(/selisih/.test(ed.querySelector('#verify').innerHTML) && /Pakai jumlah proposal/.test(ed.querySelector('#verify').innerHTML) && /75\.621\.000/.test(ed.querySelector('#sisa').textContent), 'D4 jika pengguna tetap pakai hitungan: total Rp75.621.000 + pesan selisih menjelaskan penyebab', ed.querySelector('#verify').textContent.slice(0, 200));
  STORE.clear(); const g2 = await boot(); g2.w.ProposalReader = ew.ProposalReader; const gf = g2.d.querySelector('#fProposal'); Object.defineProperty(gf, 'files', { value: [{ name: 'p.jpg', type: 'image/jpeg' }], configurable: true }); gf.dispatchEvent(new g2.w.Event('change')); await sleep(300); g2.d.querySelector('#bPrev').click(); ok(/belum dikonfirmasi/.test(g2.d.querySelector('#toast').textContent), 'D5 pratinjau memberi peringatan bila ada item belum dikonfirmasi', g2.d.querySelector('#toast').textContent);
  console.log(log.join('\n')); console.log('\nTOTAL: ' + pass + ' lulus, ' + fail + ' gagal'); if (errs.length) console.log('jsdom errors (informasi):', [...new Set(errs)].slice(0, 5));
  process.exit(fail ? 1 : 0);
} catch (e) { console.log(log.join('\n')); console.log('EXCEPTION', e.message); process.exit(2); } })();
