<?php
header('Content-Type: application/json');
$config = require 'db_config.php';
try {
    $dsn = "mysql:host={$config['host']};port={$config['port']};dbname={$config['database']};charset=utf8mb4";
    $pdo = new PDO($dsn, $config['username'], $config['password']);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    $shops = $pdo->query("SELECT id, remark FROM shops")->fetchAll(PDO::FETCH_ASSOC);
    $inventory = $pdo->query("SELECT id, shopId, status, internalStatus FROM inventory")->fetchAll(PDO::FETCH_ASSOC);
    
    echo json_encode([
        'shops_count' => count($shops),
        'inventory_count' => count($inventory),
        'inventory' => $inventory,
        'shops' => $shops
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
