// app/preload.js
// Asegúrate de que contextIsolation esté en true en BrowserWindow para usar contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  orders: {
    create:        (payload)                 => ipcRenderer.invoke('orders:create', payload),
    save:          (payload)                 => ipcRenderer.invoke('orders:save', payload),
    list:          (filters = {})            => ipcRenderer.invoke('orders:list', filters),
    get:           (id)                      => ipcRenderer.invoke('orders:get', Number(id)),
    updatePartida: (partidaId, data)         => ipcRenderer.invoke('orders:updatePartida', { partidaId: Number(partidaId), data }),
    recalcTotals:  (pedidoId)                => ipcRenderer.invoke('orders:recalcTotals', Number(pedidoId)),
    delete:        (id)                      => ipcRenderer.invoke('orders:delete', Number(id)),
  },

  auth: {
    login:            (cred)                 => ipcRenderer.invoke('auth:login', cred),
    me:               ()                     => ipcRenderer.invoke('auth:get'),
    get:              ()                     => ipcRenderer.invoke('auth:get'),
    logout:           ()                     => ipcRenderer.invoke('auth:logout'),
    confirmPassword:  (pwd)                  => ipcRenderer.invoke('auth:confirmPassword', String(pwd ?? '')),
  },

  ui: {
    setContext: (ctx)                        => ipcRenderer.invoke('ui:setContext', ctx || {}),
    getContext: ()                           => ipcRenderer.invoke('ui:getContext'),
    clearContext: ()                         => ipcRenderer.invoke('ui:clearContext'),
  },

  // Navegación: admite (htmlString, ctx) o (obj {html,ctx})
  navigate: (htmlOrObj, ctx)                 => ipcRenderer.invoke('ui:navigate', htmlOrObj, ctx),

  media: {
    list:   (filter = {})                    => ipcRenderer.invoke('media:list', filter),
    upload: (payload)                        => ipcRenderer.invoke('media:upload', payload),
  },

  design: {
    savePreview:  (payload)                  => ipcRenderer.invoke('design:savePreview', payload),
    listByPedido: (pedidoId)                 => ipcRenderer.invoke('design:listByPedido', Number(pedidoId)),
  },

  // === NUEVO: APIs de clientes para autocompletar / reutilizar datos ===
  clientes: {
    /** Buscar por nombre/correo/teléfono (para datalist) */
    search:  (q)                             => ipcRenderer.invoke('clientes:search', String(q || '')),
    /** Buscar uno por correo o teléfono (autofill al perder foco) */
    findOne: (f = {})                        => ipcRenderer.invoke('clientes:findOne', {
                                                correo:   f?.correo   ?? null,
                                                telefono: f?.telefono ?? null,
                                              }),
    /** Obtener por id (recordar último cliente) */
    get:     (id)                            => ipcRenderer.invoke('clientes:get', Number(id)),
  },
};

contextBridge.exposeInMainWorld('api', api);
