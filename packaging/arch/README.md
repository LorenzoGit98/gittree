# Arch Linux packaging for GitTree

Il flusso di release ufficiale (`.github/workflows/release.yml`) genera per Linux:

- `GitTree-<ver>-linux-x86_64.AppImage`
- `GitTree-<ver>-linux-amd64.deb`

Questo PKGBUILD (`gittree-bin`) **riconfeziona il `.deb` ufficiale** per Arch Linux:
installa in `/opt/GitTree`, registra `gittree.desktop`, icona hicolor e rende
setuid `chrome-sandbox` (niente `--no-sandbox`).

## Build e installazione

```bash
cd packaging/arch
makepkg -si          # build + pacman -U
```

oppure, solo build:

```bash
makepkg -f
```

## Disinstallazione

```bash
sudo pacman -R gittree-bin
```

I dati utente restano in `~/.config/gittree` (non vengono toccati).

## Aggiornamento a una nuova release

1. Leggere la release su `https://github.com/giannoccarol/gittree/releases`
   (o `gh release view v<ver>`).
2. Aggiornare in `PKGBUILD`:
   - `pkgver=<ver>`
   - `sha256sums` con lo sha256 di `GitTree-<ver>-linux-amd64.deb`
3. Rigenerare `.SRCINFO`:
   ```bash
   makepkg --printsrcinfo > .SRCINFO
   ```

## Pubblicazione AUR (opzionale)

Per pubblicare su AUR basta clonare il repository AUR `gittree-bin`,
copiare `PKGBUILD` + `.SRCINFO` e fare `git push` sul repo AUR.