const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("servenowDesktop", {
  platform: process.platform,
  isDesktop: true,
});
