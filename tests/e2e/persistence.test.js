import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { startServer, stopServer, getServerUrl } from '../helpers/startServer.js';
import { startTestSite, stopTestSite, getTestSiteUrl } from '../helpers/testSite.js';
import { createClient } from '../helpers/client.js';

async function waitForSnapshotText(client, tabId, text, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 10000);
  let lastSnapshot = '';
  while (Date.now() < deadline) {
    const snapshot = await client.getSnapshot(tabId);
    lastSnapshot = snapshot.snapshot || '';
    if (lastSnapshot.includes(text)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs || 250));
  }
  throw new Error(`Timed out waiting for snapshot text ${JSON.stringify(text)}. Last snapshot: ${lastSnapshot}`);
}

describe('disk-backed browser storage persistence', () => {
  let stateDir;

  beforeAll(async () => {
    await startTestSite();
  }, 30000);

  afterAll(async () => {
    await stopServer();
    await stopTestSite();
    if (stateDir) await fs.rm(stateDir, { recursive: true, force: true });
  }, 30000);

  test('restores cookies and localStorage for the same user after server restart', async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'camofox-storage-state-'));
    const userId = `persistent-user-${crypto.randomUUID()}`;
    const marker = `persist-${crypto.randomUUID()}`;
    const testSite = getTestSiteUrl();

    await startServer(0, {
      CAMOFOX_COOKIES_DIR: stateDir,
      CAMOFOX_STORAGE_STATE_SAVE_INTERVAL_MS: '500',
      CAMOFOX_HEADLESS: 'true',
    });

    const firstClient = createClient(getServerUrl());
    firstClient.userId = userId;
    const firstTab = await firstClient.createTab(`${testSite}/persist-set?value=${encodeURIComponent(marker)}`);
    await waitForSnapshotText(firstClient, firstTab.tabId, `Saved: ${marker}`);

    // Do not close the session before restart: a human noVNC login should be
    // persisted by the service, not only by an explicit session-close API call.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await stopServer();

    await startServer(0, {
      CAMOFOX_COOKIES_DIR: stateDir,
      CAMOFOX_STORAGE_STATE_SAVE_INTERVAL_MS: '500',
      CAMOFOX_HEADLESS: 'true',
    });

    const secondClient = createClient(getServerUrl());
    secondClient.userId = userId;
    const secondTab = await secondClient.createTab(`${testSite}/persist-check`);
    await waitForSnapshotText(secondClient, secondTab.tabId, `Cookie: ${marker}`);
    await waitForSnapshotText(secondClient, secondTab.tabId, `LocalStorage: ${marker}`);

    const isolatedClient = createClient(getServerUrl());
    isolatedClient.userId = `isolated-user-${crypto.randomUUID()}`;
    const isolatedTab = await isolatedClient.createTab(`${testSite}/persist-check`);
    await waitForSnapshotText(isolatedClient, isolatedTab.tabId, 'Cookie: missing');
    await waitForSnapshotText(isolatedClient, isolatedTab.tabId, 'LocalStorage: missing');
  }, 180000);
});
