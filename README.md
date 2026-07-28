<p align="center">
  <img src="icon.png" width="160" alt="GitTree">
</p>

<h1 align="center">GitTree</h1>

<p align="center">
  Un client Git desktop veloce, visuale e concreto, progettato per rendere branch, commit e conflitti immediatamente comprensibili.
</p>

<p align="center">
  <a href="https://github.com/lorenzogit98/gittree-minimal/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/lorenzogit98/gittree-minimal/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/lorenzogit98/gittree-minimal/releases"><img alt="Release" src="https://img.shields.io/github/v/release/lorenzogit98/gittree-minimal?display_name=tag"></a>
  <a href="LICENSE"><img alt="Licenza ISC" src="https://img.shields.io/badge/license-ISC-102A4C"></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F">
</p>

---

## Perché esiste GitTree

Git è uno strumento estremamente potente, ma la sua rappresentazione testuale non è sempre il modo migliore per comprendere una repository complessa. Quando aumentano branch, remote, merge e commit paralleli, diventa difficile rispondere velocemente a domande molto semplici:

- dove si trova il branch corrente?
- da quale linea di sviluppo nasce un commit?
- quali branch sono già confluiti?
- cosa verrà modificato da un merge o da un rebase?
- quali file stanno bloccando un’operazione?
- qual è la differenza reale tra il branch selezionato e quello corrente?

GitTree nasce per rispondere a queste domande senza nascondere Git e senza sostituirlo con un modello proprietario. L’applicazione usa la repository locale, invoca operazioni Git esplicite e presenta il risultato attraverso un workspace visuale ad alte prestazioni.

Lo scopo non è aggiungere decorazione a Git. Lo scopo è ridurre il carico cognitivo necessario per lavorare in sicurezza su una cronologia reale.

## Visione del prodotto

GitTree vuole essere un’alternativa moderna ai client Git desktop tradizionali:

- leggibile come un diagramma;
- rapida come uno strumento nativo;
- trasparente nelle operazioni che esegue;
- utilizzabile anche su repository con cronologie estese;
- priva di account obbligatori, telemetria o sincronizzazioni proprietarie;
- coerente su Windows, macOS e Linux.

L’interfaccia combina la chiarezza delle applicazioni Apple con un workspace bento concreto e completamente opaco. Non vengono utilizzati glassmorphism, blur, glow, trasparenze funzionali o effetti che riducono leggibilità e prestazioni.

## Funzionalità principali

### Workspace multi-repository

- Repository aperte come tab integrati nella finestra.
- Tab attivo ripristinato all’avvio.
- Pannelli branch e Inspector ridimensionabili.
- Posizione, larghezza e stato dei pannelli persistenti.
- Inspector chiudibile e massimizzabile.

### Branch locali e remoti

- Navigazione gerarchica per cartelle.
- Ricerca istantanea.
- Click singolo per selezione secondaria.
- Doppio click per checkout, evitando cambi branch involontari.
- Nomi abbreviati all’interno delle cartelle senza perdere il ref completo.
- Distinzione chiara tra branch corrente e branch semplicemente selezionato.

### Menu contestuale in stile SourceTree

Il click destro su un branch espone azioni coerenti con il tipo di ref:

- checkout locale o checkout con tracking da remoto;
- merge nel branch corrente;
- rebase del branch corrente;
- fetch del branch;
- pull e push dell’upstream;
- push verso un remote scelto;
- configurazione del tracking;
- confronto con il branch corrente;
- rename;
- eliminazione locale sicura e force delete con seconda conferma;
- eliminazione remota;
- creazione di pull request o merge request.

Le azioni non applicabili restano visibili ma disabilitate con una spiegazione. Merge e rebase non eseguono stash automatici e non modificano silenziosamente un working tree sporco.

### Graph Git multi-lane

- Topologia calcolata dai parent reali dei commit.
- Primo parent continuo e curve dedicate ai merge.
- Supporto per merge con più parent e cronologie scollegate.
- Ref locali, remoti, tag e `HEAD`.
- Palette semantica a otto lane.
- Paginazione progressiva da 500 commit.
- Virtualizzazione a riga fissa.
- Meno di 100 righe mantenute nel DOM anche su dataset molto grandi.

Il graph non è una rappresentazione decorativa: deriva direttamente da `git log --all --topo-order --date-order --parents`.

### Merge, rebase e conflitti reali

- Preview prima del merge.
- Strategie `ff`, `no-ff` e `squash` passate realmente a Git.
- Rilevamento di merge o rebase pendenti anche dopo il riavvio.
- Lettura degli stage Git base, ours e theirs.
- Editor ours/theirs/result per file testuali.
- Risoluzione manuale e `git add` esplicito.
- Selezione ours/theirs per conflitti binari.
- Continue disponibile soltanto quando non restano file unmerged.
- Abort sempre protetto da conferma.

### Pull request nel browser

GitTree riconosce remote SSH e HTTPS di:

- GitHub;
- GitLab, incluse installazioni self-hosted;
- Bitbucket Cloud.

L’app prepara source e target e prosegue nel browser autenticato dell’utente. Non memorizza access token e non richiede credenziali del provider.

### Temi e localizzazione

- Light.
- Dark.
- Black completamente nero.
- Italiano.
- Inglese con fallback predefinito.

Tutte le superfici funzionali restano opache in ogni tema.

## Prestazioni

Le prestazioni sono un requisito di prodotto, non un’ottimizzazione successiva.

Il renderer utilizza:

- virtualizzazione del graph;
- overscan limitato;
- gestione dello scroll tramite `requestAnimationFrame`;
- `content-visibility` e containment sulle liste dense;
- selezione aggiornata in-place;
- resize con preview basata su transform e un solo commit del layout al rilascio;
- caricamento incrementale della cronologia.

Il benchmark deterministico incluso nel repository usa un graph sintetico da 10.000 commit e verifica:

- meno di 100 righe DOM;
- scroll medio e p95 inferiori a 1 ms;
- nessun campione superiore a 8 ms.

Esecuzione:

```powershell
npx electron . --remote-debugging-port=9222
npm run perf:renderer
```

## Privacy e sicurezza

GitTree lavora localmente:

- nessun account GitTree;
- nessuna telemetria integrata;
- nessun upload automatico delle repository;
- nessun token GitHub, GitLab o Bitbucket conservato dall’app;
- nessun comando Git raw esposto al renderer.

L’architettura Electron mantiene `contextIsolation` attivo e `nodeIntegration` disabilitato. Il preload espone operazioni IPC specifiche, mentre processo main e backend validano ref, remote, percorsi e URL esterni.

Per segnalazioni sensibili consultare [SECURITY.md](SECURITY.md).

## Stato del progetto

GitTree è in sviluppo attivo. Il workspace, il graph, le azioni contestuali e il recupero conflitti sono funzionanti. Alcune aree rimangono intenzionalmente in evoluzione:

- clonazione guidata dalla schermata iniziale;
- integrazioni avanzate con hosting Git;
- firma definitiva degli installer pubblici;
- canali beta separati;
- ulteriori workflow per stash, tag e submodule.

Le funzionalità incomplete non vengono presentate come operazioni automatiche affidabili.

## Installazione

### Release

Scaricare l’installer appropriato dalla pagina [GitHub Releases](https://github.com/lorenzogit98/gittree-minimal/releases):

- Windows: installer NSIS;
- macOS: DMG;
- Linux: AppImage o pacchetto DEB.

Fino all’attivazione dei certificati di produzione, il sistema operativo potrebbe mostrare un avviso per le build non firmate.

### Avvio dal sorgente

Requisiti:

- Node.js 22 o successivo;
- Git;
- npm.

```powershell
git clone https://github.com/lorenzogit98/gittree-minimal.git
cd gittree-minimal
npm ci
npm start
```

## Sviluppo

### Comandi disponibili

| Comando | Scopo |
| --- | --- |
| `npm start` | Avvia l’app Electron |
| `npm test` | Esegue i test `node:test` |
| `npm run audit:design` | Verifica le regole del design system |
| `npm run validate` | Esegue test e audit |
| `npm run test:renderer-ui` | Verifica i contratti UI via Chrome DevTools Protocol |
| `npm run perf:renderer` | Esegue il benchmark del renderer |
| `npm run prepare:assets` | Valida e prepara l’icona |
| `npm run build` | Produce una directory applicativa non installabile |
| `npm run dist:win` | Genera l’installer Windows |
| `npm run dist:mac` | Genera DMG e ZIP macOS |
| `npm run dist:linux` | Genera AppImage e DEB |

### Struttura

```text
GitTree
├── .github/
│   ├── workflows/          CI e pubblicazione release
│   └── dependabot.yml
├── build/                  asset preparati per electron-builder
├── docs/
│   ├── RELEASING.md
│   └── UPDATES.md
├── scripts/                audit, benchmark e controlli release
├── src/
│   ├── main/               finestra, IPC, Git e aggiornamenti
│   ├── preload.js          bridge esplicito e isolato
│   └── renderer/           workspace, componenti, temi e i18n
├── test/                   test Git e funzioni pure
├── DESIGN.md               specifica visuale canonica
├── electron-builder.yml    configurazione multipiattaforma
└── icon.png                icona master 1024×1024
```

## Build e release

La configurazione electron-builder vive in [electron-builder.yml](electron-builder.yml). Gli artefatti locali finiscono in `dist/` e non vengono pubblicati.

La guida completa è in [docs/RELEASING.md](docs/RELEASING.md). In sintesi:

```powershell
npm ci
npm run validate
npm run dist:win
```

Una release ufficiale viene avviata da un tag SemVer:

```powershell
npm version patch
git push origin main --follow-tags
```

GitHub Actions costruisce separatamente Windows, macOS e Linux, evitando cross-build non affidabili.

## Aggiornamenti OTA

L’infrastruttura OTA è predisposta con `electron-updater`:

- controlli solo nelle build pacchettizzate;
- verifica iniziale ritardata e controlli periodici;
- download richiesto dall’utente;
- avanzamento visibile;
- installazione tramite riavvio esplicito;
- downgrade disabilitati;
- manifest per piattaforma generati insieme alla release.

Gli aggiornamenti diventano una catena di distribuzione realmente attendibile quando gli installer sono firmati e macOS è notarizzato. Dettagli e modello di sicurezza sono descritti in [docs/UPDATES.md](docs/UPDATES.md).

## Design system

[DESIGN.md](DESIGN.md) è la specifica canonica. Le regole principali sono:

- superfici funzionali completamente opache;
- gradienti soltanto sul canvas esterno;
- palette quasi monocromatica guidata dal blu notte;
- bordi sottili e ombre morbide;
- niente glassmorphism, glow o neumorphism;
- icone Phosphor regular;
- tipografia di sistema compatibile con SF Pro;
- accessibilità da tastiera e contrasto WCAG 2.2 AA.

## Contribuire

Prima di proporre una modifica:

1. mantenere le operazioni Git esplicite e reversibili;
2. non introdurre token o credenziali nel renderer;
3. aggiungere insieme testi inglesi e italiani;
4. rispettare il design system;
5. aggiungere test per logica Git, graph o regressioni UI;
6. eseguire `npm run validate`.

Issue e proposte possono essere aperte nella sezione [Issues](https://github.com/lorenzogit98/gittree-minimal/issues).

## Licenza

GitTree è distribuito con licenza [ISC](LICENSE).

