

# Joplock

Un cliente web seguro y rápido para [Joplin Server](https://github.com/laurent22/joplin).

Joplock funciona como un sidecar junto a una instancia de Joplin Server sin modificar, compartiendo la misma base de datos Postgres, sesiones, notas, carpetas y recursos. Te proporciona una interfaz ligera basada en navegador para tus notas de Joplin sin modificar Joplin Server en sí. Sigue usando los otros clientes de Joplin también, esto no interferirá.

### Características principales

- **Compatibilidad total con Joplin** -- escritorio, móvil, CLI y Joplock funcionan todos con la misma cuenta y datos simultáneamente
- **Bajo consumo de recursos** -- uso mínimo de memoria en el cliente, rápido y receptivo
- **Diseño centrado en la seguridad** -- no se almacenan datos privados en el cliente; las sesiones se limpian al cerrar sesión; configuraciones por usuario y controles de administrador para la gestión de usuarios
- **Bóvedas cifradas del lado del cliente** -- convierte cualquier cuaderno en una bóveda; las notas internas se cifran en el navegador con AES-GCM mediante una clave derivada con PBKDF2. El servidor nunca ve las contraseñas de la bóveda. El texto cifrado está vinculado a una bóveda y un id de nota específicos, y el servidor rechaza cualquier escritura que coloque un cuerpo cifrado por bóveda en la nota incorrecta o en la bóveda incorrecta
- **Editor de doble modo** -- CodeMirror 6 para edición de markdown y TinyMCE 8 para modo renderizado enriquecido, intercambiable por nota; en móvil se abre en una vista renderizada de solo lectura con un interruptor de edición
- **Tablas, bloques de código y lightbox** -- modal de editor de código a pantalla completa con selector de idioma, tablas de TinyMCE con ida y vuelta de markdown, y un lightbox para imágenes y archivos adjuntos
- **Exportación de notas** -- exporta cualquier nota como Markdown, HTML de un solo archivo (imágenes y enlaces en línea), DOCX (lado del servidor vía pandoc con estilos de referencia) o PDF, con líneas de cuadrícula de tabla visibles en la salida PDF/DOCX
- **Autocompletado con IA** -- finalización de texto opcional mediante perfiles de proveedor configurados por el usuario (OpenRouter y otros), activado por Ctrl/Cmd-Space o disparadores de Expander configurables; expansores de texto por usuario para fragmentos
- **Detección de edición concurrente** -- detecta cuando otro cliente (o otra pestaña del navegador) ha actualizado la misma nota y ofrece Sobrescribir / Crear copia para que las ediciones nunca se pierdan silenciosamente
- **Múltiples temas** -- Grey, Fruit, Dark Fruit, Earth, Swamp Thing, Fireball y más, todos como conjuntos de propiedades CSS personalizadas; selector de tema por usuario en la barra de estado y la página de configuración
- **Creación de usuarios desde la interfaz de Joplock** -- crea y modifica usuarios directamente desde la página de configuración de Joplock
- **Copia de seguridad y restauración completa de la base de datos** -- crea y restaura copias de seguridad completas de Postgres tanto para datos de Joplin como de Joplock
- **Autenticación multifactor** -- MFA basada en TOTP opcional encima de las sesiones estándar de Joplin
- **Búsqueda rápida** -- busca títulos y cuerpos de notas directamente en Postgres; búsqueda opcional en vivo mientras escribes
- **Autoguardado casi instantáneo** -- guardados con retardo (debounce) con detección de conflictos, deduplicación basada en hash y un búfer circular de deshacer con instantáneas completas del historial de notas. Restaurar una instantánea actualiza el editor abierto inmediatamente sin recargar la página
- **Soporte PWA** -- instalable como aplicación en la pantalla de inicio en móvil y escritorio con pantallas de presentación, indicador de modo fuera de línea y shell de service worker
- **Renderizado del lado del servidor** -- SSR con htmx para JavaScript mínimo del lado del cliente

## Modelo de ejecución

Joplock:
- lee los datos de Joplin directamente desde la base de datos Postgres compartida
- valida la misma cookie `sessionId` utilizada por Joplin Server
- escribe notas, carpetas y recursos a través de las APIs estándar de Joplin Server

Esto mantiene la compatibilidad del escritorio, móvil, CLI y Joplock con la misma cuenta y datos.

## Requisitos

- docker
- una instancia existente de Joplin Server, o ejecutar la opción fullstack

## Entorno

Toda la configuración se realiza directamente en los archivos compose mediante variables de entorno en línea con comentarios. No se necesita un archivo `.env` -- simplemente edita los valores en `docker-compose.yml` o `docker-compose.example-full.yml` antes de iniciar.

Configuración de copia de seguridad y recuperación:

- `JOPLOCK_BACKUP_DIR` habilita copias de seguridad completas de la base de datos del lado del servidor
- `JOPLOCK_BACKUP_COMPRESSION` controla el método de compresión de `pg_dump`, por ejemplo `zstd:19` o `gzip:9`
- `JOPLOCK_BACKUP_COMPRESSION_LEVEL=0-9` controla la compresión de `pg_dump` para archivos de respaldo
- `JOPLOCK_RECOVERY_ENABLED=true` habilita la página de recuperación de emergencia en `/recovery`
- `JOPLOCK_RECOVERY_PASSWORD` protege esa página de recuperación

Importante:

- Las copias de seguridad solo son duraderas si `JOPLOCK_BACKUP_DIR` está montado en almacenamiento persistente.
- La compresión predeterminada de copias de seguridad es `zstd:19`, que generalmente es más pequeña que `gzip:9`.
- `JOPLOCK_BACKUP_COMPRESSION` tiene precedencia sobre `JOPLOCK_BACKUP_COMPRESSION_LEVEL`.
- Una mayor compresión produce archivos de respaldo más pequeños, pero puede tardar más en crearse.
- El modo de recuperación es solo para copias de seguridad y restauración, no para el uso regular de notas.
- La restauración reemplaza toda la base de datos Postgres compartida, incluidas las tablas propiedad de Joplock.

## Docker

Imagen de contenedor publicada:
- `ghcr.io/abort-retry-ignore/joplock:latest`

### Instalación como Sidecar

Usa esto cuando ya tengas Joplin Server y Postgres ejecutándose en otro lugar. Edita los valores del entorno en `docker-compose.yml` para que apunten a tu configuración existente, o cópialos en tu compose existente. Luego:

```bash
docker compose up -d
```

Esto descarga la imagen preconstruida desde GitHub Container Registry. Para construir desde el código fuente en su lugar:

```bash
docker compose -f docker-compose-build.yml up -d --build
```

En Linux, los archivos compose mapean `host.docker.internal` a la pasarela del host para que Joplock pueda llegar a los servicios del host de forma predeterminada.

### Copia de seguridad y restauración

Flujo de trabajo normal:

1. Inicia sesión como el administrador configurado de Joplock.
2. Abre `Configuración -> Admin -> Copia de seguridad y restauración`.
3. Crea una copia de seguridad o restaura una existente del lado del servidor.

Flujo de trabajo de emergencia cuando el inicio de sesión normal de Joplin no está disponible:

1. Habilita `JOPLOCK_RECOVERY_ENABLED=true` y establece `JOPLOCK_RECOVERY_PASSWORD`.
2. Abre `/recovery`.
3. Inicia sesión con la contraseña de recuperación.
4. Crea o restaura copias de seguridad completas de la base de datos desde allí.

Antes de restaurar:

1. Detén o pon en silencio a Joplin Server si es posible.
2. Detén los clientes de sincronización activos.
3. Espera que toda la base de datos Postgres compartida sea reemplazada.

### Stack de ejemplo completo

Usa esto como un stack de referencia/demo con Postgres, Joplin Server y Joplock juntos. Edita los valores en `docker-compose.example-full.yml` según sea necesario, luego:

```bash
docker compose -f docker-compose.example-full.yml up -d
```

El ejemplo completo usa la imagen pública `joplin/server:latest`. Joplock se expone en `http://localhost:5444` de forma predeterminada. Joplin Server es solo interno a menos que agregues un mapeo de puertos.

El ejemplo completo está pensado como un archivo compose de referencia funcional. Ajústalo para tu implementación real.
