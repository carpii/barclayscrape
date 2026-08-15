#!/usr/bin/env node
import util from 'util';
import path from 'path';
import fs from 'fs';
const fs_writeFile = util.promisify(fs.writeFile);

import { program, Option } from 'commander';
import Configstore from 'configstore';
import prompt from 'syncprompt';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
import Session from './session.js';
import Services from './services.js';

const conf = new Configstore(pkg.name);

program
  .version(pkg.version)
  .description('Programmatic access to Barclays online banking.')
  .addOption(new Option('--otp [pin]', 'PINSentry code').env('CODE'))
  .option('--motp [pin]', 'Mobile PINSentry code')
  .option('--plogin', 'Login using passcode and password')
  .option('--no-headless', 'Show browser window when interacting');

console.log('Defining list');
program
  .command('list')
  .option('-j, --json', 'Output account list as a JSON object')
  .description('List all available accounts')
  .action(async function (options) {
    console.log('List: Logging in');
    var sess;

    try {
      sess = await auth(options);
    } catch (err) {
      console.error(err);
      return;
    }

    try {
      const accounts = await sess.accounts();
      let account_list = accounts.map( function(acc) { return {'acc_no': acc.number, 'alias': exportLabel(acc), 'label': acc.label, 'balance': acc.balance} });
      if (options.json) {
        console.log(JSON.stringify(account_list));
      }
      else {
        console.table(account_list);
      }
    } catch (err) {
      console.error(err);
    } finally {
      await sess.close();
    }
 
  });

  program
  .command('get_ofx_combined [out_path]')
  .description('Fetch a combined .ofx file containing all accounts into out_path directory')
  .action(async (out_path, options) => {
 		// if out_path is undefined, default to cwd
		if (typeof(out_path) == "undefined") {
		  out_path = '.';
		}

    // check out_path directory exists
    if (!fs.existsSync(out_path)) {
      console.error("Error: Export dir of ["+out_path+"] does not exist. Aborting");
      process.exit(1);
    }

    var sess;
    try {
      sess = await auth();
      try {
        var serv = new Services(sess);
        await serv.get_ofx_combined(out_path)
      } catch (err) {
        console.error(err);
      }
    } catch (err) {
      console.error("Exception in get_ofx_combined: " + err);
      return;
    } finally {
      if (typeof(sess) != "undefined") {
        await sess.close();
      }
    }
  });
  
  program
  .command('get_ofx <out_path>')
  .description('Fetch individual ofx files for each account, into out_path directory')
  .action(async (out_path, options) => {
    console.log('get_ofx: Logging in');
    var sess;
    try {
      sess = await auth();
    } catch (err) {
      console.error("Exception in auth: " + err);
      return;
    }

    try {
      const accounts = await sess.accounts();
      var serv = new Services(sess);
      for (let account of accounts) {
        try {
          await sess.home();
          await serv.get_ofx_for_account(out_path, account.number);
        } catch (err) {
          console.error("Exception in get_ofx_for_account: " + err);
        }
      }
      
    } catch (err) {
      console.log("Exception in get_ofx cmd: " + err);
      console.error(err);
      process.exit(1);
    } finally {
      await sess.close();
    }
  });

program
  .command('config')
  .description('Set up login details')
  .action(options => {
    var surname = prompt('Enter your surname: ');
    conf.set('surname', surname);
    do {
      var num = prompt('Enter your online banking membership number: ');
      if (num.length != 12) {
        console.log('Membership number should be 12 digits');
      }
    } while (num.length != 12);
    conf.set('membershipno', num);
    console.log(
      "\nIf you're going to be logging in using PinSentry or Passcode, please enter the last few\n" +
        "(usually four) digits of your card number, which you're prompted for on login.\n" +
        "If you're using Mobile PinSentry, you can leave this blank.\n",
    );
    var digits = prompt('Enter the last digits of your card number: ');
    conf.set('card_digits', digits);
	
    console.log(
      "\nSome accounts allow logging in via a memorable passcode and password.\n" +
      "It is recommended you leave this blank, unless you understand the security implications.\n",
    );
    do {
      var passcode = prompt('Enter your 5 digit memorable passcode, or leave blank (recommended): ');
      if ((passcode !== '') && (passcode.length != 5)) {
        console.log('Memorable passcode must be 5 digits');
      }
    } while ((passcode !== '') && (passcode.length != 5));

    var password = '';
    if (passcode !== '') {
      console.log(
          "\nEnter your memorable password (Barclays will request 2 random characters from it when logging in via passcode).\n"
        );
        password = prompt('Enter your memorable password: ');
    }

    var card_cvv = '';
    if (passcode !== '') {
      console.log(
        "\nWhen logging in via passcode, Barclays will occasionally prompt for your card CVV number as an additional security measure.\n"
      );

      do {
        card_cvv = prompt('Enter the 3 digit CVV number (on the back of your card), or leave blank to abort: ');
        if ((card_cvv !== '') && (card_cvv.length != 3)) {
          console.log('CVV be exactly 3 digits, or leave blank to abort');
        }
      } while ((card_cvv !== '') && (card_cvv.length != 3));

      if (card_cvv == '') {
        // exit with error message
        console.log("Error: configuration was aborted due to blank CVV digits");
        process.exit(1);
      }

      // defer saving passcode login details, until all fields are valid
      conf.set('passcode', passcode);
      conf.set('password', password);
      conf.set('card_cvv', card_cvv);
    }

    console.log(
      "\nIf you want to export statements with a friendly name instead of the account\n" +
        "number, you can add aliases here.\n" +
        "Press enter to continue if you don't need this or once you're finished.\n",
    );
    var account, alias;
    var aliases = {};
    while (true) {
      account = prompt('Enter an account number: ');
      if (!account) {
        break;
      }
      alias = prompt('Enter friendly label: ');
      if (!alias) {
        break;
      }
      aliases[account] = alias;
    }
    conf.set('aliases', aliases);
    console.log('\nBarclayscrape is now configured.');
    console.log('Credentials were saved to: ' + conf.path);
  });

program.exitOverride((_err) => {
  console.log(_err);
});
try {
  program.parseAsync(process.argv).then(() => {});
} catch (err) {
  console.log(err);
}


function exportLabel(account) {
  let aliases = conf.get('aliases') || {};
  return aliases[account.number] || account.number;
}

async function auth() {
  console.log('Auth');
  if (!(conf.has('surname') && conf.has('membershipno'))) {
    console.error(
      'Barclayscrape has not been configured. Please run `barclayscrape config`',
    );
    program.help();
  }

  const options = program.opts();
  if (!(options.otp || options.motp || options.plogin)) {
    console.error('Must specify either --otp, --motp or --plogin');
    program.help();
  }

  if (options.otp && options.otp.length != 8) {
    console.error('OTP should be 8 characters long');
    program.help();
  }

  if (options.motp && options.motp.length != 8) {
    options.motp = prompt('Enter your 8 digit mobile PIN sentry code: ');
  }

  // The --no-sandbox argument is required here for this to run on certain kernels
  // and containerised setups. My understanding is that disabling sandboxing shouldn't
  // cause a security issue as we're only using one tab anyway.
  const sess = await Session.launch({
    headless: (options.noHeadless ? true: 'shell'),
    args: ['--no-sandbox'],
  });

  try {
    if (options.otp) {
      await sess.loginOTP({
        surname: conf.get('surname'),
        membershipno: conf.get('membershipno'),
        card_digits: conf.get('card_digits'),
        otp: options.otp,
      });
    } else if (options.motp) {
      await sess.loginMOTP({
        surname: conf.get('surname'),
        membershipno: conf.get('membershipno'),
        motp: options.motp,
      });
    } else if (options.plogin) {
        await sess.loginPasscode({
          surname: conf.get('surname'),
          membershipno: conf.get('membershipno'),
          passcode: conf.get('passcode'),
          password: conf.get('password'),
          card_digits: conf.get('card_digits'),
          card_cvv: conf.get('card_cvv'),
      });
    }
  } catch (err) {
    try {
      await sess.close();
    } catch (e) {
    }
    throw err;
  }
  return sess;
}
