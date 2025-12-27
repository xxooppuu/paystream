<?php
header('Content-Type: application/json');
// Debug Timestamp: 2025-12-28 04:06:00
error_reporting(E_ALL);
ini_set('display_errors', '1');

try {
    $configFile = __DIR__ . '/db_config.php';
    if (!file_exists($configFile)) {
        die(json_encode(['error' => 'db_config.php not found']));
    }
    $config = require $configFile;
    $dsn = "mysql:host={$config['host']};port={$config['port']};dbname={$config['database']};charset=utf8mb4";
    $pdo = new PDO($dsn, $config['username'], $config['password']);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $shops = $pdo->query("SELECT id, remark, status FROM shops")->fetchAll(PDO::FETCH_ASSOC);
    $inventory = $pdo->query("SELECT id, shopId, status, internalStatus FROM inventory")->fetchAll(PDO::FETCH_ASSOC);
    
    // Check for JSON files that might cause migration
    $jsonFiles = [
        'shops' => file_exists(__DIR__ . '/shops.json'),
        'inventory' => file_exists(__DIR__ . '/inventory.json'),
        'orders' => file_exists(__DIR__ . '/orders.json')
    ];

    echo json_encode([
        'version' => 'v2.2.111',
        'shops_in_db' => $shops,
        'inventory_count' => count($inventory),
        'inventory_sample' => array_slice($inventory, 0, 20),
        'json_files_present' => $jsonFiles
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
