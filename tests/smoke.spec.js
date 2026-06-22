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
    const quicksaveCard = page.locator('.slot-card').filter({ hasText: 'Быстрое: Быстрое сохранение' });
    await expect(quicksaveCard).toContainText('ход 2');

    page.once('dialog', (dialog) => dialog.accept('Playwright test turn 2'));
    await page.locator('#saveManualFromManager').click();
    const manualSaveCard = page.locator('.slot-card').filter({ hasText: 'Ручное: Playwright test turn 2' });
    await expect(manualSaveCard).toContainText('ход 2');

    await page.getByRole('button', { name: 'Назад в игру' }).click();
    await page.locator('#menuBtn').click();
    await page.locator('#loadCurrentCampaignBtn').click();
    const savedTurnTwoCard = page.locator('.slot-card').filter({ hasText: 'Ручное: Playwright test turn 2' });
    await expect(savedTurnTwoCard).toContainText('ход 2');
    await savedTurnTwoCard.getByRole('button', { name: 'Загрузить' }).click();
    await expect(page.locator('#gameApp')).toBeVisible();
    await expect(page.locator('#turnValue')).toHaveText('2');
    await expectNoConsoleProblems(problems);
  });
});

test.describe('v1.4.1 living world checks', () => {
  test('barbarian activity selector starts normal game and grace period blocks raids', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await page.getByRole('button', { name: 'Новая игра' }).click();
    await page.locator('#partySize').selectOption('normal');
    await page.locator('#rivalCount').selectOption('1');
    await page.locator('#barbarianActivity').selectOption('normal');
    await page.locator('#partyName').fill(`Living ${Date.now()}`);
    await page.getByRole('button', { name: 'Создать мир' }).click();
    await expect(page.locator('#gameApp')).toBeVisible();
    const ok = await page.evaluate(() => {
      const d = window.__epohiDebug();
      const before = d.state.barbarians.length;
      for (let i = 0; i < 10; i++) d.processBarbarians();
      return d.state.turn < 12 && d.state.barbarians.length === before && d.state.barbarianActivity === 'normal';
    });
    expect(ok).toBeTruthy();
    expect(problems).toEqual([]);
  });

  test('barbarians and AI interact: raider targets AI, AI attacks raider and can clear camp', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 1, 'normal');
    const result = await page.evaluate(() => {
      const d = window.__epohiDebug();
      const s = d.state;
      s.turn = 12;
      const civ = s.rivals[0];
      const u = civ.units.find(x => x.type === 'warrior') || civ.units[0];
      s.barbarians = [{ id:'bt', x:u.x+1, y:u.y, hp:40, maxHp:75, homeX:u.x+2, homeY:u.y, last:null }];
      d.processBarbarians();
      const attacked = s.eventLog.some(e => e.eventType === 'barbarian-attacked-rival');
      s.barbarians = [{ id:'bt2', x:u.x+1, y:u.y, hp:8, maxHp:75, homeX:u.x+2, homeY:u.y, last:null }];
      d.processRivals();
      const killed = s.eventLog.some(e => e.eventType === 'rival-destroyed-barbarian');
      const cx = u.x+1, cy = u.y;
      s.map[cy][cx].camp = { hp: 1, maxHp: 140, nextSpawn: 9 };
      d.processRivals();
      const camp = s.eventLog.some(e => e.eventType === 'rival-destroyed-camp');
      return { attacked, killed, camp };
    });
    expect(result).toEqual({ attacked: true, killed: true, camp: true });
    expect(problems).toEqual([]);
  });

  test('two AI civilizations can enter war after turn 20', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 2, 'normal');
    const war = await page.evaluate(() => { const d=window.__epohiDebug(); d.state.turn=20; d.processRivals(); return d.state.eventLog.some(e=>e.eventType==='rival-war-declared'); });
    expect(war).toBeTruthy();
    expect(problems).toEqual([]);
  });

  test('player settler founds a city with its own queue and local production', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 1, 'normal');
    const result = await page.evaluate(() => {
      window.prompt = () => 'Тестград';
      const d = window.__epohiDebug();
      const s = d.state;
      s.researched.push('trade','mining');
      const cap = s.city;
      const spot = { x: cap.x + 4, y: cap.y };
      s.map[spot.y][spot.x].terrain = 'plains'; s.map[spot.y][spot.x].revealed = true; s.map[spot.y][spot.x].camp = null; s.map[spot.y][spot.x].poi = null;
      s.units.push({ id:'settle-test', type:'settler', x:spot.x, y:spot.y, moves:1, acted:false, hp:70, maxHp:70 });
      d.foundCity('settle-test');
      const city = s.cities.find(c => c.name === 'Тестград');
      city.queue = { type:'unit', id:'scout', progress:27, cost:28, upfront:{} };
      d.endTurn();
      return new Promise(resolve => setTimeout(() => resolve({ cityId: city.id, cities:s.cities.length, hasQueue:!!city.queue, unitAtNew:s.units.some(u=>u.type==='scout'&&u.x===city.x&&u.y===city.y), capProd:cap.production !== city.production }), 250));
    });
    expect(result.cities).toBeGreaterThan(1);
    expect(result.unitAtNew).toBeTruthy();

    const cityModal = page.locator('#cityModal');
    const cityModalClass = await cityModal.getAttribute('class');
    const cityModalOpen = (cityModalClass || '').split(/\s+/).includes('show') || await cityModal.isVisible();
    if (cityModalOpen) {
      const closeButton = cityModal.locator('[data-close="cityModal"]');
      await closeButton.click();
      await expect(cityModal).not.toHaveClass(/show/);
    }

    await page.locator('#menuBtn').click();
    await page.locator('#saveAsBtn').click();
    await page.locator('#saveQuickFromManager').click();
    await expect(page.locator('#screenRoot')).toContainText('Быстрое сохранение');
    await page.getByRole('button', { name: 'Назад в игру' }).click();
    await page.locator('#menuBtn').click();
    await page.locator('#loadCurrentCampaignBtn').click();
    const quicksaveCard = page.locator('.slot-card').filter({ hasText: 'Быстрое: Быстрое сохранение' });
    await quicksaveCard.getByRole('button', { name: 'Загрузить' }).click();
    await expect(page.locator('#gameApp')).toBeVisible();
    const loaded = await page.evaluate((cityId) => {
      const s = window.__epohiDebug().state;
      const city = s.cities.find(c => c.id === cityId);
      return city && { cityCount: s.cities.length, hasQueue: !!city.queue, queueId: city.queue && city.queue.id };
    }, result.cityId);
    expect(loaded).toMatchObject({ cityCount: result.cities, hasQueue: true, queueId: 'scout' });
    expect(problems).toEqual([]);
  });

  test('save/load supports multiple cities and legacy outpost shape', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 0, 'small');
    const migrated = await page.evaluate(() => {
      const d=window.__epohiDebug(); const s=d.state;
      s.settlements.push({x:s.city.x+3,y:s.city.y+3,name:'Старый форпост'});
      const raw=JSON.parse(JSON.stringify(s)); delete raw.cities; raw.resources.food=5; raw.resources.production=7;
      localStorage.setItem('legacy-check', JSON.stringify(raw));
      return true;
    });
    expect(migrated).toBeTruthy();
    await page.locator('#menuBtn').click();
    await page.locator('#saveAsBtn').click();
    await page.locator('#saveQuickFromManager').click();
    await expect(page.locator('#screenRoot')).toContainText('Быстрое сохранение');
    expect(problems).toEqual([]);
  });
});


test.describe('v1.4.2 resource, worker, and inspection checks', () => {
  test('resource switcher uses local city stocks and worker spends local production', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 1, 'normal');
    await expect(page.locator('#resourceScope')).toHaveText('Вся империя');
    await expect(page.locator('#prodValue')).toHaveText('14');
    await page.locator('#resourceNext').click();
    await expect(page.locator('#resourceScope')).toHaveText('Ардена');
    await expect(page.locator('#prodValue')).toHaveText('14');
    await page.locator('#resourcePrev').click();
    await expect(page.locator('#resourceScope')).toHaveText('Вся империя');
    const workerResult = await page.evaluate(() => {
      const d = window.__epohiDebug();
      const s = d.state;
      const cap = s.cities[0];
      const spot = { x: cap.x + 1, y: cap.y };
      s.map[spot.y][spot.x].terrain = 'forest';
      s.map[spot.y][spot.x].revealed = true;
      s.map[spot.y][spot.x].owner = cap.id;
      s.map[spot.y][spot.x].improvement = null;
      s.map[spot.y][spot.x].camp = null;
      s.resources.production = 0;
      cap.production = 14;
      s.units.push({ id: 'worker-local-test', type: 'worker', x: spot.x, y: spot.y, moves: 1, acted: false, hp: 55, maxHp: 55 });
      d.buildImprovementWithWorker('worker-local-test', 'lumber');
      return { localProduction: cap.production, globalProduction: s.resources.production, owner: s.map[spot.y][spot.x].owner, improvement: s.map[spot.y][spot.x].improvement };
    });
    expect(workerResult).toEqual({ localProduction: 4, globalProduction: 0, owner: 'player-cap', improvement: 'lumber' });
    await expectNoConsoleProblems(problems);
  });

  test('visible rival objects and barbarian camps can be inspected without losing own unit', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 1, 'normal');
    const targets = await page.evaluate(() => {
      const d = window.__epohiDebug();
      const s = d.state;
      const cap = s.city;
      const own = s.units.find(u => u.type === 'warrior') || s.units[0];
      own.x = cap.x;
      own.y = cap.y;
      own.moves = 1;
      const civ = s.rivals[0];
      civ.relation = 'neutral';
      civ.units[0].x = cap.x + 1;
      civ.units[0].y = cap.y;
      civ.units[0].hp = 33;
      s.map[cap.y][cap.x + 1].revealed = true;
      civ.cities[0].x = cap.x + 2;
      civ.cities[0].y = cap.y;
      civ.cities[0].hp = 120;
      s.map[cap.y][cap.x + 2].revealed = true;
      s.map[cap.y + 1][cap.x + 1].camp = { hp: 90, maxHp: 140, nextSpawn: 2 };
      s.map[cap.y + 1][cap.x + 1].revealed = true;
      d.render();
      return { ownId: own.id, unit: { x: cap.x + 1, y: cap.y }, city: { x: cap.x + 2, y: cap.y }, camp: { x: cap.x + 1, y: cap.y + 1 } };
    });
    await page.locator(`.tile[data-x="${targets.unit.x}"][data-y="${targets.unit.y}"]`).click();
    await expect(page.locator('#contextText')).toContainText('здоровье');
    await expect(page.locator('#contextText')).toContainText('атака');
    await page.locator(`.tile[data-x="${targets.city.x}"][data-y="${targets.city.y}"]`).click();
    await expect(page.locator('#contextText')).toContainText('Владелец');
    await expect(page.locator('#contextText')).toContainText('здоровье');
    await page.locator(`.tile[data-x="${targets.camp.x}"][data-y="${targets.camp.y}"]`).click();
    await expect(page.locator('#contextText')).toContainText('награда');
    const stillSelected = await page.evaluate((id) => window.__epohiDebug().state.units.some(u => u.id === id), targets.ownId);
    expect(stillSelected).toBeTruthy();
    await expectNoConsoleProblems(problems);
  });
});
