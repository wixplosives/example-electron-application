import { BrowserWindow, MessageEvent, app, ipcMain } from "electron/main";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { setApplicationMenu } from "./app-menu";

const multipleWindowsAllowed = true;

if (process.platform === "linux" && process.env.NODE_ENV === "development") {
  // to not see: "ERROR:gl_surface_presentation_helper.cc(260)] GetVSyncParametersIfAvailable() failed for <x> times"
  app.disableHardwareAcceleration();
}

if (app.requestSingleInstanceLock()) {
  initializeApp();
} else {
  console.log("Opening in existing app session.");
  app.quit();
}

const listeningPorts = new Set<Electron.MessagePortMain>();
function initializeApp() {
  const worker = new Worker(new URL("worker.js", import.meta.url));
  const workerToPorts = (message: unknown) => {
    for (const port of listeningPorts) {
      port.postMessage(message);
    }
  };
  worker.on("message", workerToPorts);
  app
    .whenReady()
    .then(setApplicationMenu)
    .then(createWindow)
    .catch((e) => {
      console.error(e);
      app.exit(1);
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch(console.error);
    }
  });

  app.on("second-instance", () => {
    if (multipleWindowsAllowed || BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch(console.error);
    } else {
      focusOnFirstWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  ipcMain.on("port", ({ ports: [port] }) => {
    if (port) {
      relayPortToWorker(port, worker);
      port.start();
    }
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    webPreferences: {
      preload: fileURLToPath(new URL("preload.cjs", import.meta.url)),
    },
    width: 1024,
    height: 768,
  });
  await win.loadFile(fileURLToPath(new URL("index.html", import.meta.url)));
}

function focusOnFirstWindow() {
  const [firstWindow] = BrowserWindow.getAllWindows();
  if (firstWindow) {
    if (firstWindow.isMinimized()) {
      firstWindow.restore();
    }
    firstWindow.focus();
  }
}

function relayPortToWorker(port: Electron.MessagePortMain, worker: Worker) {
  listeningPorts.add(port);
  const portToWorker = (event: MessageEvent) => worker.postMessage(event.data);
  port.on("message", portToWorker);
  const onPortClose = () => {
    listeningPorts.delete(port);
    port.off("message", portToWorker);
    port.off("close", onPortClose);
  };
  port.on("close", onPortClose);
}
