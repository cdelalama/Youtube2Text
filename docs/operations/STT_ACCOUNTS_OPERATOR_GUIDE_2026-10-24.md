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
