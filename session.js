const puppeteer = require('puppeteer');
const u = require('./utils.js');
const Account = require('./account.js');

class Session {
  async init(options) {
    this.browser = await puppeteer.launch(options);
    this.page = await this.browser.newPage();
    this.logged_in = false;

  // .accounts_body - used for business banking and pre-2023 personal banking
  // div.c-section.c-section--primary - used for post-2023 personal banking
  this.selector_IsLoggedIn = '.accounts-body, div.c-section.c-section--primary';

  //this.page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await this.page.setViewport({width: 1000, height: 1500});
    await this.page.goto('https://bank.barclays.co.uk');
  }

  async close() {
    this.browser.close();
  }

  async loginStage1(credentials) {
    // Stage 1 of login - enter surname and membership number.
    await u.wait(this.page, '#membership0');
    await u.fillFields(this.page, {
      '#surnameMem': credentials['surname'],
      '#membership0': credentials['membershipno'],
    });
    await u.click(this.page, 'button#continue');
  }

  async loginSelectMethod(method) {
    // There's now a tab bar along the top of the page which needs clicking to switch method.
    let selector = 'button';
    switch (method) {
      case 'motp':
        selector += '#athenticationType_tab_button_0';
        break;

      case 'otp':
        selector += '#athenticationType_tab_button_1';
        break;

      case 'plogin':
        selector += '#athenticationType_tab_button_2';
        break;

      default:
        return;
    }

    await u.wait(this.page, selector);
    await this.page.$eval(selector, el => { el.click() });
  }

  async ensureLoggedIn() {
    // using this selector for site redesign, but not confirmed its appropriate yet
    await u.wait(this.page, this.selector_IsLoggedIn);
    this.logged_in = true;
  }

  async loginOTP(credentials) {
    // Log in using a one time password (PinSentry).
    await this.loginStage1(credentials);
    await this.loginSelectMethod('otp');
    await u.wait(this.page, '#mobilePinsentryCode-input-1');
    await u.fillFields(this.page, {
      'input[name="lastDigits"]': credentials['card_digits'],
      '#mobilePinsentryCode-input-1': credentials['otp'].slice(0, 4),
      '#mobilePinsentryCode-input-2': credentials['otp'].slice(4, 8),
    });

    // Press tab and wait 500ms so annoying JS validation can run
    await this.page.keyboard.press('Tab');
    await new Promise(resolve => setTimeout(resolve, 500));

    await u.click(this.page, 'button#submitAuthentication');
    await this.ensureLoggedIn();
  }

  async loginMOTP(credentials) {
    // Log in using Mobile PinSentry.
    await this.loginStage1(credentials);
    await this.loginSelectMethod('motp');
    await u.wait(this.page, '#mobilePinsentry-input-1');
    await u.fillFields(this.page, {
      '#mobilePinsentry-input-1': credentials['motp'].slice(0, 4),
      '#mobilePinsentry-input-2': credentials['motp'].slice(4, 8),
    });

    // Press tab and wait 500ms so annoying JS validation can run
    await this.page.keyboard.press('Tab');
    await new Promise(resolve => setTimeout(resolve, 500));

    await u.click(this.page, 'button#submitAuthentication');
    await this.ensureLoggedIn();
  }
  
  async loginPasscode(credentials) {
    // Log in using memorable passcode and password
    await this.loginStage1(credentials);
    await this.loginSelectMethod('plogin');
    await u.wait(this.page, '#passcode');
    await u.fillFields(this.page, {
      'input[name="passcode"]': credentials["passcode"]
    })

    let digits = /[0-9]{1,2}/g;
    let char_selectors = [
      'div.memorableWordInputSpaceFirst #memorableCharacters-1',
      'div.memorableWordInputSpace #memorableCharacters-2'
    ];

    for (const [idx, selector] of char_selectors.entries()) {
      await u.wait(this.page, selector);
      let input = await this.page.$(selector)
      let index_label = await this.page.evaluate(el => el.textContent, input)
      let charindex = index_label.match(digits);
      const passcode_char = credentials['password'].substr(charindex-1, 1);
      let field_selector = "input[type='text']#memorableCharacters-input-" + (idx+1).toString();
      await u.fillField(this.page, field_selector, passcode_char)
    }

    // blur the memorable char input (by re-focusing passcode input). This is necessary to allow onblur validation to take place
    await this.page.focus("input#passcode");

    let button_selector = 'button#submitAuthentication';
    await u.wait(this.page, button_selector);
    await u.click(this.page, button_selector);

    // bypass occasional security page, if presented
    await this.loginPasscode_interim_page(credentials);
    await this.ensureLoggedIn();
  }

  async loginPasscode_interim_page(credentials) {
    // check for interim security page
    try {
      await this.page.waitForSelector("span#label-scaCardLastDigits")
    } catch (error) {
      return;
    }

    await u.fillField(this.page, "input#scaCardLastDigits", credentials['card_digits'])
    await u.fillField(this.page, "input#scaSecurityCode", credentials['card_cvv'])
    await u.click(this.page, "button#saveScaAuthentication")
  }

   
  async accounts() {
    // by default only the first few accounts will be shown
    // if a 'Show All' button exists, click that before proceeding, to reveal all accounts
    const btn_exists = await this.page.$eval("#showAllButton button", () => true).catch(() => false)
    if (btn_exists) {
      await u.wait(this.page, "#showAllButton button")
      await u.click_nonav(this.page, "#showAllButton button")
    }

    await u.wait(this.page, ".c-account__content")

    // once the full list of accounts is shown, it potentially includes some accounts with different markup
    // for example, mortgage and insurance accounts are shown differently
    // because all of this runs within the context of the page, it has to be coded really defensively to avoid an in-browser exception
    let accData = await this.page.$$eval('.c-account__content', accounts => {
      return accounts.map(acc => {
        const account_link = acc.querySelector('.c-account__body a')
        const account_link_href = account_link != null ? account_link.getAttribute('href') : ''
        const account_link_txt = account_link !== null ? account_link.textContent.trim() : ''
        const account_balance = acc.querySelector('.c-account__balance [description="Available balance"]')
        const account_balance_txt = account_balance != null ? account_balance.textContent.trim().replace(/[^-0-9\.]/g, '') : ''
        const account_detail = Array.from(acc.querySelectorAll('.c-account__detail--multi span')).map((span) => span.textContent.replace(/[^0-9]/g, '')).join('')
        
        return [
          account_link_href,
          account_detail,
          account_link_txt, 
          account_balance_txt,
        ]
      });
    });

    let res = [];
    accData.forEach(a => {
      if ((a[1] == '') || (a[3] == '')) {
        return;
      }

      res.push(
        new Account(
          this,
          a[0],
          a[1],
          a[2],
          a[3]
        ),
      );
    });
    return res;
  }

  async home() {
    await u.wait(this.page, "a[href$='/olb/balances/digital/btr/home']");
    await u.click(this.page, "a[href$='/olb/balances/digital/btr/home']");
    await u.wait(this.page, this.selector_IsLoggedIn);
  }
}

exports.launch = async (options) => {
  const sess = new Session();
  await sess.init(options);
  return sess;
};
