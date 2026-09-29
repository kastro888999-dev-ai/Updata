# Updata — Visor local JSON / CSV / Código / Markdown / PDF / Office

> **Gestor del proyecto:** Carlos Augusto Castro C. · Ver [MANUAL.md](MANUAL.md) (manual de usuario) y [DESARROLLO.md](DESARROLLO.md) (historia del proyecto).

Herramienta 100% local y offline. Se ejecuta abriendo `index.html` directamente en el navegador (doble clic), sin servidor ni conexión: **ningún dato sale de tu equipo**.

## Modos

La barra de la izquierda tiene 5 modos:

| Modo | Control | Qué hace |
|------|---------|----------|
| **Datos** | Dropdown `Datos: Auto/JSON/CSV/Java toString` | JSON → árbol colapsable · CSV → tabla con filas/columnas · Java toString (DTOs Lombok) → árbol colapsable |
| **Markdown** | Botón `✎ Markdown` | Editor con barra de herramientas + vista previa en vivo + **exportar a PDF** |
| **PDF** | Botón `📄 PDF` | Lector offline con edición básica de páginas |
| **Office** | Botón `📊 Office` | Lector de **Word** (.docx, con formato) y **Excel** (.xlsx y variantes, hojas en pestañas) + copiar/exportar |
| **GIF** | Botón `🎞 GIF` | Reproductor de GIF animados (play/pausa/stop, frame a frame) + edición y re-exportación |

## Funcionalidades

- **JSON**: árbol formateado con secciones colapsables.
- **CSV**: tabla con expandir/contraer por columna y por fila.
- **Java toString**: salida `toString()` de DTOs Java (estilo Lombok, p. ej. logs de autorización) → árbol colapsable como JSON.
- **Enmascarado** de valores con `***` (por valor, sección, columna o fila).
- **Copiado fiel a lo visible**: lo colapsado se copia resumido y lo enmascarado sale como `***`.
- **Markdown**: barra para quien no conoce la sintaxis (títulos, negrita, listas, tablas, código…), vista previa en vivo y botón **⤓ Exportar PDF** (usa el diálogo de impresión → "Guardar como PDF").
- **PDF**:
  - Carga por botón o arrastrar; **➕ Añadir PDF** anexa las páginas de otro archivo.
  - Miniaturas: **reordenar arrastrando**, rotar (⟳), eliminar/restaurar (✕/↩).
  - **Texto seleccionable** en el visor (capa de texto de pdf.js): selecciona y copia con Ctrl+C.
  - Herramientas de edición: 🖍 resaltar, ▁ subrayar, ⬛ quitar/censurar zonas, 🅣 escribir texto, 🖼 insertar imágenes, 📷 copiar una zona como imagen al portapapeles; selector de color y ↺ deshacer.
  - Exportar **💾 PDF** (las anotaciones se incrustan tal como se ven) o **⤓ .md** (texto de las páginas visibles en el orden actual + notas añadidas).
- **Office** (lector, sin edición):
  - **Word** (.docx): documento con formato (títulos, negrita, listas, tablas) vía mammoth; copiar texto o exportar **.md**.
  - **Excel** (.xlsx/.xls/.xlsm/.xlsb): hojas en pestañas con cuadrícula (encabezados de fila/columna) vía SheetJS; copiar o exportar la hoja activa como **CSV**.
- **GIF**:
  - Decodificador GIF **propio** (LZW, disposal, transparencia, entrelazado): frames compuestos tal como los muestra el navegador.
  - Reproductor: **▶/⏸ play-pausa, ⏹ stop, ⏮/⏭ frame a frame**, deslizador y velocidad (0.25x–4x).
  - Edición por frame: 🖍 resaltar, ⬛ pintar, ✎ trazo a mano alzada, 🅣 texto; deshacer/rehacer.
  - Exportar **⤓ PNG** (frame visible) o **⤓ GIF** (animación completa re-codificada con las ediciones incrustadas y los tiempos originales).
- Colores Globant, dark mode y diseño responsive (visor ≈ 75% de la pantalla).

## Estructura del proyecto

```
Updata/
├── index.html            # Estructura HTML (solo maquetación)
├── README.md             # Este documento (técnico)
├── MANUAL.md             # Manual de usuario (también embebido en la app)
├── DESARROLLO.md         # Historia del proyecto y créditos
└── assets/
    ├── css/
    │   └── main.css      # Estilos (temas, layout, árbol, tabla, código, markdown, pdf)
    ├── vendor/           # Librerías vendorizadas (offline, sin CDN en ejecución)
    │   ├── pdf.min.js          # pdf.js (Mozilla) — render de PDF
    │   ├── pdf.worker.min.js   # worker de pdf.js
    │   ├── pdf-lib.min.js      # pdf-lib — edición y exportación de PDF
    │   ├── xlsx.full.min.js    # SheetJS — lectura de Excel (xlsx/xls/xlsm/xlsb)
    │   └── mammoth.browser.min.js  # mammoth — lectura de Word (.docx)
    └── js/
        ├── core.js       # Utilidades base: $, toast, copiado, tema, fuente, gestor de modos
        ├── parsers.js    # parseCSV, parseJavaToString y detección de formato (json/csv/jtostring/java/html/python)
        ├── code.js       # Resaltado de sintaxis y editor de código en el visor
        ├── viewer.js     # Árbol JSON, tabla CSV, máscaras, edición inline y serialización
        ├── markdown.js   # Renderizador MD propio + toolbar + color + exportar a PDF
        ├── pdf.js        # Modo PDF: render, anotaciones, texto rico, undo/redo, exportar
        ├── office.js     # Modo Office: lector Word (mammoth) y Excel (SheetJS), copiar/exportar
        ├── gif.js        # Modo GIF: decodificador/codificador propio, reproductor, edición, exportar
        ├── manual.js     # MANUAL.md embebido (regenerar si el manual cambia)
        └── controls.js   # Cambio de modos, abrir archivos y eventos globales
```

### Orden de carga de scripts (importante)

Scripts clásicos (no módulos ES) para poder ejecutarse desde `file://`. Comparten ámbito global; el orden en `index.html` importa:

`vendor/pdf.min.js → vendor/pdf-lib.min.js → vendor/xlsx.full.min.js → vendor/mammoth.browser.min.js → core.js → parsers.js → code.js → viewer.js → markdown.js → pdf.js → office.js → gif.js → manual.js → controls.js`

### Regenerar el manual embebido

Si editas `MANUAL.md`, regenera `assets/js/manual.js` con:

```bash
node -e "const fs=require('fs');fs.writeFileSync('assets/js/manual.js','/* Manual embebido - generado desde MANUAL.md */\nconst MANUAL_MD = '+JSON.stringify(fs.readFileSync('MANUAL.md','utf8'))+';\n')"
```

### Cómo escalar

- Nuevo modo → función `enterXxxMode()` en su propio archivo, botón en `.mode-bar`, y su caso en `onModeChange()` (controls.js).
- Nueva funcionalidad de UI → nuevo archivo en `assets/js/` y su `<script>` antes de `controls.js`.
- Nuevos estilos → `assets/css/main.css`.
- Nuevo formato de datos → parser en `parsers.js`, render en `viewer.js`, opción en el dropdown.

### Notas

- El modo PDF requiere las librerías de `assets/vendor/` (ya incluidas). No se hace ninguna petición a internet en ejecución.
- En algunos navegadores, al abrir desde `file://`, pdf.js usa su "fake worker" automáticamente (más lento pero funcional).
