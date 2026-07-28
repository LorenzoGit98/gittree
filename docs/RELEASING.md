# Pubblicare una release di GitTree

Questa guida descrive il percorso supportato per produrre installer locali o pubblicare una release ufficiale con aggiornamenti OTA.

## Prerequisiti

- Node.js 22 o successivo.
- npm e Git disponibili nel `PATH`.
- Working tree pulito.
- Versione SemVer coerente in `package.json`.
- Per le release ufficiali: repository GitHub `lorenzogit98/gittree-minimal`.
- Per una distribuzione attendibile: certificati di firma Windows e macOS e credenziali Apple per la notarizzazione.

## Controlli prima della release

```powershell
npm ci
npm run validate
npm run prepare:assets
```

`prepare:assets` controlla che `icon.png` sia quadrata, abbia almeno 512×512 pixel e contenga un canale alpha. Copia quindi il master in `build/icon.png`, da cui electron-builder genera le varianti native.

## Build locali

Build non installabile, utile per verificare il contenuto dell’app:

```powershell
npm run build
```

Installer per il sistema operativo corrente:

```powershell
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Gli artefatti vengono scritti in `dist/` e non vengono pubblicati.

## Release automatica

La release ufficiale parte da un tag Git:

```powershell
npm version patch
git push origin main --follow-tags
```

Sostituire `patch` con `minor` o `major` quando appropriato. Il workflow `.github/workflows/release.yml`:

1. verifica che il tag `vX.Y.Z` coincida con `package.json`;
2. esegue test e audit;
3. costruisce Windows, macOS e Linux sui rispettivi runner;
4. pubblica installer, blockmap e manifest OTA nella stessa GitHub Release.

Non creare manualmente un tag che non corrisponde alla versione del pacchetto: `release:check` bloccherebbe la pipeline.

## Artefatti

| Sistema | Artefatti | OTA |
| --- | --- | --- |
| Windows x64 | Installer NSIS assistito | Sì |
| macOS x64/arm64 | DMG e ZIP | Sì, lo ZIP è obbligatorio |
| Linux x64 | AppImage e DEB | AppImage |

I nomi seguono lo schema `GitTree-versione-sistema-architettura.estensione`.

## Firma e notarizzazione

Configurare i seguenti GitHub Actions secrets:

- `WINDOWS_CSC_LINK`
- `WINDOWS_CSC_KEY_PASSWORD`
- `MACOS_CSC_LINK`
- `MACOS_CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

La pipeline può tecnicamente produrre build non firmate, ma non devono essere considerate release pubbliche definitive. La firma riduce gli avvisi del sistema operativo ed è un requisito fondamentale della catena di fiducia degli aggiornamenti.

## Release candidate e prerelease

Versioni come `1.2.0-beta.1` sono riconosciute dal runtime come prerelease. Una build stabile non accetta automaticamente downgrade o prerelease. Prima di introdurre canali beta pubblici separati, creare release di prova e verificare la generazione dei relativi manifest.

## Verifica post-release

1. Installare la release su una macchina pulita.
2. Controllare icona, collegamenti e disinstallazione.
3. Avviare l’app e aprire una repository reale.
4. Pubblicare una versione patch successiva.
5. Verificare comparsa, download e installazione dell’aggiornamento.
6. Conservare la release precedente finché il rollout non è stato validato.

