<?php
/**
 * Simple JSON API & Proxy Backend
 * Replicates the functionality of the Node.js proxy-server.cjs
 * 
 * Usage:
 * - Data: /api.php?act=shops (GET/POST)
 * - Proxy: /api.php?act=proxy (POST)
 */

// Version Configuration
define('APP_VERSION', 'v2.2.80');

// Prevent any output before headers
ob_start();

// Handle Fatal Errors & Parse Errors gracefully
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error && ($error['type'] === E_ERROR || $error['type'] === E_PARSE || $error['type'] === E_CORE_ERROR || $error['type'] === E_COMPILE_ERROR)) {
        // Clear any partial output
        if (ob_get_length()) ob_clean();
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Critical PHP Error', 'details' => $error], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        exit;
    }
});

// Suppress PHP warnings/notices that might break JSON
error_reporting(E_ALL); // Log everything to file, but display none
ini_set('display_errors', '0');
ini_set('log_errors', '1');

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

// v2.2.38 Runtime Migration: Ensure columns exist for existing users
if ($act !== 'setup' && file_exists($baseDir . '/db_config.php')) {
    try {
        $db = DB::getInstance();
        $pdo = $db->getConnection();
        // Skip migration if we just ran it recently (optional optimization, but let's just use try-catch for simplicity)
        try { $pdo->exec("ALTER TABLE orders ADD COLUMN lastHeartbeat BIGINT DEFAULT 0"); } catch (Exception $e) {}
        try { $pdo->exec("ALTER TABLE orders ADD COLUMN lockTicket VARCHAR(100)"); } catch (Exception $e) {}
        try { $pdo->exec("ALTER TABLE inventory ADD COLUMN lockTicket VARCHAR(100)"); } catch (Exception $e) {}
    } catch (Exception $e) {
        // DB not ready yet, skip migration
    }
}

class DB {
    private static $instance = null;
    private $pdo;

    private function __construct() {
        global $baseDir;
        $configFile = $baseDir . '/db_config.php';
        
        if (!file_exists($configFile)) {
            throw new Exception('Database configuration not found');
        }
        
        $config = require $configFile;
        
        try {
            $dsn = "mysql:host={$config['host']};port={$config['port']};dbname={$config['database']};charset={$config['charset']}";
            $this->pdo = new PDO($dsn, $config['username'], $config['password']);
            $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            $this->pdo->exec("SET NAMES '{$config['charset']}'");
        } catch (PDOException $e) {
            throw new Exception('MySQL Connection Failed: ' . $e->getMessage());
        }
    }

    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function getConnection() {
        return $this->pdo;
    }


    public function fetchAll($sql, $params = []) {
        return $this->query($sql, $params)->fetchAll();
    }

    public function fetchOne($sql, $params = []) {
        return $this->query($sql, $params)->fetch();
    }

    public function lastInsertId() {
        return $this->pdo->lastInsertId();
    }
    
    // v2.2.58: Robust affected rows support
    private $lastStmt = null;
    public function execute($sql, $params = []) {
        $this->lastStmt = $this->pdo->prepare($sql);
        $this->lastStmt->execute($params);
        return $this->lastStmt;
    }
    
    public function getAffectedRows() {
        return $this->lastStmt ? $this->lastStmt->rowCount() : 0;
    }

    // Proxy for original query method to maintain compatibility
    public function query($sql, $params = []) {
        return $this->execute($sql, $params);
    }
}

// 1. Robust Installation Check
function is_system_installed() {
    global $baseDir;
    $configFile = $baseDir . '/db_config.php';
    
    // If no config file, definitely not installed
    if (!file_exists($configFile)) return false;
    
    try {
        $db = DB::getInstance();
        $stmt = $db->query("SHOW TABLES LIKE 'settings'");
        $hasSettings = $stmt->fetch() !== false;
        
        // Also check if settings table has data
        if ($hasSettings) {
            $count = $db->fetchOne("SELECT COUNT(*) as cnt FROM settings");
            return $count && $count['cnt'] > 0;
        }
        return false;
    } catch (Exception $e) {
        // If connection fails or query fails, not installed
        error_log("Installation check failed: " . $e->getMessage());
        return false;
    }
}

$isInstalled = is_system_installed();

if (!$isInstalled && !in_array($act, ['setup', 'get_ip', 'check_setup', 'test_db_connection'])) {
    jsonResponse(['status' => 'needs_setup', 'message' => 'System needs initialization'], 200);
}

// 2. Initialize DB if potentially installed or for setup
try {
    $db = DB::getInstance();
    
    // v2.2.18: Global Migration Check (Ensures lockTicket column exists even on existing installs)
    if ($isInstalled) {
        try {
            $pdo = $db->getConnection();
            // Robust check: check if column exists
            $checkInv = $pdo->query("SHOW COLUMNS FROM inventory LIKE 'lockTicket'")->fetch();
            if (!$checkInv) {
                $pdo->exec("ALTER TABLE inventory ADD COLUMN lockTicket VARCHAR(100)");
            }
            $checkOrd = $pdo->query("SHOW COLUMNS FROM orders LIKE 'lockTicket'")->fetch();
            if (!$checkOrd) {
                $pdo->exec("ALTER TABLE orders ADD COLUMN lockTicket VARCHAR(100)");
            }

            // v2.2.24: Migration Check for payment_pages
            $checkPages = $pdo->query("SHOW TABLES LIKE 'payment_pages'")->fetch();
            if (!$checkPages) {
                $pdo->exec("CREATE TABLE IF NOT EXISTS payment_pages (
                    id VARCHAR(100) PRIMARY KEY,
                    title VARCHAR(255),
                    channelId VARCHAR(100),
                    minAmount DECIMAL(10,2),
                    maxAmount DECIMAL(10,2),
                    notice TEXT,
                    isOpen TINYINT(1) DEFAULT 1,
                    ipLimitTime DECIMAL(10,2),
                    ipLimitCount INT,
                    ipWhitelist TEXT,
                    createdAt BIGINT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            }
        } catch (Exception $migEx) {
            // Silently ignore or log migration errors to prevent total system failure
            error_log("Migration failed: " . $migEx->getMessage());
        }
    }
} catch (Exception $e) {
    if (!in_array($act, ['setup', 'get_ip', 'check_setup', 'test_db_connection'])) {
        jsonResponse(['error' => 'Database connection failed: ' . $e->getMessage()], 500);
    }
}

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

            // v2.1.3: 健壮性检查 - 如果文件有内容但解析失败，则报错退出，防止清空文件
            if (!empty($oldContent) && $oldData === null && json_last_error() !== JSON_ERROR_NONE) {
                flock($fp, LOCK_UN);
                fclose($fp);
                jsonResponse(['error' => 'Data corrupted, keeping original file'], 500);
            }

            // v1.8.0: Smart Merge for ALL critical files
            if ($filename === 'shops.json' && is_array($oldData) && is_array($newData)) {
                // v2.1.5: Delta Protection Logic
                // We want to update what Admin sent, but PRESERVE what server HAS (like locks)
                $oldAccMap = [];
                foreach ($oldData as $oldAccount) {
                    $accId = (string)$oldAccount['id'];
                    $oldAccMap[$accId] = $oldAccount;
                }

                foreach ($newData as &$newAccount) {
                    $newAccId = (string)$newAccount['id'];
                    if (isset($oldAccMap[$newAccId])) {
                        // Account exists. Merge inventory carefully.
                        $oldInvMap = [];
                        foreach ($oldAccMap[$newAccId]['inventory'] as $oi) {
                            $oldInvMap[(string)$oi['id']] = $oi;
                        }
                        
                        foreach ($newAccount['inventory'] as &$ni) {
                            $niId = (string)$ni['id'];
                            if (isset($oldInvMap[$niId])) {
                                // Item exists. If it was occupied on server, KEEP IT OCCUPIED.
                                if (isset($oldInvMap[$niId]['internalStatus']) && $oldInvMap[$niId]['internalStatus'] === 'occupied') {
                                    $ni['internalStatus'] = 'occupied';
                                    $ni['lastMatchedTime'] = $oldInvMap[$niId]['lastMatchedTime'];
                                    $ni['lockTicket'] = isset($oldInvMap[$niId]['lockTicket']) ? $oldInvMap[$niId]['lockTicket'] : null;
                                }
                            }
                        }
                    }
                }
                $input = json_encode($newData, JSON_UNESCAPED_UNICODE);
            }
 else if ($filename === 'orders.json' && is_array($oldData) && is_array($newData)) {
                // v1.8.0: Lossless Order Merge
                // v1.8.9: Smart Status Protection (Prevent Stale Overwrites)
                $orderMap = [];
                foreach ($oldData as $o) {
                    if (isset($o['id'])) $orderMap[$o['id']] = $o;
                }
                
                foreach ($newData as $o) {
                    if (!isset($o['id'])) continue;
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
                // v2.1.3: 确保按时间排序或保持原有顺序
                $finalOrders = array_values($orderMap);
                usort($finalOrders, function($a, $b) {
                    $ta = isset($a['createdAt']) ? strtotime($a['createdAt']) : 0;
                    $tb = isset($b['createdAt']) ? strtotime($b['createdAt']) : 0;
                    return $tb - $ta; // 最新的在前面
                });
                $input = json_encode($finalOrders, JSON_UNESCAPED_UNICODE);
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
 * v2.1.8 SQLite Version: Atomically appends/updates an order.
 */
function atomicAppendOrder($orderData) {
    try {
        $db = DB::getInstance();
        $sql = "INSERT INTO orders (id, orderNo, customer, amount, currency, status, channel, method, createdAt, createdAtMs, inventoryId, accountId, buyerId, internalOrderId) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                orderNo=COALESCE(VALUES(orderNo), orderNo), 
                customer=VALUES(customer), 
                amount=VALUES(amount), 
                status = CASE 
                    WHEN status = 'cancelled' THEN 'cancelled' -- Once cancelled, STAY cancelled (Backend Authority)
                    WHEN status = 'failed' AND VALUES(status) = 'pending' THEN 'failed' -- Failed cannot be revived by pending
                    WHEN VALUES(status) = 'queueing' AND status IN ('success', 'pending', 'cancelled', 'failed') THEN status 
                    ELSE VALUES(status) 
                END, 
                createdAtMs = COALESCE(createdAtMs, VALUES(createdAtMs)),
                inventoryId=COALESCE(VALUES(inventoryId), inventoryId), 
                accountId=COALESCE(VALUES(accountId), accountId), 
                buyerId=COALESCE(VALUES(buyerId), buyerId), 
                internalOrderId=VALUES(internalOrderId)";
        
        // v2.2.60: Detect status transition to 'cancelled' and trigger inventory release
        $existing = $db->fetchOne("SELECT status, inventoryId, lockTicket FROM orders WHERE id = ?", [$orderData['id']]);
        
        $nowMs = round(microtime(true) * 1000);
        $db->query($sql, [
            $orderData['id'],
            isset($orderData['orderNo']) ? $orderData['orderNo'] : null,
            $orderData['customer'],
            (float)$orderData['amount'],
            isset($orderData['currency']) ? $orderData['currency'] : 'CNY',
            $orderData['status'],
            isset($orderData['channel']) ? $orderData['channel'] : 'Zhuanzhuan',
            isset($orderData['method']) ? $orderData['method'] : 'WeChat',
            $orderData['createdAt'],
            isset($orderData['createdAtMs']) ? $orderData['createdAtMs'] : $nowMs,
            isset($orderData['inventoryId']) ? $orderData['inventoryId'] : null,
            isset($orderData['accountId']) ? $orderData['accountId'] : null,
            isset($orderData['buyerId']) ? $orderData['buyerId'] : null,
            isset($orderData['internalOrderId']) ? $orderData['internalOrderId'] : $orderData['id']
        ]);

        // If the order was transition to 'cancelled', release inventory specifically
        if ($orderData['status'] === 'cancelled' && $existing && in_array($existing['status'], ['pending', 'queueing']) && !empty($existing['inventoryId'])) {
            // v2.2.63: Harden release with lockTicket check to prevent "Zombie Releases"
            $db->execute("UPDATE inventory SET internalStatus = 'idle', lastMatchedTime = NULL, lockTicket = NULL WHERE id = ? AND lockTicket = ?", [$existing['inventoryId'], $existing['lockTicket']]);
            if ($db->getAffectedRows() > 0) {
                $db->execute("INSERT INTO lock_logs (orderId, action, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?, ?)", [
                    $orderData['id'], 'INVENTORY_RELEASE', $existing['inventoryId'], "Auto-released via status sync (Transition to CANCELLED) with Ticket Validation", $nowMs
                ]);
            } else {
                $db->execute("INSERT INTO lock_logs (orderId, action, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?, ?)", [
                    $orderData['id'], 'RELEASE_IGNORE', $existing['inventoryId'], "Release ignored: lockTicket mismatch (Item already re-locked by someone else)", $nowMs
                ]);
            }
        }

        // v2.2.50: Price Auto-Sync to Inventory
        if ($orderData['status'] === 'pending' && !empty($orderData['inventoryId']) && !empty($orderData['amount'])) {
            $priceNum = (float)$orderData['amount'];
            $priceStr = number_format($priceNum, 2, '.', '');
            $db->query("UPDATE inventory SET priceNum = ?, price = ? WHERE id = ?", [
                $priceNum, $priceStr, $orderData['inventoryId']
            ]);
        }
        
        return true;
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

/**
 * Reconstructs the nested shops/inventory JSON structure for the frontend.
 */
function getShopsData() {
    try {
        $db = DB::getInstance();
        $shops = $db->fetchAll("SELECT * FROM shops");
        foreach ($shops as &$shop) {
            $shop['inventory'] = $db->fetchAll("SELECT * FROM inventory WHERE shopId = ?", [$shop['id']]);
        }
        return $shops;
    } catch (Exception $e) {
        return [];
    }
}

/**
 * Updates shops and inventory with smart lock preservation.
 */
function updateShopsData($newData) {
    try {
        $db = DB::getInstance();
        $pdo = $db->getConnection();
        $pdo->beginTransaction();

        foreach ($newData as $shop) {
            $db->query("INSERT INTO shops (id, remark, cookie, csrfToken, status, lastUpdated) 
                        VALUES (?, ?, ?, ?, ?, ?) 
                        ON DUPLICATE KEY UPDATE remark=VALUES(remark), cookie=VALUES(cookie), csrfToken=VALUES(csrfToken), status=VALUES(status), lastUpdated=VALUES(lastUpdated)", [
                $shop['id'], $shop['remark'], $shop['cookie'], $shop['csrfToken'], $shop['status'], $shop['lastUpdated']
            ]);

            if (isset($shop['inventory']) && is_array($shop['inventory'])) {
                foreach ($shop['inventory'] as $item) {
                    $existing = $db->fetchOne("SELECT internalStatus, lastMatchedTime, lockTicket FROM inventory WHERE id = ?", [$item['id']]);
                    
                    $internalStatus = isset($item['internalStatus']) ? $item['internalStatus'] : 'idle';
                    $lastMatchedTime = isset($item['lastMatchedTime']) ? (float)$item['lastMatchedTime'] : null;
                    $lockTicket = isset($item['lockTicket']) ? $item['lockTicket'] : null;

                    if ($existing && $existing['internalStatus'] === 'occupied') {
                        $internalStatus = 'occupied';
                        $lastMatchedTime = $existing['lastMatchedTime'];
                        $lockTicket = $existing['lockTicket'];
                    }

                    $db->query("INSERT INTO inventory (id, shopId, childOrderId, infoId, parentTitle, picUrl, price, status, internalStatus, lastMatchedTime, lockTicket) 
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
                                ON DUPLICATE KEY UPDATE 
                                shopId=VALUES(shopId), childOrderId=VALUES(childOrderId), infoId=VALUES(infoId), parentTitle=VALUES(parentTitle), 
                                picUrl=VALUES(picUrl), price=VALUES(price), status=VALUES(status), 
                                internalStatus=VALUES(internalStatus), lastMatchedTime=VALUES(lastMatchedTime), lockTicket=VALUES(lockTicket)", [
                        $item['id'], $shop['id'], $item['childOrderId'], $item['infoId'],
                        $item['parentTitle'], $item['picUrl'], $item['price'],
                        $item['status'], $internalStatus, $lastMatchedTime, $lockTicket
                    ]);
                }
            }
        }
        $pdo->commit();
        return true;
    } catch (Exception $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        return $e->getMessage();
    }
}

/**
 * Fetches all orders from SQLite.
 */
function getOrdersData() {
    try {
        $db = DB::getInstance();
        return $db->fetchAll("SELECT * FROM orders ORDER BY createdAt DESC");
    } catch (Exception $e) {
        return [];
    }
}

/**
 * Settings helpers
 */
function getSettingsData() {
    $db = DB::getInstance();
    $rows = $db->fetchAll("SELECT * FROM settings");
    $settings = [];
    foreach ($rows as $row) {
        $val = $row['value'];
        $settings[$row['key']] = (strpos($val, '{') === 0 || strpos($val, '[') === 0) ? json_decode($val, true) : $val;
    }
    $settings['system_version'] = APP_VERSION;
    return (object)$settings;
}

function updateSettingsData($newData) {
    try {
        $db = DB::getInstance();
        foreach ($newData as $k => $v) {
            $val = is_scalar($v) ? $v : json_encode($v);
            $db->query("INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)", [$k, $val]);
        }
        return true;
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

/**
 * Payment Pages helpers
 */
function getPaymentPagesData() {
    try {
        $db = DB::getInstance();
        return $db->fetchAll("SELECT * FROM payment_pages ORDER BY createdAt DESC");
    } catch (Exception $e) {
        return [];
    }
}

function updatePaymentPagesData($newData) {
    try {
        $db = DB::getInstance();
        $pdo = $db->getConnection();
        $pdo->beginTransaction();

        // Standard approach for bulk sync: Clear and re-insert
        $pdo->exec("DELETE FROM payment_pages");
        
        $stmt = $pdo->prepare("INSERT INTO payment_pages (id, title, channelId, minAmount, maxAmount, notice, isOpen, ipLimitTime, ipLimitCount, ipWhitelist, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        
        foreach ($newData as $page) {
            $stmt->execute([
                $page['id'],
                $page['title'],
                isset($page['channelId']) ? $page['channelId'] : 'default',
                isset($page['minAmount']) ? $page['minAmount'] : null,
                isset($page['maxAmount']) ? $page['maxAmount'] : null,
                isset($page['notice']) ? $page['notice'] : null,
                isset($page['isOpen']) ? ($page['isOpen'] ? 1 : 0) : 1,
                isset($page['ipLimitTime']) ? $page['ipLimitTime'] : null,
                isset($page['ipLimitCount']) ? $page['ipLimitCount'] : null,
                isset($page['ipWhitelist']) ? $page['ipWhitelist'] : null,
                isset($page['createdAt']) ? $page['createdAt'] : (time() * 1000)
            ]);
        }
        
        $pdo->commit();
        return true;
    } catch (Exception $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        return $e->getMessage();
    }
}

/**
 * v2.1.6: Register a waiter in FIFO queue using ClientId instead of IP.
 * This allows multiple tabs/windows on the same machine to have independent queue spots.
 */
function registerAndCheckPriority($price, $clientId) {
    global $baseDir;
    $filePath = $baseDir . '/waiters.json';
    $now = time();
    $timeout = 45; // 45 seconds timeout
    
    $fp = fopen($filePath, 'c+b');
    if (!$fp) return true;
    
    $isFirst = false;
    if (flock($fp, LOCK_EX)) {
        rewind($fp);
        $content = stream_get_contents($fp);
        $waiters = json_decode($content, true);
        if (!is_array($waiters)) $waiters = [];
        
        $priceKey = (string)$price;
        if (!isset($waiters[$priceKey])) $waiters[$priceKey] = [];
        
        // 1. Cleanup expired
        foreach ($waiters as $pk => &$list) {
            foreach ($list as $cid => $ts) {
                if ($now - $ts > $timeout) unset($list[$cid]);
            }
        }
        
        // 2. Add/Update
        if (!isset($waiters[$priceKey][$clientId])) {
            $waiters[$priceKey][$clientId] = $now;
        }
        
        // 3. FIFO Sort
        asort($waiters[$priceKey]);
        $ids = array_keys($waiters[$priceKey]);
        if (isset($ids[0]) && $ids[0] === $clientId) {
            $isFirst = true;
        }
        
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($waiters));
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    return $isFirst;
}

function unregisterWaiter($price, $clientId) {
    global $baseDir;
    $filePath = $baseDir . '/waiters.json';
    if (!file_exists($filePath)) return;
    $fp = fopen($filePath, 'c+b');
    if ($fp && flock($fp, LOCK_EX)) {
        rewind($fp);
        $waiters = json_decode(stream_get_contents($fp), true);
        if (is_array($waiters) && isset($waiters[(string)$price][$clientId])) {
            unset($waiters[(string)$price][$clientId]);
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($waiters));
        }
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

/**
 * v2.1.6: Server-side Atomic IP Logger to fix "Invalid IP Limit" caused by client-side race conditions.
 */
/**
 * v2.1.8 SQLite Version: Server-side Atomic IP Logger
 */
function atomicAddIpLog($ip, $pageId) {
    try {
        $db = DB::getInstance();
        $now = time() * 1000;
        $db->query("INSERT INTO ip_logs (ip, type, timestamp) VALUES (?, ?, ?)", [$ip, $pageId, $now]);
        
        // Cleanup old logs (> 24h)
        $cutoff = $now - (24 * 60 * 60 * 1000);
        $db->query("DELETE FROM ip_logs WHERE timestamp < ?", [$cutoff]);
    } catch (Exception $e) {
        error_log("IP logging failed: " . $e->getMessage());
    }
}

/**
 * Atomically finds and locks an inventory item.
 * v1.8.0 Hardened: Accepts filter criteria
 */
/**
 * v2.1.7: Atomically finds and locks an inventory item based on FIFO position in orders.json.
 * Supports Top-N matching where N is the number of available items.
 */
/**
 * v2.1.8 SQLite Version: Atomically finds and locks an inventory item based on FIFO position.
 */
function matchAndLockItem($targetPrice, $internalOrderId, $filters = []) {
    try {
        $db = DB::getInstance();
        $pdo = $db->getConnection();
        $nowFloat = microtime(true);
        $nowMs = round($nowFloat * 1000);
        $createdAt = date('Y-m-d H:i:s.', (int)$nowFloat) . sprintf("%03d", ($nowFloat - (int)$nowFloat) * 1000);
        $price = (float)$targetPrice;

        // v2.2.39: Status Guard - If order is already matched/complete, don't re-queue it
        $existing = $db->fetchOne("SELECT status, orderNo, inventoryId, accountId, lockTicket FROM orders WHERE id = ?", [$internalOrderId]);
        if ($existing) {
            // v2.2.45 Liveness Check: If user closed page (>30s no heartbeat), cancel queueing order immediately
            if ($existing['status'] === 'queueing' && $existing['lastHeartbeat'] > 0 && ($nowMs - $existing['lastHeartbeat']) > 35000) {
                $db->query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [$internalOrderId]);
                return ['error' => '排队超时或网页已关闭，请重新下单', 'cancelled' => true];
            }
            if ($existing['status'] === 'cancelled') {
                return ['error' => '订单已取消 (管理员手动关闭或心跳超时)', 'cancelled' => true];
            }
            if ($existing['status'] !== 'queueing' && $existing['status'] !== 'failed') {
                // Already pending/success, return status data
                if ($existing['status'] === 'pending' || $existing['status'] === 'success') {
                    // v2.2.64: Lock Integrity Check - If matched, verify lockTicket still matches inventory
                    $match = $db->fetchOne("
                        SELECT i.*, s.cookie, s.remark, s.csrfToken, s.status as shopStatus 
                        FROM inventory i JOIN shops s ON i.shopId = s.id 
                        WHERE i.id = ?", [$existing['inventoryId']]);
                    
                    if (!$match || $match['lockTicket'] !== $existing['lockTicket']) {
                        // Integrity Breach: Item was manually released or re-locked by another process
                        $db->query("UPDATE orders SET status = 'failed' WHERE id = ?", [$internalOrderId]);
                        $db->query("INSERT INTO lock_logs (orderId, action, message, timestamp_ms) VALUES (?, ?, ?, ?)", [
                            $internalOrderId, 'LOCK_STOLEN', "Order matches invalidated: inventory lockTicket mismatch (Admin release or race)", $nowMs
                        ]);
                        return ['error' => '订单匹配已失效（商品已被重新分配或手动下架），请重试', 'cancelled' => true];
                    }

                    return [
                        'item' => $match,
                        'account' => [
                            'id' => $match['shopId'],
                            'remark' => $match['remark'],
                            'cookie' => $match['cookie'],
                            'csrfToken' => $match['csrfToken'],
                            'status' => $match['shopStatus']
                        ],
                        'lockTicket' => $existing['lockTicket'],
                        'internalOrderId' => $internalOrderId
                    ];
                }
            }
        }
        
        // v2.2.30: Force READ COMMITTED to see parallel queue entries immediately
        $pdo->exec("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
        $pdo->beginTransaction();

        // 1. Get Available Items (price match, idle or expired)
        $validityDuration = isset($filters['validityDuration']) ? (int)$filters['validityDuration'] : 180;
        $validityMs = $validityDuration * 1000;
        $specificShopId = isset($filters['specificShopId']) ? (string)$filters['specificShopId'] : null;

        $sql = "SELECT i.*, i.shopId as accountId, s.cookie, s.remark, s.csrfToken, s.status as shopStatus 
                FROM inventory i
                JOIN shops s ON i.shopId = s.id
                WHERE (i.status LIKE '%在售%' OR i.status LIKE '%待卖%' OR i.status LIKE '%出售%' OR i.status LIKE '%代卖%')
                AND i.internalStatus = 'idle'";

        $params = [];
        
        if ($specificShopId) {
            $sql .= " AND i.shopId = ?";
            $params[] = $specificShopId;
        }

        // v2.2.63: Add absolute stable ordering to prevent competition on identical result sets
        $sql .= " ORDER BY i.id ASC, i.priceNum ASC";
        
        $availableItems = $db->fetchAll($sql, $params);
        $N = count($availableItems);

        // v2.2.41 Global FIFO First Principles: Remove amount filter for absolute fairness
        // and enforce strict 30s active cutoff.
        $activeCutoff = $nowMs - 30000;
         $queueSql = "SELECT id FROM orders 
                      WHERE status = 'queueing' 
                      AND (lastHeartbeat > ? OR id = ?)
                      ORDER BY createdAtMs ASC, id ASC
                      FOR UPDATE";
         $queue = $db->fetchAll($queueSql, [$activeCutoff, $internalOrderId]);
        $queueIds = array_column($queue, 'id');
        $pos = array_search($internalOrderId, $queueIds);

        if ($pos === false) {
            // First Principles: createdAt only on INSERT, ignore on DUPLICATE
            $db->query("INSERT INTO orders (id, customer, amount, status, channel, method, createdAt, createdAtMs, internalOrderId, lastHeartbeat) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE 
                        status = CASE 
                            WHEN VALUES(status) = 'queueing' AND status IN ('success', 'pending', 'cancelled', 'failed') THEN status 
                            ELSE VALUES(status) 
                        END,
                        lastHeartbeat = VALUES(lastHeartbeat)", [
                $internalOrderId, 'Guest', $price, 'queueing', 'Zhuanzhuan', 'WeChat', $createdAt, $nowMs, $internalOrderId, $nowMs
            ]);
            
            // Re-fetch queue
            $queue = $db->fetchAll($queueSql, [$activeCutoff, $internalOrderId]);
            $queueIds = array_column($queue, 'id');
            $pos = array_search($internalOrderId, $queueIds);
            
            if ($pos === false) {
                 $pdo->rollBack();
                 return "排队系统异常，无法创建订单 (ID: $internalOrderId)";
            }
        } else {
            // Update Heartbeat to stay "active" in queue
            $db->query("UPDATE orders SET lastHeartbeat = ? WHERE id = ?", [$nowMs, $internalOrderId]);
        }

        // v2.2.27 optimization: If no items OR position >= N, it's queueing
        if ($N === 0 || $pos >= $N) {
            $pdo->commit(); // v2.2.29: Commit the queueing status so it's visible to other parallel requests
            return [
                'status' => 'queueing',
                'pos' => $pos + 1,
                'available' => $N,
                'message' => "排队中，目前排位: 第 " . ($pos + 1) . " 位"
            ];
        }

        // 3. Match and Lock (v2.2.31 Atomic Iterative Locking)
        $matched = false;
        $lockTicket = uniqid('LT_', true);
        $match = null; // Initialize $match to ensure it's defined if loop doesn't run or match fails

        // v2.2.63 Strict FIFO Principle: Only Rank 0 (absolute front) is allowed to match items.
        // This ensures no two orders ever compete for the same inventory result set at the same time.
        if ($pos === 0 && $N > 0) {
            $currentItem = $availableItems[$pos];
            
            $db->query("INSERT INTO lock_logs (orderId, action, pos, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?, ?, ?)", [
                $internalOrderId, 'LOCK_START', $pos, $currentItem['id'], "Attempting to lock inventory item", $nowMs
            ]);

            // 1. Lock Inventory Row
            $stmt = $pdo->prepare("UPDATE inventory SET internalStatus = 'occupied', lastMatchedTime = ?, lockTicket = ? WHERE id = ? AND internalStatus = 'idle'");
            $stmt->execute([$nowMs, $lockTicket, $currentItem['id']]);
            
            if ($stmt->rowCount() > 0) {
                // 2. Update Order Status - CRITICAL: Must be still queueing!
                // v2.2.71 FIX: Reset creation time upon match so validity window starts NOW, not when queued.
                $createdAtNew = date('Y-m-d H:i:s.', (int)$nowFloat) . sprintf("%03d", ($nowFloat - (int)$nowFloat) * 1000);
                $orderStmt = $pdo->prepare("UPDATE orders SET status = 'pending', inventoryId = ?, accountId = ?, lockTicket = ?, createdAt = ?, createdAtMs = ? WHERE id = ? AND status = 'queueing'");
                $orderStmt->execute([$currentItem['id'], $currentItem['shopId'], $lockTicket, $createdAtNew, $nowMs, $internalOrderId]);
                
                if ($orderStmt->rowCount() > 0) {
                    $matched = true;
                    $match = $currentItem;
                    $db->query("INSERT INTO lock_logs (orderId, action, pos, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?, ?, ?)", [
                        $internalOrderId, 'LOCK_SUCCESS', $pos, $currentItem['id'], "Successfully matched (Global FIFO) and updated order", $nowMs
                    ]);
                    
                    // v2.2.50: Price Auto-Sync to Inventory (Moved inside match transaction)
                    $priceNum = (float)$price;
                    $priceStr = number_format($priceNum, 2, '.', '');
                    $pdo->prepare("UPDATE inventory SET priceNum = ?, price = ? WHERE id = ?")
                        ->execute([$priceNum, $priceStr, $currentItem['id']]);
                } else {
                    // TRANSACTIONAL ROLLBACK: Order was cancelled or changed while we were locking inventory
                    $pdo->prepare("UPDATE inventory SET internalStatus = 'idle', lastMatchedTime = NULL, lockTicket = NULL WHERE id = ? AND lockTicket = ?")
                        ->execute([$currentItem['id'], $lockTicket]);
                    
                    $db->query("INSERT INTO lock_logs (orderId, action, pos, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?, ?, ?)", [
                        $internalOrderId, 'ROLLBACK_ORDER', $pos, $currentItem['id'], "Order status changed during lock, inventory released", $nowMs
                    ]);

                    $pdo->commit();
                    return [
                        'status' => 'cancelled',
                        'message' => '订单在匹配过程中已失效，锁定已释放'
                    ];
                }
            } else {
                $db->query("INSERT INTO lock_logs (orderId, action, pos, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?, ?, ?)", [
                    $internalOrderId, 'LOCK_FAILED', $pos, $currentItem['id'], "Inventory item already occupied/locked by another process", $nowMs
                ]);
            }
        } else {
            // v2.2.54: Added reason for queue failure to logs
            $msg = ($N == 0) ? "No idle inventory available" : "Queue position exceeds available items count ($N)";
            $db->query("INSERT INTO lock_logs (orderId, action, pos, message, timestamp_ms) VALUES (?, ?, ?, ?, ?)", [
                $internalOrderId, 'QUEUE_WAIT', $pos, $msg, $nowMs
            ]);
        }

        if (!$matched) {
            $pdo->commit(); 
            return [
                'status' => 'queueing',
                'pos' => $pos + 1,
                'available' => $N,
                'message' => "商品被抢先一步，继续排队中，位次: " . ($pos + 1)
            ];
        }

        // Successfully locked $match and updated order in step above
        $pdo->commit();
        
        return [
            'item' => $match,
            'account' => [
                'id' => $match['shopId'],
                'remark' => $match['remark'],
                'cookie' => $match['cookie'],
                'csrfToken' => $match['csrfToken'],
                'status' => $match['shopStatus']
            ],
            'lockTicket' => $lockTicket,
            'internalOrderId' => $internalOrderId
        ];
    } catch (Exception $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        error_log("matchAndLockItem failed: " . $e->getMessage());
        return "数据库操作失败: " . $e->getMessage();
    }
}

/**
 * Atomically locks an inventory item by ID.
 */
function atomicLockItem($inventoryId, $matchedTime) {
    try {
        $db = DB::getInstance();
        $nowMs = time() * 1000;
        $db->query("UPDATE inventory SET internalStatus = 'occupied', lastMatchedTime = ?, lockTicket = ? WHERE id = ?", [
            $nowMs, uniqid('MANUAL_', true), $inventoryId
        ]);
        return true;
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

function atomicUnlockItem($id, $expectedTicket = null) {
    try {
        $db = DB::getInstance();
        $pdo = $db->getConnection();
        $pdo->beginTransaction();

        $sql = "UPDATE inventory SET internalStatus = 'idle', lastMatchedTime = NULL, lockTicket = NULL WHERE id = ?";
        $params = [$id];
        
        // v2.2.68 CAS Protection: If a specific ticket is expected, enforce it!
        if ($expectedTicket) {
            $sql .= " AND lockTicket = ?";
            $params[] = $expectedTicket;
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        
        if ($stmt->rowCount() > 0) {
             // Real release happened
             $pdo->commit();
             // v2.2.69: Enrich Log with Source Info (IP/UA) to detect Phantom Admins
             $clientInfo = $_SERVER['REMOTE_ADDR'] . ' ' . ($_SERVER['HTTP_USER_AGENT'] ?? 'Unknown');
             $db->query("INSERT INTO lock_logs (action, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?)", [
                'INVENTORY_RELEASE', $id, "Manual release success (Ticket: " . ($expectedTicket ?: 'Force') . ") by [$clientInfo]", round(microtime(true) * 1000)
             ]);
             return true;
        } else {
             // Nothing updated? Maybe already idle OR ticket mismatch
             $pdo->rollBack();
             
             // Check if it was a mismatch
             if ($expectedTicket) {
                 $current = $db->fetchOne("SELECT lockTicket FROM inventory WHERE id = ?", [$id]);
                 $actual = $current ? $current['lockTicket'] : 'null';
                 $db->query("INSERT INTO lock_logs (action, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?)", [
                    'RELEASE_IGNORE', $id, "Admin release rejected: Stale ticket ($expectedTicket vs Actual $actual)", round(microtime(true) * 1000)
                 ]);
                 return "商品已被其他订单锁定 (Ticket mismatch)，释放失败。请刷新页面查看最新状态。";
             }
             
             return true; // Was already idle, effectively success
        }
        $db->query("INSERT INTO lock_logs (action, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?)", [
            'INVENTORY_RELEASE', $id, "Physical inventory release triggered", round(microtime(true) * 1000)
        ]);

        $pdo->commit();
        return true;
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log("atomicUnlockItem failed: " . $e->getMessage());
        return $e->getMessage();
    }
}

/**
 * Proactive cleanup: resets expired inventory locks and cancels old stale orders
 * v2.1.1 Enhanced Safety Net
 */
/**
 * Proactive cleanup: resets expired inventory locks and cancels old stale orders
 * v2.1.8 SQLite Version
 */
function proactiveCleanup() {
    try {
        $db = DB::getInstance();
        $pdo = $db->getConnection();
        $now = time();
        $nowMs = $now * 1000;
        
        $pdo->beginTransaction();

        // 1. Cleanup Inventory Locks (occupied > 30 mins)
        $timeoutMs = 30 * 60 * 1000;
        $pdo->prepare("
            UPDATE inventory 
            SET internalStatus = 'idle', lastMatchedTime = NULL, lockTicket = NULL 
            WHERE internalStatus = 'occupied' 
            AND lastMatchedTime IS NOT NULL 
            AND (? - lastMatchedTime) > ?
        ")->execute([$nowMs, $timeoutMs]);

        // 2. Cleanup Old Orders (v2.2.30: Improved date parsing for ms strings)
        // PENDING > 1 hour
        $pdo->prepare("
            UPDATE orders 
            SET status = 'cancelled' 
            WHERE status = 'pending' 
            AND (UNIX_TIMESTAMP() - UNIX_TIMESTAMP(STR_TO_DATE(LEFT(createdAt, 19), '%%Y-%%m-%%d %%H:%%i:%%s'))) > 3600
        ")->execute();

        // QUEUEING > 30s Heartbeat Timeout (v2.2.44)
        $pdo->prepare("
            UPDATE orders 
            SET status = 'cancelled' 
            WHERE status = 'queueing' 
            AND lastHeartbeat > 0 
            AND (? - lastHeartbeat) > 30000
        ")->execute([$nowMs]);

        // QUEUEING > 10m fallback
        $pdo->prepare("
            UPDATE orders 
            SET status = 'cancelled' 
            WHERE status = 'queueing' 
            AND (UNIX_TIMESTAMP() - UNIX_TIMESTAMP(STR_TO_DATE(LEFT(createdAt, 19), '%%Y-%%m-%%d %%H:%%i:%%s'))) > 600
        ")->execute();

        $pdo->commit();
    } catch (Exception $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        error_log("Proactive cleanup failed: " . $e->getMessage());
    }
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
   SETUP & MIGRATION
   --------------------------- */

function performSetup($adminPassword, $dbConfig) {
    global $baseDir;
    
    try {
        // 1. Create db_config.php
        $configContent = "<?php\nreturn [\n    'host' => '{$dbConfig['host']}',\n    'port' => '{$dbConfig['port']}',\n    'database' => '{$dbConfig['database']}',\n    'username' => '{$dbConfig['username']}',\n    'password' => '{$dbConfig['password']}',\n    'charset' => 'utf8mb4'\n];\n";
        
        $configFile = $baseDir . '/db_config.php';
        if (file_put_contents($configFile, $configContent) === false) {
            return ['success' => false, 'error' => 'Failed to create config file'];
        }
        
        // 2. Connect to MySQL
        $dsn = "mysql:host={$dbConfig['host']};port={$dbConfig['port']};dbname={$dbConfig['database']};charset=utf8mb4";
        $pdo = new PDO($dsn, $dbConfig['username'], $dbConfig['password']);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->exec("SET NAMES 'utf8mb4'");
        
        // 3. Create Tables (MySQL Syntax)
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS settings (
                `key` VARCHAR(100) PRIMARY KEY,
                `value` LONGTEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            
            CREATE TABLE IF NOT EXISTS shops (
                id VARCHAR(100) PRIMARY KEY,
                remark VARCHAR(255),
                cookie LONGTEXT,
                csrfToken VARCHAR(255),
                status VARCHAR(50),
                lastUpdated VARCHAR(50),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            
            CREATE TABLE IF NOT EXISTS inventory (
                id VARCHAR(100) PRIMARY KEY,
                shopId VARCHAR(100),
                accountId VARCHAR(100),
                status VARCHAR(50),
                internalStatus VARCHAR(50) DEFAULT 'idle',
                lastMatchedTime BIGINT DEFAULT 0,
                lockTicket VARCHAR(100),
                title VARCHAR(255),
                price DECIMAL(10,2),
                picUrl TEXT,
                parentTitle TEXT,
                childOrderId VARCHAR(100),
                infoId VARCHAR(100),
                FOREIGN KEY (shopId) REFERENCES shops(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            
            CREATE TABLE IF NOT EXISTS orders (
                id VARCHAR(100) PRIMARY KEY,
                orderNo VARCHAR(100),
                customer VARCHAR(100),
                amount DECIMAL(10,2),
                currency VARCHAR(10) DEFAULT 'CNY',
                status VARCHAR(50),
                channel VARCHAR(50),
                method VARCHAR(50),
                createdAt VARCHAR(100),
                createdAtMs BIGINT,
                inventoryId VARCHAR(100),
                accountId VARCHAR(100),
                buyerId VARCHAR(100),
                internalOrderId VARCHAR(100),
                lastHeartbeat BIGINT,
                expireAt BIGINT,
                lockTicket VARCHAR(100),
                INDEX idx_internal (internalOrderId),
                INDEX idx_status (status),
                INDEX idx_created (createdAt),
                INDEX idx_created_ms (createdAtMs)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            
            CREATE TABLE IF NOT EXISTS ip_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ip VARCHAR(50),
                type VARCHAR(50),
                timestamp BIGINT,
                INDEX idx_ip (ip),
                INDEX idx_timestamp (timestamp)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            
            CREATE TABLE IF NOT EXISTS buyers (
                id VARCHAR(100) PRIMARY KEY,
                cookie LONGTEXT,
                remark VARCHAR(255),
                lastUpdated VARCHAR(50)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

            CREATE TABLE IF NOT EXISTS payment_pages (
                id VARCHAR(100) PRIMARY KEY,
                title VARCHAR(255),
                channelId VARCHAR(100),
                minAmount DECIMAL(10,2),
                maxAmount DECIMAL(10,2),
                notice TEXT,
                isOpen TINYINT(1) DEFAULT 1,
                ipLimitTime DECIMAL(10,2),
                ipLimitCount INT,
                ipWhitelist TEXT,
                createdAt BIGINT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

            CREATE TABLE IF NOT EXISTS lock_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                orderId VARCHAR(100),
                action VARCHAR(100),
                pos INT,
                inventoryId VARCHAR(100),
                message TEXT,
                timestamp_ms BIGINT,
                INDEX idx_order (orderId),
                INDEX idx_ts (timestamp_ms)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ");
        
        // v2.2.17 Auto-Migration: Ensure 'lockTicket' column exists for existing installations
        try {
            // Check if column exists, if not adds it.
            // Using a simple try-catch with ALTER is the most robust "add if missing" for MySQL without complex logic
            $pdo->exec("ALTER TABLE inventory ADD COLUMN lockTicket VARCHAR(100)");
        } catch (Exception $e) {
            // Column likely exists, ignore
        }
        try {
            $pdo->exec("ALTER TABLE orders ADD COLUMN lastHeartbeat BIGINT DEFAULT 0");
        } catch (Exception $e) {}
        try {
            $pdo->exec("ALTER TABLE orders ADD COLUMN lockTicket VARCHAR(100)");
        } catch (Exception $e) {
            // Column likely exists, ignore
        }
        try {
            $pdo->exec("ALTER TABLE orders ADD COLUMN createdAtMs BIGINT");
        } catch (Exception $e) {
            // Column likely exists, ignore
        }
        try {
            $pdo->exec("ALTER TABLE orders MODIFY COLUMN createdAt VARCHAR(100)");
        } catch (Exception $e) {
            // Column likely exists, ignore
        }
        try {
            $pdo->exec("ALTER TABLE orders ADD INDEX idx_created_ms (createdAtMs)");
        } catch (Exception $e) {
            // Index likely exists, ignore
        }


        // 4. Migration from JSON
        $migrated = [];
        
        // Settings
        $settingsFile = $baseDir . '/settings.json';
        if (file_exists($settingsFile)) {
            $data = json_decode(file_get_contents($settingsFile), true);
            if (is_array($data)) {
                $stmt = $pdo->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)");
                foreach ($data as $k => $v) {
                    $stmt->execute([$k, is_scalar($v) ? $v : json_encode($v)]);
                }
                $migrated[] = "settings";
            }
        }
        // Force set provided admin password if settings didn't have one
        if ($adminPassword) {
            $stmt = $pdo->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)");
            $stmt->execute(['password', $adminPassword]);
        }

        // Shops & Inventory
        $shopsFile = $baseDir . '/shops.json';
        if (file_exists($shopsFile)) {
            $data = json_decode(file_get_contents($shopsFile), true);
            if (is_array($data)) {
                $stmtShop = $pdo->prepare("INSERT INTO shops (id, remark, cookie, csrfToken, status, lastUpdated) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE remark=VALUES(remark), cookie=VALUES(cookie), csrfToken=VALUES(csrfToken), status=VALUES(status), lastUpdated=VALUES(lastUpdated)");
                $stmtInv = $pdo->prepare("INSERT INTO inventory (id, shopId, childOrderId, orderId, infoId, parentTitle, picUrl, price, priceNum, status, internalStatus, lastMatchedTime, lockTicket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE shopId=VALUES(shopId), childOrderId=VALUES(childOrderId), orderId=VALUES(orderId), infoId=VALUES(infoId), parentTitle=VALUES(parentTitle), picUrl=VALUES(picUrl), price=VALUES(price), priceNum=VALUES(priceNum), status=VALUES(status), internalStatus=VALUES(internalStatus), lastMatchedTime=VALUES(lastMatchedTime), lockTicket=VALUES(lockTicket)");
                
                foreach ($data as $shop) {
                    $stmtShop->execute([$shop['id'], $shop['remark'], $shop['cookie'], $shop['csrfToken'], $shop['status'], $shop['lastUpdated']]);
                    if (isset($shop['inventory']) && is_array($shop['inventory'])) {
                        foreach ($shop['inventory'] as $item) {
                            $stmtInv->execute([
                                $item['id'], $shop['id'], $item['childOrderId'], $item['orderId'], $item['infoId'],
                                $item['parentTitle'], $item['picUrl'], $item['price'], $item['priceNum'],
                                $item['status'], isset($item['internalStatus']) ? $item['internalStatus'] : 'idle',
                                isset($item['lastMatchedTime']) ? $item['lastMatchedTime'] : null,
                                isset($item['lockTicket']) ? $item['lockTicket'] : null
                            ]);
                        }
                    }
                }
                $migrated[] = "shops & inventory";
            }
        }

        // Orders
        $ordersFile = $baseDir . '/orders.json';
        if (file_exists($ordersFile)) {
            $data = json_decode(file_get_contents($ordersFile), true);
            if (is_array($data)) {
                $stmt = $pdo->prepare("INSERT INTO orders (id, orderNo, customer, amount, currency, status, channel, method, createdAt, inventoryId, accountId, buyerId, internalOrderId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE orderNo=VALUES(orderNo), customer=VALUES(customer), amount=VALUES(amount), currency=VALUES(currency), status=VALUES(status), channel=VALUES(channel), method=VALUES(method), createdAt=VALUES(createdAt), inventoryId=VALUES(inventoryId), accountId=VALUES(accountId), buyerId=VALUES(buyerId), internalOrderId=VALUES(internalOrderId)");
                foreach ($data as $o) {
                    $stmt->execute([
                        $o['id'], isset($o['orderNo']) ? $o['orderNo'] : null, $o['customer'], $o['amount'],
                        isset($o['currency']) ? $o['currency'] : 'CNY', $o['status'],
                        isset($o['channel']) ? $o['channel'] : 'Zhuanzhuan',
                        isset($o['method']) ? $o['method'] : 'WeChat',
                        $o['createdAt'], isset($o['inventoryId']) ? $o['inventoryId'] : null,
                        isset($o['accountId']) ? $o['accountId'] : null,
                        isset($o['buyerId']) ? $o['buyerId'] : null,
                        isset($o['internalOrderId']) ? $o['internalOrderId'] : null
                    ]);
                }
                $migrated[] = "orders";
            }
        }

        // Buyers
        $buyersFile = $baseDir . '/buyers.json';
        if (file_exists($buyersFile)) {
            $data = json_decode(file_get_contents($buyersFile), true);
            if (is_array($data)) {
                $stmt = $pdo->prepare("INSERT INTO buyers (id, cookie, remark, lastUpdated) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE cookie=VALUES(cookie), remark=VALUES(remark), lastUpdated=VALUES(lastUpdated)");
                foreach ($data as $b) {
                    $stmt->execute([
                        $b['id'], 
                        isset($b['cookie']) ? $b['cookie'] : null,
                        isset($b['remark']) ? $b['remark'] : null,
                        isset($b['lastUpdated']) ? $b['lastUpdated'] : null
                    ]);
                }
                $migrated[] = "buyers";
            }
        }

        return ['success' => true, 'migrated' => $migrated];
    } catch (PDOException $e) {
        return ['success' => false, 'error' => 'MySQL Error: ' . $e->getMessage()];
    } catch (Exception $e) {
        return ['success' => false, 'error' => $e->getMessage()];
    }
}

/* ---------------------------
   ROUTER
   --------------------------- */

try {
    // v2.2.53 Auto-Migration: Ensure 'lock_logs' table exists
    if ($isInstalled && $act !== 'setup' && $act !== 'test_db_connection') {
        try {
            $db = DB::getInstance();
            $db->query("CREATE TABLE IF NOT EXISTS lock_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                orderId VARCHAR(100),
                action VARCHAR(100),
                pos INT,
                inventoryId VARCHAR(100),
                message TEXT,
                timestamp_ms BIGINT,
                INDEX idx_order (orderId),
                INDEX idx_ts (timestamp_ms)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            
            // v2.2.56 Auto-Migration: Ensure 'createdAtMs' exists in 'orders'
            try { $db->query("ALTER TABLE orders ADD COLUMN createdAtMs BIGINT AFTER createdAt"); } catch (Exception $e) {}
            try { $db->query("CREATE INDEX idx_created_ms ON orders(createdAtMs)"); } catch (Exception $e) {}
            try { $db->query("ALTER TABLE orders MODIFY COLUMN createdAt VARCHAR(100)"); } catch (Exception $e) {}
            try { $db->query("ALTER TABLE orders ADD COLUMN lastHeartbeat BIGINT DEFAULT 0"); } catch (Exception $e) {}
            try { $db->query("ALTER TABLE orders ADD COLUMN expireAt BIGINT"); } catch (Exception $e) {}

            // v2.2.78: Migration - Ensure ip_logs has 'type' column
            try { $db->query("ALTER TABLE ip_logs ADD COLUMN type VARCHAR(100)"); } catch (Exception $e) {}
            try { $db->query("ALTER TABLE ip_logs ADD INDEX idx_type (type)"); } catch (Exception $e) {}

        } catch (Exception $e) {
            // Table exists or DB down, handled by individual actions
        }
    }

    switch ($act) {
        case 'check_setup':
            jsonResponse([
                'installed' => $isInstalled,
                'version' => APP_VERSION,
                'status' => $isInstalled ? 'ok' : 'needs_setup'
            ]);
            break;
        case 'test_db_connection':
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input || !isset($input['host']) || !isset($input['database']) || !isset($input['username'])) {
                jsonResponse(['success' => false, 'error' => 'Missing required parameters'], 400);
            }
            
            try {
                $dsn = "mysql:host={$input['host']};port={$input['port']};dbname={$input['database']};charset=utf8mb4";
                $testPdo = new PDO($dsn, $input['username'], $input['password']);
                $testPdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                jsonResponse(['success' => true, 'message' => 'Connection successful']);
            } catch (PDOException $e) {
                jsonResponse(['success' => false, 'error' => 'Connection failed: ' . $e->getMessage()], 500);
            }
            break;
        // Simple ping to verify API is reachable
        case 'ping':
             jsonResponse(['status' => 'ok', 'message' => 'API is working', 'version' => APP_VERSION]);
             break;

        case 'setup':
            $input = json_decode(file_get_contents('php://input'), true);
            $password = isset($input['password']) ? $input['password'] : null;
            $dbConfig = isset($input['dbConfig']) ? $input['dbConfig'] : null;
            
            if (!$password || !$dbConfig) {
                jsonResponse(['success' => false, 'error' => 'Missing password or database configuration'], 400);
            }
            
            $res = performSetup($password, $dbConfig);
            jsonResponse($res);
            break;
        case 'shops':
            proactiveCleanup(); 
            if ($method === 'GET') {
                jsonResponse(getShopsData());
            } else {
                $input = json_decode(file_get_contents('php://input'), true);
                $res = updateShopsData($input);
                jsonResponse(['success' => $res === true, 'error' => $res !== true ? $res : null]);
            }
            break;
        case 'buyers':
            $db = DB::getInstance();
            if ($method === 'GET') {
                jsonResponse($db->fetchAll("SELECT * FROM buyers"));
            } else {
                $input = json_decode(file_get_contents('php://input'), true);
                if (is_array($input)) {
                    $pdo = $db->getConnection();
                    $pdo->beginTransaction();
                    $stmt = $pdo->prepare("INSERT INTO buyers (id, cookie, remark, lastUpdated) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE cookie=VALUES(cookie), remark=VALUES(remark), lastUpdated=VALUES(lastUpdated)");
                    foreach ($input as $b) {
                        $stmt->execute([
                            $b['id'], 
                            isset($b['cookie']) ? $b['cookie'] : null,
                            isset($b['remark']) ? $b['remark'] : null,
                            isset($b['lastUpdated']) ? $b['lastUpdated'] : null
                        ]);
                    }
                    $pdo->commit();
                    jsonResponse(['success' => true]);
                }
            }
            break;
        case 'orders':
            proactiveCleanup(); 
            if ($method === 'GET') {
                jsonResponse(getOrdersData());
            } else {
                $input = json_decode(file_get_contents('php://input'), true);
                if (is_array($input)) {
                    foreach ($input as $o) atomicAppendOrder($o);
                    jsonResponse(['success' => true]);
                } else if ($input) {
                    $res = atomicAppendOrder($input);
                    jsonResponse(['success' => $res === true, 'error' => $res !== true ? $res : null]);
                }
            }
            break;
        case 'settings':
            if ($method === 'GET') {
                jsonResponse(getSettingsData());
            } else {
                $input = json_decode(file_get_contents('php://input'), true);
                $res = updateSettingsData($input);
                jsonResponse(['success' => $res === true, 'error' => $res !== true ? $res : null]);
            }
            break;
        case 'ip_logs':
            try {
                $db = DB::getInstance();
                jsonResponse($db->fetchAll("SELECT * FROM ip_logs ORDER BY timestamp DESC"));
            } catch (Exception $e) {
                jsonResponse([]);
            }
            break;
        case 'payment_pages':
            if ($method === 'GET') {
                jsonResponse(getPaymentPagesData());
            } else {
                $input = json_decode(file_get_contents('php://input'), true);
                $res = updatePaymentPagesData($input);
                jsonResponse(['success' => $res === true, 'error' => $res !== true ? $res : null]);
            }
            break;
        case 'add_order':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => 'POST required'], 405);
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input) jsonResponse(['error' => 'Invalid data'], 400);

            // v2.2.39: Absolute Server-Side Timing for FIFO stability
            $nowFloat = microtime(true);
            $input['createdAt'] = date('Y-m-d H:i:s.', (int)$nowFloat) . sprintf("%03d", ($nowFloat - (int)$nowFloat) * 1000);
            
            // v2.1.8 SQLite logic: secondary validation
            if (isset($input['lockTicket']) && isset($input['inventoryId'])) {
                $db = DB::getInstance();
                $item = $db->fetchOne("SELECT internalStatus, lockTicket FROM inventory WHERE id = ?", [$input['inventoryId']]);
                if (!$item || $item['internalStatus'] !== 'occupied' || $item['lockTicket'] !== $input['lockTicket']) {
                    jsonResponse(['error' => '库存锁定已失效或被他人抢占，请重新扫描匹配', 'code' => 'LOCK_INVALID'], 409);
                }
            }
            
            $res = atomicAppendOrder($input);
            if ($res === true) {
                jsonResponse(['success' => true]);
            } else {
                jsonResponse(['error' => $res], 500);
            }
            break;
        case 'release_inventory':
            // v2.2.58 DECOMMISSIONED: Direct release via API is now FORBIDDEN to prevent "Release Storms".
            // All inventory releases must flow through Case: cancel_order or admin_release_inventory.
            error_log("Security Alert: Legacy release_inventory called. Ignored.");
            jsonResponse(['success' => false, 'error' => 'API Deprecated. Use admin_release_inventory for manual ops.'], 403);
            break;
        case 'admin_release_inventory':
            // v2.2.61: Restored specifically for EXPLICIT manual admin actions to bypass "Zombie" protection
            $input = json_decode(file_get_contents('php://input'), true);
            $id = isset($input['id']) ? $input['id'] : null;
            $ticket = isset($input['lockTicket']) ? $input['lockTicket'] : null; // v2.2.68: Optional ticket for safety

            if (!$id) jsonResponse(['error' => 'Missing ID'], 400);
            
            $res = atomicUnlockItem($id, $ticket);
            if ($res === true) {
                jsonResponse(['success' => true]);
            } else {
                jsonResponse(['error' => $res], 409);
            }
            break;
            
        case 'cancel_order':
            // v2.2.54: Atomic server-side cancellation and inventory release
            $input = json_decode(file_get_contents('php://input'), true);
            $orderId = isset($input['orderId']) ? $input['orderId'] : null;
            if (!$orderId) {
                jsonResponse(['success' => false, 'error' => 'Missing orderId'], 400);
            }
            
            $db = DB::getInstance();
            $pdo = $db->getConnection();
            $pdo->beginTransaction();
            
            // 1. Find the order and its associated inventory
            $order = $db->fetchOne("SELECT * FROM orders WHERE id = ?", [$orderId]);
            if (!$order) {
                $pdo->rollBack();
                jsonResponse(['success' => false, 'error' => 'Order not found'], 404);
            }
            
            // 2. Mark order as cancelled
            $cancelStmt = $db->execute("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status IN ('queueing', 'pending')", [$orderId]);
            
            if ($db->getAffectedRows() > 0) {
                $db->execute("INSERT INTO lock_logs (orderId, action, message, timestamp_ms) VALUES (?, ?, ?, ?)", [
                    $orderId, 'ORDER_CANCEL', "Order status set to CANCELLED via server-side API", round(microtime(true) * 1000)
                ]);
                
                // 3. Release inventory if associated (Atomic Chain)
                if (!empty($order['inventoryId'])) {
                    // v2.2.63: Harden release with lockTicket check
                    $db->execute("UPDATE inventory SET internalStatus = 'idle', lastMatchedTime = NULL, lockTicket = NULL WHERE id = ? AND lockTicket = ?", [$order['inventoryId'], $order['lockTicket']]);
                    if ($db->getAffectedRows() > 0) {
                        $db->execute("INSERT INTO lock_logs (orderId, action, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?, ?)", [
                            $orderId, 'INVENTORY_RELEASE', $order['inventoryId'], "Inventory released for canceled order " . $orderId, round(microtime(true) * 1000)
                        ]);
                    } else {
                         $db->execute("INSERT INTO lock_logs (orderId, action, inventoryId, message, timestamp_ms) VALUES (?, ?, ?, ?, ?)", [
                            $orderId, 'RELEASE_IGNORE', $order['inventoryId'], "Release ignored: lockTicket mismatch (Order is stale)", round(microtime(true) * 1000)
                        ]);
                    }
                }
            }
            
            $pdo->commit();
            jsonResponse(['success' => true]);
            break;
        case 'match_and_lock':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => 'POST required'], 405);
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input || !isset($input['price']) || !isset($input['internalOrderId'])) {
                jsonResponse(['error' => 'Missing price or internalOrderId'], 400);
            }
            $result = matchAndLockItem($input['price'], $input['internalOrderId'], isset($input['filters']) ? $input['filters'] : []);
            if (is_array($result)) {
                if (isset($result['status']) && $result['status'] === 'queueing') {
                    $db = DB::getInstance();
                    $activeCutoff = (time() * 1000) - 30000;
                    $totalSql = "SELECT COUNT(*) as cnt FROM orders WHERE abs(amount - ?) < 0.01 AND status = 'queueing' AND (lastHeartbeat > ? OR id = ?)";
                    $total = $db->fetchOne($totalSql, [(float)$input['price'], $activeCutoff, $input['internalOrderId']]);
                    jsonResponse(['success' => false, 'queueing' => true, 'pos' => $result['pos'], 'queueSize' => (int)$total['cnt'], 'error' => $result['message']], 403);
                } else {
                    jsonResponse(['success' => true, 'data' => $result]);
                }
            } else {
                jsonResponse(['success' => false, 'queueing' => strpos($result, '排队') !== false, 'error' => $result], 403);
            }
            break;
        case 'add_ip_log':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => 'POST required'], 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $ip = getClientIp();
            $pageId = isset($input['pageId']) ? $input['pageId'] : 'unknown';
            atomicAddIpLog($ip, $pageId);
            jsonResponse(['success' => true, 'ip' => $ip]);
            break;
        case 'get_ip':
            jsonResponse(['ip' => getClientIp(), 'serverTime' => time() * 1000]);
            break;
        case 'proxy':
            if ($method !== 'POST') jsonResponse(['error' => 'Method Not Allowed'], 405);
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input || !isset($input['targetUrl'])) jsonResponse(['error' => 'Missing targetUrl'], 400);

            $targetUrl = $input['targetUrl'];
            $proxyMethod = isset($input['method']) ? $input['method'] : 'GET';
            $headers = isset($input['headers']) ? $input['headers'] : [];
            $cookie = isset($input['cookie']) ? $input['cookie'] : '';
            $body = isset($input['body']) ? $input['body'] : null;

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

            $reqHeaders = [
                'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept: application/json, text/plain, */*',
                'Accept-Language: zh-CN,zh;q=0.9',
                'Connection: keep-alive',
                'Origin: https://www.zhuanzhuan.com',
                'Referer: https://www.zhuanzhuan.com/'
            ];
            foreach ($headers as $k => $v) {
                if (in_array(strtolower($k), ['host', 'user-agent', 'referer'])) continue;
                $reqHeaders[] = "$k: $v";
            }
            if ($cookie) $reqHeaders[] = 'Cookie: ' . $cookie;
            
            curl_setopt($ch, CURLOPT_HTTPHEADER, $reqHeaders);
            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);
            curl_close($ch);

            if ($error) jsonResponse(['error' => "Proxy Error: $error", 'code' => 'CURL_FAIL'], 500);

            // Forward HTTP code and response body
            if (ob_get_length()) ob_clean();
            http_response_code($httpCode);
            header('Content-Type: application/json');
            // If response is not JSON, try to wrap it for logging
            $decoded = json_decode($response, true);
            if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) {
                 echo json_encode(['raw' => $response, 'httpCode' => $httpCode, 'warning' => 'Response is not valid JSON']);
            } else {
                 echo $response;
            }
            break;
        default:
            jsonResponse(['error' => 'Unknown action'], 404);
            break;
    }

} catch (Exception $e) {
    jsonResponse(['error' => $e->getMessage()], 500);
}
