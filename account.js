const u = require('./utils.js');

// Class for dealing with the Barclays account page.
module.exports = class Account {
  constructor(session, href, number, label, balance) {
    this.session = session;
    this.page = session.page;
    this.href = href;
    this.number = number;
    this.label = label;
    this.balance = balance;
  }

  async select() {
    // navigate to account-specific page
    try {
      await this.page.$eval('[href="'+u.cssEsc(this.href)+'"]', el => { el.click() });
      await u.wait(this.page, '.transaction-list-container-header');
    }
    catch(err) {
      console.warn("Warning: Could not retrieve account [" + this.number + "]. Possibly no transactions, or invalid accounttype.");
      throw err;
    }
  }

  async statementOFX() {
    try {
      // Return an OFX-formatted string of the most recent account statement.
      await this.select();

      // waitFor is required here as of 12/2020
      await this.page.waitForTimeout(1000);

      if (!(await this.page.$('a.export'))) {
        await this.session.home();
        return null;
      }
    } catch(err) {
      await this.session.home();
      return null;
    }

    const ofx = await this.page.evaluate(() => {
      let hashTag = document.querySelector('#trans-hashTag').value;
      let data = JSON.stringify({
        "hashTag": hashTag
      });
      
      let url = "https://bank.barclays.co.uk/olb/trans/transdecouple/ControllerExportTransaction.do?hashTag=" + hashTag + "&param=" + data + "&downloadFormat=ofx";
      return fetch(url, {method: 'GET', credentials: 'include'}).then(r =>
        r.text(),
      );
    });
    console.log('Exported OFX for account [' + this.number + ']');

    await this.session.home();
    return ofx;
  }

  toString() {
    return '[Account ' + this.number + ']';
  }
};
