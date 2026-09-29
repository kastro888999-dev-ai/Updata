/* ================= Visor/editor de código (Java, HTML, Python) ================= */
/* Resaltado de sintaxis propio (sin librerías) + edición directa en el visor */

const CODE_KEYWORDS = {
  java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yield true false null".split(" "),
  python: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self match case".split(" ")
};

function escapeHtmlCode(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* --- resaltadores por lenguaje: devuelven HTML seguro --- */
/* codifica el índice del token en letras (sin dígitos) para que las pasadas
   posteriores (números, keywords) no corrompan los marcadores */
function tokenKey(i) {
  return "\u0001" + String(i).split("").map(d => String.fromCharCode(0x51 + +d)).join("") + "\u0001";
}
function tokenIndex(key) {
  return parseInt(key.split("").map(c => String(c.charCodeAt(0) - 0x51)).join(""), 10);
}

function highlightJavaPython(src, lang) {
  const kw = CODE_KEYWORDS[lang];
  const tokens = [];
  const protect = html => { tokens.push(html); return tokenKey(tokens.length - 1); };
  let out = escapeHtmlCode(src);

  // strings y comentarios primero (protegidos)
  if (lang === "python") {
    out = out
      .replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, m => protect('<span class="tok-str">' + m + "</span>"))
      .replace(/(#.*)$/gm, m => protect('<span class="tok-com">' + m + "</span>"));
  } else {
    out = out
      .replace(/(\/\*[\s\S]*?\*\/)/g, m => protect('<span class="tok-com">' + m + "</span>"))
      .replace(/(\/\/.*)$/gm, m => protect('<span class="tok-com">' + m + "</span>"));
  }
  out = out
    .replace(/(&quot;|")((?:\\.|(?!\1)[^\\\n])*)\1/g, m => protect('<span class="tok-str">' + m + "</span>"))
    .replace(/('(?:\\.|[^'\\\n])*')/g, m => protect('<span class="tok-str">' + m + "</span>"));

  // números (protegidos para que las siguientes pasadas no toquen el HTML generado)
  out = out.replace(/\b(\d+(?:\.\d+)?[fLd]?)\b/g, m => protect('<span class="tok-num">' + m + "</span>"));
  // anotaciones java / decoradores python
  out = out.replace(/(^|\s)(@\w+)/g, (m, pre, dec) => pre + protect('<span class="tok-dec">' + dec + "</span>"));
  // palabras clave
  const kwRe = new RegExp("\\b(" + kw.join("|") + ")\\b", "g");
  out = out.replace(kwRe, m => protect('<span class="tok-kw">' + m + "</span>"));
  // restaurar protegidos (pueden estar anidados: repetir hasta que no queden)
  while (/\u0001[Q-Z]+\u0001/.test(out)) {
    out = out.replace(/\u0001([Q-Z]+)\u0001/g, (m, key) => tokens[tokenIndex(key)]);
  }
  return out;
}

function highlightHtml(src) {
  const tokens = [];
  const protect = html => { tokens.push(html); return tokenKey(tokens.length - 1); };
  let out = escapeHtmlCode(src);
  // comentarios
  out = out.replace(/(&lt;!--[\s\S]*?--&gt;)/g, m => protect('<span class="tok-com">' + m + "</span>"));
  // etiquetas con atributos
  out = out.replace(/(&lt;\/?)([\w-]+)([^&]*?)(\/?&gt;)/g, (m, open, tag, attrs, close) => {
    const attrsHl = attrs.replace(/([\w-]+)(=)(&quot;[^&]*?&quot;|'[^']*?')/g,
      '<span class="tok-attr">$1</span>$2<span class="tok-str">$3</span>');
    return protect('<span class="tok-kw">' + open + tag + "</span>" + attrsHl + '<span class="tok-kw">' + close + "</span>");
  });
  while (/\u0001[Q-Z]+\u0001/.test(out)) {
    out = out.replace(/\u0001([Q-Z]+)\u0001/g, (m, key) => tokens[tokenIndex(key)]);
  }
  return out;
}

function highlightCode(src, lang) {
  if (lang === "html") return highlightHtml(src);
  return highlightJavaPython(src, lang);
}

/* --- render en el visor: bloque editable con resaltado (por documento) --- */
function buildCodeBlock(source, lang, syncTa) {
  // documento asociado a este bloque (para actualizar el contador de líneas)
  const doc = (typeof dataDocs !== "undefined") ? dataDocs.find(d => d.ta === syncTa) : null;
  const wrap = document.createElement("div");
  const bar = document.createElement("div");
  bar.className = "code-bar";
  const label = document.createElement("span");
  label.className = "code-lang";
  label.textContent = lang.toUpperCase();
  const hint = document.createElement("span");
  hint.className = "code-hint";
  hint.textContent = "Editable: haz clic y escribe. Los cambios se reflejan en la entrada.";
  bar.appendChild(label);
  bar.appendChild(hint);
  wrap.appendChild(bar);

  const pre = document.createElement("pre");
  pre.className = "code-view";
  const codeEl = document.createElement("code");
  codeEl.contentEditable = "plaintext-only" in document.createElement("div") ? "plaintext-only" : "true";
  try { codeEl.contentEditable = "plaintext-only"; } catch (e) { codeEl.contentEditable = "true"; }
  codeEl.spellcheck = false;
  codeEl.innerHTML = highlightCode(source, lang);
  pre.appendChild(codeEl);

  const editor = document.createElement("div");
  editor.className = "code-editor";
  const gutter = document.createElement("div");
  gutter.className = "code-gutter";
  gutter.setAttribute("aria-hidden", "true");
  editor.appendChild(gutter);
  editor.appendChild(pre);
  wrap.appendChild(editor);

  const updateGutter = () => {
    setGutterLines(gutter, codeEl.innerText.split("\n").length);
    gutter.scrollTop = pre.scrollTop;
  };
  updateGutter();
  pre.addEventListener("scroll", updateGutter);

  // edición: sincronizar con el textarea de su documento y re-resaltar al pausar
  let timer = null;
  codeEl.addEventListener("input", () => {
    const text = codeEl.innerText;
    if (syncTa) syncTa.value = text;
    if (doc) refreshDocLineCount(doc);
    updateGutter();
    clearTimeout(timer);
    timer = setTimeout(() => {
      const sel = window.getSelection();
      let offset = 0;
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const preRange = range.cloneRange();
        preRange.selectNodeContents(codeEl);
        preRange.setEnd(range.endContainer, range.endOffset);
        offset = preRange.toString().length;
      }
      codeEl.innerHTML = highlightCode(text, lang);
      restoreCursor(codeEl, offset);
      updateGutter();
      statusEl.textContent = lang.toUpperCase() + " · " + text.split("\n").length + " líneas · editable";
    }, 600);
  });
  return wrap;
}

function renderCode(source, lang, syncTa) {
  viewer.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.id = "viewerContent";
  wrap.style.zoom = appZoom;
  wrap.appendChild(buildCodeBlock(source, lang, syncTa));
  viewer.appendChild(wrap);
  statusEl.textContent = lang.toUpperCase() + " · " + source.split("\n").length + " líneas · editable";
}

function restoreCursor(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node, count = 0;
  while ((node = walker.nextNode())) {
    const next = count + node.length;
    if (offset <= next) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(node, Math.max(0, offset - count));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    count = next;
  }
}

function isCodeFormat(fmt) {
  return fmt === "java" || fmt === "html" || fmt === "python";
}

function serializeCodeView() {
  const codeEl = viewer.querySelector(".code-view code");
  return codeEl ? codeEl.innerText : "";
}
