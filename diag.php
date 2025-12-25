<?php
$config = include 'db_config.php';
try {
    $dsn = "mysql:host={$config['host']};port={$config['port']};dbname={$config['database']};charset=utf8mb4";
    $pdo = new PDO($dsn, $config['username'], $config['password']);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    echo "--- Duplicate childOrderId Check ---\n";
    $stmt = $pdo->query("SELECT childOrderId, COUNT(*) as cnt FROM inventory WHERE childOrderId IS NOT NULL AND childOrderId != '' GROUP BY childOrderId HAVING cnt > 1");
    print_r($stmt->fetchAll(PDO::FETCH_ASSOC));

    echo "\n--- Inventory Check for 418/428 IDs ---\n";
    $stmt = $pdo->prepare("SELECT id, childOrderId, title, price, internalStatus, lockTicket FROM inventory WHERE id IN ('1943510063935128085', '1943510436154441749')");
    $stmt->execute();
    print_r($stmt->fetchAll(PDO::FETCH_ASSOC));

} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
