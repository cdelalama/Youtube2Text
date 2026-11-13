# Añadir cuentas y tokens en Media2Text

Abre https://y2t.lamanoriega.com/?screen=settings desde tu conexión habitual
a la red de casa y entra con la contraseña que ya utilizabas. No se ha cambiado
el acceso ni se ha creado otra cuenta de usuario. La conexión desde tu teléfono
durante el viaje conserva los requisitos de acceso remoto existentes.

En **Cuentas de transcripción**, pulsa **Añadir cuenta**, elige Deepgram,
AssemblyAI u OpenAI y escribe un nombre reconocible y su **Clave API**.
Pulsa **Guardar cuenta**. Puedes añadir varias cuentas del mismo proveedor.
El nombre es tu alias, no una identidad comprobada por el proveedor.
La clave queda oculta tras guardarla; solo se muestran sus cuatro últimos caracteres.

Cuando quieras que una cuenta se use, pulsa **Usar para nuevas transcripciones**.
Elegir una cuenta de otro proveedor cambia también el proveedor activo.
La línea **Nuevos trabajos** indica el proveedor y la cuenta elegidos.
Guardar una cuenta por sí solo no cambia la selección ni inicia una grabación.
Los trabajos ya aceptados conservan la versión de clave con la que empezaron.

**Gestionar cuenta y claves** permite cambiar el nombre, añadir una clave nueva,
desactivar la cuenta para nuevos trabajos o revocar localmente una clave.
La revocación local no revoca la clave en el proveedor ni garantiza detener
una petición que ese proveedor ya haya aceptado.
Tras cinco minutos desde el acceso, la aplicación pide confirmar la contraseña
antes de modificar las cuentas. Cerrar sesión borra la cookie de ese navegador;
una copia de esa cookie sigue siendo válida hasta su caducidad, a las 12 horas desde que se emitió.

**Comprobar acceso** es opcional y no envía audio. Su resultado no acredita
saldo ni permiso para transcribir: **Saldo: desconocido** sigue siendo correcto.
Varios tokens de la misma cuenta no multiplican su crédito. Los límites de gasto
de Media2Text siguen vigentes.

La cuenta **Prueba de instalación** queda desactivada, sin seleccionar y con claves
ficticias. Conserva la evidencia de instalación y no debe usarse para transcribir.

## Cambio automático de clave o cuenta

**Todavía no está instalado.** Llega con la versión 0.43.5, que está preparada
en el código y pendiente de una nueva revisión independiente y de
instalación. El NAS sigue con la 0.42.2, donde esta sección no aparece. Cuando
se instale, los trabajos siguen yendo a la misma cuenta hasta que actives el
interruptor: viene desactivado.

Qué cambia aunque no actives el interruptor. Al instalar esa versión notarás
estas diferencias, con el interruptor apagado o encendido:

- **Los mensajes de error de los servicios de transcripción cambian de forma.**
  Ya no copian nada de lo que devuelve el servicio. Ahora son siempre así:
  «Deepgram error: server-error (HTTP 503)», «OpenAI Whisper error: rate-limit
  (HTTP 429) [rate_limit_exceeded]», «AssemblyAI error: timeout». Dicen el
  servicio, el tipo de fallo, el código de respuesta y, a veces, una etiqueta
  entre corchetes. Esa etiqueta sale de una lista fija de Media2Text: si el
  servicio manda un código que no está en la lista verás «[other]». Tampoco
  aparece ya el identificador que el servicio da a cada trabajo. El motivo es
  que un servicio puede devolver tu clave en su respuesta, entera o a trozos, y
  así nunca llega a los registros. Si necesitas más detalle de un fallo raro,
  míralo en la web del servicio.
- **Las claves quedan marcadas.** Si un servicio rechaza una clave o dice que no
  queda saldo, o si **Comprobar acceso** sale rechazado, la clave aparece
  marcada en esta pantalla hasta que tú quites la marca. Con el interruptor
  apagado la clave se sigue usando; la marca solo informa.
- **La pantalla se actualiza sola** cada 20 segundos, y una banda en la parte
  superior de todas las pantallas te avisa si hay un aviso pendiente o si los
  trabajos nuevos se están rechazando.
- **Si la banda dice «Estado sin comprobar».** Significa que la consola no ha
  podido leer el estado de las cuentas dos veces seguidas, así que lo que
  muestra puede estar desactualizado. Lo vuelve a intentar sola y el mensaje
  desaparece en cuanto una lectura sale bien. Si no desaparece, recarga la
  página; si sigue, el servicio no está respondiendo.
- **Si hay muchos avisos pendientes.** La banda cuenta el más reciente y dice
  cuántos más hay. Todos están en esta pantalla, cada uno con su botón
  **Descartar aviso**.
- **Cuenta elegida que no puede trabajar.** Si desactivas la cuenta elegida o
  revocas su clave actual, los trabajos nuevos se rechazan. La línea **Nuevos
  trabajos** y la banda lo dicen con el motivo («la cuenta elegida está
  desactivada» o «la clave actual está revocada localmente»). Se arregla
  activando la cuenta, eligiendo otra clave o eligiendo otra cuenta. Mientras
  dure, el estado que consulta el monitor de la casa pasa a «degradado», aunque
  no haya ningún aviso pendiente.
- **Si un cambio se queda sin confirmar.** Si al guardar algo en esta pantalla
  se corta la conexión, verás «No llegó la confirmación del cambio». El cambio
  no se reenvía solo. La lista se vuelve a leer y muestra lo que quedó guardado
  de verdad: míralo antes de repetir la acción.

Qué hace: si el servicio de transcripción rechaza una clave o responde que no
queda saldo o cuota, Media2Text prueba la siguiente clave de la misma cuenta y,
si ninguna sirve, pasa a la siguiente cuenta de tu lista. Esa cuenta puede ser
de otro servicio (por ejemplo, de Deepgram a AssemblyAI). Cada vez que ocurre,
te lo dice.

Antes de activar el interruptor, comprueba estas dos cosas. Son condiciones de
la revisión independiente, y sin ellas el interruptor no hace lo que esperas:

1. **Tienes elegida una cuenta guardada.** La elegiste con **Usar para nuevas
   transcripciones** y la línea **Nuevos trabajos** la nombra. Si esa línea
   dice que se usa la configuración existente, el interruptor no hace nada:
   las claves de la configuración existente (las de Doppler) no participan en
   el cambio automático, ni como punto de partida ni como respaldo.
2. **Has revisado la lista de respaldo.** Mira qué cuentas hay en ella, en qué
   orden y de qué servicio es cada una. Ahí es adonde irán los trabajos sin
   preguntarte. Si una cuenta de la lista es de otro servicio, la calidad de
   esas transcripciones puede cambiar.

Cómo activarlo, en **Ajustes > Cuentas de transcripción > Cambio automático de
clave o cuenta**:

1. Pulsa **Añadir a la lista** en cada cuenta que quieras permitir como
   respaldo. Solo las cuentas de esa lista, y que estén activas, pueden recibir
   trabajos. Una cuenta que no esté en la lista nunca los recibe de forma
   automática.
2. Ordénalas con **Subir** y **Bajar**. La cuenta que tengas elegida con
   **Usar para nuevas transcripciones** se usa primero; si falla, se sigue por
   la lista de arriba abajo.
3. Si una cuenta tiene varias claves, en **Gestionar cuenta y claves** verás su
   **Orden de uso automático** y podrás cambiarlo. La clave actual va primero.
4. Marca **Usar automáticamente la siguiente clave o cuenta**. La aplicación
   pide confirmar la contraseña si han pasado más de cinco minutos.

Cuándo cambia y cuándo no:

- Cambia solo si el servicio rechaza la petición **antes de aceptar el audio**:
  clave rechazada o sin permiso, o sin saldo o cuota. Solo cuentan las
  respuestas que cada servicio documenta; cualquier otra respuesta rara hace
  fallar el trabajo como hasta ahora.
- **No** cambia si hay un corte de red, una espera agotada, un error del
  servicio o cualquier fallo después de que el audio se haya aceptado. En esos
  casos el trabajo falla como hasta ahora, porque el primer servicio aún podría
  cobrarlo y reenviarlo a otro sería pagar dos veces.
- Los límites de gasto de Media2Text siguen aplicándose al servicio que acabe
  haciendo el trabajo. Nada los sube.
- Con las **claves de la configuración existente** (las de Doppler) no hay
  cambio automático. Para que funcione, elige una cuenta guardada en esta pantalla.

Qué significa el aviso. Aparece en la parte superior de todas las pantallas,
también en Ajustes, y se queda hasta que pulses **Descartar aviso** en Ajustes.
La pantalla se actualiza sola cada 20 segundos. Recibes un aviso **cada vez**
que hay un cambio automático: descartar uno no silencia el siguiente, aunque
sea igual; mientras no lo descartes, las repeticiones se suman en el mismo
aviso con un contador.

El aviso cuenta **lo que pasó**, en pasado:

- qué servicio rechazó una petición, y con qué cuenta y clave (sus cuatro
  últimos caracteres);
- por qué: respondió que **no quedaba saldo o cuota**, o **no aceptó la clave o
  su permiso**, con el código de respuesta;
- con qué cuenta y clave continuó el trabajo afectado;
- si cambió el servicio, una frase clara: «El servicio de transcripción cambió
  de X a Y: la calidad de esas transcripciones puede ser distinta.»

El aviso no dice qué se está usando ahora, porque eso puede haber cambiado
desde entonces. Lo que se usa en este momento lo ves aparte: en la frase «Ahora
mismo los trabajos nuevos van a…» que sigue al aviso, y en la línea **Nuevos
trabajos** de Ajustes.

Si el aviso dice que no quedaba ninguna clave o cuenta disponible, ese trabajo
falló. Los trabajos nuevos seguirán fallando hasta que hagas una de estas tres
cosas: recargar saldo, añadir una clave nueva o marcar una clave como disponible.

Si el aviso se titula **Grabación detenida**, una grabación larga que ya estaba
transcrita en parte se paró sin completarse: la siguiente cuenta de tu lista
era de otro servicio, y Media2Text no mezcla dos servicios en una misma
transcripción. Ninguna cuenta continuó esa grabación. **Si la transcribes de
nuevo, se repetirán también las partes que ya estaban hechas, y esas partes se
te pueden cobrar otra vez.** Decide tú si compensa. Los trabajos nuevos sí
cambian de cuenta, con su propio aviso.

Estado de cada clave. Una clave puede tener dos marcas distintas, cada una con
su fecha, y puede tener las dos a la vez:

- **Sin saldo o cuota desde…**: el servicio dijo que no quedaba saldo. Solo se
  quita con **Marcar como disponible**, después de recargar en la web del
  servicio. **Comprobar acceso** no la quita nunca, porque no puede confirmar
  el saldo.
- **Rechazada por el servicio desde…**: el servicio no aceptó la clave. Se
  quita cuando **Comprobar acceso** sale aceptado, o con **Marcar como
  disponible**, después de corregir o renovar la clave.

Con el interruptor activado, una clave con cualquiera de las dos marcas no
recibe trabajos nuevos. Las marcas no se quitan solas: una transcripción que
termine bien no las borra, porque pudo aceptarse antes del rechazo. Solo las
quitas tú. Los cuatro últimos caracteres de una clave solo se muestran en esta
pantalla y en estos avisos; no aparecen en registros ni en mensajes de error.

La línea **Nuevos trabajos** indica qué cuenta se está usando de verdad en cada
momento. Cada transcripción guarda además el servicio que la hizo.

Lo que aún no hace: no envía mensajes al teléfono. El aviso está en la
aplicación y en el estado que puede leer la monitorización de casa; el mensaje
de Telegram necesita un trabajo aparte en Sentinel y tu decisión de recibirlo.

## Dónde se guardan

Las cuentas nuevas y sus claves se guardan cifradas en el NAS, en
/share/Container/compose/youtube2text/private-credentials/credentials.sqlite.
El directorio es privado y solo la API monta ese estado. La clave maestra de
cifrado y el secreto de autorización entre web y API están en Doppler,
proyecto youtube2text, configuración prd; la web no recibe la clave maestra.
La copia privada y la recuperación requieren conservar la base de datos y
la clave maestra correspondiente. La recuperación comprobada es en el mismo NAS.

Las claves antiguas siguen en Doppler y se muestran en **Claves de la configuración
existente**. Puedes importarlas individualmente; importar no selecciona la cuenta
ni crea crédito. **Volver a esta configuración** restaura las claves antiguas
de ese proveedor. Añadir una cuenta nueva desde esta pantalla no requiere editar
Doppler ni recrear contenedores.

## Recuperar el acceso habitual

Si no recuerdas la contraseña de Media2Text, abre el panel de Doppler con tu
identidad habitual, selecciona el espacio **Xibstar** y entra en youtube2text > prd. La contraseña está en
Y2T_WEB_AUTH_PASSPHRASE; usa su control de revelar/copiar. Es también la ruta de recuperación existente.
Localizador: doppler://youtube2text/prd/Y2T_WEB_AUTH_PASSPHRASE.
La aplicación pide solo contraseña, sin nombre de usuario.

El agente ha comprobado la pertenencia del operador al almacén y el acceso de
la aplicación. La identificación formal del evento de modificación de esta
contraseña sigue pendiente; no se ha cambiado la contraseña para generar uno.

Se ha solicitado a Carlos, de forma opcional para usar la aplicación, la fecha y
hora exactas del evento de cambio de esa entrada en Doppler > Activity. Permitiría
completar el registro formal de la versión probada; no se pide la contraseña
ni cambiarla. El agente conserva el resto del cierre.
