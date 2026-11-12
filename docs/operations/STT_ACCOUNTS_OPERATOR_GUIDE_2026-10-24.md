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

**Todavía no está instalado.** Llega con la versión 0.43.1, que está preparada
en el código y pendiente de una segunda revisión independiente y de
instalación. El NAS sigue con la 0.42.2, donde esta sección no aparece. Cuando
se instale, nada cambia hasta que actives el interruptor: viene desactivado.

Qué hace: si el servicio de transcripción rechaza una clave o responde que no
queda saldo o cuota, Media2Text prueba la siguiente clave de la misma cuenta y,
si ninguna sirve, pasa a la siguiente cuenta de tu lista. Esa cuenta puede ser
de otro servicio (por ejemplo, de Deepgram a AssemblyAI). Cada vez que ocurre,
te lo dice.

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
aviso con un contador. Dice:

- qué cuenta y qué clave (sus cuatro últimos caracteres) han dejado de usarse;
- por qué: **sin saldo o cuota** o **clave rechazada**, con el código de respuesta;
- qué cuenta y clave se usan ahora;
- si ha cambiado el servicio, una frase clara: «Ha cambiado el servicio de
  transcripción: de X a Y. La calidad de las transcripciones puede ser distinta.»

Si el aviso dice que no queda ninguna clave o cuenta disponible, los trabajos
fallan hasta que hagas una de estas tres cosas: recargar saldo, añadir una
clave nueva o marcar una clave como disponible.

Si el aviso se titula **Grabación detenida**, una grabación larga que ya estaba
transcrita en parte se ha parado sin completarse: la siguiente cuenta de tu
lista es de otro servicio, y Media2Text no mezcla dos servicios en una misma
transcripción ni paga dos veces la parte ya hecha. Ninguna cuenta ha tomado el
relevo para esa grabación. Vuelve a lanzarla y se transcribirá entera con el
servicio siguiente. Los trabajos nuevos sí cambian de cuenta, con su propio aviso.

Estado de cada clave. Junto a cada clave verás **Sin saldo o cuota desde…** o
**Rechazada por el servicio desde…** cuando el servicio lo haya dicho. Con el
interruptor activado, esa clave no se usa para trabajos nuevos. La marca no se
quita sola: una transcripción que termine bien no la borra, porque pudo
aceptarse antes del rechazo. Solo la quitas tú. Para volver a usarla:

- Sin saldo: recarga en la web del servicio y pulsa **Marcar como disponible**.
  **Comprobar acceso** no sirve para esto, porque no puede confirmar el saldo.
- Rechazada: corrige o renueva la clave y pulsa **Comprobar acceso** o
  **Marcar como disponible**.

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
