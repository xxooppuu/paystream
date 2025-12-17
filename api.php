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

function jsonResponse($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function handleFileRequest($filename, $default = []) {
    global $baseDir, $method;
    $filePath = $baseDir . '/' . $filename;

    if ($method === 'GET') {
        if (file_exists($filePath)) {
            $content = file_get_contents($filePath);
            header('Content-Type: application/json');
            echo $content ? $content : json_encode($default);
        } else {
            jsonResponse($default);
        }
    } else if ($method === 'POST') {
        $input = file_get_contents('php://input');
        if (!json_decode($input)) {
            jsonResponse(['error' => 'Invalid JSON'], 400);
        }
        if (file_put_contents($filePath, $input)) {
            jsonResponse(['success' => true]);
        } else {
            jsonResponse(['error' => 'Failed to write file'], 500);
        }
    }
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
            handleFileRequest('settings.json', new stdClass()); // Empty object for settings
            break;
        case 'payment_pages':
            handleFileRequest('payment_pages.json');
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
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // For simple dev/deployment
            
            // Methods
            if ($proxyMethod === 'POST') {
                curl_setopt($ch, CURLOPT_POST, true);
                if ($body) {
                    // Check if body is array (JSON) or string
                    $postData = is_array($body) ? json_encode($body) : $body;
                    curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
                }
            } else if ($proxyMethod !== 'GET') {
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $proxyMethod);
            }

            // Headers
            $reqHeaders = [];
            $reqHeaders[] = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            if ($cookie) {
                $reqHeaders[] = 'Cookie: ' . $cookie;
            }
            // Merge custom headers
            foreach ($headers as $k => $v) {
                // Skip Host header to avoid conflicts usually
                if (strtolower($k) === 'host') continue;
                $reqHeaders[] = "$k: $v";
            }
            // Ensure Content-Type is set if body exists and not already set
            // (Simple logic, can be improved)
            
            curl_setopt($ch, CURLOPT_HTTPHEADER, $reqHeaders);
            curl_setopt($ch, CURLOPT_HEADER, false); // We don't want headers in output

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);
            curl_close($ch);

            if ($error) {
                jsonResponse(['error' => "Proxy Error: $error"], 500);
            }

            http_response_code($httpCode);
            // Try to detect content type
            // But usually we just return JSON from these APIs
            header('Content-Type: application/json'); 
            echo $response;
            break;

        default:
            jsonResponse(['status' => 'ok', 'message' => 'API is running. Usage: ?act=shops|buyers|orders|settings|proxy']);
            break;
    }

} catch (Exception $e) {
    jsonResponse(['error' => $e->getMessage()], 500);
}
