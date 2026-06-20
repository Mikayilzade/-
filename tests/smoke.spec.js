const { test, expect } = require('@playwright/test');

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

test.describe('Epohi browser smoke', () => {
  test('main menu loads without unhandled console errors', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ЭПОХИ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новая игра' })).toBeVisible();
    await expectNoConsoleProblems(problems);
  });

  for (const rivals of [0, 1, 2]) {
    test(`creates a new game with ${rivals} AI and starts the map`, async ({ page }) => {
      const problems = watchConsole(page);
      await clearStorage(page);
      await createGame(page, rivals, rivals === 2 ? 'normal' : 'small');
      await expect(page.locator('#turnValue')).toHaveText('1');
      await expect(page.locator('#map .tile')).toHaveCount(rivals === 2 ? 784 : 400);
      await expectNoConsoleProblems(problems);
    });
  }

  test('completes one full turn and opens in-game menu, chronicle, and save manager', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 1);

    await page.locator('#endTurnBtn').click();
    await expect(page.locator('#turnValue')).toHaveText('2');

    await page.locator('#menuBtn').click();
    await expect(page.locator('#menuModal')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Меню' })).toBeVisible();

    await page.locator('#chronicleBtn').click();
    await expect(page.locator('#menuContent')).toContainText('Летопись');
    await page.locator('#backMenu').click();

    await page.locator('#saveAsBtn').click();
    await expect(page.locator('#screenRoot')).toContainText('Сохранения');
    await expect(page.locator('#saveQuickFromManager')).toBeVisible();
    await expectNoConsoleProblems(problems);
  });

  test('saves and then loads the current campaign', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 1);

    await page.locator('#endTurnBtn').click();
    await expect(page.locator('#turnValue')).toHaveText('2');
    await page.locator('#menuBtn').click();
    await page.locator('#saveAsBtn').click();
    await page.locator('#saveQuickFromManager').click();
    await expect(page.locator('#screenRoot')).toContainText('Быстрое сохранение');

    await page.getByRole('button', { name: 'Назад в игру' }).click();
    await page.locator('#menuBtn').click();
    await page.locator('#loadCurrentCampaignBtn').click();
    await page.locator('[data-load-save]').first().click();
    await expect(page.locator('#gameApp')).toBeVisible();
    await expect(page.locator('#turnValue')).toHaveText('2');
    await expectNoConsoleProblems(problems);
  });
});
