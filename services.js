const u = require('./utils.js');
const path = require('path');
const fs = require('fs');

// Class for accessing features from the 'All Online Services' header menu
module.exports = class Services {
	constructor(session) {
	  this.session = session;
	  this.page = session.page;
	}

	async select_account_to_download(account_number) {
		try {
			// try to expand dropdown list
			await u.wait(this.page, "div.holder.account-list");
			await u.click_nonav(this.page, "div.holder.account-list");

			// try to select account item in list
			const selector_account = "input[type='radio'][value='" + account_number + "']";
			await u.wait(this.page, selector_account);
			await u.click_nonav(this.page, selector_account);
			return true;
		}
		catch (err) { 
			console.log("Exception in select_account_to_download: " + err);
			throw err;
		}
	}

	async get_ofx_combined(out_path, account_number) {
		await this.get_ofx_for_account(out_path, null);
	}

	async get_ofx_for_account(out_path, account_number) {
		// Barclays emits the download as data.ofx, unclear how to override this currently
		let default_filename = path.join(out_path, 'data.ofx');
		let dest_basename = account_number != null ? (account_number + '.ofx') : 'data.ofx';
		let dest_filename = path.join(out_path, dest_basename);
	
		// delete any existing dest_filename in out_path
		try {
			fs.unlinkSync(default_filename);
			fs.unlinkSync(dest_filename);
		} catch(err) {
		}

		// click 'Export All Transaction Data' from header menu
		await u.wait(this.page, "a[href$='/olb/balances/ExportDataStep1.action']");
		await u.click(this.page, "a[href$='/olb/balances/ExportDataStep1.action']");
		
		// wait for download form 
		await this.page.waitForSelector("form[name='process-form']");

		if (account_number != null) {
			try {
				await this.select_account_to_download(account_number);
			}
			catch (err) {
				console.error('Error selecting account to download: ' + err)
				return null;
			}
		}
	
		// click next in download dialog
		await this.page.waitForSelector("input[type='submit']#next_step1");
		await this.page.click("input[type='submit']#next_step1");

		// click download button
		let download_button = "input[type='submit']#data-download";
		await this.page.waitForSelector(download_button);
		
		const client = await this.page.target().createCDPSession();
		await client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: out_path+'/'});
		await this.page.click(download_button);

		// delay for download (is there a more reliable way to detect a completed download response?)
		await this.page.waitForTimeout(5000);
	
		// error checking for existence of download file
		try {
			if (!fs.existsSync(default_filename)) {
				console.log('Error: ' + dest_filename + ' does not exist after attempting OFX download');
				return false;
			}

			try {
				if (default_filename != dest_filename) {
					fs.renameSync(default_filename, dest_filename);
				}
			} catch (err) {
				console.log('Error: Failed to rename "' + default_filename + '" to "' + dest_filename + '"');
				return false;
			}
			
			if (!fs.existsSync(dest_filename)) {
				console.log('Error: Downloaded and renamed file does not exist: ' + dest_filename);
				return false;
			}

			console.log('Exported: ' + dest_filename);
		} catch(err) {
			console.error('Error in get_ofx_for_account: ' + err);
			return false;
		}

		return true;
	}	
}