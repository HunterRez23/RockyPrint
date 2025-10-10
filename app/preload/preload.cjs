// app/preload/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // --- Pedidos ---
  orders: {
    create: (payload) => ipcRenderer.invoke('orders:create', payload),
    list:   (filters) => ipcRenderer.invoke('orders:list', filters || {}),
    get:    (id)      => ipcRenderer.invoke('orders:get', id),
  },

  // --- Auth (login/sesión) ---
  auth: {
    login:  (cred) => ipcRenderer.invoke('auth:login', cred), // {usuario, clave}
    me:     ()     => ipcRenderer.invoke('auth:get'),         // alias "me" más semántico
    get:    ()     => ipcRenderer.invoke('auth:get'),
    logout: ()     => ipcRenderer.invoke('auth:logout'),
  },

  // --- Contexto UI (para pasar pedido/partida entre pantallas) ---
  ui: {
    setContext: (ctx) => ipcRenderer.invoke('ui:setContext', ctx), // {pedidoId, partidaId, ...}
    getContext: ()    => ipcRenderer.invoke('ui:getContext'),
    clearContext: ()  => ipcRenderer.invoke('ui:clearContext'),
  },

  // --- Navegación entre pantallas ---
  // Soporta: navigate('lienzo.html', {ctx})  o  navigate({ html:'lienzo.html', ctx:{...} })
  navigate: (htmlOrObj, ctx) => ipcRenderer.invoke('ui:navigate', htmlOrObj, ctx),
});
