const WEBAPP_URL = "https://render-bling-api.onrender.com";
const API_KEY = "OCULTADO";

function fetchViaBackground(url, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "bling_fetch", url, options }, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response) { reject(new Error("Sem resposta do background.")); return; }
      if (!response.ok) { reject(new Error(response.error || "Erro no fetch.")); return; }
      resolve({ status: response.status, text: async () => response.text });
    });
  });
}

const PATH_OK = ["/vendas.checkout.php", "/b/vendas.checkout.php"];
if (PATH_OK.includes(window.location.pathname)) iniciarExtensao();

function iniciarExtensao() {
  if (document.getElementById("botao-localizacao")) return;

  let painelVisivel = false;
  let ultimoCodigoBuscado = "";
  let toastTimer = null;
  window.blingLocProdutoAtual = { id:"", codigo:"", ean:"" };

  const PAINEL_MIN_W = 640, PAINEL_MIN_H = 560;
  const PAINEL_INIT_W = 760, PAINEL_INIT_H = 600;
  const SK_BOTAO = "bling_loc_botao_v3", SK_PAINEL = "bling_loc_painel_v5";

  let drag = null;
  let botaoDrag = null;

  function clamp(v,a,b){ return Math.min(Math.max(v,a),b); }
  function getRect(el) { return el.getBoundingClientRect(); }
  function applyPos(el, l, t) { el.style.left=l+"px"; el.style.top=t+"px"; el.style.right="auto"; el.style.bottom="auto"; }
  function salvar(key, obj) { localStorage.setItem(key, JSON.stringify(obj)); }
  function carregar(key) { try { return JSON.parse(localStorage.getItem(key)); } catch{ return null; } }

  function posicionarBotao() {
    const d = carregar(SK_BOTAO);
    if (d && d.left) { botao.style.left=d.left; botao.style.top=d.top; botao.style.right="auto"; botao.style.bottom="auto"; }
    else { botao.style.right="18px"; botao.style.bottom="18px"; botao.style.left="auto"; botao.style.top="auto"; }
  }

  function posicionarPainel() {
    const d = carregar(SK_PAINEL);
    if (d && d.width) {
      painel.style.left = d.left; painel.style.top = d.top;
      painel.style.width = Math.max(parseInt(d.width)||0, PAINEL_MIN_W)+"px";
      painel.style.height = Math.max(parseInt(d.height)||0, PAINEL_MIN_H)+"px";
      painel.style.right="auto"; painel.style.bottom="auto";
    } else {
      const vw=innerWidth, vh=innerHeight;
      const w=clamp(PAINEL_INIT_W,PAINEL_MIN_W,vw-12);
      const h=clamp(PAINEL_INIT_H,PAINEL_MIN_H,vh-12);
      painel.style.width=w+"px"; painel.style.height=h+"px";
      painel.style.left=Math.max(0,vw-8-w)+"px"; painel.style.top="22px";
      painel.style.right="auto"; painel.style.bottom="auto";
    }
    const pw = parseInt(painel.style.width);
    const ph = parseInt(painel.style.height);
    if (pw < PAINEL_MIN_W) painel.style.width = PAINEL_MIN_W+"px";
    if (ph < PAINEL_MIN_H) painel.style.height = PAINEL_MIN_H+"px";
  }

  function mostrarToast(msg, ok) {
    const t = document.getElementById("blg-toast-interno");
    if (!t) return;
    t.textContent = msg;
    t.style.background = ok ? "#1b5e20" : "#b71c1c";
    t.style.color = "#fff";
    t.style.display = "block";
    t.style.padding = "8px 12px";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display="none"; t.style.padding="0"; }, 2500);
  }

  function tocarSom(tipo) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx=new Ctx(), osc=ctx.createOscillator(), gain=ctx.createGain();
      if (tipo==="ok") {
        osc.type="sine"; osc.frequency.setValueAtTime(880,ctx.currentTime); osc.frequency.setValueAtTime(1100,ctx.currentTime+0.12);
        gain.gain.setValueAtTime(0.001,ctx.currentTime); gain.gain.linearRampToValueAtTime(0.15,ctx.currentTime+0.02); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);
        osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+0.3);
      } else {
        osc.type="sawtooth"; osc.frequency.setValueAtTime(300,ctx.currentTime); osc.frequency.linearRampToValueAtTime(100,ctx.currentTime+0.4);
        gain.gain.setValueAtTime(0.001,ctx.currentTime); gain.gain.linearRampToValueAtTime(0.18,ctx.currentTime+0.03); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
        osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+0.4);
      }
    } catch(e) {}
  }

  function marcarCodigo(tipo) {
    const c=document.getElementById("blg-codigo"); if (!c) return;
    if (tipo==="ok") { c.style.borderColor="#2e7d32"; c.style.background="#f0fff4"; }
    else if (tipo==="erro") { c.style.borderColor="#c62828"; c.style.background="#fff5f5"; }
    else { c.style.borderColor="#ccc"; c.style.background="#fff"; }
  }

  function setMsg(msg, ok, toast) {
    const el=document.getElementById("blg-msg-img"); if (!el) return;
    el.textContent=msg;
    el.style.color = ok ? "#1b5e20" : "#b71c1c";
    el.style.background = msg ? (ok ? "rgba(240,255,244,0.95)" : "rgba(255,245,245,0.95)") : "transparent";
    el.style.padding = msg ? "6px 8px" : "0";
    if (toast && msg) { mostrarToast(msg, ok); tocarSom(ok ? "ok" : "erro"); }
  }

  function clearProduto() {
    ["blg-titulo","blg-sku","blg-ean","blg-estoque","blg-local","blg-nova"].forEach(id => {
      const el=document.getElementById(id);
      if (el) { if (el.tagName==="INPUT") el.value=""; else el.textContent=""; }
    });
    window.blingLocProdutoAtual={id:"",codigo:"",ean:""};
    const img=document.getElementById("blg-img");
    const wrap=document.getElementById("blg-img-wrap");
    const ph=document.getElementById("blg-img-ph");
    if (img) { img.src=""; img.style.display="none"; }
    if (wrap) wrap.style.display="none";
    if (ph) ph.style.display="flex";
    const semImgEl = document.getElementById("blg-sem-imagem-txt");
    if (semImgEl) semImgEl.style.display="none";
  }

  function limparTudo() {
    clearProduto();
    const c=document.getElementById("blg-codigo"); if (c) c.value="";
    marcarCodigo(""); setMsg("",true,false);
    if (c) c.focus();
  }

  function preencherProduto(p) {
    const titulo=document.getElementById("blg-titulo"); if (titulo) titulo.textContent=p.nome||"";
    const sku=document.getElementById("blg-sku"); if (sku) sku.value=p.codigo||"";
    const ean=document.getElementById("blg-ean"); if (ean) ean.value=p.ean||"";
    const est=document.getElementById("blg-estoque"); if (est) est.value=p.estoque??"";
    const loc=document.getElementById("blg-local"); if (loc) loc.value=p.localizacao||"";
    window.blingLocProdutoAtual={id:p.id||"",codigo:p.codigo||"",ean:p.ean||""};
    const img=document.getElementById("blg-img");
    const wrap=document.getElementById("blg-img-wrap");
    const ph=document.getElementById("blg-img-ph");
    if (p.imagem) {
      img.src=p.imagem; img.style.display="block";
      wrap.style.display="flex"; ph.style.display="none";
    } else {
      if (img) { img.src=""; img.style.display="none"; }
      if (wrap) wrap.style.display="none";
      if (ph) ph.style.display="flex";
      // mostra "Sem imagem" só quando produto foi buscado
      const semImg = document.getElementById("blg-sem-imagem-txt");
      if (semImg) semImg.style.display="block";
    }
  }

  function getCodigo() { return (document.getElementById("blg-codigo")?.value||"").trim(); }

  async function consultarProduto(tipo, codigo) {
    const url=`${WEBAPP_URL}/buscar?key=${encodeURIComponent(API_KEY)}&tipo=${tipo}&codigo=${encodeURIComponent(codigo)}&_=${Date.now()}`;
    const resp=await fetchViaBackground(url,{method:"GET",cache:"no-store"});
    const txt=await resp.text();
    if (txt.trim().startsWith("<!") || txt.trim().startsWith("<html")) throw new Error("Erro no Web App.");
    return JSON.parse(txt);
  }

  // ===== BOTÃO =====
  const botao = document.createElement("div");
  botao.id = "botao-localizacao";
  botao.innerHTML = "Localização Estoque";
  botao.style.cssText = "background:#1b5e20;color:#fff;font-size:13px;font-weight:700;padding:10px 24px;border-radius:10px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3);white-space:nowrap;min-width:160px;text-align:center;user-select:none;position:fixed;z-index:2147483645;";
  document.body.appendChild(botao);

  // ===== PAINEL =====
  const painel = document.createElement("div");
  painel.id = "blg-panel";
  painel.innerHTML = `
    <div id="blg-topbar">
      <span style="color:#fff;font-weight:700;font-size:14px;">Atualizar Localização</span>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:11px;color:rgba(255,255,255,.7);">Arraste pelo topo para mover</span>
        <button id="blg-close">✕</button>
      </div>
    </div>
    <div id="blg-body">
      <div id="blg-col-img">
        <div id="blg-toast-interno" style="display:none;position:absolute;top:8px;left:8px;right:8px;z-index:10;border-radius:8px;font-size:13px;font-weight:700;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.15);"></div>
        <div id="blg-img-wrap" style="display:none;width:100%;height:100%;align-items:center;justify-content:center;padding:10px;box-sizing:border-box;">
          <img id="blg-img" alt="produto" style="display:none;max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;" />
        </div>
        <div id="blg-img-ph" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
          <img src="data:image/png;base64,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+rrjc9XtUWOoplszOd3NsNJTzm0hIDiU7bLS46w34s4lXT5acHmGKDs8gdKKbu+9Op/mKh2dQZOdDnodfN0EqKr7H3cMaczVtmhoignA7C1PYgIwwPnqb1VlXqUAm4gAUYhKer68O8lb1VVkG1Lw8uHR6T4DkWyS9LqC4vo/dEM2xlWNxLXkkpmJSESY2UHBzMPG0P2wFu8qu0TSoirXbtaIMasYdGstc7bL4gYLIpvF5T/dW673mFghThX0LajgbCwOzWyesgGucSmLSNZ5a63ned7Km9zP77777ve///1jx451u133+nzXi8VitVp9/PHHn3zyyXq9bq0dmnlm/ud//ucXXnjBwU1E/X7/4x//+G/8xm8AJGI9jw8dOvSNb3y91+tnM0REURR98pOf/MxnPjO8T48IUBEF6Mc/fuX55785tHlJVT/zmc8888wz1lonU9/97nf/6Z/+yff963tW5XJ5Zmbm4x//+IEDBzzPc2PJL2WHuDHmwoULP/jBD955553FxcU4jjPnR1U9zyuVSnv27PnlX/7lPXv2GGOyOTMmLfO7crl5aLVaX/7yl7dv3x4EwfWnbnR09Kmnnnr55ZdVNUkSEbHWWmtFJEmST3/600P3P/300+12W1WjKFbVP/uz/7tqs/v377906ZJrM98394oksZ/73OdXffCzn/2sqkZxLCIi8qUvfWnthnrTpk1f+tKXzp07l40lPxwR+fa3v/3ggw+WSqXrtBMEwa5du/7oj/6o1+tlLThUkR+JiPT7/eeeey57vTHGGON5nud5Kz+727Zs2eKwjuPYWuvQieP4s5/9rDHG931jTBD4xphnn3222Wypar8/UNU//uP/w8xBELgGPc8LgsAYU61W33jjDddIXg5cy61We//+B4wxhULg+77rj3vwc5/7nKrGSeK68dxzzxlj3E/5i5mzz+7VmU745Cc/eenSpTzE1lpV/fa3v10ulzMJzaPhBui6kS2F3/md34miKHtc8xs0nGZ44YUX/vqv/9q14rRB9tbsxbJ8uRecOXPmD/7gD1qtljHGLVs3Scyczae16StFLABjGIDnkWsnL7PW2k6nc/To0WtJzenTp+bn5zJRc5hmHUtpq+XL/Zr1fOUosqeY2fO8F1544fnnn8/UoDNop06d+r3f+71Op+PwVdV8U3nxJyLf94noa1/72osvvpi5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" style="width:80px;height:80px;border-radius:50%;object-fit:cover;opacity:0.3;" />
          <div id="blg-sem-imagem-txt" style="font-size:11px;color:#bbb;margin-top:8px;display:none;">Sem imagem</div>
        </div>
        <div id="blg-msg-img"></div>
      </div>
      <div id="blg-col-form">
        <div class="blg-lbl">🔍 Buscar SKU ou EAN</div>
        <input id="blg-codigo" type="text" autocomplete="off" placeholder="Bipar ou digitar..." />
        <div style="display:flex;gap:6px;margin-top:6px;align-items:stretch;">
          <button id="blg-buscar" class="blg-btn blg-blue" style="flex:2;height:42px;">Buscar</button>
          <button id="blg-refazer" class="blg-btn blg-ghost" style="flex:1;height:42px;font-size:12px;padding:0 8px;">↩ Último</button>
        </div>
        <div class="blg-lbl" style="margin-top:10px;">Título do produto</div>
        <div id="blg-titulo" class="blg-info-box"></div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <div style="flex:1;"><div class="blg-lbl">SKU</div><input id="blg-sku" type="text" disabled /></div>
          <div style="flex:1;"><div class="blg-lbl">EAN</div><input id="blg-ean" type="text" disabled /></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <div style="flex:1;"><div class="blg-lbl">Estoque</div><input id="blg-estoque" type="text" disabled /></div>
          <div style="flex:1;"><div class="blg-lbl">Local atual</div><input id="blg-local" type="text" disabled /></div>
        </div>
        <button id="blg-copiar" class="blg-btn blg-ghost" style="margin-top:8px;font-size:12px;height:42px;">📋 Copiar local atual</button>
        <div class="blg-lbl" style="margin-top:10px;">Nova localização</div>
        <input id="blg-nova" type="text" autocomplete="off" placeholder="Digite ou bipe..." />
        <button id="blg-salvar" class="blg-btn blg-green" style="margin-top:8px;height:42px;">✅ Salvar</button>
      </div>
    </div>
    <div class="blg-corner" id="blg-nw"></div>
    <div class="blg-corner" id="blg-ne"></div>
    <div class="blg-corner" id="blg-sw"></div>
    <div class="blg-corner" id="blg-se"></div>
  `;
  document.body.appendChild(painel);

  const css = document.createElement("style");
  css.textContent = `
    #blg-panel { position:fixed;z-index:2147483646;background:#fff;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;font-family:Arial,sans-serif; }
    #blg-topbar { background:#1b5e20;padding:10px 14px;flex-shrink:0;display:flex;justify-content:space-between;align-items:center;cursor:grab;user-select:none;-webkit-user-select:none; }
    #blg-topbar:active { cursor:grabbing; }
    #blg-close { background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:15px; }
    #blg-close:hover { background:rgba(255,255,255,.35); }
    #blg-body { display:flex;flex:1;overflow:hidden;min-height:0; }
    #blg-col-img { width:36%;flex-shrink:0;background:#f2f2f2;border-right:1px solid #e0e0e0;position:relative;overflow:hidden;min-width:180px; }
    #blg-img-ph { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center; }
    #blg-msg-img { position:absolute;bottom:0;left:0;right:0;height:50px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;text-align:center;padding:0 8px;box-sizing:border-box;transition:background .2s; }
    #blg-col-form { flex:1;overflow-y:scroll;padding:12px 14px;display:flex;flex-direction:column;min-width:280px; }
    .blg-lbl { font-size:11px;font-weight:700;color:#222;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px; }
    #blg-col-form input[type="text"] { width:100% !important;height:42px !important;padding:0 12px !important;box-sizing:border-box !important;border:1.5px solid #ccc !important;border-radius:8px !important;font-size:13px !important;color:#111 !important;background:#fff !important;outline:none !important;min-height:42px !important;max-height:42px !important; }
    #blg-col-form input[type="text"]:focus { border-color:#1b5e20 !important; }
    #blg-col-form input[disabled] { background:#f0f0f0 !important;color:#444 !important; }
    #blg-codigo { margin-top:4px; }
    #blg-titulo,.blg-info-box { font-size:13px;line-height:1.4;color:#111;background:#f0f0f0;border:1.5px solid #e0e0e0;border-radius:8px;padding:10px 12px;word-break:break-word;min-height:42px;max-height:64px;overflow-y:auto;box-sizing:border-box; }
    .blg-btn { width:100%;padding:8px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s; }
    .blg-btn:active { opacity:.85;transform:scale(.98); }
    .blg-blue { background:#1565c0;color:#fff; }
    .blg-blue:hover { background:#1976d2; }
    .blg-green { background:#1b5e20;color:#fff; }
    .blg-green:hover { background:#2e7d32; }
    .blg-ghost { background:#f0f0f0;color:#333;border:1.5px solid #ddd; }
    .blg-ghost:hover { background:#e4e4e4; }
    .blg-corner { position:absolute;width:14px;height:14px;z-index:10; }
    #blg-nw { top:0;left:0;cursor:nw-resize;border-top:3px solid #1b5e20;border-left:3px solid #1b5e20;border-radius:12px 0 0 0; }
    #blg-ne { top:0;right:0;cursor:ne-resize;border-top:3px solid #1b5e20;border-right:3px solid #1b5e20;border-radius:0 12px 0 0; }
    #blg-sw { bottom:0;left:0;cursor:sw-resize;border-bottom:3px solid #1b5e20;border-left:3px solid #1b5e20;border-radius:0 0 0 12px; }
    #blg-se { bottom:0;right:0;cursor:se-resize;border-bottom:3px solid #1b5e20;border-right:3px solid #1b5e20;border-radius:0 0 12px 0; }
  `;
  document.head.appendChild(css);

  posicionarBotao();
  posicionarPainel();
  painel.style.display = "none";

  // ===== DRAG =====
  document.getElementById("blg-topbar").addEventListener("mousedown", e => {
    if (e.target.id==="blg-close") return;
    const r=getRect(painel);
    drag={tipo:"painel",startX:e.clientX,startY:e.clientY,startL:r.left,startT:r.top};
    document.body.style.userSelect="none"; e.preventDefault();
  });

  let resizeStart={};
  [["blg-nw","nw"],["blg-ne","ne"],["blg-sw","sw"],["blg-se","se"]].forEach(([id,dir]) => {
    document.getElementById(id).addEventListener("mousedown", e => {
      e.preventDefault(); e.stopPropagation();
      const r=getRect(painel);
      drag={tipo:"resize",dir,startX:e.clientX,startY:e.clientY,startW:r.width,startH:r.height,startL:r.left,startT:r.top};
      document.body.style.userSelect="none";
    });
  });

  botao.addEventListener("mousedown", e => {
    e.preventDefault();
    const r=getRect(botao);
    botaoDrag={startX:e.clientX,startY:e.clientY,startL:r.left,startT:r.top,moveu:false};
    document.body.style.userSelect="none";
  });

  document.addEventListener("mousemove", e => {
    if (drag?.tipo==="painel") {
      const dx=e.clientX-drag.startX, dy=e.clientY-drag.startY;
      applyPos(painel, clamp(drag.startL+dx,0,innerWidth-painel.offsetWidth), clamp(drag.startT+dy,0,innerHeight-painel.offsetHeight));
    }
    if (drag?.tipo==="resize") {
      const dx=e.clientX-drag.startX, dy=e.clientY-drag.startY;
      let w=drag.startW,h=drag.startH,l=drag.startL,t=drag.startT;
      if (drag.dir.includes("e")) w=clamp(drag.startW+dx,PAINEL_MIN_W,innerWidth-drag.startL);
      if (drag.dir.includes("s")) h=clamp(drag.startH+dy,PAINEL_MIN_H,innerHeight-drag.startT);
      if (drag.dir.includes("w")) { const nw=clamp(drag.startW-dx,PAINEL_MIN_W,drag.startL+drag.startW); l=drag.startL+drag.startW-nw; w=nw; }
      if (drag.dir.includes("n")) { const nh=clamp(drag.startH-dy,PAINEL_MIN_H,drag.startT+drag.startH); t=drag.startT+drag.startH-nh; h=nh; }
      w=Math.max(w,PAINEL_MIN_W); h=Math.max(h,PAINEL_MIN_H);
      painel.style.width=w+"px"; painel.style.height=h+"px"; applyPos(painel,l,t);
    }
    if (botaoDrag) {
      const dx=e.clientX-botaoDrag.startX, dy=e.clientY-botaoDrag.startY;
      if (Math.abs(dx)>3||Math.abs(dy)>3) botaoDrag.moveu=true;
      if (botaoDrag.moveu) applyPos(botao, clamp(botaoDrag.startL+dx,0,innerWidth-botao.offsetWidth), clamp(botaoDrag.startT+dy,0,innerHeight-botao.offsetHeight));
    }
  });

  document.addEventListener("mouseup", () => {
    if (drag) {
      const fw=Math.max(parseInt(painel.style.width)||0,PAINEL_MIN_W);
      const fh=Math.max(parseInt(painel.style.height)||0,PAINEL_MIN_H);
      painel.style.width=fw+"px"; painel.style.height=fh+"px";
      salvar(SK_PAINEL,{left:painel.style.left,top:painel.style.top,width:painel.style.width,height:painel.style.height});
      drag=null;
    }
    if (botaoDrag) {
      if (botaoDrag.moveu) {
        salvar(SK_BOTAO,{left:botao.style.left,top:botao.style.top,right:"auto",bottom:"auto"});
      } else {
        painelVisivel=!painelVisivel;
        painel.style.display=painelVisivel?"flex":"none";
        if (painelVisivel) { posicionarPainel(); setTimeout(()=>document.getElementById("blg-codigo")?.focus(),50); }
      }
      botaoDrag=null;
    }
    document.body.style.userSelect="auto";
  });

  document.getElementById("blg-close").addEventListener("click", ()=>{ painelVisivel=false; painel.style.display="none"; });

  // ===== BUSCAR =====
  async function buscarProduto() {
    const codigo=getCodigo();
    if (!codigo||codigo.length<3) { clearProduto(); marcarCodigo("erro"); setMsg("Digite ao menos 3 caracteres.",false,true); return; }
    clearProduto(); marcarCodigo(""); setMsg("Buscando...",true,false);
    try {
      const ordem=(/^\d{8,}$/.test(codigo))?["EAN","SKU"]:["SKU","EAN"];
      let data=null;
      for (const tipo of ordem) {
        data=await consultarProduto(tipo,codigo);
        if (data?.ok&&data?.produto) break;
      }
      if (!data?.ok||!data?.produto) { marcarCodigo("erro"); setMsg(data?.erro||"Produto não encontrado.",false,true); return; }
      ultimoCodigoBuscado=codigo;
      preencherProduto(data.produto);
      marcarCodigo("ok"); setMsg("Produto encontrado.",true,true);
      document.getElementById("blg-nova")?.focus();
    } catch(err) {
      marcarCodigo("erro"); setMsg("Erro ao buscar.",false,true);
    }
  }

  // ===== SALVAR =====
  async function salvarLocalizacao() {
    const codigo=window.blingLocProdutoAtual?.codigo||getCodigo();
    const novaLoc=(document.getElementById("blg-nova")?.value||"").trim();
    if (!codigo||codigo.length<2) { marcarCodigo("erro"); setMsg("Busque um produto antes.",false,true); return; }
    if (!novaLoc) {
      // Confirmação para salvar localização vazia (apagar)
      const confirmar = confirm("⚠️ O campo Nova Localização está vazio.\n\nDeseja salvar assim e APAGAR a localização atual?");
      if (!confirmar) { document.getElementById("blg-nova")?.focus(); return; }
    }
    setMsg("Salvando...",true,false);
    try {
      const resp=await fetchViaBackground(WEBAPP_URL+"/salvar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:API_KEY,action:"atualizar",codigo,novaLocalizacao:novaLoc})});
      const txt=await resp.text();
      if (txt.trim().startsWith("<!")) { setMsg("Erro no Web App.",false,true); return; }
      const data=JSON.parse(txt);
      if (!data.ok) { setMsg(data.erro||"Erro ao salvar.",false,true); return; }
      setMsg("Salvo com sucesso! ✓",true,true);
      document.getElementById("blg-col-form")?.scrollTo(0,0);
      setTimeout(()=>limparTudo(),200);
    } catch(err) {
      setMsg("Erro ao salvar.",false,true);
    }
  }

  // ===== EVENTOS =====
  document.getElementById("blg-buscar").addEventListener("click", buscarProduto);
  document.getElementById("blg-salvar").addEventListener("click", salvarLocalizacao);
  document.getElementById("blg-refazer").addEventListener("click", ()=>{
    if (!ultimoCodigoBuscado) { setMsg("Nenhuma busca anterior.",false,true); return; }
    clearProduto(); marcarCodigo(""); setMsg("",true,false);
    document.getElementById("blg-codigo").value=ultimoCodigoBuscado;
    buscarProduto();
  });
  document.getElementById("blg-copiar").addEventListener("click", ()=>{
    const v=document.getElementById("blg-local")?.value||"";
    const nova=document.getElementById("blg-nova");
    if (nova) { nova.value=v; nova.focus(); }
    setMsg("Local copiado.",true,true);
  });
  document.getElementById("blg-codigo").addEventListener("keydown", e=>{ if (e.key==="Enter") { e.preventDefault(); buscarProduto(); } });
  document.getElementById("blg-nova").addEventListener("keydown", e=>{ if (e.key==="Enter") { e.preventDefault(); salvarLocalizacao(); } });
  document.getElementById("blg-codigo").addEventListener("input", ()=>{ marcarCodigo(""); setMsg("",true,false); });
  window.addEventListener("resize", ()=>{ if (painelVisivel) { posicionarPainel(); salvar(SK_PAINEL,{left:painel.style.left,top:painel.style.top,width:painel.style.width,height:painel.style.height}); } });
}
