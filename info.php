<?php
header('Content-Type: application/json');
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
    
    // Check for specific columns
    $columns = $pdo->query("DESCRIBE inventory")->fetchAll(PDO::FETCH_ASSOC);
    $fieldNames = array_column($columns, 'Field');

    $jsonFiles = [
        'shops' => file_exists(__DIR__ . '/shops.json'),
        'inventory' => file_exists(__DIR__ . '/inventory.json'),
        'orders' => file_exists(__DIR__ . '/orders.json')
    ];

    echo json_encode([
        'api_version' => 'v2.2.119',
        'shops_count' => count($shops),
        'inventory_count' => count($inventory),
        'columns' => $fieldNames,
        'missing_critical_columns' => array_values(array_diff(['accountId', 'orderId', 'infoId', 'childOrderId'], $fieldNames)),
        'sample_inventory' => array_slice($inventory, 0, 3),
        'json_files_present' => $jsonFiles
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
