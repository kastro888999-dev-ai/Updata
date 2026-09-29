/* ================= Modo Markdown ================= */
function isMdMode() { return appMode === "md"; }

function enterMdMode() {
  // si aún no hay documentos Markdown, crea uno vacío para poder escribir
  if (!mdDocs.length) addDoc("md", "");
  // los documentos Markdown conservan su contenido; mostramos su vista previa
  renderMarkdownPreview();
}

function leaveMdMode() {
  // los documentos de Markdown conservan su contenido; no hay nada que restaurar
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* --- Mini renderizador Markdown (sin librerías, 100% local) --- */
function inlineMd(text) {
  let out = escapeHtml(text);
  // código en línea primero (protegido)
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
  out = out
    // color de letra: {color:#rrggbb}texto{/color}
    .replace(/\{color:(#[0-9a-fA-F]{6})\}([\s\S]*?)\{\/color\}/g, '<span style="color:$1">$2</span>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/\u0000(\d+)\u0000/g, (m, i) => "<code>" + codes[+i] + "</code>");
  return out;
}

function renderMarkdown(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let i = 0;
  let listStack = null; // "ul" | "ol"
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      html.push("<p>" + paraBuf.map(inlineMd).join("<br>") + "</p>");
      paraBuf = [];
    }
  };
  const closeList = () => {
    if (listStack) { html.push("</" + listStack + ">"); listStack = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // bloque de código ```
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara(); closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // saltar cierre
      html.push("<pre><code>" + escapeHtml(buf.join("\n")) + "</code></pre>");
      continue;
    }

    // tabla: línea con | seguida de separador |---|
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      flushPara(); closeList();
      const splitRow = r => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      const heads = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i])); i++;
      }
      let t = "<table><thead><tr>" + heads.map(h => "<th>" + inlineMd(h) + "</th>").join("") + "</tr></thead><tbody>";
      rows.forEach(r => {
        t += "<tr>" + heads.map((_, ci) => "<td>" + inlineMd(r[ci] !== undefined ? r[ci] : "") + "</td>").join("") + "</tr>";
      });
      t += "</tbody></table>";
      html.push(t);
      continue;
    }

    // encabezados
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(); closeList();
      const lvl = h[1].length;
      html.push("<h" + lvl + ">" + inlineMd(h[2]) + "</h" + lvl + ">");
      i++; continue;
    }

    // separador
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushPara(); closeList();
      html.push("<hr>");
      i++; continue;
    }

    // cita
    if (/^\s*>\s?/.test(line)) {
      flushPara(); closeList();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, "")); i++;
      }
      html.push("<blockquote>" + buf.map(inlineMd).join("<br>") + "</blockquote>");
      continue;
    }

    // listas (tareas, viñetas, numeradas)
    const task = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (task || ul || ol) {
      flushPara();
      const kind = ol ? "ol" : "ul";
      if (listStack !== kind) { closeList(); html.push("<" + kind + ">"); listStack = kind; }
      if (task) {
        const checked = task[1].toLowerCase() === "x" ? " checked" : "";
        html.push('<li><input type="checkbox" disabled' + checked + "> " + inlineMd(task[2]) + "</li>");
      } else {
        html.push("<li>" + inlineMd((ul || ol)[1]) + "</li>");
      }
      i++; continue;
    }

    // línea vacía = fin de párrafo
    if (line.trim() === "") {
      flushPara(); closeList();
      i++; continue;
    }

    // texto normal
    paraBuf.push(line);
    i++;
  }
  flushPara(); closeList();
  return html.join("\n");
}

function renderMarkdownPreview() {
  const prevScroll = viewer.scrollTop;
  viewer.innerHTML = "";
  if (!mdDocs.length) {
    viewer.innerHTML = '<div class="hint">No hay documentos Markdown. Usa ➕ Añadir para crear uno.</div>';
    statusEl.textContent = "MARKDOWN · sin documentos";
    return;
  }
  const wrap = document.createElement("div");
  wrap.id = "viewerContent";
  wrap.style.zoom = (typeof appZoom !== "undefined" ? appZoom : 1);
  viewer.appendChild(wrap);
  let count = 0;
  mdDocs.forEach(doc => {
    const text = doc.ta.value;
    if (!text.trim()) return;
    const section = document.createElement("div");
    section.className = "doc-view";
    const title = document.createElement("div");
    title.className = "doc-view-title";
    title.textContent = doc.name + " · Markdown";
    section.appendChild(title);
    const box = document.createElement("div");
    box.className = "md-preview";
    box.innerHTML = renderMarkdown(text);
    section.appendChild(box);
    wrap.appendChild(section);
    count++;
  });
  viewer.scrollTop = prevScroll;
  statusEl.textContent = "MARKDOWN · " + (count ? count + " documento(s)" : "vista previa en vivo");
}

/* --- Barra de herramientas: inserción de sintaxis --- */
const MD_SNIPPETS = {
  h1: { prefix: "# ", block: "line", sample: "Título" },
  h2: { prefix: "## ", block: "line", sample: "Subtítulo" },
  h3: { prefix: "### ", block: "line", sample: "Encabezado" },
  bold: { wrap: "**", sample: "texto en negrita" },
  italic: { wrap: "*", sample: "texto en cursiva" },
  strike: { wrap: "~~", sample: "texto tachado" },
  code: { wrap: "`", sample: "código" },
  ul: { prefix: "- ", block: "lines", sample: "elemento 1\nelemento 2\nelemento 3" },
  ol: { prefix: "1. ", block: "lines", numbered: true, sample: "primer paso\nsegundo paso\ntercer paso" },
  task: { prefix: "- [ ] ", block: "lines", sample: "tarea pendiente\ntarea pendiente 2" },
  quote: { prefix: "> ", block: "lines", sample: "texto de la cita" },
  hr: { insert: "\n---\n" },
  link: { insert: "[texto del enlace](https://ejemplo.com)" },
  image: { insert: "![descripción de la imagen](ruta/imagen.png)" },
  codeblock: { insert: "\n```\nescribe tu código aquí\n```\n" },
  table: {
    insert: "\n| Columna 1 | Columna 2 | Columna 3 |\n|-----------|-----------|-----------|\n| dato      | dato      | dato      |\n| dato      | dato      | dato      |\n"
  }
};

function applyMdAction(action) {
  const def = MD_SNIPPETS[action];
  if (!def) return;
  const ta = activeTa();
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const value = ta.value;
  const selected = value.slice(start, end);
  let replacement, selStart, selEnd;

  if (def.wrap) {
    const inner = selected || def.sample;
    replacement = def.wrap + inner + def.wrap;
    selStart = start + def.wrap.length;
    selEnd = selStart + inner.length;
  } else if (def.prefix) {
    const inner = selected || def.sample;
    const linesSel = inner.split("\n");
    const prefixed = linesSel.map((l, idx) =>
      (def.numbered ? (idx + 1) + ". " : def.prefix) + l
    ).join("\n");
    // asegurar que empieza en línea nueva
    const needsNl = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    replacement = needsNl + prefixed;
    selStart = start + needsNl.length;
    selEnd = selStart + prefixed.length;
  } else {
    replacement = def.insert;
    selStart = start;
    selEnd = start + replacement.length;
  }

  insertTextPreservingUndo(replacement, start, end);
  ta.setSelectionRange(selStart, selEnd);
  renderMarkdownPreview();
}

/* inserta texto manteniendo el historial nativo de deshacer (Ctrl+Z) */
function insertTextPreservingUndo(text, start, end) {
  const ta = activeTa();
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(start, end);
  // execCommand conserva el stack de undo del textarea
  let ok = false;
  try { ok = document.execCommand("insertText", false, text); } catch (e) { }
  if (!ok) {
    // fallback (navegadores sin execCommand): reemplazo directo
    const value = ta.value;
    ta.value = value.slice(0, start) + text + value.slice(end);
  }
}

document.querySelectorAll("#mdToolbar .mdbtn[data-md]").forEach(btn => {
  btn.addEventListener("click", () => applyMdAction(btn.dataset.md));
});

/* --- Color de letra --- */
$("#mdColor").addEventListener("input", () => {
  $("#mdColorDot").style.background = $("#mdColor").value;
});
$("#mdColorDot").style.background = $("#mdColor").value;

$("#mdColorBtn").addEventListener("click", () => {
  const ta = activeTa();
  if (!ta) return;
  const color = $("#mdColor").value;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const inner = ta.value.slice(start, end) || "texto con color";
  const replacement = "{color:" + color + "}" + inner + "{/color}";
  insertTextPreservingUndo(replacement, start, end);
  const selStart = start + ("{color:" + color + "}").length;
  ta.setSelectionRange(selStart, selStart + inner.length);
  renderMarkdownPreview();
});

/* --- Deshacer / Rehacer en el editor MD --- */
$("#mdUndoBtn").addEventListener("click", () => {
  const ta = activeTa();
  if (ta) ta.focus();
  try { document.execCommand("undo"); } catch (e) { }
  renderMarkdownPreview();
});

/* --- Exportar la vista previa Markdown a PDF (diálogo de impresión, 100% local) --- */
const MD_PDF_STYLES = `
  body { font-family: APP_FONT; font-size: 12pt; line-height: 1.6;
         color: #2b2f33; max-width: 800px; margin: 0 auto; padding: 24px; }
  h1 { border-bottom: 2px solid #BFD732; padding-bottom: .25em; }
  h2 { border-bottom: 1px solid #ddd; padding-bottom: .2em; }
  code { font-family: Consolas, monospace; background: #f0f2f4; border: 1px solid #ddd;
         border-radius: 4px; padding: .08em .35em; font-size: .88em; }
  pre { background: #333; color: #eee; border-radius: 8px; padding: .8em 1em;
        border-left: 4px solid #BFD732; overflow-wrap: break-word; white-space: pre-wrap; }
  pre code { background: transparent; border: none; color: inherit; }
  blockquote { border-left: 4px solid #BFD732; margin: .7em 0; padding: .3em .9em;
               color: #666; background: #f6f7f2; }
  table { border-collapse: collapse; margin: .7em 0; }
  th, td { border: 1px solid #ccc; padding: .35em .7em; }
  th { background: #333; color: #fff; }
  tr:nth-child(even) td { background: #f4f5f6; }
  hr { border: none; border-top: 2px solid #ddd; margin: 1.2em 0; }
  img { max-width: 100%; }
  @media print { body { padding: 0; } }
`;

function exportMarkdownToPdf() {
  const allMd = mdDocs.map(d => d.ta.value).filter(v => v.trim()).join("\n\n---\n\n");
  const html = renderMarkdown(allMd);
  if (!html.trim()) { toast("No hay contenido Markdown para exportar"); return; }
  const win = window.open("", "_blank");
  if (!win) { toast("El navegador bloqueó la ventana de exportación"); return; }
  const appFont = getComputedStyle(document.documentElement).getPropertyValue("--content-font") ||
    "'Segoe UI', system-ui, sans-serif";
  win.document.write(
    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Updata — Exportar PDF</title>" +
    "<style>" + MD_PDF_STYLES.replace("APP_FONT", appFont) + "</style></head><body>" + html + "</body></html>"
  );
  win.document.close();
  // esperar a que renderice y abrir el diálogo: "Guardar como PDF"
  win.onload = () => { win.focus(); win.print(); };
  setTimeout(() => { try { win.focus(); win.print(); } catch (e) { } }, 400);
  toast('En el diálogo elige "Guardar como PDF"');
}

$("#mdExportPdfBtn").addEventListener("click", exportMarkdownToPdf);
