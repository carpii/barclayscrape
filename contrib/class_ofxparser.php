<?php

class OfxParser
{
    // convert "NONE" strings to null values
    const NONE_TO_NULL = false;

    // timezone for DT fields
    const TARGET_TIMEZONE = 'UTC';

    const ARRAY_FIELDS = [
        // parent => child
        'BANKMSGSRSV1'       => 'STMTTRNRS',
        'STMTTRNRS'          => 'STMTRS',
        'BANKTRANLIST'       => 'STMTTRN',
        'CREDITCARDMSGSRSV1' => 'CCSTMTTRNRS',
        'CCSTMTTRNRS'        => 'CCSTMTRS',
    ];

    private $aliases;
    private $memoFitId;
    private $memoValue;
    private $memoAllowOverwrite;

    public function __construct() {
        $this->aliases = [];
    }

    public function GetJSON($filename, $aliasesfile = null, $memodb_filename = null)
    {
        $result = $this->ParseOfx($filename, $aliasesfile, $memodb_filename);

        return json_encode($result['data'], JSON_PRETTY_PRINT);
    }

    public function SetMemo($filename, $fitid, $memo, $allow_overwrite = false, $memodb_filename = null)
    {
        $this->memoAccountId = null;
        $this->memoFitId = $fitid;
        $this->memoValue = $memo;
        $this->memoAllowOverwrite = $allow_overwrite;
        $this->memoFoundTransactions = 0;

        $result = $this->ParseOfx($filename);

        $this->CheckMemo($result['data']);

        if ($this->memoFoundTransactions === 0) {
            throw new \RuntimeException('FITID not found!');
        }
        else if ($this->memoFoundTransactions > 1) {
            throw new \RuntimeException('FITID is not unique!');
        }

        $this->SetMemoData($result['data']);

        if ($memodb_filename !== null) {
            $this->PersistMemo($memodb_filename, [
                'accountid' => $this->memoAccountId,
                'fitid'     => $fitid,
                'datetime'  => time(),
                'filename'  => realpath($filename),
                'memo'      => $memo,
            ]);
        }

        if ($result['version'] == 1) {
            $newContents = $this->OfxArrayToV1($result['data']);
            file_put_contents($filename, $newContents);
        }
        else if ($result['version'] == 2) {
            $newContents = $this->OfxArrayToV2($result['data']);
            file_put_contents($filename, $newContents);
        }
        else {
            throw new \RuntimeException('Unsupported OFX version');
        }
    }

    private function CheckMemo($element, $key = null)
    {
        if ($key === 'STMTTRN') {
            foreach ($element as $child) {
                if (isset($child['FITID']) && $child['FITID'] == $this->memoFitId) {
                    $this->memoFoundTransactions++;

                    if (isset($child['MEMO']) && !$this->memoAllowOverwrite) {
                        throw new \RuntimeException('Found memo and overwrite not allowed');
                    }
                }
            }
        }

        if (is_array($element)) {
            foreach ($element as $key => $child) {
                $this->CheckMemo($child, $key);
            }
        }
    }

    private function SetMemoData(&$element, $key = null)
    {
        if ($key === 'STMTTRN') {
            foreach ($element as &$child) {
                if (isset($child['FITID']) && $child['FITID'] == $this->memoFitId) {
                    $child['MEMO'] = $this->memoValue;
                    return;
                }
            }
        }
        else if ($key === 'BANKACCTFROM' || $key === 'CCACCTFROM') {
            if (isset($element['ACCTID'])) {
                $this->memoAccountId = $element['ACCTID'];
            }
        }

        if (is_array($element)) {
            foreach ($element as $key => &$child) {
                $this->SetMemoData($child, $key);
            }
        }
    }

    private function PersistMemo($memodb_filename, array $memo_data)
    {
        $memos = [];

        if (file_exists($memodb_filename)) {
            $memos = json_decode(file_get_contents($memodb_filename), true);
        }

        $existing_index = null;

        for ($i = 0; $i < count($memos); $i++) {
            if ($memos[$i]['fitid'] === $memo_data['fitid']) {
                $existing_index = $i;
                break;
            }
        }

        if ($existing_index !== null) {
            $memos[$existing_index]['memo'] = $memo_data['memo'];
        }
        else {
            $memos[] = $memo_data;
        }

        file_put_contents($memodb_filename, json_encode($memos));
    }

    public function PruneMemoDB($memodb_filename, $retain_days)
    {
        $memos = [];

        if (file_exists($memodb_filename)) {
            $memos = json_decode(file_get_contents($memodb_filename), true);
        }

        for ($i = 0; $i < count($memos); $i++) {
            if (time() - $memos[$i]['datetime'] > $retain_days * 86400) {
                unset($memos[$i]);
            }
        }

        file_put_contents($memodb_filename, json_encode($memos));
    }

    private function OfxArrayToV1($ofxData)
    {
        $output = '';

        foreach ($ofxData['headers'] as $headerKey => $headerValue) {
            $output .= $headerKey . ':' . $headerValue . "\n";
        }

        $output .= "\n";

        ob_start();
        $this->OfxArrayToV1_Recursive($ofxData, ['OFX']);
        $output .= ob_get_contents();
        ob_end_clean();

        return $output;
    }

    private function OfxArrayToV1_Recursive($element, $path = [], $overrideKey = null)
    {
        $lastKey = end($path);

        $indentCount = count($path) - 1;

        if ($overrideKey) {
            $indentCount -= 1;
        }

        $indent = str_repeat('  ', $indentCount);

        $data = $element[$lastKey];
        $isArray = false;
        $isData = false;

        if (is_array($data)) {
            $keys = array_keys($data);

            if (is_numeric($keys[0])) {
                $isArray = true;
            }
        }

        if (!$isArray) {
            if ($overrideKey) {
                $lastKey = $overrideKey;
            }
            echo $indent . '<' . $lastKey . '>';
        }

        if (is_array($data)) {
            $keys = array_keys($data);

            if (is_numeric($keys[0])) {
                foreach ($keys as $childKey) {
                    $newpath = array_merge($path, [$childKey]);
                    $this->OfxArrayToV1_Recursive($data, $newpath, $lastKey);
                }
            }
            else {
                echo "\n";
                foreach ($keys as $childKey) {
                    $newpath = array_merge($path, [$childKey]);
                    $this->OfxArrayToV1_Recursive($data, $newpath);
                }
                echo $indent;
            }
        }
        else {
            $isData = true;
            echo $data;
        }

        if (!$isArray) {
            if ($overrideKey) {
                $lastKey = $overrideKey;
            }

            if (!$isData) {
                echo '</' . $lastKey . '>' . "\n";
            }
            else {
                echo "\n";
            }
        }
    }

    private function OfxArrayToV2($ofxData)
    {
        $xml = new SimpleXMLElement('<OFX></OFX>');

        $headerTag = '<?OFX';

        foreach ($ofxData['headers'] as $headerKey => $headerValue) {
            $headerTag .= ' ' . $headerKey . '="' . $headerValue . '"';
        }

        $headerTag .= '?>';

        $this->OfxArrayToV2_Recursive($xml, $ofxData['OFX']);

        return str_replace(
            '<?xml version="1.0"?>',
            '<?xml version="1.0"?>' . "\n" . $headerTag,
            $xml->asXML()
        );
    }

    private function OfxArrayToV2_Recursive($xmlParent, $element)
    {
        if (is_array($element)) {
            foreach ($element as $key => $child) {
                if (is_array($child) && isset($child[0])) {
                    foreach ($child as $subchild) {
                        $xmlChild = $xmlParent->addChild($key);
                        $this->OfxArrayToV2_Recursive($xmlChild, $subchild);
                    }
                }
                else {
                    $xmlChild = $xmlParent->addChild($key);
                    $this->OfxArrayToV2_Recursive($xmlChild, $child);
                }
            }
        }
        else {
            $xmlParent[0] = $element;
        }
    }

    public function ParseOfx($filename, $aliasesfile = null, $memodb_filename = null)
    {
        if ($aliasesfile) {
            $this->aliases = self::ParseAliasesJson($aliasesfile);
        }

        $file = fopen($filename, 'r');

        if (!$file) {
            throw new \RuntimeException('Unable to open input file');
        }

        $firstLine = fgets($file);
        fclose($file);

        // does it look like a standard xml file?
        if (self::StrStartsWith($firstLine, '<?xml')) {
            $result = ['version' => 2, 'data' => $this->ParseOfxV2($filename)];
        }
        else {
            $result = ['version' => 1, 'data' => $this->ParseOfxV1($filename)];
        }

        if ($memodb_filename !== null) {
            $this->ApplyMemoDB($memodb_filename, $result);
        }

        return $result;
    }

    private function ApplyMemoDB($memodb_filename, &$result) {
        if (!file_exists($memodb_filename)) {
            return $result;
        }

        $memos = json_decode(file_get_contents($memodb_filename), true);

        array_walk($result['data'], [$this, 'ApplyMemoDB_Walk'], $memos);

        return $result;
    }

    private function ApplyMemoDB_Walk(&$value, $key, $memos) {
        if (is_array($value)) {
            if (isset($value['FITID'])) {
                $this->ApplyMemoDB_Transaction($value, $memos);
            }
            array_walk($value, [$this, 'ApplyMemoDB_Walk'], $memos);
        }
    }

    private function ApplyMemoDB_Transaction(&$trx, $memos) {
        foreach ($memos as $memo) {
            if ($memo['fitid'] === $trx['FITID']) {
                $trx['MEMO'] = $memo['memo'];
            }
        }
    }

    private function ParseOfxV1($filename)
    {
        $inHeader = true;
        $headers = [];
        $body = [];
        $path = [];
        $arrayFields = self::ARRAY_FIELDS;
        $arrayIndexes = [];

        foreach (array_values($arrayFields) as $field) {
            $arrayIndexes[$field] = 0;
        }

        $file = fopen($filename, 'r');

        while (($line = fgets($file)) !== false) {
            $line = trim($line);

            if (empty($line)) {
                continue;
            }

            if ($inHeader) {
                preg_match('/(.*):(.*)/', $line, $header);
                if ($header) {
                    $headerKey = $header[1];
                    $headerValue = $header[2];
                    $headers[$headerKey] = $this->StrToJsonValue($headerValue);
                }
                else {
                    $inHeader = false;
                }
            }

            if (!$inHeader) {
                preg_match('/<(\/)?(.+?)>([^<]+)?(?:<.+>)?/', $line, $match);
                if ($match) {
                    $closing = $match[1];
                    $key = $match[2];
                    $value = count($match) >= 4 ? $match[3] : '';

                    if ($closing != '') {
                        array_pop($path);

                        if (in_array($key, array_keys($arrayFields))) {
                            $childKey = $arrayFields[$key];
                            $arrayIndexes[$childKey] = 0;
                        }

                        // when closing element is an array, remove the array from path
                        if (in_array($key, array_values($arrayFields))) {
                            array_pop($path);
                        }
                    }
                    else if ($value == '') {
                        array_push($path, $key);

                        // push array index
                        if (in_array($key, array_values($arrayFields))) {
                            array_push($path, $arrayIndexes[$key]);
                            $arrayIndexes[$key]++;
                        }
                    }
                    else {
                        array_push($path, $key);
                        $this->SetValue($body, $path, $value);
                        //echo 'path: ' . implode('/', $path) . ' value: ' . $value . PHP_EOL;
                        array_pop($path);
                    }
                }
            }
        }

        fclose($file);

        if (!array_key_exists('OFX', $body)) {
            throw new \RuntimeException('Missing <OFX> root tag');
        }

        return [
            'headers' => $headers,
            'OFX' => $body['OFX']
        ];
    }

    private function ParseOfxV2($filename)
    {
        $headers = [];
        $body = [];

        $contents = file_get_contents($filename);

        // is there a tag with headers?
        preg_match('/<\?OFX (.+?)\?>/', $contents, $match);
        if ($match) {
            preg_match_all('/([\w\d]+)="(.*?)"/', $match[1], $matches);
            for ($i = 0; $i < count($matches[1]); $i++) {
                $headerKey = $matches[1][$i];
                $headerValue = $matches[2][$i];
                $headers[$headerKey] = $this->StrToJsonValue($headerValue);
            }
        }

        $root = simplexml_load_file($filename);

        if ($root->getName() != 'OFX') {
            throw new \RuntimeException('Missing <OFX> root tag');
        }

        $this->ParseXmlRecursive($root, $body, ['OFX']);

        return [
            'headers' => $headers,
            'OFX' => $body['OFX']
        ];
    }

    private function ParseXmlRecursive($element, &$body, $path = [])
    {
        //echo implode('/', $path) . ' --> ' . $element->getName() . PHP_EOL;

        $childNames = [];
        foreach ($element->children() as $child) {
            $childName = $child->getName();
            if (!array_key_exists($childName, $childNames)) {
                $childNames[$childName] = 0;
            }
            $childNames[$childName]++;
        }

        $arrayIndexes = [];
        foreach ($childNames as $childName => $count) {
            if ($count > 1) {
                $arrayIndexes[$childName] = 0;
            }
        }

        foreach ($element->children() as $child) {
            $childName = $child->getName();
            // if there's more than 1 child with the same name, transform to an array
            if ($childNames[$childName] > 1) {
                $subpath = array_merge($path, [$childName, $arrayIndexes[$childName]]);
                $arrayIndexes[$childName]++;
            }
            else {
                $subpath = array_merge($path, [$childName]);
            }
            $this->ParseXmlRecursive($child, $body, $subpath);
        }

        if (empty($childNames)) {
            $this->SetValue($body, $path, $this->StrToJsonValue($element->__toString()));
        }
    }

    private function SetValue(&$root, $keys, $value)
    {
        $reference = &$root;
        $path = [];
        foreach ($keys as $key) {
            // ignore array index keys in path
            if (!is_numeric($key)) {
                $path[] = $key; // remember original key
            }
            foreach ($this->aliases as $pair) {
                $aliasPath = $pair[0];
                $aliasKey = $pair[1];

                if ($aliasPath == $path) {
                    // if it's an empty string ignore this field completely
                    if ($aliasKey == '') {
                        return;
                    }
                    // sed-like syntax
                    else if (preg_match('/s\/([^\/]+)\/([^\/]*)\/?/', $aliasKey, $subst)) {
                        $key = str_replace($subst[1], $subst[2], $key);
                    }
                    // regular string, just replace the field name with the alias
                    else {
                        $key = $aliasKey;
                    }
                }
            }
            if (!array_key_exists($key, $reference)) {
                $reference[$key] = [];
            }
            $reference = &$reference[$key];
        }
        $reference = $this->StrToJsonValue($value);
    }

    private static function ParseAliasesJson($filename)
    {
        if (!file_exists($filename)) {
            throw new \RuntimeException('Aliases file does not exist');
        }

        $jsonStr = file_get_contents($filename);
        $jsonData = json_decode($jsonStr, true);

        if ($jsonData === null) {
            throw new \RuntimeException('Unable to parse aliases JSON');
        }

        $aliases = [];

        foreach ($jsonData as $xpath => $subst) {
            $path = explode('/', $xpath);
            $aliases[] = [$path, $subst];
            //echo 'alias: ' . implode('/', $path) . ' --> ' . $subst . PHP_EOL;
        }

        return $aliases;
    }

    private static function StrStartsWith($string, $startString)
    {
        $len = strlen($startString);
        return substr($string, 0, $len) === $startString;
    }

    private function StrToJsonValue($val)
    {
        if ($this->memoFitId) {
            return $val;
        }

        if (!is_string($val)) {
            return $val;
        }

        if (self::NONE_TO_NULL && $val == 'NONE') {
            return null;
        }

        preg_match('/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?\[(-?\d):(.*)]/', $val, $datetime);
        if ($datetime) {
            $year    = (int)$datetime[1];
            $month   = (int)$datetime[2];
            $day     = (int)$datetime[3];
            $hours   = (int)$datetime[4];
            $minutes = (int)$datetime[5];
            $seconds = (int)$datetime[6];
            $offset  = (int)$datetime[7];
            $tzname  = $datetime[8];

            $timezone = new \DateTimeZone(sprintf('%+03d:00', $offset));
            $datetime = new \DateTime('now', $timezone);
            $datetime->setDate($year, $month, $day);
            $datetime->setTime($hours, $minutes, $seconds);
            $datetime->setTimezone(new DateTimeZone(self::TARGET_TIMEZONE));

            return $datetime->format('Y-m-d H:i:s');
        }

        return $val;
    }
}