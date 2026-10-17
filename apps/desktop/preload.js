// Permet au site de savoir qu'il tourne dans l'application ordinateur.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('kentrapixApp', { platform: 'desktop' });
