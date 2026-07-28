# Sicurezza

## Segnalare una vulnerabilità

Non pubblicare vulnerabilità sfruttabili in una issue pubblica. Utilizzare una GitHub Security Advisory privata nel repository e includere:

- versione e sistema operativo;
- passaggi minimi per riprodurre il problema;
- impatto previsto;
- eventuale proof of concept non distruttiva.

## Modello di sicurezza

GitTree usa `contextIsolation`, mantiene `nodeIntegration` disabilitato nel renderer ed espone IPC esplicite attraverso il preload. I comandi Git raw non sono accessibili all’interfaccia.

Percorsi, branch, remote e URL esterni vengono validati nel processo main. Gli aggiornamenti OTA devono essere distribuiti tramite artefatti firmati e manifest generati dalla pipeline ufficiale.

## Versioni supportate

Durante la fase iniziale viene supportata esclusivamente l’ultima release stabile. Le correzioni di sicurezza vengono pubblicate come nuova versione patch.

