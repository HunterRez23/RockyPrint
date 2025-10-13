const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  orders: {
    create:        (payload)         => ipcRenderer.invoke('orders:create', payload),
    list:          (filters)         => ipcRenderer.invoke('orders:list', filters || {}),
    get:           (id)              => ipcRenderer.invoke('orders:get', id),
    updatePartida: (partidaId, data) => ipcRenderer.invoke('orders:updatePartida', { partidaId, data }),
    recalcTotals:  (pedidoId)        => ipcRenderer.invoke('orders:recalcTotals', pedidoId),
  },

  auth: {
    login:  (cred) => ipcRenderer.invoke('auth:login', cred),
    me:     ()     => ipcRenderer.invoke('auth:get'),
    get:    ()     => ipcRenderer.invoke('auth:get'),
    logout: ()     => ipcRenderer.invoke('auth:logout'),
  },

  ui: {
    setContext: (ctx) => ipcRenderer.invoke('ui:setContext', ctx),
    getContext: ()    => ipcRenderer.invoke('ui:getContext'),
    clearContext: ()  => ipcRenderer.invoke('ui:clearContext'),
  },

  // Navegación: admite (htmlString, ctx) o (obj {html,ctx})
  navigate: (htmlOrObj, ctx) => ipcRenderer.invoke('ui:navigate', htmlOrObj, ctx),

  media: {
    list:   (filter)  => ipcRenderer.invoke('media:list', filter || {}),
    upload: (payload) => ipcRenderer.invoke('media:upload', payload),
  },

  design: {
    savePreview:   (payload)  => ipcRenderer.invoke('design:savePreview', payload),
    listByPedido:  (pedidoId) => ipcRenderer.invoke('design:listByPedido', Number(pedidoId)),
  },
});
