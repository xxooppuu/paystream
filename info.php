<?php
header('Content-Type: application/json');
require_once __DIR__ . '/api.php'; // Get APP_VERSION and logic

error_reporting(E_ALL);
ini_set('display_errors', '1');

try {
    $db = DB::getInstance();
    $pdo = $db->getConnection();

    $shops = $db->fetchAll("SELECT id, remark, status FROM shops");
    $inventory = $db->fetchAll("SELECT id, shopId, status, internalStatus FROM inventory");
    
    // Check for specific columns
    $columns = $db->fetchAll("DESCRIBE inventory");
    $fieldNames = array_column($columns, 'Field');

    $jsonFiles = [
        'shops' => file_exists(__DIR__ . '/shops.json'),
        'inventory' => file_exists(__DIR__ . '/inventory.json'),
        'orders' => file_exists(__DIR__ . '/orders.json')
    ];

    echo json_encode([
        'api_version' => APP_VERSION,
        'shops_in_db' => $shops,
        'inventory_count' => count($inventory),
        'missing_account_id' => !in_array('accountId', $fieldNames),
        'existing_columns' => $fieldNames,
        'json_files_present' => $jsonFiles
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
