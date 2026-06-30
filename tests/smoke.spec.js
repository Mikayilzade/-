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

test.describe('v1.4.3 map object inspection', () => {
  test('renders a second player city once with population', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, cap=s.city; const c={id:'test-city',name:'Второй',x:cap.x+2,y:cap.y,population:3,food:0,production:0,buildings:[],queue:null,hp:150,maxHp:150,capital:false}; s.cities.push(c); s.map[c.y][c.x].revealed=true; d.render(); return {x:c.x,y:c.y,capX:cap.x,capY:cap.y}; });
    await expect(page.locator(`.tile[data-x="${r.x}"][data-y="${r.y}"] .piece.city.player-city`)).toHaveCount(1);
    await expect(page.locator(`.tile[data-x="${r.x}"][data-y="${r.y}"] .city-pop`)).toHaveText('3');
    await expect(page.locator(`.tile[data-x="${r.capX}"][data-y="${r.capY}"] .piece.city.player-capital`)).toHaveCount(1);
  });

  test('renders two AI cities with distinct capital and town markers', async ({ page }) => {
    await clearStorage(page); await createGame(page, 1, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, civ=s.rivals[0], cap=civ.cities[0]; civ.met=true; civ.relation='neutral'; const c={id:civ.civilizationId+'-extra',name:'Ривен',x:cap.x+1,y:cap.y,population:2,buildings:[],queue:null,hp:150,maxHp:150,capital:false}; civ.cities.push(c); [cap,c].forEach(city=>s.map[city.y][city.x].revealed=true); d.render(); return {cap, c}; });
    await expect(page.locator(`.tile[data-x="${r.cap.x}"][data-y="${r.cap.y}"] .ai-city.ai-capital`)).toHaveCount(1);
    await expect(page.locator(`.tile[data-x="${r.c.x}"][data-y="${r.c.y}"] .ai-city.ai-town`)).toHaveCount(1);
  });

  test('shows unit, city, and tile tabs when a unit stands in a city', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, u=s.units[0]; u.x=s.city.x; u.y=s.city.y; d.render(); return {x:u.x,y:u.y}; });
    const targetTile = page.locator(`.tile[data-x="${r.x}"][data-y="${r.y}"]`);
    await targetTile.click();
    await expect(targetTile.locator('.piece.city')).toBeVisible();
    await expect(targetTile.locator('.piece.unit')).toBeVisible();
    await expect(page.locator('.inspect-tab[data-inspect-layer="unit"]')).toBeVisible();
    await expect(page.locator('.inspect-tab[data-inspect-layer="city"]')).toBeVisible();
    await expect(page.locator('.inspect-tab[data-inspect-layer="tile"]')).toBeVisible();
  });

  test('tile inspection shows coordinates yields and fades only selected objects', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, u=s.units[0]; d.render(); return {x:u.x,y:u.y}; });
    const tile = page.locator(`.tile[data-x="${r.x}"][data-y="${r.y}"]`);
    await tile.click(); await page.locator('.inspect-tab[data-inspect-layer="tile"]').click();
    await expect(page.locator('#contextText')).toContainText(`X ${r.x}, Y ${r.y}`);
    await expect(page.locator('#contextText')).toContainText('доход:');
    await expect(tile).toHaveClass(/inspect-layer-tile/);
    await page.locator('.inspect-tab[data-inspect-layer="unit"]').click();
    await expect(tile).not.toHaveClass(/inspect-layer-tile/);
  });

  test('active unit remains selected while inspecting tile layer', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, u=s.units[0]; d.render(); return {id:u.id,x:u.x,y:u.y}; });
    await page.locator(`.tile[data-x="${r.x}"][data-y="${r.y}"]`).click(); await page.locator('.inspect-tab[data-inspect-layer="tile"]').click();
    expect(await page.evaluate(() => window.__epohiDebug().getSelectedUnitId())).toBe(r.id);
    await page.locator('.inspect-tab[data-inspect-layer="unit"]').click();
    await expect(page.getByRole('button', { name: /Идти|Ремонт|Основать|Выбрать/ }).first()).toBeVisible({ timeout: 1000 }).catch(() => {});
  });

  test('diplomacy button opens existing civilizations screen for inspected rival', async ({ page }) => {
    await clearStorage(page); await createGame(page, 1, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, civ=s.rivals[0], city=civ.cities[0]; civ.met=true; civ.relation='neutral'; s.map[city.y][city.x].revealed=true; d.render(); return {x:city.x,y:city.y,name:civ.name}; });
    await page.locator(`.tile[data-x="${r.x}"][data-y="${r.y}"]`).click(); await page.getByRole('button', { name: 'Дипломатия' }).click();
    await expect(page.locator('#menuModal')).toBeVisible();
    await expect(page.locator('#menuContent')).toContainText('Цивилизации');
    await expect(page.locator('#menuContent')).toContainText(r.name);
  });

  test('new game starts player and every AI with one scout and one warrior on valid land', async ({ page }) => {
    await clearStorage(page); await createGame(page, 2, 'normal');
    const result = await page.evaluate(() => { const s=window.__epohiDebug().state; const valid=u=>s.map[u.y][u.x].terrain!=='water' && !s.map[u.y][u.x].camp; const counts=list=>({scout:list.filter(u=>u.type==='scout').length, warrior:list.filter(u=>u.type==='warrior').length, valid:list.every(valid), unique:new Set(list.map(u=>u.x+','+u.y)).size===list.length}); return {player:counts(s.units), rivals:s.rivals.map(c=>counts(c.units))}; });
    expect(result.player).toMatchObject({ scout: 1, warrior: 1, valid: true, unique: true });
    for (const civ of result.rivals) expect(civ).toMatchObject({ scout: 1, warrior: 1, valid: true, unique: true });
    const deterministic = await page.evaluate(() => {
      const d = window.__epohiDebug();
      const size = 7;
      const map = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ terrain: 'plains', revealed: true, improvement: null, feature: null, poi: null, camp: null, pillaged: false })));
      map[2][2].poi = { type: 'ruins', used: false }; map[2][3].terrain = 'water'; map[2][4].camp = { hp: 100, maxHp: 100 };
      const gs = { map, mapSize: size, units: [{ id: 'existing', type: 'scout', x: 1, y: 2 }], rivals: [], cities: [{ id: 'cap', x: 3, y: 3, name: 'Test', hp: 180 }], city: { id: 'cap', x: 3, y: 3, name: 'Test', hp: 180 }, nextUnitId: 1, nextRivalUnitId: 1 };
      const local = []; d.placeStartingUnits(gs, gs.city, local, 'civx');
      const coords = local.map(u => `${u.x},${u.y}`);
      return { count: local.length, unique: new Set(coords).size === coords.length, blocked: coords.some(c => ['3,3','1,2','2,2','3,2','4,2'].includes(c)) };
    });
    expect(deterministic).toMatchObject({ count: 2, unique: true, blocked: false });
  });


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
      const beforeIds = new Set(s.cities.map(c => c.id));
      let spot = null;
      for (let dy = -6; dy <= 6 && !spot; dy++) {
        for (let dx = -6; dx <= 6 && !spot; dx++) {
          const x = cap.x + dx, y = cap.y + dy;
          if (!s.map[y] || !s.map[y][x]) continue;
          const t = s.map[y][x];
          t.terrain = 'plains'; t.revealed = true; t.camp = null; t.poi = null; t.improvement = null;
          const settler = { id:'settle-test', type:'settler', x, y, moves:1, acted:false, hp:70, maxHp:70 };
          s.units = s.units.filter(u => u.id !== 'settle-test').concat([settler]);
          if (d.canFoundCity(settler)) spot = { x, y };
        }
      }
      if (!spot) return { error: 'no founding spot' };
      d.foundCity('settle-test');
      const city = s.cities.find(c => !beforeIds.has(c.id));
      d.setActiveCity(city.id);
      const capProductionBeforeQueue = cap.production;
      city.production = 3;
      d.queueProject('unit', 'scout');
      const queueDidNotChangeCapitalBeforeTurn = cap.production === capProductionBeforeQueue;
      const progressBefore = city.queue.progress;
      const cityProductionBeforeTurn = city.production;
      const capProductionBeforeTurn = cap.production;
      const cityIncome = d.cityIncome(city);
      const capIncome = d.cityIncome(cap);
      d.endTurn();
      return new Promise(resolve => setTimeout(() => resolve({
        cities:s.cities.length,
        cityId:city.id,
        queueDidNotChangeCapitalBeforeTurn,
        cityProgress:city.queue && city.queue.progress,
        expectedProgressAfter:progressBefore + cityIncome.production,
        cityProductionAfterTurn:city.production,
        expectedCityProductionAfterTurn:cityProductionBeforeTurn,
        capProductionAfterTurn:cap.production,
        expectedCapProductionAfterTurn:capProductionBeforeTurn + capIncome.production,
        globalProduction:s.resources.production
      }), 250));
    });
    expect(result.error).toBeFalsy();
    expect(result.cities).toBeGreaterThan(1);
    expect(result.queueDidNotChangeCapitalBeforeTurn).toBeTruthy();
    expect(result.cityProgress).toBe(result.expectedProgressAfter);
    expect(result.cityProductionAfterTurn).toBe(result.expectedCityProductionAfterTurn);
    expect(result.capProductionAfterTurn).toBe(result.expectedCapProductionAfterTurn);
    expect(result.globalProduction).toBe(0);
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
    await createGame(page, 0, 'small');
    await expect(page.locator('#resourceScope')).toHaveText('Вся империя');
    const result = await page.evaluate(() => {
      const d = window.__epohiDebug(); const s = d.state; const cap = s.city;
      s.researched.push('mining');
      s.resources.production = 0; cap.production = 14; cap.food = 9;
      const worker = { id:'worker-local-pay', type:'worker', x:cap.x-1, y:cap.y, moves:1, acted:false, hp:70, maxHp:70 };
      const tile = s.map[worker.y][worker.x];
      tile.terrain = 'forest'; tile.revealed = true; tile.improvement = null; tile.pillaged = false; tile.camp = null; tile.poi = null; tile.owner = cap.id;
      s.units.push(worker);
      d.setResourceViewCity(cap.id);
      d.render();
      d.buildImprovementWithWorker(worker.id, 'lumber');
      return { capProduction: cap.production, globalProduction: s.resources.production, improvement: tile.improvement, owner: tile.owner };
    });
    await expect(page.locator('#resourceScope')).toContainText('Ардена');
    expect(result).toEqual({ capProduction: 4, globalProduction: 0, improvement: 'lumber', owner: 'player-cap' });
    await page.locator('#resourcePrev').click();
    await expect(page.locator('#resourceScope')).toHaveText('Вся империя');
    expect(problems).toEqual([]);
  });

  test('visible rival objects and barbarian camps can be inspected without losing own unit', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 1, 'normal');
    const setup = await page.evaluate(() => {
      const d = window.__epohiDebug(); const s = d.state; const cap = s.city; const civ = s.rivals[0];
      const own = s.units[0]; own.x = cap.x; own.y = cap.y - 1; s.map[own.y][own.x].revealed = true;
      const unit = civ.units[0]; unit.x = cap.x + 1; unit.y = cap.y; unit.hp = unit.maxHp || 60; s.map[unit.y][unit.x].revealed = true;
      const city = civ.cities[0]; city.x = cap.x + 2; city.y = cap.y; city.hp = city.maxHp || 150; s.map[city.y][city.x].revealed = true;
      const campX = cap.x + 1, campY = cap.y + 1; s.map[campY][campX].terrain = 'plains'; s.map[campY][campX].revealed = true; s.map[campY][campX].camp = { hp: 20, maxHp: 140, nextSpawn: 8 };
      s.barbarians = [{ id:'inspect-barb', x:cap.x-1, y:cap.y, hp:40, maxHp:75, homeX:campX, homeY:campY, last:null }]; s.map[cap.y][cap.x-1].revealed = true;
      d.render();
      return { ownId: own.id, unitX: unit.x, unitY: unit.y, cityX: city.x, cityY: city.y, campX, campY, barbX: cap.x-1, barbY: cap.y };
    });
    await page.locator(`.tile[data-x="${setup.unitX}"][data-y="${setup.unitY}"]`).click();
    await expect(page.locator('#contextText')).toContainText('атака');
    await page.locator(`.tile[data-x="${setup.cityX}"][data-y="${setup.cityY}"]`).click();
    await expect(page.locator('#contextText')).toContainText('Владелец');
    await page.locator(`.tile[data-x="${setup.campX}"][data-y="${setup.campY}"]`).click();
    await expect(page.locator('#contextText')).toContainText('награда');
    await expect(page.locator('[data-inspect-layer="camp"]')).toHaveText('Лагерь');
    await page.locator('[data-inspect-layer="tile"]').click();
    await expect(page.locator('#contextText')).toContainText(`X ${setup.campX}, Y ${setup.campY}`);
    await page.locator('[data-inspect-layer="camp"]').click();
    await page.locator(`.tile[data-x="${setup.barbX}"][data-y="${setup.barbY}"]`).click();
    await expect(page.locator('#contextText')).toContainText('здоровье');
    const ownStillExists = await page.evaluate((id) => window.__epohiDebug().state.units.some(u => u.id === id), setup.ownId);
    expect(ownStillExists).toBeTruthy();
    expect(problems).toEqual([]);
  });
});

test.describe('v1.4.2-alpha manual iPhone bugfixes', () => {
  test('resources do not overlap the map zone on small mobile viewports', async ({ page }) => {
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 360, height: 640 });
    await clearStorage(page);
    await createGame(page, 0, 'small');
    for (const size of [{ width: 360, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await expect(page.locator('#gameApp')).toBeVisible();
      const rects = await page.evaluate(() => {
        const resources = document.querySelector('.resources').getBoundingClientRect();
        const mapZone = document.querySelector('.map-zone').getBoundingClientRect();
        return { resourcesBottom: resources.bottom, mapZoneTop: mapZone.top, resourcesRight: resources.right, mapZoneLeft: mapZone.left };
      });
      expect(rects.resourcesBottom).toBeLessThanOrEqual(rects.mapZoneTop + 0.5);
    }
    expect(problems).toEqual([]);
  });

  test('player can found a city through the real context UI button', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 0, 'small');
    const setup = await page.evaluate(() => {
      const d = window.__epohiDebug();
      const s = d.state;
      const cap = s.city;
      const settler = s.units.find(u => u.type === 'settler') || { id: 'ui-settler', type: 'settler', hp: 70, maxHp: 70 };
      if (!s.units.includes(settler)) s.units.push(settler);
      let spot = null;
      for (let y = 1; y < s.mapSize - 1 && !spot; y++) {
        for (let x = 1; x < s.mapSize - 1 && !spot; x++) {
          if (Math.max(Math.abs(x - cap.x), Math.abs(y - cap.y)) < 4) continue;
          const t = s.map[y][x];
          t.terrain = 'plains'; t.revealed = true; t.camp = null; t.poi = null; t.improvement = null;
          settler.x = x; settler.y = y; settler.moves = 1; settler.acted = false;
          if (d.canFoundCity(settler)) spot = { x, y };
        }
      }
      d.render();
      return { id: settler.id, x: spot.x, y: spot.y, before: s.cities.length };
    });
    await page.locator(`.tile[data-x="${setup.x}"][data-y="${setup.y}"]`).click();
    await expect(page.locator('#contextTitle')).toContainText('Поселенец');
    await expect(page.locator('#contextActions')).toContainText('Основать');
    page.once('dialog', dialog => dialog.accept('UI-град'));
    await page.locator('#contextActions button').filter({ hasText: 'Основать' }).click();
    await expect(page.locator('#contextTitle')).not.toContainText('Поселенец');
    const result = await page.evaluate((before) => {
      const s = window.__epohiDebug().state;
      return { cities: s.cities.length, name: s.cities[s.cities.length - 1].name };
    }, setup.before);
    expect(result.cities).toBe(setup.before + 1);
    expect(result.name).toBe('UI-град');
    expect(problems).toEqual([]);
  });

  test('small 20x20 maps with active barbarians always receive a valid camp', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await page.getByRole('button', { name: 'Новая игра' }).click();
    await page.locator('#partySize').selectOption('small');
    await page.locator('#barbarianActivity').selectOption('normal');
    await page.locator('#rivalCount').selectOption('0');
    await page.locator('#partyName').fill(`Camp smoke ${Date.now()}`);
    await page.getByRole('button', { name: 'Создать мир' }).click();
    await expect(page.locator('#gameApp')).toBeVisible();
    const camps = await page.evaluate(() => {
      const d = window.__epohiDebug();
      const s = d.state;
      const found = [];
      s.map.forEach((row, y) => row.forEach((t, x) => { if (t.camp && t.camp.hp > 0) found.push({ x, y, terrain: t.terrain, poi: !!t.poi, nearCapital: Math.max(Math.abs(x - s.city.x), Math.abs(y - s.city.y)) < 7 }); }));
      return found;
    });
    expect(camps.length).toBeGreaterThanOrEqual(1);
    expect(camps.every(c => c.terrain !== 'water' && !c.poi && !c.nearCapital)).toBeTruthy();
    expect(problems).toEqual([]);
  });

  test('AI scout resets unreachable exploration target and keeps moving on land', async ({ page }) => {
    const problems = watchConsole(page);
    await clearStorage(page);
    await createGame(page, 1, 'small');
    const result = await page.evaluate(() => {
      const d = window.__epohiDebug();
      const s = d.state;
      const civ = s.rivals[0];
      const scout = civ.units.find(u => u.type === 'scout');
      scout.x = 2; scout.y = 2; scout.moves = 2; scout.acted = false; scout.stuckTurns = 2; scout.aiTarget = { x: s.mapSize - 2, y: 1 };
      for (let y = 0; y < s.mapSize; y++) for (let x = 0; x < s.mapSize; x++) {
        s.map[y][x].terrain = (y === 1 && x > 4) ? 'water' : 'plains';
        s.map[y][x].camp = null;
      }
      [[1,2],[2,1],[3,2],[2,3]].forEach(([x,y]) => { s.map[y][x].terrain = 'plains'; });
      const positions = [];
      for (let i = 0; i < 6; i++) { d.processRivals(); positions.push(`${scout.x},${scout.y}`); }
      return { alive: civ.units.includes(scout), unique: new Set(positions).size, positions, terrain: s.map[scout.y][scout.x].terrain };
    });
    expect(result.alive).toBeTruthy();
    expect(result.terrain).not.toBe('water');
    expect(result.unique).toBeGreaterThan(1);
    expect(problems).toEqual([]);
  });
});

test.describe('v1.4.4 living barbarian camps', () => {
  test('new 20x20 map has exactly one active valid camp', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, camps=d.activeCampEntries(s); return { count:camps.length, target:d.targetActiveCampCount(s), valid:camps.every(c=>d.isValidCampSpawnTile(s,c.x,c.y)===false && s.map[c.y][c.x].terrain!=='water' && !!c.camp.campId) }; });
    expect(r).toEqual({ count: 1, target: 1, valid: true });
  });

  test('destroyed camp schedules delayed replacement and does not respawn early', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, c=d.activeCampEntries(s)[0]; d.scheduleNextCampSpawn(s, 20, () => 0); s.turn=20; s.map[c.y][c.x].camp=null; const due=s.barbarianDirector.nextCampSpawnTurn; const early=d.maintainBarbarianCamps(s,()=>0); s.turn=due-1; const before=d.maintainBarbarianCamps(s,()=>0); s.turn=due; const spawned=d.maintainBarbarianCamps(s,()=>0); return { due, early:!!early, before:!!before, after:!!spawned, count:d.activeCampEntries(s).length }; });
    expect(r.due).toBe(26); expect(r.early).toBeFalsy(); expect(r.before).toBeFalsy(); expect(r.after).toBeTruthy(); expect(r.count).toBe(1);
  });

  test('replacement candidate excludes occupied, improved, resource, territory, city and visible tiles', async ({ page }) => {
    await clearStorage(page); await createGame(page, 1, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state; d.activeCampEntries(s).forEach(c=>s.map[c.y][c.x].camp=null); for(let y=0;y<s.mapSize;y++) for(let x=0;x<s.mapSize;x++){ const t=s.map[y][x]; t.terrain='plains'; t.owner=null; t.improvement=null; t.poi=null; t.feature=null; t.resource=null; t.camp=null; t.revealed=false; }
      const bad=[[1,1,'water'],[2,1,'unit'],[3,1,'improvement'],[4,1,'poi'],[5,1,'resource'],[6,1,'owner']]; s.map[1][1].terrain='water'; s.units.push({id:'block',type:'scout',x:2,y:1,hp:1,maxHp:1,moves:0}); s.map[1][3].improvement='farm'; s.map[1][4].poi={type:'ruins',used:false}; s.map[1][5].resource='iron'; s.map[1][6].owner=s.city.id; const candidates=d.findCampSpawnCandidates(s); return { bad:bad.map(([x,y])=>d.isValidCampSpawnTile(s,x,y)), candidates:candidates.length, checks:candidates.every(p=>s.map[p.y][p.x].terrain!=='water'&&!s.map[p.y][p.x].owner&&!s.map[p.y][p.x].improvement&&!s.map[p.y][p.x].poi&&!s.map[p.y][p.x].resource && !s.units.some(u=>u.x===p.x&&u.y===p.y) && Math.max(Math.abs(p.x-s.city.x),Math.abs(p.y-s.city.y))>=5) }; });
    expect(r.bad).toEqual([false,false,false,false,false,false]); expect(r.candidates).toBeGreaterThan(0); expect(r.checks).toBeTruthy();
  });

  test('no valid tile postpones next camp check by three turns', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state; d.activeCampEntries(s).forEach(c=>s.map[c.y][c.x].camp=null); s.map.forEach(row=>row.forEach(t=>{t.terrain='water';t.camp=null;})); s.turn=40; s.barbarianDirector.nextCampSpawnTurn=40; s.barbarianDirector.lastMaintenanceTurn=null; const out=d.maintainBarbarianCamps(s,()=>0); return { out:!!out, count:d.activeCampEntries(s).length, next:s.barbarianDirector.nextCampSpawnTurn }; });
    expect(r).toEqual({ out:false, count:0, next:43 });
  });

  test('maintenance is idempotent in a single turn and respects target count', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state; d.activeCampEntries(s).forEach(c=>s.map[c.y][c.x].camp=null); s.turn=30; s.barbarianDirector.nextCampSpawnTurn=30; s.barbarianDirector.lastMaintenanceTurn=null; d.maintainBarbarianCamps(s,()=>0); d.maintainBarbarianCamps(s,()=>0); d.maintainBarbarianCamps(s,()=>0); return { count:d.activeCampEntries(s).length, target:d.targetActiveCampCount(s) }; });
    expect(r.count).toBeLessThanOrEqual(r.target); expect(r.count).toBe(1);
  });

  test('camp produces at most two living barbarians and reopens after one dies', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, e=d.activeCampEntries(s)[0], camp=e.camp; s.turn=50; camp.nextSpawn=0; s.barbarians=[]; d.processBarbarians(); camp.nextSpawn=0; d.processBarbarians(); const two=s.barbarians.filter(b=>b.originCampId===camp.campId).length; camp.nextSpawn=0; d.processBarbarians(); const still=s.barbarians.filter(b=>b.originCampId===camp.campId).length; s.barbarians.pop(); camp.nextSpawn=0; d.processBarbarians(); return { two, still, after:s.barbarians.filter(b=>b.originCampId===camp.campId).length, ids:s.barbarians.every(b=>b.originCampId===camp.campId) }; });
    expect(r).toEqual({ two:2, still:2, after:2, ids:true });
  });

  test('save/load preserves director timing and does not duplicate camps', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, c=d.activeCampEntries(s)[0]; s.map[c.y][c.x].camp=null; d.scheduleNextCampSpawn(s, s.turn, () => 0.5); const raw=JSON.parse(JSON.stringify(s)); const migrated=d.migrateState(raw); return { turn:s.barbarianDirector.nextCampSpawnTurn, loaded:migrated.barbarianDirector.nextCampSpawnTurn, count:d.activeCampEntries(migrated).length, nextId:migrated.barbarianDirector.nextCampId }; });
    expect(r.loaded).toBe(r.turn); expect(r.count).toBe(0); expect(r.nextId).toBeGreaterThan(1);
  });

  test('legacy migration handles saves with and without camps without duplicates', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), base=JSON.parse(JSON.stringify(d.state)); delete base.barbarianDirector; base.map.forEach(row=>row.forEach(t=>{ if(t.camp) delete t.camp.campId; })); const withCamp=d.migrateState(JSON.parse(JSON.stringify(base))); const noCampRaw=JSON.parse(JSON.stringify(base)); noCampRaw.map.forEach(row=>row.forEach(t=>t.camp=null)); delete noCampRaw.barbarianDirector; const noCamp=d.migrateState(noCampRaw); const again=d.migrateState(JSON.parse(JSON.stringify(noCamp))); return { withCount:d.activeCampEntries(withCamp).length, withIds:d.activeCampEntries(withCamp).every(e=>!!e.camp.campId), noCount:d.activeCampEntries(noCamp).length, same:noCamp.barbarianDirector.nextCampSpawnTurn===again.barbarianDirector.nextCampSpawnTurn }; });
    expect(r).toEqual({ withCount:1, withIds:true, noCount:0, same:true });
  });
});

test.describe('v1.4.4 review fixes for living camps', () => {
  test('barbarian activity off keeps target zero and never creates camps', async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Новая игра' }).click();
    await page.locator('#partySize').selectOption('small');
    await page.locator('#barbarianActivity').selectOption('off');
    await page.locator('#rivalCount').selectOption('0');
    await page.locator('#partyName').fill(`No barbarians ${Date.now()}`);
    await page.getByRole('button', { name: 'Создать мир' }).click();
    await expect(page.locator('#gameApp')).toBeVisible();
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state; s.turn=50; s.barbarianDirector.nextCampSpawnTurn=50; s.barbarianDirector.lastMaintenanceTurn=null; return { target:d.targetActiveCampCount(s), before:d.activeCampEntries(s).length, spawned:!!d.maintainBarbarianCamps(s,()=>0), after:d.activeCampEntries(s).length, next:s.barbarianDirector.nextCampSpawnTurn }; });
    expect(r).toEqual({ target:0, before:0, spawned:false, after:0, next:null });
  });

  test('hidden replacement camp on previously revealed tile is not rendered or inspectable until current vision returns', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const setup = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state; d.activeCampEntries(s).forEach(c=>s.map[c.y][c.x].camp=null); const x=1,y=1,t=s.map[y][x]; t.terrain='plains'; t.revealed=true; t.owner=null; t.poi=null; t.improvement=null; t.feature=null; t.resource=null; t.camp={campId:'hidden-camp',hp:140,maxHp:140,nextSpawn:8,discoveredByPlayer:false,discoveredByCivs:{}}; d.render(); return {x,y}; });
    await page.locator(`.tile[data-x="${setup.x}"][data-y="${setup.y}"]`).click();
    await expect(page.locator('#contextActions')).not.toContainText('Лагерь');
    const hidden = await page.locator(`.tile[data-x="${setup.x}"][data-y="${setup.y}"] .piece.camp`).count();
    expect(hidden).toBe(0);
    const shown = await page.evaluate(({x,y}) => { const d=window.__epohiDebug(), s=d.state, scout=s.units.find(u=>u.type==='scout')||s.units[0]; scout.x=x+1; scout.y=y; d.updateCampDiscovery(s); d.render(); return { known:d.playerKnowsCamp(s,x,y) }; }, setup);
    expect(shown.known).toBeTruthy();
    await expect(page.locator(`.tile[data-x="${setup.x}"][data-y="${setup.y}"] .piece.camp`)).toHaveCount(1);
  });

  test('AI ignores a previously explored but currently undiscovered hidden camp', async ({ page }) => {
    await clearStorage(page); await createGame(page, 1, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, civ=s.rivals[0]; d.activeCampEntries(s).forEach(c=>s.map[c.y][c.x].camp=null); let spot=null; for(let y=0;y<s.mapSize&&!spot;y++) for(let x=0;x<s.mapSize&&!spot;x++){ const t=s.map[y][x]; if(t.terrain==='water'||d.currentRivalSeesTile(civ,x,y)) continue; const far=(civ.cities||[]).concat(civ.units||[]).every(o=>Math.max(Math.abs(o.x-x),Math.abs(o.y-y))>=5); if(far) spot={x,y}; } const {x,y}=spot; const t=s.map[y][x]; t.terrain='plains'; t.owner=null; t.poi=null; t.improvement=null; t.feature=null; t.resource=null; t.camp={campId:'ai-hidden',hp:140,maxHp:140,nextSpawn:8,discoveredByPlayer:false,discoveredByCivs:{}}; civ.explored[`${x},${y}`]=true; civ.visible={}; d.chooseAiGoal(civ); const before={knows:d.civKnowsCamp(civ,x,y), goal:civ.strategicGoal}; const scout=(civ.units||[])[0]; scout.x=x+1; scout.y=y; d.updateCampDiscovery(s); return { before, after:d.civKnowsCamp(civ,x,y) }; });
    expect(r.before.knows).toBeFalsy();
    expect(r.before.goal).not.toBe('уничтожение варварского лагеря');
    expect(r.after).toBeTruthy();
  });

  test('replacement camp excludes the last destroyed tile when another candidate exists', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state; d.activeCampEntries(s).forEach(c=>s.map[c.y][c.x].camp=null); for(let y=0;y<s.mapSize;y++) for(let x=0;x<s.mapSize;x++){ const t=s.map[y][x]; t.terrain='water'; t.camp=null; t.owner=null; t.poi=null; t.improvement=null; t.feature=null; t.resource=null; t.revealed=false; }
      const cap=s.city; for(let x=cap.x;x<=18;x++) s.map[18][x].terrain='plains'; for(let y=cap.y;y<=18;y++) s.map[y][cap.x].terrain='plains'; s.map[1][1].terrain='plains'; s.map[18][18].terrain='plains'; s.map[18][18].owner=null; s.units.forEach(u=>{u.x=cap.x;u.y=cap.y;}); s.barbarianDirector.lastDestroyedCamp={x:1,y:1,turn:20,campId:'old'}; s.turn=30; s.barbarianDirector.nextCampSpawnTurn=30; s.barbarianDirector.lastMaintenanceTurn=null; const spawned=d.maintainBarbarianCamps(s,()=>0,{x:18,y:18}); return { spawned:spawned && {x:spawned.x,y:spawned.y}, oldValid:d.isValidCampSpawnTile(s,1,1), targetValid:!!spawned, count:d.activeCampEntries(s).length }; });
    expect(r.spawned).toEqual({x:18,y:18}); expect(r.oldValid).toBeFalsy(); expect(r.targetValid).toBeTruthy(); expect(r.count).toBe(1);
  });

  test('initial camp creation mutates only the passed newState director, not the current global state', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), old=d.state; old.barbarianDirector.nextCampId=99; const ns=d.createNewGame(20,0,'normal'); return { oldNext:old.barbarianDirector.nextCampId, newNext:ns.barbarianDirector.nextCampId, ids:d.activeCampEntries(ns).map(c=>c.camp.campId), count:d.activeCampEntries(ns).length }; });
    expect(r.oldNext).toBe(99); expect(r.count).toBe(1); expect(new Set(r.ids).size).toBe(r.ids.length); expect(r.newNext).toBeGreaterThan(1);
  });

  test('initial camps respect all capitals and replacement nextSpawn uses normal interval only', async ({ page }) => {
    await clearStorage(page); await createGame(page, 1, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, initial=d.activeCampEntries(s)[0]; const distances=[s.city].concat(...s.rivals.map(c=>c.cities)).map(c=>Math.max(Math.abs(c.x-initial.x),Math.abs(c.y-initial.y))); d.activeCampEntries(s).forEach(c=>s.map[c.y][c.x].camp=null); s.turn=40; s.barbarianDirector.nextCampSpawnTurn=40; s.barbarianDirector.lastMaintenanceTurn=null; const replacement=d.maintainBarbarianCamps(s,()=>0); return { initialNext:initial.camp.nextSpawn, distances, replacementNext:replacement.camp.nextSpawn }; });
    expect(Math.min(...r.distances)).toBeGreaterThanOrEqual(5); expect(r.initialNext).toBeGreaterThanOrEqual(20); expect(r.initialNext).toBeLessThanOrEqual(24); expect(r.replacementNext).toBeGreaterThanOrEqual(8); expect(r.replacementNext).toBeLessThanOrEqual(12);
  });

  test('player and AI camp destruction paths record last destroyed camp and preserve existing barbarians', async ({ page }) => {
    await clearStorage(page); await createGame(page, 1, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, first=d.activeCampEntries(s)[0]; s.barbarians=[{id:'survivor',x:first.x,y:first.y+1,hp:10,maxHp:75,homeX:first.x,homeY:first.y,originCampId:first.camp.campId,last:null}]; d.campReward({resources:s.resources}, s.units[0], first.x, first.y); const player={count:d.activeCampEntries(s).length,next:s.barbarianDirector.nextCampSpawnTurn,last:s.barbarianDirector.lastDestroyedCamp,barbs:s.barbarians.length};
      s.turn=player.next-1; s.barbarianDirector.lastMaintenanceTurn=null; const early=!!d.maintainBarbarianCamps(s,()=>0); const x=1,y=1; s.map[y][x].terrain='plains'; s.map[y][x].camp={campId:'ai-camp',hp:1,maxHp:140,nextSpawn:8,discoveredByPlayer:false,discoveredByCivs:{}}; const civ=s.rivals[0], u=civ.units.find(q=>q.type==='warrior')||civ.units[0]; u.type='warrior'; u.x=x+1; u.y=y; d.processRivals(); return { player, early, aiLast:s.barbarianDirector.lastDestroyedCamp, barbs:s.barbarians.length }; });
    expect(r.player.count).toBe(0); expect(r.player.next - r.player.last.turn).toBeGreaterThanOrEqual(6); expect(r.player.next - r.player.last.turn).toBeLessThanOrEqual(12); expect(r.player.barbs).toBe(1); expect(r.early).toBeFalsy(); expect(r.aiLast).toMatchObject({x:1,y:1,campId:'ai-camp'}); expect(r.barbs).toBe(1);
  });
});

test.describe('v1.4.5 mobile context card and AI notices', () => {
  test('camp description is complete and internally scrollable without two-line clamp', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const setup = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state; const e=d.activeCampEntries(s)[0]; const t=s.map[e.y][e.x]; t.revealed=true; t.camp.discoveredByPlayer=true; d.render(); return {x:e.x,y:e.y}; });
    await page.locator(`.tile[data-x="${setup.x}"][data-y="${setup.y}"]`).click();
    await page.locator('#contextTabs .inspect-tab[data-inspect-layer="camp"]').click();
    await expect(page.locator('#contextText')).toContainText('здоровье:');
    await expect(page.locator('#contextText')).toContainText('награда: золото, наука и опыт для атакующего юнита');
    await expect(page.locator('#contextText')).toContainText('отряды лагеря:');
    await expect(page.locator('#contextText')).toContainText('опасность: может порождать налётчиков');
    const metrics = await page.locator('#contextText').evaluate((el) => {
      el.style.maxHeight = '20px';
      const style = getComputedStyle(el);
      const before = el.scrollTop;
      el.scrollTop = 12;
      return { clamp: style.webkitLineClamp, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, before, after: el.scrollTop };
    });
    expect(metrics.clamp === 'none' || metrics.clamp === '').toBeTruthy();
    expect(metrics.scrollHeight).toBeGreaterThanOrEqual(metrics.clientHeight);
    expect(metrics.after).toBeGreaterThan(metrics.before);
  });

  test('unit description exposes the final AI relation text above action buttons', async ({ page }) => {
    await clearStorage(page); await createGame(page, 1, 'small');
    const setup = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, civ=s.rivals[0], u=civ.units[0]; civ.met=true; civ.relation='neutral'; u.aiTarget={x:u.x+4,y:u.y+3, reason:'очень длинная разведывательная цель'}; s.map[u.y][u.x].revealed=true; d.render(); return {x:u.x,y:u.y}; });
    await page.locator(`.tile[data-x="${setup.x}"][data-y="${setup.y}"]`).click();
    await page.locator('#contextTabs .inspect-tab[data-inspect-layer="unit"]').click();
    await expect(page.locator('#contextText')).toContainText('цель ИИ');
    await expect(page.locator('#contextText')).toContainText('отношения: нейтральные отношения');
    const rects = await page.evaluate(() => { const text=document.querySelector('#contextText').getBoundingClientRect(); const actions=document.querySelector('#contextActions').getBoundingClientRect(); return { textBottom:text.bottom, actionsTop:actions.top }; });
    expect(rects.textBottom).toBeLessThanOrEqual(rects.actionsTop + 1);
  });

  test('inspect tabs and actions use separate containers and empty containers collapse', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');
    const r = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, u=s.units[0]; u.x=s.city.x; u.y=s.city.y; d.render(); return {x:u.x,y:u.y}; });
    await page.locator(`.tile[data-x="${r.x}"][data-y="${r.y}"]`).click();
    await expect(page.locator('#contextTabs .inspect-tab')).toHaveCount(3);
    await expect(page.locator('#contextActions .inspect-tab')).toHaveCount(0);
    expect(await page.locator('#contextTabs').evaluate(el => el.parentElement.id)).toBe('contextPanel');
    await page.evaluate(() => { document.querySelector('#contextTabs').innerHTML=''; document.querySelector('#contextActions').innerHTML=''; });
    const displays = await page.evaluate(() => ({ tabs:getComputedStyle(document.querySelector('#contextTabs')).display, actions:getComputedStyle(document.querySelector('#contextActions')).display }));
    expect(displays).toEqual({ tabs: 'none', actions: 'none' });
  });

  test('two own units never create duplicate select buttons and cycle one unit at a time', async ({ page }) => {
    await clearStorage(page); await createGame(page, 0, 'small');

    const setup = await page.evaluate(() => {
      const d = window.__epohiDebug();
      const s = d.state;
      const cap = s.city;
      const active = s.units[0];
      const firstOnTile = s.units[1];
      const x = cap.x + 1;
      const y = cap.y;
      active.x = cap.x;
      active.y = cap.y;
      firstOnTile.x = x;
      firstOnTile.y = y;
      const tile = s.map[y][x];
      tile.terrain = 'plains';
      tile.revealed = true;
      tile.camp = null;
      tile.poi = null;
      tile.improvement = null;
      s.units.push({ id:'second-on-tile', type:'warrior', x, y, moves:1, acted:false, hp:90, maxHp:90 });
      d.render();
      return { x, y, activeId: active.id };
    });

    await page.locator(`.tile[data-x="${setup.x}"][data-y="${setup.y}"]`).click();
    await expect(page.locator('#contextActions [data-context-action="select-unit"]')).toHaveCount(1);
    await expect(page.locator('#contextActions [data-context-action="cycle-unit"]')).toHaveCount(0);

    await page.locator('#contextActions [data-context-action="select-unit"]').click();
    const selectedOnTile = await page.evaluate(({ x, y }) => {
      const d = window.__epohiDebug();
      const selectedId = d.getSelectedUnitId();
      const unit = d.state.units.find(u => u.id === selectedId);
      return { selectedId, onTile: unit && unit.x === x && unit.y === y };
    }, setup);
    expect(selectedOnTile.selectedId).not.toBe(setup.activeId);
    expect(selectedOnTile.onTile).toBeTruthy();
    await expect(page.locator('#contextActions [data-context-action="select-unit"]')).toHaveCount(0);
    await expect(page.locator('#contextActions [data-context-action="cycle-unit"]')).toHaveCount(1);

    const before = await page.evaluate(() => window.__epohiDebug().getSelectedUnitId());
    await page.locator('#contextActions [data-context-action="cycle-unit"]').click();
    const after = await page.evaluate(() => window.__epohiDebug().getSelectedUnitId());
    expect(after).not.toBe(before);
    await page.evaluate(() => window.__epohiDebug().renderContext());
    await page.evaluate(() => window.__epohiDebug().renderContext());
    await expect(page.locator('#contextActions [data-context-action="select-unit"]')).toHaveCount(0);
    await expect(page.locator('#contextActions [data-context-action="cycle-unit"]')).toHaveCount(1);

    const activeHereSetup = await page.evaluate(({ x, y }) => {
      const d = window.__epohiDebug();
      d.state.units[0].x = x;
      d.state.units[0].y = y;
      d.render();
      return { selectedId: d.getSelectedUnitId() };
    }, setup);
    await page.locator(`.tile[data-x="${setup.x}"][data-y="${setup.y}"]`).click();
    await expect(page.locator('#contextActions [data-context-action="select-unit"]')).toHaveCount(0);
    await expect(page.locator('#contextActions [data-context-action="cycle-unit"]')).toHaveCount(1);
    expect(activeHereSetup.selectedId).toBeTruthy();
  });

  test('AI unit entering vision creates one unit-spotted notice and visible movement does not repeat', async ({ page }) => {
    await clearStorage(page); await createGame(page, 1, 'small');
    const result = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, civ=s.rivals[0], u=civ.units[0], cap=s.city; for(let y=0;y<s.mapSize;y++) for(let x=0;x<s.mapSize;x++){ s.map[y][x].terrain='plains'; s.map[y][x].revealed=false; } s.units.forEach(unit=>{ unit.x=cap.x; unit.y=cap.y; }); u.x=cap.x+3; u.y=cap.y; u.last=null; u.moves=3; s.turn=77; d.render(); const before=s.eventLog.filter(e=>e.eventType==='unit-spotted').length; d.stepToward(u,{x:cap.x+1,y:cap.y},civ); d.stepToward(u,{x:cap.x,y:cap.y},civ); d.stepToward(u,{x:cap.x+1,y:cap.y},civ); const spots=s.eventLog.filter(e=>e.eventType==='unit-spotted'); return { added:spots.length-before, event:spots[0] }; });
    expect(result.added).toBe(1);
    expect(result.event).toMatchObject({ eventType: 'unit-spotted', actorType: 'civilization' });
    expect(result.event.text).toMatch(/замечен/);
    expect(result.event.coordinates).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(result.event.coordinates.x).toBeGreaterThanOrEqual(0);
    expect(result.event.coordinates.y).toBeGreaterThanOrEqual(0);
  });

  test('hidden AI movement outside current vision does not enter player chronicle', async ({ page }) => {
    await clearStorage(page); await createGame(page, 1, 'small');
    const result = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, civ=s.rivals[0], u=civ.units[0]; for(let y=0;y<s.mapSize;y++) for(let x=0;x<s.mapSize;x++){ s.map[y][x].terrain='plains'; s.map[y][x].revealed=false; } u.x=1; u.y=1; u.moves=2; u.last=null; s.turn=12; const before=s.eventLog.length; d.stepToward(u,{x:3,y:1},civ); return { added:s.eventLog.length-before, moved:u.x!==1 || u.y!==1, text:s.eventLog.map(e=>e.message).join('\n') }; });
    expect(result.moved).toBeTruthy();
    expect(result.added).toBe(0);
    expect(result.text).not.toContain('юнит замечен в движении');
  });

  test('mobile 390x844 layout keeps context, toolbar, and horizontal scrollers usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await clearStorage(page); await createGame(page, 0, 'small');
    const setup = await page.evaluate(() => { const d=window.__epohiDebug(), s=d.state, u=s.units[0]; u.x=s.city.x; u.y=s.city.y; d.render(); return {x:u.x,y:u.y}; });
    await page.locator(`.tile[data-x="${setup.x}"][data-y="${setup.y}"]`).click();
    const metrics = await page.evaluate(() => { const panel=document.querySelector('#contextPanel').getBoundingClientRect(); const toolbar=document.querySelector('.toolbar').getBoundingClientRect(); const map=document.querySelector('.map-shell').getBoundingClientRect(); const tabs=getComputedStyle(document.querySelector('#contextTabs')); const actions=getComputedStyle(document.querySelector('#contextActions')); return { panel, toolbar, mapHeight:map.height, tabsOverflow:tabs.overflowX, actionsOverflow:actions.overflowX, overlap:panel.bottom > toolbar.top }; });
    expect(metrics.panel.top).toBeGreaterThanOrEqual(0);
    expect(metrics.panel.bottom).toBeLessThanOrEqual(844);
    expect(metrics.toolbar.bottom).toBeLessThanOrEqual(844);
    expect(metrics.mapHeight).toBeGreaterThan(50);
    expect(metrics.overlap).toBeFalsy();
    expect(metrics.tabsOverflow).toBe('auto');
    expect(metrics.actionsOverflow).toBe('auto');
  });
});

test.describe('v1.4.5.1 turn unlock hotfix', () => {
  test('turn 130 advances to 131', async ({ page }) => {
    await clearStorage(page);
    await createGame(page, 0, 'small');
    await page.evaluate(() => {
      const d = window.__epohiDebug();
      d.state.turn = 130;
      d.render();
    });
    await page.locator('#endTurnBtn').click();
    await expect(page.locator('#turnValue')).toHaveText('131');
    await expect(page.locator('#endTurnBtn')).toBeEnabled();
  });

  test('rejected autosave does not leave the end turn button disabled', async ({ page }) => {
    await clearStorage(page);
    await createGame(page, 0, 'small');
    await page.evaluate(() => {
      window.__epohiDebug().setAutoSaveForTests(() => Promise.reject(new Error('autosave failed for test')));
    });
    await page.locator('#endTurnBtn').click();
    await expect(page.locator('#turnValue')).toHaveText('2');
    await expect(page.locator('#endTurnBtn')).toBeEnabled();
  });

  test('pending autosave does not prevent the next turn after calculation finishes', async ({ page }) => {
    await clearStorage(page);
    await createGame(page, 0, 'small');
    await page.evaluate(() => {
      window.__epohiDebug().setAutoSaveForTests(() => new Promise(() => {}));
    });
    await page.locator('#endTurnBtn').click();
    await expect(page.locator('#turnValue')).toHaveText('2');
    await expect(page.locator('#endTurnBtn')).toBeEnabled();
    await page.locator('#endTurnBtn').click();
    await expect(page.locator('#turnValue')).toHaveText('3');
    await expect(page.locator('#endTurnBtn')).toBeEnabled();
  });

  test('canSaveNow returns true after turn calculation while autosave is still pending', async ({ page }) => {
    await clearStorage(page);
    await createGame(page, 0, 'small');
    await page.evaluate(() => {
      window.__epohiDebug().setAutoSaveForTests(() => new Promise(() => {}));
    });
    await page.locator('#endTurnBtn').click();
    await expect(page.locator('#turnValue')).toHaveText('2');
    await expect.poll(() => page.evaluate(() => window.__epohiDebug().canSaveNow())).toBe(true);
    await expect(page.locator('#endTurnBtn')).toBeEnabled();
  });
});
