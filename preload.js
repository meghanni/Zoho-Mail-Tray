'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const channels = new Set([
  'list_accounts',
  'get_account_shortcuts',
  'set_account_shortcuts',
  'reorder_accounts',
  'add_account',
  'rename_account',
  'close_account',
  'remove_account',
  'open_account',
  'show_account_manager'
]);

contextBridge.exposeInMainWorld('zohoTray', {
  invoke(command, args = {}) {
    if (!channels.has(command)) {
      return Promise.reject(new Error(`Unsupported app command: ${command}`));
    }
    return ipcRenderer.invoke(command, args);
  }
});
