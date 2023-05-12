<?php

require_once 'class_ofxparser.php';

try {
    if ($argc < 2) {
        echo 'Usage: ofx2json.php <ofxfile> <jsonfile>'. PHP_EOL;
        exit(1);
    }

    $ofxfile = $argv[1];
    $jsonfile = $argc >= 3 ? $argv[2] : null;

    $ofxParser = new OfxParser();
    echo $ofxParser->GetJSON($ofxfile, $jsonfile, 'memodb.json');
    echo PHP_EOL;
}
catch (\Exception $e) {
    echo $e->getMessage() . PHP_EOL;
    exit(1);
}
