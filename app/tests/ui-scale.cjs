'use strict';

/* Use the same state and persistence path as a person changing the scale. */
async function setInterfaceScale(page, scale) {
  if (await page.locator('#appDialog').evaluate(element => element.open)) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
  }
  await page.locator('#commandButton').click();
  await page.locator('#commandInput').fill('Typography and accessibility');
  await page.keyboard.press('Enter');
  await page.locator('#interfaceScale').selectOption(String(scale));
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(expected => !document.querySelector('#appDialog').open &&
    Number(getComputedStyle(document.documentElement).zoom) === expected, scale);
}

module.exports = { setInterfaceScale };
