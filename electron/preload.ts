import { ipcRenderer, contextBridge, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void) {
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(channel: string, listener: (...args: unknown[]) => void) {
    return ipcRenderer.off(channel, listener)
  },
  send(channel: string, ...args: unknown[]) {
    return ipcRenderer.send(channel, ...args)
  },
  invoke(channel: string, ...args: unknown[]) {
    return ipcRenderer.invoke(channel, ...args)
  },
  removeAllListeners(channel: string) {
    return ipcRenderer.removeAllListeners(channel)
  },
})