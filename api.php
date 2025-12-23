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
 * Sends a JSON response and exits.
 */
function jsonResponse($data, $code = 200) {
    if (ob_get_length()) ob_clean(); // Ensure no stray output breaks JSON
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

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
        
        flock($fp, LOCK_SH);
        $content = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        
        header('Content-Type: application/json');
        echo $content ? $content : json_encode($default);
        exit;
    } else if ($method === 'POST') {
        $input = file_get_contents('php://input');
        $newData = json_decode($input, true);
        if ($newData === null) {
            jsonResponse(['error' => 'Invalid JSON'], 400);
        }
        
        $fp = fopen($filePath, 'c+b');
        if (!$fp) jsonResponse(['error' => 'Could not open file'], 500);
        
        if (flock($fp, LOCK_EX)) {
            rewind($fp);
            $oldContent = stream_get_contents($fp);
            if (function_exists('mb_convert_encoding')) {
                $oldContent = mb_convert_encoding($oldContent, 'UTF-8', 'UTF-8,GBK,ISO-8859-1');
            }
            $oldData = json_decode($oldContent, true);

            // v1.8.0: Smart Merge for ALL critical files
            if ($filename === 'shops.json' && is_array($oldData) && is_array($newData)) {
                // Preserve internalStatus
                $lockMap = [];
                foreach ($oldData as $oldAccount) {
                    if (!isset($oldAccount['inventory']) || !is_array($oldAccount['inventory'])) continue;
                    foreach ($oldAccount['inventory'] as $oldItem) {
                        if (isset($oldItem['internalStatus']) && $oldItem['internalStatus'] === 'occupied') {
                            $lockMap[(string)$oldItem['id']] = $oldItem;
                        }
                    }
                }
                foreach ($newData as &$newAccount) {
                    if (!isset($newAccount['inventory']) || !is_array($newAccount['inventory'])) continue;
                    foreach ($newAccount['inventory'] as &$newItem) {
                        $id = (string)$newItem['id'];
                        if (isset($lockMap[$id])) {
                            $newItem['internalStatus'] = $lockMap[$id]['internalStatus'];
                            $newItem['lastMatchedTime'] = isset($lockMap[$id]['lastMatchedTime']) ? $lockMap[$id]['lastMatchedTime'] : null;
                        }
                    }
                }
                $input = json_encode($newData, JSON_UNESCAPED_UNICODE);
            } else if ($filename === 'orders.json' && is_array($oldData) && is_array($newData)) {
                // v1.8.0: Lossless Order Merge
                // v1.8.9: Smart Status Protection (Prevent Stale Overwrites)
                $orderMap = [];
                foreach ($oldData as $o) $orderMap[$o['id']] = $o;
                
                foreach ($newData as $o) {
                    $id = $o['id'];
                    if (isset($orderMap[$id])) {
                        // Smart Merge: Don't let 'pending' overwrite terminal states
                        $oldStatus = isset($orderMap[$id]['status']) ? $orderMap[$id]['status'] : '';
                        $newStatus = isset($o['status']) ? $o['status'] : '';
                        
                        $terminals = ['success', 'paid', 'cancelled', 'refunded', 'failed', 'refund'];
                        if (in_array(strtolower($oldStatus), $terminals) && strtolower($newStatus) === 'pending') {
                            $o['status'] = $oldStatus; // Keep server's terminal status
                        }
                    }
                    $orderMap[$id] = $o; 
                }
                $input = json_encode(array_values($orderMap), JSON_UNESCAPED_UNICODE);
            }

            ftruncate($fp, 0);
            rewind($fp);
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
    
    $fp = fopen($filePath, 'c+b');
    if (!$fp) return "Could not open $filename for appending";
    
    if (flock($fp, LOCK_EX)) {
        rewind($fp);
        $content = stream_get_contents($fp);
        
        $data = json_decode($content, true);
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            // Fix encoding
            if (function_exists('mb_convert_encoding')) {
                $content = mb_convert_encoding($content, 'UTF-8', 'UTF-8,GBK,ISO-8859-1');
                $data = json_decode($content, true);
            }
        }
        
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
    return "Could not acquire lock for $filename";
}

/**
 * Atomically finds and locks an inventory item.
 * v1.8.0 Hardened: Accepts filter criteria
 */
function matchAndLockItem($targetPrice, $matchedTime, $filters = []) {
    global $baseDir;
    $filePath = $baseDir . '/shops.json';
    
    if (!file_exists($filePath)) return "shops.json not found";
    
    $fp = fopen($filePath, 'c+b');
    if (!$fp) return "Could not open shops.json";
    
    if (flock($fp, LOCK_EX)) {
        rewind($fp);
        $content = stream_get_contents($fp);
        if (function_exists('mb_convert_encoding')) {
            $content = mb_convert_encoding($content, 'UTF-8', 'UTF-8,GBK,ISO-8859-1');
        }
        $data = json_decode($content, true);
        
        if (!is_array($data)) {
            flock($fp, LOCK_UN);
            fclose($fp);
            return "Inventory data invalid";
        }
        
        $matchedAccIdx = -1;
        $matchedItemIdx = -1;
        
        $fallbackAccIdx = -1;
        $fallbackItemIdx = -1;
        
        // Extract filters
        $specificShopId = isset($filters['specificShopId']) ? (string)$filters['specificShopId'] : null;
        $excludeIds = isset($filters['excludeIds']) ? (array)$filters['excludeIds'] : [];
        $validityDuration = isset($filters['validityDuration']) ? (int)$filters['validityDuration'] : 180;
        $validityMs = $validityDuration * 1000;

        foreach ($data as $accIdx => $account) {
            // Filter by Specific Shop
            if ($specificShopId && (string)$account['id'] !== $specificShopId) continue;
            if (!isset($account['inventory']) || !is_array($account['inventory'])) continue;

            foreach ($account['inventory'] as $itemIdx => $item) {
                $id = (string)$item['id'];
                if (in_array($id, $excludeIds)) continue;

                // Matching criteria
                $price = (float)$item['price'];
                $status = (string)$item['status'];
                $internalStatus = isset($item['internalStatus']) ? $item['internalStatus'] : 'idle';
                
                $isStatusOk = (strpos($status, '售') !== false || $status === 'active' || strpos($status, 'sale') !== false || strpos($status, 'Normal') !== false) && 
                               (strpos($status, '已售出') === false && strpos($status, 'Sold') === false);
                               
                // Expiry Check (Safety: use server time)
                $isOccupied = ($internalStatus === 'occupied');
                $lastTime = isset($item['lastMatchedTime']) ? (float)$item['lastMatchedTime'] : 0;
                $isExpired = $isOccupied && ($lastTime > 0) && ((time() * 1000) - $lastTime > $validityMs);

                if ($isStatusOk && ($internalStatus === 'idle' || $isExpired)) {
                    // Priority 1: Exact Price Match
                    if (abs($price - (float)$targetPrice) < 0.01) {
                        $matchedAccIdx = $accIdx;
                        $matchedItemIdx = $itemIdx;
                        break 2;
                    }
                    // Priority 2: Fallback
                    if ($fallbackAccIdx === -1) {
                        $fallbackAccIdx = $accIdx;
                        $fallbackItemIdx = $itemIdx;
                    }
                }
            }
        }
        
        // Final Selection
        $finalAccIdx = ($matchedAccIdx !== -1) ? $matchedAccIdx : $fallbackAccIdx;
        $finalItemIdx = ($matchedItemIdx !== -1) ? $matchedItemIdx : $fallbackItemIdx;

        if ($finalAccIdx !== -1 && $finalItemIdx !== -1) {
            // Apply Lock
            $data[$finalAccIdx]['inventory'][$finalItemIdx]['internalStatus'] = 'occupied';
            $data[$finalAccIdx]['inventory'][$finalItemIdx]['lastMatchedTime'] = $matchedTime;
            
            $finalMatchedItem = $data[$finalAccIdx]['inventory'][$finalItemIdx];
            $finalMatchedAccount = $data[$finalAccIdx];
            
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($data, JSON_UNESCAPED_UNICODE));
            fflush($fp);
            flock($fp, LOCK_UN);
            fclose($fp);
            return [
                'item' => $finalMatchedItem,
                'account' => $finalMatchedAccount
            ];
        }
        
        flock($fp, LOCK_UN);
        fclose($fp);
        return "No matching inventory found";
    }
    fclose($fp);
    return "Lock error during matching";
}

/**
 * Atomically locks an inventory item by ID.
 */
function atomicLockItem($inventoryId, $matchedTime) {
    global $baseDir;
    $filePath = $baseDir . '/shops.json';
    
    if (!file_exists($filePath)) return "shops.json not found";
    
    $fp = fopen($filePath, 'c+b');
    if (!$fp) return "Could not open shops.json";
    
    if (flock($fp, LOCK_EX)) {
        rewind($fp);
        $content = stream_get_contents($fp);
        
        // v1.6.8: Force UTF-8 before decode to handle broken status chars
        if (function_exists('mb_convert_encoding')) {
            $content = mb_convert_encoding($content, 'UTF-8', 'UTF-8,GBK,ISO-8859-1');
        }
        
        $data = json_decode($content, true);
        if ($data === null) {
            flock($fp, LOCK_UN);
            fclose($fp);
            $errCode = json_last_error();
            return "shops.json parse failed (Code: $errCode)";
        }
        
        if (!is_array($data)) {
            flock($fp, LOCK_UN);
            fclose($fp);
            return "shops.json is not an array";
        }
        
        $found = false;
        $targetId = (string)$inventoryId;
        
        foreach ($data as &$account) {
            if (!isset($account['inventory']) || !is_array($account['inventory'])) continue;
            foreach ($account['inventory'] as &$item) {
                if ((string)$item['id'] === $targetId) {
                    $item['internalStatus'] = 'occupied';
                    $item['lastMatchedTime'] = $matchedTime;
                    $found = true;
                    break 2;
                }
            }
        }
        
        if ($found) {
            ftruncate($fp, 0);
            rewind($fp);
            $json = json_encode($data, JSON_UNESCAPED_UNICODE);
            if ($json === false) {
                flock($fp, LOCK_UN);
                fclose($fp);
                return "Write encoding failed";
            }
            fwrite($fp, $json);
            fflush($fp);
            flock($fp, LOCK_UN);
            fclose($fp);
            return true;
        }
        
        flock($fp, LOCK_UN);
        fclose($fp);
        return "Item $targetId not found";
    }
    fclose($fp);
    return "Lock acquisition failed";
}

/**
 * Atomically unlocks/releases an inventory item.
 */
function atomicUnlockItem($inventoryId) {
    global $baseDir;
    $filePath = $baseDir . '/shops.json';
    
    if (!file_exists($filePath)) return "shops.json not found";
    
    $fp = fopen($filePath, 'c+b');
    if (!$fp) return "Could not open shops.json";
    
    if (flock($fp, LOCK_EX)) {
        rewind($fp);
        $content = stream_get_contents($fp);
        
        if (function_exists('mb_convert_encoding')) {
            $content = mb_convert_encoding($content, 'UTF-8', 'UTF-8,GBK,ISO-8859-1');
        }
        
        $data = json_decode($content, true);
        if ($data === null) {
            flock($fp, LOCK_UN);
            fclose($fp);
            return "JSON parse failed during unlock";
        }
        
        $found = false;
        $targetId = (string)$inventoryId;
        foreach ($data as &$account) {
            if (!isset($account['inventory']) || !is_array($account['inventory'])) continue;
            foreach ($account['inventory'] as &$item) {
                if ((string)$item['id'] === $targetId) {
                    $item['internalStatus'] = 'idle';
                    unset($item['lastMatchedTime']);
                    $found = true;
                    break 2;
                }
            }
        }
        
        if ($found) {
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($data, JSON_UNESCAPED_UNICODE));
            fflush($fp);
            flock($fp, LOCK_UN);
            fclose($fp);
            return true;
        }
        
        flock($fp, LOCK_UN);
        fclose($fp);
        return "Item $targetId not found to unlock";
    }
    fclose($fp);
    return "Unlock acquisition failed";
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
            $res = atomicAppend('orders.json', $input);
            if ($res === true) {
                jsonResponse(['success' => true]);
            } else {
                jsonResponse(['error' => $res], 500);
            }
            break;
        case 'match_and_lock':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => 'POST required'], 405);
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input || !isset($input['price'])) jsonResponse(['error' => 'Price required'], 400);
            
            $filters = isset($input['filters']) ? (array)$input['filters'] : [];
            $res = matchAndLockItem($input['price'], isset($input['time']) ? $input['time'] : time()*1000, $filters);
            
            if (is_array($res)) {
                jsonResponse(['success' => true, 'data' => $res]);
            } else {
                jsonResponse(['error' => $res], 404);
            }
            break;
        case 'lock_inventory':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => 'POST required'], 405);
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input || !isset($input['id'])) jsonResponse(['error' => 'Invalid data'], 400);
            $res = atomicLockItem($input['id'], isset($input['time']) ? $input['time'] : time()*1000);
            if ($res === true) {
                jsonResponse(['success' => true]);
            } else {
                jsonResponse(['error' => $res], 500);
            }
            break;
        case 'release_inventory':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => 'POST required'], 405);
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input || !isset($input['id'])) jsonResponse(['error' => 'Invalid data'], 400);
            $res = atomicUnlockItem($input['id']);
            if ($res === true) {
                jsonResponse(['success' => true]);
            } else {
                jsonResponse(['error' => $res], 500);
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
