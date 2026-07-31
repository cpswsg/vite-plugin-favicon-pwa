import './style.css';

const assetBase = `${import.meta.env.BASE_URL}assets/favicons/`;
const assets = [
  { name: 'favicon.svg', label: 'SVG master', detail: 'Scalable · 512 canvas' },
  { name: 'favicon.ico', label: 'Browser favicon', detail: '16 · 32 · 48 px' },
  { name: 'apple-touch-icon.png', label: 'Apple touch', detail: '180 × 180 px' },
  { name: 'pwa-192x192.png', label: 'PWA small', detail: '192 × 192 px' },
  { name: 'pwa-512x512.png', label: 'PWA large', detail: '512 × 512 px' },
  { name: 'pwa-maskable-512x512.png', label: 'PWA maskable', detail: '512 × 512 px' },
];

const grid = document.querySelector<HTMLDivElement>('#asset-grid')!;
for (const asset of assets) {
  const card = document.createElement('article');
  card.className = 'asset-card';
  card.innerHTML = `
    <div class="asset-preview">
      <img src="${assetBase}${asset.name}" alt="${asset.label}" />
    </div>
    <div class="asset-meta">
      <div><strong>${asset.label}</strong><span>${asset.detail}</span></div>
      <code>${asset.name}</code>
    </div>
  `;
  grid.append(card);
}

const manifestElement = document.querySelector<HTMLElement>('#manifest')!;
fetch(`${assetBase}manifest.webmanifest`)
  .then((response) => {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  })
  .then((manifest) => {
    manifestElement.textContent = JSON.stringify(manifest, null, 2);
  })
  .catch((error: unknown) => {
    manifestElement.textContent = `Could not load manifest: ${String(error)}`;
  });

const status = document.querySelector<HTMLElement>('#display-status')!;
const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
const standalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  navigatorWithStandalone.standalone === true;
status.textContent = standalone ? 'Running as an installed app' : 'Running in a browser tab';
status.classList.toggle('installed', standalone);

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const installButton = document.querySelector<HTMLButtonElement>('#install-button')!;
let installPrompt: InstallPromptEvent | undefined;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as InstallPromptEvent;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = undefined;
  installButton.hidden = true;
});
