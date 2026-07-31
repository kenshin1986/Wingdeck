# Guía de uso de Wingdeck

Recorrido paso a paso de todas las funciones de Wingdeck, pensado para alguien que lo
abre por primera vez. Para la lista completa y técnica de características, ver el
[README](../README.md).

## Tabla de contenidos

1. [Primer arranque](#primer-arranque)
2. [Crear y organizar terminales](#crear-y-organizar-terminales)
3. [Workspaces](#workspaces)
4. [El header de cada terminal](#el-header-de-cada-terminal)
5. [Trabajar con agentes IA](#trabajar-con-agentes-ia)
6. [Retomar una sesión de agente](#retomar-una-sesión-de-agente)
7. [Cola de prompts](#cola-de-prompts)
8. [Broadcast](#broadcast)
9. [Plantillas de flota](#plantillas-de-flota)
10. [Cerebro del workspace](#cerebro-del-workspace)
11. [Integración con Graphify](#integración-con-graphify)
12. [Portapapeles](#portapapeles)
13. [Atajos de teclado](#atajos-de-teclado)
14. [Ajustes](#ajustes)
15. [Bandeja del sistema y cierre](#bandeja-del-sistema-y-cierre)
16. [Dónde vive cada cosa en disco](#dónde-vive-cada-cosa-en-disco)
17. [Solución de problemas](#solución-de-problemas)

## Primer arranque

La primera vez que abrís Wingdeck aparece un asistente de configuración inicial que:

- Revisa qué CLIs de agente tenés instalados (**Claude Code**, **Qwen Code**, **OpenCode**)
  y, si falta alguno, te muestra el comando de instalación listo para copiar.
- Si un CLI ya está instalado, un botón te abre una terminal nueva con ese CLI listo para
  que inicies sesión vos mismo (navegador, API key, etc. — ninguna credencial pasa por
  Wingdeck).
- Detecta si tenés [Graphify](#integración-con-graphify) instalado y, si no, te da el
  comando de instalación.
- Te ofrece tres campos opcionales de **claves de API** (Anthropic, OpenAI, Gemini) para
  quien prefiera autenticarse por variable de entorno en vez del login por navegador de
  cada CLI. Se guardan solo en este equipo, nunca en el repo ni en ningún servidor.

Podés volver a abrir este asistente cuando quieras desde **⚙ Ajustes → "Repetir
configuración inicial"**.

## Crear y organizar terminales

- **`+ Terminal`** (arriba a la izquierda) abre un menú con los shells detectados
  (PowerShell 7, Windows PowerShell, CMD, Git Bash, WSL). Clic directo abre una terminal
  en tu carpeta de usuario; el ícono **📁** al lado de cada shell te deja elegir la
  carpeta inicial.
- Cada terminal es una tarjeta libre: **arrastrala desde su barra superior** para
  moverla, y **desde la esquina inferior derecha** (o los bordes) para redimensionarla.
  Wingdeck recuerda la posición y el tamaño de cada una entre reinicios.
- **`▦ Distribuir`** (visible con más de una terminal) reacomoda todas las terminales del
  workspace activo en una grilla que llena el espacio disponible por igual — útil
  después de crear varias de golpe o de mover manualmente algunas fuera de sitio.
- **Doble clic** en el título de una terminal para renombrarla.
- **`↻`** en el header reinicia el shell de esa terminal, en la misma carpeta donde
  estaba. **`✕`** la cierra y la borra de la sesión (el historial persistido también se
  borra).
- **`⛶` / `Ctrl+Shift+F`** expande una terminal a pantalla completa sin perder su estado;
  clic en el fondo oscuro (o el mismo atajo) para volver a la grilla.

## Workspaces

Un workspace agrupa un conjunto de terminales — típicamente un proyecto o un contexto de
trabajo. El selector **`▣ <nombre> ▾`** en la barra superior permite:

- Cambiar de workspace (las terminales del anterior **siguen vivas en segundo plano**:
  sus procesos y agentes no se detienen, solo dejan de mostrarse; al volver, recuperan su
  pantalla y su historial reciente tal como estaban).
- Crear uno nuevo (escribí un nombre y `Enter` o **`＋`**).
- Renombrarlo (**`✎`**) o eliminarlo (**`🗑``**, pide confirmación — esto sí mata las
  terminales de ese workspace).

**`Ctrl+1`…`Ctrl+9`** salta directo a la n-ésima terminal del workspace activo, según su
posición en la grilla (de arriba hacia abajo, izquierda a derecha).

## El header de cada terminal

De izquierda a derecha:

- **Punto de estado**: verde pulsante mientras el agente trabaja, ámbar con brillo cuando
  terminó y espera tu atención (ver [Trabajar con agentes IA](#trabajar-con-agentes-ia)).
- **Título** (doble clic para editar) y, si detecta un agente corriendo, un **chip con su
  ícono** (`✳ Claude`, `◆ Qwen`, `⬡ OpenCode`).
- **Chip de modelo**: cuando el agente expone qué modelo está usando (por ahora Claude
  Code y OpenCode), aparece junto al chip de agente y se actualiza solo cuando cambiás de
  modelo (p. ej. con `/model` en Claude Code) — no hace falta reiniciar la terminal.
- **Descripción** (`「texto」`, doble clic para editar o desde el menú contextual): una
  nota corta para recordar en qué estás usando esa terminal. Aparece también en los
  avisos del centro de actividad.
- **Carpeta actual** (se sigue en vivo mientras navegás con `cd`) y, si es un repo git, su
  **rama actual**.
- **CPU/RAM/procesos** de esa terminal (suma de todo su árbol de procesos, no solo el
  shell).
- Botones: **📋** cola de prompts, **⚡** comando de arranque, **🕸** abrir grafo Graphify
  (solo si existe), **🔍** buscar en el historial, **⛶** modo enfoque, **↻** reiniciar,
  **✕** cerrar.
- **Clic derecho** sobre la terminal abre un menú contextual con: copiar/pegar, editar
  descripción, comando de arranque, "Sesiones anteriores…" y más.

## Trabajar con agentes IA

Wingdeck detecta automáticamente qué CLI de agente corre en cada terminal inspeccionando
su árbol de procesos — no hace falta configurar nada.

- **Cuándo un agente "terminó"**: cuando una terminal deja de emitir salida tras haber
  estado trabajando un rato y su árbol de procesos queda ocioso, la tarjeta pasa a ámbar
  con brillo animado y el punto de estado muestra "● listo". La campana del terminal
  (BEL) — que muchos agentes emiten al terminar una tarea — dispara el aviso al instante,
  sin esperar el umbral de inactividad.
- **Avisos** (todos configurables en ⚙): parpadeo de la barra de tareas + contador en el
  título de la ventana, notificación nativa de Windows (clic en ella salta directo a esa
  terminal, cambiando de workspace si hace falta), sonido suave, y un toast dentro de la
  app con las últimas líneas de salida.
- **Centro de actividad (🔔)**: historial de qué agente terminó, en qué terminal, en qué
  workspace y hace cuánto. Clic en cualquier evento te lleva ahí.
- **Alerta de CPU sostenida**: si una terminal satura un núcleo de forma sostenida (un
  agente en bucle, por ejemplo), aparece un aviso silencioso en el centro de actividad
  (sin notificación de sistema, para no ser invasivo).

### Comando de arranque (⚡)

Configurá un comando (p. ej. `claude`, `npm run dev`, `opencode`) para que se ejecute
automáticamente apenas esa terminal muestra su primer prompt — al crearla y en cada
reinicio de la app. Es lo que convierte una terminal en "una terminal de agente": varias
de las funciones de esta guía (cola de prompts, cerebro del workspace, sugerencia de
Graphify, retomar sesión) solo aplican a terminales con este campo configurado.

## Retomar una sesión de agente

Claude Code, Qwen Code y OpenCode guardan sus propias sesiones en disco (independiente de
Wingdeck). Cuando abrís una terminal en una carpeta donde ya trabajaste con alguno de
estos agentes, Wingdeck te ofrece continuar en vez de repetir `claude` → esperar →
`/resume` → elegir, a mano, cada vez.

- **Automático**: si detecta historial en la carpeta, aparece un panel con las sesiones
  previas (agente, título, hace cuánto) y las opciones **Retomar**, **Nueva con
  \<agente\>**, **Otra herramienta ▾** o **Cerrar**. Mientras decidís, el comando de
  arranque (⚡) queda retenido — Wingdeck nunca escribe nada en el shell hasta que elegís,
  así que jamás se manda por error un `--resume` dentro de un agente que ya está corriendo.
- **Manual**: clic derecho → **"Sesiones anteriores…"**, disponible en cualquier
  momento, no solo al abrir la terminal.
- **Cada terminal recuerda las suyas**: si tenés varias terminales en la misma carpeta,
  cada una solo te ofrece (o dejar elegir) las sesiones que ella misma retomó o creó —
  nunca una que ya esté viva en otra de tus terminales. Una terminal que todavía no
  trabajó con ningún agente en esa carpeta ve el historial completo de la carpeta, como
  siempre; en el momento en que retoma o crea una sesión, esa sesión pasa a ser suya.
- **"No volver a preguntar en esta terminal"**: un checkbox en el panel lo recuerda por
  terminal — es reversible, basta con usar la entrada manual del menú contextual de
  nuevo.
- No se ofrecen sesiones para terminales WSL en esta versión.

## Cola de prompts

El botón **📋** de cada terminal abre una cola de instrucciones que se envían
automáticamente, una por una, recién cuando el agente de esa terminal queda libre (no
interrumpe una tarea en curso). Útil para dejar preparada una secuencia de pasos antes de
irte, o para encolar la siguiente instrucción mientras el agente todavía está trabajando
en la actual. Tiene un botón de pausa para congelar el avance de la cola sin perder lo
encolado.

## Broadcast

El botón **📢** de la barra superior envía el mismo mensaje a varias terminales
seleccionadas del workspace actual de una sola vez — con la opción de enviarlo ya mismo o
encolarlo (respetando la cola de prompts de cada una). Pensado para dar la misma
instrucción a toda una flota de agentes a la vez.

## Plantillas de flota

El botón **🚀** te deja **guardar** el workspace actual (qué shells, en qué carpetas, con
qué comando de arranque cada uno) como una plantilla con nombre, y **lanzarla** de nuevo
con un clic para levantar toda esa flota en un workspace nuevo — sin recrear cada
terminal a mano.

## Cerebro del workspace

Cada workspace tiene un markdown compartido entre todas sus terminales (botón **🧠
Memoria**) — el lugar para anotar (o dejar que los propios agentes anoten) cómo se
conectan los proyectos que lo forman: contratos de API, puertos, variables de entorno
compartidas, orden de build/deploy, decisiones de arquitectura transversales. No repite
lo que cada agente ya ve en su propio repo — es el conocimiento de *integración* que hoy
capaz solo tenés vos en la cabeza.

- **Automático para agentes**: cualquier terminal con comando de arranque (⚡) recibe,
  apenas el agente queda libre, un mensaje con la ruta del cerebro y la instrucción de
  leerlo y actualizarlo.
- **Es un archivo real**: cualquier agente puede leerlo y escribirlo con sus propias
  herramientas de archivo, sin pasar por Wingdeck.
- **Sincronización pasiva**: si un agente lo actualiza mientras tenés el panel abierto,
  te avisa ahí mismo sin sobreescribir lo que estés viendo. Con el panel cerrado, un
  punto en el botón 🧠 te avisa que hubo cambios.
- **"🔄 Repasar con los agentes"**: les pide a todas las terminales-agente del workspace
  que relean el cerebro ahora mismo (se entrega cuando cada una esté libre).
- **Respaldo automático** antes de cualquier sobreescritura, con "↺ Restaurar versión
  anterior" reversible.
- Se enlaza automáticamente desde el `CLAUDE.md` de cada proyecto que arranca con ⚡.

## Integración con Graphify

[Graphify](https://github.com/Graphify-Labs/graphify) es una herramienta externa que
genera un grafo de código navegable. Wingdeck no la ejecuta ni la empaqueta — solo la
sugiere y da un atajo al resultado:

- Toda terminal con ⚡ recibe, apenas el agente queda libre, una sugerencia sobre
  Graphify: generar el grafo si no existe, o usar `graphify query/explain/path` en vez de
  releer archivos sueltos si ya existe.
- El botón **🕸** aparece junto a ⚡ cuando la carpeta actual de esa terminal tiene
  `graphify-out/graph.html`, y lo abre con el programa por defecto del sistema.

## Portapapeles

- **`Ctrl+V`** — pegado inteligente: texto se pega tal cual; una **imagen** copiada se
  guarda como PNG temporal y se inserta su ruta (funciona con los tres agentes, que
  pueden leer la imagen desde esa ruta); **archivos** copiados en el Explorador insertan
  su ruta entre comillas.
- **`Ctrl+Alt+V`** — reenvía la tecla cruda para que el agente lea el portapapeles por sí
  mismo (útil si el agente tiene su propio manejo de imágenes por teclado).
- **`Ctrl+Shift+V`** — pega siempre como texto plano, ignorando el pegado inteligente.
- **`Ctrl+Shift+C`** — copia la selección actual.
- **Copiar al seleccionar** (configurable en ⚙, estilo Windows Terminal): seleccionar
  texto lo copia automáticamente.
- **Arrastrar y soltar** archivos sobre una terminal inserta su ruta entre comillas.
- Menú contextual (clic derecho) con las mismas acciones.

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+1`…`Ctrl+9` | Saltar a la n-ésima terminal del workspace (por posición en la grilla) |
| `Ctrl+Shift+F` | Modo enfoque (pantalla completa) de la terminal activa |
| `Ctrl+F` | Buscar en el historial de la terminal (`Enter`/`Shift+Enter`: siguiente/anterior) |
| `Ctrl+rueda del mouse` | Cambiar el tamaño de fuente de la terminal bajo el cursor (se recuerda) |
| `Ctrl+V` | Pegado inteligente |
| `Ctrl+Alt+V` | Reenviar `Ctrl+V` crudo al agente |
| `Ctrl+Shift+V` | Pegar como texto plano |
| `Ctrl+Shift+C` | Copiar selección |

## Ajustes

El botón **⚙** de la barra superior abre:

- Copiar al seleccionar texto
- Parpadeo en la barra de tareas
- Notificación de Windows
- Sonido al terminar un agente
- Recordar el historial entre reinicios (scrollback persistente)
- Preguntar antes de cerrar del todo
- Umbral de inactividad para considerar "listo" (4/6/10/15 segundos)
- "Repetir configuración inicial" (reabre el asistente de primer arranque)

## Bandeja del sistema y cierre

Cerrar la ventana (**✕** de Windows) minimiza Wingdeck a la bandeja del sistema — la app
y todos los agentes siguen corriendo, y los avisos te siguen llegando. Para cerrar todo
de verdad: clic derecho en el ícono de la bandeja → **"Salir"**, que te pregunta si
querés seguir en segundo plano o cerrar todo (con "no volver a preguntar" reversible
desde ⚙).

## Dónde vive cada cosa en disco

Todo se guarda en `%APPDATA%\orq-terminal\` (ese nombre de carpeta es previo al rebrand a
"Wingdeck" y se mantuvo a propósito para no perder datos ya guardados):

| Archivo/carpeta | Contenido |
|---|---|
| `session.json` | Workspaces, terminales, layout, comandos de arranque, cola de prompts, sesiones de agente asociadas a cada terminal |
| `settings.json` | Ajustes de ⚙, claves de API opcionales |
| `brains\<workspace>.md` | Cerebro compartido de cada workspace |
| `buffers\<id>.txt` | Scrollback persistido de cada terminal (si está activado) |
| `templates.json` | Plantillas de flota guardadas |
| `window-state.json` | Posición/tamaño de la ventana |

## Solución de problemas

- **Las terminales dejan de responder al tecleo con muchos workspaces/terminales
  abiertas**: a partir de la versión que incluye esta guía, Wingdeck aplica control de
  flujo entre cada terminal y la salida en vivo, así que una salida muy intensa en varias
  terminales a la vez ya no debería congelar la app. Si igual pasara, cerrar del todo
  (bandeja → Salir → "Cerrar todo") y reabrir recupera todo — las sesiones de agente se
  pueden retomar con el panel de "Retomar sesión".
- **Un agente no aparece detectado (sin chip `✳`/`◆`/`⬡`)**: la detección mira el árbol
  de procesos; algunos wrappers o instalaciones no estándar del CLI pueden no matchear.
  No afecta el funcionamiento de la terminal, solo el chip visual y el filtrado de "quién
  terminó".
- **El chip de modelo no aparece**: por ahora depende de que el CLI imprima el nombre del
  modelo en su salida (Claude Code, OpenCode) — no todos los agentes lo hacen, y algunos
  formatos de banner pueden cambiar entre versiones del CLI sin que sea un problema de
  Wingdeck.
- **No me ofrece retomar una sesión que sé que existe**: por ahora no se ofrecen sesiones
  en terminales WSL, y una terminal solo ofrece sesiones que no estén ya asociadas a otra
  de tus terminales abiertas.
