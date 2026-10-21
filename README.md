# Zoho Mail Tray

A small Linux desktop app for opening multiple Zoho Mail accounts in separate windows, with a system tray menu for switching between them.

> **Linux only. Tested only on Linux Mint 22.3.** The downloadable package is for 64-bit Debian-based systems, but no distribution other than Linux Mint 22.3 has been tested. There are no Windows or macOS builds.

This is an independent community project. It is not made, supported, or endorsed by Zoho.

## Download and install

Download the latest `zoho-mail-tray_*_amd64.deb` from the repository’s **Releases** page. In a terminal, move to the download directory and install it with:

```sh
sudo apt install ./zoho-mail-tray_0.2.3_amd64.deb
```

You can also open the downloaded `.deb` in Linux Mint’s software installer. The package can be installed over an earlier version. Launch **Zoho Mail Tray** from the applications menu.

The first launch reads account names and their order from the previous app configuration, if available. Electron uses a different browser profile format, so sign in to each account again after moving from the earlier Tauri version. Previous session data is left in place.

## Features

- Keep each Zoho account signed in using its own Chromium profile.
- Add, rename, remove, reorder, open, and close accounts in the account manager.
- Switch accounts from the tray menu, or optionally enable `Ctrl+1` through `Ctrl+9` shortcuts. Shortcuts follow the account order and are system-wide while enabled.
- Start with the first account in the list. A second launch brings the running app forward.
- Restore saved window size and position; Zoho pop-up windows use the same dimensions.
- Keep Zoho pages inside the app and open external links in your default browser.
- Copy external links from their right-click menu.
- Use Zoho’s desktop notification settings and Linux desktop notifications.
- Optionally start the app when you log in.

## Usage

Right-click the tray icon to switch accounts, open the account manager, hide account windows, or enable **Start when I log in**. Click the tray icon to show or hide the first account window.

In the account manager, accounts can be reordered with the arrow buttons. The first account is the one shown on startup. Enable account shortcuts below the list if you want `Ctrl+1`, `Ctrl+2`, and so on. The first nine accounts receive shortcuts.

To set up mail notifications, enable them under **Zoho Mail → Settings → Notifications → Desktop Notifications**, then check that notifications are enabled in Linux Mint. Notification delivery depends on the desktop notification service.

## Build from source

Use Node.js 22 or newer. From the project directory, run:

```sh
npm ci
npm start
```

To build a Debian package:

```sh
npm run dist:linux
```

The `.deb` is written to `outputs/electron/`. The release package currently targets `amd64`.

## Data and privacy

Account names and ordering are stored in `~/.config/com.example.zohomailtray/`. Chromium profile data for the accounts is stored under `~/.local/share/com.example.zohomailtray/electron-session-data/` (or under `$XDG_DATA_HOME` when set). The app asks Chromium to use GNOME Keyring through `libsecret` for password storage. Whether the desktop session encrypts stored secrets depends on a working Secret Service/keyring configuration.

The app connects to Zoho Mail and its services to display your account. No application server is operated by this project.

## Project and attribution

The desktop app is built with Electron and Chromium. **The code was written with OpenAI Codex**, guided and tested by the project maintainer.

## License

No open-source license has been selected for this project yet. Public availability of the repository does not by itself grant permission to reuse or redistribute the source code.
