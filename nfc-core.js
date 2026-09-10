(() => {
  "use strict";
  const E = new TextEncoder();
  const AUDIT = "chachanfc_nfc_audit_v2";
  const BACKUP = "chachanfc_nfc_backup_v2";
  const b = d => {
    if (!d) return new Uint8Array();
    if (typeof d === "string") return E.encode(d);
    try { return new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice(); }
    catch { try { return new Uint8Array(d); } catch { return new Uint8Array(); } }
  };
  const b64 = d => { let s=""; b(d).forEach(x => s += String.fromCharCode(x)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s || ""), c => c.charCodeAt(0));
  const text = (d, enc="utf-8") => { try { return new TextDecoder(enc || "utf-8").decode(b(d)); } catch { return ""; } };
  const json = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? fallback; } catch { return fallback; } };
  const put = (k,v) => localStorage.setItem(k, JSON.stringify(v));
  const id = () => crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const token = () => { const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789", x=new Uint8Array(8); crypto.getRandomValues(x); return Array.from(x,n=>a[n%a.length]).join(""); };
  const esc = v => encodeURIComponent(String(v ?? "").trim());
  const unesc = v => { try { return decodeURIComponent(v || ""); } catch { return v || ""; } };

  function item(init, meta={}) {
    const data = b(init.data);
    return {
      key: meta.key || id(), kind: meta.kind || "raw", title: meta.title || init.recordType || "NDEF",
      preview: meta.preview ?? text(data, init.encoding || "utf-8"), recordType: init.recordType || "unknown",
      mediaType: init.mediaType || "", recordId: init.id || "", encoding: init.encoding || "", lang: init.lang || "",
      dataBase64: b64(data),
    };
  }
  function fromRecord(r, i=0) {
    let p=text(r.data, r.encoding || "utf-8").replace(/\s+/g," ").trim();
    if (!p) p=`${b(r.data).byteLength} byte(s)`; if (p.length>180) p=`${p.slice(0,177)}…`;
    return item({recordType:r.recordType||"unknown",mediaType:r.mediaType||"",id:r.id||"",encoding:r.encoding||"",lang:r.lang||"",data:b(r.data)}, {title:`Registro ${i+1} · ${r.recordType||"unknown"}`,preview:p,kind:"scan"});
  }
  function toInit(x) {
    const r={recordType:x.recordType||"unknown"};
    if (r.recordType!=="empty") r.data=unb64(x.dataBase64);
    if(x.mediaType)r.mediaType=x.mediaType;if(x.recordId)r.id=x.recordId;if(x.encoding)r.encoding=x.encoding;if(x.lang)r.lang=x.lang;
    return r;
  }
  const sig = x => [x.recordType||"",x.mediaType||"",x.recordId||"",x.encoding||"",x.lang||"",x.dataBase64||""].join("|");
  function same(a,bx){if(a.length!==bx.length)return false;const m=l=>{const x=new Map();l.forEach(i=>x.set(sig(i),(x.get(sig(i))||0)+1));return x},A=m(a),B=m(bx);if(A.size!==B.size)return false;for(const[k,v]of A)if(B.get(k)!==v)return false;return true;}
  const dataBytes = list => list.reduce((s,x)=>s+unb64(x.dataBase64).byteLength,0);
  async function fingerprint(list){if(!crypto.subtle)return"indisponível";const d=await crypto.subtle.digest("SHA-256",E.encode(list.map(sig).join("\n")));return Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();}
  function parseEvcs(x){if(x.recordType!=="text")return null;const t=text(unb64(x.dataBase64),x.encoding||"utf-8").trim();if(!/^EVCS[12]\|/.test(t))return null;const p=t.split("|"),o={version:p.shift()};p.forEach(z=>{const i=z.indexOf("=");if(i>0)o[z.slice(0,i)]=unesc(z.slice(i+1));});return o;}
  function audit(action,d={}){const h=json(AUDIT,[]);h.unshift({at:new Date().toISOString(),action,...d});put(AUDIT,h.slice(0,200));window.dispatchEvent(new Event("chachanfc:nfc-audit"));}
  const history=()=>json(AUDIT,[]);
  const saveBackup=(uid,records,source="studio")=>put(BACKUP,{uid:uid||"",capturedAt:new Date().toISOString(),records,source});
  const backup=()=>json(BACKUP,null);

  async function read(timeout=30000){
    if(!("NDEFReader"in window))throw new DOMException("Web NFC indisponível.","NotSupportedError");
    if(!window.isSecureContext)throw new DOMException("Abra a versão HTTPS publicada.","SecurityError");
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
    try{const r=new NDEFReader();await r.scan({signal:c.signal});return await new Promise((resolve,reject)=>{let done=false;const f=(fn,v)=>{if(done)return;done=true;fn(v)};r.addEventListener("reading",e=>f(resolve,e),{once:true});r.addEventListener("readingerror",()=>f(reject,new Error("Tag detectada, mas o NDEF não pôde ser lido.")),{once:true});c.signal.addEventListener("abort",()=>f(reject,new DOMException("Tempo esgotado.","AbortError")),{once:true});});}finally{clearTimeout(timer);if(!c.signal.aborted)c.abort();}
  }
  function err(e){const n=e?.name||"Erro";let m=e?.message||"Falha na operação.";if(n==="NotAllowedError")m="Permissão NFC negada.";if(n==="AbortError")m="Tempo esgotado ou leitura cancelada.";if(n==="NetworkError")m="Mantenha a tag encostada.";if(n==="NotSupportedError")m="Operação não suportada neste navegador/tag.";return`${n}: ${m}`;}
  async function writeVerify(expected,status=()=>{},ctx={}){status("Encoste a tag para gravar…","info");const w=new NDEFReader();await w.write({records:expected.map(toInit)},{overwrite:true});status("Gravado. Aproxime novamente a MESMA tag para verificar…","info");const e=await read(),got=Array.from(e.message.records||[]).map(fromRecord);if(!same(got,expected))throw new Error("A verificação final não corresponde ao pacote preparado.");const fp=await fingerprint(got);audit("write-verified",{uid:e.serialNumber||ctx.uid||"",records:got.length,fingerprint:fp,token:ctx.token||"",summary:ctx.summary||"Gravação verificada"});return{event:e,items:got,fingerprint:fp};}

  const textRecord=(value,title="Texto",kind="text")=>item({recordType:"text",data:value,encoding:"utf-8",lang:"pt-BR"},{title,preview:value,kind});
  const urlRecord=(value,title="Link")=>item({recordType:"url",data:value},{title,preview:value,kind:"url"});
  function evcsPackage({entity,ref,label,token:tk,base="https://laboratorio-evcs.web.app/?nfc="}){const t=tk||token(),name=label||ref,meta=`EVCS2|type=${esc(entity)}|ref=${esc(ref)}|token=${esc(t)}|label=${esc(name)}`;return{token:t,records:[textRecord(meta,`EvCS · ${entity} · ${name}`,"evcs"),urlRecord(`${base}${encodeURIComponent(t)}`,`Link dinâmico EvCS · ${t}`)]};}

  window.ChachaNfcCore=Object.freeze({AUDIT,BACKUP,b,unb64,text,json,put,id,token,item,fromRecord,toInit,sig,same,dataBytes,fingerprint,parseEvcs,audit,history,saveBackup,backup,read,err,writeVerify,textRecord,urlRecord,evcsPackage});
})();
