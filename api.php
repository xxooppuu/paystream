<?php
/**
 * Simple JSON API & Proxy Backend
 * Replicates the functionality of the Node.js proxy-server.cjs
 * 
 * Usage:
 * - Data: /api.php?act=shops (GET/POST)
 * - Proxy: /api.php?act=proxy (POST)
 */

// Prevent any output before headers
ob_start();

// Suppress PHP warnings/notices that might break JSON
error_reporting(0);
ini_set('display_errors', '0');

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, User-Agent, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$act = isset($_GET['act']) ? $_GET['act'] : '';
$method = $_SERVER['REQUEST_METHOD'];
$baseDir = __DIR__; // Store json files in the same directory

/* ---------------------------
   HELPER FUNCTIONS
   --------------------------- */

/**
 * Handles JSON file storage with flock (file locking) to prevent concurrency issues.
 */
function handleFileRequest($filename, $default = []) {
    global $baseDir, $method;
    $filePath = $baseDir . '/' . $filename;

    if ($method === 'GET') {
        if (!file_exists($filePath)) {
            jsonResponse($default);
        }
        $fp = fopen($filePath, 'rb');
        if (!$fp) jsonResponse($default);
        
        flock($fp, LOCK_SH); // Shared lock for reading
        $content = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        
        header('Content-Type: application/json');
        echo $content ? $content : json_encode($default);
        exit;
    } else if ($method === 'POST') {
        $input = file_get_contents('php://input');
        if (!json_decode($input)) {
            jsonResponse(['error' => 'Invalid JSON'], 400);
        }
        
        // Atomic Write with Exclusive Lock
        $fp = fopen($filePath, 'cb'); // Open for reading/writing; place pointer at beginning
        if (!$fp) jsonResponse(['error' => 'Could not open file'], 500);
        
        if (flock($fp, LOCK_EX)) {
            ftruncate($fp, 0); // Clear file
            fwrite($fp, $input);
            fflush($fp);
            flock($fp, LOCK_UN);
            fclose($fp);
            jsonResponse(['success' => true]);
        } else {
            fclose($fp);
            jsonResponse(['error' => 'Could not lock file'], 500);
        }
    }
}

/**
 * Atomically appends a single item to a JSON array file.
 */
function atomicAppend($filename, $newItem) {
    global $baseDir;
    $filePath = $baseDir . '/' . $filename;
    
    $fp = fopen($filePath, 'c+b'); // Read/Write, create if not exist
    if (!$fp) return false;
    
    if (flock($fp, LOCK_EX)) {
        $content = stream_get_contents($fp);
        $data = json_decode($content, true);
        if (!is_array($data)) $data = [];
        
        $data[] = $newItem;
        
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($data, JSON_UNESCAPED_UNICODE));
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        return true;
    }
    fclose($fp);
    return false;
}

/**
 * Atomically locks an inventory item.
 */
function atomicLockItem($inventoryId, $matchedTime) {
    global $baseDir;
    $filePath = $baseDir . '/shops.json';
    
    $fp = fopen($filePath, 'c+b');
    if (!$fp) return false;
    
    if (flock($fp, LOCK_EX)) {
        $content = stream_get_contents($fp);
        $accounts = json_decode($content, true);
        if (!is_array($accounts)) $accounts = [];
        
        $found = false;
        foreach ($accounts as &$account) {
            if (!isset($account['inventory']) || !is_array($account['inventory'])) continue;
            foreach ($account['inventory'] as &$item) {
                if ((string)$item['id'] === (string)$inventoryId) {
                    $item['internalStatus'] = 'occupied';
                    $item['lastMatchedTime'] = (int)$matchedTime;
                    $found = true;
                    break 2;
                }
            }
        }
        
        if ($found) {
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($accounts, JSON_UNESCAPED_UNICODE));
            fflush($fp);
        }
        
        flock($fp, LOCK_UN);
        fclose($fp);
        return $found;
    }
    fclose($fp);
    return false;
}

function getClientIp() {
    $keys = [
        'HTTP_CF_CONNECTING_IP', // Cloudflare
        'HTTP_X_FORWARDED_FOR', 
        'HTTP_X_REAL_IP',
        'HTTP_CLIENT_IP',
        'REMOTE_ADDR'
    ];
    foreach ($keys as $key) {
        if (!empty($_SERVER[$key])) {
            $ips = explode(',', $_SERVER[$key]);
            $ip = trim($ips[0]); // Take the first one
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
    }
    return '0.0.0.0';
}

/* ---------------------------
   ROUTER
   --------------------------- */

try {
    switch ($act) {
        case 'shops':
            handleFileRequest('shops.json');
            break;
        case 'buyers':
            handleFileRequest('buyers.json');
            break;
        case 'orders':
            handleFileRequest('orders.json');
            break;
        case 'settings':
            handleFileRequest('settings.json', (object)[]); 
            break;
        case 'payment_pages':
            handleFileRequest('payment_pages.json');
            break;
        case 'ip_logs':
            handleFileRequest('ip_logs.json');
            break;
        case 'add_order':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => 'POST required'], 405);
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input) jsonResponse(['error' => 'Invalid data'], 400);
            if (atomicAppend('orders.json', $input)) {
                jsonResponse(['success' => true]);
            } else {
                jsonResponse(['error' => 'Failed to add order'], 500);
            }
            break;
        case 'lock_inventory':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => 'POST required'], 405);
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input || !isset($input['id'])) jsonResponse(['error' => 'Invalid data'], 400);
            if (atomicLockItem($input['id'], isset($input['time']) ? $input['time'] : time()*1000)) {
                jsonResponse(['success' => true]);
            } else {
                jsonResponse(['error' => 'Failed to lock item'], 500);
            }
            break;
        case 'get_ip':
            jsonResponse([
                'ip' => getClientIp(),
                'serverTime' => time() * 1000 // In milliseconds
            ]);
            break;
        
        case 'proxy':
            if ($method !== 'POST') {
                jsonResponse(['error' => 'Method Not Allowed'], 405);
            }
            
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input || !isset($input['targetUrl'])) {
                jsonResponse(['error' => 'Missing targetUrl'], 400);
            }

            $targetUrl = $input['targetUrl'];
            $proxyMethod = isset($input['method']) ? $input['method'] : 'GET';
            $headers = isset($input['headers']) ? $input['headers'] : [];
            $cookie = isset($input['cookie']) ? $input['cookie'] : '';
            $body = isset($input['body']) ? $input['body'] : null;

            // Setup Curl
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $targetUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); 
            
            if ($proxyMethod === 'POST') {
                curl_setopt($ch, CURLOPT_POST, true);
                if ($body) {
                    $postData = is_array($body) ? json_encode($body) : $body;
                    curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
                }
            } else if ($proxyMethod !== 'GET') {
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $proxyMethod);
            }

            $reqHeaders = [];
            $reqHeaders[] = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            if ($cookie) {
                $reqHeaders[] = 'Cookie: ' . $cookie;
            }
            foreach ($headers as $k => $v) {
                if (strtolower($k) === 'host') continue;
                $reqHeaders[] = "$k: $v";
            }
            
            curl_setopt($ch, CURLOPT_HTTPHEADER, $reqHeaders);
            curl_setopt($ch, CURLOPT_HEADER, false);

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);
            curl_close($ch);

            if ($error) {
                jsonResponse(['error' => "Proxy Error: $error"], 500);
            }

            http_response_code($httpCode);
            header('Content-Type: application/json'); 
            echo $response;
            break;

        default:
            jsonResponse(['status' => 'ok', 'message' => 'API is running.']);
            break;
    }

} catch (Exception $e) {
    jsonResponse(['error' => $e->getMessage()], 500);
}
