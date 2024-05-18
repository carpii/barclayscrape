const fs = require('fs');

// Look for a warning on the page and raise it as an error.
async function raiseWarning(page, action, selector) {
  const warning = await page.$('.notification--warning');
  if (!warning) {
    return
  }

  const warningText = await page.evaluate((el) => { return el.textContent }, warning);
  throw `Barclays Error: "${warningText.trim()}" (while ${action} ${selector})`;
}

exports.dump_html_to = async(page, filename) => {
  const html = await page.content();
  await fs.writeFileSync(filename, html);
}

exports.dump_screenshot_to = async(page, filename) => {
  await page.screenshot({path: filename, fullPage: true});
}

exports.dump_to = async(page, prefix) => {
  await exports.dump_screenshot_to(page, prefix+'.png')
  await exports.dump_html_to(page, prefix+'.html')
}

exports.dump_screenshot = async(page) => {
  await exports.dump_screenshot_to(page, "./error.png");
}

exports.dump_html = async(page) => {
  await exports.dump_html_to(page, "./dump.html");
}

// Click element then wait for any subsequent navigation to complete
exports.click = async (page, selector) => {
  click_withnav(page, selector, true)
};

// Click element without waiting for subsequent navigation (ie, clientside UI javascript) 
exports.click_nonav = async (page, selector) => {
  await click_withnav(page, selector, false)
}

click_withnav = async (page, selector, wait_for_nav) => {
  try {
    steps = []
    if (wait_for_nav) {
      await Promise.all([
        page.waitForNavigation({timeout: 30000}),
        page.$eval(selector, el => { el.click() }),
      ]);
    } else {
      await Promise.all([
        page.$eval(selector, el => { el.click() }),
      ]);
    }
  } catch (err) {
    raiseWarning(page, 'clicking', selector);

    await exports.dump_screenshot(page);
    throw `Error when clicking ${selector} on URL ${page.url()}: ${err}`;
  }
};

exports.fillField = async (page, key, value) => {
    await page.click(key);
    await page.type(key, value);
}

exports.fillFields = async (page, form) => {
  for (let key of Object.keys(form)) {
    await exports.fillField(page, key, form[key]);
  }
};

exports.getAttribute = (page, element, attribute) => {
  return page.evaluate((el, attr) => { return el.getAttribute(attr) }, element, attribute);
};

// waits for a selector to become available
exports.wait = async (page, selector) => {
  try {
    await page.waitForSelector(selector, {timeout: 30000});
  } catch (err) {
    raiseWarning(page, 'fetching', selector);

    await exports.dump_screenshot(page);
    throw new Error(`Couldn't find selector ${selector} on page ${page.url()}. Screenshot saved to error.png`);
  }
};

exports.cssEsc = (string) => {
  return string.replace(/([\\'"])/g, '\\$1');
};
