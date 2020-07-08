const fs = require('fs').promises;

exports.oplog = [];
exports.dump_index = 0;

// Look for a warning on the page and raise it as an error.
async function raiseWarning(page, action, selector) {
  exports.log_op('raise warning', 'action: ' + action + ', selector: ' + selector, page);

  const warning = await page.$('.notification--warning');
  if (!warning) {
    return
  }

  const warningText = await page.evaluate((el) => { return el.textContent }, warning);
  throw `Barclays Error: "${warningText.trim()}" (while ${action} ${selector})`;
}

// Click a link and wait for the navigation state to go to idle.
exports.click = async (page, selector) => {
  try {
    await Promise.all([
      exports.log_op('click', selector, page),
      page.waitForNavigation({timeout: 30000}),
      
      // Executing el.click() within the page context with $eval means we can
      // click invisible links, which simplifies things.
      page.$eval(selector, el => { el.click() }),
    ]);
  } catch (err) {
    await exports.dump_audit();
    await exports.dump_page(page);
    await exports.dump_elements(page);
    await exports.dump_callstack(err);
    
    await raiseWarning(page, 'clicking', selector);
    throw `Error when clicking ${selector} on URL ${page.url()}: ${err}`;
  }
};

exports.dump_audit = async () => {
  console.log('-'.repeat(20));
  console.log("Debug Log:\n");

  for (let op of Object.keys(exports.oplog)) {
    console.log(exports.oplog[op]);
  }
}

exports.dump_callstack = async(err) => {
  console.log("\nCall Stack:\n");
  console.log(err.stack);
  console.log('-'.repeat(20));
}

exports.dump_elements = async(page) => {
  console.log('\n> Dumping available radios');
  const radio_list = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="radio"]'), element => 'ID: ["' + element.id + '"], Value: [' + element.value + ']'));
  for (let radio of radio_list) {
    console.log('  Found radio: ', radio);
  };

  console.log('> Dumping available text inputs');
  const input_list = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="text"]'), element => 'ID: ["' + element.id + '"]'));
  for (let input of input_list) {
    console.log('  Found text input: ', input);
  };
  
  console.log('> Dumping available password inputs');
  const pwd_list = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="password"]'), element => 'ID: ["' + element.id + '"]'));
  for (let pwdinput of pwd_list) {
    console.log('  Found password input: ', pwdinput);
  };

  console.log('> Dumping available buttons');
  const button_list = await page.evaluate(() => Array.from(document.querySelectorAll('button'), element => 'Text: ["' + element.textContent + '"], ID: ["' + element.id + '"]'));
  for (let button of button_list) {
    console.log('  Found button: ', button);
  };
}

exports.dump_page = async (page) => {
  const screenshotFile = './_debug_' + exports.dump_index.toString() + '.png';
  exports.log_op('Screenshot Dump', screenshotFile, page);
  await page.screenshot({path: screenshotFile, fullPage: true});

  const bodyHtmlPath = './_debug_' + exports.dump_index.toString() + '.html.txt';
  exports.log_op('HTML Dump', bodyHtmlPath, page);
  const html = await page.content();
  await fs.writeFile(bodyHtmlPath, html);
  exports.dump_index++;
}

exports.fillFields = async (page, form) => {
  // Disappointingly, you can't type into multiple fields simultaneously.
  for (let key of Object.keys(form)) {
    if (typeof form[key] !== "undefined")
      exports.log_op('Form key found', key, page);
    else
      exports.log_op('Form key NOT found', key, page);

    await page.type(key, form[key]);
  }
};

exports.getAttribute = (page, element, attribute) => {
  exports.log_op('getAttribute', attr, page);
  let result = page.evaluate((el, attr) => { return el.getAttribute(attr) }, element, attribute);
  exports.log_op('getAttribute OK', attr, page);
  return result;
};

exports.log_op = (op, msg, page) => {
  let page_url = (typeof page != "undefined") ? page.url() + ' --> ' : '';
  exports.oplog.push(new Date().toISOString().substring(0,25) + ' -- ' + op.padEnd(24, ' ') + page_url + msg);
}

// Wait for a selector to become visible, and issue a nice error if it doesn't.
exports.wait = async (page, selector) => {
  try {
    await page.waitFor(selector, {timeout: 30000});
    exports.log_op('wait OK', selector, page);
  } catch (err) {
    exports.log_op('wait FAILED', selector, page);
    await raiseWarning(page, 'fetching', selector);
    
    await exports.dump_page(page);
    await exports.dump_audit(page);

    const err_msg = `Couldn't find selector ${selector} on page ${page.url()}.`;
    
    await exports.dump_elements(page);
    await exports.dump_callstack(err);
    
//    console.log("\n" + err_msg);
    throw err_msg;
  }
};

exports.wait_xpath = async (page, selector) => {
  try {
    exports.log_op('executing page.x selector', selector, page);
	
	  try
    {
       await page.waitForXPath(selector);
    }
    catch (err)
    {
        exports.log_op('interstitial page not found', selector, page);
        return false;
    }
	
    //page.$x(selector, {timeout: 30000});
    exports.log_op('executing page.eval selector', selector, page);
    //page.$eval(selector, el => { el.click() });
  } catch (err) {
    exports.log_op('wait FAILED', selector, page);
    await raiseWarning(page, 'fetching', selector);
    
    await exports.dump_page(page);
    await exports.dump_audit(page);

    const err_msg = `Couldn't find XPATH selector ${selector} on page ${page.url()}.`;
    
    await exports.dump_elements(page);
    await exports.dump_callstack(err);
    
//    console.log("\n" + err_msg);
    throw err_msg;
  }
}

exports.cssEsc = (string) => {
  return string.replace(/([\\'"])/g, '\\$1');
};

exports.goto = async (page, url) => {
  exports.log_op('Load URL', url, page);
  await page.goto(url);  
};
