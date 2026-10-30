/* Membaca file proposal (PDF / JPG / PNG / WEBP) sepenuhnya offline.
   PDF berteks -> pdf.js (cepat, akurat). PDF hasil scan / gambar -> OCR Tesseract (bahasa Indonesia). */
(function (root) {
'use strict';
var base = new URL('.', document.baseURI).href;

function isPdf(file) { return /pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || ''); }
function readBuf(file) {
  return new Promise(function (res, rej) {
    var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('File tidak bisa dibaca')); };
    r.readAsArrayBuffer(file);
  });
}
function groupLines(items) {
  var rows = [];
  items.forEach(function (it) {
    if (!it.str || !it.transform) return;
    var x = it.transform[4], y = it.transform[5], r = null;
    for (var i = 0; i < rows.length; i++) { if (Math.abs(rows[i].y - y) <= 2.5) { r = rows[i]; break; } }
    if (!r) { r = { y: y, parts: [] }; rows.push(r); }
    r.parts.push({ x: x, w: it.width || 0, s: it.str });
  });
  rows.sort(function (a, b) { return b.y - a.y; });
  return rows.map(function (r) {
    r.parts.sort(function (a, b) { return a.x - b.x; });
    var out = '', end = null;
    r.parts.forEach(function (p) {
      if (!p.s.trim() && !p.s) return;
      if (end != null) { var gap = p.x - end; out += gap > 10 ? '\t' : (gap > 1.2 ? ' ' : ''); }
      out += p.s; end = p.x + p.w;
    });
    return out.replace(/\s+$/, '');
  }).filter(function (l) { return l.trim(); });
}
async function pdfRead(file, status) {
  var pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = base + 'vendor/pdf.worker.min.js';
  var doc = await pdfjs.getDocument({ data: new Uint8Array(await readBuf(file)) }).promise;
  var lines = [], chars = 0, pages = Math.min(doc.numPages, 8);
  for (var p = 1; p <= pages; p++) {
    status('Membaca halaman ' + p + ' dari ' + pages + '…');
    var page = await doc.getPage(p), tc = await page.getTextContent();
    var l = groupLines(tc.items); lines = lines.concat(l); chars += l.join('').length;
  }
  if (chars >= 40) return { lines: lines, method: 'PDF berteks' };
  // PDF scan: render ke gambar lalu OCR
  var canvases = [];
  for (var q = 1; q <= pages; q++) {
    var pg = await doc.getPage(q), vp = pg.getViewport({ scale: 3 });
    var c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; canvases.push(enhance(c));
  }
  var r = await ocr(canvases, status);
  r.method = 'PDF scan (OCR)'; return r;
}
/* Pra-proses OCR: grayscale + peregangan kontras (persentil 2%-98%). Isi gambar tidak diubah, hanya dipertegas agar angka kecil/koma desimal lebih jelas. */
function enhance(c) {
  try {
    var g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), px = d.data, n = px.length / 4, hist = new Array(256).fill(0), i, v;
    for (i = 0; i < n; i++) { v = Math.round(px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114); px[i * 4] = v; hist[v]++; }
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    if (hi - lo < 40) { lo = 0; hi = 255; }
    var k = 255 / (hi - lo);
    for (i = 0; i < n; i++) { v = Math.max(0, Math.min(255, Math.round((px[i * 4] - lo) * k))); px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
    g.putImageData(d, 0, 0);
  } catch (e) { /* jika gagal, pakai gambar asli */ }
  return c;
}
async function imgToCanvas(file) {
  var url = URL.createObjectURL(file);
  try {
    var img = await new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('Gambar tidak bisa dibuka')); }; i.src = url; });
    var k = 1, w = img.naturalWidth, h = img.naturalHeight;
    if (w < 1800) k = Math.min(2.5, 1800 / w); else if (w > 3200) k = 3200 / w;
    var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return enhance(c);
  } finally { URL.revokeObjectURL(url); }
}
async function ocr(canvases, status) {
  if (!window.Tesseract) throw new Error('Mesin OCR tidak termuat');
  status('Menyiapkan mesin OCR…');
  var worker = await Tesseract.createWorker('ind', 1, {
    workerPath: base + 'vendor/tesseract/worker.min.js',
    corePath: base + 'vendor/tesseract',
    langPath: base + 'vendor/lang',
    workerBlobURL: false, gzip: false,
    logger: function (m) { if (m && m.status === 'recognizing text') status('Membaca teks (OCR) ' + Math.round(m.progress * 100) + '%…'); }
  });
  var lines = [];
  try {
    try { await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' }); } catch (e) {}
    for (var i = 0; i < canvases.length; i++) {
      var r = await worker.recognize(canvases[i]);
      lines = lines.concat(String(r.data.text || '').split('\n'));
    }
  } finally { try { await worker.terminate(); } catch (e) {} }
  return { lines: lines.filter(function (l) { return l.trim(); }), method: 'Gambar (OCR)' };
}
async function read(file, status) {
  status = status || function () {};
  if (isPdf(file)) return pdfRead(file, status);
  return ocr([await imgToCanvas(file)], status);
}
root.ProposalReader = { read: read };
})(window);
