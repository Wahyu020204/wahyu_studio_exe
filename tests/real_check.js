const P=require('../assets/invoice/parser.js'), fs=require('fs');
const T=[[10.96,2250000,24670800],[1.84,2e6,3680000],[1.84,2e6,3680000],[1,1.5e6,1.5e6],[1.8,2250000,4050000],[1.55,6e5,930000],[0.96,1.5e6,1440000],[1,8e5,8e5],[4,6e5,2.4e6],
[3.87,6e5,2322000],[3.87,6e5,2322000],[2.94,2.2e6,6470200],[1.02,2250000,2295000],[1.7,1.8e6,3060000],[2.96,1.5e6,4440000],[1.75,1.8e6,3150000],[1,6e5,6e5],[1,6e5,6e5],[2,25e4,5e5],[0.8,1.5e6,1.2e6],[2.18,1.8e6,3915000],[1,1e6,1e6],[2,3e5,6e5]];
const res=P.parseLines(fs.readFileSync(process.argv[2],'utf8').split('\n'));
let bad=0; console.log('item terbaca:',res.items.length,'(benar: 23) | total proposal terbaca:',res.printedTotal);
res.items.forEach((it,i)=>{const t=T[i]; if(!t) return; const ok=it.vol===t[0]&&it.price===t[1]&&it.jumlah===t[2]; if(!ok)bad++;
 console.log((ok?'OK  ':'SALAH ')+String(i+1).padStart(2)+' vol='+it.vol+' '+it.unit+' harga='+it.price+' jumlah='+it.jumlah+(it.needsConfirm?'  [KONFIRMASI: '+it.flags.join('; ')+(it.suggest?' | saran '+JSON.stringify(it.suggest):'')+']':'')+'  « '+it.title.slice(0,38)+' »');});
console.log('angka salah:',bad);
