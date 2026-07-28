# Architettura degli aggiornamenti OTA

GitTree utilizza `electron-updater` e i manifest generati da electron-builder nelle GitHub Releases.

## Flusso applicativo

1. Il controllo è attivo solo quando `app.isPackaged` è vero.
2. La prima verifica avviene dopo 15 secondi, quindi ogni sei ore.
3. Una versione disponibile viene mostrata nella barra comandi.
4. Il download parte soltanto dopo l’azione dell’utente.
5. L’installazione richiede un secondo comando esplicito di riavvio.
6. Se l’utente chiude normalmente l’app dopo il download, l’aggiornamento resta pronto per l’installazione.

Il renderer non riceve URL arbitrari e non può eseguire comandi di aggiornamento raw. Le uniche IPC esposte sono:

- `update:get-state`
- `update:check`
- `update:download`
- `update:install`

## Stati

`disabled → idle → checking → available → downloading → downloaded`

Gli errori manuali passano a `error`; gli errori dei controlli periodici non interrompono il lavoro dell’utente.

## Artefatti richiesti

electron-builder pubblica:

- `latest.yml` per Windows;
- `latest-mac.yml` e ZIP per macOS;
- `latest-linux.yml` per Linux;
- installer, AppImage, DMG e relativi file `.blockmap`.

Non rinominare o rimuovere manualmente i manifest da una release.

## Sicurezza

- Il provider è vincolato al repository GitHub configurato in `electron-builder.yml`.
- I manifest contengono hash degli artefatti.
- I downgrade sono disabilitati.
- Le prerelease sono accettate solo da una versione che appartiene già a un canale prerelease.
- La firma del codice deve essere configurata prima della distribuzione pubblica.
- Nessun token di pubblicazione o aggiornamento viene distribuito dentro l’app: il repository di aggiornamento deve rimanere pubblico per questo modello.
- I client ID OAuth pubblici inclusi nella build non autorizzano la pubblicazione di release e sono separati dai token utente cifrati a runtime.

## Rollback

Un rollback non deve riutilizzare lo stesso numero di versione. Pubblicare una nuova patch contenente il codice stabile precedente. La modifica di un artefatto già pubblicato rende ambiguo il manifest e deve essere evitata.

## Provider futuro

Per migrare a S3 o a un update server dedicato:

1. cambiare il blocco `publish`;
2. mantenere invariati i canali IPC e la macchina a stati;
3. verificare manifest per ogni piattaforma;
4. non introdurre credenziali permanenti nel renderer o nel pacchetto.
