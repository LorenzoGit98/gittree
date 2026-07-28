# Configurare OAuth per il review panel

GitTree usa Device Flow e non incorpora client secret. I client ID sono identificatori pubblici inseriti nella build dalla pipeline release.

## GitHub App

Creare una GitHub App con Device Flow attivo e callback web non utilizzata dall’app desktop. Configurare i permessi minimi:

| Area | Permesso |
| --- | --- |
| Metadata | Read-only |
| Contents | Read-only |
| Pull requests | Read and write |
| Checks | Read-only |
| Commit statuses | Read-only |

Abilitare l’accesso agli account utente necessario per leggere il profilo. Installare la GitHub App sulle organizzazioni o repository da usare con GitTree. Copiare il Client ID pubblico nella repository variable `GITTREE_GITHUB_CLIENT_ID`.

Il flusso di autorizzazione dipende dai permessi della GitHub App: GitTree non richiede lo scope OAuth generico `repo` e non gestisce un client secret.

## GitLab.com OAuth Application

Creare un’OAuth Application su GitLab.com con Device Authorization Grant abilitato e scope `api`. Copiare l’Application ID pubblico nella repository variable `GITTREE_GITLAB_CLIENT_ID`.

GitLab self-hosted non entra nel vault OAuth di questa versione: creazione, merge e azioni non supportate proseguono nel browser.

## Build

La pipeline passa le variabili a `prepare:assets`, che genera:

```text
build/oauth-config.json
```

electron-builder copia il file nelle risorse dell’app. Il controllo:

```powershell
npm run release:check
```

fallisce quando uno dei client ID è assente o malformato.

## Archiviazione e revoca

- Windows e macOS usano il backend del sistema operativo esposto da Electron `safeStorage`.
- Linux usa `safeStorage` soltanto quando il backend selezionato è cifrato.
- Con backend Linux `basic_text`, token e draft restano esclusivamente in memoria.
- Logout elimina l’account attivo del provider dal vault locale.
- La revoca server-side resta disponibile nelle impostazioni GitHub o GitLab dell’utente.

Token, refresh token e header HTTP non attraversano il preload e non vengono inseriti nei log operazioni.
