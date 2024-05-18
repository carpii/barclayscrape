Barclayscrape v3.1.01
=====================
Node.js code to programatically manipulate Barclays online banking using [Puppeteer](https://github.com/GoogleChrome/puppeteer).

Fork changes
------------
This is maintenance fork of the original https://github.com/russss/barclayscrape
Thanks to [@russss](https://github.com/russss) for a very useful tool

Fork includes changes to support 2023 Barclays site redesign, and some changes to support Business Banking accounts. 

Installation
------------

Barclayscrape requires Node.js v18.17.1 or above

Due to time constraints and the niche userbase, I do not plan on publishing future releases to npm

To install, clone this repo and run from there using `node barclayscrape.js [options] [command]` 

Usage
-----
```
Options:
  -V, --version       output the version number
  --otp [pin]         PINSentry code
  --motp [pin]        Mobile PINSentry code
  --plogin            Memorable passcode and password
  --no-headless       Show browser window when interacting
  -h, --help          output usage information

Commands:
  list [options]      List all available accounts
    -j, --json               Output account list in JSON format
  get_ofx <out_path>  Fetch .ofx files for all accounts into out_path
  get_ofx_combined <out_path> Download a single .ofx file containing all account activity, into out_path
  config              Set up login details
```

To start, `barclayscrape config` will ask you for your basic login
details. You can test that the login works by running:

    $ barclayscrape --otp <pin> list

Where `<pin>` is the eight-digit code generated by your PINSentry device.
If you're using the mobile PINSentry facility then use `--motp <pin>`
instead of `--otp <pin>`.

To download bank statements in OFX format, you can run:

    $ barclayscrape --otp <pin> get_ofx ./output_dir/

This will download one file per account and place them in `./output_dir/`.

Automating PINSentry Generation
-------------------------------

Typing in your OTP every time is a pain, but there are ways of
automating the process entirely using a USB smartcard reader.

**SECURITY NOTE:** This somewhat defeats the purpose of two-factor
authentication, so please do not implement this unless you are confident
in your ability to adequately secure the machine running it. It is your
money at risk.

The [python-emv](https://github.com/russss/python-emv) package contains
a tool to generate a one-time password on the command line. It can be
hooked up to barclayscrape like so:

    $ barclayscrape --otp `emvtool -p <PIN> cap` get_ofx ./output/

Please be aware that if you're putting this command into cron, any error
emails will include your PIN in the subject line. It's worth using a small
shell script to prevent this.

Logging in using memorable passcode
-----------------------------------
If your Barclays account has been configured to support logging in via 
passcode and password, this feature is supported using `--plogin`,
allowing a completely automated login

PINSentry is still required to transfer funds to non-approved destinations.

**SECURITY NOTE:** It is not recommended you use this feature, unless you are aware 
of the security implications (credentials are NOT encrypted!).

Parsing downloaded OFX to JSON
-----------------------------------
The `contrib` dir contains a simple PHP script, allowing you to parse an OFXv2 or OFXv3  into JSON output.

    Usage:
    
    php ofx2json.php <ofx_filename>
    
  It is recommended to pipe this into `jq`, allowing you to filter or process the JSON further



