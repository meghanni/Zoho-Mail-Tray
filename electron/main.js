'use strict';

const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, session, shell, clipboard, globalShortcut } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.umask(0o077);
app.setName('Zoho Mail Tray');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

const APP_ID = 'com.example.zohomailtray';
const CONFIG_DIR = path.join(app.getPath('appData'), APP_ID);
const DATA_HOME = process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share');
const DATA_ROOT = path.join(DATA_HOME, APP_ID);
const SESSION_DATA = path.join(DATA_ROOT, 'electron-session-data');
const CONFIG_FILE = path.join(CONFIG_DIR, 'accounts.json');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
const WINDOW_STATE_FILE = path.join(DATA_ROOT, 'window-state.json');
const ACCOUNT_MANAGER_FILE = path.join(__dirname, '..', 'web', 'index.html');
const APP_ICON = path.join(__dirname, '..', 'icons', 'zoho-tray.png');
const PRELOAD_FILE = path.join(__dirname, 'preload.js');
const ACCOUNT_PREFIX = 'acct-';
const ZOHO_DOMAINS = [
  'zoho.com', 'zoho.eu', 'zoho.in', 'zoho.com.au', 'zoho.jp', 'zoho.ca',
  'zohocloud.ca', 'zoho.com.cn', 'zoho.com.sg', 'zoho.co.uk', 'zoho.uk',
  'zoho.ae', 'zoho.sa'
];

app.setPath('userData', CONFIG_DIR);
app.setPath('sessionData', SESSION_DATA);

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) app.quit();

let tray;
let isQuitting = false;
let accounts = [];
let accountShortcutsEnabled = false;
let mailWindows = new Map();
let managerWindow;
let windowState = { width: 1180, height: 780, maximized: false };
let saveWindowTimer;

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch (_) {}
}

function secureTree(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      secureTree(child);
      try { fs.chmodSync(child, 0o700); } catch (_) {}
    } else if (entry.isFile()) {
      try { fs.chmodSync(child, 0o600); } catch (_) {}
    }
  }
}

function saveJson(file, value) {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loadAccounts() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (Array.isArray(parsed) && parsed.length > 0) {
      accounts = parsed.filter(account => account && typeof account.id === 'string');
    }
  } catch (_) {}
  if (!accounts.some(account => account.id === 'default')) {
    accounts.unshift({ id: 'default', name: 'Zoho Mail', region: 'com' });
    saveAccounts();
  }
  accounts = accounts.map(account => ({
    id: account.id,
    name: typeof account.name === 'string' && account.name.trim() ? account.name.trim() : 'Zoho Mail',
    region: supportedRegion(account.region) ? account.region : 'com'
  }));
}

function saveAccounts() {
  saveJson(CONFIG_FILE, accounts);
}

function loadSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    accountShortcutsEnabled = settings.accountShortcutsEnabled === true;
  } catch (_) {}
}

function registerAccountShortcuts() {
  globalShortcut.unregisterAll();
  if (!accountShortcutsEnabled) return [];
  const unavailable = [];
  accounts.slice(0, 9).forEach((account, index) => {
    const accelerator = `CommandOrControl+${index + 1}`;
    if (!globalShortcut.register(accelerator, () => openAccount(account.id).catch(error => console.error('Could not switch account:', error)))) {
      unavailable.push(`Ctrl+${index + 1}`);
    }
  });
  return unavailable;
}

function supportedRegion(region) {
  return ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'com.cn', 'ae', 'sa'].includes(region);
}

function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Give this account a name.');
  if ([...name.trim()].length > 60) throw new Error('Account names must be 60 characters or fewer.');
  return name.trim();
}

function mailUrl(account) {
  if (!supportedRegion(account.region)) throw new Error('Choose a supported Zoho region.');
  return `https://mail.zoho.${account.region}`;
}

function accountById(id) {
  const account = accounts.find(item => item.id === id);
  if (!account) throw new Error('That account no longer exists.');
  return account;
}

function accountSession(id) {
  return session.fromPartition(`persist:zoho-mail-${id}`);
}

function isZohoUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) {
    if (url.protocol !== 'blob:') return false;
    try { url = new URL(url.pathname); } catch (_) { return false; }
  }
  const host = url.hostname.toLowerCase();
  return ZOHO_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function openExternal(value) {
  if (!/^(https?:|mailto:)/i.test(value)) return;
  shell.openExternal(value).catch(error => console.error('Could not open external link:', error));
}

function sanitizeWindowState() {
  const displays = screen.getAllDisplays();
  const intersectsDisplay = displays.some(display => {
    const area = display.workArea;
    return windowState.x < area.x + area.width && windowState.x + windowState.width > area.x &&
      windowState.y < area.y + area.height && windowState.y + windowState.height > area.y;
  });
  if (!Number.isFinite(windowState.width) || windowState.width < 720) windowState.width = 1180;
  if (!Number.isFinite(windowState.height) || windowState.height < 520) windowState.height = 780;
  if (!Number.isFinite(windowState.x) || !Number.isFinite(windowState.y) || !intersectsDisplay) {
    const area = screen.getPrimaryDisplay().workArea;
    windowState.x = Math.round(area.x + (area.width - windowState.width) / 2);
    windowState.y = Math.round(area.y + (area.height - windowState.height) / 2);
  }
}

function loadWindowState() {
  try {
    windowState = { ...windowState, ...JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8')) };
  } catch (_) {}
  sanitizeWindowState();
}

function scheduleSaveWindowState(window) {
  clearTimeout(saveWindowTimer);
  saveWindowTimer = setTimeout(() => {
    if (window.isDestroyed() || window.isMaximized() || window.isMinimized()) return;
    const bounds = window.getBounds();
    windowState = { ...bounds, maximized: window.isMaximized() };
    saveJson(WINDOW_STATE_FILE, windowState);
  }, 250);
}

function setWindowSecurity(window, accountId) {
  const contents = window.webContents;
  const ses = accountSession(accountId);
  contents.on('context-menu', (_event, params) => {
    const link = params.linkURL;
    if (!/^(https?:|mailto:)/i.test(link) || isZohoUrl(link)) return;
    Menu.buildFromTemplate([
      { label: 'Copy link', click: () => clipboard.writeText(link) }
    ]).popup({ window });
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || isZohoUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: window,
          width: windowState.width,
          height: windowState.height,
          minWidth: 720,
          minHeight: 520,
          show: true,
          autoHideMenuBar: true,
          backgroundColor: '#1c1d20',
          webPreferences: {
            session: ses,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
          }
        }
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  const routeNavigation = (event, url) => {
    if (isZohoUrl(url) || url === 'about:blank') return;
    event.preventDefault();
    openExternal(url);
  };
  contents.on('will-navigate', routeNavigation);
  contents.on('will-redirect', routeNavigation);
  contents.on('did-create-window', child => {
    child.setMenuBarVisibility(false);
    setWindowSecurity(child, accountId);
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      if (contents.isDevToolsOpened()) contents.closeDevTools();
      else contents.openDevTools({ mode: 'detach' });
      event.preventDefault();
    }
  });

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const origin = webContents.getURL();
    callback(permission === 'notifications' && isZohoUrl(origin));
  });
  ses.setPermissionCheckHandler((webContents, permission, origin) => {
    return permission === 'notifications' && isZohoUrl(origin);
  });
}

async function openAccount(id) {
  const account = accountById(id);
  const existing = mailWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }

  const window = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: account.name,
    icon: APP_ICON,
    autoHideMenuBar: true,
    backgroundColor: '#1c1d20',
    webPreferences: {
      session: accountSession(id),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mailWindows.set(id, window);
  setWindowSecurity(window, id);

  window.on('resize', () => scheduleSaveWindowState(window));
  window.on('move', () => scheduleSaveWindowState(window));
  window.on('maximize', () => {
    windowState.maximized = true;
    saveJson(WINDOW_STATE_FILE, windowState);
  });
  window.on('unmaximize', () => {
    windowState.maximized = false;
    scheduleSaveWindowState(window);
  });
  window.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
      refreshTrayMenu();
    }
  });
  window.on('closed', () => {
    if (mailWindows.get(id) === window) mailWindows.delete(id);
    refreshTrayMenu();
  });
  window.webContents.on('did-finish-load', () => {
    if (!window.isDestroyed()) {
      if (windowState.maximized) window.maximize();
      window.show();
      window.focus();
    }
  });
  await window.loadURL(mailUrl(account));
  refreshTrayMenu();
}

function showFirstAccount() {
  const first = accounts[0];
  if (first) openAccount(first.id).catch(console.error);
}

function hideAllAccountWindows() {
  for (const window of mailWindows.values()) {
    if (!window.isDestroyed()) window.hide();
  }
  refreshTrayMenu();
}

function toggleFirstAccount() {
  const first = accounts[0];
  const window = first && mailWindows.get(first.id);
  if (window && !window.isDestroyed() && window.isVisible()) window.hide();
  else showFirstAccount();
  refreshTrayMenu();
}

function focusPrimaryOnly() {
  if (managerWindow && !managerWindow.isDestroyed()) managerWindow.hide();
  for (const [id, window] of mailWindows) {
    if (accounts[0]?.id !== id && !window.isDestroyed()) window.hide();
  }
  showFirstAccount();
}

function autostartFile() {
  return path.join(app.getPath('home'), '.config', 'autostart', 'com.example.zohomailtray.desktop');
}

function legacyAutostartFiles() {
  const directory = path.dirname(autostartFile());
  return [path.join(directory, 'zoho-mail-tray-electron.desktop'), path.join(directory, 'zoho-mail-tray.desktop')];
}

function isAutostartEnabled() {
  return [autostartFile(), ...legacyAutostartFiles()].some(file => fs.existsSync(file));
}

function quoteDesktop(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function setAutostart(enabled) {
  const file = autostartFile();
  if (!enabled) {
    for (const entry of [file, ...legacyAutostartFiles()]) {
      try { fs.rmSync(entry, { force: true }); } catch (error) { console.error('Could not disable login launch:', error); }
    }
    refreshTrayMenu();
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  const exec = app.isPackaged
    ? quoteDesktop(app.getPath('exe'))
    : `${quoteDesktop(process.execPath)} ${quoteDesktop(path.resolve(__dirname, '..'))}`;
  fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Zoho Mail Tray\nExec=${exec}\nIcon=${APP_ICON}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, { mode: 0o644 });
  for (const legacyFile of legacyAutostartFiles()) {
    try { fs.rmSync(legacyFile, { force: true }); } catch (error) { console.error('Could not remove an old login-launch entry:', error); }
  }
  refreshTrayMenu();
}

function makeTrayMenu() {
  const switches = accounts.map((account, index) => ({
    label: `${accountShortcutsEnabled && index < 9 ? `Ctrl+${index + 1}  ` : ''}${account.name}`,
    click: () => openAccount(account.id).catch(error => console.error('Could not open account:', error))
  }));
  return Menu.buildFromTemplate([
    { label: 'Toggle first account', click: toggleFirstAccount },
    { label: 'Open first account', click: showFirstAccount },
    { label: 'Hide all account windows', click: hideAllAccountWindows },
    { type: 'separator' },
    { label: 'Switch account', submenu: switches },
    { label: 'Manage accounts…', click: openAccountManager },
    { type: 'checkbox', label: 'Start when I log in', checked: isAutostartEnabled(), click: item => setAutostart(item.checked) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(makeTrayMenu());
}

function createTray() {
  let icon = nativeImage.createFromPath(APP_ICON);
  if (!icon.isEmpty()) icon = icon.resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip('Zoho Mail Tray');
  refreshTrayMenu();
  tray.on('click', toggleFirstAccount);
}

function openAccountManager() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    if (managerWindow.isMinimized()) managerWindow.restore();
    managerWindow.show();
    managerWindow.focus();
    return;
  }
  managerWindow = new BrowserWindow({
    width: 720,
    height: 600,
    minWidth: 560,
    minHeight: 460,
    show: false,
    title: 'Zoho Mail · Accounts',
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  managerWindow.on('closed', () => { managerWindow = undefined; });
  managerWindow.once('ready-to-show', () => managerWindow && managerWindow.show());
  managerWindow.loadFile(ACCOUNT_MANAGER_FILE).catch(console.error);
}

function accountSummaries() {
  return accounts.map((account, index) => {
    const window = mailWindows.get(account.id);
    return {
      ...account,
      is_default: account.id === 'default',
      is_open: !!window && !window.isDestroyed(),
      is_visible: !!window && !window.isDestroyed() && window.isVisible(),
      is_primary: index === 0
    };
  });
}

function installIpcHandlers() {
  ipcMain.handle('list_accounts', () => accountSummaries());
  ipcMain.handle('get_account_shortcuts', () => accountShortcutsEnabled);
  ipcMain.handle('set_account_shortcuts', (_event, { enabled }) => {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether account shortcuts are enabled.');
    const previous = accountShortcutsEnabled;
    accountShortcutsEnabled = enabled;
    try { saveJson(SETTINGS_FILE, { accountShortcutsEnabled }); }
    catch (error) { accountShortcutsEnabled = previous; throw new Error(`Could not save shortcut settings: ${error.message}`); }
    const unavailable = registerAccountShortcuts();
    refreshTrayMenu();
    return { enabled: accountShortcutsEnabled, unavailable };
  });
  ipcMain.handle('reorder_accounts', (_event, ids) => {
    if (!Array.isArray(ids) || ids.length !== accounts.length || new Set(ids).size !== accounts.length || ids.some(id => !accounts.some(account => account.id === id))) {
      throw new Error('The account order is invalid. Refresh and try again.');
    }
    const next = ids.map(id => accountById(id));
    const previous = accounts;
    accounts = next;
    try { saveAccounts(); } catch (error) { accounts = previous; throw new Error(`Could not save the account order: ${error.message}`); }
    registerAccountShortcuts();
    refreshTrayMenu();
  });
  ipcMain.handle('add_account', (_event, { name, region }) => {
    name = validateName(name);
    if (!supportedRegion(region)) throw new Error('Choose a supported Zoho region.');
    const id = `${ACCOUNT_PREFIX}${process.hrtime.bigint().toString(16)}`;
    const account = { id, name, region };
    accounts.push(account);
    try { saveAccounts(); } catch (error) { accounts.pop(); throw new Error(`Could not save the account: ${error.message}`); }
    registerAccountShortcuts();
    refreshTrayMenu();
    return account;
  });
  ipcMain.handle('rename_account', async (_event, { id, name, region }) => {
    name = validateName(name);
    if (!supportedRegion(region)) throw new Error('Choose a supported Zoho region.');
    const account = accountById(id);
    const previous = { ...account };
    account.name = name;
    account.region = region;
    try { saveAccounts(); } catch (error) { Object.assign(account, previous); throw new Error(`Could not save the account settings: ${error.message}`); }
    const window = mailWindows.get(id);
    if (window && !window.isDestroyed()) {
      window.setTitle(name);
      if (previous.region !== region) await window.loadURL(mailUrl(account));
    }
    refreshTrayMenu();
  });
  ipcMain.handle('close_account', (_event, { id }) => {
    accountById(id);
    const window = mailWindows.get(id);
    if (window && !window.isDestroyed()) window.hide();
    refreshTrayMenu();
  });
  ipcMain.handle('remove_account', async (_event, { id }) => {
    if (id === 'default') throw new Error('The original Zoho session cannot be removed here.');
    if (!new RegExp(`^${ACCOUNT_PREFIX}[a-f0-9]+$`).test(id)) throw new Error('Invalid account profile.');
    accountById(id);
    const previous = accounts;
    accounts = accounts.filter(account => account.id !== id);
    try { saveAccounts(); } catch (error) { accounts = previous; throw new Error(`Could not remove the account: ${error.message}`); }
    registerAccountShortcuts();
    const window = mailWindows.get(id);
    if (window && !window.isDestroyed()) {
      mailWindows.delete(id);
      window.destroy();
    }
    try {
      const ses = accountSession(id);
      await ses.clearStorageData();
      await ses.clearCache();
    } catch (error) {
      console.error('Could not clear the removed account session:', error);
    }
    refreshTrayMenu();
  });
  ipcMain.handle('open_account', (_event, { id }) => openAccount(id));
  ipcMain.handle('show_account_manager', () => openAccountManager());
}

if (hasSingleInstance) {
  app.on('second-instance', () => focusPrimaryOnly());
  app.whenReady().then(async () => {
    ensurePrivateDirectory(CONFIG_DIR);
    ensurePrivateDirectory(DATA_ROOT);
    ensurePrivateDirectory(SESSION_DATA);
    secureTree(SESSION_DATA);
    loadAccounts();
    loadSettings();
    registerAccountShortcuts();
    loadWindowState();
    installIpcHandlers();
    createTray();
    await openAccount(accounts[0].id);
  }).catch(error => {
    console.error('Zoho Mail Tray failed to start:', error);
    app.quit();
  });
}

app.on('before-quit', () => { isQuitting = true; });
app.on('activate', () => showFirstAccount());
