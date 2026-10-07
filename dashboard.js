const COLORS = { ru:'#3b82f6', global:'#10b981', restricted:'#f59e0b' };
const STATE_COLORS = { OUTAGE:'#ef4444', ALLOWLIST:'#f59e0b', FILTERED:'#f97316', OPEN:'#10b981', MIXED:'#64748b', FOREIGN:'#8b5cf6', CHECKING:'#3b82f6' };
const HISTORY_LIMIT = 500;
const PING_LIMIT = 10000;
let history=[], pingLog=[], lastCheck=null;
let netInfo=null;
let dnsConfig={providers:[],domains:[]};
let rangeN=100;
let historySort={key:'at', dir:'desc'};
let sitesSort={key:'uptime', dir:'desc'};

function fetchData(){
  if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local){
    chrome.storage.local.get(['history','pingLog','lastCheck','netInfo'], d=>{
      if(chrome.runtime && chrome.runtime.lastError){ tryFetchViaMessage(); return; }
      // чистим возможные чанки от прошлых экспериментов — мигрируем
      if(d.history_chunk_0 || d.ping_chunk_0){
        chrome.storage.local.get(null, all=>{
          const hKeys=Object.keys(all).filter(k=>k.startsWith('history_chunk_'));
          const pKeys=Object.keys(all).filter(k=>k.startsWith('ping_chunk_'));
          if(hKeys.length||pKeys.length) chrome.storage.local.remove([...hKeys,...pKeys]);
        });
      }
      history = d.history||[];
      pingLog = d.pingLog||[];
      lastCheck = d.lastCheck||null;
      netInfo = d.netInfo || d.lastCheck?.netInfo || netInfo;
      // обрежем если превышен новый лимит
      if(history.length>HISTORY_LIMIT) history=history.slice(0,HISTORY_LIMIT);
      if(pingLog.length>PING_LIMIT) pingLog=pingLog.slice(0,PING_LIMIT);
      renderAll();
    });
  } else {
    tryFetchViaMessage();
  }
}
function tryFetchViaMessage(){
  try{
    chrome.runtime.sendMessage({type:'get-history'}, res=>{
      if(chrome.runtime.lastError){ renderAll(); return; }
      if(res){ history=res.history||history; pingLog=res.pingLog||pingLog; lastCheck=res.lastCheck||lastCheck; netInfo=res.netInfo||res.lastCheck?.netInfo||netInfo; }
      renderAll();
    });
  }catch(e){ renderAll(); }
}
function fmtTime(ts){ const d=new Date(ts); return d.toLocaleString('ru-RU'); }
function fmtShort(ts){ const d=new Date(ts); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function groupAvail(rec,g){ const arr=rec.groups[g]||[]; if(!arr.length) return null; const ok=arr.filter(x=>!x.loading&&x.ok).length; const total=arr.filter(x=>!x.loading).length||arr.length; return total? ok/total*100:0; }
function groupLatency(rec,g){ const arr=(rec.groups[g]||[]).filter(x=>!x.loading&&x.ok&&x.latency); if(!arr.length) return null; return Math.round(arr.reduce((s,x)=>s+x.latency,0)/arr.length); }
function pearson(a,b){
  if(a.length!==b.length||a.length<3) return null;
  const n=a.length; const ma=a.reduce((s,v)=>s+v,0)/n; const mb=b.reduce((s,v)=>s+v,0)/n;
  let num=0, da=0, db=0;
  for(let i=0;i<n;i++){ const xa=a[i]-ma, yb=b[i]-mb; num+=xa*yb; da+=xa*xa; db+=yb*yb; }
  const den=Math.sqrt(da*db); if(den===0) return 0; return Math.max(-1,Math.min(1,num/den));
}
function corrColor(v){ if(v===null) return '#334155'; const o=Math.abs(v); const hue=v>=0?142:0; return `hsla(${hue},70%,50%,${0.2+o*0.8})`; }
function textColorFor(v){ return Math.abs(v)>0.5?'#fff':'#e2e8f0'; }
function fmtCount(n){ if(n>=1000) return (n/1000).toFixed(n>=10000?0:1).replace('.0','')+'k'; return String(n); }
function updateStorageInfo(){
  const el=document.getElementById('storage-info');
  if(!el) return;
  el.textContent=`${history.length}/${HISTORY_LIMIT} · ${fmtCount(pingLog.length)}/${fmtCount(PING_LIMIT)}`;
  el.title=`Проверок: ${history.length} из ${HISTORY_LIMIT} · Пингов: ${pingLog.length} из ${PING_LIMIT}`;
}
function sliceHistory(){ const n=Math.min(rangeN, history.length||0); if(!n) return []; const ordered=[...history].reverse(); return ordered.slice(Math.max(0, ordered.length-n)); }
function renderKPIs(ordered){
  document.getElementById('kpi-total').textContent=history.length;
  document.getElementById('kpi-total-sub').textContent = ordered.length? `показано ${ordered.length} · с ${fmtShort(ordered[0].at)} по ${fmtShort(ordered[ordered.length-1].at)}` : 'нет данных';
  const avgAvail=g=>{ const vals=ordered.map(r=>groupAvail(r,g)).filter(v=>v!==null); if(!vals.length) return null; return vals.reduce((s,v)=>s+v,0)/vals.length; };
  const set=(id,val)=>{ const el=document.getElementById(id); const bar=document.getElementById(id+'-bar'); if(val===null){el.textContent='—'; if(bar) bar.style.width='0%';} else {el.textContent=val.toFixed(1)+'%'; if(bar){bar.style.width=val.toFixed(1)+'%'; bar.style.background=val>80?COLORS[id.split('-')[1]]||'#3b82f6':val>50?'#f59e0b':'#ef4444';}}};
  set('kpi-ru',avgAvail('ru')); set('kpi-global',avgAvail('global')); set('kpi-restricted',avgAvail('restricted'));
  const allLat=ordered.map(r=>{ const vals=['ru','global','restricted'].map(g=>groupLatency(r,g)).filter(v=>v!==null); if(!vals.length) return null; return Math.round(vals.reduce((s,v)=>s+v,0)/vals.length); }).filter(v=>v!==null);
  const avgAllLat=allLat.length?Math.round(allLat.reduce((s,v)=>s+v,0)/allLat.length):null;
  document.getElementById('kpi-latency').textContent=avgAllLat!==null?avgAllLat+' мс':'—';
  document.getElementById('kpi-latency-sub').textContent=allLat.length?`медиана ${[...allLat].sort((a,b)=>a-b)[Math.floor(allLat.length/2)]} мс`:'';
  const st=lastCheck?.stable||lastCheck?.candidate;
  document.getElementById('kpi-state').textContent=st?st.label:'—';
  document.getElementById('kpi-state-sub').textContent=st?st.code:'';
  document.getElementById('kpi-state').style.color=st?(STATE_COLORS[st.code]||'#e2e8f0'):'';
  const badge=document.getElementById('state-badge');
  if(st){ badge.textContent=st.label; badge.style.background=STATE_COLORS[st.code]||'#334155'; badge.style.color='#fff'; } else { badge.textContent='Нет данных'; }
  document.getElementById('last-check').textContent=lastCheck?`Последняя проверка: ${fmtTime(lastCheck.at)} · интервал ${lastCheck.intervalMinutes} мин`:'Ещё не проверялось';
}
function clearCanvas(c){ const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); return ctx; }
function drawLineChart(canvas,series,opts={}){
  const ctx=clearCanvas(canvas); const W=canvas.width,H=canvas.height; const pad={l:40,r:10,t:10,b:24}; const w=W-pad.l-pad.r,h=H-pad.t-pad.b;
  ctx.strokeStyle='#1e293b'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){ const y=pad.t+h*i/4; ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke(); ctx.fillStyle='#64748b'; ctx.font='10px system-ui'; ctx.fillText((100-i*25).toFixed(0)+'%',2,y+3); }
  if(opts.yMaxLatency){ ctx.clearRect(0,0,40,H); for(let i=0;i<=4;i++){ const y=pad.t+h*i/4; const val=opts.yMaxLatency-i*opts.yMaxLatency/4; ctx.fillStyle='#64748b'; ctx.font='10px system-ui'; ctx.fillText(Math.round(val)+'мс',2,y+3); ctx.strokeStyle='#1e293b'; ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke(); } }
  const n=series[0]?.data.length||0; if(!n) return; const xStep=w/Math.max(1,n-1);
  if(opts.labels){ ctx.fillStyle='#475569'; ctx.font='9px system-ui'; const step=Math.ceil(n/8); opts.labels.forEach((lb,i)=>{ if(i%step===0){ const x=pad.l+i*xStep; ctx.fillText(lb,x-12,H-4); }}); }
  series.forEach(s=>{ ctx.strokeStyle=s.color; ctx.lineWidth=2; ctx.beginPath(); s.data.forEach((v,i)=>{ const x=pad.l+i*xStep; let y; if(opts.yMaxLatency!==undefined){ const max=opts.yMaxLatency||1; y=pad.t+h*(1-Math.min(v,max)/max); } else y=pad.t+h*(1-(v===null?0:v)/100); if(v===null) ctx.moveTo(x,y); else if(i===0||s.data[i-1]===null) ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.stroke(); });
}
function drawStateDist(canvas,counts){
  const ctx=clearCanvas(canvas); const W=canvas.width,H=canvas.height; const total=Object.values(counts).reduce((s,v)=>s+v,0)||1; const y=H/2,r=Math.min(90,H*0.35); let start=-Math.PI/2;
  for(const [code,cnt] of Object.entries(counts)){ const ang=cnt/total*2*Math.PI; ctx.fillStyle=STATE_COLORS[code]||'#64748b'; ctx.beginPath(); ctx.moveTo(W*0.32,y); ctx.arc(W*0.32,y,r,start,start+ang); ctx.closePath(); ctx.fill(); start+=ang; }
  ctx.fillStyle='#0b1222'; ctx.beginPath(); ctx.arc(W*0.32,y,r*0.55,0,2*Math.PI); ctx.fill(); ctx.fillStyle='#e2e8f0'; ctx.font='bold 14px system-ui'; ctx.textAlign='center'; ctx.fillText(total+' проверок',W*0.32,y+4);
}
function renderCharts(ordered){
  const labels=ordered.map(r=>fmtShort(r.at));
  drawLineChart(document.getElementById('chart-avail'), [{color:COLORS.ru,data:ordered.map(r=>groupAvail(r,'ru'))},{color:COLORS.global,data:ordered.map(r=>groupAvail(r,'global'))},{color:COLORS.restricted,data:ordered.map(r=>groupAvail(r,'restricted'))}], {labels});
  const latSeries=[{color:COLORS.ru,data:ordered.map(r=>groupLatency(r,'ru'))},{color:COLORS.global,data:ordered.map(r=>groupLatency(r,'global'))},{color:COLORS.restricted,data:ordered.map(r=>groupLatency(r,'restricted'))}];
  const maxLat=Math.max(10,...latSeries.flatMap(s=>s.data.filter(v=>v!==null)),200);
  drawLineChart(document.getElementById('chart-latency'), latSeries, {labels, yMaxLatency: Math.ceil(maxLat/100)*100});
  const counts={}; ordered.forEach(r=>{ const c=(r.stable||r.candidate)?.code||'MIXED'; counts[c]=(counts[c]||0)+1; });
  drawStateDist(document.getElementById('chart-states'), counts);
  const legend=document.getElementById('states-legend'); legend.innerHTML=''; Object.entries(counts).forEach(([code,cnt])=>{ const pct=(cnt/ordered.length*100).toFixed(1); const span=document.createElement('span'); span.style.background=STATE_COLORS[code]||'#64748b'; span.textContent=`${code} ${cnt} (${pct}%)`; legend.appendChild(span); });
  const hm=document.getElementById('chart-heatmap'); const ctx=clearCanvas(hm); const W=hm.width,H=hm.height; const pad={l:40,r:10,t:10,b:24}; const w=W-pad.l-pad.r,h=H-pad.t-pad.b; const n=ordered.length||1; const colW=w/n;
  ['ru','global','restricted'].forEach((g,gi)=>{ const y0=pad.t+gi*(h/3)+2; const rh=h/3-4; ordered.forEach((rec,i)=>{ const v=groupAvail(rec,g); const x=pad.l+i*colW; let col='#334155'; if(v!==null){ if(v>=80) col=COLORS[g]; else if(v>=40) col='#f59e0b'; else col='#ef4444'; } ctx.fillStyle=col; ctx.fillRect(x,y0,Math.max(1,colW-1),rh); }); ctx.fillStyle='#94a3b8'; ctx.font='10px system-ui'; ctx.fillText(g,6,y0+rh/2+3); });
  ctx.fillStyle='#475569'; ctx.font='9px system-ui'; const step=Math.ceil(n/12); ordered.forEach((rec,i)=>{ if(i%step===0){ const x=pad.l+i*colW; ctx.fillText(fmtShort(rec.at),x-10,H-6); }});
}
function getHistoryRows(ordered){
  const needle=(document.getElementById('filter-text').value||'').toLowerCase(); const fok=document.getElementById('filter-ok').value;
  let rows=ordered.map(rec=>{ const aRu=groupAvail(rec,'ru'),aG=groupAvail(rec,'global'),aR=groupAvail(rec,'restricted'); return {rec,aRu,aG,aR,allOk:[aRu,aG,aR].every(v=>v===100),hasFail:[aRu,aG,aR].some(v=>v!==null&&v<100)}; });
  rows=rows.filter(r=>{ if(fok==='ok'&&!r.allOk) return false; if(fok==='fail'&&!r.hasFail) return false; if(needle){ const st=(r.rec.stable||r.rec.candidate); const txt=(st?.label+' '+st?.code+' '+r.rec.groups.ru.map(x=>x.name).join(' ')+' '+r.rec.groups.global.map(x=>x.name).join(' ')+' '+r.rec.groups.restricted.map(x=>x.name).join(' ')).toLowerCase(); if(!txt.includes(needle)) return false; } return true; });
  rows.sort((a,b)=>{ let va,vb; switch(historySort.key){case 'at':va=a.rec.at;vb=b.rec.at;break;case 'code':va=(a.rec.stable||a.rec.candidate)?.code||'';vb=(b.rec.stable||b.rec.candidate)?.code||'';break;case 'ru':va=a.aRu??-1;vb=b.aRu??-1;break;case 'global':va=a.aG??-1;vb=b.aG??-1;break;case 'restricted':va=a.aR??-1;vb=b.aR??-1;break;default:va=a.rec.at;vb=b.rec.at;} if(typeof va==='string') return historySort.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va); return historySort.dir==='asc'?va-vb:vb-va; });
  return rows;
}
function renderHistoryTable(ordered){
  const tbody=document.querySelector('#tbl-history tbody'); tbody.innerHTML='';
  getHistoryRows(ordered).forEach(({rec,aRu,aG,aR})=>{
    const st=(rec.stable||rec.candidate); const tr=document.createElement('tr');
    const badge=`<span style="background:${STATE_COLORS[st?.code]||'#334155'};color:#fff;padding:2px 6px;border-radius:999px;font-size:11px">${st?.code||'—'}</span>`;
    const c=v=>v===null?'—':v.toFixed(0)+'%';
    const details=`<button class="btn ghost" style="padding:4px 8px;font-size:11px">Показать</button><div style="display:none;margin-top:6px;max-height:120px;overflow:auto;font-size:11px">${['ru','global','restricted'].map(g=>`<div><b>${g}</b>: ${(rec.groups[g]||[]).map(x=>`${x.name} ${x.ok?'OK '+x.latency+'мс':'FAIL'} `).join(' · ')}</div>`).join('')}</div>`;
    tr.innerHTML=`<td>${fmtTime(rec.at)}</td><td>${badge} <span style="font-size:11px;color:#cbd5e1">${st?.label||''}</span></td><td>${c(aRu)}</td><td>${c(aG)}</td><td>${c(aR)}</td><td>${details}</td>`;
    tbody.appendChild(tr);
  });
  if(!tbody.children.length){ const tr=document.createElement('tr'); tr.innerHTML=`<td colspan="6" style="text-align:center;color:#64748b">Нет записей по фильтру</td>`; tbody.appendChild(tr); }
}
function getSiteRows(ordered){
  const map=new Map();
  ordered.forEach(rec=>['ru','global','restricted'].forEach(g=>(rec.groups[g]||[]).forEach(r=>{
    const key=r.url; if(!map.has(key)) map.set(key,{name:r.name,url:r.url,group:g,total:0,ok:0,fail:0,latSum:0,latCnt:0,lastOk:null,lastFail:null});
    const s=map.get(key); s.group=g; s.name=r.name; if(!r.loading){ s.total++; if(r.ok){s.ok++; s.latSum+=(r.latency||0); if(r.latency) s.latCnt++; s.lastOk=rec.at;} else {s.fail++; s.lastFail=rec.at;}}
  })));
  let rows=[...map.values()].map(s=>({ ...s, uptime:s.total?s.ok/s.total*100:0, avg:s.latCnt?Math.round(s.latSum/s.latCnt):null }));
  rows.sort((a,b)=>{ let va,vb; switch(sitesSort.key){case 'name':va=a.name;vb=b.name;break;case 'group':va=a.group;vb=b.group;break;case 'uptime':va=a.uptime;vb=b.uptime;break;case 'ok':va=a.ok;vb=b.ok;break;case 'avg':va=a.avg??-1;vb=b.avg??-1;break;case 'lastOk':va=a.lastOk||0;vb=b.lastOk||0;break;case 'lastFail':va=a.lastFail||0;vb=b.lastFail||0;break;default:va=a.uptime;vb=b.uptime;} if(typeof va==='string') return sitesSort.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va); return sitesSort.dir==='asc'?va-vb:vb-va; });
  return rows;
}
function renderSites(ordered){
  const rows=getSiteRows(ordered); const tbody=document.querySelector('#tbl-sites tbody'); tbody.innerHTML='';
  rows.forEach(s=>{ const tr=document.createElement('tr'); const c=s.uptime>80?'#10b981':s.uptime>50?'#f59e0b':'#ef4444'; tr.innerHTML=`<td>${s.name}</td><td>${s.group}</td><td style="color:${c};font-weight:700">${s.uptime.toFixed(1)}%</td><td>${s.ok} / ${s.fail}</td><td>${s.avg!==null?s.avg+'мс':'—'}</td><td>${s.lastOk?fmtTime(s.lastOk):'—'}</td><td>${s.lastFail?fmtTime(s.lastFail):'—'}</td>`; tbody.appendChild(tr); });
  if(!rows.length){ const tr=document.createElement('tr'); tr.innerHTML=`<td colspan="7" style="text-align:center;color:#64748b">Нет данных</td>`; tbody.appendChild(tr); }
  const canvas=document.getElementById('chart-unstable'); const rowH=18; const neededH=Math.max(240,rows.length*rowH+40); canvas.height=neededH; canvas.style.height=neededH+'px'; const ctx=clearCanvas(canvas); const W=canvas.width,H=canvas.height; const pad={l:160,r:50,t:10,b:20}; const sorted=[...rows].sort((a,b)=>b.uptime-a.uptime); const barH=(H-pad.t-pad.b)/Math.max(1,sorted.length); sorted.forEach((s,i)=>{ const y=pad.t+i*barH+2; const availW=W-pad.l-pad.r; const w=availW*(s.uptime/100); ctx.fillStyle='#0b1222'; ctx.fillRect(pad.l,y,availW,barH-3); const col=s.uptime>80?'#10b981':s.uptime>50?'#f59e0b':'#ef4444'; ctx.fillStyle=col; ctx.fillRect(pad.l,y,w,barH-3); ctx.fillStyle='#cbd5e1'; ctx.font='11px system-ui'; ctx.textAlign='right'; let n=s.name; if(n.length>22) n=n.slice(0,22)+'…'; ctx.fillText(n,pad.l-8,y+barH/2+3); ctx.fillStyle='#e2e8f0'; ctx.font='10px system-ui'; ctx.textAlign='left'; ctx.fillText(s.uptime.toFixed(1)+'%',pad.l+w+6,y+barH/2+3); });
}
function renderCorrelations(ordered){
  const ruVals=ordered.map(r=>groupAvail(r,'ru')||0), glVals=ordered.map(r=>groupAvail(r,'global')||0), reVals=ordered.map(r=>groupAvail(r,'restricted')||0);
  const pairs=[{vals:[ruVals,glVals],label:'RU ↔ Global'},{vals:[ruVals,reVals],label:'RU ↔ Restricted'},{vals:[glVals,reVals],label:'Global ↔ Restricted'}];
  const container=document.getElementById('corr-groups'); container.innerHTML=''; pairs.forEach(p=>{ const r=pearson(p.vals[0],p.vals[1]); const cell=document.createElement('div'); cell.className='corr-cell'; const col=r===null?'#334155':r>0?'#10b981':'#ef4444'; cell.innerHTML=`<div class="label">${p.label}</div><div class="val" style="color:${col}">${r===null?'—':r.toFixed(3)}</div><div class="bar"><i style="width:${r===null?0:Math.abs(r)*100}%;background:${col}"></i></div>`; container.appendChild(cell); });
  const note=document.getElementById('corr-groups-note'); note.textContent=ordered.length<5?'Мало данных для корреляции (нужно ≥5 проверок).':`Рассчитано по ${ordered.length} точкам.`;
  const filter=document.getElementById('corr-group-filter').value; const siteMap=new Map();
  ordered.forEach(rec=>['ru','global','restricted'].forEach(g=>(rec.groups[g]||[]).forEach(r=>{ if(!siteMap.has(r.url)) siteMap.set(r.url,{name:r.name,url:r.url,group:g,seq:[]}); siteMap.get(r.url).group=g; siteMap.get(r.url).name=r.name; })));
  siteMap.forEach((v,key)=>{ v.seq=ordered.map(rec=>{ for(const g of ['ru','global','restricted']){ const f=(rec.groups[g]||[]).find(x=>x.url===key); if(f&&!f.loading) return f.ok?1:0; } return 0; }); });
  let list=[...siteMap.values()]; if(filter!=='all') list=list.filter(s=>s.group===filter); list=list.slice(0,16);
  const wrap=document.getElementById('corr-matrix'); wrap.innerHTML=''; if(list.length<2){ wrap.textContent='Недостаточно сайтов для матрицы.'; return; }
  const table=document.createElement('table'); table.className='matrix'; const thead=document.createElement('tr'); thead.innerHTML='<th></th>'+list.map(s=>`<th title="${s.url}">${s.name.slice(0,10)}</th>`).join(''); table.appendChild(thead);
  list.forEach((row,i)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td class="row-label" title="${row.url}">${row.name}</td>`+list.map((col,j)=>{ if(i===j) return `<td style="background:#1e293b;color:#fff">1.00</td>`; const r=pearson(row.seq,col.seq); const bg=corrColor(r); const txt=r===null?'—':r.toFixed(2); return `<td style="background:${bg};color:${textColorFor(r)}" title="${row.name} ↔ ${col.name}: ${txt}">${txt}</td>`; }).join(''); table.appendChild(tr); });
  wrap.appendChild(table);
  const insights=document.getElementById('corr-insights'); insights.innerHTML=''; const rRG=pearson(ruVals,glVals),rGR=pearson(glVals,reVals),rRR=pearson(ruVals,reVals); const add=t=>{ const li=document.createElement('li'); li.textContent=t; insights.appendChild(li); };
  if(rRG!==null){ if(rRG>0.7) add(`RU и Global сильно коррелируют (r=${rRG.toFixed(2)})`); else if(rRG<-0.3) add(`RU и Global отрицательно (r=${rRG.toFixed(2)})`); else add(`RU ↔ Global r=${rRG.toFixed(2)}`); }
  if(rGR!==null){ if(rGR>0.7) add(`Global и Restricted синхронны (r=${rGR.toFixed(2)})`); else if(rGR<0.2) add(`Global и Restricted слабо связаны (r=${rGR.toFixed(2)})`); }
  if(rRR!==null&&rRR<-0.3) add(`RU ↔ Restricted отрицательно (r=${rRR.toFixed(2)})`);
  if(ordered.length<10) add('Для точных выводов нужно больше истории (≥30 проверок).');
}
function renderAll(){ const ordered=sliceHistory(); updateStorageInfo(); renderNetInfo(); renderDnsTab(); renderKPIs(ordered); renderCharts(ordered); renderHistoryTable(ordered); renderSites(ordered); renderCorrelations(ordered); }

// --- Вкладка DNS: настройка провайдеров + матрица ответов ---
function loadDnsConfig(cb){
  const done = (cfg)=>{ if(cfg && cfg.providers) dnsConfig=cfg; if(cb) cb(); };
  try{
    if(chrome.storage && chrome.storage.local){
      chrome.storage.local.get(['dnsProviders','dnsDomains'], d=>{
        if(d.dnsProviders) dnsConfig={providers:d.dnsProviders, domains:d.dnsDomains||[]};
        if(!dnsConfig.providers.length){
          try{ chrome.runtime.sendMessage({type:'get-dns-config'}, res=>{ if(res && res.providers){ dnsConfig=res; renderDnsTab(); } if(cb) cb(); }); return; }catch(e){}
        }
        renderDnsTab(); if(cb) cb();
      });
    } else done(null);
  }catch(e){ done(null); }
}
function saveDnsConfig(){
  try{
    chrome.runtime.sendMessage({type:'save-dns-config', config:dnsConfig}, res=>{ if(res && res.providers) dnsConfig=res; renderDnsTab(); });
  }catch(e){
    try{ chrome.storage.local.set({dnsProviders:dnsConfig.providers, dnsDomains:dnsConfig.domains}); }catch(e2){}
  }
}
function renderDnsTab(){
  const tbody=document.querySelector('#tbl-dns tbody');
  if(!tbody) return;
  tbody.innerHTML='';
  const lastMs={}; (netInfo?.dns||[]).forEach(r=>{ lastMs[r.id]=r; });
  (dnsConfig.providers||[]).forEach(p=>{
    const tr=document.createElement('tr');
    const live=lastMs[p.id];
    const lat=live?(live.ok?live.ms+' мс':'FAIL'):'—';
    tr.innerHTML=`<td><input type="checkbox" data-dns-toggle="${p.id}" ${p.enabled!==false?'checked':''}></td><td>${p.name}</td><td>${p.target||'—'}</td><td style="word-break:break-all;max-width:280px">${p.doh}</td><td>${lat}${live&&live.diff?' ⚠':''}</td><td><button class="btn ghost" data-dns-del="${p.id}" style="padding:4px 8px">×</button></td>`;
    tbody.appendChild(tr);
  });
  if(!(dnsConfig.providers||[]).length){
    const tr=document.createElement('tr'); tr.innerHTML=`<td colspan="6" style="text-align:center;color:#64748b">Нет провайдеров — будут использованы встроенные по умолчанию</td>`; tbody.appendChild(tr);
  }
  const domBox=document.getElementById('dns-domains');
  domBox.innerHTML='';
  (dnsConfig.domains||[]).forEach(d=>{
    const s=document.createElement('span'); s.className='dns-tag';
    s.innerHTML=`${d} <button data-domain-del="${d}" title="Убрать">×</button>`;
    domBox.appendChild(s);
  });
  renderDnsMatrix();
}
function renderDnsMatrix(){
  const wrap=document.getElementById('dns-matrix');
  const verdict=document.getElementById('dns-verdict');
  if(!wrap) return;
  const ni=netInfo||lastCheck?.netInfo||null;
  const domains=ni?.dnsDomains||dnsConfig.domains||[];
  const results=ni?.dns||[];
  if(!ni||!results.length){ wrap.innerHTML='<span class="hint">Нет данных — нажмите «Проверить сейчас».</span>'; if(verdict) verdict.innerHTML=''; return; }
  const table=document.createElement('table'); table.className='matrix';
  const thead=document.createElement('tr');
  thead.innerHTML='<th></th>'+results.map(r=>`<th title="${r.target||''}">${r.name}</th>`).join('');
  table.appendChild(thead);
  domains.forEach(dom=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="row-label">${dom}</td>`+results.map(r=>{
      const ips=r.answers?r.answers[dom]:undefined;
      if(!r.ok||!ips) return `<td class="cell-fail">FAIL</td>`;
      const txt=ips.length?ips.join('<br>'):'пусто (NXDOMAIN?)';
      const cls=r.diff?'cell-diff':'';
      return `<td class="${cls}">${txt}</td>`;
    }).join('');
    table.appendChild(tr);
  });
  wrap.innerHTML=''; wrap.appendChild(table);
  if(verdict){
    verdict.innerHTML='';
    const notes=ni.dnsVerdict?.notes||[];
    if(!notes.length){ const li=document.createElement('li'); li.textContent='Все резолверы отвечают согласованно, подмены DNS не видно.'; verdict.appendChild(li); }
    else notes.forEach(n=>{ const li=document.createElement('li'); li.textContent=n; verdict.appendChild(li); });
  }
}
function renderNetInfo(){
  const grid=document.getElementById('net-grid');
  const badge=document.getElementById('net-badge');
  if(!grid) return;
  // Не затираем историю: только читаем отдельный ключ netInfo.
  const ni = netInfo || lastCheck?.netInfo || null;
  const conn = (typeof navigator !== 'undefined' && navigator.connection) || {};
  const localTxt = (typeof navigator !== 'undefined')
    ? `${navigator.onLine ? 'Адаптер подключён' : 'Адаптер ОТКЛЮЧЁН'}${conn.effectiveType ? ' · ' + conn.effectiveType : ''}${conn.downlink ? ' · ↓' + conn.downlink + ' Мбит/с' : ''}${conn.rtt != null ? ' · RTT ' + conn.rtt + ' мс' : ''}`
    : '';
  if(!ni){
    if(badge){ badge.textContent = (typeof navigator !== 'undefined' && !navigator.onLine) ? 'OFFLINE' : 'Сбор…'; }
    grid.innerHTML = `<span class="hint">Сбор данных о соединении… ${localTxt} Если висит долго — перезагрузите расширение на chrome://extensions и нажмите «Проверить сейчас».</span>`;
    return;
  }
  if(badge){ badge.textContent = ni.online ? 'ONLINE' : 'OFFLINE'; badge.style.background = ni.online ? '#10b981' : '#ef4444'; badge.style.color = '#fff'; }
  const dns = ni.dns || [];
  const cell=(label,val,sub,cls='')=>`<div class="net-item"><div class="label">${label}</div><div class="val ${cls}">${val}</div><div class="sub">${sub}</div></div>`;
  grid.innerHTML =
    cell('Внешний IP', ni.publicIp || '—', [ni.loc, ni.colo].filter(Boolean).join(' · ') || 'локация неизвестна') +
    cell('До Cloudflare (trace)', ni.traceMs != null ? ni.traceMs + ' мс' : 'недоступно', 'IP → CDN edge', ni.traceMs != null ? 'ok' : 'bad') +
    dns.map(d => cell(d.name, (d.ok ? d.ms + ' мс' : 'FAIL') + (d.diff ? ' ⚠' : ''), d.target, d.ok ? 'ok' : 'bad')).join('') +
    cell('Локальный статус', (typeof navigator !== 'undefined' && navigator.onLine) ? 'подключён' : 'отключён', localTxt);
  const note=document.getElementById('net-note');
  if(note) note.textContent = `Обновлено ${fmtTime(ni.at)} · автообновление при смене сетевого статуса (online/offline, смена адаптера).`;
}
function exportJSON(){ const blob=new Blob([JSON.stringify({history,pingLog,exportedAt:Date.now()},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='net-regime-history.json'; a.click(); }
function exportCSV(){ const header=['at','iso','group','name','url','ok','status','latency','error']; const rows=pingLog.map(p=>[p.at,new Date(p.at).toISOString(),p.group,'"'+(p.name||'').replace(/"/g,'""')+'"', '"'+p.url+'"',p.ok?1:0,p.status||'',p.latency||'', '"'+(p.error||'').replace(/"/g,'""')+'"'].join(',')); const csv=[header.join(','),...rows].join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='net-regime-pings.csv'; a.click(); }
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    btn.classList.add('active'); document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    document.getElementById('page-title').textContent={overview:'Дашборд доступности',history:'Журнал пингов',sites:'Сайты',correlations:'Корреляции',dns:'DNS-серверы'}[btn.dataset.tab];
  }));
  document.getElementById('range-select').addEventListener('change',e=>{ rangeN=Number(e.target.value); renderAll(); });
  document.getElementById('corr-group-filter').addEventListener('change',()=>renderAll());
  document.getElementById('filter-text').addEventListener('input',()=>renderHistoryTable(sliceHistory()));
  document.getElementById('filter-ok').addEventListener('change',()=>renderHistoryTable(sliceHistory()));
  document.querySelectorAll('#tbl-history th[data-sort]').forEach(th=>th.addEventListener('click',()=>{
    const k=th.dataset.sort; if(historySort.key===k) historySort.dir=historySort.dir==='asc'?'desc':'asc'; else { historySort.key=k; historySort.dir=k==='at'?'desc':'asc'; } renderHistoryTable(sliceHistory());
  }));
  document.querySelectorAll('#tbl-sites th[data-sort]').forEach(th=>th.addEventListener('click',()=>{
    const k=th.dataset.sort; if(sitesSort.key===k) sitesSort.dir=sitesSort.dir==='asc'?'desc':'asc'; else { sitesSort.key=k; sitesSort.dir='desc'; } renderSites(sliceHistory());
  }));
  document.getElementById('btn-refresh').addEventListener('click',fetchData);
  document.getElementById('btn-check').addEventListener('click', async ()=>{
    // Та же проверка, что и кнопка «Проверить сейчас» в popup расширения.
    const btn=document.getElementById('btn-check');
    btn.disabled=true; const oldText=btn.textContent; btn.textContent='Проверяем…';
    try{
      const res=await chrome.runtime.sendMessage({type:'run-check'});
      if(res){ lastCheck=res; if(res.netInfo) netInfo=res.netInfo; renderAll(); }
      else fetchData();
    }catch(e){ fetchData(); }
    finally{ btn.disabled=false; btn.textContent=oldText; }
  });
  document.getElementById('btn-clear').addEventListener('click',()=>{
    if(!confirm('Очистить всю историю пингов?')) return;
    chrome.storage.local.set({history:[],pingLog:[]},()=>fetchData());
    try{ chrome.runtime.sendMessage({type:'clear-history'},()=>fetchData()); }catch(e){}
  });
  document.getElementById('btn-export-json').addEventListener('click',exportJSON);
  document.getElementById('btn-export-csv').addEventListener('click',exportCSV);
  // DNS: добавление/удаление провайдеров и доменов (настройки живут в storage, БД истории не трогаем)
  document.getElementById('dns-add').addEventListener('click',()=>{
    const name=document.getElementById('dns-new-name').value.trim();
    const target=document.getElementById('dns-new-target').value.trim();
    let doh=document.getElementById('dns-new-doh').value.trim();
    const kind=document.getElementById('dns-new-kind').value;
    if(!doh){ alert('Укажите DoH URL'); return; }
    if(!/^https:\/\//.test(doh)){ alert('DoH URL должен начинаться с https://'); return; }
    (dnsConfig.providers=dnsConfig.providers||[]).push({id:'dns_'+Date.now(), name:name||doh, target, doh, kind, enabled:true});
    document.getElementById('dns-new-name').value=''; document.getElementById('dns-new-target').value=''; document.getElementById('dns-new-doh').value='';
    saveDnsConfig();
  });
  document.getElementById('dns-domain-add').addEventListener('click',()=>{
    const v=document.getElementById('dns-domain-new').value.trim().toLowerCase();
    if(!v) return;
    dnsConfig.domains=dnsConfig.domains||[];
    if(!dnsConfig.domains.includes(v)) dnsConfig.domains.push(v);
    document.getElementById('dns-domain-new').value='';
    saveDnsConfig();
  });
  document.addEventListener('click',e=>{
    const t=e.target.closest&&e.target.closest('[data-dns-del]');
    if(t){ dnsConfig.providers=(dnsConfig.providers||[]).filter(p=>p.id!==t.getAttribute('data-dns-del')); saveDnsConfig(); return; }
    const dd=e.target.closest&&e.target.closest('[data-domain-del]');
    if(dd){ dnsConfig.domains=(dnsConfig.domains||[]).filter(d=>d!==dd.getAttribute('data-domain-del')); saveDnsConfig(); return; }
  });
  document.addEventListener('change',e=>{
    const t=e.target.closest&&e.target.closest('[data-dns-toggle]');
    if(t){ const p=(dnsConfig.providers||[]).find(x=>x.id===t.getAttribute('data-dns-toggle')); if(p){ p.enabled=t.checked; saveDnsConfig(); } }
  });
  // Мгновенные обновления от background (раньше дашборд их игнорировал — отсюда «вечный сбор»)
  try{
    chrome.runtime.onMessage.addListener(msg=>{
      if(msg.type==='netinfo-updated'&&msg.netInfo){ netInfo=msg.netInfo; renderNetInfo(); renderDnsTab(); }
      if(msg.type==='check-updated'&&msg.record){ lastCheck=msg.record; if(msg.record.netInfo){ netInfo=msg.record.netInfo; renderNetInfo(); renderDnsTab(); } }
    });
  }catch(e){}
  loadDnsConfig();
  fetchData(); setInterval(fetchData,8000);
  try{ if(chrome.storage&&chrome.storage.onChanged) chrome.storage.onChanged.addListener((ch,area)=>{ if(area==='local'&&(ch.history||ch.pingLog||ch.lastCheck||ch.netInfo)){ if(ch.netInfo?.newValue) netInfo=ch.netInfo.newValue; if(ch.lastCheck?.newValue?.netInfo) netInfo=ch.lastCheck.newValue.netInfo; fetchData(); } }); }catch(e){}
  // Автообновление при смене сетевого статуса компьютера
  const onNetChange = () => { renderNetInfo(); try{ chrome.runtime.sendMessage({type:'network-changed'}, res=>{ if(res){ lastCheck=res; if(res.netInfo) netInfo=res.netInfo; } fetchData(); }); }catch(e){} };
  window.addEventListener('online', onNetChange);
  window.addEventListener('offline', onNetChange);
  try{ if(navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', onNetChange); }catch(e){}
  document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('button'); if(b&&b.textContent==='Показать'&&b.nextElementSibling){ const d=b.nextElementSibling; d.style.display=d.style.display==='none'?'block':'none'; }});
});
