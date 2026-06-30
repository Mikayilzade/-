const { expect } = require('@playwright/test');

function watchConsole(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function expectNoConsoleProblems(problems) {
  expect(problems, problems.join('\n')).toEqual([]);
}

async function clearStorage(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map((db) => db.name && new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      })));
    } else {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('epohi-db');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    }
  });
}

async function createGame(page, rivals, mapSize = 'normal') {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ЭПОХИ' })).toBeVisible();
  await page.getByRole('button', { name: 'Новая игра' }).click();
  await page.locator('#partySize').selectOption(mapSize);
  await page.locator('#rivalCount').selectOption(String(rivals));
  await page.locator('#partyName').fill(`Smoke ${rivals} AI ${Date.now()}`);
  await page.getByRole('button', { name: 'Создать мир' }).click();
  await expect(page.locator('#gameApp')).toBeVisible();
  await expect(page.locator('#map .tile').first()).toBeVisible();
}

module.exports = {
  watchConsole,
  expectNoConsoleProblems,
  clearStorage,
  createGame
};
