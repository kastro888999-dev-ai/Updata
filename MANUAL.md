# Updata — Manual de Usuario

**Updata** es una herramienta web 100% local para visualizar, formatear, editar y exportar datos y documentos. Se ejecuta abriendo `index.html` directamente en el navegador (doble clic), **sin servidor ni conexión a internet: ningún dato sale de tu equipo**.

---

## Índice

1. [Interfaz general](#interfaz-general)
2. [Sección Datos: JSON](#sección-datos-json)
3. [Sección Datos: CSV](#sección-datos-csv)
4. [Sección Datos: Java toString](#sección-datos-java-tostring)
5. [Sección Código: Java, HTML, Python](#sección-código-java-html-python)
6. [Sección Markdown](#sección-markdown)
7. [Sección PDF](#sección-pdf)
8. [Sección Office (Word y Excel)](#sección-office-word-y-excel)
9. [Sección GIF](#sección-gif)
10. [Abrir archivos](#abrir-archivos)
11. [Personalización](#personalización)
12. [Atajos de teclado](#atajos-de-teclado)

---

## Interfaz general

La pantalla se divide en dos paneles:

| Panel | Ubicación | Función |
|-------|-----------|---------|
| **Entrada** | Izquierda (~25%) | Pegar texto, escribir Markdown o gestionar páginas PDF |
| **Visor** | Derecha (~75%) | Ver el resultado formateado, editarlo y exportarlo |

En la cabecera del panel Entrada está la **barra de modos**:

- **Dropdown "Datos"** — JSON, CSV, Java toString o código (Java/HTML/Python), con detección automática.
- **✎ Markdown** — editor con vista previa en vivo.
- **📄 PDF** — lector y editor de PDF.
- **📊 Office** — lector de Word (.docx) y Excel (.xlsx y variantes).
- **🎞 GIF** — reproductor y editor de GIF animados.

Cada panel tiene **scroll independiente**: al desplazarte por un documento largo, el resto de la interfaz permanece fija.

En la cabecera del **Visor** está el **control de zoom** (`-` / porcentaje / `+`): funciona en todos los modos (datos, Markdown, código, PDF, Office y GIF). Clic en el porcentaje para volver al 100%. Si el contenido agrandado desborda, puedes arrastrarlo para desplazarte (paneo).

---

## Sección Datos: JSON

Pega un JSON en la entrada y pulsa **Formatear ▸** (o Ctrl+Enter).

**En el visor:**
- El JSON se muestra como **árbol con colores** por tipo de dato.
- **▾/▸** colapsa o expande cualquier objeto o arreglo (colapsado muestra `{ … }` con el conteo de elementos).
- **Clic en un valor** → lo enmascara con `***` (clic de nuevo lo restaura).
- **Doble clic en un valor** → lo **edita** directamente (Enter confirma, Esc cancela).
- Al pasar el mouse por una fila aparecen: **⧉ copiar** (esa sección) y **`*** mask`** (enmascarar todo el bloque).

**Botones globales del visor:**
- **⊞ Expandir / ⊟ Colapsar** — todo el árbol.
- **👁 Desenmascarar** — quita todas las máscaras.
- **⧉ Copiar todo** — copia **lo que se ve**: lo colapsado se copia resumido y lo enmascarado sale como `***`.

## Sección Datos: CSV

Pega un CSV (separado por comas o `;`, con soporte de comillas) y pulsa **Formatear ▸**.

**En el visor** se muestra como **tabla**:
- Encabezados fijos (sticky) y columna `#` fija al hacer scroll.
- **Por columna** (botones bajo cada encabezado): **⤢** expandir texto completo, **⊟** contraer columna, **`***`** enmascarar columna.
- **Por fila** (junto al número): **⤢/⤡** expandir/contraer, **⧉** copiar la fila como CSV.
- **Clic en una celda** → enmascarar. **Doble clic** → editar el valor.
- **⧉ Copiar todo** exporta la tabla como CSV válido, respetando máscaras.

## Sección Datos: Java toString

Pega la salida `toString()` de un DTO Java (estilo Lombok) y pulsa **Formatear ▸**. Ejemplo:

```
AUTHZ data for user demo: UserProfileDto(profiles=[ProfilesDto(name=X, cifs=[CifDto(cif=001)])], errors=null)
```

También acepta **JSON con un prefijo de texto** (p. ej. logs de autorización):

```
CIF permissions for user demo userAccessPermission {"data":[{"country":"GT","cifs":[...]}],"errors":null}
```

Si la línea contiene **varios JSON embebidos** (p. ej. request y response en un log), se muestran todos, encadenados con el texto que los separa como clave de cada bloque.

**En el visor** se muestra como **árbol colapsable** (igual que JSON):
- `Clase(campo=valor, ...)` → objeto; `[v1, v2]` → arreglo; `null`/`true`/`false`/números se colorean por tipo.
- Un prefijo antes del DTO o del JSON (p. ej. `AUTHZ data for user demo:`) se conserva como clave raíz.
- **▾/▸** colapsar/expandir, **clic** enmascara con `***`, **doble clic** edita, **⧉ copiar** / **`*** mask`** por fila.
- Los valores con ceros a la izquierda (p. ej. CIFs `000111`) se conservan como texto.

**Limitación:** en este formato los strings no van entrecomillados, así que un valor que contenga `,` o `)` puede cortarse antes de tiempo.

## Sección Código: Java, HTML, Python

Selecciona el lenguaje en el dropdown (o deja **Auto** — detecta código por su sintaxis) y pulsa **Formatear ▸**.

**En el visor:**
- El código se muestra con **resaltado de sintaxis** (palabras clave, strings, números, comentarios, anotaciones/decoradores, etiquetas y atributos HTML).
- **Es editable**: haz clic dentro y escribe. Los cambios se re-resaltan automáticamente y se sincronizan con el panel de entrada.
- **⧉ Copiar todo** copia el código tal como quedó editado.

## Sección Markdown

Pulsa el botón **✎ Markdown**. El panel izquierdo se vuelve editor y el visor muestra la **vista previa en vivo** mientras escribes.

**Barra de herramientas** (para quien no conoce la sintaxis):
- **H1 H2 H3** — títulos · **B I S `code`** — negrita, cursiva, tachado, código
- **• Lista / 1. Lista / ☑ Tareas / ❝ Cita** — se aplican a las líneas seleccionadas
- **▦ Tabla / { } Bloque código / 🔗 Enlace / 🖼 Imagen / — Separador** — insertan plantillas listas
- **🎨 Color** — aplica color al texto seleccionado (sintaxis `{color:#hex}texto{/color}`)
- **↺ Deshacer** — también Ctrl+Z / Ctrl+Shift+Z (rehacer)

**Exportar:**
- **⤓ Exportar PDF** (en el visor) — abre el diálogo de impresión: elige "Guardar como PDF". Usa la fuente de contenido seleccionada y conserva los colores.
- **⧉ Copiar todo** — copia el texto Markdown fuente.

## Sección PDF

Pulsa **📄 PDF** y carga un documento (botón, arrastrar, o 📂 Abrir). Si el PDF tiene **contraseña**, se pedirá al abrirlo.

### Panel de entrada (miniaturas)
- **Arrastra** las miniaturas para **reordenar** páginas.
- **⧉** duplica la página · **⟳** la rota 90° · **✕** la elimina (↩ restaura; doble clic en ✕ la quita de la lista).
- **Clic en una miniatura** → el visor navega hasta esa página (con destello verde).
- **➕ Añadir PDF** — anexa las páginas de otro archivo (se pueden mezclar arrastrando).

### Visor (herramientas)
- **🖱 Seleccionar** — selecciona y copia **texto real** del PDF (Ctrl+C).
- **🖍 Resaltar** — marca semitransparente; admite formas.
- **▁ Subrayar** — línea bajo el texto.
- **🖌 Pintar** — tapa/censura zonas (opaco); admite formas.
- **Formas** (para Resaltar y Pintar): ▭ rectángulo, ▢ redondeado, ◯ elipse, ✎ mano alzada.
- **🅣 Texto** — clic en la página abre el editor con barra de formato completa: **negrita, cursiva, subrayado, tamaño, alineación (izq/centro/der/justificado), fuente (13 opciones), color, columnas (1-3) y listas**. Confirma con ✔ o Ctrl+Enter.
  - Después de aceptar: **arrastra** el texto para moverlo, **✎ o doble clic** para editarlo, **✕** para eliminarlo.
- **🖼 Imagen** — elige una imagen y arrastra dónde colocarla. Luego: arrastra para mover, tirador verde para **redimensionar** (Shift mantiene proporción), ✕ elimina.
- **📷 Copiar zona** — arrastra un recuadro y se copia como imagen PNG al portapapeles.
- **Color** — paleta nativa + campo hex (`#RRGGBB`), con punto indicador.
- **↺ Deshacer / Ctrl+Z / Ctrl+Shift+Z** — historial completo: agregar, borrar, editar, mover y redimensionar.

### Exportar (botones del visor)
- **⤓ Exportar PDF** — descarga el documento **tal como se ve**: orden de páginas, rotaciones, eliminaciones y todas las anotaciones incrustadas. Si el original tenía contraseña, ofrece exportarlo **sin contraseña**.
- **⤓ .md** — extrae el texto de las páginas visibles (en el orden actual) como Markdown, incluyendo las notas añadidas.

## Sección Office (Word y Excel)

Pulsa **📊 Office** y carga un documento (botón, arrastrar, o 📂 Abrir). Es un **lector y editor**: puedes modificar el contenido en el visor y exportar el resultado. Todo ocurre en tu equipo, sin conexión.

### Word (.docx)
- Se muestra el documento con su formato: **títulos, negrita, cursiva, listas, tablas y enlaces**.
- El documento es **editable**: haz clic y escribe directamente sobre el texto (como un editor de texto).
- **Formato de texto** (barra de herramientas del visor, sección Word): **negrita (N)**, **cursiva (K)**, **subrayado (S)**, **tamaño de texto** y **color de letra**. Se aplican al texto seleccionado.
- **Alineación**: ⬅ izquierda, ⬌ centrar, ➡ derecha y ☰ justificar.
- **Columnas**: divide el documento en 1, 2 o 3 columnas (como en Word).
- **🖼 Insertar imagen** — inserta una imagen en la posición del cursor. También puedes **pegar** una imagen con Ctrl+V.
- **⧉ Copiar** — copia el texto del documento (con tus ediciones) al portapapeles.
- **⤓ .md** — descarga el texto del documento como Markdown.
- **⤓ .html** — descarga el documento con formato, colores e imágenes incrustadas, listo para abrir en el navegador.
- El formato antiguo **.doc** no se soporta: guarda el archivo como **.docx** y vuelve a intentarlo.

### Excel (.xlsx, .xls, .xlsm, .xlsb)
- Las **hojas** aparecen como **pestañas**: haz clic en una para ver su cuadrícula (con encabezados de fila y columna, como en Excel).
- Las celdas vacías se muestran en blanco; las fechas y números se muestran con su formato.
- **Edición de celdas**: haz **doble clic** (o F2, o simplemente empieza a escribir con una celda seleccionada) para editar. Enter confirma, Escape cancela, Tab confirma y pasa a la celda siguiente. Supr borra el contenido.
- **Fórmulas**: escribe `=SUMA(A1:A5)`, `=PROMEDIO(B1:B10)`, `=MIN(...)`, `=MAX(...)`, `=CONTAR(...)`, `=PRODUCTO(...)` (también en inglés: SUM, AVERAGE, COUNT, PRODUCT) y operaciones con `+ - * / ^` y paréntesis, p. ej. `=(A1+B2)*2`. La fórmula se guarda y se evalúa al vuelo.
- **Selección**: clic y arrastrar (o Shift+clic) para seleccionar un rango; flechas para moverte entre celdas.
- **🔍 Buscar / filtrar**: escribe en el cuadro de búsqueda sobre la cuadrícula y solo se mostrarán las filas que contienen ese texto (en cualquier columna, sin distinguir mayúsculas). El contador indica cuántas filas coinciden y ✕ limpia el filtro. La copia y la exportación **no** se ven afectadas: siempre incluyen todas las filas.
- **Formato de celdas** (barra de herramientas del visor, sección Excel): **negrita (B)**, **cursiva (I)**, **subrayado (S)**, **tamaño de texto**, **color de letra** y **color de casilla** (fondo). Se aplican a la selección de celdas (o a la celda activa); pulsa de nuevo el botón para quitar negrita/cursiva/subrayado.
- **Alineación**: horizontal (izquierda, centrar, derecha) y vertical (arriba, medio, abajo).
- **⧉ Copiar** — copia **lo que se ve**: el rango seleccionado (o toda la hoja si no hay selección) con los valores evaluados, listo para pegar en Excel.
- **⤓ CSV** — descarga la hoja activa como archivo CSV (con BOM UTF-8, listo para Excel).
- **⤓ .xlsx** — descarga el libro completo con tus ediciones, fórmulas y estilos, en formato Excel moderno.
- **↺ Deshacer** — revierte la última edición de celda (contenido o formato).
- En hojas muy grandes solo se muestran las primeras 5000 filas (con un aviso); la copia y la exportación incluyen **todas** las filas.

## Sección GIF

Pulsa **🎞 GIF** y carga un GIF animado (botón, arrastrar, o 📂 Abrir). Se decodifica **frame a frame en tu equipo**, sin librerías externas: el visor muestra cada frame compuesto tal como lo mostraría el navegador.

### Reproductor (en el visor)
- **▶ / ⏸** reproduce y pausa · **⏹** stop (vuelve al primer frame).
- **⏮ / ⏭** retrocede y adelanta frame a frame.
- **Deslizador** — salta a cualquier frame.
- **Velocidad** — 0.25x, 0.5x, 1x, 2x o 4x (respeta los tiempos reales de cada frame).
- Contador **"12 / 48"** de frames y fondo de damero para ver la transparencia.

### Herramientas de edición (sobre el frame actual)
- **🖍 Resaltar** — marca semitransparente; admite formas (▭ ▢ ◯).
- **⬛ Pintar** — tapa/censura zonas (opaco); admite formas.
- **✎ Trazo** — dibujo a mano alzada.
- **🅣 Texto** — clic en el frame para escribir: tamaño y color. Después: **arrastra** para mover, **✎ o doble clic** para editarlo, **✕** para eliminarlo.
- **🖼 Imagen** — elige una imagen, **recórtala** en el diálogo (arrastra para elegir la zona y pulsa **✔ Recortar**) y por último **arrastra en el frame** para colocarla. Después puedes **arrastrarla** para moverla y **redimensionarla**; **✕** la elimina. (Mantén **Shift** al redimensionar para conservar la proporción.)
- **Color** — paleta nativa + campo hex (`#RRGGBB`), con punto indicador.
- **↺ Deshacer / Ctrl+Z / Ctrl+Shift+Z** — historial completo por frame.
- Las ediciones se guardan **por frame**: puedes pausar en el frame 12, editarlo, y seguir reproduciendo.

### Miniaturas de frames (panel Entrada)
- Debajo de la info del GIF se muestran las **miniaturas** de todos los frames (como el PDF): haz **clic** en una para ir a ese frame, y **arrastra** para **reordenar** la secuencia.
- **⧉** (en cada miniatura) **duplica** ese frame (contenido + ediciones) y lo inserta justo debajo.
- **✕** (en cada miniatura) **elimina** ese frame y sus ediciones.
- **➕ Añadir frame** añade un **frame nuevo en blanco** (transparente) justo después del frame actual, para dibujar sobre él.

### Añadir otro GIF
- **➕ Añadir GIF** (junto a la info del archivo) carga otra animación y **añade sus imágenes al final** sin perder las ediciones. Se conservan las dimensiones del GIF en edición; el nuevo GIF se coloca centrado (escalado solo para "caber", sin agrandar), así ninguna anotación se desalinea.

### Exportar (botones del visor)
- **⤓ PNG** — descarga el frame visible con sus ediciones, a resolución nativa.
- **⤓ GIF** — descarga la **animación completa con las ediciones incrustadas** (se re-codifica el GIF con paleta propia, respetando los tiempos de cada frame).

## Abrir archivos

El botón **📂 Abrir** (siempre visible) detecta la extensión y abre cada archivo en su sección:

| Extensión | Sección |
|-----------|---------|
| `.json` | Datos → árbol JSON |
| `.csv` | Datos → tabla |
| `.txt` | Datos → auto (JSON, CSV o Java toString) |
| `.java` | Código Java |
| `.html` / `.htm` | Código HTML |
| `.py` | Código Python |
| `.md` / `.markdown` | Editor Markdown |
| `.pdf` | Lector/editor PDF |
| `.docx` | Lector/editor Word |
| `.xlsx` / `.xls` / `.xlsm` / `.xlsb` | Lector/editor Excel |
| `.gif` | Reproductor/editor GIF |

## Personalización

- **🌙/☀️ Tema** — claro u oscuro (se recuerda entre sesiones).
- **Tipo de letra** (selector del header) — cambia la fuente del **contenido** de los editores y visores (Markdown, datos, textos del PDF), no de la interfaz. Se recuerda entre sesiones.
- **Responsive** — en pantallas pequeñas los paneles se apilan; las barras de scroll son visibles y fijas.

## Atajos de teclado

| Atajo | Dónde | Acción |
|-------|-------|--------|
| `Ctrl+Enter` | Entrada de datos | Formatear |
| `Ctrl+Enter` | Editor de texto PDF | Confirmar el texto |
| `Ctrl+Z` | Markdown / PDF / GIF | Deshacer |
| `Ctrl+Shift+Z` | Markdown / PDF / GIF | Rehacer |
| `Esc` | Editores inline | Cancelar |
| `Enter` | Edición de valor en visor | Confirmar |
| `Shift` + arrastrar tirador | Imagen en PDF | Redimensionar manteniendo proporción |

---

*Updata funciona 100% offline. Ningún dato, documento o archivo sale de tu equipo.*
